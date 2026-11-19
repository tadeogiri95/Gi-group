// app/lib/finanzasPagoJunto.js — Devengar y pagar (o cobrar) en un solo
// cuadro (pedido de Tadeo 19/11, punto 14 del plan). Sin migración.
//
// En Nueva operación, si la operación no toca ninguna caja y deja una deuda
// (el haber es un pasivo, por ejemplo Trabajos de terceros / Proveedores) o
// un crédito (el debe es Deudores por Ventas o un crédito), aparece "Lo pagué
// ahora" (o "Lo cobré ahora"): con la caja y la fecha se carga también la
// segunda operación, Proveedores / Caja (o Caja / Deudores). Así la cuenta
// corriente muestra las dos y el flujo de caja cae en el mismo tipo.
//
// En Mi caja, un gasto con proveedor se anota igual: el gasto contra
// Proveedores y, si se pagó ahora (casilla tildada, como viene), el pago desde
// la caja. Sin tildar queda solo la deuda, para pagarla después desde Pagos.
import { cuentasDeudores } from "./finanzasClientes";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CUENTA_PROVEEDORES = /^proveedores$/i;

/** ¿Es un pasivo (02…)? */
const esPasivo = (c) => String(c || "").startsWith("02");
/** ¿Es un crédito a cobrar (Deudores por Ventas o 01.01.02…)? */
const esCredito = (c, deudores) => deudores.has(c) || String(c || "").startsWith("01.01.02");

/**
 * Qué queda pendiente después de esta operación: "pagar" (una deuda en el
 * haber), "cobrar" (un crédito en el debe) o null (toca una caja, o no deja
 * nada pendiente).
 * @returns {{ lado: "pagar"|"cobrar", cuenta: string } | null}
 */
export function pendienteDe(op, { tesoreria = [], cuentas = [] } = {}) {
  if (!op?.cuenta_debe || !op?.cuenta_haber) return null;
  const cajas = new Set(tesoreria.map((t) => t.cuenta));
  if (cajas.has(op.cuenta_debe) || cajas.has(op.cuenta_haber)) return null;
  if (esPasivo(op.cuenta_haber) && !esPasivo(op.cuenta_debe)) return { lado: "pagar", cuenta: op.cuenta_haber };
  if (esCredito(op.cuenta_debe, cuentasDeudores(cuentas)) && !esCredito(op.cuenta_haber, cuentasDeudores(cuentas))) return { lado: "cobrar", cuenta: op.cuenta_debe };
  return null;
}

/**
 * La segunda operación: el pago (Debe la deuda / Haber la caja) o el cobro
 * (Debe la caja / Haber el crédito), por el total, con el mismo tipo, la
 * misma persona, OT y centro de costo.
 * @param {object} op la operación ya validada
 * @param {{ cuenta_caja?: string, fecha?: string }} pago
 * @returns {{ op?: object, error?: string }}
 */
export function operacionDelPago(op, pago = {}, { tesoreria = [], cuentas = [] } = {}) {
  const pendiente = pendienteDe(op, { tesoreria, cuentas });
  if (!pendiente) return { error: "Esta operación ya toca una caja o no deja nada para pagar o cobrar." };
  const caja = tesoreria.find((t) => t.cuenta === pago.cuenta_caja && t.activa !== false);
  const verbo = pendiente.lado === "pagar" ? "pagó" : "cobró";
  if (!caja) return { error: `Elegí con qué caja o banco se ${verbo}.` };
  if ((caja.moneda || "ARS") !== (op.moneda || "ARS")) return { error: `La caja tiene que ser en ${op.moneda === "USD" ? "dólares" : "pesos"}, como la operación.` };
  const fecha = pago.fecha ? String(pago.fecha) : op.fecha;
  if (!FECHA.test(fecha)) return { error: `La fecha en que se ${verbo} no es válida.` };
  if (fecha < op.fecha) return { error: `La fecha en que se ${verbo} no puede ser antes que la de la operación.` };
  const total = centavos(op.total);
  const pagar = pendiente.lado === "pagar";
  const quien = op.entidad || "";
  return {
    op: {
      fecha, tipo: op.tipo, proveedor_id: op.proveedor_id ?? null, entidad: op.entidad ?? null,
      ...(op.cliente_id ? { cliente_id: op.cliente_id } : {}),
      proyecto_id: op.proyecto_id ?? null, centro_costo: op.centro_costo ?? null,
      neto: total, iva: 0, otros_impuestos: 0, total, moneda: op.moneda || "ARS", tipo_cambio: op.tipo_cambio ?? null,
      total_ars: op.total_ars ?? total,
      cuenta_debe: pagar ? pendiente.cuenta : caja.cuenta,
      cuenta_haber: pagar ? caja.cuenta : pendiente.cuenta,
      descripcion: `${pagar ? "Pago" : "Cobro"}${quien ? ` a ${quien}` : ""}${op.descripcion ? ` · ${op.descripcion}` : ""}`.replace(/^Cobro a /, "Cobro de ").slice(0, 500),
      referencia: op.referencia ?? null,
      origen: op.origen || "manual", estado: op.estado || "confirmada",
    },
  };
}

/** La cuenta Proveedores del plan de cuentas (para Mi caja), o "". */
export function cuentaProveedores(cuentas = []) {
  return cuentas.find((c) => CUENTA_PROVEEDORES.test(String(c.nombre || "").trim()) && c.activa !== false)?.codigo || "";
}

/**
 * Mi caja: el gasto de un proveedor pasa por su cuenta corriente. De la
 * operación de Mi caja (Debe gasto / Haber caja) salen dos: el gasto contra
 * Proveedores y, si se pagó ahora, el pago desde la caja. Sin pagar, solo la
 * deuda. Sin proveedor, o sin la cuenta Proveedores, queda como estaba.
 * @returns {object[]}
 */
export function miCajaConProveedor(op, { cuentas = [], pagado = true } = {}) {
  const prov = cuentaProveedores(cuentas);
  if (!op?.proveedor_id || !prov || esPasivo(op.cuenta_debe) || op.cuenta_debe === prov) return [op];
  const caja = op.cuenta_haber;
  const devengado = { ...op, cuenta_haber: prov };
  if (!pagado) return [{ ...devengado, comprobante_url: op.comprobante_url ?? null }];
  const pago = {
    ...op, cuenta_debe: prov, cuenta_haber: caja, neto: centavos(op.total), iva: 0, otros_impuestos: 0,
    descripcion: `Pago · ${op.descripcion || ""}`.replace(/ · $/, "").slice(0, 500),
  };
  return [devengado, pago];
}
