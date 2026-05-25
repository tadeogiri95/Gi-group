// ═══════════════════════════════════════════════════════════
// FASE 4 — Generador de íconos para Play Store
// Ejecutar desde la raíz del proyecto:
//   node fase4-generar-iconos.js
//
// Esto crea íconos SVG en la carpeta public/icons/
// Para Play Store necesitás convertirlos a PNG después
// (te explico cómo más abajo)
// ═══════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

const ICONS_DIR = path.join(__dirname, "public", "icons");

// Crear carpeta si no existe
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  console.log("📁 Carpeta public/icons/ creada");
}

// ── Ícono base SVG (GI con estilo industrial) ──
function generarSVG(size, maskable = false) {
  const padding = maskable ? Math.round(size * 0.2) : Math.round(size * 0.08);
  const innerSize = size - padding * 2;
  const cx = size / 2;
  const cy = size / 2;
  const r = innerSize / 2;
  const fontSize = Math.round(innerSize * 0.38);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0C0A09" rx="${maskable ? 0 : Math.round(size * 0.2)}"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F97316" stroke-width="${Math.max(2, Math.round(size * 0.02))}"/>
  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="800" fill="#F97316" letter-spacing="${Math.round(fontSize * 0.05)}">GI</text>
</svg>`;
}

// ── Generar todos los tamaños ──
const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

SIZES.forEach(size => {
  const svg = generarSVG(size, false);
  const filePath = path.join(ICONS_DIR, `icon-${size}.svg`);
  fs.writeFileSync(filePath, svg);
  console.log(`✅ icon-${size}.svg`);
});

// Maskable (con más padding para que Android no corte)
[192, 512].forEach(size => {
  const svg = generarSVG(size, true);
  const filePath = path.join(ICONS_DIR, `icon-maskable-${size}.svg`);
  fs.writeFileSync(filePath, svg);
  console.log(`✅ icon-maskable-${size}.svg`);
});

console.log(`
✅ Íconos SVG generados en public/icons/

⚠️  IMPORTANTE: Play Store necesita PNG, no SVG.
Para convertirlos, andá a https://svgtopng.com/ y convertí cada uno.
O usá esta herramienta online: https://cloudconvert.com/svg-to-png

Los archivos que necesitás convertir son:
${SIZES.map(s => `  - icon-${s}.svg → icon-${s}.png`).join("\n")}
  - icon-maskable-192.svg → icon-maskable-192.png
  - icon-maskable-512.svg → icon-maskable-512.png

Después borrá los .svg y dejá solo los .png
`);
