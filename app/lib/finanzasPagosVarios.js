// app/lib/finanzasPagosVarios.js — Finanzas → ➕ Cargar → 💸 Pagos (pedido
// de Tadeo del 19/11). Sin migración.
//
// Varios pagos a la vez, cada uno con su proveedor, con qué se paga y su
// comprobante (foto o PDF). Cada renglón es una orden de pago de siempre
// (/api/finanzas/pagos, app/lib/finanzasPagos.js), así el servidor valida y
// asienta igual que antes:
//   - 💸 Guardar pagos: se crea la orden y se paga en el momento.
//   - 📋 Armar orden de pago para el CFO: se crean las órdenes sin pagar y
//     se juntan en un resumen para el CFO, con el comprobante de cada una.
//     Cuentan como pagadas recién cuando el dueño aprieta 💸 Registrar pago
//     (Tadeo, 19/11: la plata no sale hasta que el CFO firma).
import { numero } from "./finanzasOperaciones";
import { FORMAS_PAGO } from "./finanzasPagos";

export const MAX_PAGOS_VARIOS = 30;
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Un renglón vacío (con la caja o el banco si hay uno solo). */
export function renglonPagoVacio({ proveedorId = "", cajas = [], bancos = [] } = {}) {
  return {
    proveedor: proveedorId ? String(proveedorId) : "",
    forma: bancos.length ? "transferencia" : "efectivo",
    cuenta: bancos.length === 1 ? bancos[0].cuenta : !bancos.length && cajas.length === 1 ? cajas[0].cuenta : "",
    importe: "", fecha_pago: "", numero: "", cheque_id: "", nota: "", comprobantes: [],
  };
}

/** Lo que vale un renglón: el importe escrito, o el del cheque de la cartera. */
export function importeRenglon(r, cheques = []) {
  if (r.forma === "cheque_tercero") return centavos(cheques.find((c) => String(c.id) === String(r.cheque_id))?.importe);
  return centavos(numero(r.importe));
}

export const totalPagos = (renglones = [], cheques = []) => centavos(renglones.reduce((s, r) => s + importeRenglon(r, cheques), 0));

/** Lo que falta en cada renglón, antes de mandar ("Pago 2: elegí el proveedor"). */
export function erroresPagos(renglones = [], { cheques = [], fecha = "" } = {}) {
  const errores = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) errores.push("Falta la fecha");
  if (!renglones.length) errores.push("Agregá al menos un pago");
  if (renglones.length > MAX_PAGOS_VARIOS) errores.push(`Hasta ${MAX_PAGOS_VARIOS} pagos por vez`);
  const usados = new Set();
  renglones.forEach((r, i) => {
    const n = `Pago ${i + 1}`;
    if (!r.proveedor) errores.push(`${n}: elegí el proveedor`);
    if (!FORMAS_PAGO[r.forma]) return errores.push(`${n}: elegí con qué se paga`);
    if (r.forma === "cheque_tercero") {
      if (!r.cheque_id) return errores.push(`${n}: elegí el cheque de la cartera`);
      if (usados.has(String(r.cheque_id))) return errores.push(`${n}: ese cheque ya está en otro pago`);
      usados.add(String(r.cheque_id));
      if (!cheques.some((c) => String(c.id) === String(r.cheque_id))) errores.push(`${n}: ese cheque ya no está en cartera`);
      return;
    }
    if (!(importeRenglon(r) > 0)) errores.push(`${n}: poné el importe`);
    if (r.forma === "echeq" && !r.fecha_pago) errores.push(`${n}: falta cuándo vence el e-cheq`);
    if ((r.forma === "efectivo" || r.forma === "transferencia") && !r.cuenta) errores.push(`${n}: elegí ${r.forma === "efectivo" ? "la caja" : "el banco"}`);
  });
  return errores;
}

/** La orden de pago de cada renglón, lista para POST { accion: "crear", orden }. */
export function ordenesDePagos(renglones = [], { fecha, notas = "" } = {}) {
  return renglones.map((r) => {
    const forma = { forma: r.forma };
    if (r.forma === "cheque_tercero") forma.cheque_id = r.cheque_id;
    else forma.importe = numero(r.importe);
    if (r.forma === "efectivo" || r.forma === "transferencia") forma.cuenta = r.cuenta;
    if (r.forma === "echeq") Object.assign(forma, { fecha_pago: r.fecha_pago, numero: r.numero });
    return {
      proveedor_id: Number(r.proveedor), fecha,
      notas: [String(r.nota || "").trim(), String(notas || "").trim()].filter(Boolean).join(" · "),
      facturas: [], formas: [forma],
      ...(r.comprobantes?.length ? { adjuntos: r.comprobantes } : {}),
    };
  });
}

/** El aviso al terminar "Guardar pagos": cuántos se pagaron y qué quedó. */
export function textoResultadoPagos({ pagados = 0, aElegir = [], errores = [] } = {}) {
  const partes = [];
  if (pagados) partes.push(pagados === 1 ? "1 pago guardado" : `${pagados} pagos guardados`);
  if (aElegir.length) {
    partes.push(`${aElegir.length === 1 ? "La orden" : "Las órdenes"} N° ${aElegir.join(", ")} ${aElegir.length === 1 ? "quedó" : "quedaron"} en Órdenes de pago: puede que ya ${aElegir.length === 1 ? "esté" : "estén"} en el banco, elegí cuál es y apretá 💸 Registrar pago`);
  }
  if (errores.length) partes.push(errores.join(" · "));
  return partes.join(". ");
}
