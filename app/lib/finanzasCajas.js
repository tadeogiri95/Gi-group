// app/lib/finanzasCajas.js — Finanzas (15/11, pedido de Tadeo): crear y
// eliminar cajas desde 💰 Tesorería (el Desarrollismo está en
// finanzasDesarrollismo.js).
//
//   - Nueva caja: se pone solo el nombre, el tipo, la moneda y el responsable.
//     El código de cuenta lo elige Gypi: si en el plan de cuentas ya hay una
//     cuenta con ese nombre que todavía no es caja (por ejemplo "Caja
//     Desarrollista", que vino del libro), usa esa; si no, el siguiente número
//     junto a las cajas del mismo tipo y moneda (01.01.01.001.001.14 →
//     .15). La cuenta nueva también se suma al plan de cuentas.
//   - Eliminar caja: si nunca tuvo movimientos (ni anulados, ni cheques, ni
//     extractos), se borra (migración 195: permiso de borrar). Si tuvo, se
//     archiva (activa = false): sale de las listas pero queda su historia, y
//     se puede volver a activar. Para archivarla el saldo tiene que estar en
//     cero, así no desaparece plata de Tesorería.
import { CODIGO_CUENTA } from "./finanzas";
import { movimientoCaja } from "./finanzasOperaciones";

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const txt = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Tipos de caja que se crean desde Tesorería (los plazos fijos y el FCI tienen su pantalla). */
export const TIPOS_CAJA_NUEVA = { caja: "Caja", banco: "Banco", otro: "Otro" };

/** Dónde van las cajas de cada tipo si todavía no hay ninguna (el plan del libro). */
const PADRE_POR_DEFECTO = { caja: { ARS: "01.01.01.001.001", USD: "01.01.01.008" }, banco: { ARS: "01.01.01.003", USD: "01.01.01.003" } };

const padreDe = (codigo) => String(codigo).split(".").slice(0, -1).join(".");
const ultimo = (codigo) => String(codigo).split(".").pop();

/** El padre más usado entre las cajas parecidas. */
function padreMasUsado(cajas) {
  const veces = new Map();
  for (const c of cajas) veces.set(padreDe(c.cuenta), (veces.get(padreDe(c.cuenta)) || 0) + 1);
  return [...veces.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] || null;
}

/**
 * El código de cuenta de una caja nueva.
 * @param {{ nombre, tipo, moneda }} caja
 * @param {object[]} tesoreria fin_tesoreria (cuenta, nombre, tipo, moneda)
 * @param {object[]} cuentas fin_cuentas (codigo, nombre)
 * @returns {{ codigo: string, reusa: boolean } | { error: string }}
 */
export function codigoNuevaCaja({ nombre, tipo, moneda }, tesoreria = [], cuentas = []) {
  const n = sinTildes(nombre);
  if (!n) return { error: "Falta el nombre de la caja" };
  if (tesoreria.some((t) => sinTildes(t.nombre) === n)) return { error: `Ya hay una caja que se llama "${txt(nombre)}"` };
  const usadas = new Set(tesoreria.map((t) => t.cuenta));
  // Una cuenta del plan con ese nombre que todavía no es caja: se usa esa
  const igual = cuentas.find((c) => sinTildes(c.nombre) === n && !usadas.has(c.codigo) && CODIGO_CUENTA.test(String(c.codigo)));
  if (igual) return { codigo: igual.codigo, reusa: true };

  const t = TIPOS_CAJA_NUEVA[tipo] ? tipo : "caja";
  const m = moneda === "USD" ? "USD" : "ARS";
  const mismas = tesoreria.filter((x) => (x.tipo || "otro") === t && (x.moneda || "ARS") === m);
  const parecidas = mismas.length ? mismas : tesoreria.filter((x) => (x.tipo || "otro") === t);
  const padre = padreMasUsado(parecidas) || PADRE_POR_DEFECTO[t]?.[m] || null;
  if (!padre) return { error: "No sé qué código ponerle: creala desde Configuración → Cajas y bancos, con su código de cuenta" };

  const hermanos = [...usadas, ...cuentas.map((c) => c.codigo)].filter((c) => padreDe(c) === padre);
  const largo = Math.max(2, ...hermanos.map((c) => ultimo(c).length));
  const siguiente = Math.max(0, ...hermanos.map((c) => Number(ultimo(c)) || 0)) + 1;
  if (String(siguiente).length > 4) return { error: "No hay más códigos libres para ese tipo de caja" };
  const codigo = `${padre}.${String(siguiente).padStart(largo, "0")}`;
  if (!CODIGO_CUENTA.test(codigo)) return { error: "No sé qué código ponerle: creala desde Configuración → Cajas y bancos, con su código de cuenta" };
  return { codigo, reusa: false };
}

/** Lo que se carga de una caja nueva, o { error }. */
export function limpiarCajaNueva(d = {}) {
  const nombre = txt(d.nombre);
  if (!nombre) return { error: "Falta el nombre de la caja" };
  const responsable = d.responsable_id && /^[0-9a-f-]{36}$/i.test(String(d.responsable_id)) ? String(d.responsable_id) : null;
  return { caja: { nombre, tipo: TIPOS_CAJA_NUEVA[d.tipo] ? d.tipo : "caja", moneda: d.moneda === "USD" ? "USD" : "ARS", responsable_id: responsable } };
}

/**
 * Qué se puede hacer al eliminar una caja.
 * @param {object} caja fin_tesoreria
 * @param {object[]} ops operaciones que tocan la caja (también las anuladas)
 * @param {number} [otrosUsos] cheques o extractos que la nombran
 * @returns {{ accion: "borrar"|"archivar"|"saldo", saldo: number, movimientos: number }}
 *   saldo: tiene plata y no se puede archivar todavía.
 */
export function comoEliminarCaja(caja, ops = [], otrosUsos = 0) {
  const suyas = ops.filter((op) => op.cuenta_debe === caja.cuenta || op.cuenta_haber === caja.cuenta);
  const saldo = Math.round(suyas.reduce((s, op) => s + movimientoCaja(op, caja), 0) * 100) / 100;
  const movimientos = suyas.filter((op) => !op.anulada_at).length;
  if (!suyas.length && !otrosUsos) return { accion: "borrar", saldo: 0, movimientos: 0 };
  if (Math.abs(saldo) >= 0.01) return { accion: "saldo", saldo, movimientos };
  return { accion: "archivar", saldo, movimientos };
}
