// app/lib/instantanea.js — Último estado conocido guardado en el celular, para
// abrir la app sin conexión (F4-05, ítem 21). Solo datos del propio empleado y
// catálogos de la empresa (etapas, OT); nada de otros empleados.
export function guardarInstantanea(clave, datos) {
  try { localStorage.setItem(`gypi_snap_${clave}`, JSON.stringify({ guardado: Date.now(), datos })); } catch { /* sin almacenamiento */ }
}

/** Lo guardado, si existe y (con `fecha`) es de ese día. */
export function leerInstantanea(clave, { fecha } = {}) {
  try {
    const s = JSON.parse(localStorage.getItem(`gypi_snap_${clave}`) || "null");
    if (!s) return null;
    if (fecha && s.datos?.fecha !== fecha) return null;
    return s.datos;
  } catch {
    return null;
  }
}

/** Al cerrar sesión: que el próximo en usar el celular no vea nada del anterior. */
export function borrarInstantaneas() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("gypi_snap_")).forEach((k) => localStorage.removeItem(k));
  } catch { /* sin almacenamiento */ }
}
