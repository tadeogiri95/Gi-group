// app/lib/comprasRecepcion.js — Recibir mercadería de una orden de compra
// (Compras, parte 22; migraciones 115 y 130). Sale de /api/compras para que
// también la use Logística (parte 5, migración 207): cuando el chofer retira
// una OC en un viaje de abastecimiento, queda recibida en Compras.
// Solo servidor.
import { NextResponse } from "next/server";
import { sbGet, sbRpc } from "./sbHelpers";
import { broadcastRefresh } from "./broadcast";
import { ESTADOS_OC_RECIBIBLE, ocACotizar, precioEnPesos, precioEnStock } from "./ordenesCompra";
import { avisoIngresoRepetido, buscarIngresoRepetido } from "./stockIngresos";

export async function leerOrden(sesion, id) {
  const [oc] = (await sbGet(`ordenes_compra?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=*&limit=1`, { sesion })) || [];
  return oc || null;
}
export const noEncontreOc = () => NextResponse.json({ error: "No encontré esa orden de compra" }, { status: 404 });


export const redondear3 = (n) => Math.round(Number(n) * 1000) / 1000;

export async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

/**
 * Lo que devuelven las funciones de la migración 130 cuando no se pudo (otra
 * persona cambió la OC entre que la pantalla la leyó y se guardó).
 */
export function rechazoTransaccion(r) {
  if (r?.tipo === "sin_orden") return noEncontreOc();
  if (r?.tipo === "sin_recepcion") return NextResponse.json({ error: "No encontré esa recepción" }, { status: 404 });
  if (r?.tipo === "renglon") return NextResponse.json({ error: "Un renglón no es de esta orden de compra. Actualizá la pantalla." }, { status: 409 });
  if (r?.tipo === "a_cotizar") return NextResponse.json({ error: "Esa orden todavía está a cotizar: elegí el proveedor primero" }, { status: 409 });
  if (r?.estado === "recibida") return NextResponse.json({ error: "Esa orden de compra ya se recibió completa" }, { status: 409 });
  if (r?.estado === "anulada") return NextResponse.json({ error: "Esa orden de compra está anulada" }, { status: 409 });
  return NextResponse.json({ error: "Esa orden de compra cambió recién. Actualizá la pantalla." }, { status: 409 });
}

/** Ingreso de stock de un renglón de la OC (como los de la parte 14). */
function filaIngreso(sesion, { oc, item, articulo, comprobante, empleadoNombre }) {
  return {
    sku: item.sku,
    nombre: (articulo?.nombre || item.descripcion || "").slice(0, 200) || null,
    unidad: articulo?.unidad ?? item.unidad_stock ?? item.unidad ?? null,
    division: articulo?.division ?? null,
    ot: item.ot || null,
    proveedor: String(oc.proveedor_nombre).slice(0, 120),
    comprobante: String(comprobante).slice(0, 60),
    // Por unidad del stock: el precio de la caja ÷ lo que trae (152); la cantidad la convierte la base
    precio_unitario: precioEnPesos(precioEnStock(item.precio_unitario, item), oc.moneda, oc.tipo_cambio),
    notas: `OC N° ${oc.numero}`,
    empleado_id: sesion.empleado_id || null,
    legajo: Number.isInteger(sesion.legajo) ? sesion.legajo : null,
    empleado_nombre: empleadoNombre,
  };
}

/**
 * Recibe mercadería de una OC con un remito (Compras parte 22, migración 130):
 * recepción, ingresos de stock, renglones y estados, todo junto en la base.
 * Los permisos los chequea quien llama: /api/compras (jefes y oficina) y
 * Logística (el chofer que retiró la OC en su viaje; parte 5, 207).
 * d = { orden_id, remito, foto_url, notas, items: [{ item_id, cantidad }], forzar }
 */
export async function recibirOrdenCompra(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const oc = await leerOrden(sesion, d.orden_id);
  if (!oc) return noEncontreOc();
  if (!ESTADOS_OC_RECIBIBLE.includes(oc.estado)) {
    return NextResponse.json({ error: oc.estado === "recibida" ? "Esa orden de compra ya se recibió completa" : "Esa orden de compra está anulada" }, { status: 409 });
  }
  if (ocACotizar(oc)) return NextResponse.json({ error: "Esa orden todavía está a cotizar: elegí el proveedor primero" }, { status: 409 });
  const items = (await sbGet(`ordenes_compra_items?orden_id=eq.${oc.id}&empresa_id=eq.${e}&select=*&order=id.asc`, opts)) || [];
  const porId = new Map(items.map((it) => [it.id, it]));
  const llegan = new Map();
  for (const l of d.items) {
    if (!porId.has(l.item_id)) return NextResponse.json({ error: "Un renglón no es de esta orden de compra. Actualizá la pantalla." }, { status: 409 });
    llegan.set(l.item_id, redondear3((llegan.get(l.item_id) || 0) + l.cantidad));
  }

  // Una entrega, una sola vez (auditoría 12/11, parte 2): si ese remito (o la
  // factura de la OC) ya entró al stock por otro lado, avisa; con forzar sigue
  if (!d.forzar) {
    const proveedor = oc.proveedor_nombre;
    const repetido = await buscarIngresoRepetido(sbGet, e, { proveedor, comprobante: d.remito }, opts)
      || (oc.factura_numero ? await buscarIngresoRepetido(sbGet, e, { proveedor, comprobante: oc.factura_numero, excluirNotas: `OC N° ${oc.numero}` }, opts) : null);
    if (repetido) return NextResponse.json({ error: `${avisoIngresoRepetido(repetido)} Si es otra entrega, revisá el número; si es la misma, no la recibas de nuevo.`, repetido: true }, { status: 409 });
  }

  // Nombre, unidad y división del ingreso de stock salen de la planilla
  const empleadoNombre = await nombreEmpleado(sesion);
  const skus = [...new Set([...llegan.keys()].map((id) => porId.get(id).sku).filter(Boolean))];
  const articulos = skus.length
    ? (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=in.(${skus.map((x) => `"${x}"`).join(",")})&select=sku,nombre,unidad,division`, { ...opts, silent: true, fallback: [] })) || []
    : [];
  const artPorSku = new Map(articulos.map((a) => [a.sku, a]));
  const lineas = [...llegan.entries()].map(([itemId, cantidad]) => {
    const item = porId.get(itemId);
    return {
      item_id: itemId,
      cantidad,
      // Solo los renglones que son artículos de la planilla entran al stock
      ingreso: item.sku ? filaIngreso(sesion, { oc, item, articulo: artPorSku.get(item.sku), comprobante: oc.factura_numero || d.remito, empleadoNombre }) : null,
    };
  });

  // Recepción, ingresos, renglones, cantidad recibida y estados: todo junto (130)
  const r = await sbRpc("compras_recibir", {
    p_empresa: e,
    p_orden: oc.id,
    p_recepcion: { remito: d.remito, foto_url: d.foto_url, notas: d.notas, empleado_id: sesion.empleado_id || null, empleado_nombre: empleadoNombre },
    p_lineas: lineas,
  });
  if (!r?.ok) return rechazoTransaccion(r);
  broadcastRefresh(e, "ordenes_compra");
  broadcastRefresh(e, "pedidos_compra");
  if (r.ingresos) broadcastRefresh(e, "movimientos_stock");
  return NextResponse.json({ ok: true, recepcion: r.recepcion, estado: r.estado, ingresos: r.ingresos });
}
