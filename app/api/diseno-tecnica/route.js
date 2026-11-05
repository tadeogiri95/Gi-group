// /api/diseno-tecnica — 📐 Mis planillas (Gantt de Diseño y Técnica, parte 50;
// diseño en notes/diseno-gantt-diseno-tecnica.md).
//
//   GET ?mias=1 → lo que le toca a la arquitecta que pregunta en el plan de
//                 Diseño y Técnica de hoy (el mismo cálculo que el Gantt 📐):
//                 sus planillas técnicas en orden y las OT en las que figura
//                 en Diseño. Quien no es arquitecta recibe { es: false }.
// Cualquier empleado puede preguntar (no hace falta ser gestión): solo ve lo
// suyo. Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { safeErrorMessage } from "../../lib/validate";
import { sbGetAll } from "../../lib/sbHelpers";
import { requireModulo } from "../../lib/planEnforcement";
import { logger } from "../../lib/logger";
import { hoyArg } from "../../lib/dates";
import { CLAVE_PLANIFICACION } from "../../lib/planificacion";
import { otsEnPausa } from "../../lib/pausaOt";
import { misPlanillas, planDeEmpresa, renglonCorto } from "../../lib/planDisenoTecnica";

const json = (body, status = 200) => NextResponse.json(body, { status });
const NADA = { ok: true, es: false, nombre: null, pctTecnica: null, tecnica: [], diseno: [] };
const vacio = () => ({ data: [] });

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const sinModulo = await requireModulo(sesion.empresa_id, "proyectos");
    if (sinModulo) return sinModulo;
    if (!sesion.empleado_id) return json(NADA);
    const e = sesion.empresa_id;
    const opts = { sesion };
    const cfg = await sbGetAll(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANIFICACION}&select=valor`, opts).catch(vacio);
    const cfgValor = cfg.data[0]?.valor || null;
    const ids = (cfgValor?.diseno_tecnica?.arquitectas || []).map((a) => String(a?.id ?? ""));
    // Sin ser arquitecta no hace falta armar el plan
    if (!ids.includes(String(sesion.empleado_id))) return json(NADA);
    const [proyectos, divisiones, personal, pausas, ajustes] = await Promise.all([
      sbGetAll(`proyectos?empresa_id=eq.${e}&estado=neq.cerrado&select=*&order=id.asc`, { ...opts, maxFilas: 20000 }),
      sbGetAll(`divisiones?empresa_id=eq.${e}&activa=eq.true&order=orden.asc`, opts).catch(vacio),
      sbGetAll(`empleados?empresa_id=eq.${e}&activo=eq.true&select=id,nombre&order=nombre.asc`, { ...opts, maxFilas: 2000 }).catch(vacio),
      // Sin la 151 no hay pausas
      sbGetAll(`pausas_ot?empresa_id=eq.${e}&select=ot,motivo,detalle,desde,hasta&order=desde.asc`, { ...opts, maxFilas: 20000 }).catch(vacio),
      // "⏱ Necesita más tiempo" de Diseño y Técnica (162)
      sbGetAll(`ajustes_tiempo_ot?empresa_id=eq.${e}&tipo=eq.faltan&etapa=in.(diseno,tecnica)&select=ot,etapa,tipo,horas,pendiente,created_at&order=created_at.asc`, { ...opts, maxFilas: 20000 }).catch(vacio),
    ]);
    const plan = planDeEmpresa({
      proyectos: proyectos.data, divisiones: divisiones.data, cfgValor, personal: personal.data,
      hoy: hoyArg(), pausadas: otsEnPausa(pausas.data), ajustes: ajustes.data,
    });
    const mias = misPlanillas(plan, sesion.empleado_id);
    return json({
      ok: true, es: mias.es, nombre: mias.nombre, pctTecnica: mias.pctTecnica, horasDia: plan.dt.horas_dia,
      tecnica: mias.tecnica.map(renglonCorto), diseno: mias.diseno.map(renglonCorto),
    });
  } catch (err) {
    logger.error("[diseno-tecnica] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}
