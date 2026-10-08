// app/lib/tiposSolicitud.js — Tipos de solicitud por empresa (H9, F4-12, ítem 23).
//
// La base de datos acepta un conjunto fijo de tipos (`tipo`). Cada empresa
// elige cuáles ofrece en el formulario, puede renombrarlos y puede crear los
// suyos (p. ej. "Examen", "Donación de sangre") sobre uno de base; el nombre
// elegido se guarda en `etiqueta`.

// Tipos de base que un empleado puede pedir desde el formulario
export const TIPOS_BASE = {
  permiso: { nombre: "Permiso", multiDia: false },
  vacaciones: { nombre: "Vacaciones", multiDia: true },
  ausencia: { nombre: "Ausencia", multiDia: true },
  justificacion: { nombre: "Justificar una falta", multiDia: true },
  cambio_horario: { nombre: "Cambio de horario", multiDia: false },
  otro: { nombre: "Otro", multiDia: true },
};

// Los que cuentan como días de ausencia en la liquidación
export const BASES_AUSENCIA = ["ausencia", "vacaciones"];

export const MAX_TIPOS = 20;
export const MAX_DIAS_SOLICITUD = 90;

const DEFAULT = Object.entries(TIPOS_BASE).map(([base, t]) => ({ clave: base, nombre: t.nombre, base, multiDia: t.multiDia }));

const limpiarNombre = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
const claveDe = (nombre) => limpiarNombre(nombre).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

/**
 * Tipos que ofrece la empresa, listos para el formulario. Ignora lo inválido;
 * sin configuración (o vacía) devuelve los de siempre.
 * @returns {{ clave: string, nombre: string, base: string, multiDia: boolean }[]}
 */
export function tiposDeEmpresa(config) {
  if (!Array.isArray(config)) return DEFAULT;
  const vistos = new Set();
  const tipos = [];
  for (const t of config.slice(0, MAX_TIPOS)) {
    const base = t?.base;
    const nombre = limpiarNombre(t?.nombre);
    if (!Object.hasOwn(TIPOS_BASE, base) || !nombre) continue;
    const clave = claveDe(t.clave || nombre) || base;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    tipos.push({ clave, nombre, base, multiDia: typeof t.multiDia === "boolean" ? t.multiDia : TIPOS_BASE[base].multiDia });
  }
  return tipos.length ? tipos : DEFAULT;
}

/** Nombre a mostrar de una solicitud guardada. */
// Tipos que crea el sistema (chat, aprobaciones) y no se eligen en el formulario
const NOMBRES_SISTEMA = {
  tardanza: "Tardanza",
  hora_extra: "Hora extra",
  horas_extra: "Horas extra",
  salida_anticipada: "Salida anticipada",
  cambio_turno: "Cambio de turno",
};

export function nombreSolicitud(s) {
  if (s?.etiqueta) return s.etiqueta;
  const tipo = s?.tipo;
  const nombre = TIPOS_BASE[tipo]?.nombre || NOMBRES_SISTEMA[tipo];
  if (nombre) return nombre;
  if (!tipo) return "Solicitud";
  // Nunca mostrar un código crudo ("algo_nuevo" → "Algo nuevo")
  const legible = String(tipo).replace(/_/g, " ").trim();
  return legible.charAt(0).toUpperCase() + legible.slice(1);
}

/** Días (inclusive) entre dos fechas YYYY-MM-DD; 0 si el rango es inválido. */
export function diasEntre(desde, hasta) {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta || desde}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Días de la solicitud que caen dentro del período [desde, hasta] (liquidación).
 */
export function diasEnPeriodo(sol, desde, hasta) {
  const ini = sol.fecha > desde ? sol.fecha : desde;
  const fin = (sol.fecha_hasta || sol.fecha) < hasta ? (sol.fecha_hasta || sol.fecha) : hasta;
  return diasEntre(ini, fin);
}

/** "3/10" o "3/10 al 10/10" */
export function rangoTexto(sol) {
  const f = (d) => { const [, m, dd] = String(d).split("-"); return `${Number(dd)}/${Number(m)}`; };
  if (!sol?.fecha) return "";
  return sol.fecha_hasta && sol.fecha_hasta !== sol.fecha ? `${f(sol.fecha)} al ${f(sol.fecha_hasta)}` : f(sol.fecha);
}
