// app/lib/finanzasFlujoAdelante.js — Lo que viene en el flujo de caja, con lo
// que ya se sabe (auditoría del 12/11, parte 11). Sin migración.
//
// Antes "Lo que viene" tenía solo cheques, órdenes de pago, sueldos e
// intereses. Ahora suma:
//   - Facturas de proveedores a pagar: lo que se le debe a cada proveedor
//     (sus compras sin pagar, las más viejas primero) menos lo que ya está en
//     una orden de pago sin pagar. Vence en la fecha de la
//     factura más los días de su "Condición de pago" (Compras → Proveedores:
//     "30 días", "30/60" usa el primero, "contado" o vacío = ese día).
//   - Órdenes de compra abiertas (enviadas o recibidas en parte, sin factura):
//     lo pedido con IVA. Se paga cuando llega (fecha prometida, o el envío
//     más el plazo de entrega del proveedor) más los días de pago. Las OC en
//     dólares no entran (no hay tipo de cambio todavía) y se avisa.
//   - Cobros de clientes por OT: lo que falta cobrar de cada OT (venta menos
//     cobros). Se espera para la entrega de la OT (si ya se entregó o pasó la
//     fecha, en la primera semana). Lo que se debe sin OT o sin fecha va en
//     "más adelante".
// Lo vencido va siempre en la primera semana, como en el resto del flujo.
import { cuentasProveedores, claveDe, movimientosProveedor, pendientesProveedor } from "./finanzasProveedores";
import { cuentasDeudores, efectoCliente } from "./finanzasClientes";
import { textoOt } from "./nombreOt";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const sumarDias = (fecha, n) => { const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (Number(n) || 0)); return d.toISOString().slice(0, 10); };
const dm = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "");
const IVA_DEFECTO = 21;
/** La entrega de la OT (finanzasVentas.ORIGEN_ENTREGA; acá sin importar el lado del servidor). */
const ORIGEN_ENTREGA = "entrega_ot";

/** "30 días" → 30; "30/60/90" → 30; "contado", "efectivo" o vacío → 0. */
export function diasDePago(condicion) {
  const t = String(condicion ?? "").toLowerCase();
  const n = /(\d{1,3})/.exec(t);
  if (!n) return 0;
  return Math.min(365, Number(n[1]));
}

/**
 * Lo que se le debe a cada proveedor, por factura, con su vencimiento.
 * @returns {{ fecha: string, importe: number, texto: string }[]}
 */
export function pagosAProveedores({ ops = [], cuentas = [], proveedores = [], ordenes = [], hoy }) {
  const cuentasProv = cuentasProveedores(cuentas);
  if (!cuentasProv.size) return [];
  const prov = new Map(proveedores.map((p) => [`p${p.id}`, p]));
  // Lo que ya está en una orden de pago no se cuenta dos veces
  const enOrden = new Map();
  for (const o of ordenes) {
    if (!["borrador", "para_aprobar", "aprobada", "rechazada"].includes(o.estado) || !o.proveedor_id) continue;
    enOrden.set(`p${o.proveedor_id}`, (enOrden.get(`p${o.proveedor_id}`) || 0) + (Number(o.total) || 0));
  }
  // Agrupadas por proveedor una sola vez (el libro puede tener cientos de miles de operaciones)
  const porClave = new Map();
  for (const o of ops) {
    if (o.anulada_at || o.estado === "para_revisar" || !(cuentasProv.has(o.cuenta_haber) || cuentasProv.has(o.cuenta_debe))) continue;
    const k = claveDe(o);
    if (!k) continue;
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k).push(o);
  }
  const out = [];
  for (const [k, suyas] of porClave) {
    const movs = movimientosProveedor(suyas, k, cuentasProv);
    let resta = enOrden.get(k) || 0;
    const p = prov.get(k);
    const dias = diasDePago(p?.condicion_pago);
    const nombre = p?.nombre || movs[0]?.op?.entidad || "Proveedor";
    for (const c of pendientesProveedor(movs, hoy)) {
      const usa = Math.min(c.falta, resta);
      resta = centavos(resta - usa);
      const falta = centavos(c.falta - usa);
      if (falta < 0.01 || !FECHA.test(String(c.op.fecha || ""))) continue;
      const vence = sumarDias(c.op.fecha, dias);
      out.push({ fecha: vence, importe: falta, texto: `${nombre}${c.op.referencia ? ` · ${c.op.referencia}` : ""} · vence ${dm(vence)}` });
    }
  }
  return out;
}

/**
 * Las OC abiertas sin factura: lo que se va a pagar cuando lleguen.
 * @returns {{ pagos: { fecha, importe, texto }[], en_dolares: number }}
 */
export function pagosDeOcAbiertas({ ocs = [], items = [], proveedores = [], hoy }) {
  const prov = new Map(proveedores.map((p) => [Number(p.id), p]));
  const porOc = new Map();
  for (const it of items) {
    const arr = porOc.get(Number(it.orden_id)) || [];
    arr.push(it);
    porOc.set(Number(it.orden_id), arr);
  }
  const pagos = [];
  let enDolares = 0;
  for (const oc of ocs) {
    if (!["enviada", "recibida_parcial"].includes(oc.estado) || oc.anulada_at) continue;
    if (String(oc.factura_numero || "").trim() || oc.factura_fecha) continue;
    if (oc.moneda === "USD") { enDolares += 1; continue; }
    const total = (porOc.get(Number(oc.id)) || []).reduce((s, it) => {
      const neto = (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0);
      const iva = it.iva_alicuota == null ? IVA_DEFECTO : Number(it.iva_alicuota) || 0;
      return s + neto * (1 + iva / 100);
    }, 0);
    if (!(total >= 0.01)) continue;
    const p = prov.get(Number(oc.proveedor_id));
    const enviada = String(oc.enviada_at || oc.created_at || "").slice(0, 10);
    const llega = FECHA.test(String(oc.fecha_prometida || "")) ? oc.fecha_prometida : FECHA.test(enviada) ? sumarDias(enviada, p?.plazo_dias || 0) : hoy;
    const paga = sumarDias(llega, diasDePago(p?.condicion_pago));
    pagos.push({ fecha: paga, importe: centavos(total), texto: `OC N° ${oc.numero} · ${oc.proveedor_nombre || p?.nombre || "Proveedor"} · llega ${dm(llega)}, se paga ${dm(paga)}` });
  }
  return { pagos, en_dolares: enDolares };
}

/**
 * Lo que falta cobrar de cada OT, para su entrega.
 * @returns {{ cobros: { fecha: string|null, importe: number, texto: string }[] }} fecha null = más adelante
 */
export function cobrosDeOts({ ops = [], cuentas = [], proyectos = [], hoy }) {
  const cuentasDeu = cuentasDeudores(cuentas);
  if (!cuentasDeu.size) return { cobros: [] };
  const ots = new Map(proyectos.map((p) => [Number(p.id), p]));
  const falta = new Map();
  const entregada = new Map();
  let sinOt = 0;
  for (const op of ops) {
    if (op.anulada_at || op.estado === "para_revisar") continue;
    if (op.origen === ORIGEN_ENTREGA && op.proyecto_id) entregada.set(Number(op.proyecto_id), op.fecha);
    const ef = efectoCliente(op, cuentasDeu);
    if (!ef) continue;
    if (!op.proyecto_id) { sinOt += ef; continue; }
    falta.set(Number(op.proyecto_id), (falta.get(Number(op.proyecto_id)) || 0) + ef);
  }
  const cobros = [];
  for (const [id, f] of falta) {
    const importe = centavos(f);
    if (importe < 0.01) continue;
    const p = ots.get(id);
    const nombre = p ? textoOt(p) : `OT ${id}`;
    const ent = entregada.get(id);
    if (ent) { cobros.push({ fecha: ent < hoy ? hoy : ent, importe, texto: `${nombre} · entregada el ${dm(ent)}` }); continue; }
    const fe = FECHA.test(String(p?.fecha_entrega || "")) ? p.fecha_entrega : null;
    cobros.push({ fecha: fe ? (fe < hoy ? hoy : fe) : null, importe, texto: `${nombre}${fe ? ` · entrega ${dm(fe)}` : " · sin fecha de entrega"}` });
  }
  if (centavos(sinOt) >= 0.01) cobros.push({ fecha: null, importe: centavos(sinOt), texto: "Deudas de clientes sin OT (saldos de antes)" });
  return { cobros };
}
