// app/lib/appAndroid.js — ¿Corre dentro de la app de Google Play (TWA)? (D12, D14, ítem 34)
// La app de Play abre gypi.app/?source=twa. Adentro no se muestran precios ni
// se cobra: las reglas de Google Play obligan a usar su sistema de pagos para
// vender dentro de una app, así que la suscripción se gestiona desde la web.
const CLAVE = "gypi_app_android";

export function esInicioAndroid(search = "", referrer = "") {
  return new URLSearchParams(search).get("source") === "twa" || String(referrer).startsWith("android-app://");
}

/** Recuerda en el teléfono que es la app de Play (las páginas siguientes no traen ?source). */
export function marcarSiEsAppAndroid(search, referrer) {
  if (!esInicioAndroid(search, referrer)) return false;
  try { localStorage.setItem(CLAVE, "1"); } catch { /* sin almacenamiento */ }
  return true;
}

export function esAppAndroid() {
  if (typeof window === "undefined") return false;
  if (esInicioAndroid(window.location.search, document.referrer)) return true;
  try { return localStorage.getItem(CLAVE) === "1"; } catch { return false; }
}
