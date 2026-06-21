import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { TokenResult } from "../types";

const JWT_SECRET_RAW = process.env.JWT_SECRET;

function getSecret(): Uint8Array {
  if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 32) {
    throw new Error("JWT_SECRET no configurada o muy corta (mínimo 32 caracteres)");
  }
  return new TextEncoder().encode(JWT_SECRET_RAW);
}

function generateJti(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface AccessTokenInput {
  empleadoId: string;
  empresaId: string;
  legajo: number;
  rol: string;
}

export async function signAccessToken(input: AccessTokenInput): Promise<TokenResult> {
  const jti = generateJti();
  const token = await new SignJWT({ sub: input.empleadoId, eid: input.empresaId, leg: input.legajo, rol: input.rol, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .setIssuer("gypi")
    .sign(getSecret());
  return { token, jti };
}

export async function signRefreshToken(input: { empleadoId: string; empresaId: string }): Promise<TokenResult> {
  const jti = generateJti();
  const token = await new SignJWT({ sub: input.empleadoId, eid: input.empresaId, type: "refresh", jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .setIssuer("gypi")
    .sign(getSecret());
  return { token, jti };
}

export async function signImpersonateToken(input: AccessTokenInput): Promise<TokenResult> {
  const jti = generateJti();
  const token = await new SignJWT({ sub: input.empleadoId, eid: input.empresaId, leg: input.legajo, rol: input.rol, jti, imp: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setIssuer("gypi")
    .sign(getSecret());
  return { token, jti };
}

export async function verifyToken(token: string | undefined | null): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: "gypi" });
    return payload;
  } catch {
    return null;
  }
}

export async function signPasswordResetToken(input: { empleadoId: string; empresaId: string }): Promise<TokenResult> {
  const jti = generateJti();
  const token = await new SignJWT({ sub: input.empleadoId, eid: input.empresaId, type: "password_reset", jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setIssuer("gypi")
    .sign(getSecret());
  return { token, jti };
}

export async function verifyPasswordResetToken(
  token: string | undefined | null
): Promise<{ empleadoId: string; empresaId: string; jti: string } | null> {
  const payload = await verifyToken(token);
  if (!payload || payload.type !== "password_reset") return null;
  if (!payload.sub || !payload.eid || !payload.jti) return null;
  return { empleadoId: payload.sub as string, empresaId: payload.eid as string, jti: payload.jti as string };
}

export async function signImpersonateCode(input: AccessTokenInput): Promise<TokenResult> {
  const jti = generateJti();
  const token = await new SignJWT({ sub: input.empleadoId, eid: input.empresaId, leg: input.legajo, rol: input.rol, jti, imp: true, code: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("60s")
    .setIssuer("gypi")
    .sign(getSecret());
  return { token, jti };
}

export async function verifyImpersonateCode(
  token: string | undefined | null
): Promise<AccessTokenInput | null> {
  const payload = await verifyToken(token);
  if (!payload || !payload.imp || !payload.code) return null;
  if (!payload.sub || !payload.eid || payload.leg === undefined || !payload.rol) return null;
  return {
    empleadoId: payload.sub as string,
    empresaId: payload.eid as string,
    legajo: payload.leg as number,
    rol: payload.rol as string,
  };
}

export async function signAdminToken(): Promise<string> {
  const jti = generateJti();
  // ver permite invalidar todos los tokens de admin sin cambiar JWT_SECRET:
  // basta con cambiar ADMIN_TOKEN_VERSION en las variables de entorno de Vercel.
  const ver = process.env.ADMIN_TOKEN_VERSION || "1";
  return new SignJWT({ sub: "superadmin", jti, ver })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .setIssuer("gypi")
    .sign(getSecret());
}

export async function verifyAdminToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const payload = await verifyToken(token);
  if (payload?.sub !== "superadmin") return false;
  const expectedVer = process.env.ADMIN_TOKEN_VERSION || "1";
  return payload.ver === expectedVer;
}
