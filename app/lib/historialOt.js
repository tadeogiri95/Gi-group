// app/lib/historialOt.js — Registro de quién cambió qué en cada OT y cuándo
// (pedido de Tadeo, 02/11): carga de avance, demoras, retrabajos, edición,
// cierre, prioridad, semana, firmas de etapas y liberación.
//
// Cada cambio queda en audit_log (accion "ot.cambio", entidad = tabla,
// entidad_id = número de OT) con quién (actor_id) y la hora (created_at). No
// lleva migración: audit_log existe desde la 008 y solo la escribe el servidor.
// Lo que se cargó antes de este registro sale de las tablas que ya guardaban
// quién y cuándo (demoras, retrabajos, avance manual, firmas de etapas).

import { textoMotivoPausa } from "./pausaOt";

export const ACCION_CAMBIO_OT = "ot.cambio";
// Tablas con OT que se escriben por /api/data
export const TABLAS_OT = ["proyectos", "ajustes_tiempo_ot", "retrabajos_ot", "no_conformidades", "sueltos_ot", "pendientes_obra", "pausas_ot"];
const MAX_FILAS = 200;
const MAX_TEXTO = 300;

/** Lo que se guarda del cambio: campos recortados para no llenar el registro. */
function recortar(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "empresa_id") continue;
    if (typeof v === "string") out[k] = v.slice(0, MAX_TEXTO);
    else if (v && typeof v === "object") out[k] = JSON.stringify(v).length <= 2000 ? v : "(muy largo)";
    else out[k] = v;
  }
  return out;
}

function seguro(obj) {
  try { return recortar(obj); } catch { return {}; }
}

/**
 * Filas para audit_log de una escritura por /api/data en una tabla con OT.
 * @param {{ tabla: string, metodo: string, body?: object, filas?: object[], antes?: object[], sesion: object }} x
 */
export function filasDeCambio({ tabla, metodo, body = null, filas = [], antes = [], sesion }) {
  if (!TABLAS_OT.includes(tabla) || !metodo || metodo === "GET" || !sesion?.empresa_id) return [];
  const lista = (Array.isArray(filas) ? filas : [filas]).filter((f) => f && f.ot != null).slice(0, MAX_FILAS);
  const previo = new Map((antes || []).map((a) => [String(a.id), a]));
  return lista.map((f) => {
    const a = previo.get(String(f.id));
    const campos = metodo === "DELETE" ? {} : seguro(body);
    const datosAntes = a ? seguro(Object.fromEntries(Object.keys(campos).map((k) => [k, a[k] ?? null]))) : undefined;
    return {
      empresa_id: sesion.empresa_id,
      actor_id: sesion.empleado_id || null,
      actor_legajo: sesion.legajo ?? undefined,
      actor_rol: sesion.rol || undefined,
      accion: ACCION_CAMBIO_OT,
      entidad: tabla,
      entidad_id: String(f.ot),
      ...(datosAntes ? { datos_antes: datosAntes } : {}),
      datos_despues: { metodo, id: f.id ?? null, campos },
    };
  });
}

/** Fila para audit_log de una acción de /api/avance (firmas de etapas y liberación). */
export function filaDeAvance({ sesion, ot, accion, etapa = null }) {
  return {
    empresa_id: sesion.empresa_id,
    actor_id: sesion.empleado_id || null,
    actor_legajo: sesion.legajo ?? undefined,
    actor_rol: sesion.rol || undefined,
    accion: ACCION_CAMBIO_OT,
    entidad: "avance_etapas",
    entidad_id: String(ot),
    datos_despues: { metodo: "POST", accion, campos: etapa != null ? { etapa } : {} },
  };
}

// ─── Para mostrar ───────────────────────────────────────────────────────────

const ETAPA_PLAN = { corte: "Corte", canteado: "Canteado", mecanizado: "Mecanizado", armado: "Armado" };
const MOTIVOS = {
  falta_material: "Falta de material", falla_maquina: "Falla de máquina", corte_electricidad: "Corte de electricidad",
  planificacion_subestimada: "Tiempo de planificación subestimado", interrupcion: "Interrupción del trabajo", otros: "Otros",
  pieza_mal_cortada: "Pieza mal cortada", error_medida: "Error de medida o plano", danio_manipulacion: "Daño en manipulación",
  canto_mal_pegado: "Canto mal pegado", pieza_mal_procesada: "Pieza mal procesada", error_diseno: "Error de diseño",
};
const NOMBRE_CAMPO = {
  cliente: "cliente", proyecto: "proyecto", descripcion: "descripción", obra: "obra", division: "división", fecha_entrega: "entrega",
  cantidad: "cantidad", total_modulos: "módulos", tipo_proyecto: "tipo de proyecto", clase_complejidad: "clase", dias_instalacion: "días de instalación", personas_instalacion: "instaladores", prioridad: "prioridad", semana_app: "semana",
  notas: "notas", observaciones: "observaciones", estado: "estado", placas: "placas", fondos: "fondos", metros_canto: "metros de canto",
};
const ACCIONES_AVANCE = {
  terminar: "Marcó terminada la etapa", aprobar: "Firmó el cierre de la etapa", no_aplica: "Marcó que no aplica la etapa",
  reabrir: "Reabrió la etapa", liberar: "Liberó la OT", desliberar: "Le quitó la liberación a la OT", puntos: "Guardó los puntos críticos",
};

const horas = (h) => `${String(Number(h)).replace(".", ",")} h`;
const valor = (v) => (v === null || v === undefined || v === "" ? "vacío" : typeof v === "object" ? "…" : String(v));

/**
 * Texto de un cambio para el historial.
 * @param {{ tabla: string, metodo: string, accion?: string, campos?: object, antes?: object }} c
 * @param {(codigo: number|string) => string} nombreEtapa  código de etapa → nombre
 */
export function describirCambio(c, nombreEtapa = (x) => `etapa ${x}`) {
  const campos = c.campos || {};
  const etapa = (x) => ETAPA_PLAN[x] || nombreEtapa(x);
  if (c.tabla === "avance_etapas") {
    const base = ACCIONES_AVANCE[c.accion] || "Cambió el avance";
    return campos.etapa != null ? `${base} ${nombreEtapa(campos.etapa)}` : base;
  }
  if (c.tabla === "avance_manual") return `Cargó avance manual: ${nombreEtapa(campos.etapa)} ${campos.pct} %`;
  if (c.tabla === "ajustes_tiempo_ot") {
    if (c.metodo === "DELETE") return "Borró una demora";
    const que = campos.tipo === "corrimiento" ? `Corrimiento de ${campos.dias || 0} días` : campos.horas != null ? `Faltan ${horas(campos.horas)}` : "Demora";
    return [`Cargó demora en ${etapa(campos.etapa)}: ${que}`, MOTIVOS[campos.motivo], campos.detalle].filter(Boolean).join(" · ");
  }
  if (c.tabla === "retrabajos_ot") {
    if (campos.anulado_at) return "Eliminó un retrabajo";
    if (campos.terminado_at) return "Marcó terminado un retrabajo";
    if (c.metodo === "POST") return [`Cargó retrabajo de ${horas(campos.horas)} en ${etapa(campos.etapa)}`, MOTIVOS[campos.motivo], campos.detalle].filter(Boolean).join(" · ");
    return "Cambió un retrabajo";
  }
  if (c.tabla === "pausas_ot") {
    if (campos.hasta) return "▶ Reanudó la OT";
    if (c.metodo === "POST") return ["⏸ Puso la OT en pausa", textoMotivoPausa(campos)].filter((x) => x && x !== "—").join(" · ");
    return "Cambió una pausa";
  }
  if (c.tabla === "proyectos") {
    if (c.metodo === "POST") return "Dio de alta la OT";
    if (c.metodo === "DELETE") return "Borró la OT";
    if (campos.estado === "cerrado" && Object.keys(campos).length === 1) return "Cerró la OT";
    if (campos.estado === "activo" && Object.keys(campos).length === 1) return "Reactivó la OT";
    if (campos.avance_manual !== undefined) {
      const am = campos.avance_manual || {};
      if (!am.activo) return "Apagó el checkeo manual";
      const etapas = Object.entries(am.etapas || {}).map(([k, v]) => `${nombreEtapa(k)} ${v} %`).join(" · ");
      return `Cargó avance manual${etapas ? `: ${etapas}` : ""}`;
    }
    const partes = Object.keys(campos).filter((k) => !k.endsWith("_at") && k !== "id").map((k) => {
      const n = NOMBRE_CAMPO[k] || k.replace(/_/g, " ");
      return c.antes && k in c.antes ? `${n} de ${valor(c.antes[k])} a ${valor(campos[k])}` : `${n}: ${valor(campos[k])}`;
    });
    return partes.length ? `Cambió ${partes.join(" · ")}` : "Editó la OT";
  }
  const que = { no_conformidades: "una no conformidad", sueltos_ot: "un suelto", pendientes_obra: "un pendiente de obra" }[c.tabla] || c.tabla;
  return `${c.metodo === "POST" ? "Cargó" : c.metodo === "DELETE" ? "Borró" : "Cambió"} ${que}`;
}

/** Fila de audit_log → cambio para mostrar. */
export function cambioDeAudit(a) {
  const d = a?.datos_despues || {};
  return { at: a.created_at, actor_id: a.actor_id || null, tabla: a.entidad, metodo: d.metodo, accion: d.accion, campos: d.campos || {}, antes: a.datos_antes || null };
}

/**
 * Lo cargado antes del registro, desde las tablas que ya guardaban quién y cuándo.
 * Solo lo anterior a `desde` (el primer cambio registrado) para no repetir.
 */
export function cambiosAnteriores({ ajustes = [], retrabajos = [], pausas = [], manual = [], etapas = [], proyecto = null, desde = null }) {
  const antes = (t) => t && (!desde || t < desde);
  const out = [];
  for (const p of pausas) {
    if (antes(p.desde)) out.push({ at: p.desde, actor_id: p.creado_por || null, nombre: p.creado_nombre || null, tabla: "pausas_ot", metodo: "POST", campos: { motivo: p.motivo, detalle: p.detalle } });
    if (antes(p.hasta)) out.push({ at: p.hasta, nombre: p.reanudada_nombre || null, tabla: "pausas_ot", metodo: "PATCH", campos: { hasta: p.hasta } });
  }
  for (const a of ajustes) if (antes(a.created_at)) out.push({ at: a.created_at, actor_id: a.creado_por || null, nombre: a.creado_nombre || null, tabla: "ajustes_tiempo_ot", metodo: "POST", campos: a });
  for (const r of retrabajos) {
    if (antes(r.created_at)) out.push({ at: r.created_at, actor_id: r.creado_por || null, nombre: r.creado_nombre || null, tabla: "retrabajos_ot", metodo: "POST", campos: { horas: r.horas, etapa: r.etapa, motivo: r.motivo, detalle: r.detalle } });
    if (antes(r.terminado_at)) out.push({ at: r.terminado_at, nombre: r.terminado_nombre || null, tabla: "retrabajos_ot", metodo: "PATCH", campos: { terminado_at: r.terminado_at } });
    if (antes(r.anulado_at)) out.push({ at: r.anulado_at, nombre: r.anulado_nombre || null, tabla: "retrabajos_ot", metodo: "PATCH", campos: { anulado_at: r.anulado_at } });
  }
  for (const m of manual) if (antes(m.created_at)) out.push({ at: m.created_at, actor_id: m.creado_por || null, tabla: "avance_manual", metodo: "POST", campos: { etapa: m.etapa, pct: m.pct } });
  for (const e of etapas) {
    if (antes(e.terminada_at)) out.push({ at: e.terminada_at, actor_id: e.terminada_por || null, tabla: "avance_etapas", accion: "terminar", campos: { etapa: e.etapa } });
    if (antes(e.aprobada_at)) out.push({ at: e.aprobada_at, actor_id: e.aprobada_por || null, tabla: "avance_etapas", accion: e.estado === "no_aplica" ? "no_aplica" : "aprobar", campos: { etapa: e.etapa } });
  }
  if (antes(proyecto?.liberada_at)) out.push({ at: proyecto.liberada_at, actor_id: proyecto.liberada_por || null, tabla: "avance_etapas", accion: "liberar", campos: {} });
  return out;
}

/** Junta, pone el nombre de quién lo hizo y ordena: lo más nuevo primero. */
export function armarHistorial(cambios, empleados = []) {
  const nombres = new Map(empleados.map((e) => [String(e.id), e.nombre]));
  return cambios
    .filter((c) => c?.at)
    .map((c) => ({ ...c, nombre: c.nombre || (c.actor_id ? nombres.get(String(c.actor_id)) : null) || (c.actor_id ? "Usuario dado de baja" : "Sin dato") }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
