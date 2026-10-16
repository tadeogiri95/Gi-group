// app/lib/etapasForm.js — Configuración → Etapas.

// Cómo viene cada campo cuando la etapa no lo tiene (o falta la migración)
const VACIO = { unidad: "", condicion_cierre: "", columna_pieza: "", por_pieza: false };

/** El formulario vacío de una etapa nueva. */
export const ETAPA_NUEVA = { icon: "📋", codigo: 1, nombre: "", color: "#4f8cff", unidad: "", condicion_cierre: "", por_pieza: false, columna_pieza: "" };

/** Una etapa guardada → el formulario para editarla. */
export function formDeEtapa(etapa) {
  return {
    icon: etapa.icon, codigo: etapa.codigo, nombre: etapa.nombre, color: etapa.color,
    unidad: etapa.unidad || "", condicion_cierre: etapa.condicion_cierre || "",
    por_pieza: !!etapa.por_pieza, columna_pieza: etapa.columna_pieza || "",
  };
}

// Al editar se mandan solo los campos que cambiaron: así una etapa vieja con
// un ícono o color raro (cargado antes de que existiera esta pantalla) se
// puede renombrar sin que el servidor rechace lo que no se tocó.
export function cambiosEtapa(original, form) {
  const cambios = {};
  for (const k of ["icon", "codigo", "nombre", "color", "unidad", "condicion_cierre", "por_pieza", "columna_pieza"]) {
    const antes = k in VACIO ? (original?.[k] || VACIO[k]) : original?.[k];
    if (form[k] === undefined) continue;
    if (!original || form[k] !== antes) cambios[k] = form[k];
  }
  if (cambios.nombre !== undefined) cambios.nombre = cambios.nombre.trim();
  return cambios;
}
