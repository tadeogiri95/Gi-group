// app/lib/horasOtServidor.js — Lee todo lo que hace falta para las
// horas-persona de una OT (costo de OT, parte E; app/lib/horasOt.js). Lo usa
// /api/horas-ot (y el cierre del costo, parte C). Va con la clave del
// servidor: la ruta ya verificó el permiso y todo se filtra por la empresa.
import { sbGet, sbGetAll } from "./sbHelpers";
import { CLAVE_PLANIFICACION, divisionPlan, etapasPlanDe, normalizarParametros } from "./planificacion";
import { leadTimeProcesos, ventanasDeGrilla } from "./leadTimeHoras";
import { resumirOp } from "./detalleOp";
import { presupuestoAutomatico, realesAutomaticas, tablaHoras } from "./horasOt";

const vacio = () => ({ data: [] });

/** ¿El error es porque falta la migración 166? */
export const faltaMigracionHoras = (err) => String(err?.message).includes("horas_ot");

/**
 * @param {string} empresaId
 * @param {string} ot
 * @param {{ ahora?: Date }} [opts]
 * @returns {Promise<{ ot, filas, total, sinGantt: boolean } | null>} null si la OT no existe
 */
export async function horasDeOt(empresaId, ot, { ahora = new Date() } = {}) {
  const e = empresaId;
  const o = encodeURIComponent(ot);
  const operarios = (extra) => sbGetAll(`empleados?empresa_id=eq.${e}&activo=eq.true&rol=eq.operativo&select=id,rol,division,diagrama,activo${extra}`, { maxFilas: 5000 });
  const [[proyecto], etapas, divisiones, cfg, emp, piezas, avance, manual, pausas, pasos, tareas, manuales] = await Promise.all([
    sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${o}&select=*&limit=1`).then((r) => r || []),
    sbGetAll(`etapas?empresa_id=eq.${e}&activa=eq.true&order=orden.asc`).catch(vacio),
    sbGetAll(`divisiones?empresa_id=eq.${e}&activa=eq.true&order=orden.asc`).catch(vacio),
    sbGetAll(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANIFICACION}&select=valor`).catch(vacio),
    operarios(",puesto_planta").catch(() => operarios("")).catch(vacio),
    sbGetAll(`v_avance_piezas?empresa_id=eq.${e}&ot=eq.${o}&select=ot,etapa,total,pasaron,primer_paso,ultimo_paso`).catch(vacio),
    sbGetAll(`avance_etapas?empresa_id=eq.${e}&ot=eq.${o}&select=ot,etapa,estado,terminada_at,aprobada_at`).catch(vacio),
    sbGetAll(`avance_manual_historial?empresa_id=eq.${e}&ot=eq.${o}&select=ot,etapa,pct,creado_por,created_at&order=created_at.asc`).catch(vacio),
    // Sin la 151 no hay pausas: cuenta todo
    sbGetAll(`pausas_ot?empresa_id=eq.${e}&ot=eq.${o}&select=ot,desde,hasta&order=desde.asc`).catch(vacio),
    sbGetAll(`pasos_pieza?empresa_id=eq.${e}&ot=eq.${o}&select=etapa,empleado_id&order=id.asc`, { maxFilas: 50000 }).catch(vacio),
    sbGetAll(`registro_actividades?empresa_id=eq.${e}&codigo_proyecto=eq.${o}&select=id,empleado_id,legajo,fecha,hora_inicio,hora_fin,etapa,tipo,causa,cantidad,duracion_min&order=hora_inicio.asc`).catch(vacio),
    sbGet(`horas_ot?empresa_id=eq.${e}&ot=eq.${o}&select=etapa,presupuestadas,reales,cambiado_por_nombre,updated_at`),
  ]);
  if (!proyecto) return null;

  const cfgValor = cfg.data[0]?.valor || null;
  const params = normalizarParametros(cfgValor);
  const etapasCodigo = etapasPlanDe(etapas.data, divisionPlan(divisiones.data, params.division_id), params.etapas);
  const lt = leadTimeProcesos({
    ots: [String(proyecto.ot)], etapasCodigo, piezas: piezas.data, manual: manual.data, avance: avance.data,
    proyectos: [proyecto], ventanas: ventanasDeGrilla(emp.data, divisiones.data, cfgValor), pausas: pausas.data, ahora,
  }).get(String(proyecto.ot)) || null;
  const tareasMin = {};
  for (const et of resumirOp(tareas.data, { etapas: etapas.data, ahora: ahora.getTime() }).etapas || []) tareasMin[et.codigo] = et.min;

  const presupuesto = presupuestoAutomatico(proyecto, params);
  const reales = realesAutomaticas({ etapasCodigo, leadTime: lt, pasos: pasos.data, manual: manual.data, tareasMin });
  const tabla = tablaHoras({ presupuesto, reales, manuales: manuales || [] });
  return { ot: String(proyecto.ot), ...tabla, sinGantt: presupuesto === null };
}
