// app/lib/finanzasComprobantes.js — Finanzas (11/11, pedido de Tadeo): que el
// mismo comprobante no entre dos veces, venga de donde venga. Sin migración.
//
// Una factura o un ticket puede llegar por cuatro caminos: Mi caja (la foto
// del ticket), Cargar un gasto, la factura de una orden de compra y el CSV
// del S.O.S Contador. Cada uno guarda el número en fin_operaciones.referencia,
// pero escrito distinto:
//   gasto / Mi caja: "A 00003-00012345"
//   S.O.S:           "FC A-00003-00012345" (o "NC A-…")
//   compras:         el número como lo escribió quien cargó ("3-12345", "12345")
// claveComprobante los lleva a lo mismo (clase, letra, punto de venta,
// número) y comprobanteRepetido busca el mismo número del mismo proveedor
// (por proveedor_id, o por nombre si no está en la lista).
//
// Sin número (un ticket sin factura), movimientoParecido avisa si en la misma
// caja ya hay otro del mismo importe con pocos días de diferencia: puede ser
// otro gasto igual, así que se pregunta y no se bloquea.
import { claveNombre } from "./finanzasProveedores";

export const DIAS_PARECIDO = 3;

/** Mismo nombre escrito distinto: "GUZMAN FELIPE OMAR" = "FELIPE OMAR GUZMAN"; "BROCANELLI S." = "BROCANELLI SA". */
export function mismoNombre(a, b) {
  const ka = claveNombre(a);
  const kb = claveNombre(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length >= 6 && kb.length >= 6 && (ka.startsWith(kb) || kb.startsWith(ka))) return true;
  const palabras = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 1).sort().join(" ");
  return palabras(a).length >= 6 && palabras(a) === palabras(b);
}

/**
 * El número de un comprobante, escrito como sea.
 * "A 00003-00012345" | "FC A-00003-00012345" | "NC B-3-12" | "0003-00012345" | "12345"
 * @returns {{ clase: "FC"|"NC"|"ND", letra: string|null, pv: number|null, numero: number } | null}
 */
export function claveComprobante(texto) {
  const s = String(texto || "").toUpperCase().replace(/^\s*SIN FACTURA\s*\(?\s*COMPROBANTE\s*/, "").replace(/\)\s*$/, "").trim();
  if (!s || /^(GY-|FS-|LIBRO)/.test(s)) return null;
  const clase = /^\s*NC\b/.test(s) ? "NC" : /^\s*ND\b/.test(s) ? "ND" : "FC";
  const sinClase = s.replace(/^\s*(NC|ND|FC|FA|FACTURA)\b\s*/, "");
  const letra = (sinClase.match(/^([ABCMEX])\b|^([ABCMEX])(?=\s*-?\s*\d)/) || []).slice(1).find(Boolean) || null;
  const grupos = sinClase.match(/\d+/g) || [];
  if (!grupos.length) return null;
  let pv = null;
  let numero;
  if (grupos.length >= 2) {
    pv = Number(grupos[grupos.length - 2]);
    numero = Number(grupos[grupos.length - 1]);
  } else if (grupos[0].length >= 12) {
    // "000300012345": los últimos 8 son el número
    pv = Number(grupos[0].slice(0, -8));
    numero = Number(grupos[0].slice(-8));
  } else {
    numero = Number(grupos[0]);
  }
  if (!(numero > 0)) return null;
  return { clase, letra, pv, numero };
}

/** ¿Es el mismo comprobante? Lo que no se sabe (la letra o el punto de venta de una compra) no separa. */
export function mismoComprobante(a, b) {
  const x = typeof a === "string" ? claveComprobante(a) : a;
  const y = typeof b === "string" ? claveComprobante(b) : b;
  if (!x || !y) return false;
  if (x.numero !== y.numero || x.clase !== y.clase) return false;
  if (x.letra && y.letra && x.letra !== y.letra) return false;
  if (x.pv != null && y.pv != null && x.pv !== y.pv) return false;
  // Solo el número, sin letra ni punto de venta de ninguno de los dos: muy poco para decir que es el mismo
  return Boolean(x.pv != null || y.pv != null || x.letra || y.letra);
}

const nombreDe = (op, proveedores) => (op.proveedor_id ? proveedores.find((p) => Number(p.id) === Number(op.proveedor_id))?.nombre : null) || op.entidad || "";

/** ¿Es del mismo proveedor? Por proveedor_id, o por nombre (uno de la lista y otro escrito a mano). */
function mismoProveedor(nuevo, op, proveedores) {
  if (nuevo.proveedor_id && op.proveedor_id) return Number(nuevo.proveedor_id) === Number(op.proveedor_id);
  const a = nuevo.proveedor_id ? nombreDe(nuevo, proveedores) : nuevo.entidad;
  return mismoNombre(a, nombreDe(op, proveedores));
}

/**
 * La operación viva que ya tiene este comprobante del mismo proveedor, o null.
 * @param {{ referencia, proveedor_id?, entidad? }} nuevo
 * @param {object[]} operaciones con referencia, proveedor_id, entidad, anulada_at
 * @param {object[]} proveedores { id, nombre }
 */
export function comprobanteRepetido(nuevo, operaciones = [], proveedores = []) {
  const clave = claveComprobante(nuevo?.referencia);
  if (!clave) return null;
  return operaciones.find((op) => !op.anulada_at && op.id !== nuevo.id && mismoComprobante(clave, op.referencia) && mismoProveedor(nuevo, op, proveedores)) || null;
}

const dias = (a, b) => Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/**
 * Otro movimiento de la misma caja, mismo importe y pocos días de diferencia (el más cercano), o null.
 * @param {{ fecha, total, cuenta_debe, cuenta_haber }} nuevo
 * @param {string} caja la cuenta de la caja
 */
export function movimientoParecido(nuevo, operaciones = [], caja) {
  const sale = nuevo.cuenta_haber === caja;
  return operaciones
    .filter((op) => !op.anulada_at && op.id !== nuevo.id && (sale ? op.cuenta_haber : op.cuenta_debe) === caja
      && Math.abs((Number(op.total) || 0) - (Number(nuevo.total) || 0)) < 0.01 && dias(op.fecha, nuevo.fecha) <= DIAS_PARECIDO)
    .sort((a, b) => dias(a.fecha, nuevo.fecha) - dias(b.fecha, nuevo.fecha))[0] || null;
}

/** "12/11/2026" */
export const fechaDma = (f) => (/^\d{4}-\d{2}-\d{2}/.test(String(f || "")) ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");

/** De dónde vino una operación, para el aviso. */
export const DONDE = {
  mi_caja: "en Mi caja", gasto: "como gasto", sos: "desde el S.O.S Contador", compra_manual: "como compra a un proveedor",
  factura_oc: "como factura de una orden de compra", factura_oc_otra: "como factura de una orden de compra", factura_suelta: "como factura suelta",
};

/** "Este ticket ya está cargado (del 12/11/2026, en Mi caja)."; "Esa factura ya está cargada (…)". */
export function avisoRepetido(op, que = "Este comprobante") {
  const donde = DONDE[op?.origen] || "";
  const cargado = /^(esta|esa|la)\b/i.test(que) ? "cargada" : "cargado";
  return `${que} ya está ${cargado} (del ${fechaDma(op?.fecha)}${donde ? `, ${donde}` : ""}).`;
}
