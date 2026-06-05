// ═══════════════════════════════════════════════════════════
// Theme — Colores dinámicos por empresa
//
// ENTREGA 2A: Los colores base ahora están definidos como
// CSS custom properties en globals.css (@theme).
// Este archivo mantiene el objeto C para compatibilidad con
// los 1,473 inline styles existentes. A medida que se migran
// pantallas a Tailwind (entrega 2E), los imports de C se
// van reemplazando por clases como bg-gypi-surface, text-gypi-dim.
//
// setColoresEmpresa() ahora TAMBIÉN actualiza las CSS vars
// para que Tailwind las use via var(--empresa-primario).
// ═══════════════════════════════════════════════════════════

const _base = {
  bg:"#0C0A09", surface:"#171311", surfHi:"#1F1A17", surfLo:"#100D0B",
  border:"rgba(255,240,220,0.06)", borderHi:"rgba(255,240,220,0.12)",
  text:"#F5F0E8", dim:"#A39A8E", mute:"#615A52",
  amber:"#F97316", amberS:"rgba(249,115,22,0.14)",
  green:"#22C55E", greenS:"rgba(34,197,94,0.12)",
  red:"#EF4444", redS:"rgba(239,68,68,0.12)",
  cyan:"#06B6D4", cyanS:"rgba(6,182,212,0.12)",
  violet:"#A78BFA", violetS:"rgba(167,139,250,0.12)",
};

// Objeto mutable que toda la app importa
export const C = { ..._base };

// Convierte hex a rgba string
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ═══ CAMBIO 2A: también actualizar CSS custom properties ═══
function updateCSSVars(primario, primarioS, secundario, secundarioS) {
  if (typeof document === "undefined") return; // SSR safety
  const root = document.documentElement;
  if (primario) {
    root.style.setProperty("--empresa-primario", primario);
    root.style.setProperty("--empresa-primario-s", primarioS);
  }
  if (secundario) {
    root.style.setProperty("--empresa-secundario", secundario);
    root.style.setProperty("--empresa-secundario-s", secundarioS);
  }
}

// Llamar desde page.js cuando se carga la empresa
export function setColoresEmpresa(primario, secundario) {
  if (primario && /^#[0-9A-Fa-f]{6}$/.test(primario)) {
    C.amber = primario;
    C.amberS = hexToRgba(primario, 0.14);
  }
  if (secundario && /^#[0-9A-Fa-f]{6}$/.test(secundario)) {
    C.violet = secundario;
    C.violetS = hexToRgba(secundario, 0.14);
  }
  // Sincronizar con CSS vars para que Tailwind use los colores de empresa
  updateCSSVars(C.amber, C.amberS, C.violet, C.violetS);
}

// Resetear a colores por defecto
export function resetColores() {
  Object.assign(C, _base);
  updateCSSVars(_base.amber, _base.amberS, _base.violet, _base.violetS);
}

export const fH = `'Bricolage Grotesque', system-ui`;
export const fB = `'Geist', system-ui`;
export const fM = `'Geist Mono', 'JetBrains Mono', monospace`;

export const fmtTime = d => d.toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit", hour12:false });
export const fmtDate = d => d.toLocaleDateString("es-AR", { weekday:"long", day:"numeric", month:"long" });
export const fmtDateLong = d => d.toLocaleDateString("es-AR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });

export const DIAS_KEY = ["dom","lun","mar","mie","jue","vie","sab"];
