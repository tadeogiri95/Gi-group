// app/lib/kiosco.js — Modo kiosco en el servidor (D7, D11, ítem 19).
//
// Un gerente activa el kiosco desde una tablet o celular fijo en la planta. El
// dispositivo recibe una cookie httpOnly (gypi_kiosco) que solo sirve para
// fichar con legajo + PIN por /api/kiosco/*. Se guarda como una fila más de
// `sesiones` (a nombre de quien lo activó), así se puede revocar igual que
// cualquier sesión: también cuando ese gerente cambia su contraseña.
import crypto from "crypto";
import { verifyToken } from "./jwt";
import { sbGet, sbPost, sbPatch } from "./sbHelpers";

export const COOKIE_KIOSCO = "gypi_kiosco";
export const DURACION_KIOSCO_S = 365 * 24 * 60 * 60;

// NextRequest trae .cookies; un Request común (tests) solo el header
function leerCookie(request, nombre) {
  const directa = request.cookies?.get?.(nombre)?.value;
  if (directa) return directa;
  const par = (request.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(`${nombre}=`));
  return par ? decodeURIComponent(par.slice(nombre.length + 1)) : null;
}

const hashJti = (jti) => crypto.createHash("sha256").update(jti).digest("hex");

/**
 * Kiosco de la cookie, si es válido y no fue desactivado.
 * @returns {Promise<{ empresa_id: string, activado_por: string, jti: string } | null>}
 */
export async function validarKiosco(request) {
  const token = leerCookie(request, COOKIE_KIOSCO);
  if (!token) return null;
  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    return null;
  }
  if (!payload || payload.type !== "kiosco" || !payload.eid || !payload.jti) return null;
  const filas = await sbGet(`sesiones?token_hash=eq.${hashJti(payload.jti)}&revocada=eq.false&select=id&limit=1`, { silent: true });
  if (!Array.isArray(filas) || filas.length === 0) return null;
  return { empresa_id: payload.eid, activado_por: payload.sub, jti: payload.jti };
}

/** Guarda el kiosco en `sesiones` para poder revocarlo. */
export async function registrarKiosco({ jti, gerente, nombre, ip, userAgent }) {
  const vence = new Date(Date.now() + DURACION_KIOSCO_S * 1000).toISOString();
  await sbPost("sesiones", {
    empleado_id: gerente.empleado_id,
    empresa_id: gerente.empresa_id,
    legajo: gerente.legajo,
    token_hash: hashJti(jti),
    jti,
    token: jti,
    revocada: false,
    expires_at: vence,
    expira_en: vence,
    device_info: [`kiosco: ${nombre}`, ip, userAgent].filter(Boolean).join(" | ").slice(0, 300),
  });
}

export async function revocarKiosco(jti) {
  await sbPatch(`sesiones?token_hash=eq.${hashJti(jti)}`, { revocada: true });
}

export function opcionesCookieKiosco(maxAge = DURACION_KIOSCO_S) {
  return {
    name: COOKIE_KIOSCO,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge,
  };
}
