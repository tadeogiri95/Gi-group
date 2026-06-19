// ═══════════════════════════════════════════════════════════
// Constantes compartidas
// ═══════════════════════════════════════════════════════════

const V = {
  amber: "var(--color-empresa-primary, #F97316)",
  green: "#16A34A",
  cyan: "#0891B2",
  violet: "#7C3AED",
};

// Fallback genérico (se usa cuando empresa no tiene divisiones configuradas)
export const DIVISIONES_FALLBACK = [
  { id: "produccion", label: "Producción", icon: "🏭", color: V.amber },
  { id: "administracion", label: "Administración", icon: "🏢", color: V.violet },
  { id: "logistica", label: "Logística", icon: "🚛", color: V.cyan },
  { id: "general", label: "General", icon: "📦", color: V.green },
];

// Helpers puros: reciben las divisiones del contexto (o DIVISIONES_FALLBACK si no hay)
export function getDivisionesBase(divisiones) {
  return divisiones && divisiones.length > 0 ? divisiones : DIVISIONES_FALLBACK;
}
export function getDivisionesConTodas(divisiones) {
  return [{ id: "todas", label: "Todas", icon: "📊", color: V.amber }, ...getDivisionesBase(divisiones)];
}
export function getDivisionesConTodos(divisiones) {
  return [{ id: "todas", label: "Todos" }, ...getDivisionesBase(divisiones)];
}
export function getDivisionesConSinAsignar(divisiones) {
  return [{ id: "", label: "Sin asignar" }, ...getDivisionesBase(divisiones)];
}

// Exports estáticos retrocompatibles (fallback sin contexto)
export const DIVISIONES_BASE = DIVISIONES_FALLBACK;
export const DIVISIONES_CON_TODAS = [{ id: "todas", label: "Todas", icon: "📊", color: V.amber }, ...DIVISIONES_FALLBACK];
export const DIVISIONES_CON_TODOS = [{ id: "todas", label: "Todos" }, ...DIVISIONES_FALLBACK];
export const DIVISIONES_CON_SIN_ASIGNAR = [{ id: "", label: "Sin asignar" }, ...DIVISIONES_FALLBACK];

// Días (sin cambios)
export const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
export const DIAS_LABEL = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
export const DIAS_LABEL_FULL = { lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo" };
export const DIAS_LABEL_SHORT = ["D", "L", "M", "X", "J", "V", "S"];
export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
