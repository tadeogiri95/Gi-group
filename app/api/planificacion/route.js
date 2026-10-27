// /api/planificacion — Plan de producción guardado (planificación de la
// producción, parte 41; migración 138).
//
//   GET ?fecha=AAAA-MM-DD      → el plan confirmado que incluye ese día, con
//                                lo que toca cada día (lo ve toda la planta)
//   GET ?confirmados=1         → los planes confirmados de los últimos 6
//                                meses en adelante, con sus días (Gantt de
//                                OT y ⏰ OT atrasadas del Panel)
//   GET ?desde=…&hasta=…       → el plan de ese período, borrador o
//                                confirmado (solo gerencia)
//   POST                       → guarda el plan del período (borrador o
//                                confirmado) y reemplaza lo que toca cada día.
//                                Solo gerencia.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { planProduccionBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch, sbDelete } from "../../lib/sbHelpers";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { logger } from "../../lib/logger";

const json = (body, status = 200) => NextResponse.json(body, { status });
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const SIN_MIGRACION = "Para guardar el plan falta correr la migración 138 en Supabase.";
const faltaMigracion = (err) => /planes_produccion|plan_produccion_items/.test(String(err?.message));
const esGerencia = (sesion) => sesion?.rol === "gerencial";

async function entrar(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  const sinModulo = await requireModulo(sesion.empresa_id, "proyectos");
  if (sinModulo) return { response: sinModulo };
  return { sesion };
}

async function conItems(sesion, plan) {
  if (!plan) return null;
  const items = (await sbGet(`plan_produccion_items?empresa_id=eq.${sesion.empresa_id}&plan_id=eq.${plan.id}&select=ot,etapa,fecha,horas,orden&order=fecha.asc,orden.asc`, { sesion })) || [];
  return { ...plan, items };
}

export async function GET(request) {
  try {
    const { sesion, response } = await entrar(request);
    if (response) return response;
    const e = sesion.empresa_id;
    const q = new URL(request.url).searchParams;
    const fecha = q.get("fecha"), desde = q.get("desde"), hasta = q.get("hasta");
    try {
      if (q.get("confirmados")) {
        const limite = new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10);
        const planes = (await sbGet(`planes_produccion?empresa_id=eq.${e}&estado=eq.confirmado&hasta=gte.${limite}&select=id,tipo,desde,hasta,division_id,dias_extra,confirmado_at&order=desde.asc&limit=60`, { sesion })) || [];
        if (!planes.length) return json({ ok: true, planes: [] });
        const items = (await sbGet(`plan_produccion_items?empresa_id=eq.${e}&plan_id=in.(${planes.map((p) => p.id).join(",")})&select=plan_id,ot,etapa,fecha,horas,orden&order=fecha.asc,orden.asc&limit=20000`, { sesion })) || [];
        return json({ ok: true, planes: planes.map((p) => ({ ...p, items: items.filter((i) => i.plan_id === p.id) })) });
      }
      if (desde || hasta) {
        if (!esGerencia(sesion)) return json({ error: "La planificación la arma gerencia" }, 403);
        if (!FECHA.test(desde || "") || !FECHA.test(hasta || "")) return json({ error: "Fechas inválidas" }, 400);
        const [plan] = (await sbGet(`planes_produccion?empresa_id=eq.${e}&desde=eq.${desde}&hasta=eq.${hasta}&select=*&limit=1`, { sesion })) || [];
        return json({ ok: true, plan: await conItems(sesion, plan) });
      }
      if (!FECHA.test(fecha || "")) return json({ error: "Fecha inválida" }, 400);
      // El confirmado más corto que incluye el día (una semana le gana al mes)
      const planes = (await sbGet(`planes_produccion?empresa_id=eq.${e}&estado=eq.confirmado&desde=lte.${fecha}&hasta=gte.${fecha}&select=*&order=confirmado_at.desc`, { sesion })) || [];
      const plan = planes.sort((a, b) => (a.hasta > b.hasta ? 1 : a.hasta < b.hasta ? -1 : 0) || (b.desde > a.desde ? 1 : -1))[0] || null;
      return json({ ok: true, plan: await conItems(sesion, plan) });
    } catch (err) {
      if (faltaMigracion(err)) return json({ ok: true, plan: null, falta_migracion: true });
      throw err;
    }
  } catch (err) {
    logger.error("[planificacion] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}

export async function POST(request) {
  try {
    const { sesion, response } = await entrar(request);
    if (response) return response;
    if (!esGerencia(sesion)) return json({ error: "La planificación la arma gerencia" }, 403);
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const parsed = validateBody(planProduccionBody, await request.json().catch(() => null));
    if (parsed.response) return parsed.response;
    const d = parsed.data;
    if (d.hasta < d.desde) return json({ error: "El período está al revés" }, 400);
    if (d.items.some((i) => i.fecha < d.desde || i.fecha > d.hasta)) return json({ error: "Hay días fuera del período" }, 400);
    const e = sesion.empresa_id;
    const opts = { sesion };
    const ahora = new Date().toISOString();
    try {
      const [previo] = (await sbGet(`planes_produccion?empresa_id=eq.${e}&desde=eq.${d.desde}&hasta=eq.${d.hasta}&select=id,estado,confirmado_por,confirmado_at&limit=1`, opts)) || [];
      const confirmar = d.estado === "confirmado";
      const fila = {
        empresa_id: e, division_id: d.division_id, tipo: d.tipo, desde: d.desde, hasta: d.hasta, estado: d.estado,
        horas_necesarias: d.horas_necesarias, horas_disponibles: d.horas_disponibles, horas_extra: d.horas_extra,
        dias_extra: d.dias_extra, pendientes: d.pendientes, updated_at: ahora,
        confirmado_por: confirmar ? (sesion.empleado_id || null) : null,
        confirmado_at: confirmar ? ahora : null,
        ...(previo ? {} : { creado_por: sesion.empleado_id || null }),
      };
      const [plan] = (previo
        ? await sbPatch(`planes_produccion?id=eq.${previo.id}&empresa_id=eq.${e}`, fila, opts)
        : await sbPost("planes_produccion", fila, opts)) || [];
      if (!plan?.id) throw new Error("No se pudo guardar el plan");
      await sbDelete(`plan_produccion_items?empresa_id=eq.${e}&plan_id=eq.${plan.id}`, opts);
      if (d.items.length) {
        await sbPost("plan_produccion_items", d.items.map((i) => ({ ...i, plan_id: plan.id, empresa_id: e })), opts);
      }
      broadcastRefresh(e, "planes_produccion");
      return json({ ok: true, plan: { ...plan, items: d.items } });
    } catch (err) {
      if (faltaMigracion(err)) return json({ error: SIN_MIGRACION }, 409);
      throw err;
    }
  } catch (err) {
    logger.error("[planificacion] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}
