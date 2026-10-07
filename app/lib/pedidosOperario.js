// app/lib/pedidosOperario.js — Pedidos que el operario le hace a gerencia
// cuando un fichaje queda bloqueado o le corresponde hora extra. Los usan el
// chat y el botón grande de fichar (D6), así se comportan igual.
import { sb } from "./supabase";
import { sendPushToRole } from "./push";
import { fmtTime } from "./theme";
import { hoyArg } from "./dates";

// Cada pedido = una solicitud + un aviso en la bandeja de gerencia + un push.
async function pedir(usuario, { solicitud, aviso, push }) {
  await sb.post("solicitudes", {
    empleado_id: usuario.id, legajo: usuario.legajo, nombre_empleado: usuario.nombre,
    estado: "pendiente", empresa_id: usuario.empresa_id, ...solicitud,
  });
  await sb.post("notificaciones", { destinatario_rol: "gerencial", tipo: "solicitud", empresa_id: usuario.empresa_id, ...aviso });
  sendPushToRole("gerencial", push.titulo, push.texto, { empresa_id: usuario.empresa_id }).catch(() => {});
}

/** Ingreso bloqueado por tardanza: pide autorización para fichar. */
export async function pedirPermisoIngreso(usuario, ahora = new Date()) {
  const fecha = hoyArg(ahora);
  const hora = fmtTime(ahora);
  await pedir(usuario, {
    solicitud: { tipo: "permiso", motivo: `🔓 Permiso de INGRESO por bloqueo (${hora})`, fecha, desde: hora, hasta: "—" },
    aviso: { asunto: `🔓 ${usuario.apodo} solicita permiso de INGRESO`, detalle: `Ingreso bloqueado a las ${hora}. Requiere autorización para fichar.`, urgencia: "alta" },
    push: { titulo: "🔓 Permiso de ingreso", texto: `${usuario.apodo} solicita autorización para ingresar (${hora})` },
  });
  return { fecha, hora, motivo: "🔓 Permiso de INGRESO por bloqueo" };
}

/** Salida antes del fin de la grilla con la regla de permiso activa (D22). */
export async function pedirSalidaAnticipada(usuario, ahora = new Date()) {
  const fecha = hoyArg(ahora);
  const hora = fmtTime(ahora);
  await pedir(usuario, {
    solicitud: { tipo: "salida_anticipada", motivo: `🚪 Permiso de SALIDA anticipada (pidió a las ${hora})`, fecha, desde: hora, hasta: "—" },
    aviso: { asunto: `🚪 ${usuario.apodo} pide salir antes`, detalle: `Quiere retirarse a las ${hora}, antes del fin de su jornada.`, urgencia: "alta" },
    push: { titulo: "🚪 Permiso de salida", texto: `${usuario.apodo} pide retirarse antes (${hora})` },
  });
  return { fecha, hora, motivo: "🚪 Permiso de salida anticipada" };
}

/** Llegó tarde pero trabajó más que la jornada: pide aprobar la hora extra (F1-06). */
export async function pedirHoraExtra(usuario, ahora = new Date()) {
  const fecha = hoyArg(ahora);
  await pedir(usuario, {
    solicitud: { tipo: "hora_extra", motivo: "Solicitud de hora extra — llegó tarde pero trabajó más de la jornada habitual", fecha },
    aviso: { asunto: `${usuario.apodo} solicita hora extra`, detalle: "Llegó tarde pero trabajó más tiempo que su jornada habitual.", urgencia: "normal" },
    push: { titulo: "🕐 Hora extra", texto: `${usuario.apodo} solicita aprobación de hora extra` },
  });
  return { fecha, motivo: "Hora extra" };
}
