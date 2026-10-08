// app/lib/menuGestion.js — Menú "Más" de gestión (reforma UX R5).
//
// Como máximo dos niveles: la lista y la pantalla. Lo de todos los días va
// arriba y lo que se configura una vez, abajo. Cada sección aparece una sola
// vez; lo que la empresa no contrató se ve con 🔒 y lo que el rol no puede
// usar no se muestra (el supervisor no ve Empresa ni Facturación).
import { seccionBloqueada, tieneModulo } from "./modulos";

/** ¿Se muestra la pestaña "Planta" (producción en vivo + OT)? */
export function conPlanta(empresa) {
  return tieneModulo(empresa, "actividad") || tieneModulo(empresa, "proyectos");
}

export function esSupervisor(usuario) {
  return usuario?.rol === "administrativo" && !!usuario?.solo_su_division;
}

const SECCIONES = [
  { id: "horarios", grupo: "dia", icono: "🕐", label: "Horarios", detalle: "Turnos de cada persona" },
  { id: "calendario", grupo: "dia", icono: "📅", label: "Calendario", detalle: "Feriados, notas y turnos del mes" },
  { id: "reportes", grupo: "dia", icono: "📊", label: "Reportes y liquidación", detalle: "Horas, tardanzas, ausencias y exportar" },
  { id: "proyectos", grupo: "dia", icono: "📋", label: "OT", detalle: "Órdenes de trabajo", soloSinPlanta: true },
  { id: "ubicaciones", grupo: "config", icono: "📍", label: "Ubicaciones y plantas", detalle: "Dónde se puede fichar" },
  { id: "asistencia", grupo: "config", icono: "⏱️", label: "Reglas de asistencia y pedidos", detalle: "Tolerancia, bloqueos y tipos de pedido" },
  { id: "reglas", grupo: "config", icono: "💬", label: "Asistente", detalle: "Cómo responde el asistente al equipo" },
  { id: "documentacion", grupo: "config", icono: "📄", label: "Documentación", detalle: "Papeles que pide la empresa" },
  { id: "admin", grupo: "config", icono: "🏢", label: "Empresa", detalle: "Nombre, logo, colores, divisiones y etapas", sinSupervisor: true },
  { id: "facturacion", grupo: "config", icono: "💳", label: "Plan y facturación", detalle: "Tu plan, pagos y comprobantes", soloDueno: true },
  { id: "privacidad", grupo: "config", icono: "👤", label: "Mi cuenta y privacidad", detalle: "Tus datos y cerrar sesión" },
];

export const GRUPOS = [
  { id: "dia", titulo: "Día a día" },
  { id: "config", titulo: "Configuración" },
];

/** Secciones visibles para esta empresa y este usuario, con su candado. */
export function seccionesMas({ empresa, usuario } = {}) {
  const planta = conPlanta(empresa);
  return SECCIONES
    .filter((s) => !(s.soloSinPlanta && planta))
    .filter((s) => !(s.sinSupervisor && esSupervisor(usuario)))
    .filter((s) => !(s.soloDueno && usuario?.rol !== "gerencial"))
    .map((s) => ({ ...s, bloqueado: seccionBloqueada(s.id, empresa) }));
}

export function seccionPorId(id, opciones) {
  return seccionesMas(opciones).find((s) => s.id === id) || null;
}

/**
 * Destino de navegación "pantalla" o "pantalla:sección" (p. ej. "config:ubicaciones",
 * que usa la lista de primeros pasos para abrir la sección justa).
 */
export function partirDestino(destino) {
  const [pantalla, seccion = null] = String(destino || "home").split(":");
  return { pantalla, seccion };
}
