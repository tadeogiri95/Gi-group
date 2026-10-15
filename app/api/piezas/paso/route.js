// POST /api/piezas/paso — Escaneo de cada pieza en cada etapa (Órdenes de
// Producción, parte 18; migración 110).
//
// Body: { accion, ... } (cualquier empleado)
//   escanear → el QR de la etiqueta de la pieza ("OT M-7495 - PIEZA - 1234")
//              y la etapa (corte, canto, cnc, especial). Anota que la pieza
//              pasó por esa etapa. Si con esta pasaron todas las piezas de la
//              OT que llevan esa etapa, marca la etapa de la OT como terminada
//              (avance_etapas; la firma la sigue poniendo el responsable).
//              Puede venir de la cola sin señal: momento = cuándo se escaneó.
//   deshacer → saca el escaneo (el mismo operario hasta 30 minutos después,
//              o gestión). No toca el avance de la etapa.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { validateBody, safeErrorMessage } from "../../../lib/validate";
import { pasoPiezaBody } from "../../../lib/schemas";
import { sbGet, sbPost, sbDelete, sbHeaders } from "../../../lib/sbHelpers";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { broadcastRefresh } from "../../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../../lib/planEnforcement";
import { leerQrPieza, etapasSalteadas, etapaDeTipo } from "../../../lib/piezas";
import { normalizarOt } from "../../../lib/escaneoCarga";
import { logger } from "../../../lib/logger";

const MINUTOS_DESHACER = 30;
const DIAS_COLA = 7;

function faltaMigracion(err) {
  const m = String(err?.message);
  return (m.includes("pasos_pieza") || m.includes("piezas_ot")) && /does not exist|could not find|PGRST205|42P01/i.test(m);
}

/** Cuántas filas cumplen el filtro (sin traerlas). */
async function contar(path, opts) {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}&select=id&limit=1`, {
    headers: await sbHeaders(opts, { Prefer: "count=exact" }),
  });
  if (!r.ok) throw new Error(`GET ${path}: ${await r.text()}`);
  const total = Number(String(r.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

/** El momento que trae la cola sin señal, si es creíble; si no, ahora. */
function momentoValido(momento, ahora) {
  const t = Date.parse(momento || "");
  if (!Number.isFinite(t) || t > ahora + 5 * 60000 || t < ahora - DIAS_COLA * 86400000) return new Date(ahora).toISOString();
  return new Date(t).toISOString();
}

async function terminarEtapa(sesion, ot, tipo, opts) {
  const e = sesion.empresa_id;
  const etapas = (await sbGet(`etapas?empresa_id=eq.${e}&select=codigo,nombre,activa,orden&order=orden.asc`, opts)) || [];
  const etapa = etapaDeTipo(etapas, tipo);
  if (!etapa) return null;
  const filtro = `avance_etapas?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&etapa=eq.${etapa.codigo}`;
  const [actual] = (await sbGet(`${filtro}&select=id,estado&limit=1`, opts)) || [];
  // Ya terminada, firmada o "no aplica": no se toca
  if (!actual) {
    const ahora = new Date().toISOString();
    try {
      await sbPost("avance_etapas", {
        empresa_id: e, ot, etapa: etapa.codigo, estado: "terminada",
        terminada_por: sesion.empleado_id || null, terminada_at: ahora, updated_at: ahora,
      }, opts);
      broadcastRefresh(e, "avance_etapas");
    } catch (err) {
      // Dos escaneos a la vez terminaron la etapa: la otra fila ya quedó
      logger.warn?.("[piezas/paso] no se pudo terminar la etapa", { ot, etapa: etapa.codigo, error: err?.message });
    }
  }
  return { codigo: etapa.codigo, nombre: etapa.nombre };
}

async function escanear(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  // El QR de la etiqueta, o el número de pieza escrito a mano ("N° 1234")
  const lectura = leerQrPieza(datos.codigo) || (/^\d{1,15}$/.test(datos.codigo) ? { ot: null, id: Number(datos.codigo) } : null);
  if (!lectura) return NextResponse.json({ error: "Ese código no es de una pieza. Escaneá la etiqueta de la pieza." }, { status: 400 });
  const [pieza] = (await sbGet(`piezas_ot?id=eq.${lectura.id}&empresa_id=eq.${e}&select=id,ot,nombre,unidad,de,etapas&limit=1`, opts)) || [];
  if (!pieza || (lectura.ot && normalizarOt(pieza.ot) !== normalizarOt(lectura.ot))) {
    return NextResponse.json({ error: "Esa pieza ya no está en la OT (puede que se haya vuelto a pegar la planilla). Reimprimí su etiqueta." }, { status: 404 });
  }
  const datosPieza = { id: pieza.id, ot: pieza.ot, nombre: pieza.nombre, unidad: pieza.unidad, de: pieza.de };
  const pasos = (await sbGet(`pasos_pieza?pieza_id=eq.${pieza.id}&empresa_id=eq.${e}&select=etapa,created_at`, opts)) || [];
  const requerida = (pieza.etapas || []).includes(datos.etapa);
  const previo = pasos.find((p) => p.etapa === datos.etapa);
  if (previo) {
    return NextResponse.json({ ok: true, ya: true, pieza: datosPieza, etapa: datos.etapa, requerida, faltan: [], progreso: null, etapaTerminada: null, momento: previo.created_at });
  }

  const faltan = requerida ? etapasSalteadas(pieza, datos.etapa, pasos) : [];
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pasos_pieza?on_conflict=pieza_id,etapa`, {
    method: "POST",
    headers: await sbHeaders(opts, { Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify({
      empresa_id: e, ot: pieza.ot, pieza_id: pieza.id, etapa: datos.etapa, requerida,
      empleado_id: sesion.empleado_id || null, created_at: momentoValido(datos.momento, Date.now()),
    }),
  });
  if (!r.ok) throw new Error(`POST pasos_pieza: ${await r.text()}`);
  broadcastRefresh(e, "pasos_pieza");

  // ¿Pasaron todas las piezas de la OT que llevan esta etapa?
  let progreso = null;
  let etapaTerminada = null;
  if (requerida) {
    const ot = encodeURIComponent(pieza.ot);
    const [total, pasaron] = await Promise.all([
      contar(`piezas_ot?empresa_id=eq.${e}&ot=eq.${ot}&etapas=cs.%7B${datos.etapa}%7D`, opts),
      contar(`pasos_pieza?empresa_id=eq.${e}&ot=eq.${ot}&etapa=eq.${datos.etapa}&requerida=eq.true`, opts),
    ]);
    progreso = { pasaron: Math.min(pasaron, total), total };
    if (total > 0 && pasaron >= total) etapaTerminada = await terminarEtapa(sesion, pieza.ot, datos.etapa, opts);
  }
  return NextResponse.json({ ok: true, ya: false, pieza: datosPieza, etapa: datos.etapa, requerida, faltan, progreso, etapaTerminada });
}

async function deshacer(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const filtro = `pasos_pieza?pieza_id=eq.${datos.pieza_id}&etapa=eq.${datos.etapa}&empresa_id=eq.${e}`;
  const [paso] = (await sbGet(`${filtro}&select=id,empleado_id,created_at&limit=1`, opts)) || [];
  if (!paso) return NextResponse.json({ ok: true });
  const propio = paso.empleado_id && paso.empleado_id === sesion.empleado_id
    && Date.now() - Date.parse(paso.created_at) <= MINUTOS_DESHACER * 60000;
  if (!propio && !ROLES_GESTION.has(sesion.rol)) {
    return NextResponse.json({ error: `Solo podés deshacer tus escaneos de los últimos ${MINUTOS_DESHACER} minutos. Pedíselo al encargado.` }, { status: 403 });
  }
  await sbDelete(`pasos_pieza?id=eq.${paso.id}&empresa_id=eq.${e}`, opts);
  broadcastRefresh(e, "pasos_pieza");
  return NextResponse.json({ ok: true });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(pasoPiezaBody, raw);
    if (parsed.response) return parsed.response;
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const sinModulo = await requireModulo(sesion.empresa_id, "actividad");
    if (sinModulo) return sinModulo;
    try {
      return parsed.data.accion === "escanear" ? await escanear(sesion, parsed.data) : await deshacer(sesion, parsed.data);
    } catch (err) {
      if (faltaMigracion(err)) {
        return NextResponse.json({ error: "Para escanear piezas falta correr la migración 110 en Supabase." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    logger.error("[piezas/paso] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
