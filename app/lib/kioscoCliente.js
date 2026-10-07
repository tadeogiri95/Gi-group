// app/lib/kioscoCliente.js — Ayudas del modo kiosco en el navegador (ítem 19).
import { getCsrfToken } from "./supabase";

/**
 * Legajo del QR personal (/{slug}?legajo=N, ítem 18). Si el QR es de otra
 * empresa, no es un link, o no trae un legajo válido, devuelve "".
 */
export function legajoDesdeQR(texto, slug) {
  try {
    const url = new URL(String(texto || ""));
    const slugQR = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "");
    const legajo = url.searchParams.get("legajo") || "";
    if (slug && slugQR !== slug) return "";
    return /^\d{1,9}$/.test(legajo) ? legajo : "";
  } catch {
    return "";
  }
}

/**
 * Ubicación del kiosco: está fijo en la planta, así que sirve una lectura de
 * hasta 10 minutos atrás y no se hace esperar a nadie más de unos segundos.
 */
export function ubicacionKiosco(timeoutMs = 6000) {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve({});
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        geo_lat: pos.coords.latitude,
        geo_lng: pos.coords.longitude,
        geo_precision: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
      }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 }
    );
  });
}

function headersJSON() {
  const h = { "Content-Type": "application/json" };
  const csrf = getCsrfToken();
  if (csrf) h["x-csrf-token"] = csrf;
  return h;
}

/** POST /api/kiosco/fichar. Devuelve siempre el JSON (con ok true/false). */
export async function ficharEnKiosco(datos) {
  try {
    const res = await fetch("/api/kiosco/fichar", { method: "POST", headers: headersJSON(), credentials: "include", body: JSON.stringify(datos) });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ...json, ok: res.ok && json.ok !== false };
  } catch {
    return { ok: false, tipo: "sin_conexion", error: "Sin conexión a internet. Probá de nuevo en un momento." };
  }
}

export async function activarKiosco(nombre) {
  const res = await fetch("/api/kiosco", { method: "POST", headers: headersJSON(), credentials: "include", body: JSON.stringify(nombre ? { nombre } : {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "No se pudo activar el kiosco");
  return json;
}

export async function desactivarKiosco() {
  await fetch("/api/kiosco", { method: "DELETE", headers: headersJSON(), credentials: "include" }).catch(() => {});
}
