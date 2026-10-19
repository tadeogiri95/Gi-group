// POST /api/piezas/paso — Escaneo de cada pieza en cada etapa (Órdenes de
// Producción, parte 18; migración 110).
//
// Body: { accion, ... } (cualquier empleado)
//   escanear → el QR de la etiqueta de la pieza ("OT M-7495 - PIEZA - 1234")
//              y la etapa (código de una etapa de la empresa que se escanea
//              por pieza; migración 112). Anota que la pieza
//              pasó por esa etapa. Si con esta pasaron todas las piezas de la
//              OT que llevan esa etapa, marca la etapa de la OT como terminada
//              (avance_etapas; la firma la sigue poniendo el responsable).
//              Puede venir de la cola sin señal: momento = cuándo se escaneó.
//              El QR puede ser el de una etiqueta de módulo ("OT M-7495 -
//              MODULO - M.izq"): pasan por la etapa todas las piezas de ese
//              módulo de una vez (así se escanea el Armado).
//   deshacer → saca el escaneo (el mismo operario hasta 30 minutos después,
//              o gestión). No toca el avance de la etapa.
//   deshacer_modulo → lo mismo para todas las piezas de un módulo.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { validateBody, safeErrorMessage } from "../../../lib/validate";
import { pasoPiezaBody } from "../../../lib/schemas";
import { sbGet, sbPost, sbDelete, sbHeaders } from "../../../lib/sbHelpers";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { broadcastRefresh } from "../../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../../lib/planEnforcement";
import { leerQrPieza, leerQrModulo, etapasSalteadas } from "../../../lib/piezas";
import { normalizarOt } from "../../../lib/escaneoCarga";
import { logger } from "../../../lib/logger";

const MINUTOS_DESHACER = 30;
const DIAS_COLA = 7;

function faltaMigracion(err) {
  const m = String(err?.message);
  return (m.includes("pasos_pieza") || m.includes("piezas_ot")) && /does not exist|could not find|PGRST205|42P01/i.test(m);
}
const falta112 = (err) => /por_pieza/.test(String(err?.message));

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

async function terminarEtapa(sesion, ot, etapa, opts) {
  const e = sesion.empresa_id;
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

/** La etapa elegida, si se escanea por pieza; si no, la respuesta de error. */
async function etapaPorPieza(sesion, codigo, opts) {
  const [etapa] = (await sbGet(`etapas?empresa_id=eq.${sesion.empresa_id}&codigo=eq.${codigo}&select=codigo,nombre,activa,por_pieza&limit=1`, opts)) || [];
  if (!etapa || !etapa.por_pieza || etapa.activa === false) {
    return { response: NextResponse.json({ error: "Esa etapa ya no se escanea por pieza. Elegí otra (Configuración → Etapas)." }, { status: 400 }) };
  }
  return { etapa };
}

/** ¿Pasaron todas las piezas de la OT que llevan esta etapa? Si sí, la etapa queda terminada. */
async function progresoEtapa(sesion, ot, etapa, opts) {
  const e = sesion.empresa_id;
  const otq = encodeURIComponent(ot);
  const [total, pasaron] = await Promise.all([
    contar(`piezas_ot?empresa_id=eq.${e}&ot=eq.${otq}&etapas=cs.%7B${etapa.codigo}%7D`, opts),
    contar(`pasos_pieza?empresa_id=eq.${e}&ot=eq.${otq}&etapa=eq.${etapa.codigo}&requerida=eq.true`, opts),
  ]);
  const progreso = { pasaron: Math.min(pasaron, total), total };
  const etapaTerminada = total > 0 && pasaron >= total ? await terminarEtapa(sesion, ot, etapa, opts) : null;
  return { progreso, etapaTerminada };
}

/** Piezas de un módulo de la OT (el módulo sale del nombre de la pieza en la planilla). */
async function piezasDelModulo(sesion, ot, modulo, opts) {
  return (await sbGet(`piezas_ot?empresa_id=eq.${sesion.empresa_id}&ot=eq.${encodeURIComponent(ot)}&modulo=eq.${encodeURIComponent(modulo)}&select=id,ot,etapas&order=id.asc`, opts)) || [];
}

async function escanearModulo(sesion, datos, lectura) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(lectura.ot)}&select=ot&limit=1`, opts)) || [];
  const ot = proyecto?.ot || lectura.ot;
  const piezas = await piezasDelModulo(sesion, ot, lectura.modulo, opts);
  if (!piezas.length) {
    return NextResponse.json({ error: `El módulo ${lectura.modulo} no tiene piezas en la OT ${ot} (puede que se haya vuelto a pegar la planilla). Reimprimí su etiqueta.` }, { status: 404 });
  }
  const { etapa, response } = await etapaPorPieza(sesion, datos.etapa, opts);
  if (response) return response;
  const ids = piezas.map((p) => p.id);
  const hechos = new Set(((await sbGet(`pasos_pieza?empresa_id=eq.${e}&etapa=eq.${datos.etapa}&pieza_id=in.(${ids.join(",")})&select=pieza_id`, opts)) || []).map((p) => Number(p.pieza_id)));
  const nuevas = piezas.filter((p) => !hechos.has(Number(p.id)));
  const requeridas = piezas.filter((p) => (p.etapas || []).map(Number).includes(datos.etapa)).length;
  const modulo = { ot, nombre: lectura.modulo, piezas: piezas.length, nuevas: nuevas.length, requeridas };
  if (!nuevas.length) {
    return NextResponse.json({ ok: true, ya: true, modulo, etapa: datos.etapa, etapaNombre: etapa.nombre, progreso: null, etapaTerminada: null });
  }
  const momento = momentoValido(datos.momento, Date.now());
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pasos_pieza?on_conflict=pieza_id,etapa`, {
    method: "POST",
    headers: await sbHeaders(opts, { Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify(nuevas.map((p) => ({
      empresa_id: e, ot, pieza_id: p.id, etapa: datos.etapa,
      requerida: (p.etapas || []).map(Number).includes(datos.etapa),
      empleado_id: sesion.empleado_id || null, created_at: momento,
    }))),
  });
  if (!r.ok) throw new Error(`POST pasos_pieza: ${await r.text()}`);
  broadcastRefresh(e, "pasos_pieza");
  const { progreso, etapaTerminada } = requeridas ? await progresoEtapa(sesion, ot, etapa, opts) : { progreso: null, etapaTerminada: null };
  return NextResponse.json({ ok: true, ya: false, modulo, etapa: datos.etapa, etapaNombre: etapa.nombre, progreso, etapaTerminada });
}

async function escanear(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const deModulo = leerQrModulo(datos.codigo);
  if (deModulo) return escanearModulo(sesion, datos, deModulo);
  // El QR de la etiqueta, o el número de pieza escrito a mano ("N° 1234")
  const lectura = leerQrPieza(datos.codigo) || (/^\d{1,15}$/.test(datos.codigo) ? { ot: null, id: Number(datos.codigo) } : null);
  if (!lectura) return NextResponse.json({ error: "Ese código no es de una pieza ni de un módulo. Escaneá la etiqueta de la pieza o del módulo." }, { status: 400 });
  const [pieza] = (await sbGet(`piezas_ot?id=eq.${lectura.id}&empresa_id=eq.${e}&select=id,ot,nombre,unidad,de,etapas&limit=1`, opts)) || [];
  if (!pieza || (lectura.ot && normalizarOt(pieza.ot) !== normalizarOt(lectura.ot))) {
    return NextResponse.json({ error: "Esa pieza ya no está en la OT (puede que se haya vuelto a pegar la planilla). Reimprimí su etiqueta." }, { status: 404 });
  }
  const { etapa, response } = await etapaPorPieza(sesion, datos.etapa, opts);
  if (response) return response;
  const datosPieza = { id: pieza.id, ot: pieza.ot, nombre: pieza.nombre, unidad: pieza.unidad, de: pieza.de };
  const etapaNombre = etapa.nombre;
  const pasos = (await sbGet(`pasos_pieza?pieza_id=eq.${pieza.id}&empresa_id=eq.${e}&select=etapa,created_at`, opts)) || [];
  const requerida = (pieza.etapas || []).map(Number).includes(datos.etapa);
  const previo = pasos.find((p) => Number(p.etapa) === datos.etapa);
  if (previo) {
    return NextResponse.json({ ok: true, ya: true, pieza: datosPieza, etapa: datos.etapa, etapaNombre, requerida, faltan: [], progreso: null, etapaTerminada: null, momento: previo.created_at });
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

  const { progreso, etapaTerminada } = requerida ? await progresoEtapa(sesion, pieza.ot, etapa, opts) : { progreso: null, etapaTerminada: null };
  return NextResponse.json({ ok: true, ya: false, pieza: datosPieza, etapa: datos.etapa, etapaNombre, requerida, faltan, progreso, etapaTerminada });
}

async function deshacerModulo(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const ids = (await piezasDelModulo(sesion, datos.ot, datos.modulo, opts)).map((p) => p.id);
  if (!ids.length) return NextResponse.json({ ok: true });
  const filtro = `pasos_pieza?empresa_id=eq.${e}&etapa=eq.${datos.etapa}&pieza_id=in.(${ids.join(",")})`;
  const pasos = (await sbGet(`${filtro}&select=id,empleado_id,created_at`, opts)) || [];
  if (!pasos.length) return NextResponse.json({ ok: true });
  const gestion = ROLES_GESTION.has(sesion.rol);
  const propios = pasos.filter((p) => p.empleado_id && p.empleado_id === sesion.empleado_id && Date.now() - Date.parse(p.created_at) <= MINUTOS_DESHACER * 60000);
  const borrar = gestion ? pasos : propios;
  if (!borrar.length) {
    return NextResponse.json({ error: `Solo podés deshacer tus escaneos de los últimos ${MINUTOS_DESHACER} minutos. Pedíselo al encargado.` }, { status: 403 });
  }
  await sbDelete(`pasos_pieza?empresa_id=eq.${e}&id=in.(${borrar.map((p) => p.id).join(",")})`, opts);
  broadcastRefresh(e, "pasos_pieza");
  return NextResponse.json({ ok: true, deshechas: borrar.length });
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
      const { accion } = parsed.data;
      if (accion === "escanear") return await escanear(sesion, parsed.data);
      if (accion === "deshacer_modulo") return await deshacerModulo(sesion, parsed.data);
      return await deshacer(sesion, parsed.data);
    } catch (err) {
      if (faltaMigracion(err)) {
        return NextResponse.json({ error: "Para escanear piezas falta correr la migración 110 en Supabase." }, { status: 409 });
      }
      if (falta112(err)) {
        return NextResponse.json({ error: "Para escanear piezas falta correr la migración 112 en Supabase." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    logger.error("[piezas/paso] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
