// ═══════════════════════════════════════════════════════════
// Constantes compartidas — FASE 5.3: divisiones dinámicas
// ═══════════════════════════════════════════════════════════

import { C } from "./theme";

// Fallback (se usan si no se cargan las dinámicas)
const DIVISIONES_FALLBACK = [
  { id: "herreria", label: "Herrería", icon: "🔥", color: C.amber },
  { id: "muebles", label: "Muebles", icon: "🪵", color: C.green },
  { id: "aberturas", label: "Aberturas", icon: "🪟", color: C.cyan },
  { id: "general", label: "General", icon: "🏭", color: C.violet },
];

// Store global (se setea en page.js al login)
let _divisiones = null;

export function setDivisionesEmpresa(divs) {
  if (divs && divs.length > 0) {
    _divisiones = divs.map(d => ({
      id: d.clave || d.id,
      label: d.label || d.nombre,
      icon: d.icon || "📦",
      color: d.color || C.amber,
    }));
  }
}

export function getDivisionesBase() {
  return _divisiones || DIVISIONES_FALLBACK;
}
export function getDivisionesConTodas() {
  return [{ id: "todas", label: "Todas", icon: "📊", color: C.amber }, ...getDivisionesBase()];
}
export function getDivisionesConTodos() {
  return [{ id: "todas", label: "Todos" }, ...getDivisionesBase()];
}
export function getDivisionesConSinAsignar() {
  return [{ id: "", label: "Sin asignar" }, ...getDivisionesBase()];
}

// Exports estáticos retrocompatibles (fallback)
export const DIVISIONES_BASE = DIVISIONES_FALLBACK;
export const DIVISIONES_CON_TODAS = [{ id: "todas", label: "Todas", icon: "📊", color: C.amber }, ...DIVISIONES_FALLBACK];
export const DIVISIONES_CON_TODOS = [{ id: "todas", label: "Todos" }, ...DIVISIONES_FALLBACK];
export const DIVISIONES_CON_SIN_ASIGNAR = [{ id: "", label: "Sin asignar" }, ...DIVISIONES_FALLBACK];

// Días (sin cambios)
export const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
export const DIAS_LABEL = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
export const DIAS_LABEL_FULL = { lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo" };
export const DIAS_LABEL_SHORT = ["D", "L", "M", "X", "J", "V", "S"];
export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
