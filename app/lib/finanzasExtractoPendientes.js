// app/lib/finanzasExtractoPendientes.js — Finanzas, parte 5 del plan de
// Tesorería (13/11): el extracto del banco completa, no copia.
//
// Un renglón del extracto que no está en Gypi puede ser algo que Gypi ya
// espera: un cheque propio por debitar, un cheque de terceros en cartera que
// se depositó, una orden de pago por transferencia sin pagar o el vencimiento
// de un plazo fijo. En ese caso no se carga un movimiento nuevo: se completa
// lo pendiente con su propia pantalla (el cheque queda debitado, la orden
// pagada), y la próxima vez que se sube el extracto ese renglón sale ✓.
//
// También: el resumen de lo que se va a cargar (cuánto entra, cuánto sale y
// cómo queda el saldo contra el del banco) y qué renglones de una carga se
// pueden deshacer (migración 188).
import { FORMAS_PAGO } from "./finanzasPagos";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dias = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
const igual = (a, b) => Math.abs(centavos(a) - centavos(b)) < 0.01;
const fechaDma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");

/** Días de margen entre lo que espera Gypi y la fecha del banco. */
export const DIAS_CHEQUE = 7;
export const DIAS_DEPOSITO = 20;
export const DIAS_PLAZO = 5;

/** Lo que espera Gypi y no está todavía en el banco, como candidatos. */
function candidatos({ cheques = [], ordenes = [], plazos = [], cuenta }) {
  const out = [];
  for (const ch of cheques) {
    if (ch.clase === "propio" && ch.estado === "pendiente" && (!ch.cuenta_banco || ch.cuenta_banco === cuenta)) {
      out.push({
        clase: "cheque", id: Number(ch.id), importe: -centavos(ch.importe), fecha: ch.fecha_pago, margen: [-DIAS_CHEQUE, DIAS_CHEQUE],
        texto: `Débito del cheque${ch.numero ? ` N° ${ch.numero}` : ""} a ${ch.beneficiario || "un proveedor"} (vence ${fechaDma(ch.fecha_pago)})`,
        accion: { url: "/api/finanzas/cheques", body: { accion: "cambiar", id: Number(ch.id), a: "debitado", cuenta_banco: cuenta } },
        boton: "Marcar el cheque debitado",
      });
    }
    if (ch.clase === "tercero" && ch.estado === "en_cartera") {
      out.push({
        clase: "cheque", id: Number(ch.id), importe: centavos(ch.importe), fecha: ch.fecha_pago, margen: [-2, DIAS_DEPOSITO],
        texto: `Depósito del cheque${ch.numero ? ` N° ${ch.numero}` : ""} de ${ch.recibido_de || ch.librador || "un cliente"} (cobrable desde ${fechaDma(ch.fecha_pago)})`,
        accion: { url: "/api/finanzas/cheques", body: { accion: "cambiar", id: Number(ch.id), a: "depositado", cuenta_banco: cuenta } },
        boton: "Marcar el cheque depositado",
      });
    }
  }
  for (const o of ordenes) {
    if (["pagada", "anulada"].includes(o.estado)) continue;
    const formas = Array.isArray(o.formas) ? o.formas : [];
    const transf = formas.filter((x) => x?.forma === "transferencia" && x.cuenta === cuenta);
    if (!transf.length) continue;
    const otras = formas.length - transf.length;
    const importe = -centavos(transf.reduce((s, x) => s + (Number(x.importe) || 0), 0));
    out.push({
      clase: "orden", id: Number(o.id), importe, fecha: o.fecha, margen: [-3, 60],
      texto: `Orden de pago N° ${o.numero} a ${o.proveedor_nombre} por ${FORMAS_PAGO.transferencia.toLowerCase()}${otras ? ` (la orden tiene ${otras === 1 ? "otra forma de pago, que también se registra" : `otras ${otras} formas de pago, que también se registran`})` : ""}`,
      accion: { url: "/api/finanzas/pagos", body: { accion: "pagar", id: Number(o.id) } },
      boton: "Marcar la orden pagada",
    });
  }
  for (const p of plazos) {
    if (p.moneda === "USD") continue;
    const base = { clase: "plazo", id: String(p.certificado), fecha: p.vencimiento, margen: [-1, DIAS_PLAZO], accion: { url: "/api/finanzas/plazos-fijos", body: { accion: "vencidos" } }, boton: "Registrar los plazos vencidos" };
    const nombre = `plazo fijo ${p.certificado} (venció ${fechaDma(p.vencimiento)})`;
    out.push({ ...base, importe: centavos(p.depositado), texto: `Vuelve el capital del ${nombre}` });
    if (p.interes > 0) {
      out.push({ ...base, importe: centavos(p.interes), texto: `Interés del ${nombre}` });
      out.push({ ...base, importe: centavos(p.depositado + p.interes), texto: `Capital e interés del ${nombre}` });
    }
  }
  return out;
}

/**
 * Para cada renglón del extracto sin pareja en Gypi, lo pendiente que
 * completa (el más cercano en fecha; cada pendiente sirve para un solo
 * renglón, salvo un plazo fijo, que se registra entero).
 * @param {{ fecha: string, importe: number, op?: object|null }[]} filas
 * @returns {Map<number, { clase: string, id: number|string, texto: string, accion: { url: string, body: object }, boton: string }>}
 */
export function pendientesDelExtracto(filas = [], ctx = {}) {
  const lista = candidatos(ctx);
  const parejas = [];
  for (const [fi, f] of filas.entries()) {
    if (f.op) continue;
    for (const [ci, c] of lista.entries()) {
      if (!c.fecha || !igual(c.importe, f.importe)) continue;
      const d = dias(f.fecha, c.fecha);
      if (d < c.margen[0] || d > c.margen[1]) continue;
      parejas.push({ fi, ci, d: Math.abs(d) });
    }
  }
  parejas.sort((a, b) => a.d - b.d || a.fi - b.fi || a.ci - b.ci);
  const out = new Map();
  const usados = new Set();
  for (const { fi, ci } of parejas) {
    const c = lista[ci];
    const clave = `${c.clase}:${c.id}`;
    if (out.has(fi) || (c.clase !== "plazo" && usados.has(clave))) continue;
    usados.add(clave);
    const { clase, id, texto, accion, boton } = c;
    out.set(fi, { clase, id, texto, boton, accion: { url: accion.url, body: { ...accion.body, fecha: filas[fi].fecha } } });
  }
  return out;
}

/**
 * Lo que pasa si se cargan los renglones elegidos: cuánto entra y sale, el
 * saldo de Gypi que queda al último día del extracto y la diferencia con el
 * saldo que dice el banco (si lo trae).
 */
export function resumenDeCarga(elegidas = [], { saldoGypi = 0, saldoBanco = null } = {}) {
  const entra = centavos(elegidas.filter((f) => f.importe > 0).reduce((s, f) => s + f.importe, 0));
  const sale = centavos(-elegidas.filter((f) => f.importe < 0).reduce((s, f) => s + f.importe, 0));
  const queda = centavos(saldoGypi + entra - sale);
  const diferencia = saldoBanco == null ? null : centavos(queda - saldoBanco);
  return { n: elegidas.length, entra, sale, queda, diferencia, cierra: diferencia != null && Math.abs(diferencia) < 0.01 };
}

/**
 * Qué operaciones de una carga se anulan al deshacer: todas las vivas, o
 * solo las elegidas que son de esa carga.
 * @returns {number[]}
 */
export function idsParaDeshacer(carga, elegidos = null) {
  const deCarga = new Set((Array.isArray(carga?.op_ids) ? carga.op_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0));
  if (!Array.isArray(elegidos)) return [...deCarga];
  return [...new Set(elegidos.map(Number))].filter((n) => deCarga.has(n));
}

/** "Ago 2026 · 34 cargados de 120 · Tadeo" para la lista de cargas. */
export function textoCarga(c) {
  const periodo = c.desde && c.hasta ? `del ${fechaDma(c.desde)} al ${fechaDma(c.hasta)}` : "";
  return [c.archivo, periodo, `${c.cargadas} cargados de ${c.movimientos}`, c.cargada_por_nombre].filter(Boolean).join(" · ");
}

