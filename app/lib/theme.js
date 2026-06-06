// ═══════════════════════════════════════════════════════════
// Theme — Colores dinámicos por empresa
// Los colores base se pueden sobreescribir con setColoresEmpresa()
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

// Genera surface/surfHi/surfLo/border a partir de un color de fondo
function deriveSurfaces(bgHex) {
  const h = bgHex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  const isLight = lum > 140;
  if (isLight) {
    // Tema claro: surfaces más oscuros que el fondo
    return {
      surface: hexToRgba("#000000", 0.04),
      surfHi: hexToRgba("#000000", 0.08),
      surfLo: hexToRgba("#000000", 0.02),
      border: "rgba(0,0,0,0.08)",
      borderHi: "rgba(0,0,0,0.14)",
    };
  }
  // Tema oscuro: surfaces más claros que el fondo
  return {
    surface: hexToRgba("#ffffff", 0.04),
    surfHi: hexToRgba("#ffffff", 0.07),
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
    dim: `rgba(${r},${g},${b},0.55)`,
    mute: `rgba(${r},${g},${b},0.35)`,
  };
}

// ═══ Temas preestablecidos ═══
export const THEME_PRESETS = {
  default:     { label: "Gypi Oscuro",  bg: "#0C0A09", text: "#F5F0E8", primary: "#F97316", secondary: "#A78BFA" },
  carbon:      { label: "Carbón",       bg: "#1c1c1e", text: "#f5f5f7", primary: "#0A84FF", secondary: "#BF5AF2" },
  medianoche:  { label: "Medianoche",   bg: "#0d1117", text: "#c9d1d9", primary: "#58A6FF", secondary: "#D2A8FF" },
  oceano:      { label: "Océano",       bg: "#0B1929", text: "#B2BAC2", primary: "#5090D3", secondary: "#CE93D8" },
  claro:       { label: "Claro",        bg: "#F5F5F5", text: "#1A1A1A", primary: "#2563EB", secondary: "#7C3AED" },
  crema:       { label: "Crema",        bg: "#FAF8F5", text: "#2C2C2C", primary: "#D97706", secondary: "#9333EA" },
  bosque:      { label: "Bosque",       bg: "#1A2E1A", text: "#D4E7D4", primary: "#4ADE80", secondary: "#FACC15" },
  industrial:  { label: "Industrial",   bg: "#18181B", text: "#E4E4E7", primary: "#F59E0B", secondary: "#EF4444" },
};

// ═══ Tipografías disponibles ═══
export const FONT_OPTIONS = {
  system:   { label: "Sistema",        heading: "system-ui, sans-serif",                        body: "system-ui, sans-serif" },
  bricolage:{ label: "Bricolage",      heading: "'Bricolage Grotesque', system-ui",              body: "'Geist', system-ui" },
  inter:    { label: "Inter",          heading: "'Inter', system-ui, sans-serif",                body: "'Inter', system-ui, sans-serif" },
  roboto:   { label: "Roboto",         heading: "'Roboto', system-ui, sans-serif",               body: "'Roboto', system-ui, sans-serif" },
  poppins:  { label: "Poppins",        heading: "'Poppins', system-ui, sans-serif",              body: "'Poppins', system-ui, sans-serif" },
  mono:     { label: "Monoespaciada",  heading: "'Geist Mono', 'JetBrains Mono', monospace",    body: "'Geist Mono', 'JetBrains Mono', monospace" },
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
  _currentFH = FONT_OPTIONS.bricolage.heading;
  _currentFB = FONT_OPTIONS.bricolage.body;
}

// Fonts como getters para que sean dinámicos
let _currentFH = `'Bricolage Grotesque', system-ui`;
let _currentFB = `'Geist', system-ui`;

export const getFH = () => _currentFH;
export const getFB = () => _currentFB;

// Backward compat — exports constantes (se actualizan solo al importar)
// Usar getFH()/getFB() para valores dinámicos
export const fH = `'Bricolage Grotesque', system-ui`;
export const fB = `'Geist', system-ui`;
export const fM = `'Geist Mono', 'JetBrains Mono', monospace`;

export const fmtTime = d => d.toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit", hour12:false });
export const fmtDate = d => d.toLocaleDateString("es-AR", { weekday:"long", day:"numeric", month:"long" });
export const fmtDateLong = d => d.toLocaleDateString("es-AR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });

export const DIAS_KEY = ["dom","lun","mar","mie","jue","vie","sab"];
