// app/lib/solicitudes.js — Qué escribir al aprobar o rechazar una solicitud.
// Lo usa POST /api/solicitudes/resolver, que guarda todo junto con la función
// resolver_solicitud (migración 086): la solicitud, la fichada del permiso de
// ingreso, la hora extra y el aviso al empleado.
import { horasExtraAprobables } from "./calc";
import { nombreSolicitud } from "./tiposSolicitud";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * F1-06: al aprobar una hora extra, se carga en la fichada de esa jornada.
 * Se busca la última fichada cerrada hasta la fecha de la solicitud (en turno
 * noche la fichada queda con la fecha del ingreso, el día anterior).
 * Solo lee: la escritura va en la misma transacción que la aprobación.
 * @param {(path: string) => Promise<any[]>} get - lectura ya acotada a la empresa
 * @returns {Promise<{ fichada_id: string, horas: number } | null>}
 */
export async function buscarHoraExtraAprobable(get, sol) {
  if (!sol?.empleado_id || !FECHA.test(sol.fecha || "")) return null;
  const [fichada] = await get(
    `fichadas?empleado_id=eq.${sol.empleado_id}&fecha=lte.${sol.fecha}&egreso=not.is.null&select=id,fecha,ingreso,egreso&order=fecha.desc&limit=1`
  ) || [];
  if (!fichada) return null;
  const [emp] = await get(`empleados?id=eq.${sol.empleado_id}&select=diagrama&limit=1`) || [];
  const horas = horasExtraAprobables({ fecha: fichada.fecha, ingreso: fichada.ingreso, egreso: fichada.egreso, diagrama: emp?.diagrama });
  return horas > 0 ? { fichada_id: fichada.id, horas } : null;
}

export const esPermisoIngreso = (sol) =>
  !!(sol?.motivo?.includes("🔓") || sol?.motivo?.toLowerCase().includes("permiso de ingreso"));

const esCambioHorario = (sol) =>
  sol?.tipo === "cambio_horario" || !!sol?.motivo?.toLowerCase().includes("cambio de horario");

/** Hora de ingreso de un permiso: la del motivo "(08:40", la de "desde" o la de creación. */
export function horaDelPermiso(sol, horaCreacion) {
  const m = sol?.motivo?.match(/\((\d{1,2}:\d{2})/);
  if (m) return m[1].padStart(5, "0");
  if (sol?.desde && /^\d{1,2}:\d{2}$/.test(sol.desde)) return sol.desde.padStart(5, "0");
  return horaCreacion;
}

/**
 * Arma lo que hay que guardar y el aviso. No escribe nada.
 * @param {object} p
 * @param {object} p.sol - la solicitud
 * @param {"aprobado"|"rechazado"} p.estado
 * @param {string} [p.nota] - comentario de quien resuelve
 * @param {string} p.aprobador - apodo de quien resuelve
 * @param {string} p.hoy - fecha local de la empresa (AAAA-MM-DD)
 * @param {string} p.horaCreacion - hora local en que se pidió (HH:MM)
 * @param {{ fichada_id: string, horas: number } | null} [p.horaExtra]
 * @returns {{ fichada: object|null, horasExtra: object|null, notificacion: object, push: { titulo: string, cuerpo: string } }}
 */
export function planResolucion({ sol, estado, nota = "", aprobador, hoy, horaCreacion, horaExtra = null }) {
  const ok = estado === "aprobado";
  const conNota = (texto) => (nota ? `${texto} Comentario: "${nota}"` : texto);
  const destinatario = String(sol.legajo);
  const aviso = (asunto, detalle, titulo, cuerpo) => ({
    fichada: null,
    horasExtra: null,
    notificacion: { destinatario_rol: destinatario, asunto, detalle: conNota(detalle) },
    push: { titulo, cuerpo },
  });

  if (esPermisoIngreso(sol) && ok) {
    const hora = horaDelPermiso(sol, horaCreacion);
    return {
      ...aviso(
        "✅ Ingreso APROBADO — Ya quedaste fichado",
        `${aprobador} aprobó tu ingreso. Se registró tu fichada de las ${hora}.`,
        "✅ Ingreso aprobado",
        `Tu ingreso fue aprobado por ${aprobador}. Fichada registrada a las ${hora}.`,
      ),
      fichada: { empleado_id: sol.empleado_id, legajo: sol.legajo, fecha: hoy, ingreso: hora },
    };
  }
  if (sol.tipo === "salida_anticipada") {
    // El empleado ficha su salida él mismo cuando se va: así las horas son las reales
    return ok
      ? aviso("✅ Salida APROBADA — ya podés fichar tu salida", `${aprobador} aprobó que te retires antes. Cuando te vayas, tocá "Fichar salida" en el inicio.`, "✅ Salida aprobada", "Ya podés fichar tu salida")
      : aviso("❌ Salida anticipada RECHAZADA", `${aprobador} rechazó el permiso para retirarte antes.`, "❌ Salida rechazada", `${aprobador} rechazó tu permiso de salida`);
  }
  if (sol.tipo === "hora_extra" && ok) {
    const detalle = horaExtra ? `${aprobador} aprobó ${horaExtra.horas}h extra; ya figuran en tu fichada.` : `${aprobador} aprobó tu hora extra.`;
    return { ...aviso("✅ Hora extra APROBADA", detalle, "✅ Hora extra aprobada", detalle), horasExtra: horaExtra };
  }
  if (esCambioHorario(sol) && ok) {
    // F1-07: la grilla la ajusta gestión desde Gestión de personal; acá solo se avisa.
    return aviso(
      "✅ Cambio de horario APROBADO",
      `${aprobador} aprobó tu cambio de horario. Vas a ver la grilla nueva cuando la actualicen en Gestión de personal.`,
      "✅ Cambio de horario aprobado",
      `Tu cambio de horario fue aprobado por ${aprobador}.`,
    );
  }
  const nombre = nombreSolicitud(sol);
  return aviso(
    `Solicitud ${ok ? "APROBADA ✅" : "RECHAZADA ❌"}`,
    `${nombre}: "${sol.motivo}" por ${aprobador}`,
    ok ? "✅ Permiso aprobado" : "❌ Permiso rechazado",
    `Tu ${nombre} fue ${ok ? "aprobado" : "rechazado"} por ${aprobador}`,
  );
}
