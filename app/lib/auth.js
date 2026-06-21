// ═══════════════════════════════════════════════════════════
// app/lib/auth.js — Middleware de autenticación compartido
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { verifyToken } from "./jwt";
import { logger } from "./logger";
export { validarPassword } from "./validators";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Session validation cache (fail-closed with circuit breaker) ───
// Caches validated session JTIs for 5 minutes to avoid hitting Supabase
// on every request. On Supabase outage, the circuit breaker opens after
// 3 consecutive failures — while open, only cached sessions are accepted
// (fail-closed for unknown tokens, pass-through for recently validated ones).
const SESSION_CACHE = new Map();
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5 min

const CB_THRESHOLD = 3;
const CB_RESET_MS = 60_000; // 1 min
let cbFailures = 0;
let cbOpenUntil = 0;

function cbRecord(success) {
  if (success) {
    cbFailures = 0;
    cbOpenUntil = 0;
  } else {
    cbFailures++;
    if (cbFailures >= CB_THRESHOLD) {
      cbOpenUntil = Date.now() + CB_RESET_MS;
      logger.warn("validarToken: circuit breaker OPEN — solo sesiones cacheadas por 60s");
    }
  }
}

function cbIsOpen() {
  if (cbOpenUntil && Date.now() < cbOpenUntil) return true;
  if (cbOpenUntil && Date.now() >= cbOpenUntil) {
    cbOpenUntil = 0;
    cbFailures = 0;
  }
  return false;
}

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
  if (payload.code) return null;

  // Tokens de impersonación (1h) se validan solo por firma — no tienen sesión en DB.
  if (!payload.imp && payload.jti && SB_URL && SB_KEY) {
    const crypto = await import("crypto");
    const tokenHash = crypto.createHash("sha256").update(payload.jti).digest("hex");

    // Check cache first
    const cached = SESSION_CACHE.get(tokenHash);
    if (cached && Date.now() - cached.ts < SESSION_CACHE_TTL) {
      if (!cached.valid) return null;
      // Cache hit — skip DB check
    } else if (cbIsOpen()) {
      // Circuit breaker open: only allow cached sessions
      if (!cached || !cached.valid) {
        logger.warn("validarToken: circuit breaker open, sesión no cacheada rechazada", { jti: payload.jti.slice(0, 8) });
        return null;
      }
    } else {
      // DB check
      try {
        const r = await fetch(
          `${SB_URL}/rest/v1/sesiones?token_hash=eq.${tokenHash}&revocada=eq.false&select=id&limit=1`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
        );
        if (r.ok) {
          const rows = await r.json();
          const valid = Array.isArray(rows) && rows.length > 0;
          SESSION_CACHE.set(tokenHash, { valid, ts: Date.now() });
          cbRecord(true);
          if (!valid) return null;
        } else {
          const errText = await r.text().catch(() => "");
          logger.error(`validarToken: chequeo de sesión falló [${r.status}]`, new Error(errText));
          cbRecord(false);
          // Fail-closed: if we can't verify, reject unknown sessions
          if (!cached || !cached.valid) return null;
        }
      } catch (e) {
        logger.error("validarToken: error de red en chequeo de sesión", e);
        cbRecord(false);
        // Fail-closed: reject if not in cache
        if (!cached || !cached.valid) return null;
      }
    }
  }

  // email_verificado se expone como flag informativo pero NO bloquea el acceso.
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
      // fail-open for non-security flag
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
