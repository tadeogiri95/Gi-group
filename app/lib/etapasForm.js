// app/lib/etapasForm.js — Configuración → Etapas.

// Al editar se mandan solo los campos que cambiaron: así una etapa vieja con
// un ícono o color raro (cargado antes de que existiera esta pantalla) se
// puede renombrar sin que el servidor rechace lo que no se tocó.
export function cambiosEtapa(original, form) {
  const cambios = {};
  for (const k of ["icon", "codigo", "nombre", "color", "unidad", "condicion_cierre", "tipo_pieza"]) {
    const antes = ["unidad", "condicion_cierre", "tipo_pieza"].includes(k) ? (original?.[k] || "") : original?.[k];
    if (form[k] === undefined) continue;
    if (!original || form[k] !== antes) cambios[k] = form[k];
  }
  if (cambios.nombre !== undefined) cambios.nombre = cambios.nombre.trim();
  return cambios;
}

/** Opciones de "Se escanea por pieza como" (migración 111). */
export const OPCIONES_TIPO_PIEZA = [
  { id: "", nombre: "No se escanea por pieza" },
  { id: "corte", nombre: "Corte" },
  { id: "canto", nombre: "Canto" },
  { id: "cnc", nombre: "CNC" },
  { id: "especial", nombre: "Corte especial" },
];

/** El servidor le saca el tipo de pieza a la etapa que lo tenía: igual acá. */
export function soltarTipoPieza(etapas, guardada) {
  if (!guardada?.tipo_pieza) return etapas;
  return etapas.map((e) => (e.id !== guardada.id && e.tipo_pieza === guardada.tipo_pieza ? { ...e, tipo_pieza: null } : e));
}
