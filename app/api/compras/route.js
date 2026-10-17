// /api/compras — Proveedores y pedidos de material (Compras, parte 20; ítem
// 41; migración 113).
//
// GET  → { comprador }: si la sesión puede comprar (proveedores, consolidar).
// POST { accion, ... }
//   proveedor_guardar     → alta o edición (comprador)
//   proveedor_baja        → dar de baja o reactivar (comprador)
//   proveedores_importar  → nombres pegados de la planilla; agrega los que faltan (comprador)
//   pedido_crear          → pedido de material (gestión: jefes de taller,
//                           gerencia, dueños, Administración; operarios no)
//   pedido_anular         → el comprador, cualquiera pendiente; quien lo pidió, el suyo pendiente
//   oc_crear              → una OC en borrador por proveedor con los renglones elegidos en
//                           "A comprar"; los pedidos de los jefes pasan a en_oc (comprador; 114)
//   oc_guardar            → moneda, fecha prometida, notas, cantidades y precios; quitar
//                           renglones (en borrador); el pedido quitado vuelve a pendiente
//   oc_enviar             → borrador → enviada
//   oc_anular             → la OC queda anulada y sus pedidos vuelven a pendiente
// Comprador = gerencia o Administración sin división asignada (un supervisor
// de división pide y recibe, pero no compra). Con RLS_RUTAS=on todo va con el
// pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { comprasBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch, sbDelete } from "../../lib/sbHelpers";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { alcanceDe } from "../../lib/alcance";
import { puedePedir, puedeComprar, puedeAnularPedido, formatoCuit } from "../../lib/compras";
import { logger } from "../../lib/logger";

function faltaMigracion(err) {
  const m = String(err?.message);
  return /proveedores|pedidos_compra/.test(m) && /does not exist|42P01|PGRST20[05]|schema cache/.test(m);
}

function faltaMigracionOc(err) {
  const m = String(err?.message);
  return /ordenes_compra|orden_id/.test(m) && /does not exist|42P01|42703|PGRST20[05]|schema cache/.test(m);
}

const soloComprador = () => NextResponse.json({ error: "Los proveedores los maneja Administración" }, { status: 403 });

async function esComprador(sesion) {
  if (sesion.rol === "gerencial") return true;
  if (sesion.rol !== "administrativo") return false;
  return puedeComprar(sesion.rol, await alcanceDe(sesion));
}

async function guardarProveedor(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const fila = {
    nombre: d.nombre.replace(/\s+/g, " "),
    cuit: d.cuit ? formatoCuit(d.cuit) : null,
    contacto: d.contacto,
    whatsapp: d.whatsapp,
    email: d.email,
    plazo_dias: d.plazo_dias,
    condicion_pago: d.condicion_pago,
    notas: d.notas,
    updated_at: new Date().toISOString(),
  };
  try {
    if (d.id) {
      const [p] = (await sbPatch(`proveedores?id=eq.${d.id}&empresa_id=eq.${e}`, fila, opts)) || [];
      if (!p) return NextResponse.json({ error: "No encontré ese proveedor" }, { status: 404 });
      broadcastRefresh(e, "proveedores");
      return NextResponse.json({ ok: true, proveedor: p });
    }
    const [p] = (await sbPost("proveedores", { ...fila, empresa_id: e }, opts)) || [];
    broadcastRefresh(e, "proveedores");
    return NextResponse.json({ ok: true, proveedor: p || fila });
  } catch (err) {
    if (String(err?.message).includes("23505")) {
      return NextResponse.json({ error: `Ya hay un proveedor que se llama ${fila.nombre}` }, { status: 409 });
    }
    throw err;
  }
}

async function bajaProveedor(sesion, { id, activo }) {
  const e = sesion.empresa_id;
  const [p] = (await sbPatch(`proveedores?id=eq.${id}&empresa_id=eq.${e}`, { activo, updated_at: new Date().toISOString() }, { sesion })) || [];
  if (!p) return NextResponse.json({ error: "No encontré ese proveedor" }, { status: 404 });
  broadcastRefresh(e, "proveedores");
  return NextResponse.json({ ok: true, proveedor: p });
}

async function importarProveedores(sesion, nombres) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const existentes = (await sbGet(`proveedores?empresa_id=eq.${e}&select=nombre&limit=5000`, opts)) || [];
  const ya = new Set(existentes.map((p) => String(p.nombre).toLowerCase()));
  const nuevos = [];
  for (const n of nombres) {
    const nombre = n.replace(/\s+/g, " ").trim();
    const clave = nombre.toLowerCase();
    if (!nombre || ya.has(clave)) continue;
    ya.add(clave);
    nuevos.push({ empresa_id: e, nombre });
  }
  if (nuevos.length) await sbPost("proveedores", nuevos, opts);
  broadcastRefresh(e, "proveedores");
  return NextResponse.json({ ok: true, agregados: nuevos.length, ya_estaban: nombres.length - nuevos.length });
}

async function crearPedido(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  if (!puedePedir(sesion.rol)) {
    return NextResponse.json({ error: "Los pedidos de material los hacen los jefes de taller y la oficina" }, { status: 403 });
  }
  let articulo = null;
  if (d.sku) {
    [articulo] = (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=eq.${encodeURIComponent(d.sku)}&select=sku,nombre,unidad,division&limit=1`, opts)) || [];
    if (!articulo) return NextResponse.json({ error: "Ese artículo no está en el stock. Puede que falte sincronizar la planilla." }, { status: 404 });
  }
  let ot = null;
  if (d.ot) {
    const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(d.ot)}&select=ot&limit=1`, opts)) || [];
    if (!proyecto) return NextResponse.json({ error: `No encontré la OT ${d.ot}` }, { status: 404 });
    ot = proyecto.ot;
  }
  const [empleado] = sesion.empleado_id
    ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre,division&limit=1`, { ...opts, silent: true, fallback: [] })) || []
    : [];
  const fila = {
    empresa_id: e,
    sku: articulo?.sku ?? null,
    descripcion: (d.descripcion || articulo?.nombre || articulo?.sku).slice(0, 200),
    unidad: d.unidad || articulo?.unidad || null,
    cantidad: d.cantidad,
    ot,
    para_fecha: d.para_fecha,
    notas: d.notas,
    division: (articulo?.division || empleado?.division || null)?.slice?.(0, 60) ?? null,
    estado: "pendiente",
    empleado_id: sesion.empleado_id || null,
    empleado_nombre: empleado?.nombre ? String(empleado.nombre).slice(0, 120) : null,
  };
  const [creado] = (await sbPost("pedidos_compra", fila, opts)) || [];
  broadcastRefresh(e, "pedidos_compra");
  return NextResponse.json({ ok: true, pedido: creado || fila });
}

async function anularPedido(sesion, id) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const filtro = `pedidos_compra?id=eq.${id}&empresa_id=eq.${e}`;
  const [pedido] = (await sbGet(`${filtro}&select=id,estado,empleado_id&limit=1`, opts)) || [];
  if (!pedido) return NextResponse.json({ error: "No encontré ese pedido" }, { status: 404 });
  if (pedido.estado === "anulado") return NextResponse.json({ ok: true, pedido });
  const comprador = await esComprador(sesion);
  if (!puedeAnularPedido(pedido, { comprador, empleadoId: sesion.empleado_id })) {
    const motivo = pedido.estado !== "pendiente"
      ? "Ese pedido ya está en una orden de compra. Pedile a Administración que lo saque."
      : "Solo podés anular tus pedidos. Pedíselo a Administración.";
    return NextResponse.json({ error: motivo }, { status: 403 });
  }
  const [fila] = (await sbPatch(`${filtro}&estado=eq.pendiente`, { estado: "anulado", anulado_por: sesion.empleado_id || null, anulado_at: new Date().toISOString() }, opts)) || [];
  broadcastRefresh(e, "pedidos_compra");
  return NextResponse.json({ ok: true, pedido: fila || null });
}

/* ─── Órdenes de compra (parte 21) ─────────────────────────────────────── */

const ESTADOS_EDITABLES = ["borrador", "enviada", "recibida_parcial"];

async function leerOrden(sesion, id) {
  const [oc] = (await sbGet(`ordenes_compra?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=*&limit=1`, { sesion })) || [];
  return oc || null;
}
const noEncontreOc = () => NextResponse.json({ error: "No encontré esa orden de compra" }, { status: 404 });

/** Pedidos de la OC (o los indicados) que vuelven a pendiente. */
async function liberarPedidos(sesion, filtro) {
  await sbPatch(`pedidos_compra?empresa_id=eq.${sesion.empresa_id}&${filtro}&estado=eq.en_oc`, { estado: "pendiente", orden_id: null }, { sesion });
}

async function crearOrdenes(sesion, { moneda, lineas }) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const idsProv = [...new Set(lineas.map((l) => l.proveedor_id))];
  const proveedores = (await sbGet(`proveedores?empresa_id=eq.${e}&id=in.(${idsProv.join(",")})&select=id,nombre,activo`, opts)) || [];
  const porId = new Map(proveedores.map((p) => [p.id, p]));
  const falta = idsProv.find((id) => !porId.get(id)?.activo);
  if (falta) return NextResponse.json({ error: "Uno de los proveedores no existe o está dado de baja. Actualizá la lista." }, { status: 409 });

  const idsPedidos = [...new Set(lineas.map((l) => l.pedido_id).filter(Boolean))];
  if (idsPedidos.length) {
    const pedidos = (await sbGet(`pedidos_compra?empresa_id=eq.${e}&id=in.(${idsPedidos.join(",")})&select=id,estado`, opts)) || [];
    if (pedidos.length !== idsPedidos.length || pedidos.some((p) => p.estado !== "pendiente")) {
      return NextResponse.json({ error: "Algún pedido ya no está pendiente (lo anularon o ya está en otra OC). Actualizá la lista." }, { status: 409 });
    }
  }

  const [empleado] = sesion.empleado_id
    ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre&limit=1`, { ...opts, silent: true, fallback: [] })) || []
    : [];
  const [ultima] = (await sbGet(`ordenes_compra?empresa_id=eq.${e}&select=numero&order=numero.desc&limit=1`, opts)) || [];
  let numero = Number(ultima?.numero || 0);

  const creadas = [];
  for (const proveedorId of idsProv) {
    const prov = porId.get(proveedorId);
    let oc = null;
    // Dos personas armando OC a la vez pueden chocar en el número: se reintenta con el siguiente
    for (let intento = 0; intento < 5 && !oc; intento++) {
      numero += 1;
      try {
        [oc] = (await sbPost("ordenes_compra", {
          empresa_id: e, numero, proveedor_id: prov.id, proveedor_nombre: String(prov.nombre).slice(0, 120), moneda, estado: "borrador",
          creada_por: sesion.empleado_id || null, creada_por_nombre: empleado?.nombre ? String(empleado.nombre).slice(0, 120) : null,
        }, opts)) || [];
      } catch (err) {
        if (!String(err?.message).includes("23505")) throw err;
      }
    }
    if (!oc) throw new Error("No se pudo numerar la orden de compra");
    const mias = lineas.filter((l) => l.proveedor_id === proveedorId);
    try {
      await sbPost("ordenes_compra_items", mias.map((l) => ({
        empresa_id: e, orden_id: oc.id, sku: l.sku, descripcion: l.descripcion, unidad: l.unidad,
        cantidad: l.cantidad, precio_unitario: l.precio_unitario, ot: l.ot, pedido_id: l.pedido_id,
      })), opts);
    } catch (err) {
      // Sin renglones la OC no sirve: queda anulada (las OC no se borran)
      await sbPatch(`ordenes_compra?id=eq.${oc.id}&empresa_id=eq.${e}`, { estado: "anulada", anulada_at: new Date().toISOString() }, opts).catch(() => {});
      throw err;
    }
    const pedidos = mias.map((l) => l.pedido_id).filter(Boolean);
    if (pedidos.length) {
      await sbPatch(`pedidos_compra?empresa_id=eq.${e}&id=in.(${pedidos.join(",")})&estado=eq.pendiente`, { estado: "en_oc", orden_id: oc.id }, opts);
    }
    creadas.push({ id: oc.id, numero: oc.numero, proveedor_nombre: oc.proveedor_nombre });
  }
  broadcastRefresh(e, "ordenes_compra");
  broadcastRefresh(e, "pedidos_compra");
  return NextResponse.json({ ok: true, ordenes: creadas });
}

async function guardarOrden(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const oc = await leerOrden(sesion, d.id);
  if (!oc) return noEncontreOc();
  if (!ESTADOS_EDITABLES.includes(oc.estado)) return NextResponse.json({ error: "Esa orden de compra ya está cerrada" }, { status: 409 });
  const cambiaRenglones = Boolean(d.items?.length || d.quitar?.length || (d.moneda !== undefined && d.moneda !== oc.moneda));
  if (cambiaRenglones && oc.estado !== "borrador") {
    return NextResponse.json({ error: "La OC ya se mandó: los renglones, precios y moneda no se cambian. Anulala y armá otra." }, { status: 409 });
  }
  if (d.quitar?.length) {
    const filtro = `ordenes_compra_items?orden_id=eq.${oc.id}&empresa_id=eq.${e}&id=in.(${d.quitar.join(",")})`;
    const quitados = (await sbGet(`${filtro}&select=pedido_id`, opts)) || [];
    await sbDelete(filtro, opts);
    const pedidos = quitados.map((it) => it.pedido_id).filter(Boolean);
    if (pedidos.length) await liberarPedidos(sesion, `orden_id=eq.${oc.id}&id=in.(${pedidos.join(",")})`);
  }
  for (const it of d.items || []) {
    await sbPatch(`ordenes_compra_items?id=eq.${it.id}&orden_id=eq.${oc.id}&empresa_id=eq.${e}`, { cantidad: it.cantidad, precio_unitario: it.precio_unitario }, opts);
  }
  const cambios = { updated_at: new Date().toISOString() };
  if (d.moneda !== undefined) cambios.moneda = d.moneda;
  if (d.fecha_prometida !== undefined) cambios.fecha_prometida = d.fecha_prometida || null;
  if (d.notas !== undefined) cambios.notas = d.notas;
  const [fila] = (await sbPatch(`ordenes_compra?id=eq.${oc.id}&empresa_id=eq.${e}`, cambios, opts)) || [];
  broadcastRefresh(e, "ordenes_compra");
  return NextResponse.json({ ok: true, orden: fila || { ...oc, ...cambios } });
}

async function enviarOrden(sesion, id) {
  const e = sesion.empresa_id;
  const oc = await leerOrden(sesion, id);
  if (!oc) return noEncontreOc();
  if (oc.estado !== "borrador") return NextResponse.json({ ok: true, orden: oc });
  const [hay] = (await sbGet(`ordenes_compra_items?orden_id=eq.${oc.id}&empresa_id=eq.${e}&select=id&limit=1`, { sesion })) || [];
  if (!hay) return NextResponse.json({ error: "La orden de compra no tiene renglones" }, { status: 409 });
  const ahora = new Date().toISOString();
  const [fila] = (await sbPatch(`ordenes_compra?id=eq.${oc.id}&empresa_id=eq.${e}&estado=eq.borrador`, { estado: "enviada", enviada_at: ahora, updated_at: ahora }, { sesion })) || [];
  broadcastRefresh(e, "ordenes_compra");
  return NextResponse.json({ ok: true, orden: fila || { ...oc, estado: "enviada", enviada_at: ahora } });
}

async function anularOrden(sesion, id) {
  const e = sesion.empresa_id;
  const oc = await leerOrden(sesion, id);
  if (!oc) return noEncontreOc();
  if (oc.estado === "anulada") return NextResponse.json({ ok: true, orden: oc });
  if (!["borrador", "enviada"].includes(oc.estado)) {
    return NextResponse.json({ error: "Esa orden de compra ya tiene material recibido: no se puede anular" }, { status: 409 });
  }
  const ahora = new Date().toISOString();
  const [fila] = (await sbPatch(`ordenes_compra?id=eq.${oc.id}&empresa_id=eq.${e}&estado=in.(borrador,enviada)`, { estado: "anulada", anulada_at: ahora, updated_at: ahora }, { sesion })) || [];
  await liberarPedidos(sesion, `orden_id=eq.${oc.id}`);
  broadcastRefresh(e, "ordenes_compra");
  broadcastRefresh(e, "pedidos_compra");
  return NextResponse.json({ ok: true, orden: fila || { ...oc, estado: "anulada" } });
}

async function chequeos(sesion) {
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  // Compras va con las OT, como Stock, hasta que sea un módulo que se venda aparte
  return requireModulo(sesion.empresa_id, "proyectos");
}

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    return NextResponse.json({ comprador: await esComprador(sesion), puede_pedir: puedePedir(sesion.rol) });
  } catch (err) {
    logger.error("[compras] GET error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(comprasBody, raw);
    if (parsed.response) return parsed.response;
    const bloqueo = await chequeos(sesion);
    if (bloqueo) return bloqueo;
    const d = parsed.data;
    try {
      if (d.accion === "pedido_crear") return await crearPedido(sesion, d);
      if (d.accion === "pedido_anular") return await anularPedido(sesion, d.id);
      if (!(await esComprador(sesion))) return soloComprador();
      if (d.accion === "proveedor_guardar") return await guardarProveedor(sesion, d);
      if (d.accion === "proveedor_baja") return await bajaProveedor(sesion, d);
      if (d.accion === "proveedores_importar") return await importarProveedores(sesion, d.nombres);
      if (d.accion === "oc_crear") return await crearOrdenes(sesion, d);
      if (d.accion === "oc_guardar") return await guardarOrden(sesion, d);
      if (d.accion === "oc_enviar") return await enviarOrden(sesion, d.id);
      return await anularOrden(sesion, d.id);
    } catch (err) {
      if (faltaMigracionOc(err)) {
        return NextResponse.json({ error: "Para las órdenes de compra falta correr la migración 114 en Supabase." }, { status: 409 });
      }
      if (faltaMigracion(err)) {
        return NextResponse.json({ error: "Para usar Compras falta correr la migración 113 en Supabase." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    logger.error("[compras] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
