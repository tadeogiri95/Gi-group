// app/lib/pantallaCompleta.js — Pantalla completa y apaisada para los Gantt
// (televisor o celular; si el navegador no deja, la vista igual ocupa toda la
// pantalla con su propio fondo).

/** Pide pantalla completa y gira a apaisado si se puede. */
export async function pedirPantallaCompleta() {
  try { await document.documentElement.requestFullscreen?.(); } catch { /* el navegador no deja */ }
  try { await globalThis.screen?.orientation?.lock?.("landscape"); } catch { /* se gira a mano */ }
}

/** Sale de la pantalla completa y suelta el giro. */
export function salirPantallaCompleta() {
  try { globalThis.screen?.orientation?.unlock?.(); } catch { /* nada */ }
  try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* nada */ }
}
