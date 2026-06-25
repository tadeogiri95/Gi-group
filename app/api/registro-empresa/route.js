// app/api/registro-empresa/route.js
// Registra una nueva empresa y su usuario admin
// FIX: sbFetch ahora verifica res.ok antes de parsear JSON
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sendBienvenida, sendVerificacionEmail } from "../../lib/email";
import { validarPassword } from "../../lib/validators";
import { logger } from "../../lib/logger";
import { ventana15min } from "../../lib/rateLimit";
import { registroEmpresaBody } from "../../lib/schemas";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { logEvent, EVT } from "../../lib/analytics";
import { sbFetch, crearEmpresaConAdmin, generarSlugUnico, iniciarTrialEmpresa, EmpresaSignupError } from "../../lib/empresaSignup";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Rate limit: máximo 3 registros por IP por ventana de 15 minutos.
// Reutiliza rpc_login_attempt con prefijo "reg:" para distinguir del rate limit de login.
// Fail-closed: si la DB no responde, se bloquea el intento (seguridad > disponibilidad en edge case).
const MAX_REGISTRO_ATTEMPTS = 3;
async function checkRegistroRateLimit(ip) {
  if (!SB_URL || !SB_KEY || !ip) return false;
  try {
    const ventana = ventana15min();
    const res = await fetch(`${SB_URL}/rest/v1/rpc/rpc_login_attempt`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_ip: `reg:${ip}`, p_ventana: ventana }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      logger.warn("checkRegistroRateLimit: DB no disponible (respuesta no-ok) — bloqueando petición por seguridad", { ip, status: res.status });
      return true;
    }
    const count = await res.json();
    return typeof count === "number" && count > MAX_REGISTRO_ATTEMPTS;
  } catch (e) {
    logger.warn("checkRegistroRateLimit: DB no disponible (excepción) — bloqueando petición por seguridad", { ip, error: e?.message });
    return true;
  }
}

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limitado = await checkRegistroRateLimit(ip);
    if (limitado) {
      return NextResponse.json(
        { error: "Demasiados registros desde esta IP. Intentá de nuevo en 15 minutos." },
        { status: 429 }
      );
    }

    const rawBody = await req.json();
    const parsed = validateBody(registroEmpresaBody, rawBody);
    if (parsed.response) return parsed.response;
    const { nombre_empresa, nombre_admin, email, password, rubro } = parsed.data;

    const pwCheck = validarPassword(password);
    if (!pwCheck.valido) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    // Verificar email no repetido
    const existente = await sbFetch(`empresa?admin_email=eq.${encodeURIComponent(email)}&select=id`);
    if (existente && existente.length > 0) {
      return NextResponse.json({ error: "Ya existe una empresa con ese email" }, { status: 400 });
    }

    // Generar slug único
    const slug = await generarSlugUnico(nombre_empresa);

    // Hash de contraseña
    const hashed = await bcrypt.hash(password, 10);

    // Token de verificación de email (UUID hex)
    const verifyTokenBytes = new Uint8Array(24);
    crypto.getRandomValues(verifyTokenBytes);
    const verifyToken = Array.from(verifyTokenBytes, (b) => b.toString(16).padStart(2, "0")).join("");

    // Crear empresa + admin atómicamente via RPC (con fallback secuencial)
    const nombreCorto = nombre_empresa.length > 12 ? nombre_empresa.slice(0, 12) : nombre_empresa;
    let emp, adminEmp;
    try {
      ({ emp, adminEmp } = await crearEmpresaConAdmin({
        nombreEmpresa: nombre_empresa,
        nombreCorto,
        adminEmail: email,
        adminPassword: hashed,
        rubro,
        slug,
        adminNombre: nombre_admin,
        emailVerifyToken: verifyToken,
      }));
    } catch (e) {
      if (e instanceof EmpresaSignupError) {
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      throw e;
    }

    // Mismo trial de 14 días para todas las empresas nuevas (RPC + fallback)
    await iniciarTrialEmpresa(emp.id);

    // Fire-and-forget — no bloquea la respuesta
    const appBase = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";
    const verifyUrl = `${appBase}/api/verificar-email?token=${verifyToken}&e=${emp.id}`;
    sendVerificacionEmail({ to: email, nombre: nombre_admin, empresa: emp.nombre, verifyUrl, empresaId: emp.id });
    sendBienvenida({ to: email, nombre: nombre_admin, empresa: emp.nombre, slug: emp.slug, empresaId: emp.id });

    logEvent(EVT.REGISTRO, {
      empresa_id: emp.id,
      plan: "trial",
      meta: { rubro: rubro || "general", slug: emp.slug },
    });

    return NextResponse.json({
      ok: true,
      empresa: { id: emp.id, nombre: emp.nombre, slug: emp.slug },
      usuario: Array.isArray(adminEmp) ? adminEmp[0] : adminEmp,
    });

  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
