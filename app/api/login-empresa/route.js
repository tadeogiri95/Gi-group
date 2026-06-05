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

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sbRpc(fnName, params) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

// Guardar jti en la tabla sesiones (para poder revocar)
async function guardarSesionJWT({ empleadoId, empresaId, jti, refreshJti, ip, userAgent }) {
  try {
    await fetch(`${SB_URL}/rest/v1/sesiones`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        empleado_id: empleadoId,
        empresa_id: empresaId,
        token: jti,  // guardamos el jti como "token" para compatibilidad
        jti,
        refresh_jti: refreshJti,
        ip,
        user_agent: userAgent,
        expira_en: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
  } catch (e) {
    console.error("[login] Error guardando sesión JWT:", e.message);
  }
}

export async function POST(req) {
  try {
    if (!SB_URL || !SB_KEY) {
      return NextResponse.json({ error: "Servidor mal configurado" }, { status: 500 });
    }

    const body = await req.json();

    // ─── Cambiar contraseña ───
    if (body.action === "cambiar_password") {
      const { userId, nuevaPassword, token } = body;
      if (!token) {
        return NextResponse.json({ error: "Token requerido" }, { status: 401 });
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
    if (!legajo || !password) {
      return NextResponse.json({ error: "Ingresá legajo y contraseña" }, { status: 400 });
    }

    let query = `empleados?legajo=eq.${encodeURIComponent(legajo.trim())}&activo=eq.true&select=*`;
    if (empresa_id) query += `&empresa_id=eq.${empresa_id}`;
    const empleados = await sbGet(query);

    if (!empleados || empleados.length === 0) {
      return NextResponse.json({ error: "Legajo no encontrado" }, { status: 401 });
    }

    let usuario = null;

    for (const emp of empleados) {
      if (!emp.password) continue;

      if (emp.password.startsWith("$2")) {
        const match = await bcrypt.compare(password, emp.password);
        if (match) { usuario = emp; break; }
      } else {
        if (password === emp.password) {
          usuario = emp;
          try {
            const hashed = await bcrypt.hash(password, 10);
            await sbPatch(`empleados?id=eq.${emp.id}`, { password: hashed });
            console.log(`[login] Contraseña migrada a bcrypt para legajo ${emp.legajo}`);
          } catch (e) {
            console.error("[login] Error migrando contraseña:", e.message);
          }
          break;
        }
      }
    }

    if (!usuario) {
      return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
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
      // Si JWT falla (ej: JWT_SECRET no configurada), caer al flujo legacy
      console.error("[login] Error generando JWT, usando flujo legacy:", e.message);

      const sesionData = await sbRpc("crear_sesion", {
        p_empleado_id: usuario.id,
        p_empresa_id: usuario.empresa_id,
        p_ip: ip,
        p_user_agent: userAgent.substring(0, 200),
      });
      const tokenInfo = Array.isArray(sesionData) ? sesionData[0] : sesionData;

      const empresaData = await sbGet(
        `empresa?id=eq.${usuario.empresa_id}&select=id,nombre,nombre_corto,slug,color_primario,color_secundario,logo_url,plan,max_empleados`
      );
      const safe = { ...usuario };
      delete safe.password;
      safe.empresa = empresaData?.[0] || null;

      return NextResponse.json({
        usuario: safe,
        token: tokenInfo?.out_token || null,
        expires_at: tokenInfo?.out_expires_at || null,
      });
    }

    // Guardar sesión en DB (para revocación)
    await guardarSesionJWT({
      empleadoId: usuario.id,
      empresaId: usuario.empresa_id,
      jti: accessJti,
      refreshJti,
      ip,
      userAgent: userAgent.substring(0, 200),
    });

    // Datos de empresa
    const empresaData = await sbGet(
      `empresa?id=eq.${usuario.empresa_id}&select=id,nombre,nombre_corto,slug,color_primario,color_secundario,logo_url,plan,max_empleados`
    );

    const safe = { ...usuario };
    delete safe.password;
    safe.empresa = empresaData?.[0] || null;

    return NextResponse.json({
      usuario: safe,
      token: accessToken,
      refresh_token: refreshToken,
      expires_in: 7 * 24 * 60 * 60,  // 7 días en segundos
    });
  } catch (err) {
    console.error("[login] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
