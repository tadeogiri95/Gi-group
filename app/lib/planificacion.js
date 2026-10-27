// app/lib/planificacion.js — Planificación de la producción de Muebles
// (parte 38; diseño en notes/diseno-planificacion-produccion.md).
// Parámetros de la planta (config_sistema clave "planificacion", uno por
// empresa) y prioridad manual de las OT (proyectos.prioridad, migración 137),
// que gerencia arma arrastrando las OT en una lista. Los mecanizados y los
// gabinetes por placa van por tipo de proyecto (app/lib/tipoProyecto.js).
import { buscarDivision, normalizar, rutaDe } from "./rutas";
import { TIPOS_PROYECTO, TIPO_GLOBAL } from "./tipoProyecto";

export const CLAVE_PLANIFICACION = "planificacion";

/** Etapas que compiten por horas (pinto y lustre no cuentan; el embalaje va en Armado). */
export const ETAPAS_PLAN = [
  { id: "corte", nombre: "Corte", palabras: ["corte", "seccion", "escuadr"] },
  { id: "canteado", nombre: "Canteado", palabras: ["cante", "canto", "enchap"] },
  { id: "mecanizado", nombre: "Mecanizado", palabras: ["mecaniz", "cnc", "perfor"] },
  { id: "armado", nombre: "Armado", palabras: ["armad", "embal"] },
];

/**
 * Cada parámetro: tipo número con mínimo y máximo. Los tiempos y relaciones
 * arrancan vacíos (los carga Tadeo); las máquinas vienen con lo que hay hoy en
 * la planta (1 seccionadora, 2 CNC, canteadora con 2 personas que tarda la mitad).
 */
export const PARAMETROS = [
  { id: "min_placa", grupo: "tiempos", label: "Tiempo de corte por placa", unidad: "min", ayuda: "Se suman placas y fondos.", min: 0, max: 600 },
  { id: "min_metro_canto", grupo: "tiempos", label: "Tiempo por metro de canto", unidad: "min", ayuda: "Con 1 persona en la canteadora.", min: 0, max: 120 },
  { id: "min_mecanizado", grupo: "tiempos", label: "Tiempo promedio por mecanizado", unidad: "min", ayuda: "Cada proceso de CNC de una placa.", min: 0, max: 600 },
  { id: "min_armado_gabinete", grupo: "tiempos", label: "Tiempo de armado por gabinete", unidad: "min", ayuda: "Incluye el embalaje.", min: 0, max: 1440 },
  { id: "eficiencia", grupo: "tiempos", label: "Factor de eficiencia", unidad: "%", ayuda: "Qué parte de la jornada se trabaja de verdad. Uno solo para toda la planta.", min: 1, max: 100 },
  { id: "pct_mecanizado", grupo: "relaciones", label: "Placas que se mecanizan", unidad: "% del total de placas", ayuda: "Solo se usa con el cálculo \"% de placas × mecanizados por placa\".", min: 0, max: 100 },
  { id: "maquinas_corte", grupo: "maquinas", label: "Seccionadoras", unidad: "máquinas", min: 1, max: 20, entero: true, defecto: 1 },
  { id: "maquinas_cnc", grupo: "maquinas", label: "CNC", unidad: "máquinas", min: 1, max: 20, entero: true, defecto: 2 },
  { id: "personas_canteadora", grupo: "maquinas", label: "Personas en la canteadora", unidad: "personas", min: 1, max: 2, entero: true, defecto: 2 },
  { id: "pct_tiempo_canteadora_2", grupo: "maquinas", label: "Tiempo con 2 personas en la canteadora", unidad: "% del tiempo con 1", ayuda: "50 = tarda la mitad.", min: 10, max: 100, defecto: 50 },
  { id: "max_armadores_ot", grupo: "personal", label: "Máximo de armadores por OT", unidad: "personas", ayuda: "Más que esto en una misma OT se estorban: los que sobran arman otra OT en paralelo.", min: 1, max: 20, entero: true, defecto: 4 },
];

/** Cómo se cuentan los mecanizados de una OT cuando la planilla no trae MECANIZADOS. */
export const MODOS_MECANIZADO = [
  { id: "tipo", label: "Placas × mecanizados por placa", ayuda: "Todas las placas de la OT llevan los mecanizados por placa de su tipo." },
  { id: "porcentaje", label: "% de placas × mecanizados por placa", ayuda: "Solo el % de placas que se mecanizan lleva los mecanizados por placa de su tipo." },
];

/** Relaciones por tipo de proyecto: mecanizados por placa y gabinetes por placa. */
export const RELACIONES_TIPO = [
  { id: "mec", label: "Mecanizados por placa", min: 0, max: 100 },
  { id: "gab", label: "Gabinetes por placa", min: 0, max: 50 },
];
const TIPOS_CON_GLOBAL = [...TIPOS_PROYECTO, TIPO_GLOBAL];

export const GRUPOS_PARAMETROS = [
  { id: "tiempos", titulo: "⏱ Tiempos de trabajo" },
  { id: "relaciones", titulo: "🔗 Relaciones" },
  { id: "maquinas", titulo: "🏭 Máquinas" },
  { id: "personal", titulo: "👷 Operarios por puesto" },
];

/** "0,5" → 0.5; "1.200" → 1200; vacío o texto → null. */
export function leerNumero(texto) {
  let s = String(texto ?? "").replace(/\s/g, "").slice(0, 20);
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** null si el valor sirve; si no, el motivo. Vacío sirve (todavía no cargado). */
export function errorParametro(p, valor) {
  if (valor == null) return null;
  if (!Number.isFinite(valor) || valor < p.min || valor > p.max) return `Entre ${String(p.min).replace(".", ",")} y ${String(p.max).replace(".", ",")}`;
  if (p.entero && !Number.isInteger(valor)) return "Sin decimales";
  return null;
}

/** División que se planifica: la elegida, o la que se llama Muebles. */
export function divisionPlan(divisiones, divisionId) {
  const lista = divisiones || [];
  return lista.find((d) => d.id === divisionId)
    || buscarDivision(lista, "muebles")
    || lista.find((d) => normalizar(d.label).includes("mueble"))
    || null;
}

/** Etapa de Gypi para cada etapa del plan: la elegida o la que se le parece por nombre (dentro de la ruta). */
export function etapasPlanDe(etapas, division, elegidas = {}) {
  const productivas = (etapas || []).filter((e) => e.codigo > 0);
  const ruta = rutaDe(division);
  const candidatas = ruta.length ? productivas.filter((e) => ruta.includes(e.codigo)) : productivas;
  const usadas = new Set();
  const out = {};
  for (const ep of ETAPAS_PLAN) {
    const elegida = productivas.find((e) => e.codigo === Number(elegidas?.[ep.id]));
    const parecida = candidatas.find((e) => !usadas.has(e.codigo) && ep.palabras.some((w) => normalizar(e.nombre).includes(w)));
    const etapa = elegida || parecida || null;
    if (etapa) usadas.add(etapa.codigo);
    out[ep.id] = etapa ? etapa.codigo : null;
  }
  return out;
}

/** Lo guardado en config_sistema, completo y limpio (lo inválido queda vacío). */
export function normalizarParametros(valor) {
  const v = valor && typeof valor === "object" ? valor : {};
  const out = {};
  for (const p of PARAMETROS) {
    const n = typeof v[p.id] === "number" ? v[p.id] : leerNumero(v[p.id]);
    out[p.id] = n != null && !errorParametro(p, n) ? n : (p.defecto ?? null);
  }
  out.modo_mecanizado = MODOS_MECANIZADO.some((m) => m.id === v.modo_mecanizado) ? v.modo_mecanizado : "tipo";
  // Sin cargar, cada tipo arranca con los valores del estudio de la planta
  out.por_tipo = Object.fromEntries(TIPOS_CON_GLOBAL.map((t) => [t.id, Object.fromEntries(RELACIONES_TIPO.map((r) => {
    const raw = v.por_tipo?.[t.id]?.[r.id];
    const n = typeof raw === "number" ? raw : leerNumero(raw);
    return [r.id, n != null && !errorParametro(r, n) ? n : t[r.id]];
  }))]));
  out.division_id = typeof v.division_id === "string" ? v.division_id : null;
  out.etapas = Object.fromEntries(ETAPAS_PLAN.map((ep) => {
    const c = Number(v.etapas?.[ep.id]);
    return [ep.id, Number.isInteger(c) && c > 0 ? c : null];
  }));
  return out;
}

/** Parámetros que todavía faltan para poder calcular la carga. */
export function parametrosFaltantes(params) {
  return PARAMETROS
    .filter((p) => params?.[p.id] == null && (p.id !== "pct_mecanizado" || params?.modo_mecanizado === "porcentaje"))
    .map((p) => p.label);
}

/** Mecanizados y gabinetes por placa del tipo (o del promedio si la OT no tiene tipo). */
export function relacionesTipo(params, tipoId) {
  return params?.por_tipo?.[tipoId] || params?.por_tipo?.global || { mec: TIPO_GLOBAL.mec, gab: TIPO_GLOBAL.gab };
}

// ─── Prioridad ──────────────────────────────────────────────────────────────

const conPrioridad = (p) => Number.isInteger(p?.prioridad) && p.prioridad > 0;

/** OT de la división que se pueden planificar: abiertas y sin terminar en la planilla. */
export function otsPlanificables(proyectos, divisiones, division) {
  return (proyectos || []).filter((p) => {
    if (p.estado === "cerrado" || p.terminado_planilla === true) return false;
    if (!division) return true;
    const d = buscarDivision(divisiones, p.division);
    return d ? d.id === division.id : false;
  });
}

const numeroOt = (ot) => Number(String(ot).replace(/\D/g, "")) || 0;

/** Primero las que tienen prioridad manual (1 arriba), después por semana objetivo y número de OT. */
export function ordenarPorPrioridad(ots) {
  return [...(ots || [])].sort((a, b) => {
    const pa = conPrioridad(a), pb = conPrioridad(b);
    if (pa !== pb) return pa ? -1 : 1;
    if (pa && a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
    const fa = a.fecha_objetivo || "9999", fb = b.fecha_objetivo || "9999";
    if (fa !== fb) return fa < fb ? -1 : 1;
    return numeroOt(a.ot) - numeroOt(b.ot);
  });
}

/**
 * Mueve una OT de un lugar a otro de la lista ordenada. Quedan con prioridad
 * las de arriba hasta donde cayó (o hasta la última que ya tenía); las de más
 * abajo siguen por semana. Devuelve la lista nueva con su prioridad.
 */
export function moverOt(lista, desde, hasta) {
  if (desde === hasta || desde < 0 || desde >= lista.length) return lista;
  const destino = Math.max(0, Math.min(lista.length - 1, hasta));
  const nueva = [...lista];
  const [movida] = nueva.splice(desde, 1);
  nueva.splice(destino, 0, movida);
  const antes = lista.filter(conPrioridad).length + (conPrioridad(movida) ? 0 : 1);
  const largo = Math.min(nueva.length, Math.max(antes, destino + 1));
  return nueva.map((p, i) => ({ ...p, prioridad: i < largo ? i + 1 : null }));
}

/** Saca la prioridad manual de una OT: las de abajo suben un lugar. */
export function quitarPrioridad(lista, id) {
  const resto = lista.filter((p) => p.id !== id);
  let n = 0;
  const conNumero = resto.map((p) => (conPrioridad(p) ? { ...p, prioridad: ++n } : { ...p, prioridad: null }));
  const quitada = lista.find((p) => p.id === id);
  return ordenarPorPrioridad([...conNumero, ...(quitada ? [{ ...quitada, prioridad: null }] : [])]);
}

/** Las OT cuya prioridad cambió: [{ id, prioridad }]. */
export function cambiosPrioridad(antes, despues) {
  const previa = new Map((antes || []).map((p) => [p.id, conPrioridad(p) ? p.prioridad : null]));
  return (despues || [])
    .map((p) => ({ id: p.id, prioridad: conPrioridad(p) ? p.prioridad : null }))
    .filter((c) => previa.get(c.id) !== c.prioridad);
}
