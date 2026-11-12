// app/lib/costoReal.js — Costo previsto y real de una OT (auditoría 12/11,
// parte 3; sin migración).
//
// Antes el costo de la OT era solo lo que pide el MRP × el precio, más las
// horas de planta. Ahora suma todo lo que la OT gastó de verdad y lo pone al
// lado de lo previsto:
//
//   Renglón                          Previsto                     Real
//   Materiales del MRP               necesidades × precio fijo    igual
//   Retirado de más / fuera del MRP  —                            lo retirado que pasa lo necesario × precio
//   Compras para la OT (sin stock)   —                            renglones de OC con esa OT y sin artículo
//   Mano de obra en planta           horas presupuestadas × hora  horas reales × hora
//   Retrabajo                        —                            horas de retrabajo × hora
//   Instalación                      días × personas × 8 h × hora días con reporte × personas × 8 h × hora
//   Gastos de Finanzas con la OT     —                            fletes, viáticos, terceros… (neto, sin IVA)
//
// Para no sumar dos veces: las facturas de OC y las sueltas no entran como
// gasto (su material ya está en el stock o en las compras sin stock), ni los
// sueldos (están en el costo de la hora). Todo sin IVA y en pesos.
import { precioEnPesos } from "./ordenesCompra";

/** Horas de una jornada de instalación. */
export const JORNADA_HORAS = 8;

/** Orígenes de Finanzas que no son un gasto de la OT (o ya se cuentan por otro lado). */
export const ORIGENES_NO_GASTO = new Set([
  "factura_oc", "factura_suelta", "liquidacion", "pago_sueldo", "venta_ot", "entrega_ot", "cobro", "orden_pago",
  "cheque", "banco", "mi_caja_pase", "saldo_inicial", "compensacion", "plazo_fijo", "libro",
]);

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Lo retirado del stock que pasa lo que pedía el MRP, y lo retirado que el
 * MRP no tenía. Si se retiró menos (o no se anotó), cuenta lo del MRP.
 * @param {{ necesarios: { sku, cantidad }[], movimientos: object[], fijos: object[], articulos?: object[] }} d
 */
export function materialesFuera({ necesarios = [], movimientos = [], fijos = [], articulos = [] }) {
  const nec = new Map();
  for (const n of necesarios) nec.set(n.sku, (nec.get(n.sku) || 0) + (Number(n.cantidad) || 0));
  const ret = new Map();
  const nombres = new Map();
  for (const m of movimientos) {
    if (m.anulado || !m.sku) continue;
    const signo = m.tipo === "consumo" ? 1 : m.tipo === "devolucion" ? -1 : 0;
    if (!signo) continue;
    ret.set(m.sku, (ret.get(m.sku) || 0) + signo * (Number(m.cantidad) || 0));
    if (m.nombre && !nombres.has(m.sku)) nombres.set(m.sku, m.nombre);
  }
  const art = new Map(articulos.map((a) => [a.sku, a]));
  const fijo = new Map(fijos.map((f) => [f.sku, f]));
  let total = 0;
  let sinPrecio = 0;
  const filas = [];
  for (const [sku, retirado] of ret) {
    const necesario = nec.get(sku) || 0;
    const cantidad = r3(retirado - necesario);
    if (cantidad <= 0) continue;
    const p = fijo.get(sku);
    const precio = p ? num(p.precio_ars) : null;
    const subtotal = precio != null ? r2(cantidad * precio) : null;
    if (subtotal == null) sinPrecio++;
    else total += subtotal;
    filas.push({
      sku, nombre: art.get(sku)?.nombre || nombres.get(sku) || null, unidad: art.get(sku)?.unidad || null,
      necesario: r3(necesario), retirado: r3(retirado), cantidad, fueraMrp: !nec.has(sku), precio, subtotal,
    });
  }
  filas.sort((a, b) => (b.subtotal || 0) - (a.subtotal || 0));
  return { filas, total: r2(total), sinPrecio };
}

/**
 * Lo comprado con una OC para esta OT que no pasa por el stock (renglones sin
 * artículo): lo facturado, o lo que llegó si todavía no hay factura.
 * @param {object[]} items ordenes_compra_items de la OT con sku vacío
 * @param {object[]} ordenes ordenes_compra de esos renglones
 */
export function comprasDirectas(items = [], ordenes = []) {
  const oc = new Map(ordenes.map((o) => [Number(o.id), o]));
  let total = 0;
  let sinPrecio = 0;
  const filas = [];
  for (const it of items) {
    if (it.sku) continue;
    const o = oc.get(Number(it.orden_id));
    if (!o || o.estado === "anulada") continue;
    const cantidad = num(it.cantidad_facturada) ?? num(it.cantidad_recibida) ?? 0;
    if (cantidad <= 0) continue;
    const precio = precioEnPesos(it.precio_unitario, o.moneda, o.tipo_cambio);
    const subtotal = precio != null ? r2(cantidad * precio) : null;
    if (subtotal == null) sinPrecio++;
    else total += subtotal;
    filas.push({ descripcion: it.descripcion || "", unidad: it.unidad || null, cantidad: r3(cantidad), oc_numero: o.numero ?? null, proveedor: o.proveedor_nombre || null, precio, subtotal });
  }
  filas.sort((a, b) => (b.subtotal || 0) - (a.subtotal || 0));
  return { filas, total: r2(total), sinPrecio };
}

/** ¿La cuenta es de costo o gasto (estado de resultados)? */
export function esCuentaDeGasto(c) {
  if (!c) return false;
  const l = String(c.linea_eerr || "").toUpperCase();
  if (l) return l.startsWith("CMV") || l.startsWith("GO");
  // Sin clasificar: las de resultado con saldo deudor
  return /RESULTADO|EGRESO|GASTO|COSTO/i.test(String(c.rubro || "")) && c.naturaleza !== "H";
}

/**
 * Gastos de Finanzas cargados con esta OT (fletes, viáticos, colocadores,
 * terceros): el neto en pesos de cada operación que va a una cuenta de gasto.
 * @param {object[]} ops fin_operaciones con proyecto_id de la OT
 * @param {object[]} cuentas fin_cuentas (codigo, linea_eerr, rubro, naturaleza)
 */
export function gastosOt(ops = [], cuentas = []) {
  const cuenta = new Map(cuentas.map((c) => [String(c.codigo), c]));
  let total = 0;
  let paraRevisar = 0;
  const filas = [];
  for (const op of ops) {
    if (op.anulada_at || ORIGENES_NO_GASTO.has(op.origen)) continue;
    const debe = esCuentaDeGasto(cuenta.get(String(op.cuenta_debe)));
    const haber = esCuentaDeGasto(cuenta.get(String(op.cuenta_haber)));
    if (debe === haber) continue;
    const tc = op.moneda === "USD" ? num(op.tipo_cambio) : 1;
    if (tc == null) continue;
    const importe = r2((debe ? 1 : -1) * (Number(op.neto) || 0) * tc);
    if (!importe) continue;
    total += importe;
    if (op.estado === "para_revisar") paraRevisar++;
    filas.push({ id: op.id, fecha: op.fecha || null, tipo: op.tipo || "", descripcion: op.descripcion || "", entidad: op.entidad || null, importe, paraRevisar: op.estado === "para_revisar" });
  }
  filas.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  return { filas, total: r2(total), paraRevisar };
}

/** Horas de retrabajo de la OT (los anulados no cuentan). */
export function horasRetrabajo(retrabajos = []) {
  return r1(retrabajos.filter((r) => !r.anulado_at).reduce((s, r) => s + (Number(r.horas) || 0), 0));
}

/**
 * Horas-persona de instalación.
 *   Previstas: días de instalación × personas de la OT × 8 h.
 *   Reales: días con reporte de instalación × personas (las de la OT o, si no
 *   tiene, las que reportaron o colocaron módulos ese día) × 8 h.
 * @param {object} proyecto (dias_instalacion, personas_instalacion)
 * @param {{ reportes?: object[], colocados?: object[] }} d reportes_instalacion y modulos_instalados de la OT
 */
export function horasInstalacion(proyecto, { reportes = [], colocados = [] } = {}) {
  const dias = num(proyecto?.dias_instalacion);
  const personas = num(proyecto?.personas_instalacion);
  const previstas = dias != null ? r1(dias * (personas || 1) * JORNADA_HORAS) : null;
  const porDia = new Map();
  const anotar = (fecha, quien) => {
    if (!fecha) return;
    if (!porDia.has(fecha)) porDia.set(fecha, new Set());
    if (quien) porDia.get(fecha).add(quien);
  };
  for (const r of reportes) anotar(r.fecha, r.empleado_id);
  for (const m of colocados) anotar(String(m.created_at || "").slice(0, 10) || null, m.instalado_por);
  let reales = 0;
  for (const quienes of porDia.values()) reales += (personas || Math.max(1, quienes.size)) * JORNADA_HORAS;
  return { previstas, reales: porDia.size ? r1(reales) : null, dias: porDia.size, diasPrevistos: dias, personas };
}

const por = (horas, ch) => (horas != null && ch != null ? r2(horas * ch) : null);

/**
 * Previsto contra real, renglón por renglón.
 * @param {{ materiales: object, fuera?: object, compras?: object, gastos?: object, horas?: object|null, retrabajo?: number, instalacion?: object|null, costoHora?: number|null }} d
 *   materiales: costoMaterialesOt; horas: tablaHoras (total.presupuestadas / total.reales)
 * @returns {{ renglones: object[], previsto: number, real: number, diferencia: number, pct: number|null, avisos: string[] }}
 */
export function costoPrevistoReal({ materiales, fuera = null, compras = null, gastos = null, horas = null, retrabajo = 0, instalacion = null, costoHora = null }) {
  const ch = num(costoHora);
  const hp = num(horas?.total?.presupuestadas?.valor);
  const hr = num(horas?.total?.reales?.valor);
  const mat = r2(Number(materiales?.total) || 0);
  const renglones = [
    { id: "materiales", nombre: "Materiales del MRP", previsto: mat, real: mat },
    { id: "fuera", nombre: "Retirado de más o fuera del MRP", previsto: 0, real: fuera?.total || 0 },
    { id: "compras", nombre: "Compras para la OT (sin stock)", previsto: 0, real: compras?.total || 0 },
    { id: "planta", nombre: "Mano de obra en planta", previsto: por(hp, ch), real: por(hr, ch), horasPrevistas: hp, horasReales: hr },
    { id: "retrabajo", nombre: "Retrabajo", previsto: 0, real: por(retrabajo || 0, ch) ?? (retrabajo ? null : 0), horasReales: retrabajo || 0 },
    { id: "instalacion", nombre: "Instalación", previsto: por(instalacion?.previstas ?? null, ch), real: por(instalacion?.reales ?? null, ch), horasPrevistas: instalacion?.previstas ?? null, horasReales: instalacion?.reales ?? null },
    { id: "gastos", nombre: "Gastos de Finanzas con esta OT", previsto: 0, real: gastos?.total || 0 },
  ].map((f) => ({ ...f, diferencia: f.previsto != null && f.real != null ? r2(f.real - f.previsto) : null }));
  const suma = (k) => r2(renglones.reduce((s, f) => s + (f[k] || 0), 0));
  const previsto = suma("previsto");
  const real = suma("real");
  const avisos = [];
  const sinPrecio = (Number(materiales?.sinPrecio) || 0) + (fuera?.sinPrecio || 0) + (compras?.sinPrecio || 0);
  if (sinPrecio) avisos.push(sinPrecio === 1 ? "1 renglón sin precio (no suma)" : `${sinPrecio} renglones sin precio (no suman)`);
  if (ch == null) avisos.push("Sin costo de la hora: la mano de obra, el retrabajo y la instalación no suman");
  if (hr == null) avisos.push("Sin horas reales de planta");
  if (instalacion && instalacion.diasPrevistos == null) avisos.push("La OT no tiene días de instalación previstos");
  if (gastos?.paraRevisar) avisos.push(gastos.paraRevisar === 1 ? "1 gasto de Finanzas para revisar" : `${gastos.paraRevisar} gastos de Finanzas para revisar`);
  return { renglones, previsto, real, diferencia: r2(real - previsto), pct: previsto > 0 ? Math.round((real / previsto) * 100) : null, avisos };
}

/** Los tres números de la constancia a partir del previsto y real. */
export function resumenReal(c) {
  const de = (ids) => r2(c.renglones.filter((f) => ids.includes(f.id)).reduce((s, f) => s + (f.real || 0), 0));
  return { materiales: de(["materiales", "fuera", "compras"]), mano_obra: de(["planta", "retrabajo", "instalacion"]), gastos: de(["gastos"]), total: c.real };
}
