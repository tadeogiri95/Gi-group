// app/lib/solicitudes.js — Efectos de aprobar una solicitud (bandeja de gestión).
import { horasExtraAprobables } from "./calc";

/**
 * F1-06: al aprobar una hora extra, la carga en la fichada de esa jornada.
 * Se busca la última fichada cerrada hasta la fecha de la solicitud (en turno
 * noche la fichada queda con la fecha del ingreso, el día anterior).
 * @param {{ get: Function, patch: Function }} sb - cliente de /api/data
 * @returns {Promise<number>} horas extra cargadas (0 si no correspondía)
 */
export async function cargarHoraExtraAprobada(sb, sol) {
  if (!sol?.empleado_id || !/^\d{4}-\d{2}-\d{2}$/.test(sol.fecha || "")) return 0;
  const [fichada] = await sb.get(
    `fichadas?empleado_id=eq.${sol.empleado_id}&fecha=lte.${sol.fecha}&egreso=not.is.null&select=id,fecha,ingreso,egreso&order=fecha.desc&limit=1`
  ) || [];
  if (!fichada) return 0;
  const [emp] = await sb.get(`empleados?id=eq.${sol.empleado_id}&select=diagrama&limit=1`) || [];
  const horas = horasExtraAprobables({ fecha: fichada.fecha, ingreso: fichada.ingreso, egreso: fichada.egreso, diagrama: emp?.diagrama });
  if (horas > 0) await sb.patch(`fichadas?id=eq.${fichada.id}`, { horas_extra: horas });
  return horas;
}
