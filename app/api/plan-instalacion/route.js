// /api/plan-instalacion — Plan de instalación confirmado (planificación de
// la instalación, parte 44; migración 154).
//
//   GET          → el último plan confirmado de cada división, con sus días
//                  (🔧 Gantt de instalación: cuánto se corrió cada obra)
//   GET ?mio=1   → los días que le tocan al instalador que pregunta, desde
//                  hoy, con la OT, el cliente, la obra y con quién va
//                  (📅 Mis instalaciones)
//   POST         → confirma el plan de la división y borra el anterior.
//                  Gerencia y administración.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { planInstalacionBody } from "../../lib/schemas";
import { sbGet, sbPost, sbDelete } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan } from "../../lib/planEnforcement";
import { requireModuloSesion } from "../../lib/accesosServidor";
import { logger } from "../../lib/logger";
import { hoyArg } from "../../lib/dates";
import { nombreInstalador } from "../../lib/planInstalacion";

const json = (body, status = 200) => NextResponse.json(body, { status });
const SIN_MIGRACION_154 = "Para confirmar el plan de instalación falta correr la migración 154 en Supabase.";
const faltaMigracion = (err) => /planes_instalacion|plan_instalacion_items/.test(String(err?.message));
const TANDA = 1000;

async function entrar(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  const sinModulo = await requireModuloSesion(sesion, "proyectos");
  if (sinModulo) return { response: sinModulo };
  return { sesion };
}

/** El último plan de cada división. */
function ultimos(planes) {
  const m = new Map();
  for (const p of planes || []) {
    const k = p.division_id || "";
    if (!m.has(k) || String(p.confirmado_at) > String(m.get(k).confirmado_at)) m.set(k, p);
  }
  return [...m.values()];
}

export async function GET(request) {
  try {
    const { sesion, response } = await entrar(request);
    if (response) return response;
    const e = sesion.empresa_id;
    const opts = { sesion };
    const q = new URL(request.url).searchParams;
    try {
      const planes = ultimos(await sbGet(`planes_instalacion?empresa_id=eq.${e}&select=id,division_id,confirmado_nombre,confirmado_at&order=confirmado_at.desc&limit=20`, opts));
      if (!planes.length) return json({ ok: true, planes: [], dias: [] });
      const ids = planes.map((p) => p.id).join(",");
      if (q.get("mio")) {
        if (!sesion.empleado_id) return json({ ok: true, dias: [] });
        const hoy = hoyArg();
        const mios = (await sbGet(`plan_instalacion_items?empresa_id=eq.${e}&plan_id=in.(${ids})&empleado_id=eq.${sesion.empleado_id}&fecha=gte.${hoy}&select=obra,ots,fecha,medio&order=fecha.asc,medio.asc&limit=500`, opts)) || [];
        if (!mios.length) return json({ ok: true, dias: [] });
        const fechas = [...new Set(mios.map((i) => i.fecha))];
        const [juntos, proyectos] = await Promise.all([
          sbGet(`plan_instalacion_items?empresa_id=eq.${e}&plan_id=in.(${ids})&fecha=in.(${fechas.join(",")})&select=obra,fecha,medio,empleado_id&limit=5000`, opts),
          sbGet(`proyectos?empresa_id=eq.${e}&ot=in.(${[...new Set(mios.flatMap((i) => i.ots))].map((o) => `"${String(o).replace(/"/g, "")}"`).join(",")})&select=ot,cliente,obra,descripcion`, opts),
        ]);
        const otros = [...new Set((juntos || []).map((j) => j.empleado_id).filter((id) => id && id !== sesion.empleado_id))];
        const gente = otros.length ? ((await sbGet(`empleados?empresa_id=eq.${e}&id=in.(${otros.join(",")})&select=id,nombre,apodo`, opts)) || []) : [];
        const nombre = new Map(gente.map((g) => [g.id, nombreInstalador(g)]));
        const porOt = new Map((proyectos || []).map((p) => [String(p.ot), p]));
        const dias = mios.map((i) => ({
          ...i,
          proyectos: i.ots.map((ot) => porOt.get(String(ot)) || { ot }),
          con: [...new Set((juntos || []).filter((j) => j.obra === i.obra && j.fecha === i.fecha && j.medio === i.medio && j.empleado_id && j.empleado_id !== sesion.empleado_id)
            .map((j) => nombre.get(j.empleado_id) || "Instalador"))],
        }));
        return json({ ok: true, dias });
      }
      const items = (await sbGet(`plan_instalacion_items?empresa_id=eq.${e}&plan_id=in.(${ids})&select=plan_id,obra,ots,fecha,medio,empleado_id,orden&order=fecha.asc,medio.asc&limit=20000`, opts)) || [];
      return json({ ok: true, planes: planes.map((p) => ({ ...p, items: items.filter((i) => i.plan_id === p.id) })) });
    } catch (err) {
      if (faltaMigracion(err)) return json({ ok: true, planes: [], dias: [], falta_migracion: true });
      throw err;
    }
  } catch (err) {
    logger.error("[plan-instalacion] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}

export async function POST(request) {
  try {
    const { sesion, response } = await entrar(request);
    if (response) return response;
    if (!ROLES_GESTION.has(sesion.rol)) return json({ error: "El plan de instalación lo confirma gerencia o administración" }, 403);
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const parsed = validateBody(planInstalacionBody, await request.json().catch(() => null));
    if (parsed.response) return parsed.response;
    const d = parsed.data;
    const e = sesion.empresa_id;
    const opts = { sesion };
    try {
      const [yo] = sesion.empleado_id ? ((await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre,apodo&limit=1`, opts)) || []) : [];
      const [plan] = (await sbPost("planes_instalacion", {
        empresa_id: e, division_id: d.division_id, confirmado_por: sesion.empleado_id || null,
        confirmado_nombre: yo ? (yo.apodo || yo.nombre || null) : null,
      }, opts)) || [];
      if (!plan?.id) throw new Error("No se pudo confirmar el plan");
      for (let i = 0; i < d.items.length; i += TANDA) {
        await sbPost("plan_instalacion_items", d.items.slice(i, i + TANDA).map((x) => ({ ...x, plan_id: plan.id, empresa_id: e })), opts);
      }
      // Vale solo el último de la división
      const division = d.division_id ? `eq.${encodeURIComponent(d.division_id)}` : "is.null";
      await sbDelete(`planes_instalacion?empresa_id=eq.${e}&division_id=${division}&id=neq.${plan.id}`, opts);
      broadcastRefresh(e, "planes_instalacion");
      return json({ ok: true, plan: { ...plan, items: d.items } });
    } catch (err) {
      if (faltaMigracion(err)) return json({ error: SIN_MIGRACION_154 }, 409);
      throw err;
    }
  } catch (err) {
    logger.error("[plan-instalacion] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}
