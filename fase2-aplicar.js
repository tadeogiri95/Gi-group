// ═══════════════════════════════════════════════════════════
// FASE 2 — Script de limpieza automática
// Ejecutar desde la raíz del proyecto:
//   node fase2-aplicar.js
// ═══════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "app");

// Helper: leer, transformar, escribir
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

// ─── Definiciones locales a eliminar ───
// Tag con style prop (dashboard, reportes, actividad, gerencia_actividad)
const TAG_WITH_STYLE = `const Tag = ({ color = C.amber, children, style = {} }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: \`\${color}22\`, color, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: fB, ...style }}>{children}</span>
);`;

// Tag sin style prop (geo, calendario, gestion_personal, grilla)
const TAG_NO_STYLE = `const Tag = ({ color = C.amber, children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: \`\${color}22\`, color, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: fB }}>{children}</span>
);`;

// Chip (misma en todos)
const CHIP_DEF = `const Chip = ({ active, onClick, children, color = C.amber }) => (
  <button onClick={onClick} style={{
    padding: "7px 12px", borderRadius: 20, border: "none", cursor: "pointer",
    background: active ? \`\${color}22\` : C.surface,
    color: active ? color : C.dim,
    fontSize: 11, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap",
    transition: "all 0.15s",
  }}>{children}</button>
);`;

// ─── DIVISIONES variantes ───
const DIV_DASHBOARD = `const DIVISIONES = [
  { id: "todas", label: "Todas", icon: "📊", color: C.amber },
  { id: "herreria", label: "Herrería", icon: "🔥", color: C.amber },
  { id: "muebles", label: "Muebles", icon: "🪵", color: C.green },
  { id: "aberturas", label: "Aberturas", icon: "🪟", color: C.cyan },
  { id: "general", label: "General", icon: "🏭", color: C.violet },
];`;

const DIV_GERENCIA_ACT = `const DIVISIONES = [
  { id: "todas", label: "Todas" },
  { id: "herreria", label: "Herrería", icon: "🔥", color: C.amber },
  { id: "muebles", label: "Muebles", icon: "🪵", color: C.green },
  { id: "aberturas", label: "Aberturas", icon: "🪟", color: C.cyan },
  { id: "general", label: "General", icon: "🏭", color: C.violet },
];`;

const DIV_GESTION = `const DIVISIONES = [
  { id: "", label: "Sin asignar" },
  { id: "herreria", label: "Herrería", icon: "🔥", color: C.amber },
  { id: "muebles", label: "Muebles", icon: "🪵", color: C.green },
  { id: "aberturas", label: "Aberturas", icon: "🪟", color: C.cyan },
  { id: "general", label: "General", icon: "🏭", color: C.violet },
];`;

const DIV_SIMPLE = `const DIVISIONES = [
  { id: "todas", label: "Todos" },
  { id: "herreria", label: "🔥 Herrería", color: C.amber },
  { id: "muebles", label: "🪵 Muebles", color: C.green },
  { id: "aberturas", label: "🪟 Aberturas", color: C.cyan },
  { id: "general", label: "🏭 General", color: C.violet },
];`;

const DIV_CALENDARIO = `const DIVISIONES = [
  { id: "todas", label: "Todas" },
  { id: "herreria", label: "🔥 Herrería", color: C.amber },
  { id: "muebles", label: "🪵 Muebles", color: C.green },
  { id: "aberturas", label: "🪟 Aberturas", color: C.cyan },
  { id: "general", label: "🏭 General", color: C.violet },
];`;

// ─── page.js: Tag y Chip en una sola línea ───
const PAGE_TAG = `const Tag = ({color=C.amber,children}) => <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:6,background:\`\${color}22\`,color,fontSize:10,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",fontFamily:fB}}>{children}</span>;`;
const PAGE_CHIP = `const Chip = ({active,onClick,children,color=C.amber}) => <button onClick={onClick} style={{padding:"7px 14px",borderRadius:999,border:\`1px solid \${active?color:C.border}\`,background:active?\`\${color}22\`:"transparent",color:active?color:C.dim,fontSize:12,fontWeight:600,fontFamily:fB,whiteSpace:"nowrap",cursor:"pointer"}}>{children}</button>;`;

// ═══ APLICAR CAMBIOS ═══
console.log("\n🔧 FASE 2 — Limpieza de código\n");

// 1. page.js
console.log("📄 page.js");
patch(path.join(APP, "page.js"), [
  { find: `/* ═══ PRIMITIVES ═══ */\n${PAGE_TAG}\n${PAGE_CHIP}`,
    replace: `import { Tag, Chip } from "./components/ui";`,
    desc: "Reemplazar Tag/Chip locales por import" },
]);

// 2. dashboard_gerencia.jsx
console.log("\n📄 dashboard_gerencia.jsx");
patch(path.join(APP, "dashboard_gerencia.jsx"), [
  { find: `/* ─── Primitivas UI ─── */\n${TAG_WITH_STYLE}\n\n${CHIP_DEF}`,
    replace: `import { Tag, Chip } from "./components/ui";`,
    desc: "Reemplazar Tag/Chip" },
  { find: DIV_DASHBOARD,
    replace: `import { DIVISIONES_CON_TODAS as DIVISIONES } from "./lib/constants";`,
    desc: "Reemplazar DIVISIONES" },
]);

// 3. reportes_screen.jsx
console.log("\n📄 reportes_screen.jsx");
patch(path.join(APP, "reportes_screen.jsx"), [
  { find: `/* ─── Primitivas UI ─── */\n${TAG_WITH_STYLE}\n${CHIP_DEF}`,
    replace: `import { Tag, Chip } from "./components/ui";`,
    desc: "Reemplazar Tag/Chip" },
  { find: DIV_SIMPLE,
    replace: `import { DIVISIONES_CON_TODOS as DIVISIONES } from "./lib/constants";`,
    desc: "Reemplazar DIVISIONES" },
]);

// 4. gerencia_actividad_screen.jsx
console.log("\n📄 gerencia_actividad_screen.jsx");
patch(path.join(APP, "gerencia_actividad_screen.jsx"), [
  { find: TAG_WITH_STYLE, replace: "", desc: "Borrar Tag local" },
  { find: CHIP_DEF, replace: "", desc: "Borrar Chip local" },
  { find: DIV_GERENCIA_ACT,
    replace: `import { DIVISIONES_CON_TODAS as DIVISIONES } from "./lib/constants";`,
    desc: "Reemplazar DIVISIONES" },
  // Agregar import al inicio después del último import existente
  { regex: /(import\s+{[^}]+}\s+from\s+"\.\/lib\/supabase";)/,
    replace: `$1\nimport { Tag, Chip } from "./components/ui";`,
    desc: "Agregar import Tag/Chip" },
]);

// 5. geolocalizacion_screen.jsx
console.log("\n📄 geolocalizacion_screen.jsx");
patch(path.join(APP, "geolocalizacion_screen.jsx"), [
  { find: `/* ═══ PRIMITIVAS ═══ */\n${TAG_NO_STYLE}\n${CHIP_DEF}`,
    replace: `import { Tag, Chip } from "./components/ui";`,
    desc: "Reemplazar Tag/Chip" },
  { find: DIV_SIMPLE,
    replace: `import { DIVISIONES_CON_TODOS as DIVISIONES } from "./lib/constants";`,
    desc: "Reemplazar DIVISIONES" },
]);

// 6. gestion_personal_screen.jsx
console.log("\n📄 gestion_personal_screen.jsx");
patch(path.join(APP, "gestion_personal_screen.jsx"), [
  { find: TAG_NO_STYLE, replace: "", desc: "Borrar Tag local" },
  { find: CHIP_DEF, replace: "", desc: "Borrar Chip local" },
  { find: DIV_GESTION,
    replace: `import { DIVISIONES_CON_SIN_ASIGNAR as DIVISIONES } from "./lib/constants";`,
    desc: "Reemplazar DIVISIONES" },
  { regex: /(import\s+{[^}]+}\s+from\s+"\.\/lib\/supabase";)/,
    replace: `$1\nimport { Tag, Chip } from "./components/ui";`,
    desc: "Agregar import Tag/Chip" },
]);

// 7. grilla_horario_screen.jsx
console.log("\n📄 grilla_horario_screen.jsx");
patch(path.join(APP, "grilla_horario_screen.jsx"), [
  { find: TAG_NO_STYLE, replace: "", desc: "Borrar Tag local" },
  { find: CHIP_DEF, replace: "", desc: "Borrar Chip local" },
  { find: DIV_SIMPLE,
    replace: `import { DIVISIONES_CON_TODOS as DIVISIONES } from "./lib/constants";`,
    desc: "Reemplazar DIVISIONES" },
  { regex: /(import\s+{[^}]+}\s+from\s+"\.\/lib\/supabase";)/,
    replace: `$1\nimport { Tag, Chip } from "./components/ui";`,
    desc: "Agregar import Tag/Chip" },
]);

// 8. calendario_screen.jsx
console.log("\n📄 calendario_screen.jsx");
patch(path.join(APP, "calendario_screen.jsx"), [
  { find: TAG_NO_STYLE, replace: "", desc: "Borrar Tag local" },
  { find: CHIP_DEF, replace: "", desc: "Borrar Chip local" },
  { find: DIV_CALENDARIO,
    replace: `import { DIVISIONES_CON_TODAS as DIVISIONES } from "./lib/constants";`,
    desc: "Reemplazar DIVISIONES" },
  { regex: /(import\s+{[^}]+}\s+from\s+"\.\/lib\/supabase";)/,
    replace: `$1\nimport { Tag, Chip } from "./components/ui";`,
    desc: "Agregar import Tag/Chip" },
]);

// 9. actividad_screen.jsx (solo Tag, no tiene Chip ni DIVISIONES)
console.log("\n📄 actividad_screen.jsx");
patch(path.join(APP, "actividad_screen.jsx"), [
  { find: `/* ═══ TAG ═══ */\n${TAG_WITH_STYLE}`,
    replace: `import { Tag } from "./components/ui";`,
    desc: "Reemplazar Tag" },
]);

// 10. Eliminar fmtTime duplicado en actividad_screen.jsx
console.log("\n📄 actividad_screen.jsx (fmtTime duplicado)");
patch(path.join(APP, "actividad_screen.jsx"), [
  { find: `const fmtTime = (d) => d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });`,
    replace: `import { fmtTime } from "./lib/theme";`,
    desc: "Reemplazar fmtTime local por import" },
]);

console.log("\n✅ Fase 2 completada. Revisá que todo compile con: npm run build\n");
