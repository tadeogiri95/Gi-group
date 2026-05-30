/**
 * fix-4-problemas.js
 * 
 * Corrige:
 * 1. Fichaje via bot: el /api/fichar devuelve array sin desenvolver → tardanza no llega al frontend
 * 2. Bot no debe ofrecer "¿Cuántas horas llevo?" ni dar info de horas trabajadas
 * 3. Botón "Reporte de Instalación" debe tener mismo tamaño que "Iniciar tarea"
 * 4. Iniciar tarea falla porque codigo_proyecto se manda como string y la DB espera integer
 * 
 * USO:
 *   node fix-4-problemas.js
 * 
 * Ejecutar desde la raíz del proyecto (donde está app/)
 */

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "app");

// Verificar que existe la carpeta app
if (!fs.existsSync(APP)) {
  console.error("❌ No se encontró la carpeta 'app/'. Ejecutá este script desde la raíz del proyecto.");
  process.exit(1);
}

let cambios = 0;

// ═══════════════════════════════════════════════════════════
// 1. FIX: /api/fichar/route.js — Desenvolver array del RPC
// ═══════════════════════════════════════════════════════════
console.log("\n📄 1. app/api/fichar/route.js — Desenvolver resultado RPC");

const FICHAR_PATH = path.join(APP, "api", "fichar", "route.js");
if (fs.existsSync(FICHAR_PATH)) {
  let f = fs.readFileSync(FICHAR_PATH, "utf-8");
  const fOrig = f;

  // El problema: "return NextResponse.json(resultado)" devuelve el array crudo del RPC.
  // Si la función SQL retorna un objeto JSON envuelto en array, el frontend recibe [{}]
  // y res.ok / res.tardanza quedan undefined.
  
  // Buscar el patrón donde se asigna resultado del ingreso
  if (f.includes("return NextResponse.json(resultado)") && !f.includes("Array.isArray(resultado)")) {
    f = f.replace(
      "return NextResponse.json(resultado);",
      `// Desenvolver array si el RPC retorna setof/array
    const final = Array.isArray(resultado) ? (resultado[0] || { ok: false, error: "Sin respuesta del servidor" }) : resultado;
    return NextResponse.json(final);`
    );
    console.log("  ✓ Agregado desenvuelve de array en respuesta");
  } else if (f.includes("Array.isArray(resultado)")) {
    console.log("  — Ya tiene el fix aplicado");
  } else {
    console.log("  ⚠️ No se encontró el patrón esperado. Verificá manualmente.");
  }

  if (f !== fOrig) {
    fs.writeFileSync(FICHAR_PATH, f, "utf-8");
    cambios++;
    console.log("  ✅ Guardado");
  }
} else {
  console.log("  ⚠️ No se encontró app/api/fichar/route.js");
}

// ═══════════════════════════════════════════════════════════
// 2. FIX: page.js — Quitar "¿Cuántas horas llevo?" de quickReplies
// ═══════════════════════════════════════════════════════════
console.log("\n📄 2. app/page.js — Quitar opción de horas del bot");

// Buscar page.js en app/ (puede ser app/page.js o app/(main)/page.js, etc.)
function findPageJs(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === "page.js") {
      const content = fs.readFileSync(full, "utf-8");
      if (content.includes("ChatScreen") && content.includes("quickReplies")) {
        return full;
      }
    }
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
      const found = findPageJs(full);
      if (found) return found;
    }
  }
  return null;
}

const PAGE_PATH = findPageJs(APP);
if (PAGE_PATH) {
  let p = fs.readFileSync(PAGE_PATH, "utf-8");
  const pOrig = p;

  // Quitar "¿Cuántas horas llevo?" de los quickReplies
  // El patrón actual es: quickReplies:["Ya llegué","Necesito un permiso","¿Cuántas horas llevo?","Me voy"]
  if (p.includes('"¿Cuántas horas llevo?"')) {
    // Quitar la opción y la coma que la acompaña
    p = p.replace(',"¿Cuántas horas llevo?"', '');
    p = p.replace('"¿Cuántas horas llevo?",', '');
    console.log("  ✓ Removido '¿Cuántas horas llevo?' de quickReplies");
  } else {
    console.log("  — Ya no tiene la opción de horas");
  }

  if (p !== pOrig) {
    fs.writeFileSync(PAGE_PATH, p, "utf-8");
    cambios++;
    console.log("  ✅ Guardado:", PAGE_PATH);
  }
} else {
  console.log("  ⚠️ No se encontró page.js con ChatScreen");
}

// ═══════════════════════════════════════════════════════════
// 3. FIX: claude.js — Agregar regla de NO dar horas trabajadas
// ═══════════════════════════════════════════════════════════
console.log("\n📄 3. lib/claude.js — Agregar restricción de horas trabajadas");

// Buscar claude.js
function findFile(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return full;
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
      const found = findFile(full, name);
      if (found) return found;
    }
  }
  return null;
}

const CLAUDE_PATH = findFile(APP, "claude.js");
if (CLAUDE_PATH) {
  let c = fs.readFileSync(CLAUDE_PATH, "utf-8");
  const cOrig = c;

  if (!c.includes("NUNCA informes horas trabajadas")) {
    // Agregar regla después de "Máximo 1-2 emojis."
    c = c.replace(
      "- Máximo 1-2 emojis.",
      `- Máximo 1-2 emojis.
- NUNCA informes horas trabajadas, horas acumuladas, ni des la opción de consultarlas. Si el empleado pregunta cuántas horas lleva, respondé: "Esa información la podés consultar con tu supervisor." No calcules ni estimes horas.`
    );
    console.log("  ✓ Agregada regla de NO dar horas trabajadas");
  } else {
    console.log("  — Ya tiene la regla");
  }

  if (c !== cOrig) {
    fs.writeFileSync(CLAUDE_PATH, c, "utf-8");
    cambios++;
    console.log("  ✅ Guardado:", CLAUDE_PATH);
  }
} else {
  console.log("  ⚠️ No se encontró claude.js");
}

// ═══════════════════════════════════════════════════════════
// 4. FIX: actividad_screen.jsx — Botón Reporte mismo tamaño + iniciarTarea
// ═══════════════════════════════════════════════════════════
console.log("\n📄 4. actividad_screen.jsx — Botón Reporte + fix iniciarTarea");

const ACTIV_PATH = findFile(APP, "actividad_screen.jsx");
if (ACTIV_PATH) {
  let a = fs.readFileSync(ACTIV_PATH, "utf-8");
  const aOrig = a;

  // 4a. Reemplazar el botón de Reporte de Instalación con el mismo estilo que Iniciar tarea
  const oldReporteBtn = `{/* Botón Reporte de Instalación */}
          <button onClick={() => setShowReporte(true)} style={{
            width: "100%", marginTop: 12, padding: 16, borderRadius: 16,
            background: \`linear-gradient(135deg, \${C.cyan}12, \${C.surface})\`,
            border: \`1px solid \${C.cyan}30\`, color: C.text,
            fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: \`\${C.cyan}22\`, color: C.cyan, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📋</div>
            <div style={{ textAlign: "left", flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Reporte de Instalación</div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Reportar progreso, faltantes y desvíos</div>
            </div>
            <span style={{ color: C.dim, fontSize: 14 }}>→</span>
          </button>`;

  const newReporteBtn = `{/* Botón Reporte de Instalación — mismo estilo que Iniciar tarea */}
          <button onClick={() => setShowReporte(true)} style={{
            width: "100%", marginTop: 12, padding: "16px 24px", borderRadius: 16,
            background: C.cyan, border: "none", color: "#000",
            fontSize: 16, fontWeight: 700, fontFamily: fB, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <span style={{ fontSize: 20 }}>📋</span> Reporte de Instalación
          </button>`;

  if (a.includes(oldReporteBtn)) {
    a = a.replace(oldReporteBtn, newReporteBtn);
    console.log("  ✓ Botón Reporte igualado al de Iniciar tarea");
  } else {
    console.log("  ⚠️ No se encontró el patrón exacto del botón Reporte. Buscando alternativo...");
    // Intento alternativo: buscar por fragmentos clave
    if (a.includes('Reporte de Instalación</div>') && a.includes('fontSize: 14, fontWeight: 700, color: C.text')) {
      // Reemplazo por fragmentos
      const start = a.indexOf('{/* Botón Reporte de Instalación');
      if (start === -1) {
        // Buscar sin el comentario
        const btnStart = a.indexOf("setShowReporte(true)");
        if (btnStart > -1) {
          // Encontrar el <button que contiene setShowReporte
          let bStart = a.lastIndexOf("<button", btnStart);
          let depth = 0;
          let bEnd = bStart;
          for (let i = bStart; i < a.length; i++) {
            if (a.slice(i, i + 7) === "<button") depth++;
            if (a.slice(i, i + 9) === "</button>") {
              depth--;
              if (depth === 0) { bEnd = i + 9; break; }
            }
          }
          const oldBtn = a.slice(bStart, bEnd);
          const replacement = `<button onClick={() => setShowReporte(true)} style={{
            width: "100%", marginTop: 12, padding: "16px 24px", borderRadius: 16,
            background: C.cyan, border: "none", color: "#000",
            fontSize: 16, fontWeight: 700, fontFamily: fB, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <span style={{ fontSize: 20 }}>📋</span> Reporte de Instalación
          </button>`;
          a = a.replace(oldBtn, replacement);
          console.log("  ✓ Botón Reporte reemplazado (método alternativo)");
        }
      }
    }
  }

  // 4b. Fix iniciarTarea: convertir OT a Number
  // En la función iniciarTarea de actividad_screen.jsx
  if (a.includes("codigo_proyecto: etapaSeleccionada === 0 ? null : otFinal")) {
    a = a.replace(
      "codigo_proyecto: etapaSeleccionada === 0 ? null : otFinal",
      "codigo_proyecto: etapaSeleccionada === 0 ? null : (otFinal ? Number(otFinal) || otFinal : null)"
    );
    console.log("  ✓ iniciarTarea: codigo_proyecto convertido a Number");
  } else {
    console.log("  — codigo_proyecto ya tiene conversión o patrón diferente");
  }

  if (a !== aOrig) {
    fs.writeFileSync(ACTIV_PATH, a, "utf-8");
    cambios++;
    console.log("  ✅ Guardado:", ACTIV_PATH);
  }
} else {
  console.log("  ⚠️ No se encontró actividad_screen.jsx");
}

// ═══════════════════════════════════════════════════════════
// 5. FIX: useActividad.js — Convertir codigo_proyecto a Number
// ═══════════════════════════════════════════════════════════
console.log("\n📄 5. useActividad.js — Asegurar codigo_proyecto como Number");

const HOOK_PATH = findFile(APP, "useActividad.js");
if (HOOK_PATH) {
  let h = fs.readFileSync(HOOK_PATH, "utf-8");
  const hOrig = h;

  // El patrón actual: codigo_proyecto: etapa === 0 ? null : (codigo_proyecto || null),
  if (h.includes("codigo_proyecto: etapa === 0 ? null : (codigo_proyecto || null)")) {
    h = h.replace(
      "codigo_proyecto: etapa === 0 ? null : (codigo_proyecto || null)",
      "codigo_proyecto: etapa === 0 ? null : (codigo_proyecto ? Number(codigo_proyecto) || codigo_proyecto : null)"
    );
    console.log("  ✓ codigo_proyecto convertido a Number en useActividad");
  } else {
    console.log("  — Ya tiene conversión o patrón diferente");
  }

  if (h !== hOrig) {
    fs.writeFileSync(HOOK_PATH, h, "utf-8");
    cambios++;
    console.log("  ✅ Guardado:", HOOK_PATH);
  }
} else {
  console.log("  ⚠️ No se encontró useActividad.js");
}

// ═══════════════════════════════════════════════════════════
// RESUMEN
// ═══════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(50));
console.log(`✅ ${cambios} archivo(s) modificado(s)`);
console.log("═".repeat(50));
console.log("\n🔄 Después de ejecutar, hacé deploy con: vercel --prod");
console.log("   O si usás Vercel Git: hacé push del commit.\n");
