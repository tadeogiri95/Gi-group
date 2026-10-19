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

/** Bandeja de permisos vacía: el mensaje depende del filtro elegido. */
export function bandejaVacia(filtro) {
  switch (filtro) {
    case "pendiente": return { titulo: "Todo al día", detalle: "No hay permisos esperando respuesta." };
    case "aprobado": return { titulo: "Sin permisos aprobados", detalle: "Todavía no aprobaste ningún permiso en este período." };
    case "rechazado": return { titulo: "Sin permisos rechazados", detalle: "No rechazaste ningún permiso en este período." };
    default: return { titulo: "Sin permisos", detalle: "Cuando alguien del equipo pida un permiso, aparece acá." };
  }
}

// ─── Vocabulario único (reforma UX R3) ─────────────────────────────────────
// Un nombre para cada cosa en toda la app. Las pantallas y módulos nuevos
// (Producción, Stock, Compras…) usan estos términos y no otros.
export const VOCABULARIO = {
  tareas: "Tareas",            // no "Actividad", "Mi Jornada", "Registro de actividades"
  ot: "OT",                    // no "Proyecto"; la primera vez, "Orden de trabajo (OT)"
  asistente: "Asistente",      // no "Chat", "bot", "Reglas IA"
  permisos: "Permisos",        // lo que pide el personal (permisos, vacaciones, avisos); no "Inbox", "Bandeja", "Solicitudes"
  pedidosMaterial: "Pedidos de material", // lo que se pide a Compras; "Pedidos" a secas solo adentro de Compras
  equipo: "Equipo",            // no "Personal", "Gestión de personal"
  entrada: "Entrada",          // no "Ingreso"
  salida: "Salida",            // no "Egreso"
  parado: "Parado",            // no "Espera", "Tiempo muerto", "Improductivo"
};

// Roles como los entiende la gente (los valores internos no cambian)
const NOMBRE_ROL = { operativo: "Operario", administrativo: "Administración", gerencial: "Dueño" };

/** Nombre visible del rol. Administración que ve solo su división es "Supervisor". */
export function nombreRol(rol, { soloSuDivision = false } = {}) {
  if (rol === "administrativo" && soloSuDivision) return "Supervisor";
  return NOMBRE_ROL[rol] || "Operario";
}
