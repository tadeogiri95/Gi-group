// WCAG AA Contrast Audit for Dark Theme Presets
// Usage: node scripts/wcag-audit.js

const DARK_PRESETS = {
  oscuro:     { label: "Oscuro",      bg: "#0C0A09", text: "#F5F0E8", primary: "#F97316", secondary: "#A78BFA" },
  carbon:     { label: "Carbon",      bg: "#1C1C1E", text: "#F5F5F7", primary: "#0A84FF", secondary: "#BF5AF2" },
  medianoche: { label: "Medianoche",  bg: "#0D1117", text: "#C9D1D9", primary: "#58A6FF", secondary: "#D2A8FF" },
  industrial: { label: "Industrial",  bg: "#18181B", text: "#E4E4E7", primary: "#F59E0B", secondary: "#EF4444" },
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function linearize(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function blendAlpha(fgRgb, bgRgb, alpha) {
  return {
    r: Math.round(alpha * fgRgb.r + (1 - alpha) * bgRgb.r),
    g: Math.round(alpha * fgRgb.g + (1 - alpha) * bgRgb.g),
    b: Math.round(alpha * fgRgb.b + (1 - alpha) * bgRgb.b),
  };
}

// Derive surface for dark themes: rgba(255,255,255,0.05) over bg
function deriveSurface(bgRgb) {
  return blendAlpha({ r: 255, g: 255, b: 255 }, bgRgb, 0.05);
}

// Dark theme alpha values from deriveDimMute
const DIM_ALPHA = 0.60;
const MUTE_ALPHA = 0.42;

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

// Matches textOnColor() in theme.js
function textOnColor(hex) {
  const rgb = hexToRgb(hex);
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  return L > 0.18 ? BLACK : WHITE;
}

function pf(ratio, min) {
  return ratio >= min ? 'PASS' : 'FAIL';
}

console.log('=== WCAG AA Contrast Audit - Dark Theme Presets ===\n');

let anyFail = false;
const failures = [];

for (const [key, preset] of Object.entries(DARK_PRESETS)) {
  const bg = hexToRgb(preset.bg);
  const text = hexToRgb(preset.text);
  const primary = hexToRgb(preset.primary);
  const secondary = hexToRgb(preset.secondary);
  const surface = deriveSurface(bg);
  const dim = blendAlpha(text, bg, DIM_ALPHA);
  const mute = blendAlpha(text, bg, MUTE_ALPHA);

  const amberText = textOnColor(preset.primary);

  const checks = [
    { name: 'text on bg',           fg: text,      bg_: bg,      min: 4.5 },
    { name: 'text on surface',      fg: text,      bg_: surface, min: 4.5 },
    { name: 'primary on bg',        fg: primary,   bg_: bg,      min: 3.0 },
    { name: 'secondary on bg',      fg: secondary, bg_: bg,      min: 3.0 },
    { name: 'dim on bg',            fg: dim,       bg_: bg,      min: 4.5 },
    { name: 'mute on bg',           fg: mute,      bg_: bg,      min: 3.0 },
    { name: 'primary on surface',   fg: primary,   bg_: surface, min: 3.0 },
    { name: 'amberText on primary', fg: amberText,  bg_: primary, min: 4.5 },
    { name: 'white on primary',     fg: WHITE,     bg_: primary, min: 4.5, info: true },
    { name: 'black on primary',     fg: BLACK,     bg_: primary, min: 4.5, info: true },
  ];

  console.log(`--- ${preset.label} (${key}) ---`);
  console.log(`  bg=${preset.bg}  text=${preset.text}  primary=${preset.primary}  secondary=${preset.secondary}`);
  console.log(`  surface=rgb(${surface.r},${surface.g},${surface.b})  dim=rgb(${dim.r},${dim.g},${dim.b})  mute=rgb(${mute.r},${mute.g},${mute.b})`);
  console.log('');

  for (const c of checks) {
    const ratio = contrastRatio(c.fg, c.bg_);
    const pass = pf(ratio, c.min);
    const prefix = c.info ? 'INFO' : pass;
    const tag = !c.info && pass === 'FAIL' ? ' <<<' : '';
    console.log(`  ${prefix}  ${ratio.toFixed(2)}:1  (min ${c.min}:1)  ${c.name}${tag}`);
    if (!c.info && pass === 'FAIL') {
      anyFail = true;
      failures.push({ preset: key, check: c.name, ratio: ratio.toFixed(2), min: c.min });
    }
  }
  console.log('');
}

if (failures.length > 0) {
  console.log('=== FAILURES ===');
  for (const f of failures) {
    console.log(`  ${f.preset}: ${f.check} = ${f.ratio}:1 (need ${f.min}:1)`);
  }
} else {
  console.log('All checks PASS!');
}
