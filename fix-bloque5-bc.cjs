// ═══════════════════════════════════════════════════════════
// fix-bloque5-bc.js — Aplica unificación env vars + limpieza hardcodes
// Uso:  node fix-bloque5-bc.js
// Borrar después de ejecutar (no se vuelve a usar)
// ═══════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
let cambios = 0;
let errores = 0;

function leer(p) {
  try { return fs.readFileSync(path.join(ROOT, p), "utf8"); } catch { return null; }
}
function escribir(p, contenido) {
  fs.writeFileSync(path.join(ROOT, p), contenido, "utf8");
}
function patch(file, replacements) {
  const orig = leer(file);
  if (orig === null) {
    console.log(`  ⚠️  ${file} no existe, salto`);
    return false;
  }
  let nuevo = orig;
  let aplicados = 0;
  for (const { buscar, reemplazar, etiqueta } of replacements) {
    if (typeof buscar === "string") {
      if (nuevo.includes(buscar)) {
        nuevo = nuevo.split(buscar).join(reemplazar);
        aplicados++;
        console.log(`     ✓ ${etiqueta}`);
      }
    } else {
      const antes = nuevo;
      nuevo = nuevo.replace(buscar, reemplazar);
      if (antes !== nuevo) {
        aplicados++;
        console.log(`     ✓ ${etiqueta}`);
      }
    }
  }
  if (aplicados === 0) {
    console.log(`     · sin cambios (ya estaba ok)`);
    return false;
  }
  escribir(file, nuevo);
  cambios++;
  return true;
}

console.log("\n═══ B.1 — Unificar env vars ═══\n");

// ─── B.1.a: planEnforcement.js ───
console.log("📄 app/lib/planEnforcement.js");
patch("app/lib/planEnforcement.js", [
  {
    buscar: "process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY",
    reemplazar: "process.env.SUPABASE_SERVICE_KEY",
    etiqueta: "Eliminar fallback a SUPABASE_SERVICE_ROLE_KEY",
  },
  {
    buscar: "process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL",
    reemplazar: "process.env.NEXT_PUBLIC_SUPABASE_URL",
    etiqueta: "Eliminar fallback a SUPABASE_URL",
  },
]);

// ─── B.1.b: URLs en api routes ───
const FILES_URL = [
  "app/api/data/route.js",
  "app/api/fichar/route.js",
  "app/api/cron/auto-fichaje/route.js",
  "app/api/send-push/route.js",
  "app/api/upload/route.js",
];
for (const f of FILES_URL) {
  console.log(`📄 ${f}`);
  patch(f, [
    {
      buscar: "process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL",
      reemplazar: "process.env.NEXT_PUBLIC_SUPABASE_URL",
      etiqueta: "Eliminar fallback a SUPABASE_URL",
    },
  ]);
}

console.log("\n═══ C.1 — Limpiar hardcodes ═══\n");

// ─── C.1.a: gigroup2025 en CambiarPasswordScreen ───
console.log("📄 app/[slug]/page.js");
patch("app/[slug]/page.js", [
  {
    buscar: `if(nueva==="gigroup2025"){setError("Elegí una contraseña distinta a la inicial");return;}`,
    reemplazar: "",
    etiqueta: 'Eliminar check de "gigroup2025"',
  },
]);

// ─── C.1.b: email contacto ───
console.log("📄 app/privacy/page.js");
patch("app/privacy/page.js", [
  {
    buscar: "contacto@gigroup.com.ar",
    reemplazar: "contacto@gypi.app",
    etiqueta: "Email contacto → gypi.app",
  },
]);

console.log("\n═══ Resumen ═══");
console.log(`✅ ${cambios} archivos modificados`);
console.log(`⚠️  ${errores} errores`);
console.log("\nSiguientes pasos manuales (ver mensaje del chat):");
console.log(" 1. Reemplazar public/firebase-messaging-sw.js + crear route dinámica");
console.log(" 2. Configurar env vars en Vercel (ver tabla)");
console.log(" 3. git add . && git commit -m 'chore: bloque 5 B+C' && git push");
console.log(" 4. Eliminar este script: del fix-bloque5-bc.js\n");
