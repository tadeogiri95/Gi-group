// ═══════════════════════════════════════════════════════════
// /api/login-empresa/route.js — LOGIN + CAMBIAR PASSWORD
//
// ENTREGA 1B: Password policy reforzada
// ENTREGA 1E: Login ahora emite JWT (access + refresh tokens).
//   Se mantiene crear_sesion RPC para guardar el jti en la DB
//   (necesario para revocación de sesiones).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { validarPassword } from "../../lib/auth";
import { signAccessToken, signRefreshToken } from "../../lib/jwt";
import { logAudit } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { sbGet, sbPatch, sbPost } from "../../lib/sbHelpers";
import { ventana15min } from "../../lib/rateLimit";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Rate limit de login: 10 intentos por IP por ventana de 15 minutos.
// Fail-closed: si la DB no responde, se bloquea el intento (seguridad > disponibilidad en edge case).
const MAX_LOGIN_ATTEMPTS = 10;
async function checkLoginRateLimit(ip) {
  if (!SB_URL || !SB_KEY) return false;
  try {
    const ventana = ventana15min();
    const res = await fetch(`${SB_URL}/rest/v1/rpc/rpc_login_attempt`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_ip: ip, p_ventana: ventana }),
    });
    if (!res.ok) {
      logger.warn("checkLoginRateLimit: DB no disponible (respuesta no-ok) — bloqueando petición por seguridad", { ip, status: res.status });
      return true;
    }
    const count = await res.json();
    return typeof count === "number" && count > MAX_LOGIN_ATTEMPTS;
  } catch (e) {
    logger.warn("checkLoginRateLimit: DB no disponible (excepción) — bloqueando petición por seguridad", { ip, error: e?.message });
    return true;
  }
}

// Guardar sesión en la tabla sesiones (para poder revocar).
// Intenta primero con todos los campos opcionales (refresh_jti, user_agent).
// Si falla (columna inexistente, constraint, etc.), hace fallback al set mínimo.
// Guardar sesión en la tabla sesiones (para poder revocar).
// Intenta múltiples combinaciones de columnas porque el schema de producción
// puede diferir del schema base (migraciones 010/015/016/037 agregaron columnas
// que pueden o no estar aplicadas).
async function guardarSesionJWT({ empleadoId, empresaId, legajo, jti, refreshJti, ip, userAgent }) {
  if (!SB_URL || !SB_KEY) throw new Error("SB_URL o SB_KEY no configuradas");

  const expira_en = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const body = {
    empleado_id: empleadoId,
    empresa_id: empresaId,
    legajo: legajo,
    token: jti,
    jti: jti,
    refresh_jti: refreshJti || null,
    ip: ip || null,
    user_agent: userAgent || null,
    expira_en,
  };

  await sbPost("sesiones", body);
}

export async function POST(req) {
  try {
    if (!SB_URL || !SB_KEY) {
      return NextResponse.json({ error: "Servidor mal configurado" }, { status: 500 });
    }

    const body = await req.json();

    // ─── Cambiar contraseña ───
    if (body.action === "cambiar_password") {
      const { userId, nuevaPassword } = body;

      // Verificar sesión válida y que el token pertenece al mismo usuario
      const { validarToken } = await import("../../lib/auth");
      const sesion = await validarToken(req);
      if (!sesion || sesion.empleado_id !== userId) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      }

      const pwCheck = validarPassword(nuevaPassword);
      if (!pwCheck.valido) {
        return NextResponse.json({ error: pwCheck.error }, { status: 400 });
      }

      const hashed = await bcrypt.hash(nuevaPassword, 10);
      const updated = await sbPatch(`empleados?id=eq.${userId}`, {
        password: hashed,
        debe_cambiar_password: false,
      });
      if (!updated || updated.length === 0) {
        return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
      }
      const u = updated[0];
      delete u.password;
      return NextResponse.json({ usuario: u });
    }

    // ─── Login normal ───
    const { legajo, password, empresa_id } = body;
    const identifier = (legajo || "").toString().trim();
    if (!identifier || !password || !empresa_id) {
      return NextResponse.json({ error: "Ingresá legajo o email y contraseña" }, { status: 400 });
    }

    // Rate limiting por IP — bloquea brute force (migración 013 requerida)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (await checkLoginRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Demasiados intentos. Intentá de nuevo en 15 minutos." },
        { status: 429 }
      );
    }

    // empresa_id siempre incluido — previene búsquedas cross-tenant
    // Si el identifier contiene @ se trata como email, si no como legajo numérico
    const isEmail = identifier.includes("@");
    const query = isEmail
      ? `empleados?email=eq.${encodeURIComponent(identifier.toLowerCase())}&activo=eq.true&empresa_id=eq.${empresa_id}&select=*`
      : `empleados?legajo=eq.${encodeURIComponent(identifier)}&activo=eq.true&empresa_id=eq.${empresa_id}&select=*`;
    const empleados = await sbGet(query);

    if (!empleados || empleados.length === 0) {
      return NextResponse.json({ error: "Legajo o contraseña incorrectos" }, { status: 401 });
    }

    let usuario = null;

    for (const emp of empleados) {
      if (!emp.password) continue;

      if (emp.password.startsWith("$2")) {
        const match = await bcrypt.compare(password, emp.password);
        if (match) { usuario = emp; break; }
      } else {
        // Contraseña en texto plano (legacy) — comparar y migrar a bcrypt
        if (password === emp.password) {
          usuario = emp;
          try {
            const hashed = await bcrypt.hash(password, 10);
            await sbPatch(`empleados?id=eq.${emp.id}`, { password: hashed });
          } catch (e) {
            logger.error("Error migrando contraseña a bcrypt", e);
          }
          break;
        }
      }
    }

    if (!usuario) {
      return NextResponse.json({ error: "Legajo o contraseña incorrectos" }, { status: 401 });
    }

    // ─── Generar JWT tokens ───
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";

    let accessToken, refreshToken, accessJti, refreshJti;

    try {
      const access = await signAccessToken({
        empleadoId: usuario.id,
        empresaId: usuario.empresa_id,
        legajo: usuario.legajo,
        rol: usuario.rol,
      });
      accessToken = access.token;
      accessJti = access.jti;

      const refresh = await signRefreshToken({
        empleadoId: usuario.id,
        empresaId: usuario.empresa_id,
      });
      refreshToken = refresh.token;
      refreshJti = refresh.jti;
    } catch (e) {
      // JWT_SECRET no configurada u otro error fatal.
      // El flujo legacy (UUID token) no es compatible con el validarToken actual
      // (requiere JWT con prefijo "eyJ"), así que fallamos explícitamente.
      logger.error("Error generando JWT — JWT_SECRET configurada en Vercel?", { error: e.message });
      return NextResponse.json(
        { error: "Error de configuración del servidor. Configurá JWT_SECRET en las variables de entorno." },
        { status: 500 }
      );
    }

    // Guardar sesión en DB (para revocación).
    // Si falla, el login NO puede continuar: sin sesión en DB, validarToken
    // rechazará todas las requests y el usuario será expulsado inmediatamente.
    try {
      await guardarSesionJWT({
        empleadoId: usuario.id,
        empresaId: usuario.empresa_id,
        legajo: usuario.legajo,
        jti: accessJti,
        refreshJti: refreshJti,
        ip,
        userAgent: userAgent.substring(0, 200),
      });
    } catch (e) {
      logger.error("Login abortado: no se pudo guardar sesión en DB", e);
      return NextResponse.json(
        { error: `Error guardando sesión: ${e.message}` },
        { status: 500 }
      );
    }

    // Datos de empresa
    const empresaData = await sbGet(
      `empresa?id=eq.${usuario.empresa_id}&select=id,nombre,nombre_corto,slug,color_primario,color_secundario,logo_url,plan_activo,max_empleados`
    );

    const safe = { ...usuario };
    delete safe.password;
    delete safe.password_reset_jti;
    safe.empresa = empresaData?.[0] || null;

    logAudit({
      empresa_id: usuario.empresa_id,
      actor_id: usuario.id,
      actor_legajo: usuario.legajo,
      actor_rol: usuario.rol,
      accion: "login",
      entidad: "empleado",
      entidad_id: String(usuario.id),
      ip,
    });

    const isProd = process.env.NODE_ENV === "production";
    const res = NextResponse.json({
      usuario: safe,
      expires_in: 30 * 60,
    });
    res.cookies.set({
      name: "gypi_token",
      value: accessToken,
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 60,
    });
    res.cookies.set({
      name: "gypi_refresh",
      value: refreshToken,
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return res;
  } catch (err) {
    logger.error("login error", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
