// ═══════════════════════════════════════════════════════════
// FASE 4 — Regenerar íconos con nombre "Gypi"
// Ejecutar desde la raíz del proyecto:
//   node fase4-generar-iconos-gypi.js
//
// Sobreescribe los íconos anteriores
// ═══════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

const ICONS_DIR = path.join(__dirname, "public", "icons");

if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  console.log("📁 Carpeta public/icons/ creada");
}

function generarSVG(size, maskable = false) {
  const padding = maskable ? Math.round(size * 0.2) : Math.round(size * 0.08);
  const innerSize = size - padding * 2;
  const cx = size / 2;
  const cy = size / 2;
  const r = innerSize / 2;
  // "Gypi" es 4 letras, necesita fontSize más chico que "GI"
  const fontSize = Math.round(innerSize * 0.26);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0C0A09" rx="${maskable ? 0 : Math.round(size * 0.2)}"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F97316" stroke-width="${Math.max(2, Math.round(size * 0.02))}"/>
  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="800" fill="#F97316" letter-spacing="${Math.round(fontSize * 0.03)}">Gypi</text>
</svg>`;
}

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

SIZES.forEach(size => {
  fs.writeFileSync(path.join(ICONS_DIR, `icon-${size}.svg`), generarSVG(size, false));
  console.log(`✅ icon-${size}.svg`);
});

[192, 512].forEach(size => {
  fs.writeFileSync(path.join(ICONS_DIR, `icon-maskable-${size}.svg`), generarSVG(size, true));
  console.log(`✅ icon-maskable-${size}.svg`);
});

console.log(`
✅ Íconos SVG con "Gypi" generados en public/icons/

Convertí cada SVG a PNG en https://svgtopng.com/
Después borrá los .svg y dejá solo los .png
`);
