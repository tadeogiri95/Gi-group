// app/lib/panelProduccionServidor.js — Lee lo que necesita el Panel de
// control de la producción (app/lib/panelProduccion.js) y lo arma. Lo usa
// /api/reportes/panel con el pase del usuario ({ sesion }). Sin cada
// migración, ese dato queda vacío y el resto del panel sale igual.
import { sbGetAll } from "./sbHelpers";
import { cargarPlanVivo } from "./informeProduccionServidor";
import { armarPanel, semanasPanel } from "./panelProduccion";
import { normalizarDefectos, CLAVE_DEFECTOS } from "./calidad";
import { hoyArg } from "./dates";
import { valoresDeOts } from "./valorOtServidor";

const vacio = () => ({ data: [] });
const DIA = 86400000;

/**
 * @param {string} empresaId
 * @param {string} fecha un día de la semana elegida (AAAA-MM-DD)
 * @param {{ sesion?: object, conPrecios?: boolean, ahora?: Date }} [opts]
 */
export async function panelDeEmpresa(empresaId, fecha, { sesion, conPrecios = false, ahora = new Date() } = {}) {
  const e = empresaId;
  const opts = { sesion };
  const hoy = hoyArg(ahora);
  const semanas = semanasPanel(fecha);
  const desde = semanas[0].desde;
  const hasta = semanas[semanas.length - 1].hasta;
  const desdeTs = encodeURIComponent(new Date(Date.parse(`${desde}T00:00:00-03:00`)).toISOString());
  // Las fallas de antes también: una máquina puede seguir parada desde antes
  const desdeFallas = encodeURIComponent(new Date(Date.parse(`${desde}T00:00:00-03:00`) - 120 * DIA).toISOString());
  const [base, pasos, manual, cargas, bultos, reportes, actas, precios, nc, defectos, pendientes, maquinas, tareas, registros, fallas] = await Promise.all([
    cargarPlanVivo(e, { sesion, hoy }),
    sbGetAll(`pasos_pieza?empresa_id=eq.${e}&requerida=eq.true&created_at=gte.${desdeTs}&select=ot,etapa,created_at&order=id.asc`, { ...opts, maxFilas: 200000 }).catch(vacio),
    sbGetAll(`avance_manual_historial?empresa_id=eq.${e}&select=ot,etapa,pct,created_at&order=created_at.asc`, { ...opts, maxFilas: 50000 }).catch(vacio),
    sbGetAll(`cargas_ot?empresa_id=eq.${e}&select=ot,firma_carga_at`, opts).catch(vacio),
    sbGetAll(`bultos_ot?empresa_id=eq.${e}&cargado=eq.true&select=ot,cargado_at`, { ...opts, maxFilas: 20000 }).catch(vacio),
    sbGetAll(`reportes_instalacion?empresa_id=eq.${e}&select=ot,avance,created_at`, { ...opts, maxFilas: 20000 }).catch(vacio),
    sbGetAll(`actas_ot?empresa_id=eq.${e}&firmada_at=not.is.null&select=ot,firmada_at`, opts).catch(vacio),
    // El valor de las OT solo para quien ve precios: el PRECIO del Plan o, si
    // no tiene, estimado por materiales (23/11; sin la 142, nada)
    conPrecios ? valoresDeOts(sesion, e).catch(() => null) : Promise.resolve(null),
    sbGetAll(`no_conformidades?empresa_id=eq.${e}&created_at=gte.${desdeTs}&select=ot,defecto,cantidad,created_at`, { ...opts, maxFilas: 20000 }).catch(vacio),
    sbGetAll(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_DEFECTOS}&select=valor`, opts).catch(vacio),
    sbGetAll(`pendientes_obra?empresa_id=eq.${e}&select=ot,resuelto,created_at`, { ...opts, maxFilas: 20000 }).catch(vacio),
    sbGetAll(`maquinas?empresa_id=eq.${e}&activo=eq.true&order=id.asc`, opts).catch(vacio),
    sbGetAll(`maquina_tareas?empresa_id=eq.${e}&activa=eq.true&order=id.asc`, opts).catch(vacio),
    sbGetAll(`maquina_registros?empresa_id=eq.${e}&order=fecha.desc,id.desc`, { ...opts, maxFilas: 5000 }).catch(vacio),
    sbGetAll(`maquina_fallas?empresa_id=eq.${e}&created_at=gte.${desdeFallas}&order=created_at.desc,id.desc`, { ...opts, maxFilas: 5000 }).catch(vacio),
  ]);
  return armarPanel({
    base, pasos: pasos.data, manual: manual.data, cargas: cargas.data, bultos: bultos.data, reportes: reportes.data, actas: actas.data,
    precios: precios ? new Map([...precios].map(([ot, v]) => [ot, v.valor])) : null,
    estimadas: precios ? new Set([...precios].filter(([, v]) => v.estimado).map(([ot]) => ot)) : new Set(),
    noConformidades: nc.data, defectos: normalizarDefectos(defectos.data[0]?.valor?.lista), pendientes: pendientes.data,
    maquinas: maquinas.data, tareasMaquinas: tareas.data, registrosMaquinas: registros.data, fallas: fallas.data,
    fecha, hoy, ahora,
  });
}
