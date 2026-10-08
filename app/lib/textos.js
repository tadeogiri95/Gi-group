// app/lib/textos.js — Textos que ve el usuario, en un solo lugar (reforma UX).
// R1 trae los primeros; la etapa de vocabulario único (R3) suma el resto.

/** Un aviso de resolución es de aprobación (verde) y no de rechazo (rojo). */
export function notificacionAprobada(asunto) {
  const t = String(asunto || "");
  return /aprobad[oa]/i.test(t) && !/rechazad[oa]/i.test(t);
}

const SIN_CONEXION = "No hay conexión. Revisá internet y probá de nuevo.";
const MP_CAIDO = "No pudimos conectar con Mercado Pago. Probá de nuevo en unos minutos.";

/**
 * Mensaje para un error de pago o de facturación: el del servidor cuando es
 * para el usuario (4xx con texto); si no, uno claro sin códigos técnicos.
 */
export function mensajeErrorPago({ status, error } = {}) {
  if (status === 0 || status === undefined) return SIN_CONEXION;
  if (status >= 500 || !error) return MP_CAIDO;
  return error;
}

/** Error de red de fetch (sin respuesta del servidor) → texto entendible. */
export function mensajeErrorRed(e, porDefecto = "Algo salió mal. Probá de nuevo.") {
  if (e instanceof TypeError) return SIN_CONEXION;
  return e?.message || porDefecto;
}

/** Bandeja de pedidos vacía: el mensaje depende del filtro elegido. */
export function bandejaVacia(filtro) {
  switch (filtro) {
    case "pendiente": return { titulo: "Todo al día", detalle: "No hay pedidos esperando respuesta." };
    case "aprobado": return { titulo: "Sin pedidos aprobados", detalle: "Todavía no aprobaste ningún pedido en este período." };
    case "rechazado": return { titulo: "Sin pedidos rechazados", detalle: "No rechazaste ningún pedido en este período." };
    default: return { titulo: "Sin pedidos", detalle: "Cuando alguien del equipo pida un permiso, aparece acá." };
  }
}
