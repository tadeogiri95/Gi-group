// /api/compras — Proveedores y pedidos de material (Compras, parte 20; ítem
// 41; migración 113).
//
// GET  → { comprador }: si la sesión puede comprar (proveedores, consolidar).
// POST { accion, ... }
//   proveedor_guardar     → alta o edición (comprador)
//   proveedor_baja        → dar de baja o reactivar (comprador)
//   proveedores_importar  → nombres pegados de la planilla; agrega los que faltan (comprador)
//   proveedores_unir      → el repetido pasa al que queda con todo lo suyo (Dueño o Supervisor; 183)
//                           (proveedor_guardar no deja crear otro con el mismo CUIT o nombre,
//                           y pregunta si hay uno parecido: es_otro = true para seguir)
//   pedido_crear          → pedido de material (gestión: jefes de taller,
//                           gerencia, dueños, Administración; operarios no)
//   pedidos_crear         → varios pedidos de una vez, pegados de la hoja INVENTARIO
//                           (un pedido por artículo; misma OT, fecha y observación)
//   pedido_anular         → el comprador, cualquiera pendiente; quien lo pidió, el suyo pendiente
//   pedido_editar         → corregir un pedido pendiente (mismos permisos que anular); queda
//                           registro de quién, cuándo y qué cambió (121)
//   oc_crear              → una OC en borrador por proveedor con los renglones elegidos en
//                           "A comprar"; los pedidos de los jefes pasan a en_oc (comprador; 114)
//                           (la nota de cada pedido pasa a la observación del renglón; 120)
//                           Los renglones sin proveedor van juntos a una orden "A cotizar"
//                           (borrador sin proveedor; 125)
//   oc_cotizacion_pedir   → anota a qué proveedores se les pidió cotización de una orden
//                           "A cotizar" (comprador; 125)
//   oc_cotizacion_guardar → lo que contestó un proveedor: total sin IVA, plazo y nota
//   oc_cotizacion_quitar  → saca un proveedor de la lista
//   oc_adjudicar          → la orden "A cotizar" pasa a ser del proveedor elegido y
//                           sigue como cualquier borrador
//   oc_guardar            → moneda, fecha prometida, notas, cantidades, precios y
//                           observaciones; quitar renglones (en borrador); el pedido
//                           quitado vuelve a pendiente
//                           Cada renglón puede ir en otra unidad de compra (cajas,
//                           rollos) con cuántas unidades de stock trae cada una;
//                           al recibir entra al stock convertido (152)
//   oc_enviar             → borrador → enviada
//   oc_anular             → la OC queda anulada y sus pedidos vuelven a pendiente
//   oc_cerrar_faltantes   → una OC recibida en parte se cierra con motivo: lo que no llegó
//                           no va a venir. Sale de las OC abiertas (planilla) y lo que faltó
//                           de cada pedido vuelve a pendiente en "A comprar" (comprador; 123)
//   recepcion_crear       → lo que llegó con un remito (gestión: jefes de taller y
//                           Administración); cada renglón con SKU entra como ingreso de
//                           stock; la OC pasa a recibida en parte o recibida (115)
//   recepcion_anular      → la recepción y sus ingresos quedan anulados (comprador)
//   oc_factura            → N° y fecha de factura, tipo de cambio, otros impuestos y
//                           por renglón cantidad, precio sin IVA e IVA % (122); los
//                           ingresos con otro precio se reemplazan (comprador)
//   oc_otra_factura_guardar → otra factura de la OC, de otro proveedor o una segunda
//                           (173): proveedor, N°, fecha, renglones; no toca el stock
//   oc_otra_factura_anular  → la anula (no se borra) y su compra en Finanzas también
// Comprador = gerencia o Administración sin división asignada (un supervisor
// de división pide y recibe, pero no compra). Con RLS_RUTAS=on todo va con el
// pase del usuario ({ sesion }), salvo recibir, anular una recepción y la
// factura: van todo o nada en una función de la base (130, service_role)
// después de chequear permisos y la OC con el pase del usuario.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { comprasBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch, sbDelete, sbRpc } from "../../lib/sbHelpers";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan } from "../../lib/planEnforcement";
import { requireModuloSesion } from "../../lib/accesosServidor";
import { puedePedir, puedeComprar, puedeAnularPedido, puedeEditarPedido, cambiosPedido, formatoCuit } from "../../lib/compras";
import { ESTADOS_OC_CERRABLE, ESTADOS_OC_RECIBIBLE, NOMBRE_A_COTIZAR, ocACotizar, pedidosAlCerrar, precioEnPesos, precioEnStock } from "../../lib/ordenesCompra";
import { logger } from "../../lib/logger";
import { sincronizarCompra } from "../../lib/finanzasCompras";
import { buscarFacturaRepetida } from "../../lib/facturaUnicaServidor";
import { avisoFacturaRepetida } from "../../lib/facturaUnica";
import { avisoIngresoRepetido, buscarIngresoRepetido } from "../../lib/stockIngresos";
import { datosAgendaDeProveedor, moverCuentaProveedor, moverParProveedor, proveedorCorto, proveedorRepetido, sugerirUniones } from "../../lib/proveedoresUnicos";
import { clavePersona, cuitLimpio } from "../../lib/finanzasPersonas";
import { CLAVE_CUENTAS_PROV } from "../../lib/finanzasProveedores";
import { CLAVE_UNIFICADOS, leerPares } from "../../lib/finanzasUnificados";
import { comoDueno } from "../../lib/alcance";

function faltaMigracion(err) {
  const m = String(err?.message);
  return /proveedores|pedidos_compra/.test(m) && /does not exist|42P01|PGRST20[05]|schema cache/.test(m);
}

function faltaMigracionEdicion(err) {
  const m = String(err?.message);
  return /pedidos_compra_cambios|editado_por|editado_at/.test(m) && /does not exist|42P01|42703|PGRST20[45]|schema cache/.test(m);
}

function faltaMigracionOc(err) {
  const m = String(err?.message);
  return /ordenes_compra|orden_id/.test(m) && /does not exist|42P01|42703|PGRST20[05]|schema cache/.test(m);
}

function faltaMigracionObservacion(err) {
  const m = String(err?.message);
  return /observacion/.test(m) && /does not exist|42703|PGRST204|schema cache/.test(m);
}

function faltaMigracionCierre(err) {
  const m = String(err?.message);
  return (/cerrada_motivo|cerrada_por|cerrada_at|faltante_de/.test(m) && /does not exist|42703|PGRST204|schema cache/.test(m))
    || (/ordenes_compra_estado_check/.test(m) && /23514|violates/.test(m));
}

function faltaMigracionUnidad(err) {
  const m = String(err?.message);
  return /\bfactor\b|unidad_stock/.test(m) && /does not exist|42703|PGRST204|schema cache/.test(m);
}

/** Columnas de la unidad de compra (152): solo si el renglón va en otra unidad que la del stock. */
function columnasUnidad(l) {
  const factor = Number(l.factor) > 0 ? Number(l.factor) : 1;
  return factor !== 1 || l.unidad_stock ? { factor, unidad_stock: l.unidad_stock || null } : {};
}

function faltaMigracionCotizaciones(err) {
  const m = String(err?.message);
  return /ordenes_compra_cotizaciones/.test(m) && /does not exist|42P01|42703|PGRST20[05]|schema cache/.test(m);
}

function faltaMigracionFactura(err) {
  const m = String(err?.message);
  return /cantidad_facturada|iva_alicuota|factura_otros_impuestos/.test(m) && /does not exist|42703|PGRST204|schema cache/.test(m);
}

function faltaMigracionTransacciones(err) {
  const m = String(err?.message);
  return /compras_(recibir|anular_recepcion|factura)/.test(m) && /PGRST202|42883|Could not find the function/.test(m);
}

function faltaMigracionRecepcion(err) {
  const m = String(err?.message);
  return /recepciones_compra|factura_numero|factura_fecha|tipo_cambio/.test(m) && /does not exist|42P01|42703|PGRST20[05]|schema cache/.test(m);
}

const FALTA_183 = "Para unir proveedores repetidos falta correr la migración 183 en Supabase.";

const soloComprador = () => NextResponse.json({ error: "Los proveedores los maneja Administración" }, { status: 403 });

async function esComprador(sesion) {
  return puedeComprar(sesion.rol);
}

/** Los proveedores de la empresa para buscar repetidos (con unido_a si ya corrió la 183). */
async function proveedoresDe(sesion) {
  const e = sesion.empresa_id;
  const base = `proveedores?empresa_id=eq.${e}&order=id.asc&limit=10000&select=id,nombre,cuit,contacto,whatsapp,email,plazo_dias,condicion_pago,activo`;
  const conUnido = await sbGet(`${base},unido_a`, { sesion, silent: true, fallback: null });
  return conUnido || (await sbGet(base, { sesion })) || [];
}

/** La agenda (fin_personas) sigue al proveedor corregido en Compras; sin la 180 no hace nada. */
async function agendaSigueAlProveedor(sesion, p) {
  const datos = datosAgendaDeProveedor(p);
  if (!p?.id || !Object.keys(datos).length) return;
  await sbPatch(`fin_personas?empresa_id=eq.${sesion.empresa_id}&proveedor_id=eq.${p.id}`, { ...datos, updated_at: new Date().toISOString() }, { sesion, silent: true });
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
  // ¿Ya está? Mismo CUIT o el mismo nombre escrito distinto: no se crea otro (183)
  const { igual, parecidos } = proveedorRepetido(fila, await proveedoresDe(sesion), d.id);
  if (igual) {
    const como = cuitLimpio(fila.cuit) && cuitLimpio(fila.cuit) === cuitLimpio(igual.cuit) ? `con el CUIT ${igual.cuit}` : "con ese nombre";
    return NextResponse.json({
      error: `Ya está ${igual.nombre} ${como}${igual.activo === false ? " (dado de baja: reactivalo)" : ""}. Si son el mismo, unilos.`,
      tipo: "repetido", igual: proveedorCorto(igual),
    }, { status: 409 });
  }
  if (parecidos.length && !d.es_otro) {
    return NextResponse.json({ error: "Hay proveedores con un nombre parecido", tipo: "parecidos", parecidos: parecidos.map(proveedorCorto) }, { status: 409 });
  }
  try {
    if (d.id) {
      const [p] = (await sbPatch(`proveedores?id=eq.${d.id}&empresa_id=eq.${e}`, fila, opts)) || [];
      if (!p) return NextResponse.json({ error: "No encontré ese proveedor" }, { status: 404 });
      await agendaSigueAlProveedor(sesion, p);
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

/** Lee un valor de config_sistema (o null). */
async function leerConfig(e, clave) {
  const [r] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${clave}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  return r?.valor ?? null;
}

/**
 * Une un proveedor repetido al que queda (183): todo lo del repetido pasa al
 * que queda en una transacción de la base; después, la cuenta del proveedor y
 * el par cliente-proveedor de config_sistema. Solo Dueño o Supervisor.
 */
async function unirProveedores(sesion, d) {
  if (!(await comoDueno(sesion))) return NextResponse.json({ error: "Unir proveedores lo hacen el Dueño o el Supervisor" }, { status: 403 });
  const e = sesion.empresa_id;
  let r;
  try {
    r = await sbRpc("compras_unir_proveedores", { p_empresa: e, p_queda: d.queda, p_sale: d.sale });
  } catch (err) {
    if (/compras_unir_proveedores/.test(String(err?.message)) && /PGRST202|42883|Could not find the function/.test(String(err?.message))) {
      return NextResponse.json({ error: FALTA_183 }, { status: 409 });
    }
    throw err;
  }
  if (!r?.ok) {
    const textos = { mismo: "Elegí dos proveedores distintos", no_existe: "No encontré uno de los dos proveedores", ya_unido: "Ese proveedor ya está unido a otro" };
    return NextResponse.json({ error: textos[r?.tipo] || "No se pudo unir" }, { status: r?.tipo === "no_existe" ? 404 : 409 });
  }
  // La cuenta del proveedor y el par cliente-proveedor (config_sistema)
  const cuentas = await leerConfig(e, CLAVE_CUENTAS_PROV);
  if (cuentas?.cuentas && `p${d.sale}` in cuentas.cuentas) {
    const valor = { ...cuentas, cuentas: moverCuentaProveedor(cuentas.cuentas, d.queda, d.sale), actualizado_at: new Date().toISOString() };
    await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_CUENTAS_PROV}`, { valor }, { silent: true });
  }
  const unificados = await leerConfig(e, CLAVE_UNIFICADOS);
  const pares = leerPares(unificados);
  if (pares.some((p) => p.proveedor_id === d.sale)) {
    const valor = { ...unificados, pares: moverParProveedor(pares, d.queda, d.sale) };
    await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_UNIFICADOS}`, { valor }, { silent: true });
  }
  broadcastRefresh(e, "proveedores");
  broadcastRefresh(e, "ordenes_compra");
  broadcastRefresh(e, "finanzas");
  return NextResponse.json({ ok: true, movidos: r.movidos || 0 });
}

/** Proveedores que parecen el mismo (mismo CUIT o nombre), para unirlos. */
async function repetidos(sesion) {
  const lista = await proveedoresDe(sesion);
  const migracion = lista.length === 0 || "unido_a" in lista[0];
  return { ok: true, repetidos: sugerirUniones(lista), ...(migracion ? {} : { falta_migracion: FALTA_183 }) };
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
  // "MADERAS CORDOBA SA" y "Maderas Córdoba S.A." son el mismo (183)
  const clave = (n) => clavePersona(n) || String(n).toLowerCase();
  const ya = new Set(existentes.map((p) => clave(p.nombre)));
  const nuevos = [];
  for (const n of nombres) {
    const nombre = n.replace(/\s+/g, " ").trim();
    const k = clave(nombre);
    if (!nombre || ya.has(k)) continue;
    ya.add(k);
    nuevos.push({ empresa_id: e, nombre });
  }
  if (nuevos.length) await sbPost("proveedores", nuevos, opts);
  broadcastRefresh(e, "proveedores");
  return NextResponse.json({ ok: true, agregados: nuevos.length, ya_estaban: nombres.length - nuevos.length });
}

/** Artículo del catálogo y OT de un pedido nuevo o corregido: { articulo, datos } o { error }. */
async function datosDelPedido(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  let articulo = null;
  if (d.sku) {
    [articulo] = (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=eq.${encodeURIComponent(d.sku)}&select=sku,nombre,unidad,division&limit=1`, opts)) || [];
    if (!articulo) return { error: NextResponse.json({ error: "Ese artículo no está en el stock. Puede que falte sincronizar la planilla." }, { status: 404 }) };
  }
  let ot = null;
  if (d.ot) {
    const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(d.ot)}&select=ot&limit=1`, opts)) || [];
    if (!proyecto) return { error: NextResponse.json({ error: `No encontré la OT ${d.ot}` }, { status: 404 }) };
    ot = proyecto.ot;
  }
  return {
    articulo,
    datos: {
      sku: articulo?.sku ?? null,
      descripcion: (d.descripcion || articulo?.nombre || articulo?.sku).slice(0, 200),
      unidad: d.unidad || articulo?.unidad || null,
      cantidad: d.cantidad,
      ot,
      para_fecha: d.para_fecha,
      notas: d.notas,
    },
  };
}

async function crearPedido(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  if (!puedePedir(sesion.rol)) {
    return NextResponse.json({ error: "Los pedidos de material los hacen los jefes de taller y la oficina" }, { status: 403 });
  }
  const { articulo, datos, error } = await datosDelPedido(sesion, d);
  if (error) return error;
  const [empleado] = sesion.empleado_id
    ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre,division&limit=1`, { ...opts, silent: true, fallback: [] })) || []
    : [];
  const fila = {
    empresa_id: e,
    ...datos,
    division: (articulo?.division || empleado?.division || null)?.slice?.(0, 60) ?? null,
    estado: "pendiente",
    empleado_id: sesion.empleado_id || null,
    empleado_nombre: empleado?.nombre ? String(empleado.nombre).slice(0, 120) : null,
  };
  const [creado] = (await sbPost("pedidos_compra", fila, opts)) || [];
  broadcastRefresh(e, "pedidos_compra");
  return NextResponse.json({ ok: true, pedido: creado || fila });
}

/** Varios pedidos de una vez (pegados de la planilla): todos del catálogo, mismos datos comunes. */
async function crearPedidos(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  if (!puedePedir(sesion.rol)) {
    return NextResponse.json({ error: "Los pedidos de material los hacen los jefes de taller y la oficina" }, { status: 403 });
  }
  const cantidades = new Map();
  for (const it of d.items) cantidades.set(it.sku, Math.round(((cantidades.get(it.sku) || 0) + it.cantidad) * 1000) / 1000);
  const skus = [...cantidades.keys()];
  const lista = skus.map((s) => `"${s}"`).join(",");
  const articulos = (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=in.(${encodeURIComponent(lista)})&select=sku,nombre,unidad,division`, opts)) || [];
  const porSku = new Map(articulos.map((a) => [a.sku, a]));
  const faltan = skus.filter((s) => !porSku.has(s));
  if (faltan.length) {
    return NextResponse.json({ error: `No están en el stock: ${faltan.slice(0, 5).join(", ")}${faltan.length > 5 ? "…" : ""}. Puede que falte sincronizar la planilla.` }, { status: 404 });
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
  const filas = skus.map((sku) => {
    const a = porSku.get(sku);
    return {
      empresa_id: e,
      sku,
      descripcion: String(a.nombre || sku).slice(0, 200),
      unidad: a.unidad || null,
      cantidad: cantidades.get(sku),
      ot,
      para_fecha: d.para_fecha,
      notas: d.notas,
      division: (a.division || empleado?.division || null)?.slice?.(0, 60) ?? null,
      estado: "pendiente",
      empleado_id: sesion.empleado_id || null,
      empleado_nombre: empleado?.nombre ? String(empleado.nombre).slice(0, 120) : null,
    };
  });
  const creados = (await sbPost("pedidos_compra", filas, opts)) || [];
  broadcastRefresh(e, "pedidos_compra");
  return NextResponse.json({ ok: true, creados: creados.length || filas.length });
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

/** Corrige un pedido pendiente y deja registro de quién, cuándo y qué cambió (121). */
async function editarPedido(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const filtro = `pedidos_compra?id=eq.${d.id}&empresa_id=eq.${e}`;
  const [pedido] = (await sbGet(`${filtro}&select=*&limit=1`, opts)) || [];
  if (!pedido) return NextResponse.json({ error: "No encontré ese pedido" }, { status: 404 });
  const comprador = await esComprador(sesion);
  if (!puedeEditarPedido(pedido, { comprador, empleadoId: sesion.empleado_id })) {
    const motivo = pedido.estado === "en_oc"
      ? "Ese pedido ya está en una orden de compra: corregilo desde la orden."
      : pedido.estado !== "pendiente"
        ? "Ese pedido ya no está pendiente: no se puede corregir."
        : "Solo podés corregir tus pedidos. Pedíselo a Administración.";
    return NextResponse.json({ error: motivo }, { status: 403 });
  }
  const { datos, error } = await datosDelPedido(sesion, d);
  if (error) return error;
  const cambios = cambiosPedido(pedido, datos);
  if (!cambios.length) return NextResponse.json({ ok: true, pedido, cambios: [] });
  const quien = await nombreEmpleado(sesion);
  const ahora = new Date().toISOString();
  const [fila] = (await sbPatch(`${filtro}&estado=eq.pendiente`, {
    ...datos, editado_por: sesion.empleado_id || null, editado_por_nombre: quien, editado_at: ahora,
  }, opts)) || [];
  if (!fila) return NextResponse.json({ error: "Ese pedido ya no está pendiente (lo anularon o lo pasaron a una orden de compra). Actualizá la lista." }, { status: 409 });
  await sbPost("pedidos_compra_cambios", {
    empresa_id: e, pedido_id: pedido.id, cambios, empleado_id: sesion.empleado_id || null, empleado_nombre: quien, created_at: ahora,
  }, opts);
  broadcastRefresh(e, "pedidos_compra");
  return NextResponse.json({ ok: true, pedido: fila, cambios });
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
  // null = la orden "A cotizar" con los renglones sin proveedor (125); va última
  const idsConProv = [...new Set(lineas.map((l) => l.proveedor_id).filter(Boolean))];
  const idsProv = lineas.some((l) => !l.proveedor_id) ? [...idsConProv, null] : idsConProv;
  const proveedores = idsConProv.length
    ? (await sbGet(`proveedores?empresa_id=eq.${e}&id=in.(${idsConProv.join(",")})&select=id,nombre,activo`, opts)) || []
    : [];
  const porId = new Map(proveedores.map((p) => [p.id, p]));
  porId.set(null, { id: null, nombre: NOMBRE_A_COTIZAR, activo: true });
  const falta = idsProv.find((id) => !porId.get(id)?.activo);
  if (falta) return NextResponse.json({ error: "Uno de los proveedores no existe o está dado de baja. Actualizá la lista." }, { status: 409 });

  const idsPedidos = [...new Set(lineas.map((l) => l.pedido_id).filter(Boolean))];
  const notaPedido = new Map();
  if (idsPedidos.length) {
    const pedidos = (await sbGet(`pedidos_compra?empresa_id=eq.${e}&id=in.(${idsPedidos.join(",")})&select=id,estado,notas`, opts)) || [];
    if (pedidos.length !== idsPedidos.length || pedidos.some((p) => p.estado !== "pendiente")) {
      return NextResponse.json({ error: "Algún pedido ya no está pendiente (lo anularon o ya está en otra OC). Actualizá la lista." }, { status: 409 });
    }
    for (const p of pedidos) if (p.notas) notaPedido.set(p.id, String(p.notas).slice(0, 300));
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
    const mias = lineas.filter((l) => (l.proveedor_id ?? null) === proveedorId);
    // La nota del pedido sale en la OC como observación del renglón (120)
    const filas = mias.map((l) => ({
      empresa_id: e, orden_id: oc.id, sku: l.sku, descripcion: l.descripcion, unidad: l.unidad,
      cantidad: l.cantidad, precio_unitario: l.precio_unitario, ot: l.ot, pedido_id: l.pedido_id,
      ...columnasUnidad(l),
      ...(notaPedido.get(l.pedido_id) ? { observacion: notaPedido.get(l.pedido_id) } : {}),
    }));
    try {
      try {
        await sbPost("ordenes_compra_items", filas, opts);
      } catch (err) {
        // Sin la migración 120 la OC se arma igual, sin observaciones
        if (!faltaMigracionObservacion(err)) throw err;
        await sbPost("ordenes_compra_items", filas.map(({ observacion, ...f }) => f), opts);
      }
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
    const cambiosItem = { cantidad: it.cantidad, precio_unitario: it.precio_unitario };
    if (it.observacion !== undefined) cambiosItem.observacion = it.observacion;
    // Otra unidad de compra (152): la pantalla ya convirtió cantidad y precio
    if (it.factor !== undefined) Object.assign(cambiosItem, { unidad: it.unidad ?? null, factor: it.factor, unidad_stock: it.unidad_stock ?? null });
    await sbPatch(`ordenes_compra_items?id=eq.${it.id}&orden_id=eq.${oc.id}&empresa_id=eq.${e}`, cambiosItem, opts);
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
  if (ocACotizar(oc)) return NextResponse.json({ error: "Elegí el proveedor antes de mandar la orden de compra" }, { status: 409 });
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
  // Si tenía factura, la compra en Finanzas se anula (172)
  let anuladas = (await sincronizarCompra(e, { origen: "factura_oc", id: oc.id })).accion === "anulada";
  // Y las otras facturas de la orden (173), si las había
  const otras = (await sbGet(`ordenes_compra_facturas?orden_id=eq.${oc.id}&empresa_id=eq.${e}&anulada_at=is.null&select=id`, { sesion, silent: true, fallback: [] })) || [];
  for (const f of otras) if ((await sincronizarCompra(e, { origen: "factura_oc_otra", id: f.id })).accion === "anulada") anuladas = true;
  if (anuladas) broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, orden: fila || { ...oc, estado: "anulada" } });
}

/**
 * Cierra una OC recibida en parte: lo que falta no se compró y no va a
 * llegar (123). Lo que faltó de cada pedido de un jefe vuelve a "A comprar".
 */
async function cerrarOrdenConFaltantes(sesion, { id, motivo }) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const oc = await leerOrden(sesion, id);
  if (!oc) return noEncontreOc();
  if (oc.estado === "cerrada_faltantes") return NextResponse.json({ ok: true, orden: oc });
  if (!ESTADOS_OC_CERRABLE.includes(oc.estado)) {
    const error = ["borrador", "enviada"].includes(oc.estado)
      ? "Todavía no llegó nada de esa orden: si no se va a comprar, anulala."
      : oc.estado === "recibida" ? "Esa orden de compra ya se recibió completa" : "Esa orden de compra está anulada";
    return NextResponse.json({ error }, { status: 409 });
  }
  const items = (await sbGet(`ordenes_compra_items?orden_id=eq.${oc.id}&empresa_id=eq.${e}&select=*`, opts)) || [];
  const quien = await nombreEmpleado(sesion);
  const ahora = new Date().toISOString();
  const [fila] = (await sbPatch(`ordenes_compra?id=eq.${oc.id}&empresa_id=eq.${e}&estado=in.(${ESTADOS_OC_CERRABLE.join(",")})`, {
    estado: "cerrada_faltantes", cerrada_motivo: motivo, cerrada_por: sesion.empleado_id || null, cerrada_por_nombre: quien, cerrada_at: ahora, updated_at: ahora,
  }, opts)) || [];
  if (!fila) return NextResponse.json({ error: "Esa orden de compra cambió mientras la cerrabas. Actualizá la pantalla." }, { status: 409 });

  const { completos, volver, nuevos } = pedidosAlCerrar(items);
  const faltanteDe = `OC N° ${oc.numero} · ${oc.proveedor_nombre}`.slice(0, 160);
  if (volver.length) {
    await sbPatch(`pedidos_compra?empresa_id=eq.${e}&id=in.(${volver.join(",")})&estado=eq.en_oc`, { estado: "pendiente", orden_id: null, faltante_de: faltanteDe }, opts);
  }
  const recibidos = [...completos, ...nuevos.map((n) => n.pedido_id)];
  if (recibidos.length) await sbPatch(`pedidos_compra?empresa_id=eq.${e}&id=in.(${recibidos.join(",")})&estado=eq.en_oc`, { estado: "recibido" }, opts);
  if (nuevos.length) {
    const originales = (await sbGet(`pedidos_compra?empresa_id=eq.${e}&id=in.(${nuevos.map((n) => n.pedido_id).join(",")})&select=*`, opts)) || [];
    const porId = new Map(originales.map((p) => [p.id, p]));
    const filas = nuevos.filter((n) => porId.has(n.pedido_id)).map((n) => {
      const p = porId.get(n.pedido_id);
      return {
        empresa_id: e, sku: p.sku, descripcion: p.descripcion, unidad: p.unidad, cantidad: n.cantidad, ot: p.ot, para_fecha: p.para_fecha,
        notas: p.notas, division: p.division, estado: "pendiente", empleado_id: p.empleado_id, empleado_nombre: p.empleado_nombre, faltante_de: faltanteDe,
      };
    });
    if (filas.length) await sbPost("pedidos_compra", filas, opts);
  }
  broadcastRefresh(e, "ordenes_compra");
  broadcastRefresh(e, "pedidos_compra");
  return NextResponse.json({ ok: true, orden: fila, vuelven: volver.length + nuevos.length });
}

/* ─── Recepción con remito y factura (parte 22) ────────────────────────── */

const redondear3 = (n) => Math.round(Number(n) * 1000) / 1000;

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

/**
 * Lo que devuelven las funciones de la migración 130 cuando no se pudo (otra
 * persona cambió la OC entre que la pantalla la leyó y se guardó).
 */
function rechazoTransaccion(r) {
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

async function crearRecepcion(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  if (!puedePedir(sesion.rol)) {
    return NextResponse.json({ error: "La mercadería la reciben los jefes de taller y la oficina" }, { status: 403 });
  }
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

async function anularRecepcion(sesion, id) {
  const e = sesion.empresa_id;
  // Ingresos anulados, cantidades y estado de la OC: todo junto (130)
  const r = await sbRpc("compras_anular_recepcion", { p_empresa: e, p_recepcion: id, p_empleado: sesion.empleado_id || null });
  if (!r?.ok) return rechazoTransaccion(r);
  broadcastRefresh(e, "ordenes_compra");
  broadcastRefresh(e, "pedidos_compra");
  if (r.movimientos) broadcastRefresh(e, "movimientos_stock");
  return NextResponse.json({ ok: true, recepcion: r.recepcion, estado: r.estado });
}

async function facturaOrden(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const oc = await leerOrden(sesion, d.id);
  if (!oc) return noEncontreOc();
  if (oc.estado === "anulada") return NextResponse.json({ error: "Esa orden de compra está anulada" }, { status: 409 });
  const items = (await sbGet(`ordenes_compra_items?orden_id=eq.${oc.id}&empresa_id=eq.${e}&select=*`, opts)) || [];
  const porId = new Map(items.map((it) => [it.id, it]));
  const numeroO = (v) => (v === null || v === undefined ? null : Number(v));
  // Solo lo que cambió: sin la migración 122 esas columnas no existen
  const renglones = [];
  for (const r of d.renglones || []) {
    const it = porId.get(r.item_id);
    if (!it) return NextResponse.json({ error: "Un renglón no es de esta orden de compra. Actualizá la pantalla." }, { status: 409 });
    const patch = {};
    for (const campo of ["precio_unitario", "cantidad_facturada", "iva_alicuota"]) {
      if (r[campo] === undefined || numeroO(it[campo]) === r[campo]) continue;
      patch[campo] = r[campo];
    }
    if (Object.keys(patch).length) renglones.push({ item_id: it.id, ...patch });
  }
  // Una factura, una sola vez (auditoría 12/11, parte 1): si el número cambió
  // y ya está cargado en otro lado, avisa; con forzar se guarda igual
  if (d.factura_numero && !d.forzar && String(d.factura_numero).trim() !== String(oc.factura_numero || "").trim()) {
    const repetida = await buscarFacturaRepetida(e, { numero: d.factura_numero, proveedor_id: oc.proveedor_id, proveedor_nombre: oc.proveedor_nombre }, { oc: oc.id });
    if (repetida) return NextResponse.json({ error: avisoFacturaRepetida(repetida), repetida: true }, { status: 409 });
  }
  const cabecera = { factura_numero: d.factura_numero, factura_fecha: d.factura_fecha, tipo_cambio: oc.moneda === "USD" ? d.tipo_cambio : null };
  if (d.otros_impuestos !== undefined && numeroO(oc.factura_otros_impuestos) !== d.otros_impuestos) cabecera.factura_otros_impuestos = d.otros_impuestos;

  // Renglones, cabecera y reemplazo de los ingresos con otro precio o
  // comprobante (la planilla trae los nuevos y borra los anulados): todo junto (130)
  const r = await sbRpc("compras_factura", {
    p_empresa: e,
    p_orden: oc.id,
    p_renglones: renglones,
    p_cabecera: cabecera,
    p_quien: { empleado_id: sesion.empleado_id || null, legajo: Number.isInteger(sesion.legajo) ? sesion.legajo : null, empleado_nombre: await nombreEmpleado(sesion) },
  });
  if (!r?.ok) return rechazoTransaccion(r);
  broadcastRefresh(e, "ordenes_compra");
  if (r.reemplazados) broadcastRefresh(e, "movimientos_stock");
  // La compra en Finanzas (172): se crea o se corrige sola
  if ((await sincronizarCompra(e, { origen: "factura_oc", id: oc.id })).accion !== "omitida") broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, orden: r.orden, reemplazados: r.reemplazados });
}

/* ─── Otras facturas de una OC, de otro proveedor (173) ─────────────────── */

function faltaMigracionOtrasFacturas(err) {
  const m = String(err?.message);
  return /ordenes_compra_facturas/.test(m) && /does not exist|42P01|42703|PGRST20[05]|schema cache/.test(m);
}

/**
 * Guarda (nueva o corregida) otra factura de la OC: la de un proveedor que
 * facturó parte de la orden, o una segunda factura. Cada una es su propia
 * compra en Finanzas. No toca el stock: el costo sigue saliendo de la OC.
 */
async function guardarOtraFactura(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const oc = await leerOrden(sesion, d.id);
  if (!oc) return noEncontreOc();
  if (oc.estado === "anulada") return NextResponse.json({ error: "Esa orden de compra está anulada" }, { status: 409 });
  if (oc.estado === "borrador") return NextResponse.json({ error: "Primero mandá la orden de compra" }, { status: 409 });
  const [items, provs] = await Promise.all([
    sbGet(`ordenes_compra_items?orden_id=eq.${oc.id}&empresa_id=eq.${e}&select=id,descripcion`, opts),
    sbGet(`proveedores?id=eq.${d.proveedor_id}&empresa_id=eq.${e}&select=id,nombre&limit=1`, opts),
  ]);
  const proveedor = (provs || [])[0];
  if (!proveedor) return NextResponse.json({ error: "Ese proveedor no está en la lista" }, { status: 400 });
  // Una factura, una sola vez (auditoría 12/11, parte 1)
  if (d.numero && !d.forzar) {
    const [antes] = d.factura_id ? (await sbGet(`ordenes_compra_facturas?id=eq.${d.factura_id}&empresa_id=eq.${e}&select=numero,proveedor_id&limit=1`, opts)) || [] : [];
    const cambio = !antes || String(antes.numero || "").trim() !== String(d.numero).trim() || Number(antes.proveedor_id) !== Number(proveedor.id);
    const repetida = cambio ? await buscarFacturaRepetida(e, { numero: d.numero, proveedor_id: proveedor.id, proveedor_nombre: proveedor.nombre }, { oc_otra: d.factura_id || undefined }) : null;
    if (repetida) return NextResponse.json({ error: avisoFacturaRepetida(repetida), repetida: true }, { status: 409 });
  }
  const porId = new Map((items || []).map((it) => [it.id, it]));
  const renglones = [];
  for (const r of d.renglones) {
    const it = porId.get(r.item_id);
    if (!it) return NextResponse.json({ error: "Un renglón no es de esta orden de compra. Actualizá la pantalla." }, { status: 409 });
    renglones.push({ item_id: it.id, descripcion: String(it.descripcion || "").slice(0, 200), cantidad: r.cantidad, precio: r.precio, iva: r.iva });
  }
  const ahora = new Date().toISOString();
  const fila = {
    proveedor_id: proveedor.id, proveedor_nombre: String(proveedor.nombre || "").slice(0, 120) || "Proveedor",
    numero: d.numero, fecha: d.fecha, tipo_cambio: oc.moneda === "USD" ? d.tipo_cambio : null,
    otros_impuestos: d.otros_impuestos || 0, renglones, updated_at: ahora,
  };
  let guardada;
  if (d.factura_id) {
    [guardada] = (await sbPatch(`ordenes_compra_facturas?id=eq.${d.factura_id}&orden_id=eq.${oc.id}&empresa_id=eq.${e}&anulada_at=is.null`, fila, opts)) || [];
    if (!guardada) return NextResponse.json({ error: "No encontré esa factura (¿la anularon?). Actualizá la pantalla." }, { status: 404 });
  } else {
    [guardada] = (await sbPost("ordenes_compra_facturas", {
      ...fila, empresa_id: e, orden_id: oc.id, cargada_por: sesion.empleado_id || null, cargada_por_nombre: await nombreEmpleado(sesion), created_at: ahora,
    }, opts)) || [];
  }
  broadcastRefresh(e, "ordenes_compra");
  if (guardada?.id && (await sincronizarCompra(e, { origen: "factura_oc_otra", id: guardada.id })).accion !== "omitida") broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, factura: guardada || null });
}

/** Anula otra factura de la OC (no se borra); su compra en Finanzas se anula. */
async function anularOtraFactura(sesion, facturaId) {
  const e = sesion.empresa_id;
  const ahora = new Date().toISOString();
  const [f] = (await sbPatch(`ordenes_compra_facturas?id=eq.${facturaId}&empresa_id=eq.${e}&anulada_at=is.null`, {
    anulada_at: ahora, anulada_por_nombre: (await nombreEmpleado(sesion)) || "Compras", updated_at: ahora,
  }, { sesion })) || [];
  if (!f) return NextResponse.json({ error: "No encontré esa factura (¿ya estaba anulada?)" }, { status: 404 });
  broadcastRefresh(e, "ordenes_compra");
  if ((await sincronizarCompra(e, { origen: "factura_oc_otra", id: f.id })).accion === "anulada") broadcastRefresh(e, "fin_operaciones");
  return NextResponse.json({ ok: true, factura: f });
}

/* ─── Orden "A cotizar" y pedidos de cotización (125) ──────────────────── */

const noEsACotizar = () => NextResponse.json({ error: "Esa orden ya tiene proveedor: no está a cotizar" }, { status: 409 });

async function leerCotizacion(sesion, id) {
  const [c] = (await sbGet(`ordenes_compra_cotizaciones?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=*&limit=1`, { sesion })) || [];
  return c || null;
}
const noEncontreCotizacion = () => NextResponse.json({ error: "No encontré esa cotización" }, { status: 404 });

/** Anota a qué proveedores se les pidió cotización; los que ya estaban no se repiten. */
async function pedirCotizacion(sesion, { id, proveedores: ids }) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const oc = await leerOrden(sesion, id);
  if (!oc) return noEncontreOc();
  if (!ocACotizar(oc)) return noEsACotizar();
  const unicos = [...new Set(ids)];
  const provs = (await sbGet(`proveedores?empresa_id=eq.${e}&id=in.(${unicos.join(",")})&select=id,nombre,activo`, opts)) || [];
  if (provs.length !== unicos.length || provs.some((p) => !p.activo)) {
    return NextResponse.json({ error: "Uno de los proveedores no existe o está dado de baja. Actualizá la lista." }, { status: 409 });
  }
  const ya = new Set(((await sbGet(`ordenes_compra_cotizaciones?orden_id=eq.${oc.id}&empresa_id=eq.${e}&select=proveedor_id`, opts)) || []).map((c) => c.proveedor_id));
  const quien = await nombreEmpleado(sesion);
  const nuevas = provs.filter((p) => !ya.has(p.id)).map((p) => ({
    empresa_id: e, orden_id: oc.id, proveedor_id: p.id, proveedor_nombre: String(p.nombre).slice(0, 120),
    pedida_por: sesion.empleado_id || null, pedida_por_nombre: quien,
  }));
  const creadas = nuevas.length ? (await sbPost("ordenes_compra_cotizaciones", nuevas, opts)) || [] : [];
  broadcastRefresh(e, "ordenes_compra");
  return NextResponse.json({ ok: true, cotizaciones: creadas });
}

async function guardarCotizacion(sesion, d) {
  const e = sesion.empresa_id;
  const c = await leerCotizacion(sesion, d.id);
  if (!c) return noEncontreCotizacion();
  const oc = await leerOrden(sesion, c.orden_id);
  if (!oc) return noEncontreOc();
  if (!ocACotizar(oc)) return noEsACotizar();
  const ahora = new Date().toISOString();
  const respondida = d.total !== null || d.plazo_dias !== null || Boolean(d.nota);
  const [fila] = (await sbPatch(`ordenes_compra_cotizaciones?id=eq.${c.id}&empresa_id=eq.${e}`, {
    total: d.total, plazo_dias: d.plazo_dias, nota: d.nota, respondida_at: respondida ? c.respondida_at || ahora : null, updated_at: ahora,
  }, { sesion })) || [];
  broadcastRefresh(e, "ordenes_compra");
  return NextResponse.json({ ok: true, cotizacion: fila || c });
}

async function quitarCotizacion(sesion, id) {
  const e = sesion.empresa_id;
  const c = await leerCotizacion(sesion, id);
  if (!c) return NextResponse.json({ ok: true });
  const oc = await leerOrden(sesion, c.orden_id);
  if (oc && !ocACotizar(oc)) return noEsACotizar();
  await sbDelete(`ordenes_compra_cotizaciones?id=eq.${c.id}&empresa_id=eq.${e}`, { sesion });
  broadcastRefresh(e, "ordenes_compra");
  return NextResponse.json({ ok: true });
}

/** El proveedor elegido se queda con la orden: deja de estar a cotizar y sigue como borrador. */
async function adjudicarOrden(sesion, id) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const c = await leerCotizacion(sesion, id);
  if (!c) return noEncontreCotizacion();
  const oc = await leerOrden(sesion, c.orden_id);
  if (!oc) return noEncontreOc();
  if (!ocACotizar(oc)) return noEsACotizar();
  const [prov] = (await sbGet(`proveedores?id=eq.${c.proveedor_id}&empresa_id=eq.${e}&select=id,nombre,activo&limit=1`, opts)) || [];
  if (!prov?.activo) return NextResponse.json({ error: "Ese proveedor está dado de baja" }, { status: 409 });
  const ahora = new Date().toISOString();
  // Solo si sigue a cotizar: dos personas eligiendo a la vez no se pisan
  const [fila] = (await sbPatch(`ordenes_compra?id=eq.${oc.id}&empresa_id=eq.${e}&estado=eq.borrador&proveedor_id=is.null`, {
    proveedor_id: prov.id, proveedor_nombre: String(prov.nombre).slice(0, 120), updated_at: ahora,
  }, opts)) || [];
  if (!fila) return noEsACotizar();
  await sbPatch(`ordenes_compra_cotizaciones?id=eq.${c.id}&empresa_id=eq.${e}`, { elegida: true, updated_at: ahora }, opts);
  broadcastRefresh(e, "ordenes_compra");
  return NextResponse.json({ ok: true, orden: fila });
}

async function chequeos(sesion) {
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  // Compras es un módulo propio (viene con las OT y se puede apagar aparte, 131)
  return requireModuloSesion(sesion, "compras");
}

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const comprador = await esComprador(sesion);
    if (new URL(request.url).searchParams.get("repetidos")) {
      if (!comprador) return soloComprador();
      const bloqueo = await chequeos(sesion);
      if (bloqueo) return bloqueo;
      return NextResponse.json({ ...(await repetidos(sesion)), puede_unir: await comoDueno(sesion) });
    }
    return NextResponse.json({ comprador, puede_pedir: puedePedir(sesion.rol) });
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
      if (d.accion === "pedidos_crear") return await crearPedidos(sesion, d);
      if (d.accion === "pedido_anular") return await anularPedido(sesion, d.id);
      if (d.accion === "pedido_editar") return await editarPedido(sesion, d);
      if (d.accion === "recepcion_crear") return await crearRecepcion(sesion, d);
      if (!(await esComprador(sesion))) return soloComprador();
      if (d.accion === "proveedor_guardar") return await guardarProveedor(sesion, d);
      if (d.accion === "proveedor_baja") return await bajaProveedor(sesion, d);
      if (d.accion === "proveedores_importar") return await importarProveedores(sesion, d.nombres);
      if (d.accion === "proveedores_unir") return await unirProveedores(sesion, d);
      if (d.accion === "oc_crear") return await crearOrdenes(sesion, d);
      if (d.accion === "oc_guardar") return await guardarOrden(sesion, d);
      if (d.accion === "oc_enviar") return await enviarOrden(sesion, d.id);
      if (d.accion === "oc_anular") return await anularOrden(sesion, d.id);
      if (d.accion === "oc_cerrar_faltantes") return await cerrarOrdenConFaltantes(sesion, d);
      if (d.accion === "oc_cotizacion_pedir") return await pedirCotizacion(sesion, d);
      if (d.accion === "oc_cotizacion_guardar") return await guardarCotizacion(sesion, d);
      if (d.accion === "oc_cotizacion_quitar") return await quitarCotizacion(sesion, d.id);
      if (d.accion === "oc_adjudicar") return await adjudicarOrden(sesion, d.id);
      if (d.accion === "recepcion_anular") return await anularRecepcion(sesion, d.id);
      if (d.accion === "oc_otra_factura_guardar") return await guardarOtraFactura(sesion, d);
      if (d.accion === "oc_otra_factura_anular") return await anularOtraFactura(sesion, d.factura_id);
      return await facturaOrden(sesion, d);
    } catch (err) {
      if (faltaMigracionUnidad(err)) {
        return NextResponse.json({ error: "Para comprar en otra unidad (cajas, rollos, metros) falta correr la migración 152 en Supabase." }, { status: 409 });
      }
      if (faltaMigracionTransacciones(err)) {
        return NextResponse.json({ error: "Para recibir mercadería y cargar facturas falta correr la migración 130 en Supabase." }, { status: 409 });
      }
      if (faltaMigracionOtrasFacturas(err)) {
        return NextResponse.json({ error: "Para cargar otra factura de la orden falta correr la migración 173 en Supabase." }, { status: 409 });
      }
      if (faltaMigracionCotizaciones(err)) {
        return NextResponse.json({ error: "Para pedir cotizaciones falta correr la migración 125 en Supabase." }, { status: 409 });
      }
      if (faltaMigracionCierre(err)) {
        return NextResponse.json({ error: "Para cerrar órdenes con faltantes falta correr la migración 123 en Supabase." }, { status: 409 });
      }
      if (faltaMigracionFactura(err)) {
        return NextResponse.json({ error: "Para cargar la factura con IVA y otros impuestos falta correr la migración 122 en Supabase." }, { status: 409 });
      }
      if (faltaMigracionEdicion(err)) {
        return NextResponse.json({ error: "Para corregir pedidos falta correr la migración 121 en Supabase." }, { status: 409 });
      }
      if (faltaMigracionObservacion(err)) {
        return NextResponse.json({ error: "Para la observación de cada renglón falta correr la migración 120 en Supabase." }, { status: 409 });
      }
      if (faltaMigracionRecepcion(err)) {
        return NextResponse.json({ error: "Para recibir con remito falta correr la migración 115 en Supabase." }, { status: 409 });
      }
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
