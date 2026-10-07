// app/lib/resumenSemanalServidor.js — Consultas del resumen semanal (ítem 31).
import { sbGetAll } from "./sbHelpers";
import { armarResumen, semanaAnterior, TIPOS_QUE_JUSTIFICAN } from "./resumenSemanal";

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria de la empresa. */
export function hoyEn(timezone, ahora = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Argentina/Buenos_Aires" }).format(ahora);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(ahora);
  }
}

export async function resumenDeEmpresa(empresa, ahora = new Date()) {
  const { desde, hasta } = semanaAnterior(hoyEn(empresa.timezone, ahora));
  const e = empresa.id;
  const [actividades, fichadas, solicitudes, empleados, proyectos] = await Promise.all([
    sbGetAll(`registro_actividades?empresa_id=eq.${e}&fecha=gte.${desde}&fecha=lte.${hasta}&select=legajo,codigo_proyecto,etapa,causa,duracion_min,hora_inicio,hora_fin&order=id.asc`),
    sbGetAll(`fichadas?empresa_id=eq.${e}&fecha=gte.${desde}&fecha=lte.${hasta}&select=legajo,fecha,horas_trabajadas,llegada_tarde&order=fecha.asc,id.asc`),
    sbGetAll(`solicitudes?empresa_id=eq.${e}&estado=eq.aprobado&fecha=lte.${hasta}&or=(fecha_hasta.gte.${desde},and(fecha_hasta.is.null,fecha.gte.${desde}))&tipo=in.(${TIPOS_QUE_JUSTIFICAN.join(",")})&select=legajo,fecha,fecha_hasta,tipo&order=id.asc`),
    sbGetAll(`empleados?empresa_id=eq.${e}&activo=eq.true&rol=eq.operativo&select=legajo,nombre,diagrama,created_at&order=legajo.asc`),
    sbGetAll(`proyectos?empresa_id=eq.${e}&select=ot,cliente,proyecto&order=id.asc`, { maxFilas: 5000 }),
  ]);
  return armarResumen({
    desde, hasta,
    actividades: actividades.data, fichadas: fichadas.data, solicitudes: solicitudes.data,
    empleados: empleados.data, proyectos: proyectos.data,
  });
}

