// app/lib/modulos.js — Catálogo de módulos y cuáles tiene cada empresa (ítem 36, D1).
//
// Qué módulos tiene una empresa sale de tres fuentes, en este orden:
//   1. su plan (app/lib/plans.js: cada plan trae sus módulos),
//   2. sus add-ons (empresa.addons: p. ej. "campo" suma "obra"),
//   3. sus ajustes propios (tabla empresa_modulos, migración 083): un módulo
//      dado a mano a un cliente (activo = true) o uno que se le saca (activo =
//      false), con su configuración (config jsonb). Con activo vacío (131) la
//      fila no cambia lo contratado.
// Sin ajustes, la empresa tiene exactamente lo de su plan y add-ons.
//
// Aparte de lo contratado, la empresa puede apagar desde Más → Módulos lo que
// no usa (empresa_modulos.apagado, migración 131): un módulo apagado no se ve
// en ningún lado (ni con candado) y el servidor lo trata como si no estuviera.
// Lo que no contrató sí se ve con 🔒.
//
// El catálogo vive acá (con nombres para la app) y en la tabla `modulos` de la
// base (para las claves foráneas); un test controla que coincidan.

import { capacidades, ADDONS, planSiguiente } from "./plans";

export const MODULOS = {
  fichaje:       { id: "fichaje",       nombre: "Fichaje",               disponible: true,  descripcion: "Entrada y salida con botón, QR, PIN, kiosco y GPS." },
  chat:          { id: "chat",          nombre: "Asistente",             disponible: true,  descripcion: "Chat con el asistente para consultas, solicitudes y avisos." },
  reportes:      { id: "reportes",      nombre: "Reportes y liquidación", disponible: true, descripcion: "Horas trabajadas, llegadas tarde, ausencias y liquidación." },
  calendario:    { id: "calendario",    nombre: "Horarios y calendario", disponible: true,  descripcion: "Turnos planificados y notas en el calendario." },
  actividad:     { id: "actividad",     nombre: "Avance de producción",  disponible: true,  descripcion: "Escaneo de piezas, avance por etapa, carga, actas, instalaciones y reportes de producción." },
  proyectos:     { id: "proyectos",     nombre: "Órdenes de trabajo",    disponible: true,  descripcion: "OT con sus etapas, clientes y obras." },
  stock:         { id: "stock",         nombre: "Stock",                 disponible: true,  descripcion: "Artículos, etiquetas QR, retiros de material y movimientos." },
  compras:       { id: "compras",       nombre: "Compras",               disponible: true,  descripcion: "Pedidos de material, órdenes de compra, recepción y facturas." },
  flota:         { id: "flota",         nombre: "Flota",                 disponible: true,  descripcion: "Vehículos, papeles, checklist, alertas y arreglos." },
  obra:          { id: "obra",          nombre: "Trabajo en campo",      disponible: true,  descripcion: "Reportes de obra desde el celular." },
  // Próximos (fase 7, horizonte 3): todavía no se pueden activar
  produccion:    { id: "produccion",    nombre: "Órdenes de producción", disponible: false, descripcion: "Rutas, partes de trabajo, avance y costeo." },
  calidad:       { id: "calidad",       nombre: "Calidad",               disponible: false, descripcion: "Inspecciones y no conformidades." },
  mantenimiento: { id: "mantenimiento", nombre: "Mantenimiento",         disponible: false, descripcion: "Activos, preventivo, correctivo y paradas." },
};

// Módulos que vienen con otro: Stock, Compras y Flota se contratan con las OT
// (plan Planta) y cada uno se puede apagar por separado.
export const INCLUIDOS_CON = { proyectos: ["stock", "compras", "flota"] };

// Lo que la empresa no puede apagar: sin fichaje la app no tiene sentido
export const SIEMPRE_PRENDIDOS = ["fichaje"];

const ordenCatalogo = (set) => Object.keys(MODULOS).filter((m) => set.has(m));

/**
 * Módulos contratados: plan, add-ons y lo dado o sacado a mano (sin mirar lo
 * que la empresa apagó).
 * @param {{ plan: string, addons?: string[], ajustes?: { modulo: string, activo: boolean }[] }} p
 * @returns {string[]} ids, en el orden del catálogo
 */
export function modulosContratados({ plan, addons = [], ajustes = [] }) {
  const lista = Array.isArray(ajustes) ? ajustes : [];
  const sacados = new Set(lista.filter((a) => MODULOS[a?.modulo] && a.activo === false).map((a) => a.modulo));
  const set = new Set(capacidades(plan, addons).modulos);
  for (const a of lista) {
    // activo vacío (null): la fila es solo de la empresa (apagado), no un ajuste del contrato
    if (MODULOS[a?.modulo]?.disponible && a.activo === true) set.add(a.modulo);
  }
  for (const [base, incluidos] of Object.entries(INCLUIDOS_CON)) {
    if (set.has(base) && !sacados.has(base)) incluidos.forEach((m) => set.add(m));
  }
  sacados.forEach((m) => set.delete(m));
  return ordenCatalogo(set);
}

/** Contratados que la empresa apagó desde Más → Módulos. */
export function modulosApagados({ plan, addons = [], ajustes = [] }) {
  const contratados = new Set(modulosContratados({ plan, addons, ajustes }));
  const apagados = new Set(
    (Array.isArray(ajustes) ? ajustes : [])
      .filter((a) => a?.apagado === true && contratados.has(a.modulo) && !SIEMPRE_PRENDIDOS.includes(a.modulo))
      .map((a) => a.modulo)
  );
  return ordenCatalogo(apagados);
}

/**
 * Módulos que la empresa tiene en la práctica: lo contratado menos lo apagado.
 * @param {{ plan: string, addons?: string[], ajustes?: { modulo: string, activo: boolean, apagado?: boolean }[] }} p
 * @returns {string[]} ids, en el orden del catálogo
 */
export function modulosEfectivos(p) {
  const apagados = new Set(modulosApagados(p));
  return modulosContratados(p).filter((m) => !apagados.has(m));
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

/** ¿La empresa apagó el módulo? Entonces no se muestra, ni siquiera con candado. */
export function moduloApagado(empresa, modulo) {
  return Array.isArray(empresa?.modulos_apagados) && empresa.modulos_apagados.includes(modulo);
}

// Registro de tareas ("Iniciar Tarea" del operario). Se sacó en 2026-10: el
// avance se mide escaneando piezas. Lo que se calculaba con esas tareas
// (producción en vivo, parados, productividad, horas y costo por etapa y por
// OT) se oculta porque quedaría vacío. Si vuelve "Iniciar Tarea", poner true.
export const REGISTRO_TAREAS = false;

/** ¿Se muestran las pantallas que leen el registro de tareas? */
export function conRegistroTareas(empresa) {
  return REGISTRO_TAREAS && tieneModulo(empresa, "actividad");
}

/** Cómo sumar un módulo que falta: { upgrade_a, error } (add-on, Planta o el tramo siguiente). */
export function comoSumarModulo(plan, modulo) {
  const nombre = MODULOS[modulo]?.nombre || modulo;
  const addon = Object.values(ADDONS).find((a) => a.modulos.includes(modulo));
  if (addon) return { upgrade_a: addon.id, error: `${nombre} es parte del add-on ${addon.nombre}. Sumalo desde Facturación.` };
  if (modulo === "proyectos" || modulo === "actividad" || INCLUIDOS_CON.proyectos.includes(modulo)) {
    return { upgrade_a: planSiguiente(plan, { necesitaPlanta: true }), error: `${nombre} es parte del plan Planta.` };
  }
  return { upgrade_a: planSiguiente(plan), error: `Tu plan no incluye ${nombre}.` };
}

// Secciones de Gestión que son de un módulo (ítem 36); las demás son de todos
export const MODULO_SECCION_GESTION = {
  proyectos: "proyectos",
  calendario: "calendario",
  reportes: "reportes",
  reglas: "chat",
};

/** ¿Esa sección de Gestión va con candado para esta empresa? */
export function seccionBloqueada(seccion, empresa) {
  const modulo = MODULO_SECCION_GESTION[seccion];
  return !!modulo && !tieneModulo(empresa, modulo);
}

/** ¿Esa sección es de un módulo que la empresa apagó? Entonces no se muestra. */
export function seccionApagada(seccion, empresa) {
  const modulo = MODULO_SECCION_GESTION[seccion];
  return !!modulo && moduloApagado(empresa, modulo);
}
