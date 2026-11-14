// app/lib/finanzasLibroManual.js — etapa 7 de la auditoría de Finanzas
// integrada (14/11): Gypi es el libro oficial y el libro de Google es una
// copia (el script baja todo cada 15 minutos). Si alguien carga un renglón a
// mano en el libro, no entra solo: el script se lo manda a Gypi en cada
// vuelta, Gypi lo compara con lo que ya tiene (las mismas reglas y la misma
// clave que el Histórico, así nada se repite) y lo que falta queda como
// pendiente "Cargado a mano en el libro", para incorporarlo o ignorarlo.
// En el libro, esos renglones se pintan de amarillo con la nota "No viene de
// Gypi". Sin migración: lo pendiente va en config_sistema ("finanzas_libro",
// valor.manuales y valor.manuales_ignorados).
import { planHistorico } from "./finanzasHistorico";

/** Columnas de T-OPERACIONES que manda el script (los títulos como los lee renglonesDelLibro). */
export const COLUMNAS_MANUAL = [
  "fecha_operación", "cod_tipo_op", "id_entidad", "centro_costo", "importe_neto", "impuestos", "total", "moneda",
  "descripcion", "referencia_externa", "estado", "cuenta_debe_final", "cuenta_haber_final",
];
export const NOTA_MANUAL = "No viene de Gypi: incorporalo o ignoralo en Gypi (Finanzas → Contabilidad → Libro de Google)";
export const MAX_PENDIENTES = 500;
export const MAX_IGNORADOS = 5000;
export const CARGADA_POR_MANUAL = "Gypi (cargado a mano en el libro de Google)";

const diaSiguiente = (f) => new Date(Date.parse(`${f}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

/**
 * Desde qué fecha se miran los renglones a mano: la del Histórico (el día
 * siguiente a la apertura "del libro") o, si no hay apertura, la primera
 * operación que vino del libro. Sin Histórico pasado, null (no se marca nada:
 * todo el libro saldría como "no viene de Gypi").
 * @param {{ apertura?: string|null, primeraDelLibro?: string|null }} d
 */
export function desdeManuales({ apertura = null, primeraDelLibro = null } = {}) {
  if (apertura) return diaSiguiente(apertura);
  return primeraDelLibro || null;
}

/** El renglón del libro de una operación del plan del Histórico ("Libro, renglón N"). */
export const filaDe = (op) => Number(String(op?.referencia || "").match(/renglón (\d+)/)?.[1]) || null;

/**
 * Lo cargado a mano en el libro que todavía no está en Gypi.
 * @param {{ grilla: any[][], desde: string, base: object, ignorados?: string[] }} d
 *   base: lo mismo que usa el Histórico (cuentas, tesoreria, proveedores,
 *   clientes, existentes, otras, anuladas).
 * @returns {{ pendientes: object[], total: number, filas: number[], faltan_cuentas: string[], error?: string }}
 */
export function pendientesDelLibro({ grilla, desde, base = {}, ignorados = [] }) {
  const plan = planHistorico({ grilla, desde, ...base, tc: {} });
  if (plan.error) return { pendientes: [], total: 0, filas: [], faltan_cuentas: [], error: plan.error };
  const fuera = new Set(ignorados.map(String));
  const lista = plan.nuevas
    .filter((o) => !fuera.has(o.origen_id))
    .map((o) => ({ ...o, fila: filaDe(o) }));
  return {
    pendientes: lista.slice(0, MAX_PENDIENTES),
    total: lista.length,
    // Todos los renglones a pintar en el libro (aunque pasen del tope)
    filas: lista.map((o) => o.fila).filter(Boolean),
    faltan_cuentas: plan.faltan_cuentas.filter((c) => lista.some((o) => o.cuenta_debe === c || o.cuenta_haber === c)),
  };
}

/** Lo que queda en config_sistema después de incorporar o ignorar esas claves. */
export function sinClaves(manuales, claves) {
  const fuera = new Set(claves.map(String));
  const pendientes = (manuales?.pendientes || []).filter((o) => !fuera.has(o.origen_id));
  const quitadas = (manuales?.pendientes || []).length - pendientes.length;
  return { ...(manuales || {}), pendientes, total: Math.max(0, (Number(manuales?.total) || 0) - quitadas) };
}

/** Suma claves a las ignoradas, sin repetir y con tope (quedan las últimas). */
export function sumarIgnorados(previos = [], claves = []) {
  const set = new Set([...previos.map(String), ...claves.map(String)]);
  return [...set].slice(-MAX_IGNORADOS);
}

/**
 * La operación lista para cargar: en dólares con el tipo de cambio que puso
 * el Dueño (las del libro no lo traen).
 */
export function operacionManual(op, tc) {
  if (op.moneda !== "USD") return { ...op, tipo_cambio: null, total_ars: op.total };
  const t = Number(tc);
  return { ...op, tipo_cambio: t > 0 ? t : null, total_ars: t > 0 ? Math.round(op.total * t * 100) / 100 : 0 };
}
