// app/lib/reporteDiarioServidor.js — Consultas del reporte del día (parte 26).
// Lo usan /api/reportes/dia (con el pase del usuario) y el cron
// reporte-diario (con service_role).
import { sbGetAll } from "./sbHelpers";
import { armarReporteDiario, limitesDia } from "./reporteDiario";

const vacio = () => ({ data: [] });

/**
 * @param {string} empresaId
 * @param {string} fecha YYYY-MM-DD (día en Argentina)
 * @param {{ sesion?: object }} [opts]
 */
export async function reporteDiarioDeEmpresa(empresaId, fecha, { sesion } = {}) {
  const e = empresaId;
  const opts = { sesion };
  const { inicio } = limitesDia(fecha);
  const desde = encodeURIComponent(inicio);
  const [proyectos, etapas, avancePiezas, pasos, avanceEtapas, reportes] = await Promise.all([
    sbGetAll(`proyectos?empresa_id=eq.${e}&select=ot,cliente,proyecto,fecha_entrega,estado&order=id.asc`, opts),
    sbGetAll(`etapas?empresa_id=eq.${e}&select=codigo,nombre,orden&order=codigo.asc`, opts).catch(vacio),
    // Sin las migraciones 110 a 118 no hay escaneos: el reporte sale sin producción
    sbGetAll(`v_avance_piezas?empresa_id=eq.${e}&select=ot,etapa,total,pasaron`, opts).catch(vacio),
    sbGetAll(`pasos_pieza?empresa_id=eq.${e}&requerida=eq.true&created_at=gte.${desde}&select=ot,etapa,created_at&order=id.asc`, { ...opts, maxFilas: 50000 }).catch(vacio),
    sbGetAll(`avance_etapas?empresa_id=eq.${e}&or=(terminada_at.gte.${desde},aprobada_at.gte.${desde})&select=ot,etapa,estado,terminada_at,aprobada_at`, opts).catch(vacio),
    // Sin la migración 117 no hay reportes de instalación
    sbGetAll(`reportes_instalacion?empresa_id=eq.${e}&fecha=eq.${fecha}&select=id,ot,empleado_id,modulos,avance,comentario,created_at&order=created_at.asc`, opts).catch(vacio),
  ]);
  const ids = reportes.data.map((r) => r.id);
  const quienes = [...new Set(reportes.data.map((r) => r.empleado_id).filter(Boolean))];
  const [pendientes, empleados] = await Promise.all([
    ids.length ? sbGetAll(`pendientes_obra?empresa_id=eq.${e}&reporte_id=in.(${ids.join(",")})&select=reporte_id,descripcion`, opts).catch(vacio) : vacio(),
    quienes.length ? sbGetAll(`empleados?empresa_id=eq.${e}&id=in.(${quienes.join(",")})&select=id,nombre`, opts).catch(vacio) : vacio(),
  ]);
  const nombre = new Map(empleados.data.map((x) => [x.id, x.nombre]));
  return armarReporteDiario({
    fecha,
    proyectos: proyectos.data,
    etapas: etapas.data,
    avancePiezas: avancePiezas.data,
    pasos: pasos.data,
    avanceEtapas: avanceEtapas.data,
    instalacion: reportes.data.map((r) => ({
      ...r,
      empleado: nombre.get(r.empleado_id) || null,
      pendientes: pendientes.data.filter((p) => p.reporte_id === r.id),
    })),
  });
}
