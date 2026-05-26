// ═══════════════════════════════════════════════════════════
// FASE 5.3 — Personalización visual: divisiones, etapas y colores dinámicos
// Ejecutar desde la raíz del proyecto:
//   node fase5-3-personalizacion.js
//
// ANTES de ejecutar:
//   1. Ejecutar el SQL en Supabase (01-divisiones-etapas.sql)
//   2. Copiar route-config-empresa.js a app/api/config-empresa/route.js
//   3. Copiar route-upload-logo.js a app/api/upload-logo/route.js
//   4. Reemplazar app/admin_empresa_screen.jsx con el nuevo
//
// DESPUÉS de ejecutar:
//   npm run build
//   git add . && git commit -m "fase5.3: personalización visual"
//   git push && npx vercel --prod
// ═══════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "app");
const ok = (m) => console.log("  ✓ " + m);
const warn = (m) => console.log("  ⚠ " + m);
const skip = (m) => console.log("  — " + m);

function readFile(rel) {
  const p = path.join(APP, rel);
  if (!fs.existsSync(p)) { warn("No existe: " + rel); return null; }
  return { path: p, content: fs.readFileSync(p, "utf-8") };
}
function writeFile(p, content) { fs.writeFileSync(p, content, "utf-8"); }

// ═══════════════════════════════════════════════════════════
// 1. CONSTANTS.JS — Divisiones dinámicas con fallback
// ═══════════════════════════════════════════════════════════
console.log("\n📄 lib/constants.js — Hacer divisiones dinámicas");

const constPath = path.join(APP, "lib", "constants.js");
if (!fs.existsSync(path.join(APP, "lib"))) fs.mkdirSync(path.join(APP, "lib"), { recursive: true });

const NEW_CONSTANTS = `// ═══════════════════════════════════════════════════════════
// Constantes compartidas — FASE 5.3: divisiones dinámicas
// ═══════════════════════════════════════════════════════════

import { C } from "./theme";

// Fallback (se usan si no se cargan las dinámicas)
const DIVISIONES_FALLBACK = [
  { id: "herreria", label: "Herrería", icon: "🔥", color: C.amber },
  { id: "muebles", label: "Muebles", icon: "🪵", color: C.green },
  { id: "aberturas", label: "Aberturas", icon: "🪟", color: C.cyan },
  { id: "general", label: "General", icon: "🏭", color: C.violet },
];

// Store global (se setea en page.js al login)
let _divisiones = null;

export function setDivisionesEmpresa(divs) {
  if (divs && divs.length > 0) {
    _divisiones = divs.map(d => ({
      id: d.clave || d.id,
      label: d.label || d.nombre,
      icon: d.icon || "📦",
      color: d.color || C.amber,
    }));
  }
}

export function getDivisionesBase() {
  return _divisiones || DIVISIONES_FALLBACK;
}
export function getDivisionesConTodas() {
  return [{ id: "todas", label: "Todas", icon: "📊", color: C.amber }, ...getDivisionesBase()];
}
export function getDivisionesConTodos() {
  return [{ id: "todas", label: "Todos" }, ...getDivisionesBase()];
}
export function getDivisionesConSinAsignar() {
  return [{ id: "", label: "Sin asignar" }, ...getDivisionesBase()];
}

// Exports estáticos retrocompatibles (fallback)
export const DIVISIONES_BASE = DIVISIONES_FALLBACK;
export const DIVISIONES_CON_TODAS = [{ id: "todas", label: "Todas", icon: "📊", color: C.amber }, ...DIVISIONES_FALLBACK];
export const DIVISIONES_CON_TODOS = [{ id: "todas", label: "Todos" }, ...DIVISIONES_FALLBACK];
export const DIVISIONES_CON_SIN_ASIGNAR = [{ id: "", label: "Sin asignar" }, ...DIVISIONES_FALLBACK];

// Días (sin cambios)
export const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
export const DIAS_LABEL = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
export const DIAS_LABEL_FULL = { lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo" };
export const DIAS_LABEL_SHORT = ["D", "L", "M", "X", "J", "V", "S"];
export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
`;

fs.writeFileSync(constPath, NEW_CONSTANTS, "utf-8");
ok("constants.js reescrito con divisiones dinámicas + fallback");

// ═══════════════════════════════════════════════════════════
// 2. PAGE.JS — Cargar config empresa al login
// ═══════════════════════════════════════════════════════════
console.log("\n📄 page.js — Cargar config empresa al login");

const pageFile = readFile("page.js");
if (pageFile) {
  let p = pageFile.content;

  // 2a. Import de setDivisionesEmpresa
  if (!p.includes("setDivisionesEmpresa")) {
    if (p.match(/import\s*{[^}]+}\s*from\s*["']\.\/lib\/constants["']/)) {
      p = p.replace(
        /import\s*{([^}]+)}\s*from\s*["']\.\/lib\/constants["']/,
        (match, imports) => `import {${imports}, setDivisionesEmpresa } from "./lib/constants"`
      );
    } else {
      // Insertar después de algún import existente
      p = p.replace(
        /(import\s+.*from\s+['"]\.\/lib\/supabase['"];?)/,
        '$1\nimport { setDivisionesEmpresa } from "./lib/constants";'
      );
    }
    ok("Import setDivisionesEmpresa agregado");
  }

  // 2b. State de divisionesEmpresa
  if (!p.includes("divisionesEmpresa")) {
    const m = p.match(/const\s*\[empresa\s*,\s*setEmpresa\]\s*=\s*useState/);
    if (m) {
      p = p.slice(0, m.index) +
        "const [divisionesEmpresa, setDivisionesEmpresaState] = useState([]);\n  const [etapasEmpresa, setEtapasEmpresa] = useState([]);\n  " +
        p.slice(m.index);
      ok("States divisionesEmpresa y etapasEmpresa agregados");
    }
  }

  // 2c. Función loadConfigEmpresa
  if (!p.includes("loadConfigEmpresa")) {
    const loadDataMatch = p.match(/const\s+loadData\s*=/);
    if (loadDataMatch) {
      const ins = loadDataMatch.index;
      const fn = `
  // ─── Cargar divisiones y etapas de la empresa (Fase 5.3) ───
  const loadConfigEmpresa = async (eid) => {
    if (!eid) return;
    try {
      const res = await fetch("/api/config-empresa?empresa_id=" + eid);
      const data = await res.json();
      if (data.divisiones && data.divisiones.length > 0) {
        setDivisionesEmpresaState(data.divisiones);
        setDivisionesEmpresa(data.divisiones);
      }
      if (data.etapas) setEtapasEmpresa(data.etapas);
    } catch (e) { console.error("Error cargando config empresa:", e); }
  };

`;
      p = p.slice(0, ins) + fn + p.slice(ins);
      ok("Función loadConfigEmpresa agregada");
    }
  }

  // 2d. Llamar loadConfigEmpresa al setear empresa
  if (p.includes("setEmpresa(") && !p.includes("loadConfigEmpresa(")) {
    // Buscar el primer setEmpresa y agregar loadConfig después
    p = p.replace(
      /(setEmpresa\(([^)]+)\);)/,
      (match, full, arg) => `${full}\n      loadConfigEmpresa(${arg}?.id);`
    );
    ok("loadConfigEmpresa se llama después de setEmpresa");
  }

  // 2e. Pasar empresaId a GerenciaActividadScreen
  if (p.includes("<GerenciaActividadScreen") && !p.includes("empresaId={")) {
    p = p.replace(
      /<GerenciaActividadScreen\s*\/>/,
      '<GerenciaActividadScreen empresaId={empresa?.id}/>'
    );
    ok("Prop empresaId pasada a GerenciaActividadScreen");
  }

  // 2f. Pasar empresa a InstaladorScreen
  if (p.includes("<InstaladorScreen") && !p.includes("empresa={empresa}")) {
    p = p.replace(
      /<InstaladorScreen\s+usuario=\{usuario\}\s*\/?>/,
      '<InstaladorScreen usuario={usuario} empresa={empresa}/>'
    );
    ok("Prop empresa pasada a InstaladorScreen");
  }

  // 2g. Agregar empresa_id al hook useActividad
  const hookCall = "useActividad(usuario?{id:usuario.id,legajo:usuario.legajo,division:usuario.division}:null)";
  if (p.includes(hookCall)) {
    p = p.replace(
      hookCall,
      "useActividad(usuario?{id:usuario.id,legajo:usuario.legajo,division:usuario.division,empresa_id:empresa?.id||usuario?.empresa_id}:null)"
    );
    ok("empresa_id agregado al hook useActividad");
  }

  writeFile(pageFile.path, p);
  console.log("  ✅ Guardado: page.js\n");
}

// ═══════════════════════════════════════════════════════════
// 3. SCREENS — Usar getDivisiones() en vez de import estático
// ═══════════════════════════════════════════════════════════
console.log("📄 Actualizando screens para usar divisiones dinámicas...\n");

const screenUpdates = [
  { file: "calendario_screen.jsx",
    oldImport: 'import { DIVISIONES_CON_TODAS as DIVISIONES } from "./lib/constants";',
    newImport: 'import { getDivisionesConTodas } from "./lib/constants";',
    addLine: "  const DIVISIONES = getDivisionesConTodas();" },
  { file: "dashboard_gerencia.jsx",
    oldImport: 'import { DIVISIONES_CON_TODAS as DIVISIONES } from "./lib/constants";',
    newImport: 'import { getDivisionesConTodas } from "./lib/constants";',
    addLine: "  const DIVISIONES = getDivisionesConTodas();" },
  { file: "geolocalizacion_screen.jsx",
    oldImport: 'import { DIVISIONES_CON_TODOS as DIVISIONES } from "./lib/constants";',
    newImport: 'import { getDivisionesConTodos } from "./lib/constants";',
    addLine: "  const DIVISIONES = getDivisionesConTodos();" },
  { file: "gerencia_actividad_screen.jsx",
    oldImport: 'import { DIVISIONES_CON_TODAS as DIVISIONES } from "./lib/constants";',
    newImport: 'import { getDivisionesConTodas } from "./lib/constants";',
    addLine: "  const DIVISIONES = getDivisionesConTodas();" },
  { file: "gestion_personal_screen.jsx",
    oldImport: 'import { DIVISIONES_CON_SIN_ASIGNAR as DIVISIONES } from "./lib/constants";',
    newImport: 'import { getDivisionesConSinAsignar } from "./lib/constants";',
    addLine: "  const DIVISIONES = getDivisionesConSinAsignar();" },
  { file: "grilla_horario_screen.jsx",
    oldImport: 'import { DIVISIONES_CON_TODOS as DIVISIONES } from "./lib/constants";',
    newImport: 'import { getDivisionesConTodos } from "./lib/constants";',
    addLine: "  const DIVISIONES = getDivisionesConTodos();" },
];

for (const update of screenUpdates) {
  const file = readFile(update.file);
  if (!file) continue;
  let content = file.content;
  const orig = content;

  // Reemplazar import
  if (content.includes(update.oldImport)) {
    content = content.replace(update.oldImport, update.newImport);
    ok(update.file + ": import actualizado");
  } else if (content.includes(update.newImport)) {
    skip(update.file + ": import ya actualizado");
  } else {
    // Intentar regex flexible
    const oldFn = update.oldImport.match(/DIVISIONES_CON_\w+/)?.[0];
    if (oldFn && content.includes(oldFn)) {
      const rx = new RegExp("import\\s*{\\s*" + oldFn + "\\s+as\\s+DIVISIONES\\s*}\\s*from\\s*[\"']\\.\\/lib\\/constants[\"'];?");
      content = content.replace(rx, update.newImport);
      ok(update.file + ": import actualizado (regex)");
    } else {
      warn(update.file + ": import no encontrado");
    }
  }

  // Agregar const DIVISIONES = getDivisiones...() dentro del componente
  if (content.includes("getDivisiones") && !content.includes("const DIVISIONES = getDivisiones")) {
    const compMatch = content.match(/export\s+default\s+function\s+\w+\s*\([^)]*\)\s*{/);
    if (compMatch) {
      const at = compMatch.index + compMatch[0].length;
      content = content.slice(0, at) + "\n" + update.addLine + content.slice(at);
      ok(update.file + ": const DIVISIONES agregado dentro del componente");
    }
  }

  if (content !== orig) {
    writeFile(file.path, content);
    console.log("  ✅ " + update.file);
  }
}

// ═══════════════════════════════════════════════════════════
// 4. useActividad — Usar tabla "etapas" en vez de "catalogo_etapas"
// ═══════════════════════════════════════════════════════════
console.log("\n📄 hooks/useActividad.js — Usar tabla etapas dinámica");

const hookFile = readFile("hooks/useActividad.js");
if (hookFile) {
  let h = hookFile.content;
  const hOrig = h;

  // Cambiar query de catalogo_etapas a etapas
  h = h.replace(
    /sb\.get\(`catalogo_etapas\?division=eq\.\$\{empleado\.division\}&activo=eq\.true&order=orden\.asc`\)/g,
    'sb.get(`etapas?empresa_id=eq.${empleado.empresa_id}&activa=eq.true&order=orden.asc`)'
  );
  h = h.replace(
    /sb\.get\("catalogo_etapas\?activo=eq\.true&order=orden\.asc"\)/g,
    'sb.get(`etapas?empresa_id=eq.${empleado.empresa_id}&activa=eq.true&order=orden.asc`)'
  );

  // Cambiar dependencia del useEffect
  h = h.replace(
    /\[empleado\?\.division\]/g,
    "[empleado?.empresa_id]"
  );

  if (h !== hOrig) {
    writeFile(hookFile.path, h);
    ok("useActividad actualizado para usar tabla etapas");
    console.log("  ✅ hooks/useActividad.js\n");
  }
}

// ═══════════════════════════════════════════════════════════
// 5. gerencia_actividad_screen — Usar tabla "etapas"
// ═══════════════════════════════════════════════════════════
console.log("📄 gerencia_actividad_screen.jsx — Usar tabla etapas");

const gerFile = readFile("gerencia_actividad_screen.jsx");
if (gerFile) {
  let g = gerFile.content;
  const gOrig = g;

  if (g.includes("catalogo_etapas")) {
    // Agregar empresaId como prop
    g = g.replace(
      /export\s+default\s+function\s+GerenciaActividadScreen\(\s*\)/,
      "export default function GerenciaActividadScreen({ empresaId })"
    );

    g = g.replace(
      /sb\.get\("catalogo_etapas\?activo=eq\.true&order=orden\.asc"\)/,
      'sb.get(`etapas?empresa_id=eq.${empresaId}&activa=eq.true&order=orden.asc`)'
    );
    ok("Query actualizada y prop empresaId agregada");
  }

  if (g !== gOrig) {
    writeFile(gerFile.path, g);
    console.log("  ✅ gerencia_actividad_screen.jsx\n");
  }
}

// ═══════════════════════════════════════════════════════════
// RESUMEN
// ═══════════════════════════════════════════════════════════
console.log("\n" + "=".repeat(55));
console.log("✅ FASE 5.3 COMPLETADA");
console.log("=".repeat(55));
console.log("");
console.log("Lo que se hizo:");
console.log("  1. constants.js → divisiones dinámicas con fallback");
console.log("  2. page.js → carga divisiones/etapas al login");
console.log("  3. 6 screens → usan getDivisiones() dinámico");
console.log("  4. useActividad → carga etapas de tabla 'etapas'");
console.log("  5. gerencia_actividad → idem, con empresaId");
console.log("");
console.log("Próximos pasos:");
console.log("  1. npm run build");
console.log("  2. git add . && git commit -m 'fase5.3'");
console.log("  3. git push && npx vercel --prod");
console.log("");
console.log("Desde Admin → Divisiones y Admin → Etapas podés");
console.log("agregar, editar y eliminar. Se reflejan al recargar.");
console.log("");
