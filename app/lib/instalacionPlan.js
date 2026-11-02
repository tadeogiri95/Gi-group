// app/lib/instalacionPlan.js — Cuánto lleva instalar cada OT (planificación
// de la instalación, parte 42; diseño en notes/diseno-gantt-instalacion.md).
//
// Tadeo (02/11): la SEMANA de la planilla es la entrega del proyecto ya
// instalado. Para planificar la instalación hace falta saber cuántos días de
// obra lleva cada OT:
//  - trabajo = gabinetes ÷ gabinetes que instala una persona por día (según el
//    tipo de proyecto) → "días de una persona";
//  - días de obra = ese trabajo ÷ instaladores que van (2 por defecto),
//    redondeado para arriba de a medio día (un dúo puede hacer dos trabajos
//    cortos el mismo día);
//  - gestión lo puede corregir a mano en cada OT (migración 153:
//    proyectos.dias_instalacion y proyectos.personas_instalacion).
// Los parámetros van en la misma config de la planificación
// (config_sistema "planificacion", valor.instalacion).
import { tipoDeOt } from "./tipoProyecto";
import { gabinetesOt } from "./cargaPlanta";
import { leerNumero, normalizarInstalacion, PERSONAS_POR_DEFECTO, LIMITES_INSTALACION } from "./planificacion";

export const AVISO_MIGRACION_153 = "Para corregir la instalación a mano falta correr la migración 153 en Supabase.";
export { PERSONAS_POR_DEFECTO, LIMITES_INSTALACION, normalizarInstalacion };

const numero = (v) => (typeof v === "number" ? v : leerNumero(v));
const dentro = (n, { min, max }) => n != null && Number.isFinite(n) && n >= min && n <= max;

/** null si sirve; si no, el motivo. Vacío sirve (sin cargar). */
export function errorInstalacion(campo, valor, { entero = false } = {}) {
  if (valor == null) return null;
  const l = LIMITES_INSTALACION[campo];
  if (!dentro(valor, l)) return `Entre ${String(l.min).replace(".", ",")} y ${l.max}`;
  if (entero && !Number.isInteger(valor)) return "Sin decimales";
  if (campo === "dias" && !Number.isInteger(valor * 2)) return "De a medio día (por ejemplo 1 o 1,5)";
  return null;
}

/** Redondea para arriba de a medio día (mínimo medio día). */
export const medioDia = (n) => Math.max(0.5, Math.ceil(n * 2 - 1e-9) / 2);

/**
 * Días de instalación de una OT.
 * @param {object} proyecto fila de proyectos (total_modulos, placas, fondos, tipo_proyecto, descripcion, dias_instalacion, personas_instalacion)
 * @param {object} params normalizarParametros(...) (gabinetes por placa del tipo)
 * @param {object} inst normalizarInstalacion(...)
 * @returns {{ gabinetes: number, origenGabinetes: string, tipo: string|null, gabPorDia: number|null, diasPersona: number|null, personas: number, dias: number|null, manual: boolean, personasManual: boolean, sinDato: string|null }}
 *   sinDato: por qué no se pudo calcular (dias = null)
 */
export function diasInstalacion(proyecto, params, inst, { modulosEtiquetas = null } = {}) {
  const cfg = inst || normalizarInstalacion(null);
  const tipo = tipoDeOt(proyecto || {}).id;
  const { gabinetes, origen } = gabinetesOt(proyecto, params, { modulosEtiquetas });
  const pm = numero(proyecto?.personas_instalacion);
  const personasManual = dentro(pm, LIMITES_INSTALACION.personas) && Number.isInteger(pm);
  const personas = personasManual ? pm : cfg.personas_por_ot;
  const gabPorDia = cfg.gab_por_dia?.[tipo || "global"] ?? cfg.gab_por_dia?.global ?? null;
  const base = { gabinetes, origenGabinetes: origen, tipo, gabPorDia, personas, personasManual };

  const dm = numero(proyecto?.dias_instalacion);
  if (dentro(dm, LIMITES_INSTALACION.dias)) {
    return { ...base, diasPersona: dm * personas, dias: dm, manual: true, sinDato: null };
  }
  if (!(gabinetes > 0)) return { ...base, diasPersona: null, dias: null, manual: false, sinDato: "La OT no tiene módulos ni placas para calcular los gabinetes" };
  if (!gabPorDia) return { ...base, diasPersona: null, dias: null, manual: false, sinDato: "Falta cargar cuántos gabinetes instala una persona por día" };
  const diasPersona = gabinetes / gabPorDia;
  return { ...base, diasPersona, dias: medioDia(diasPersona / personas), manual: false, sinDato: null };
}

/** "1 día", "1,5 días", "medio día". */
export function textoDias(n) {
  if (n == null) return "—";
  if (n === 0.5) return "medio día";
  return `${String(Math.round(n * 10) / 10).replace(".", ",")} ${n === 1 ? "día" : "días"}`;
}

/** Lo que se guarda en la OT al corregir a mano: vacío = vuelve a automático. */
export function cuerpoCorreccion({ dias, personas }) {
  const d = numero(dias), p = numero(personas);
  const errores = {
    dias: String(dias ?? "").trim() && d == null ? "Escribí solo el número" : errorInstalacion("dias", d),
    personas: String(personas ?? "").trim() && p == null ? "Escribí solo el número" : errorInstalacion("personas", p, { entero: true }),
  };
  if (errores.dias || errores.personas) return { errores, cuerpo: null };
  return { errores, cuerpo: { dias_instalacion: d, personas_instalacion: p } };
}
