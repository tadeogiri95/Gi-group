// ═══════════════════════════════════════════════════════════
// app/lib/jwt.js — JWT helpers (jose library)
//
// ENTREGA 1E: Genera y verifica JWT firmados con HS256.
// Requiere: npm install jose
// Requiere env var: JWT_SECRET (min 32 chars)
//
// Access token: 7 días, payload { sub, eid, leg, rol, jti }
// Refresh token: 30 días, payload { sub, eid, type: "refresh", jti }
// ═══════════════════════════════════════════════════════════

import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET_RAW = process.env.JWT_SECRET;

// Encode secret once (jose requires Uint8Array for HS256)
function getSecret() {
  if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 32) {
    throw new Error("JWT_SECRET no configurada o muy corta (mínimo 32 caracteres)");
  }
  return new TextEncoder().encode(JWT_SECRET_RAW);
}

// Generar un ID único para el token (para revocación)
function generateJti() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// ─── Generar access token (7 días) ───
export async function signAccessToken({ empleadoId, empresaId, legajo, rol }) {
  const jti = generateJti();
  const token = await new SignJWT({
    sub: empleadoId,
    eid: empresaId,
    leg: legajo,
    rol,
    jti,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .setIssuer("gypi")
    .sign(getSecret());

  return { token, jti };
}

// ─── Generar refresh token (30 días) ───
export async function signRefreshToken({ empleadoId, empresaId }) {
  const jti = generateJti();
  const token = await new SignJWT({
    sub: empleadoId,
    eid: empresaId,
    type: "refresh",
    jti,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .setIssuer("gypi")
    .sign(getSecret());

  return { token, jti };
}

// ─── Verificar y decodificar cualquier token ───
// Retorna el payload o null si inválido/expirado.
export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: "gypi",
    });
    return payload;
  } catch {
    return null;
  }
}
