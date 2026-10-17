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
// Comprador = gerencia o Administración sin división asignada (un supervisor
// de división pide y recibe, pero no compra). Con RLS_RUTAS=on todo va con el
// pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { comprasBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch } from "../../lib/sbHelpers";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { alcanceDe } from "../../lib/alcance";
import { puedePedir, puedeComprar, puedeAnularPedido, formatoCuit } from "../../lib/compras";
import { logger } from "../../lib/logger";

function faltaMigracion(err) {
  const m = String(err?.message);
  return /proveedores|pedidos_compra/.test(m) && /does not exist|42P01|PGRST20[05]|schema cache/.test(m);
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
      return await importarProveedores(sesion, d.nombres);
    } catch (err) {
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
