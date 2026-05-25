// ═══════════════════════════════════════════════════════════
// FASE 4 — Cambio de nombre de la app
// Ejecutar desde la raíz del proyecto:
//   node fase4-cambiar-nombre.js
// ═══════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "app");

function patch(filePath, transforms) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  No existe: ${filePath} — saltando`);
    return;
  }
  let content = fs.readFileSync(filePath, "utf-8");
  const original = content;

  for (const t of transforms) {
    if (t.find && content.includes(t.find)) {
      content = content.replace(t.find, t.replace);
      console.log(`  ✓ ${t.desc}`);
    } else if (t.regex) {
      const before = content;
      content = content.replace(t.regex, t.replace);
      if (content !== before) console.log(`  ✓ ${t.desc}`);
    }
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`✅ Actualizado: ${filePath}`);
  } else {
    console.log(`— Sin cambios: ${filePath}`);
  }
}

console.log("\n🔧 Cambiando nombre de la app...\n");

// 1. layout.js
console.log("📄 layout.js");
patch(path.join(APP, "layout.js"), [
  { find: "title: 'GI Group RRHH'",
    replace: "title: 'Gestión y productividad industrial'",
    desc: "Cambiar título" },
  { find: "description: 'Sistema de gestión de RRHH de GI Amoblamientos SRL'",
    replace: "description: 'Gypi — Sistema de gestión y productividad industrial'",
    desc: "Cambiar descripción" },
  { find: "title: 'GI Group'",
    replace: "title: 'Gypi'",
    desc: "Cambiar nombre corto Apple" },
]);

// 2. reportes_screen.jsx — marca de agua en canvas
console.log("\n📄 reportes_screen.jsx");
patch(path.join(APP, "reportes_screen.jsx"), [
  { find: 'ctx.fillText(`GI Group · Generado ${new Date().toLocaleString("es-AR")}`, startX, H - 8)',
    replace: 'ctx.fillText(`Gypi · Generado ${new Date().toLocaleString("es-AR")}`, startX, H - 8)',
    desc: "Cambiar marca de agua en reportes" },
]);

// 3. manifest.json (en public)
const manifestPath = path.join(__dirname, "public", "manifest.json");
if (fs.existsSync(manifestPath)) {
  console.log("\n📄 public/manifest.json");
  let manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  manifest.name = "Gestión y productividad industrial";
  manifest.short_name = "Gypi";
  manifest.description = "Sistema de gestión y productividad industrial";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log("  ✓ Nombre actualizado en manifest");
  console.log(`✅ Actualizado: ${manifestPath}`);
}

// 4. Privacy policy
console.log("\n📄 app/privacy/page.js");
patch(path.join(APP, "privacy", "page.js"), [
  { find: "GI Group RRHH",
    replace: "Gypi (Gestión y productividad industrial)",
    desc: "Cambiar nombre en privacy" },
  { find: "GI Amoblamientos SRL",
    replace: "Gypi Software",
    desc: "Cambiar empresa en privacy" },
]);

// 5. Terms
console.log("\n📄 app/terms/page.js");
patch(path.join(APP, "terms", "page.js"), [
  { find: "GI Group RRHH",
    replace: "Gypi (Gestión y productividad industrial)",
    desc: "Cambiar nombre en terms" },
  { find: "GI Amoblamientos SRL",
    replace: "Gypi Software",
    desc: "Cambiar empresa en terms" },
]);

console.log("\n✅ Nombre cambiado. Hacé deploy:\n");
console.log("  git add .");
console.log('  git commit -m "fase4: renombrar app a Gypi"');
console.log("  git push");
console.log("  npx vercel --prod\n");

console.log("⚠️  NOTA: Los archivos claude.js e instalador_screen.jsx mencionan");
console.log('  "GI Amoblamientos" en los prompts de IA. Por ahora los dejamos');
console.log("  porque esos prompts se van a hacer dinámicos en la Fase 5\n");
