// /api/logistica — Módulo de Logística (pedido de Tadeo, 23/11).
//
// Parte 1 (203). POST { accion, ... } (Dueño, supervisores y Administración):
//   lugar_guardar  → alta o edición de un lugar (planta, depósito, proveedor,
//                    cliente u otro) con su dirección y su pin
//   lugar_baja     → dar de baja o reactivar (no se borra: los viajes lo nombran)
//   obra_direccion → dirección y pin de la obra en las OT elegidas (una sola o
//                    todas las de la misma obra)
// Parte 2 (204):
//   viaje_guardar  → alta o edición de un viaje con sus paradas en orden. El
//                    número es correlativo por empresa. Cada parada es un lugar
//                    o las OT de una obra: se copian nombre, dirección y pin
//                    (si después cambian, el viaje armado no se mueve). Solo
//                    se edita mientras está planificado.
//   viaje_cancelar → con el motivo (no se borra)
// Parte 3 (205). Lo usa el chofer del viaje (o quien gestiona Logística):
//   viaje_salir    → el viaje pasa a "en camino" con la hora de salida
//   parada_cumplir → cómo terminó la parada (entregado, parcial, rechazado o
//                    no visitado), lo que se entregó, fotos, firma y motivo.
//                    Se puede corregir mientras el viaje no terminó. Si el
//                    viaje no había salido, sale en ese momento.
//   viaje_terminar → con todas las paradas cumplidas
// Parte 4 (206). También el chofer del viaje (o quien gestiona Logística):
//   remito_preparar → número correlativo y link del remito de una parada
//                     cumplida (si ya los tenía, los mismos)
//   remito_datos    → número del remito oficial (ARCA) y COT
// Parte 5 (207). Abastecimiento con Compras:
//   viaje_guardar  → una parada de retiro en un lugar puede llevar la orden
//                    de compra (OC) que se retira
//   parada_oc      → (chofer) lo que falta llegar de la OC de la parada; el
//                    chofer no lee Compras por /api/data
//   parada_cumplir → con OC, lo retirado y el N° de remito del proveedor: la
//                    OC queda recibida (o recibida en parte) en Compras, con
//                    su ingreso de stock, una sola vez por parada
// La lectura va por /api/data (logistica_lugares, logistica_viajes y
// logistica_paradas, solo lectura; proyectos).
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { logisticaBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch, sbDelete } from "../../lib/sbHelpers";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan } from "../../lib/planEnforcement";
import { requireModuloSesion } from "../../lib/accesosServidor";
import {
  puedeGestionarLogistica, puedeHacerViaje, faltaParaCumplir, avanceViaje, viajeEditable, obrasDeOts,
  AVISO_MIGRACION_LOGISTICA, AVISO_MIGRACION_VIAJES, AVISO_MIGRACION_MIS_VIAJES, AVISO_MIGRACION_REMITO, tieneRemito,
  AVISO_MIGRACION_COMPRAS, ESTADOS_OC_RETIRABLE, itemsRecibidos,
} from "../../lib/logistica";
import { recibirOrdenCompra } from "../../lib/comprasRecepcion";
import { tokenRemito } from "../../lib/logisticaRemitoServidor";
import { logger } from "../../lib/logger";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ACCIONES_CHOFER = new Set(["viaje_salir", "parada_cumplir", "viaje_terminar", "remito_preparar", "remito_datos", "parada_oc"]);

function faltaMigracionCompras(err) {
  const m = String(err?.message);
  return /orden_compra_id|recepcion_id|remito_proveedor/.test(m) && /does not exist|42703|PGRST204|schema cache/.test(m);
}

function faltaMigracionRemito(err) {
  const m = String(err?.message);
  return /remito_numero|remito_oficial|\bcot\b|\btoken\b|firmada_link_at/.test(m) && /does not exist|42703|PGRST204|schema cache/.test(m);
}

function faltaMigracionMisViajes(err) {
  const m = String(err?.message);
  return /salida_at|llegada_at|renglones|fotos|firma_url|firma_nombre|firma_dni|sin_firma|motivo|hecha_(por|at|lat|lng)/.test(m) && /does not exist|42703|PGRST204|schema cache/.test(m);
}

function faltaMigracionViajes(err) {
  const m = String(err?.message);
  return /logistica_viajes|logistica_paradas/.test(m) && /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(m);
}

function faltaMigracion(err) {
  const m = String(err?.message);
  return /logistica_lugares|direccion|\blat\b|\blng\b/.test(m) && /does not exist|42P01|42703|PGRST20[045]|schema cache/.test(m);
}

async function guardarLugar(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const fila = {
    nombre: d.nombre, tipo: d.tipo, direccion: d.direccion, lat: d.lat, lng: d.lng,
    proveedor_id: d.tipo === "proveedor" ? d.proveedor_id : null,
    contacto: d.contacto, telefono: d.telefono, horario: d.horario, notas: d.notas,
    updated_at: new Date().toISOString(),
  };
  if (fila.proveedor_id) {
    const [prov] = (await sbGet(`proveedores?id=eq.${fila.proveedor_id}&empresa_id=eq.${e}&select=id`, opts)) || [];
    if (!prov) return NextResponse.json({ error: "No encontré ese proveedor" }, { status: 404 });
  }
  if (d.id) {
    const [l] = (await sbPatch(`logistica_lugares?id=eq.${d.id}&empresa_id=eq.${e}`, fila, opts)) || [];
    if (!l) return NextResponse.json({ error: "No encontré ese lugar" }, { status: 404 });
    broadcastRefresh(e, "logistica_lugares");
    return NextResponse.json({ ok: true, lugar: l });
  }
  const [l] = (await sbPost("logistica_lugares", { ...fila, empresa_id: e }, opts)) || [];
  broadcastRefresh(e, "logistica_lugares");
  return NextResponse.json({ ok: true, lugar: l || fila });
}

async function bajaLugar(sesion, { id, activo }) {
  const e = sesion.empresa_id;
  const [l] = (await sbPatch(`logistica_lugares?id=eq.${id}&empresa_id=eq.${e}`, { activo, updated_at: new Date().toISOString() }, { sesion })) || [];
  if (!l) return NextResponse.json({ error: "No encontré ese lugar" }, { status: 404 });
  broadcastRefresh(e, "logistica_lugares");
  return NextResponse.json({ ok: true, lugar: l });
}

async function direccionObra(sesion, d) {
  const e = sesion.empresa_id;
  const ids = [...new Set(d.ot_ids)];
  const filas = (await sbPatch(`proyectos?id=in.(${ids.join(",")})&empresa_id=eq.${e}`, { direccion: d.direccion, lat: d.lat, lng: d.lng }, { sesion })) || [];
  if (!filas.length) return NextResponse.json({ error: "No encontré esas OT" }, { status: 404 });
  broadcastRefresh(e, "proyectos");
  return NextResponse.json({ ok: true, ots: filas.length });
}

const noEncontrado = (que) => NextResponse.json({ error: `No encontré ${que}` }, { status: 404 });
const lista = (ids) => [...new Set(ids)].join(",");

/** Las paradas como van a la base: con nombre, dirección y pin copiados. */
async function armarParadas(sesion, paradas) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const idsLugar = paradas.map((p) => p.lugar_id).filter(Boolean);
  const idsOt = paradas.flatMap((p) => p.ot_ids);
  const lugares = idsLugar.length ? (await sbGet(`logistica_lugares?id=in.(${lista(idsLugar)})&empresa_id=eq.${e}&select=id,nombre,direccion,lat,lng,contacto`, opts)) || [] : [];
  // Las OC que se retiran (207): de la empresa y todavía por recibir
  const idsOc = paradas.map((p) => p.orden_compra_id).filter(Boolean);
  const ocs = idsOc.length ? (await sbGet(`ordenes_compra?id=in.(${lista(idsOc)})&empresa_id=eq.${e}&select=id,numero,estado`, opts)) || [] : [];
  const ots = idsOt.length ? (await sbGet(`proyectos?id=in.(${lista(idsOt)})&empresa_id=eq.${e}&select=id,ot,obra,cliente,estado,direccion,lat,lng`, opts)) || [] : [];
  const filas = [];
  for (const [i, p] of paradas.entries()) {
    const base = { empresa_id: e, orden: i + 1, accion: p.accion, notas: p.notas, estado: "pendiente" };
    if (p.lugar_id) {
      const l = lugares.find((x) => x.id === p.lugar_id);
      if (!l) return { error: noEncontrado(`el lugar de la parada ${i + 1}`) };
      const fila = { ...base, lugar_id: l.id, ots: [], nombre: l.nombre, cliente: null, direccion: l.direccion ?? null, lat: l.lat ?? null, lng: l.lng ?? null };
      if (p.orden_compra_id) {
        const oc = ocs.find((x) => x.id === p.orden_compra_id);
        if (!oc) return { error: noEncontrado(`la orden de compra de la parada ${i + 1}`) };
        if (!ESTADOS_OC_RETIRABLE.includes(oc.estado)) return { error: NextResponse.json({ error: `La OC N° ${oc.numero} de la parada ${i + 1} ya se recibió completa o está anulada` }, { status: 409 }) };
        // Solo si hay OC: sin la 207, los viajes sin OC se siguen guardando
        fila.orden_compra_id = oc.id;
      }
      filas.push(fila);
      continue;
    }
    const delaParada = ots.filter((x) => p.ot_ids.includes(x.id));
    if (delaParada.length !== new Set(p.ot_ids).size) return { error: noEncontrado(`las OT de la parada ${i + 1}`) };
    // Las OT juntas como una obra (aunque estén cerradas: puede ser una devolución)
    const [obra] = obrasDeOts(delaParada.map((x) => ({ ...x, estado: "activo" })));
    filas.push({
      ...base, lugar_id: null, ots: obra.ots, nombre: obra.nombre.slice(0, 200), cliente: obra.cliente || delaParada[0].cliente || null,
      direccion: obra.direccion, lat: obra.lat, lng: obra.lng,
    });
  }
  return { filas };
}

async function guardarViaje(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  if (d.id) {
    const [antes] = (await sbGet(`logistica_viajes?id=eq.${d.id}&empresa_id=eq.${e}&select=id,estado`, opts)) || [];
    if (!antes) return noEncontrado("ese viaje");
    if (!viajeEditable(antes)) return NextResponse.json({ error: "El viaje ya salió o está cancelado: no se puede cambiar" }, { status: 409 });
  }
  if (d.vehiculo_id) {
    const [v] = (await sbGet(`vehiculos?id=eq.${d.vehiculo_id}&empresa_id=eq.${e}&select=id`, opts)) || [];
    if (!v) return noEncontrado("ese vehículo");
  }
  if (d.chofer_id) {
    const [c] = (await sbGet(`empleados?id=eq.${d.chofer_id}&empresa_id=eq.${e}&select=id`, opts)) || [];
    if (!c) return noEncontrado("esa persona");
  }
  if (d.origen_id) {
    const [o] = (await sbGet(`logistica_lugares?id=eq.${d.origen_id}&empresa_id=eq.${e}&select=id`, opts)) || [];
    if (!o) return noEncontrado("el lugar de salida");
  }
  const armado = await armarParadas(sesion, d.paradas);
  if (armado.error) return armado.error;

  const fila = {
    tipo: d.tipo, fecha: d.fecha, hora: d.hora, vehiculo_id: d.vehiculo_id, chofer_id: d.chofer_id,
    origen_id: d.origen_id, vuelve: d.vuelve, notas: d.notas, updated_at: new Date().toISOString(),
  };
  let viaje;
  if (d.id) {
    [viaje] = (await sbPatch(`logistica_viajes?id=eq.${d.id}&empresa_id=eq.${e}&estado=eq.planificado`, fila, opts)) || [];
    if (!viaje) return NextResponse.json({ error: "El viaje ya salió o está cancelado: no se puede cambiar" }, { status: 409 });
    await sbDelete(`logistica_paradas?viaje_id=eq.${viaje.id}&empresa_id=eq.${e}`, opts);
  } else {
    // Número correlativo por empresa; si dos se guardan a la vez, el segundo toma el siguiente
    for (let intento = 0; intento < 3 && !viaje; intento++) {
      const [ultimo] = (await sbGet(`logistica_viajes?empresa_id=eq.${e}&select=numero&order=numero.desc&limit=1`, opts)) || [];
      try {
        [viaje] = (await sbPost("logistica_viajes", { ...fila, empresa_id: e, numero: (ultimo?.numero || 0) + 1, estado: "planificado", creado_por: sesion.empleado_id || null }, opts)) || [];
      } catch (err) {
        if (!String(err?.message).includes("23505") || intento === 2) throw err;
      }
    }
  }
  const paradas = (await sbPost("logistica_paradas", armado.filas.map((p) => ({ ...p, viaje_id: viaje.id })), opts)) || [];
  broadcastRefresh(e, "logistica_viajes");
  return NextResponse.json({ ok: true, viaje, paradas });
}

async function cancelarViaje(sesion, { id, motivo }) {
  const e = sesion.empresa_id;
  const [v] = (await sbPatch(`logistica_viajes?id=eq.${id}&empresa_id=eq.${e}&estado=in.(planificado,en_camino)`, { estado: "cancelado", motivo_cancelado: motivo, updated_at: new Date().toISOString() }, { sesion })) || [];
  if (!v) return NextResponse.json({ error: "No encontré ese viaje, o ya estaba terminado o cancelado" }, { status: 404 });
  broadcastRefresh(e, "logistica_viajes");
  return NextResponse.json({ ok: true, viaje: v });
}

/** El viaje, si existe y esta persona lo puede cumplir. */
async function viajeDelChofer(sesion, id) {
  const [v] = (await sbGet(`logistica_viajes?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=id,numero,estado,chofer_id`, { sesion })) || [];
  if (!v) return { error: noEncontrado("ese viaje") };
  if (!puedeHacerViaje(sesion.rol, v, sesion.empleado_id)) return { error: NextResponse.json({ error: "Este viaje lo hace otra persona" }, { status: 403 }) };
  return { viaje: v };
}

async function salirViaje(sesion, { id }) {
  const e = sesion.empresa_id;
  const { viaje, error } = await viajeDelChofer(sesion, id);
  if (error) return error;
  if (viaje.estado === "en_camino") return NextResponse.json({ ok: true, viaje });
  if (viaje.estado !== "planificado") return NextResponse.json({ error: "El viaje ya terminó o está cancelado" }, { status: 409 });
  const [v] = (await sbPatch(`logistica_viajes?id=eq.${id}&empresa_id=eq.${e}&estado=eq.planificado`, { estado: "en_camino", salida_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { sesion })) || [];
  broadcastRefresh(e, "logistica_viajes");
  return NextResponse.json({ ok: true, viaje: v || viaje });
}

async function cumplirParada(sesion, d) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  // select=* para que sin la 207 siga andando (sin OC)
  const [p] = (await sbGet(`logistica_paradas?id=eq.${d.id}&empresa_id=eq.${e}&select=*`, opts)) || [];
  if (!p) return noEncontrado("esa parada");
  const { viaje, error } = await viajeDelChofer(sesion, p.viaje_id);
  if (error) return error;
  if (viaje.estado !== "planificado" && viaje.estado !== "en_camino") return NextResponse.json({ error: "El viaje ya terminó o está cancelado: no se puede cambiar" }, { status: 409 });
  // Fotos y firma: solo imágenes subidas por /api/upload para esta empresa
  const deLaApp = (url) => !url || url.startsWith(`${SB_URL}/storage/v1/object/public/reportes-obra/${e}/`);
  if (!d.fotos.every(deLaApp) || !deLaApp(d.firma_url)) return NextResponse.json({ error: "Las fotos y la firma tienen que hacerse desde la app" }, { status: 400 });
  // Con OC ya recibida, no se vuelve a recibir (lo que se cambie queda solo en el viaje)
  const conOc = !!p.orden_compra_id;
  const recibir = conOc && !p.recepcion_id && (d.estado === "entregado" || d.estado === "parcial");
  const falta = faltaParaCumplir({ ...d, accion: p.accion, conOc: recibir });
  if (falta) return NextResponse.json({ error: falta }, { status: 400 });

  // Primero Compras: si la OC no se puede recibir, la parada no se guarda
  let recepcionId = p.recepcion_id ?? null;
  if (recibir) {
    const res = await recibirOrdenCompra(sesion, {
      orden_id: p.orden_compra_id,
      remito: d.remito_proveedor,
      foto_url: d.fotos[0] || null,
      notas: `Retirada en el viaje N° ${viaje.numero} (Logística)`,
      items: itemsRecibidos(d.renglones),
      forzar: false,
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: `Compras: ${r.error || "no se pudo recibir la orden de compra"}` }, { status: res.status });
    recepcionId = r.recepcion?.id ?? null;
  }

  const ahora = new Date().toISOString();
  if (viaje.estado === "planificado") {
    await sbPatch(`logistica_viajes?id=eq.${viaje.id}&empresa_id=eq.${e}&estado=eq.planificado`, { estado: "en_camino", salida_at: ahora, updated_at: ahora }, opts);
  }
  const noFue = d.estado === "no_visitado";
  const fila = {
    estado: d.estado,
    renglones: noFue ? [] : d.renglones,
    fotos: noFue ? [] : d.fotos,
    firma_url: noFue || d.sin_firma ? null : d.firma_url,
    firma_nombre: noFue || d.sin_firma ? null : d.firma_nombre,
    firma_dni: noFue || d.sin_firma ? null : d.firma_dni,
    sin_firma: !noFue && d.sin_firma,
    motivo: d.estado === "entregado" ? null : d.motivo,
    hecha_por: sesion.empleado_id || null,
    hecha_at: ahora,
    hecha_lat: d.lat,
    hecha_lng: d.lng,
  };
  if (conOc) {
    fila.recepcion_id = recepcionId;
    // El remito del proveedor queda el de la recepción, aunque después se corrija la parada
    fila.remito_proveedor = p.recepcion_id ? p.remito_proveedor : recibir ? d.remito_proveedor : null;
  }
  const [parada] = (await sbPatch(`logistica_paradas?id=eq.${p.id}&empresa_id=eq.${e}`, fila, opts)) || [];
  broadcastRefresh(e, "logistica_viajes");
  return NextResponse.json({ ok: true, parada: parada || { ...p, ...fila } });
}

async function terminarViaje(sesion, { id }) {
  const e = sesion.empresa_id;
  const { viaje, error } = await viajeDelChofer(sesion, id);
  if (error) return error;
  if (viaje.estado !== "en_camino") return NextResponse.json({ error: viaje.estado === "planificado" ? "El viaje todavía no salió" : "El viaje ya terminó o está cancelado" }, { status: 409 });
  const paradas = (await sbGet(`logistica_paradas?viaje_id=eq.${id}&empresa_id=eq.${e}&select=id,estado`, { sesion })) || [];
  const { faltan } = avanceViaje(paradas);
  if (faltan) return NextResponse.json({ error: `${faltan === 1 ? "Falta 1 parada" : `Faltan ${faltan} paradas`}: marcá cómo terminó cada una (si no se fue, "No se fue")` }, { status: 409 });
  const ahora = new Date().toISOString();
  const [v] = (await sbPatch(`logistica_viajes?id=eq.${id}&empresa_id=eq.${e}&estado=eq.en_camino`, { estado: "terminado", llegada_at: ahora, updated_at: ahora }, { sesion })) || [];
  if (!v) return NextResponse.json({ error: "El viaje ya terminó o está cancelado" }, { status: 409 });
  broadcastRefresh(e, "logistica_viajes");
  return NextResponse.json({ ok: true, viaje: v });
}

/** La parada con su viaje, si esta persona la puede ver y tiene remito. */
async function paradaConRemito(sesion, id) {
  const [p] = (await sbGet(`logistica_paradas?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=id,viaje_id,estado,remito_numero,token,remito_oficial,cot`, { sesion })) || [];
  if (!p) return { error: noEncontrado("esa parada") };
  const { error } = await viajeDelChofer(sesion, p.viaje_id);
  if (error) return { error };
  if (!tieneRemito(p)) return { error: NextResponse.json({ error: "El remito sale cuando la parada se entregó, se entregó una parte o se rechazó" }, { status: 409 }) };
  return { parada: p };
}

async function prepararRemito(sesion, { id }) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const { parada, error } = await paradaConRemito(sesion, id);
  if (error) return error;
  if (parada.remito_numero && parada.token) return NextResponse.json({ ok: true, parada });
  // Número correlativo por empresa; si dos se piden a la vez, el segundo toma el siguiente
  for (let intento = 0; intento < 3; intento++) {
    const [ultimo] = parada.remito_numero ? [] : (await sbGet(`logistica_paradas?empresa_id=eq.${e}&remito_numero=not.is.null&select=remito_numero&order=remito_numero.desc&limit=1`, opts)) || [];
    const fila = { remito_numero: parada.remito_numero || (ultimo?.remito_numero || 0) + 1, token: parada.token || tokenRemito() };
    try {
      const [p] = (await sbPatch(`logistica_paradas?id=eq.${parada.id}&empresa_id=eq.${e}`, fila, opts)) || [];
      broadcastRefresh(e, "logistica_viajes");
      return NextResponse.json({ ok: true, parada: p || { ...parada, ...fila } });
    } catch (err) {
      if (!String(err?.message).includes("23505") || intento === 2) throw err;
    }
  }
  return NextResponse.json({ error: "No se pudo numerar el remito. Probá de nuevo." }, { status: 409 });
}

async function datosRemitoOficial(sesion, d) {
  const e = sesion.empresa_id;
  const { parada, error } = await paradaConRemito(sesion, d.id);
  if (error) return error;
  const [p] = (await sbPatch(`logistica_paradas?id=eq.${parada.id}&empresa_id=eq.${e}`, { remito_oficial: d.remito_oficial, cot: d.cot }, { sesion })) || [];
  broadcastRefresh(e, "logistica_viajes");
  return NextResponse.json({ ok: true, parada: p || { ...parada, remito_oficial: d.remito_oficial, cot: d.cot } });
}

/** Lo que falta llegar de la OC de la parada (el chofer no lee Compras por /api/data). */
async function ocDeParada(sesion, { id }) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const [p] = (await sbGet(`logistica_paradas?id=eq.${id}&empresa_id=eq.${e}&select=id,viaje_id,orden_compra_id,recepcion_id`, opts)) || [];
  if (!p) return noEncontrado("esa parada");
  const { error } = await viajeDelChofer(sesion, p.viaje_id);
  if (error) return error;
  if (!p.orden_compra_id) return NextResponse.json({ ok: true, oc: null, items: [] });
  const [oc] = (await sbGet(`ordenes_compra?id=eq.${p.orden_compra_id}&empresa_id=eq.${e}&select=id,numero,proveedor_nombre,estado&limit=1`, opts)) || [];
  if (!oc) return NextResponse.json({ ok: true, oc: null, items: [] });
  const items = (await sbGet(`ordenes_compra_items?orden_id=eq.${oc.id}&empresa_id=eq.${e}&select=id,sku,descripcion,unidad,cantidad,cantidad_recibida&order=id.asc`, opts)) || [];
  return NextResponse.json({ ok: true, oc, items, recibida: !!p.recepcion_id });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(logisticaBody, raw);
    if (parsed.response) return parsed.response;
    // El chofer cumple su viaje; lo demás es de quien gestiona Logística
    const deChofer = ACCIONES_CHOFER.has(parsed.data.accion);
    if (!deChofer && !puedeGestionarLogistica(sesion.rol)) {
      return NextResponse.json({ error: "Los lugares y las direcciones los cargan el Dueño, los supervisores y Administración" }, { status: 403 });
    }
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    // Logística es un módulo propio (viene con las OT y se puede apagar aparte, 203)
    const sinModulo = await requireModuloSesion(sesion, "logistica");
    if (sinModulo) return sinModulo;
    const d = parsed.data;
    try {
      if (d.accion === "lugar_guardar") return await guardarLugar(sesion, d);
      if (d.accion === "lugar_baja") return await bajaLugar(sesion, d);
      if (d.accion === "viaje_guardar") return await guardarViaje(sesion, d);
      if (d.accion === "viaje_cancelar") return await cancelarViaje(sesion, d);
      if (d.accion === "viaje_salir") return await salirViaje(sesion, d);
      if (d.accion === "parada_cumplir") return await cumplirParada(sesion, d);
      if (d.accion === "viaje_terminar") return await terminarViaje(sesion, d);
      if (d.accion === "remito_preparar") return await prepararRemito(sesion, d);
      if (d.accion === "remito_datos") return await datosRemitoOficial(sesion, d);
      if (d.accion === "parada_oc") return await ocDeParada(sesion, d);
      return await direccionObra(sesion, d);
    } catch (err) {
      if (faltaMigracionCompras(err)) return NextResponse.json({ error: AVISO_MIGRACION_COMPRAS }, { status: 409 });
      if (faltaMigracionRemito(err)) return NextResponse.json({ error: AVISO_MIGRACION_REMITO }, { status: 409 });
      if (faltaMigracionMisViajes(err)) return NextResponse.json({ error: AVISO_MIGRACION_MIS_VIAJES }, { status: 409 });
      if (faltaMigracionViajes(err)) return NextResponse.json({ error: AVISO_MIGRACION_VIAJES }, { status: 409 });
      if (faltaMigracion(err)) return NextResponse.json({ error: AVISO_MIGRACION_LOGISTICA }, { status: 409 });
      throw err;
    }
  } catch (err) {
    logger.error("[logistica] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
