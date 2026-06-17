// ═══════════════════════════════════════════════════════════
// app/lib/auth.js — Middleware de autenticación compartido
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { verifyToken } from "./jwt";
import { logger } from "./logger";
export { validarPassword } from "./validators";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Validar sesión: verifica firma JWT + revocación en DB ───
export async function validarToken(request) {
  const cookieToken = request.cookies?.get?.("gypi_token")?.value;
  const authHeader = request.headers.get("authorization");
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;
  if (!token || token.length < 20) return null;

  if (!token.startsWith("eyJ")) return null;

  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    return null;
  }

  if (!payload || !payload.sub || !payload.eid) return null;
  if (payload.type === "refresh") return null;
  if (payload.code) return null; // impersonate codes son de un solo intercambio, no sesiones

  // Tokens de impersonación (1h) se validan solo por firma — no tienen sesión en DB.
  // Consultamos por la columna `token` (existe desde el schema base) que almacena el jti.
  // La columna `jti` (migración 010) es un alias indexado que puede no estar aplicada aún.
  if (!payload.imp && payload.jti && SB_URL && SB_KEY) {
    try {
      const crypto = await import("crypto");
      const tokenHash = crypto.createHash("sha256").update(payload.jti).digest("hex");
      const r = await fetch(
        `${SB_URL}/rest/v1/sesiones?token_hash=eq.${tokenHash}&revocada=eq.false&select=id&limit=1`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
      );
      if (r.ok) {
        // Solo bloqueamos si Supabase confirmó explícitamente que la sesión no existe.
        const rows = await r.json();
        if (!Array.isArray(rows) || rows.length === 0) return null;
      } else {
        // Error de DB/RLS — registramos para diagnóstico pero NO bloqueamos
        // (fail-open: una caída de Supabase no debe expulsar a todos los usuarios).
        const errText = await r.text().catch(() => "");
        logger.error(`validarToken: chequeo de sesión falló [${r.status}]`, new Error(errText));
      }
    } catch (e) {
      logger.error("validarToken: error de red en chequeo de sesión", e);
      // fail-open
    }
  }

  // email_verificado se expone como flag informativo pero NO bloquea el acceso.
  // Bloquear aquí causaba logout inmediato post-login para empresas sin verificar,
  // sin dar al usuario contexto de por qué falla. Se maneja en la UI con un banner.
  let emailVerificado = true;
  if (!payload.imp && SB_URL && SB_KEY) {
    try {
      const re = await fetch(
        `${SB_URL}/rest/v1/empresa?id=eq.${payload.eid}&select=email_verificado&limit=1`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
      );
      if (re.ok) {
        const rows = await re.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].email_verificado === false) {
          emailVerificado = false;
        }
      }
    } catch {
      // fail-open
    }
  }

  return {
    empleado_id: payload.sub,
    empresa_id: payload.eid,
    legajo: payload.leg,
    rol: payload.rol,
    jti: payload.jti,
    imp: payload.imp || false,
    email_verificado: emailVerificado,
    _auth_method: "jwt",
  };
}

// ─── Respuesta estándar 401 ───
export function respuestaNoAutorizado(mensaje) {
  return NextResponse.json(
    { error: mensaje || "No autorizado — sesión inválida o expirada" },
    { status: 401 }
  );
}

