// app/lib/finanzasGastos.js — Finanzas, parte 5 del plan del 11/11: cargar
// un gasto devengado, con factura o sin factura. Sin migración.
//
// Devengar = anotar el gasto en el mes en que ocurrió, aunque se pague
// después. La operación queda:
//   Debe:  la cuenta del gasto (y el IVA crédito fiscal si hay factura A)
//   Haber: la deuda — Proveedores si hay un proveedor, o la cuenta "a pagar"
//          que se elija (Acreedores Varios, Impuesto IIBB A Pagar…)
// con la fecha del mes del gasto: si la factura es de otro mes (la luz de
// octubre que llega en noviembre), la operación va el último día de ese mes
// (o el primero, si el gasto es de un mes que todavía no empezó).
// Si ya se pagó, se carga también el pago (Debe la deuda / Haber la caja o el
// banco) con el mismo tipo, así en el flujo de caja cae en su renglón.

export const ORIGEN_GASTO = "gasto";
export const LETRAS = ["A", "B", "C", "M", "E", "X"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const CUENTA_PROVEEDORES = /^proveedores$/i;
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, n = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Último día de un mes "AAAA-MM". */
export function finDeMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** La fecha con la que va el gasto al Estado de Resultados. */
export function fechaDevengado(fechaFactura, mes) {
  if (!MES.test(String(mes || "")) || !FECHA.test(String(fechaFactura || ""))) return fechaFactura || null;
  const mesFactura = fechaFactura.slice(0, 7);
  if (mes === mesFactura) return fechaFactura;
  return mes < mesFactura ? finDeMes(mes) : `${mes}-01`;
}

/** "Factura A 0001-00001234" a partir de letra, punto de venta y número. */
export function textoComprobante({ con_factura: conFactura, letra, punto_venta: pv, numero }) {
  if (!conFactura) return numero ? `Sin factura (comprobante ${txt(numero, 40)})` : "Sin factura";
  const p = String(pv || "").replace(/\D/g, "");
  const n = String(numero || "").replace(/\D/g, "");
  const nro = p || n ? `${p ? p.padStart(5, "0").slice(-5) : ""}${p && n ? "-" : ""}${n ? n.padStart(8, "0").slice(-8) : ""}` : "";
  return `Factura ${LETRAS.includes(letra) ? letra : ""}${nro ? ` ${nro}` : ""}`.replace(/\s+/g, " ").trim();
}

/** Las cuentas de deuda que se pueden elegir (pasivo: códigos que empiezan con 02). */
export function cuentasDeuda(cuentas = []) {
  return cuentas.filter((c) => String(c.codigo).startsWith("02") && c.activa !== false);
}

/**
 * Valida el formulario y arma la operación del gasto (y la del pago, si ya se pagó).
 * @param {object} d { tipo, fecha_factura, mes, con_factura, letra, punto_venta, numero, proveedor_id?, entidad?, cuenta_gasto, cuenta_deuda?, neto, iva, otros_impuestos, centro_costo?, proyecto_id?, descripcion?, pagado?, cuenta_caja?, fecha_pago? }
 * @param {{ tipos, cuentas, tesoreria, centros, proveedores, proyectos }} ctx
 * @returns {{ ops: object[], errores: string[] }}
 */
export function operacionesGasto(d = {}, ctx = {}) {
  const { tipos = [], cuentas = [], tesoreria = [], centros = [], proveedores = [], proyectos = [] } = ctx;
  const errores = [];
  const tipo = tipos.find((t) => t.codigo === d.tipo && t.activo !== false);
  if (!tipo) errores.push("Elegí el tipo de gasto.");
  if (!FECHA.test(String(d.fecha_factura || ""))) errores.push(d.con_factura ? "Falta la fecha de la factura." : "Falta la fecha.");
  const mes = MES.test(String(d.mes || "")) ? d.mes : String(d.fecha_factura || "").slice(0, 7);
  const cajas = new Set(tesoreria.map((t) => t.cuenta));
  const codigos = new Set(cuentas.filter((c) => c.activa !== false).map((c) => c.codigo));
  const cuentaProv = cuentas.find((c) => CUENTA_PROVEEDORES.test(String(c.nombre || "").trim()))?.codigo || null;

  const proveedorId = d.proveedor_id ? Number(d.proveedor_id) : null;
  const proveedor = proveedorId ? proveedores.find((p) => Number(p.id) === proveedorId) : null;
  if (proveedorId && !proveedor) errores.push("Ese proveedor no está en la lista.");
  const entidad = proveedor ? null : txt(d.entidad) || null;

  const cuentaGasto = txt(d.cuenta_gasto, 40);
  if (!codigos.has(cuentaGasto)) errores.push("Elegí la cuenta del gasto.");
  else if (cajas.has(cuentaGasto) || cuentaGasto.startsWith("02")) errores.push("La cuenta del gasto no puede ser una caja, un banco ni una deuda.");

  const cuentaDeuda = proveedor ? cuentaProv : txt(d.cuenta_deuda, 40);
  if (proveedor && !cuentaProv) errores.push("Falta la cuenta \"Proveedores\" en el plan de cuentas.");
  if (!proveedor && !cuentasDeuda(cuentas).some((c) => c.codigo === cuentaDeuda)) errores.push("Elegí el proveedor o la cuenta donde queda la deuda (por ejemplo Acreedores Varios).");

  const neto = centavos(d.neto);
  const iva = d.con_factura ? centavos(d.iva) : 0;
  const otros = centavos(d.otros_impuestos);
  if (!(neto > 0) || neto >= 1e13) errores.push("El neto tiene que ser mayor a cero.");
  if (iva < 0 || otros < 0) errores.push("El IVA y las percepciones no pueden ser negativos.");
  if (iva > 0 && !["A", "M"].includes(d.letra)) errores.push("Solo las facturas A (o M) discriminan IVA: en una B o C poné todo en el neto.");
  const total = centavos(neto + iva + otros);

  const centro = txt(d.centro_costo, 60) || null;
  if (centro && !centros.some((c) => c.codigo === centro)) errores.push(`El centro de costo ${centro} no existe.`);
  if (tipo?.pide_cc && !centro) errores.push(`${tipo.nombre || tipo.codigo} pide centro de costo.`);
  const proyectoId = d.proyecto_id ? Number(d.proyecto_id) : null;
  if (proyectoId && !proyectos.some((p) => Number(p.id) === proyectoId)) errores.push("Esa OT no está en la lista.");

  const pagado = Boolean(d.pagado);
  const caja = pagado ? tesoreria.find((t) => t.cuenta === d.cuenta_caja && t.activa !== false) : null;
  if (pagado && !caja) errores.push("Elegí con qué caja o banco se pagó.");
  if (caja && caja.moneda === "USD") errores.push("El pago de un gasto en pesos sale de una caja o banco en pesos.");
  const fechaPago = pagado ? (FECHA.test(String(d.fecha_pago || "")) ? d.fecha_pago : d.fecha_factura) : null;

  if (errores.length) return { ops: [], errores: [...new Set(errores)] };

  const comprobante = textoComprobante(d);
  const fechaFactura = d.fecha_factura;
  const fecha = fechaDevengado(fechaFactura, mes);
  const dma = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}`;
  const descripcion = [
    `${comprobante}${fecha !== fechaFactura ? ` del ${dma(fechaFactura)} (gasto de ${mes.slice(5, 7)}/${mes.slice(0, 4)})` : ""}`,
    txt(d.descripcion, 300),
  ].filter(Boolean).join(" · ").slice(0, 500);
  const comun = { tipo: tipo.codigo, proveedor_id: proveedor ? Number(proveedor.id) : null, entidad, moneda: "ARS", tipo_cambio: null, origen: ORIGEN_GASTO, estado: "confirmada" };
  const devengado = {
    ...comun, fecha, proyecto_id: proyectoId, centro_costo: centro,
    neto, iva, otros_impuestos: otros, total, total_ars: total,
    cuenta_debe: cuentaGasto, cuenta_haber: cuentaDeuda,
    descripcion, referencia: d.con_factura ? comprobante.replace(/^Factura /, "") : txt(d.numero, 60) || null,
  };
  const ops = [devengado];
  if (pagado) {
    ops.push({
      ...comun, fecha: fechaPago, proyecto_id: proyectoId, centro_costo: centro,
      neto: total, iva: 0, otros_impuestos: 0, total, total_ars: total,
      cuenta_debe: cuentaDeuda, cuenta_haber: caja.cuenta,
      descripcion: `Pago de ${comprobante}`.slice(0, 500), referencia: devengado.referencia,
    });
  }
  return { ops, errores: [] };
}
