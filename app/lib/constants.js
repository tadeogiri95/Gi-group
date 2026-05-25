// ═══════════════════════════════════════════════════════════
// Constantes compartidas
// Ubicación: app/lib/constants.js
// ═══════════════════════════════════════════════════════════

import { C } from "./theme";

// Divisiones base (con icon y color)
export const DIVISIONES_BASE = [
  { id: "herreria", label: "Herrería", icon: "🔥", color: C.amber },
  { id: "muebles", label: "Muebles", icon: "🪵", color: C.green },
  { id: "aberturas", label: "Aberturas", icon: "🪟", color: C.cyan },
  { id: "general", label: "General", icon: "🏭", color: C.violet },
];

// Con filtro "Todas" al inicio (para dashboards, reportes, grillas)
export const DIVISIONES_CON_TODAS = [
  { id: "todas", label: "Todas", icon: "📊", color: C.amber },
  ...DIVISIONES_BASE,
];

// Con filtro "Todos" al inicio (variante plural)
export const DIVISIONES_CON_TODOS = [
  { id: "todas", label: "Todos" },
  ...DIVISIONES_BASE,
];

// Con "Sin asignar" al inicio (para gestión de personal)
export const DIVISIONES_CON_SIN_ASIGNAR = [
  { id: "", label: "Sin asignar" },
  ...DIVISIONES_BASE,
];

// Días de la semana
export const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
export const DIAS_LABEL = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
export const DIAS_LABEL_FULL = { lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo" };
export const DIAS_LABEL_SHORT = ["D", "L", "M", "X", "J", "V", "S"];
export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
