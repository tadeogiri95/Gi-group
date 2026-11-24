// /api/logistica — Módulo de Logística (pedido de Tadeo, 23/11).
//
// Parte 1 (203). POST { accion, ... } (Dueño, supervisores y Administración):
//   lugar_guardar  → alta o edición de un lugar (planta, depósito, proveedor,
//                    cliente u otro) con su dirección y su pin
//   lugar_baja     → dar de baja o reactivar (no se borra: los viajes lo nombran)
//   obra_direccion → dirección y pin de la obra en las OT elegidas (una sola o
//                    todas las de la misma obra)
// La lectura va por /api/data (logistica_lugares, solo lectura; proyectos).
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { logisticaBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch } from "../../lib/sbHelpers";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan } from "../../lib/planEnforcement";
import { requireModuloSesion } from "../../lib/accesosServidor";
import { puedeGestionarLogistica, AVISO_MIGRACION_LOGISTICA } from "../../lib/logistica";
import { logger } from "../../lib/logger";

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
      return await direccionObra(sesion, d);
    } catch (err) {
      if (faltaMigracion(err)) return NextResponse.json({ error: AVISO_MIGRACION_LOGISTICA }, { status: 409 });
      throw err;
    }
  } catch (err) {
    logger.error("[logistica] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
