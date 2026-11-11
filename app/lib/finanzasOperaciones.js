// app/lib/finanzasOperaciones.js — Finanzas, parte F1b: Movimientos (el
// libro de operaciones, T-OPERACIONES dentro de Gypi; tabla fin_operaciones
// de la migración 171).
//
// Lo usan la pantalla (vista previa del asiento y avisos mientras se carga) y
// el servidor (/api/finanzas/operaciones, que vuelve a validar todo con los
// datos de la base). Reglas:
//   - Al elegir el tipo se completan las cuentas del debe y del haber.
//   - Si un lado es una caja o un banco, se elige cuál. Si la cuenta del tipo
//     es la general ("Caja"), hay que elegir la caja de quién.
//   - Total = neto + IVA + otros impuestos. En dólares pide tipo de cambio y
//     guarda también el total en pesos.
//   - El asiento lleva el IVA en su cuenta: una compra con IVA son tres
//     renglones (gasto o material por el neto, IVA crédito fiscal por el IVA
//     y la otra cuenta por el total); una venta, al revés, con IVA débito.
//   - Controles al guardar (lo que hoy marca CHK_CARGA): falta fecha o tipo,
//     cuenta que no existe, tipo que pide proveedor, OT o centro de costo y
//     no lo tiene, debe y haber iguales, dólares en una caja de pesos.
//   - Nada se borra: se anula.

import { CUENTA_PROVEEDORES } from "./finanzasProveedores";
import { usoAjusteCapital } from "./finanzasBuenasPracticas";
import { errorAmortizacion } from "./finanzasCuentaElegir";

export const IVA_CREDITO = /^iva cr[eé]dito fiscal$/i;
export const IVA_DEBITO = /^iva d[eé]bito fiscal$/i;
export const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_OPERACIONES = 5000;
/** De dónde salió una operación que no se cargó a mano (F2a). */
export const ORIGENES = { factura_oc: "🧾 Factura de OC", factura_oc_otra: "🧾 Factura de OC (otro proveedor)", factura_suelta: "🧾 Factura suelta", saldo_inicial: "📥 Saldo inicial del libro", cheque: "🏦 Cheque", orden_pago: "💸 Orden de pago", mi_caja: "📱 Mi caja", cobro: "💵 Cobro", venta_ot: "🧾 Venta de OT", entrega_ot: "📦 Entrega de OT", compra_manual: "📝 Compra sin factura o nota de crédito", libro: "📚 Histórico del libro", sos: "📄 CSV del S.O.S Contador", compensacion: "⚖ Compensación cliente y proveedor", gasto: "🧾 Gasto devengado" };

const txt = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const redondear = (n) => Math.round(n * 100) / 100;

/** "1.234,56", "1234.56" o 1234.56 → 1234.56. Vacío → 0. Lo que no es número → NaN. */
export function numero(v) {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim().replace(/\s|\$/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** $ 1.234,56 · USD 1.234,56 */
export function plata(n, moneda = "ARS") {
  const v = Number(n) || 0;
  const t = v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === "USD" ? `USD ${t}` : `$ ${t}`;
}

/** Fecha de hoy en la Argentina (YYYY-MM-DD). */
export function hoyAr(ahora = new Date()) {
  return new Date(ahora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Primer día del mes de una fecha YYYY-MM-DD. */
export const inicioMes = (fecha) => `${fecha.slice(0, 8)}01`;

/**
 * Si la cuenta de un lado del asiento es una caja o un banco, qué cajas se
 * pueden elegir. La cuenta general (por ejemplo "Caja", con cajas debajo)
 * obliga a elegir una (defecto vacío). Una caja o banco puntual viene
 * elegido, y se puede cambiar por otro del mismo tipo.
 * @returns {{ opciones: any[], defecto: string } | null} null si no es caja ni banco
 */
export function cajasDelLado(codigo, tesoreria = []) {
  if (!codigo) return null;
  const activas = tesoreria.filter((t) => t.activa !== false);
  const hijas = activas.filter((t) => t.cuenta.startsWith(`${codigo}.`));
  if (hijas.length) return { opciones: hijas, defecto: "" };
  const misma = tesoreria.find((t) => t.cuenta === codigo);
  if (!misma) return null;
  return { opciones: activas.filter((t) => t.tipo === misma.tipo || t.cuenta === codigo), defecto: codigo };
}

/** Las cuentas que propone un tipo de operación (la caja general queda sin elegir). */
export function cuentasDelTipo(tipo, tesoreria = []) {
  const lado = (c) => {
    const cajas = cajasDelLado(c, tesoreria);
    return cajas ? cajas.defecto : c || "";
  };
  return { cuenta_debe: lado(tipo?.cuenta_debe), cuenta_haber: lado(tipo?.cuenta_haber) };
}

const esVenta = (tipo) => /venta/i.test(String(tipo?.grupo || "")) || /^venta/i.test(String(tipo?.codigo || ""));

/**
 * Renglones del asiento, en la moneda de la operación.
 * @returns {{ renglones: {lado: "debe"|"haber", cuenta: string, nombre: string, importe: number}[], aviso: string | null }}
 */
export function asientoDe(op, { cuentas = [], tipos = [] } = {}) {
  const nombre = (c) => cuentas.find((x) => x.codigo === c)?.nombre || "";
  const r = (lado, cuenta, importe) => ({ lado, cuenta, nombre: nombre(cuenta), importe: redondear(importe) });
  const neto = Number(op.neto) || 0;
  const iva = Number(op.iva) || 0;
  const otros = Number(op.otros_impuestos) || 0;
  const total = Number(op.total) || redondear(neto + iva + otros);
  if (iva <= 0) return { renglones: [r("debe", op.cuenta_debe, total), r("haber", op.cuenta_haber, total)], aviso: null };
  const tipo = tipos.find((t) => t.codigo === op.tipo);
  const venta = esVenta(tipo);
  const cuentaIva = cuentas.find((c) => (venta ? IVA_DEBITO : IVA_CREDITO).test(String(c.nombre || "").trim()));
  if (!cuentaIva) {
    return {
      renglones: [r("debe", op.cuenta_debe, total), r("haber", op.cuenta_haber, total)],
      aviso: `No encontré la cuenta "${venta ? "IVA Debito Fiscal" : "IVA Credito Fiscal"}" en el plan de cuentas: el IVA queda junto con el neto.`,
    };
  }
  if (venta) {
    return { renglones: [r("debe", op.cuenta_debe, total), r("haber", op.cuenta_haber, neto + otros), r("haber", cuentaIva.codigo, iva)], aviso: null };
  }
  // Nota de crédito de un proveedor (Proveedores al debe): el IVA crédito vuelve al haber
  if (CUENTA_PROVEEDORES.test(nombre(op.cuenta_debe).trim())) {
    return { renglones: [r("debe", op.cuenta_debe, total), r("haber", op.cuenta_haber, neto + otros), r("haber", cuentaIva.codigo, iva)], aviso: null };
  }
  return { renglones: [r("debe", op.cuenta_debe, neto + otros), r("debe", cuentaIva.codigo, iva), r("haber", op.cuenta_haber, total)], aviso: null };
}

/**
 * Valida una operación cargada a mano y la deja lista para guardar.
 * @param {object} f lo que viene del formulario
 * @param {{ tipos: any[], cuentas: any[], tesoreria: any[], centros: any[], proveedores: any[], proyectos: any[] }} ctx
 * @returns {{ op: object | null, errores: string[] }}
 */
export function validarOperacion(f, ctx) {
  const { tipos = [], cuentas = [], tesoreria = [], centros = [], proveedores = [], proyectos = [] } = ctx || {};
  const errores = [];
  const fecha = txt(f?.fecha, 10);
  if (!FECHA.test(fecha) || Number.isNaN(Date.parse(`${fecha}T12:00:00Z`))) errores.push("Falta la fecha.");
  const tipo = tipos.find((t) => t.codigo === txt(f?.tipo, 80));
  if (!tipo) errores.push("Falta el tipo de operación.");
  else if (tipo.activo === false) errores.push(`El tipo ${tipo.codigo} está desactivado.`);

  const neto = numero(f?.neto);
  const iva = numero(f?.iva);
  const otros = numero(f?.otros_impuestos);
  if ([neto, iva, otros].some((n) => Number.isNaN(n))) errores.push("Algún importe no es un número.");
  else if ([neto, iva, otros].some((n) => n < 0)) errores.push("Los importes van en positivo: el debe y el haber dicen para qué lado va.");
  const total = redondear((neto || 0) + (iva || 0) + (otros || 0));
  if (!(total > 0) && !errores.some((e) => e.includes("importe"))) errores.push("Falta el importe.");

  const moneda = f?.moneda === "USD" ? "USD" : "ARS";
  let tipoCambio = null;
  if (moneda === "USD") {
    tipoCambio = numero(f?.tipo_cambio);
    if (!(tipoCambio > 0)) errores.push("En dólares falta el tipo de cambio.");
  }

  const cuentaDebe = txt(f?.cuenta_debe, 40);
  const cuentaHaber = txt(f?.cuenta_haber, 40);
  const existe = (c) => cuentas.some((x) => x.codigo === c);
  for (const [lado, c] of [["debe", cuentaDebe], ["haber", cuentaHaber]]) {
    const cajas = cajasDelLado(c, tesoreria);
    if (!c) errores.push(cajasDelLado(tipo?.[`cuenta_${lado}`], tesoreria) ? `Elegí la caja o el banco del ${lado}.` : `Falta la cuenta del ${lado}.`);
    else if (cajas && cajas.defecto === "") errores.push(`Elegí la caja o el banco del ${lado}.`);
    else if (!existe(c)) errores.push(`La cuenta ${c} del ${lado} no está en el plan de cuentas.`);
    else if (cuentas.find((x) => x.codigo === c)?.activa === false) errores.push(`La cuenta ${c} del ${lado} está desactivada.`);
  }
  if (cuentaDebe && cuentaDebe === cuentaHaber) errores.push("El debe y el haber son la misma cuenta: un pase entre cajas necesita las dos.");
  // Parte 7 del 11/11: Ajuste De Capital no es comodín (solo apertura, saldos y socios)
  const ajuste = usoAjusteCapital({ tipo: tipo?.codigo, cuenta_debe: cuentaDebe, cuenta_haber: cuentaHaber }, cuentas);
  if (ajuste) errores.push(ajuste);
  // 11/11: la amortización va contra la amortización acumulada del bien
  const amort = tipo ? errorAmortizacion(tipo, cuentaHaber, cuentas) : null;
  if (amort) errores.push(amort);

  const cajaDe = (c) => tesoreria.find((t) => t.cuenta === c);
  const cajas = [cajaDe(cuentaDebe), cajaDe(cuentaHaber)].filter(Boolean);
  for (const c of cajas) {
    if (c.moneda === "USD" && moneda === "ARS") errores.push(`${c.nombre} es en dólares: elegí Dólares y el tipo de cambio.`);
  }
  if (moneda === "USD" && !cajas.some((c) => c.moneda === "USD")) {
    errores.push("Una operación en dólares tiene que entrar o salir de una caja o banco en dólares. Las cuentas corrientes van en pesos.");
  }

  const proveedorId = f?.proveedor_id ? Number(f.proveedor_id) : null;
  const proveedor = proveedorId ? proveedores.find((p) => Number(p.id) === proveedorId) : null;
  if (proveedorId && !proveedor) errores.push("Ese proveedor no está en la lista.");
  const entidad = proveedor ? null : txt(f?.entidad) || null;
  if (tipo?.pide_entidad && !proveedor && !entidad) errores.push(`${tipo.codigo} pide proveedor o cliente.`);

  const proyectoId = f?.proyecto_id ? Number(f.proyecto_id) : null;
  if (proyectoId && !proyectos.some((p) => Number(p.id) === proyectoId)) errores.push("Esa OT no está en la lista.");
  if (tipo?.pide_ot && !proyectoId) errores.push(`${tipo.codigo} pide la OT.`);

  const centro = txt(f?.centro_costo, 60) || null;
  if (centro && !centros.some((c) => c.codigo === centro)) errores.push(`El centro de costo ${centro} no existe.`);
  if (tipo?.pide_cc && !centro) errores.push(`${tipo.codigo} pide centro de costo.`);

  if (errores.length) return { op: null, errores: [...new Set(errores)] };
  return {
    errores: [],
    op: {
      fecha,
      tipo: tipo.codigo,
      proveedor_id: proveedor ? Number(proveedor.id) : null,
      entidad,
      proyecto_id: proyectoId,
      centro_costo: centro,
      neto: redondear(neto),
      iva: redondear(iva),
      otros_impuestos: redondear(otros),
      total,
      moneda,
      tipo_cambio: tipoCambio,
      total_ars: moneda === "USD" ? redondear(total * tipoCambio) : total,
      cuenta_debe: cuentaDebe,
      cuenta_haber: cuentaHaber,
      descripcion: txt(f?.descripcion, 500) || null,
      referencia: txt(f?.referencia) || null,
      origen: "manual",
      estado: "confirmada",
    },
  };
}

/** Lo que se mueve en una caja o banco con una operación: + entra, - sale, en la moneda de la caja. */
export function movimientoCaja(op, caja) {
  if (!caja || op.anulada_at) return 0;
  const importe = caja.moneda === "USD" ? Number(op.total) || 0 : Number(op.total_ars) || 0;
  if (op.cuenta_debe === caja.cuenta) return importe;
  if (op.cuenta_haber === caja.cuenta) return -importe;
  return 0;
}

/**
 * Filtra la lista de Movimientos.
 * @param {any[]} ops
 * @param {{ revisar?: boolean, tipo?: string, caja?: string, proveedor?: string, proyecto?: string, centro?: string, buscar?: string, anuladas?: boolean }} filtros
 * @param {(op: any) => string} [textoDe] texto donde buscar (proveedor, OT, descripción)
 */
export function filtrarOperaciones(ops, filtros = {}, textoDe = () => "") {
  const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = normal(filtros.buscar).trim();
  return (ops || []).filter((op) => {
    if (!filtros.anuladas && op.anulada_at) return false;
    if (filtros.revisar && op.estado !== "para_revisar") return false;
    if (filtros.tipo && op.tipo !== filtros.tipo) return false;
    if (filtros.caja && op.cuenta_debe !== filtros.caja && op.cuenta_haber !== filtros.caja) return false;
    if (filtros.proveedor && String(op.proveedor_id ?? "") !== String(filtros.proveedor)) return false;
    if (filtros.proyecto && String(op.proyecto_id ?? "") !== String(filtros.proyecto)) return false;
    if (filtros.centro && op.centro_costo !== filtros.centro) return false;
    if (q && !normal([op.tipo, op.entidad, op.descripcion, op.referencia, op.cuenta_debe, op.cuenta_haber, textoDe(op)].join(" ")).includes(q)) return false;
    return true;
  });
}
