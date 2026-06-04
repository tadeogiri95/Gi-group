// ═══════════════════════════════════════════════════════════
// fix-bloque5-e-duplicados.cjs
// Reemplaza haversine duplicado en geolocalizacion_screen y page.js
// con import desde app/lib/calc.js
//
// Uso:  node fix-bloque5-e-duplicados.cjs
// Borrar después.
// ═══════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

let cambios = 0;

function leer(p) {
  try { return fs.readFileSync(path.join(__dirname, p), "utf8"); } catch { return null; }
}
function escribir(p, c) {
  fs.writeFileSync(path.join(__dirname, p), c, "utf8");
}

// ─────────────────────────────────────────────────────────
// 1. geolocalizacion_screen.jsx
//    - Agregar import { haversine } from "./lib/calc"
//    - Borrar definición de distanciaMetros
//    - Reemplazar distanciaMetros( → haversine(
// ─────────────────────────────────────────────────────────
console.log("\n📄 app/geolocalizacion_screen.jsx");
{
  let src = leer("app/geolocalizacion_screen.jsx");
  if (!src) { console.log("  ⚠️ archivo no encontrado"); }
  else {
    let mod = false;

    // Agregar import (después de la línea de import de constants)
    if (!src.includes('from "./lib/calc"') && !src.includes("from './lib/calc'")) {
      src = src.replace(
        /import\s*\{\s*getDivisionesConTodos\s*\}\s*from\s*["']\.\/lib\/constants["'];?/,
        match => match + '\nimport { haversine } from "./lib/calc";'
      );
      console.log("  ✓ Agregado import { haversine } from calc.js");
      mod = true;
    }

    // Borrar la función distanciaMetros (definición arrow de una línea o multilínea)
    const distanciaFn = `const distanciaMetros = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};`;

    if (src.includes(distanciaFn)) {
      src = src.replace(distanciaFn, "// distanciaMetros → reemplazada por haversine de calc.js");
      console.log("  ✓ Eliminada definición de distanciaMetros");
      mod = true;
    } else if (src.includes("const distanciaMetros")) {
      console.log("  ⚠️ distanciaMetros encontrada pero formato diferente al esperado — revisá manualmente");
    }

    // Reemplazar llamadas distanciaMetros( → haversine(
    const antes = src;
    src = src.split("distanciaMetros(").join("haversine(");
    if (src !== antes) {
      console.log("  ✓ Reemplazadas llamadas distanciaMetros → haversine");
      mod = true;
    }

    if (mod) { escribir("app/geolocalizacion_screen.jsx", src); cambios++; }
    else { console.log("  · sin cambios necesarios"); }
  }
}

// ─────────────────────────────────────────────────────────
// 2. app/[slug]/page.js
//    - Agregar import { haversine } from '../lib/calc'
//    - Reemplazar math inline en obtenerGeo con haversine()
// ─────────────────────────────────────────────────────────
console.log("\n📄 app/[slug]/page.js");
{
  let src = leer("app/[slug]/page.js");
  if (!src) { console.log("  ⚠️ archivo no encontrado"); }
  else {
    let mod = false;

    // Agregar import (después del import de calc.js si ya existe, o de claude)
    if (!src.includes('from \'../lib/calc\'') && !src.includes('from "../lib/calc"')) {
      // Buscar línea de import de claude para insertar después
      src = src.replace(
        /import\s*\{\s*callClaude,\s*parseAction\s*\}\s*from\s*['"]\.\.\/lib\/claude['"];?/,
        match => match + "\nimport { haversine } from '../lib/calc';"
      );
      console.log("  ✓ Agregado import { haversine } from calc.js");
      mod = true;
    }

    // Reemplazar el bloque inline de haversine dentro de obtenerGeo
    // El patrón exacto (5 líneas de math inline):
    const inlineMath = `const R = 6371000;
        const dLat = (ub.lat - pos.coords.latitude) * Math.PI / 180;
        const dLng = (ub.lng - pos.coords.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(pos.coords.latitude * Math.PI / 180) * Math.cos(ub.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));`;

    const replacement = `const dist = Math.round(haversine(pos.coords.latitude, pos.coords.longitude, ub.lat, ub.lng));`;

    if (src.includes(inlineMath)) {
      src = src.replace(inlineMath, replacement);
      console.log("  ✓ Reemplazado haversine inline en obtenerGeo → haversine()");
      mod = true;
    } else {
      console.log("  ⚠️ No encontré el bloque inline exacto — revisá manualmente obtenerGeo()");
    }

    if (mod) { escribir("app/[slug]/page.js", src); cambios++; }
    else { console.log("  · sin cambios necesarios"); }
  }
}

// ─────────────────────────────────────────────────────────
// 3. Verificar que npm test pasa
// ─────────────────────────────────────────────────────────
console.log("\n═══ Resumen ═══");
console.log(`✅ ${cambios} archivos modificados`);
console.log("\nSiguientes pasos:");
console.log(" 1. npm test  (verificá que los 27 tests siguen pasando)");
console.log(" 2. git add . && git commit -m 'refactor: eliminar haversine duplicado (bloque 5E)' && git push");
console.log(" 3. del fix-bloque5-e-duplicados.cjs\n");
