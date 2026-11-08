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

const MAX_LOTE = 60;
const lote = (ots) => ots.map((o) => `%22${encodeURIComponent(o)}%22`).join(",");
const porOt = (filas, campo = "ot") => {
  const m = new Map();
  for (const f of filas || []) {
    const k = String(f[campo]);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  return m;
};

/**
 * Horas-persona de varias OT a la vez (para el reporte de costo, parte F):
 * lo que es de toda la empresa se lee una sola vez.
 * @param {string} empresaId
 * @param {object[]} proyectos filas de proyectos (con select=*)
 * @param {{ ahora?: Date }} [opts]
 * @returns {Promise<Map<string, { ot, filas, total, sinGantt: boolean }>>}
 */
export async function horasDeOts(empresaId, proyectos, { ahora = new Date() } = {}) {
  const e = empresaId;
  const out = new Map();
  if (!proyectos?.length) return out;
  const operarios = (extra) => sbGetAll(`empleados?empresa_id=eq.${e}&activo=eq.true&rol=eq.operativo&select=id,rol,division,diagrama,activo${extra}`, { maxFilas: 5000 });
  const [etapas, divisiones, cfg, emp] = await Promise.all([
    sbGetAll(`etapas?empresa_id=eq.${e}&activa=eq.true&order=orden.asc`).catch(vacio),
    sbGetAll(`divisiones?empresa_id=eq.${e}&activa=eq.true&order=orden.asc`).catch(vacio),
    sbGetAll(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANIFICACION}&select=valor`).catch(vacio),
    operarios(",puesto_planta").catch(() => operarios("")).catch(vacio),
  ]);
  const cfgValor = cfg.data[0]?.valor || null;
  const params = normalizarParametros(cfgValor);
  const etapasCodigo = etapasPlanDe(etapas.data, divisionPlan(divisiones.data, params.division_id), params.etapas);
  const ventanas = ventanasDeGrilla(emp.data, divisiones.data, cfgValor);

  for (let i = 0; i < proyectos.length; i += MAX_LOTE) {
    const grupo = proyectos.slice(i, i + MAX_LOTE);
    const ots = grupo.map((p) => String(p.ot));
    const l = lote(ots);
    const [piezas, avance, manual, pausas, pasos, tareas, manuales] = await Promise.all([
      sbGetAll(`v_avance_piezas?empresa_id=eq.${e}&ot=in.(${l})&select=ot,etapa,total,pasaron,primer_paso,ultimo_paso`).catch(vacio),
      sbGetAll(`avance_etapas?empresa_id=eq.${e}&ot=in.(${l})&select=ot,etapa,estado,terminada_at,aprobada_at`).catch(vacio),
      sbGetAll(`avance_manual_historial?empresa_id=eq.${e}&ot=in.(${l})&select=ot,etapa,pct,creado_por,created_at&order=created_at.asc`).catch(vacio),
      // Sin la 151 no hay pausas: cuenta todo
      sbGetAll(`pausas_ot?empresa_id=eq.${e}&ot=in.(${l})&select=ot,desde,hasta&order=desde.asc`).catch(vacio),
      sbGetAll(`pasos_pieza?empresa_id=eq.${e}&ot=in.(${l})&select=ot,etapa,empleado_id&order=id.asc`, { maxFilas: 200000 }).catch(vacio),
      sbGetAll(`registro_actividades?empresa_id=eq.${e}&codigo_proyecto=in.(${l})&select=id,empleado_id,legajo,fecha,hora_inicio,hora_fin,etapa,tipo,causa,cantidad,duracion_min,codigo_proyecto&order=hora_inicio.asc`).catch(vacio),
      sbGetAll(`horas_ot?empresa_id=eq.${e}&ot=in.(${l})&select=ot,etapa,presupuestadas,reales,cambiado_por_nombre,updated_at`),
    ]);
    const lt = leadTimeProcesos({
      ots, etapasCodigo, piezas: piezas.data, manual: manual.data, avance: avance.data,
      proyectos: grupo, ventanas, pausas: pausas.data, ahora,
    });
    const pasosDe = porOt(pasos.data), manualDe = porOt(manual.data), tareasDe = porOt(tareas.data, "codigo_proyecto"), manualesDe = porOt(manuales.data);
    for (const proyecto of grupo) {
      const ot = String(proyecto.ot);
      const tareasMin = {};
      for (const et of resumirOp(tareasDe.get(ot) || [], { etapas: etapas.data, ahora: ahora.getTime() }).etapas || []) tareasMin[et.codigo] = et.min;
      const presupuesto = presupuestoAutomatico(proyecto, params);
      const reales = realesAutomaticas({ etapasCodigo, leadTime: lt.get(ot) || null, pasos: pasosDe.get(ot) || [], manual: manualDe.get(ot) || [], tareasMin });
      out.set(ot, { ot, ...tablaHoras({ presupuesto, reales, manuales: manualesDe.get(ot) || [] }), sinGantt: presupuesto === null });
    }
  }
  return out;
}

/**
 * @param {string} empresaId
 * @param {string} ot
 * @param {{ ahora?: Date }} [opts]
 * @returns {Promise<{ ot, filas, total, sinGantt: boolean } | null>} null si la OT no existe
 */
export async function horasDeOt(empresaId, ot, { ahora = new Date() } = {}) {
  const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${empresaId}&ot=eq.${encodeURIComponent(ot)}&select=*&limit=1`)) || [];
  if (!proyecto) return null;
  return (await horasDeOts(empresaId, [proyecto], { ahora })).get(String(proyecto.ot)) || null;
}
