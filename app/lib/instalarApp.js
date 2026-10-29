// app/lib/instalarApp.js — Ofrecer instalar Gypi en el celular (PWA).
// Android (Chrome): el navegador avisa con "beforeinstallprompt" que se puede
// instalar; se guarda ese aviso para abrir la ventana del teléfono con un botón.
// iPhone: no hay botón posible, se muestran los pasos de Compartir → Agregar a inicio.
const CLAVE_POSPUESTO = "gypi_instalar_pospuesto"; // fecha (ms) hasta la que no se ofrece
const CLAVE_INSTALADA = "gypi_app_instalada";
export const DIAS_POSPUESTO = 7;

let aviso = null; // el evento beforeinstallprompt guardado
const oyentes = new Set();
const avisar = () => oyentes.forEach((f) => f());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // sin la barrita propia de Chrome: lo ofrece Gypi
    aviso = e;
    avisar();
  });
  window.addEventListener("appinstalled", () => {
    aviso = null;
    try { localStorage.setItem(CLAVE_INSTALADA, "1"); } catch { /* sin almacenamiento */ }
    avisar();
  });
}

/** "android" | "ios" | null (computadora u otro). */
export function sistemaCelular(ua = "", plataforma = "", toques = 0) {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (plataforma === "MacIntel" && toques > 1) return "ios"; // iPad que se presenta como Mac
  return null;
}

/** ¿Ya se abre como app (instalada)? */
export function abiertaComoApp() {
  if (typeof window === "undefined") return false;
  if (window.navigator?.standalone === true) return true; // iPhone
  try { return !!window.matchMedia?.("(display-mode: standalone)").matches; } catch { return false; }
}

export function hayAvisoAndroid() { return !!aviso; }

export function escucharAviso(f) {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

/** Abre la ventana de instalación del teléfono. @returns {Promise<boolean>} true si aceptó */
export async function pedirInstalacion() {
  if (!aviso) return false;
  const e = aviso;
  aviso = null;
  try {
    await e.prompt();
    const r = await e.userChoice;
    if (r?.outcome === "accepted") {
      try { localStorage.setItem(CLAVE_INSTALADA, "1"); } catch { /* sin almacenamiento */ }
    }
    avisar();
    return r?.outcome === "accepted";
  } catch {
    avisar();
    return false;
  }
}

export function posponer(ahora = Date.now()) {
  try { localStorage.setItem(CLAVE_POSPUESTO, String(ahora + DIAS_POSPUESTO * 86400000)); } catch { /* sin almacenamiento */ }
}

export function estaPospuesto(ahora = Date.now()) {
  try {
    if (localStorage.getItem(CLAVE_INSTALADA) === "1") return true;
    return Number(localStorage.getItem(CLAVE_POSPUESTO) || 0) > ahora;
  } catch { return false; }
}

/**
 * Qué ofrecer: "android" (botón Instalar), "ios" (pasos) o null (nada).
 * El botón fijo (Más / Mi cuenta) en Android sin aviso del navegador muestra
 * cómo hacerlo desde el menú ⋮ ("android-menu"); la tarjeta en ese caso no sale.
 * @param {{ sistema: string|null, instalada: boolean, appPlay: boolean, hayAviso: boolean, fijo?: boolean }} p
 */
export function queOfrecer({ sistema, instalada, appPlay, hayAviso, fijo = false }) {
  if (!sistema || instalada || appPlay) return null;
  if (sistema === "ios") return "ios";
  if (hayAviso) return "android";
  return fijo ? "android-menu" : null;
}
