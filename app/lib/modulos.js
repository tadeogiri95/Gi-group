// app/lib/modulos.js — Catálogo de módulos y cuáles tiene cada empresa (ítem 36, D1).
//
// Qué módulos tiene una empresa sale de tres fuentes, en este orden:
//   1. su plan (app/lib/plans.js: cada plan trae sus módulos),
//   2. sus add-ons (empresa.addons: p. ej. "campo" suma "obra"),
//   3. sus ajustes propios (tabla empresa_modulos, migración 083): un módulo
//      dado a mano a un cliente (activo = true) o uno de su plan que no quiere
//      usar (activo = false), con su configuración (config jsonb).
// Sin ajustes, la empresa tiene exactamente lo de su plan y add-ons.
//
// El catálogo vive acá (con nombres para la app) y en la tabla `modulos` de la
// base (para las claves foráneas); un test controla que coincidan.

import { capacidades, ADDONS, planSiguiente } from "./plans";

export const MODULOS = {
  fichaje:       { id: "fichaje",       nombre: "Fichaje",               disponible: true,  descripcion: "Entrada y salida con botón, QR, PIN, kiosco y GPS." },
  chat:          { id: "chat",          nombre: "Asistente",             disponible: true,  descripcion: "Chat con el asistente para consultas, solicitudes y avisos." },
  reportes:      { id: "reportes",      nombre: "Reportes y liquidación", disponible: true, descripcion: "Horas trabajadas, llegadas tarde, ausencias y liquidación." },
  calendario:    { id: "calendario",    nombre: "Horarios y calendario", disponible: true,  descripcion: "Turnos planificados y notas en el calendario." },
  actividad:     { id: "actividad",     nombre: "Tareas",                disponible: true,  descripcion: "Tareas sobre OT con tiempo improductivo y su causa." },
  proyectos:     { id: "proyectos",     nombre: "Órdenes de trabajo",    disponible: true,  descripcion: "OT con sus etapas, clientes y obras." },
  obra:          { id: "obra",          nombre: "Trabajo en campo",      disponible: true,  descripcion: "Reportes de obra desde el celular." },
  // Próximos (fase 7, horizonte 3): todavía no se pueden activar
  produccion:    { id: "produccion",    nombre: "Órdenes de producción", disponible: false, descripcion: "Rutas, partes de trabajo, avance y costeo." },
  stock:         { id: "stock",         nombre: "Stock",                 disponible: false, descripcion: "Artículos, depósitos y movimientos." },
  compras:       { id: "compras",       nombre: "Compras",               disponible: false, descripcion: "Proveedores, órdenes de compra y recepción." },
  calidad:       { id: "calidad",       nombre: "Calidad",               disponible: false, descripcion: "Inspecciones y no conformidades." },
  mantenimiento: { id: "mantenimiento", nombre: "Mantenimiento",         disponible: false, descripcion: "Activos, preventivo, correctivo y paradas." },
};

/**
 * Módulos que la empresa tiene en la práctica.
 * @param {{ plan: string, addons?: string[], ajustes?: { modulo: string, activo: boolean }[] }} p
 * @returns {string[]} ids, en el orden del catálogo
 */
export function modulosEfectivos({ plan, addons = [], ajustes = [] }) {
  const set = new Set(capacidades(plan, addons).modulos);
  for (const a of Array.isArray(ajustes) ? ajustes : []) {
    if (!MODULOS[a?.modulo]) continue;
    if (a.activo === false) set.delete(a.modulo);
    else if (MODULOS[a.modulo].disponible) set.add(a.modulo);
  }
  return Object.keys(MODULOS).filter((m) => set.has(m));
}

/** Configuración propia de cada módulo ({ modulo: config }), de los ajustes activos. */
export function configModulos(ajustes = []) {
  const out = {};
  for (const a of Array.isArray(ajustes) ? ajustes : []) {
    if (MODULOS[a?.modulo] && a.activo !== false && a.config && typeof a.config === "object") out[a.modulo] = a.config;
  }
  return out;
}

/**
 * ¿La empresa tiene el módulo? Para la app: usa empresa.modulos (lo manda
 * /api/empresa). Si no vino (demo, versión vieja en caché), muestra todo: el
 * servidor es el que bloquea de verdad.
 */
export function tieneModulo(empresa, modulo) {
  return !Array.isArray(empresa?.modulos) || empresa.modulos.includes(modulo);
}

/** Cómo sumar un módulo que falta: { upgrade_a, error } (add-on, Planta o el tramo siguiente). */
export function comoSumarModulo(plan, modulo) {
  const nombre = MODULOS[modulo]?.nombre || modulo;
  const addon = Object.values(ADDONS).find((a) => a.modulos.includes(modulo));
  if (addon) return { upgrade_a: addon.id, error: `${nombre} es parte del add-on ${addon.nombre}. Sumalo desde Facturación.` };
  if (modulo === "proyectos" || modulo === "actividad") {
    return { upgrade_a: planSiguiente(plan, { necesitaPlanta: true }), error: `${nombre} es parte del plan Planta.` };
  }
  return { upgrade_a: planSiguiente(plan), error: `Tu plan no incluye ${nombre}.` };
}

// Secciones de Gestión que son de un módulo (ítem 36); las demás son de todos
export const MODULO_SECCION_GESTION = {
  proyectos: "proyectos",
  calendario: "calendario",
  asistencia: "reportes",
  reglas: "chat",
};

/** ¿Esa sección de Gestión va con candado para esta empresa? */
export function seccionBloqueada(seccion, empresa) {
  const modulo = MODULO_SECCION_GESTION[seccion];
  return !!modulo && !tieneModulo(empresa, modulo);
}
