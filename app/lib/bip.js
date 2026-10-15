// app/lib/bip.js — "Bip" corto (y una vibración) al leer un código con la
// cámara, para que el operario sepa que leyó sin mirar la pantalla.
// Web Audio: sin archivos de sonido. Si el navegador no deja, no hace nada.

let contexto = null;

export function bip() {
  try {
    if (typeof window === "undefined") return;
    navigator.vibrate?.(60);
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    contexto = contexto || new Ctx();
    if (contexto.state === "suspended") contexto.resume?.();
    const t = contexto.currentTime;
    const osc = contexto.createOscillator();
    const vol = contexto.createGain();
    osc.type = "square";
    osc.frequency.value = 1800;
    vol.gain.setValueAtTime(0.0001, t);
    vol.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(vol).connect(contexto.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  } catch { /* sin sonido */ }
}

/** El mismo código queda a la vista y se lee cada 350 ms: suena una vez por código. */
export const PAUSA_BIP_MS = 2500;

export function debeSonar(ultimo, codigo, ahora = Date.now()) {
  return !ultimo || ultimo.codigo !== codigo || ahora - ultimo.t >= PAUSA_BIP_MS;
}
