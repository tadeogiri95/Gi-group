// app/lib/disenoTecnicaPlan.js — Tiempos de Diseño y Técnica de cada OT
// (parte 47; diseño en notes/diseno-gantt-diseno-tecnica.md).
//
// Diseño (relevamiento, diseño, aprobación) = días hábiles fijos: los de
// ⚙ Parámetros → 📐 Diseño y Técnica (10 por defecto) o los que se cargan a
// mano en la OT. Técnica = horas de la tabla tipo de proyecto × clase A/B/C
// (app/lib/complejidad.js), o las que se cargan a mano en la OT (migración 160).
// Con eso la parte 48 arma el Gantt de las arquitectas.
import { CLASES_DT, LIMITES_DT, leerNumero, normalizarDisenoTecnica } from "./planificacion";
import { claseDeOt } from "./complejidad";
import { tipoDeOt } from "./tipoProyecto";

export { CLASES_DT, LIMITES_DT, normalizarDisenoTecnica };
export const AVISO_MIGRACION_160 = "Para corregir los tiempos de Diseño y Técnica a mano falta correr la migración 160 en Supabase.";

const numero = (v) => (typeof v === "number" ? v : leerNumero(v));
const dentro = (n, { min, max }) => n != null && Number.isFinite(n) && n >= min && n <= max;
const deAMedio = (n) => Number.isInteger(n * 2);

/** null si sirve; si no, el motivo. Vacío sirve (sin cargar). */
export function errorDisenoTecnica(campo, valor, { entero = false } = {}) {
  if (valor == null) return null;
  const l = LIMITES_DT[campo];
  if (!dentro(valor, l)) return `Entre ${String(l.min).replace(".", ",")} y ${l.max}`;
  if (entero && !Number.isInteger(valor)) return "Sin decimales";
  if (!entero && !deAMedio(valor)) return "De a media unidad (por ejemplo 2 o 2,5)";
  return null;
}

/** Horas de Técnica de la tabla para un tipo y una clase (vacío del tipo = "Sin tipo"). */
export function horasDeTabla(dt, tipo, clase) {
  const h = dt?.horas || {};
  return h[tipo || "global"]?.[clase] ?? h.global?.[clase] ?? null;
}

/**
 * Tiempos de una OT.
 * @param {object} proyecto fila de proyectos (tipo_proyecto, descripcion, clase_auto, clase_complejidad, dias_diseno, horas_tecnica)
 * @param {object} dt normalizarDisenoTecnica(...)
 * @returns {{ tipo: string|null, clase: string, diasDiseno: number, diasManual: boolean, horasTecnica: number|null, horasManual: boolean, diasTecnica: number|null, sinDato: string|null }}
 *   diasTecnica: días de una arquitecta con la jornada de ⚙ Parámetros, de a medio día.
 *   sinDato: por qué no se pudo calcular la Técnica (horasTecnica = null).
 */
export function tiemposOt(proyecto, dt) {
  const cfg = dt || normalizarDisenoTecnica(null);
  const tipo = tipoDeOt(proyecto || {}).id;
  const { clase } = claseDeOt(proyecto || {});
  const dm = numero(proyecto?.dias_diseno);
  const diasManual = dentro(dm, LIMITES_DT.dias_diseno) && deAMedio(dm);
  const hm = numero(proyecto?.horas_tecnica);
  const horasManual = dentro(hm, LIMITES_DT.horas_tecnica) && deAMedio(hm);
  const horasTecnica = horasManual ? hm : horasDeTabla(cfg, tipo, clase);
  return {
    tipo,
    clase,
    diasDiseno: diasManual ? dm : cfg.dias_diseno,
    diasManual,
    horasTecnica,
    horasManual,
    diasTecnica: horasTecnica == null ? null : Math.max(0.5, Math.ceil((horasTecnica / cfg.horas_dia) * 2 - 1e-9) / 2),
    sinDato: horasTecnica == null ? `Falta cargar las horas de Técnica de la clase ${clase} en ⚙ Parámetros → 📐 Diseño y Técnica` : null,
  };
}

/** Lo que se guarda en la OT al corregir a mano: vacío = vuelve a lo de ⚙ Parámetros. */
export function cuerpoTiempos({ dias, horas }) {
  const d = numero(dias), h = numero(horas);
  const errores = {
    dias: String(dias ?? "").trim() && d == null ? "Escribí solo el número" : errorDisenoTecnica("dias_diseno", d),
    horas: String(horas ?? "").trim() && h == null ? "Escribí solo el número" : errorDisenoTecnica("horas_tecnica", h),
  };
  if (errores.dias || errores.horas) return { errores, cuerpo: null };
  return { errores, cuerpo: { dias_diseno: d, horas_tecnica: h } };
}

/** Diseño y Técnica de cada arquitecta en %: { diseno, tecnica }. */
export const repartoArquitecta = (a) => ({ tecnica: a.pct_tecnica, diseno: 100 - a.pct_tecnica });

/** "10 días hábiles", "medio día", "1 día hábil". */
export function textoDiasHabiles(n) {
  if (n == null) return "—";
  if (n === 0.5) return "medio día";
  return `${String(n).replace(".", ",")} ${n === 1 ? "día hábil" : "días hábiles"}`;
}

export const textoHoras = (n) => (n == null ? "—" : `${String(n).replace(".", ",")} h`);
