// app/lib/retrabajo.js — Retrabajo de un proceso de una OT (Tadeo, 30/10;
// migración 147).
//
// Cuando hay que volver a un proceso (por ejemplo, piezas mal cortadas
// después de terminar Corte), gerencia, supervisores o administración cargan
// las horas de retrabajo con su motivo. El % del proceso no baja (Tadeo
// eligió sumar horas): el plan vivo suma esas horas al proceso hasta que se
// marca "✓ Retrabajo terminado", y el Gantt las dibuja en rojo al final de la
// barra. Las horas son como las muestra el Gantt (de máquina, o de Armado con
// los armadores que le tocan), igual que "⏱ Faltan X h".
// Ya terminado, sigue en rojo en la barra desde que se cargó hasta que se dio
// por terminado; uno mal cargado se elimina (queda anulado con quién lo hizo,
// migración 148) y no cuenta en ningún lado (Tadeo, 30/10).

export const MOTIVOS_RETRABAJO = [
  { id: "pieza_mal_cortada", label: "Pieza mal cortada" },
  { id: "error_medida", label: "Error de medida o plano" },
  { id: "danio_manipulacion", label: "Daño en manipulación" },
  { id: "falla_maquina", label: "Falla de máquina" },
  { id: "canto_mal_pegado", label: "Canto mal pegado" },
  { id: "pieza_mal_procesada", label: "Pieza mal procesada" },
  { id: "error_diseno", label: "Error de diseño" },
  { id: "otros", label: "Otros" },
];
const IDS = new Set(MOTIVOS_RETRABAJO.map((m) => m.id));
const ETAPAS = new Set(["corte", "canteado", "mecanizado", "armado"]);
export const AVISO_MIGRACION_147 = "Para guardar el retrabajo falta correr la migración 147 en Supabase.";
export const AVISO_MIGRACION_148 = "Para eliminar un retrabajo falta correr la migración 148 en Supabase.";
const vigente = (r) => !r?.anulado_at;

/** "Pieza mal cortada", o "Otros: …" con lo que se escribió. */
export function textoMotivoRetrabajo(r) {
  const m = MOTIVOS_RETRABAJO.find((x) => x.id === r?.motivo);
  if (!m) return "—";
  return m.id === "otros" && r.detalle ? `Otros: ${r.detalle}` : m.label;
}

/** Revisa un retrabajo antes de guardarlo (en la pantalla y en /api/data). null si está bien. */
export function validarRetrabajo(r) {
  if (!r || typeof r !== "object") return "Faltan los datos";
  if (typeof r.ot !== "string" || !r.ot.trim() || r.ot.length > 40) return "Falta la OT";
  if (!ETAPAS.has(r.etapa)) return "Proceso inválido";
  if (typeof r.horas !== "number" || !Number.isFinite(r.horas) || r.horas <= 0 || r.horas > 9999) return "Escribí cuántas horas de retrabajo";
  if (!IDS.has(r.motivo)) return "Elegí el motivo";
  const detalle = typeof r.detalle === "string" ? r.detalle.trim() : "";
  if (r.motivo === "otros" && !detalle) return "Escribí cuál es el motivo";
  if (detalle.length > 300) return "El motivo es muy largo (hasta 300 letras)";
  return null;
}

/** Solo se marca terminado o eliminado (anulado), con cuándo y quién. null si está bien. */
export function validarFinRetrabajo(r) {
  if (!r || typeof r !== "object") return "Falta cuándo se terminó";
  const fecha = (t) => typeof t === "string" && !Number.isNaN(Date.parse(t));
  if (r.anulado_at !== undefined) return fecha(r.anulado_at) ? null : "Falta cuándo se eliminó";
  if (!fecha(r.terminado_at)) return "Falta cuándo se terminó";
  return null;
}

/** Horas de retrabajo sin terminar de cada proceso: Map "OT|etapa" → horas. */
export function retrabajoPendiente(retrabajos = []) {
  const m = new Map();
  for (const r of retrabajos || []) {
    if (r.terminado_at || !vigente(r)) continue;
    const k = `${r.ot}|${r.etapa}`;
    m.set(k, (m.get(k) || 0) + (Number(r.horas) || 0));
  }
  return m;
}

/** Retrabajos de un proceso sin eliminar (primero los sin terminar), el más viejo primero. */
export function retrabajosDe(retrabajos = [], ot, etapa) {
  return (retrabajos || []).filter((r) => String(r.ot) === String(ot) && r.etapa === etapa && vigente(r))
    .sort((a, b) => !!a.terminado_at - !!b.terminado_at || String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

/** Retrabajos de un proceso sin terminar, el más viejo primero. */
export function pendientesDe(retrabajos = [], ot, etapa) {
  return retrabajosDe(retrabajos, ot, etapa).filter((r) => !r.terminado_at);
}

/** Retrabajos terminados de cada proceso: Map "OT|etapa" → [{ desde, hasta, horas }] (para la parte roja de la barra). */
export function retrabajosHechos(retrabajos = []) {
  const m = new Map();
  for (const r of retrabajos || []) {
    if (!r.terminado_at || !r.created_at || !vigente(r)) continue;
    const k = `${r.ot}|${r.etapa}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ desde: r.created_at, hasta: r.terminado_at, horas: Number(r.horas) || 0 });
  }
  return m;
}

export const esVigente = vigente;
