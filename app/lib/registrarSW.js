// app/lib/registrarSW.js — Service worker de la app para abrirla sin conexión
// (ítem 21). Es el mismo archivo que usan las notificaciones push.
export const CACHE_DATOS_OFFLINE = "gypi-datos-v1"; // tiene que coincidir con public/firebase-messaging-sw.js

export async function registrarServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  } catch {
    return null;
  }
}
