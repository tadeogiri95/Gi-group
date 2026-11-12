// app/lib/facturaUnica.js — Una factura, una sola vez (auditoría 12/11,
// parte 1). Sin migración.
//
// Una factura de proveedor puede entrar por la factura de una orden de
// compra, por "otra factura" de una OC, por Compras → Facturas (factura
// suelta), por Finanzas (Cargar gasto, Mi caja, S.O.S). Mi caja y Cargar
// gasto ya avisaban si el número estaba (finanzasComprobantes.js); la factura
// de la OC y la factura suelta no, y creaban la compra en Finanzas igual: la
// deuda con el proveedor y el IVA crédito quedaban al doble.
//
// facturaRepetida busca, entre las facturas ya cargadas en cualquiera de esos
// lugares, la del mismo proveedor con el mismo número. Avisa y no bloquea:
// quien carga puede seguir con "Cargarla igual" (forzar).
import { claveComprobante, fechaDma, mismoComprobante, mismoNombre } from "./finanzasComprobantes";

/** Dónde quedó cargada, para el aviso. */
export const DONDE_FACTURA = {
  oc: (c) => `en la orden de compra N° ${c.oc_numero}`,
  oc_otra: (c) => `como otra factura de la orden de compra N° ${c.oc_numero}`,
  suelta: () => "en Compras → Facturas",
  mi_caja: () => "en Mi caja",
  gasto: () => "en Finanzas, como gasto",
  sos: () => "en Finanzas, desde el S.O.S Contador",
  compra_manual: () => "en Finanzas, como compra",
  finanzas: () => "en Finanzas",
};

/** Mismo número: con letra o punto de venta, como Finanzas; sin ninguno, el mismo número entero del mismo proveedor también. */
export function mismoNumero(a, b) {
  const x = claveComprobante(a);
  const y = claveComprobante(b);
  if (!x || !y) return false;
  if (mismoComprobante(x, y)) return true;
  return x.clase === y.clase && x.numero === y.numero && x.pv == null && y.pv == null && !x.letra && !y.letra;
}

function mismoProveedor(a, b) {
  if (a.proveedor_id && b.proveedor_id) return Number(a.proveedor_id) === Number(b.proveedor_id);
  return mismoNombre(a.proveedor_nombre, b.proveedor_nombre);
}

/**
 * La factura ya cargada con el mismo número del mismo proveedor, o null.
 * @param {{ numero, proveedor_id?, proveedor_nombre? }} nueva
 * @param {{ tipo, numero, fecha?, proveedor_id?, proveedor_nombre?, oc_numero? }[]} cargadas
 */
export function facturaRepetida(nueva, cargadas = []) {
  if (!claveComprobante(nueva?.numero)) return null;
  if (!nueva.proveedor_id && !String(nueva.proveedor_nombre || "").trim()) return null;
  return cargadas.find((c) => mismoNumero(nueva.numero, c.numero) && mismoProveedor(nueva, c)) || null;
}

/** "La factura 3-12345 de MADERAS CORDOBA SA ya está cargada (del 09/11/2026, en la orden de compra N° 41)." */
export function avisoFacturaRepetida(c) {
  const donde = (DONDE_FACTURA[c?.tipo] || DONDE_FACTURA.finanzas)(c || {});
  const fecha = fechaDma(c?.fecha);
  const de = c?.proveedor_nombre ? ` de ${c.proveedor_nombre}` : "";
  return `La factura ${c?.numero || ""}${de} ya está cargada (${fecha ? `del ${fecha}, ` : ""}${donde}). Si es otra, revisá el número; si es la misma, no hace falta cargarla de nuevo.`;
}

/** Finanzas → los orígenes de fin_operaciones que se avisan con su propio texto. */
export const TIPO_DE_ORIGEN = { mi_caja: "mi_caja", gasto: "gasto", sos: "sos", compra_manual: "compra_manual", manual: "finanzas" };
