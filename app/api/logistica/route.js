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
import { puedeGestionarLogistica, AVISO_MIGRACION_LOGISTICA, AVISO_MIGRACION_VIAJES, obrasDeOts, viajeEditable } from "../../lib/logistica";
import { logger } from "../../lib/logger";

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
  const ots = idsOt.length ? (await sbGet(`proyectos?id=in.(${lista(idsOt)})&empresa_id=eq.${e}&select=id,ot,obra,cliente,estado,direccion,lat,lng`, opts)) || [] : [];
  const filas = [];
  for (const [i, p] of paradas.entries()) {
    const base = { empresa_id: e, orden: i + 1, accion: p.accion, notas: p.notas, estado: "pendiente" };
    if (p.lugar_id) {
      const l = lugares.find((x) => x.id === p.lugar_id);
      if (!l) return { error: noEncontrado(`el lugar de la parada ${i + 1}`) };
      filas.push({ ...base, lugar_id: l.id, ots: [], nombre: l.nombre, cliente: null, direccion: l.direccion ?? null, lat: l.lat ?? null, lng: l.lng ?? null });
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

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(logisticaBody, raw);
    if (parsed.response) return parsed.response;
    if (!puedeGestionarLogistica(sesion.rol)) {
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
      return await direccionObra(sesion, d);
    } catch (err) {
      if (faltaMigracionViajes(err)) return NextResponse.json({ error: AVISO_MIGRACION_VIAJES }, { status: 409 });
      if (faltaMigracion(err)) return NextResponse.json({ error: AVISO_MIGRACION_LOGISTICA }, { status: 409 });
      throw err;
    }
  } catch (err) {
    logger.error("[logistica] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
