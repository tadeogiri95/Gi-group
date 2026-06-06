// ═══════════════════════════════════════════════════════════
// Theme — Colores dinámicos por empresa
// Los colores base se pueden sobreescribir con setColoresEmpresa()
// ═══════════════════════════════════════════════════════════

const _base = {
  bg:"#F7F7F5", surface:"#FFFFFF", surfHi:"#EDEDED", surfLo:"#F0F0EE",
  border:"rgba(0,0,0,0.08)", borderHi:"rgba(0,0,0,0.14)",
  text:"#1A1A1A", dim:"#6B6B6B", mute:"#A0A0A0",
  amber:"#F97316", amberS:"rgba(249,115,22,0.10)",
  green:"#16A34A", greenS:"rgba(22,163,74,0.10)",
  red:"#DC2626", redS:"rgba(220,38,38,0.10)",
  cyan:"#0891B2", cyanS:"rgba(8,145,178,0.10)",
  violet:"#7C3AED", violetS:"rgba(124,58,237,0.10)",
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

// Genera surface/surfHi/surfLo/border a partir de un color de fondo
function deriveSurfaces(bgHex) {
  const h = bgHex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  const isLight = lum > 140;
  if (isLight) {
    return {
      surface: "#FFFFFF",
      surfHi: hexToRgba("#000000", 0.06),
      surfLo: hexToRgba("#000000", 0.02),
      border: "rgba(0,0,0,0.08)",
      borderHi: "rgba(0,0,0,0.14)",
    };
  }
  return {
    surface: hexToRgba("#ffffff", 0.05),
    surfHi: hexToRgba("#ffffff", 0.08),
    surfLo: hexToRgba("#ffffff", 0.02),
    border: "rgba(255,240,220,0.06)",
    borderHi: "rgba(255,240,220,0.12)",
  };
}

// Genera dim/mute a partir de color de texto
function deriveDimMute(textHex) {
  const h = textHex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return {
    dim: `rgba(${r},${g},${b},0.50)`,
    mute: `rgba(${r},${g},${b},0.30)`,
  };
}

// ═══ Temas preestablecidos ═══
export const THEME_PRESETS = {
  default:     { label: "Gypi Claro",    bg: "#F7F7F5", text: "#1A1A1A", primary: "#F97316", secondary: "#7C3AED" },
  crema:       { label: "Crema",         bg: "#FAF6F1", text: "#2C2216", primary: "#D97706", secondary: "#9333EA" },
  hielo:       { label: "Hielo",         bg: "#F0F4F8", text: "#1E293B", primary: "#2563EB", secondary: "#7C3AED" },
  menta:       { label: "Menta",         bg: "#F0FDF4", text: "#14532D", primary: "#16A34A", secondary: "#0891B2" },
  oscuro:      { label: "Oscuro",        bg: "#0C0A09", text: "#F5F0E8", primary: "#F97316", secondary: "#A78BFA" },
  carbon:      { label: "Carbón",        bg: "#1C1C1E", text: "#F5F5F7", primary: "#0A84FF", secondary: "#BF5AF2" },
  medianoche:  { label: "Medianoche",    bg: "#0D1117", text: "#C9D1D9", primary: "#58A6FF", secondary: "#D2A8FF" },
  industrial:  { label: "Industrial",    bg: "#18181B", text: "#E4E4E7", primary: "#F59E0B", secondary: "#EF4444" },
};

// ═══ Tipografías disponibles ═══
export const FONT_OPTIONS = {
  system:    { label: "Sistema",        heading: "system-ui, sans-serif",                         body: "system-ui, sans-serif" },
  bricolage: { label: "Bricolage",      heading: "'Bricolage Grotesque', system-ui",              body: "'Geist', system-ui" },
  inter:     { label: "Inter",          heading: "'Inter', system-ui, sans-serif",                body: "'Inter', system-ui, sans-serif" },
  roboto:    { label: "Roboto",         heading: "'Roboto', system-ui, sans-serif",               body: "'Roboto', system-ui, sans-serif" },
  poppins:   { label: "Poppins",        heading: "'Poppins', system-ui, sans-serif",              body: "'Poppins', system-ui, sans-serif" },
  mono:      { label: "Monoespaciada",  heading: "'Geist Mono', 'JetBrains Mono', monospace",    body: "'Geist Mono', 'JetBrains Mono', monospace" },
};

// Llamar desde page.js cuando se carga la empresa
// Acepta objeto con todas las propiedades o solo (primario, secundario) para backward compat
export function setColoresEmpresa(primarioOrObj, secundario) {
  // Modo legacy: setColoresEmpresa("#hex", "#hex")
  if (typeof primarioOrObj === "string") {
    return setColoresEmpresa({
      color_primario: primarioOrObj,
      color_secundario: secundario,
    });
  }

  const d = primarioOrObj || {};
  const isHex = (v) => v && /^#[0-9A-Fa-f]{6}$/.test(v);

  // Aplicar preset primero si viene
  if (d.theme_preset && THEME_PRESETS[d.theme_preset]) {
    const p = THEME_PRESETS[d.theme_preset];
    C.bg = p.bg;
    C.text = p.text;
    C.amber = p.primary;
    C.amberS = hexToRgba(p.primary, 0.14);
    C.violet = p.secondary;
    C.violetS = hexToRgba(p.secondary, 0.12);
    Object.assign(C, deriveSurfaces(p.bg));
    Object.assign(C, deriveDimMute(p.text));
  }

  // Sobreescribir con valores individuales si vienen
  if (isHex(d.color_primario)) {
    C.amber = d.color_primario;
    C.amberS = hexToRgba(d.color_primario, 0.14);
  }
  if (isHex(d.color_secundario)) {
    C.violet = d.color_secundario;
    C.violetS = hexToRgba(d.color_secundario, 0.12);
  }
  if (isHex(d.color_fondo)) {
    C.bg = d.color_fondo;
    Object.assign(C, deriveSurfaces(d.color_fondo));
  }
  if (isHex(d.color_texto)) {
    C.text = d.color_texto;
    Object.assign(C, deriveDimMute(d.color_texto));
  }

  // Tipografía
  if (d.typography && FONT_OPTIONS[d.typography]) {
    const f = FONT_OPTIONS[d.typography];
    _currentFH = f.heading;
    _currentFB = f.body;
  }
}

// Resetear a colores por defecto
export function resetColores() {
  Object.assign(C, _base);
  _currentFH = FONT_OPTIONS.system.heading;
  _currentFB = FONT_OPTIONS.system.body;
}

// Fonts como getters para que sean dinámicos
let _currentFH = `system-ui, sans-serif`;
let _currentFB = `system-ui, sans-serif`;

export const getFH = () => _currentFH;
export const getFB = () => _currentFB;

// Backward compat — exports constantes
export const fH = `'Bricolage Grotesque', system-ui`;
export const fB = `'Geist', system-ui`;
export const fM = `'Geist Mono', 'JetBrains Mono', monospace`;

export const fmtTime = d => d.toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit", hour12:false });
export const fmtDate = d => d.toLocaleDateString("es-AR", { weekday:"long", day:"numeric", month:"long" });
export const fmtDateLong = d => d.toLocaleDateString("es-AR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });

export const DIAS_KEY = ["dom","lun","mar","mie","jue","vie","sab"];
