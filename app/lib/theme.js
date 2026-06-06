// ═══════════════════════════════════════════════════════════
// Theme — Colores dinámicos por empresa (LIGHT MODE)
// Los colores base se pueden sobreescribir con setColoresEmpresa()
// ═══════════════════════════════════════════════════════════

const _base = {
  bg:"#FFFFFF", surface:"#F3F4F6", surfHi:"#FFFFFF", surfLo:"#F9FAFB",
  border:"rgba(0,0,0,0.08)", borderHi:"rgba(0,0,0,0.14)",
  text:"#111827", dim:"#6B7280", mute:"#9CA3AF",
  amber:"#F97316", amberS:"rgba(249,115,22,0.10)",
  green:"#22C55E", greenS:"rgba(34,197,94,0.10)",
  red:"#EF4444", redS:"rgba(239,68,68,0.10)",
  cyan:"#06B6D4", cyanS:"rgba(6,182,212,0.10)",
  violet:"#A78BFA", violetS:"rgba(167,139,250,0.10)",
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

// Llamar desde page.js cuando se carga la empresa
export function setColoresEmpresa(primario, secundario) {
  if (primario && /^#[0-9A-Fa-f]{6}$/.test(primario)) {
    C.amber = primario;
    C.amberS = hexToRgba(primario, 0.10);
  }
  if (secundario && /^#[0-9A-Fa-f]{6}$/.test(secundario)) {
    C.violet = secundario;
    C.violetS = hexToRgba(secundario, 0.10);
  }
  // Actualizar CSS variables para que Tailwind y los componentes nuevos también se enteren
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (primario && /^#[0-9A-Fa-f]{6}$/.test(primario)) {
      root.style.setProperty('--color-empresa-primary', primario);
      root.style.setProperty('--color-brand', primario);
    }
    if (secundario && /^#[0-9A-Fa-f]{6}$/.test(secundario)) {
      root.style.setProperty('--color-empresa-secondary', secundario);
    }
  }
}

// Resetear a colores por defecto
export function resetColores() {
  Object.assign(C, _base);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.style.setProperty('--color-empresa-primary', '#F97316');
    root.style.setProperty('--color-empresa-secondary', '#A78BFA');
    root.style.setProperty('--color-brand', '#F97316');
  }
}

export const fH = `'Bricolage Grotesque', system-ui`;
export const fB = `'Geist', system-ui`;
export const fM = `'Geist Mono', 'JetBrains Mono', monospace`;

export const fmtTime = d => d.toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit", hour12:false });
export const fmtDate = d => d.toLocaleDateString("es-AR", { weekday:"long", day:"numeric", month:"long" });
export const fmtDateLong = d => d.toLocaleDateString("es-AR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });

export const DIAS_KEY = ["dom","lun","mar","mie","jue","vie","sab"];
