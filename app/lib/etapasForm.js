// app/lib/etapasForm.js — Configuración → Etapas.

// Al editar se mandan solo los campos que cambiaron: así una etapa vieja con
// un ícono o color raro (cargado antes de que existiera esta pantalla) se
// puede renombrar sin que el servidor rechace lo que no se tocó.
export function cambiosEtapa(original, form) {
  const cambios = {};
  for (const k of ["icon", "codigo", "nombre", "color", "unidad", "condicion_cierre"]) {
    const antes = k === "unidad" || k === "condicion_cierre" ? (original?.[k] || "") : original?.[k];
    if (!original || form[k] !== antes) cambios[k] = form[k];
  }
  if (cambios.nombre !== undefined) cambios.nombre = cambios.nombre.trim();
  return cambios;
}
