// app/lib/menuGestion.js — Menú "Más" de gestión (reforma UX R5).
//
// Como máximo dos niveles: la lista y la pantalla. Lo de todos los días va
// arriba y lo que se configura una vez, abajo. Cada sección aparece una sola
// vez; lo que la empresa no contrató se ve con 🔒, lo que apagó en Módulos
// no se ve y lo que el rol no puede usar no se muestra (el supervisor no ve
// Empresa ni Facturación).
import { seccionBloqueada, seccionApagada, tieneModulo } from "./modulos";

// Módulos que van en la pestaña "Planta"
export const MODULOS_PLANTA = ["actividad", "proyectos", "stock", "compras", "flota"];

/** ¿Se muestra la pestaña "Planta" (OT, Stock, Compras, Flota y reportes de producción)? */
export function conPlanta(empresa) {
  return MODULOS_PLANTA.some((m) => tieneModulo(empresa, m));
}

export function esSupervisor(usuario) {
  return usuario?.rol === "administrativo" && !!usuario?.solo_su_division;
}

// "Más" es solo para ajustes (revisión de la interfaz, 2026-10): Horarios,
// Calendario, Reportes y Documentación pasaron a Equipo, y los reportes de
// producción a Planta. Sin Planta, las OT quedan acá.
const SECCIONES = [
  { id: "proyectos", grupo: "dia", icono: "📋", label: "OT", detalle: "Órdenes de trabajo", soloSinPlanta: true },
  { id: "ubicaciones", grupo: "config", icono: "📍", label: "Ubicaciones y plantas", detalle: "Dónde se puede fichar" },
  { id: "asistencia", grupo: "config", icono: "⏱️", label: "Reglas de asistencia y permisos", detalle: "Tolerancia, bloqueos y tipos de permiso" },
  { id: "reglas", grupo: "config", icono: "💬", label: "Asistente", detalle: "Cómo responde el asistente al equipo" },
  { id: "admin", grupo: "config", icono: "🏢", label: "Empresa", detalle: "Nombre, logo, colores, divisiones y etapas", sinSupervisor: true },
  { id: "modulos", grupo: "config", icono: "🧩", label: "Módulos", detalle: "Prendé o apagá lo que usa la empresa", sinSupervisor: true },
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
    .filter((s) => !seccionApagada(s.id, empresa))
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
