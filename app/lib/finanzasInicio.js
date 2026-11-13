// app/lib/finanzasInicio.js — Finanzas → 🏠 Inicio (parte 10 del plan del
// 11/11; /api/finanzas/inicio). Sin migración.
//
// La primera pantalla de Finanzas: cuánta plata hay, qué hay que hacer hoy
// (cada cosa con un botón que lleva a su pantalla) y el resto de Finanzas
// ordenado por tema, para no tener que buscar entre 13 pestañas.
import { fechaDebito } from "./finanzasDiasHabiles";

/** Las pantallas de Finanzas agrupadas por tema, en el orden del menú. */
export const GRUPOS_FINANZAS = [
  { id: "dia", titulo: "Día a día", opciones: ["fin-tesoreria", "fin-pagos", "fin-cheques"] },
  { id: "gente", titulo: "Con quién trabajamos", opciones: ["fin-proveedores", "fin-clientes", "fin-sueldos", "fin-personas"] },
  { id: "numeros", titulo: "Cómo vamos", opciones: ["fin-resultados", "fin-flujo", "fin-reporte", "fin-cierre"] },
  { id: "ajustes", titulo: "Ajustes", opciones: ["fin-config"] },
];

/** Para qué sirve cada pantalla, en una línea (las tarjetas del Inicio). */
export const DETALLE_FINANZAS = {
  "fin-tesoreria": "Cajas y bancos con su saldo y todo lo que se cargó; cargar, corregir o anular",
  "fin-pagos": "Órdenes de pago: armar, aprobar y pagar",
  "fin-cheques": "Cheques y e-cheq propios y de terceros",
  "fin-proveedores": "Cuánto se le debe a cada uno",
  "fin-clientes": "Cuánto nos debe cada uno y cobros",
  "fin-sueldos": "Liquidar y pagar sueldos",
  "fin-personas": "Agenda única de clientes y proveedores",
  "fin-resultados": "Ganancia o pérdida por mes",
  "fin-flujo": "Cuánta plata entra y sale, y lo que viene",
  "fin-reporte": "Resumen para el contador o los socios",
  "fin-cierre": "Gypi contra el libro y stock valorizado",
  "fin-config": "Plan de cuentas, tipos y revisión contable",
};

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sumarDias = (fecha, n) => { const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Lo que hay que hacer, de lo más urgente a lo menos. Cada uno lleva a su
 * pantalla (ir) y dice cuántos son y por cuánto.
 * @returns {{ id, texto, ir, cantidad, importe?, tono: "rojo"|"ambar"|"normal" }[]}
 */
export function pendientesFinanzas({ hoy, revisar = [], ordenes = [], cheques = [], costos = 0, costosTotal = 0, plazosVencidos = 0, feriados = null, sinFactura = 0 }) {
  const out = [];
  const plural = (n, uno, varios) => (n === 1 ? uno : varios.replace("N", String(n)));
  const miCaja = revisar.filter((o) => o.origen === "mi_caja");
  const otras = revisar.filter((o) => o.origen !== "mi_caja");
  const enSemana = sumarDias(hoy, 7);

  const propios = cheques.filter((c) => c.clase === "propio" && c.estado === "pendiente" && (fechaDebito(c.fecha_pago, feriados) || c.fecha_pago) <= enSemana);
  const vencidosPropios = propios.filter((c) => (fechaDebito(c.fecha_pago, feriados) || c.fecha_pago) < hoy);
  if (propios.length) {
    out.push({
      id: "cheques_propios", ir: "fin-cheques", cantidad: propios.length, importe: centavos(propios.reduce((s, c) => s + Number(c.importe || 0), 0)), tono: vencidosPropios.length ? "rojo" : "ambar",
      texto: plural(propios.length, "1 e-cheq o cheque propio se debita esta semana: que haya plata en el banco", "N e-cheq o cheques propios se debitan esta semana: que haya plata en el banco"),
    });
  }
  const terceros = cheques.filter((c) => c.clase === "tercero" && c.estado === "en_cartera" && c.fecha_pago <= hoy);
  if (terceros.length) {
    out.push({
      id: "cheques_terceros", ir: "fin-cheques", cantidad: terceros.length, importe: centavos(terceros.reduce((s, c) => s + Number(c.importe || 0), 0)), tono: "ambar",
      texto: plural(terceros.length, "1 cheque de terceros ya se puede depositar", "N cheques de terceros ya se pueden depositar"),
    });
  }
  // Órdenes de pago sin pagar: no esperan al CFO (13/11), se pagan cuando se quiere
  const sinPagar = ordenes.filter((o) => ["borrador", "para_aprobar", "aprobada", "rechazada"].includes(o.estado));
  if (sinPagar.length) {
    out.push({
      id: "op_pagar", ir: "fin-pagos", cantidad: sinPagar.length, importe: centavos(sinPagar.reduce((s, o) => s + Number(o.total || 0), 0)), tono: "normal",
      texto: plural(sinPagar.length, "1 orden de pago sin pagar", "N órdenes de pago sin pagar"),
    });
  }
  if (plazosVencidos > 0) {
    out.push({ id: "plazos", ir: "fin-tesoreria", cantidad: plazosVencidos, tono: "ambar", texto: plural(plazosVencidos, "1 plazo fijo venció: registrar que volvió al banco", "N plazos fijos vencieron: registrar que volvieron al banco") });
  }
  if (miCaja.length) {
    out.push({ id: "mi_caja", ir: "fin-tesoreria", cantidad: miCaja.length, tono: "normal", texto: plural(miCaja.length, "1 movimiento de Mi caja para revisar", "N movimientos de Mi caja para revisar") });
  }
  if (otras.length) {
    out.push({ id: "revisar", ir: "fin-tesoreria", cantidad: otras.length, tono: "normal", texto: plural(otras.length, "1 operación para revisar", "N operaciones para revisar") });
  }
  if (sinFactura > 0) {
    out.push({ id: "sin_factura", ir: "inventario:compras", cantidad: sinFactura, tono: "ambar", texto: plural(sinFactura, "1 orden de compra recibida sin factura: cargala en Compras para que entre a Finanzas", "N órdenes de compra recibidas sin factura: cargalas en Compras para que entren a Finanzas") });
  }
  if (costos > 0) {
    out.push({ id: "costos", ir: "fin-tesoreria", cantidad: costos, importe: centavos(costosTotal), tono: "normal", texto: plural(costos, "1 costo de Flota o Maquinaria para pasar a Finanzas", "N costos de Flota y Maquinaria para pasar a Finanzas") });
  }
  return out;
}
