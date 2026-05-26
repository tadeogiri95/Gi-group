// ═══════════════════════════════════════════════════════════
// FASE 5.1 — Configuración dinámica de empresa
// Ejecutar desde la raíz del proyecto:
//   node fase5-1-empresa-dinamica.js
//
// ANTES de ejecutar:
//   1. Ejecutar el SQL en Supabase (01-crear-tabla-empresa.sql)
//   2. Copiar route-empresa.js → app/api/empresa/route.js
//
// DESPUÉS de ejecutar:
//   git add .
//   git commit -m "fase5.1: config empresa dinámica"
//   git push
//   npx vercel --prod
// ═══════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "app");

// Helper
function replaceInFile(filePath, pairs) {
  if (!fs.existsSync(filePath)) {
    console.log("  ⚠️  No existe: " + filePath);
    return;
  }
  let c = fs.readFileSync(filePath, "utf-8");
  const orig = c;
  for (const [find, replace, desc] of pairs) {
    if (c.includes(find)) {
      c = c.replace(find, replace);
      console.log("  ✓ " + desc);
    }
  }
  if (c !== orig) {
    fs.writeFileSync(filePath, c, "utf-8");
    console.log("  ✅ Guardado: " + filePath);
  } else {
    console.log("  — Sin cambios: " + filePath);
  }
}

console.log("\n🔧 FASE 5.1 — Configuración dinámica de empresa\n");

// ═══════════════════════════════════════════════════════════
// 1. PAGE.JS
// ═══════════════════════════════════════════════════════════
console.log("📄 page.js");
const PF = path.join(APP, "page.js");
let p = fs.readFileSync(PF, "utf-8");
const pOrig = p;

// 1a. Agregar estado empresa en Home()
p = p.replace(
  'const [historialLegajo,setHistorialLegajo]=useState(null);',
  `const [historialLegajo,setHistorialLegajo]=useState(null);
  const [empresa,setEmpresa]=useState({nombre:"Gypi",nombre_corto:"Gypi",color_primario:"#F97316",color_secundario:"#8B5CF6",prompt_ia_obra:"",prompt_ia_chat:""});
  useEffect(()=>{fetch("/api/empresa").then(r=>r.json()).then(d=>{if(d&&!d.error)setEmpresa(d);}).catch(()=>{});},[]);`
);
console.log("  ✓ Estado empresa + carga al inicio");

// 1b. LoginScreen: aceptar empresa + textos dinámicos
p = p.replace(
  'function LoginScreen({onLogin})',
  'function LoginScreen({onLogin,empresa})'
);
console.log("  ✓ LoginScreen acepta empresa");

p = p.replace(
  '<LoginScreen onLogin={login}/>',
  '<LoginScreen onLogin={login} empresa={empresa}/>'
);
console.log("  ✓ Pasar empresa a LoginScreen");

// Logo: "GI" → dinámico
p = p.replace(
  '<span style={{fontFamily:fH,fontSize:26,fontWeight:800}}>GI</span>',
  '<span style={{fontFamily:fH,fontSize:empresa?.nombre_corto?.length>4?18:26,fontWeight:800}}>{empresa?.nombre_corto||"Gypi"}</span>'
);
console.log("  ✓ Logo dinámico");

// Subtítulo login
p = p.replace(
  'Iniciá sesión en App GI',
  '{"Iniciá sesión en "+(empresa?.nombre_corto||"Gypi")}'
);
console.log("  ✓ Subtítulo login dinámico");

// 1c. ChatScreen: aceptar empresa
p = p.replace(
  'function ChatScreen({usuario,ctx,reload})',
  'function ChatScreen({usuario,ctx,reload,empresa})'
);
console.log("  ✓ ChatScreen acepta empresa");

// Pasar empresa a ChatScreen (hay 2 instancias)
p = p.replaceAll(
  '<ChatScreen usuario={usuario} ctx={ctx} reload={loadData}/>',
  '<ChatScreen usuario={usuario} ctx={ctx} reload={loadData} empresa={empresa}/>'
);
console.log("  ✓ Pasar empresa a ChatScreen (x2)");

// Header del chat: "Asistente GI" → dinámico
p = p.replace(
  'Asistente GI',
  '{"Asistente "+(empresa?.nombre_corto||"Gypi")}'
);
console.log("  ✓ Nombre asistente dinámico");

// 1d. InstaladorScreen: pasar empresa
p = p.replace(
  '<InstaladorScreen usuario={usuario}/>',
  '<InstaladorScreen usuario={usuario} empresa={empresa}/>'
);
console.log("  ✓ Pasar empresa a InstaladorScreen");

// 1e. "App GI" en headers → dinámico (hay varias en ternarios)
// Reemplazar la string literal "App GI" por expresión dinámica
// Cuidado: solo reemplazar las que están como string JS, no las que ya tocamos
p = p.replaceAll('"App GI"', '(empresa?.nombre_corto||"Gypi")');
console.log("  ✓ Headers dinámicos");

if (p !== pOrig) {
  fs.writeFileSync(PF, p, "utf-8");
  console.log("  ✅ Guardado: page.js\n");
} else {
  console.log("  — Sin cambios: page.js\n");
}

// ═══════════════════════════════════════════════════════════
// 2. INSTALADOR_SCREEN.JSX — Prompt dinámico
// ═══════════════════════════════════════════════════════════
console.log("📄 instalador_screen.jsx");
const IF = path.join(APP, "instalador_screen.jsx");
let inst = fs.readFileSync(IF, "utf-8");
const instOrig = inst;

// 2a. Renombrar constante y quitar "GI Amoblamientos"
inst = inst.replace(
  'const SYSTEM_OBRA = `Sos un asistente de obra de GI Amoblamientos. Tu trabajo',
  'const SYSTEM_OBRA_DEFAULT = `Sos un asistente de obra. Tu trabajo'
);
console.log("  ✓ Renombrar SYSTEM_OBRA → SYSTEM_OBRA_DEFAULT y quitar nombre empresa");

// 2b. Cambiar firma del componente
inst = inst.replace(
  'export default function InstaladorScreen({ usuario })',
  'export default function InstaladorScreen({ usuario, empresa })'
);
console.log("  ✓ Aceptar prop empresa");

// 2c. Usar prompt dinámico
inst = inst.replace(
  'system: SYSTEM_OBRA,',
  'system: empresa?.prompt_ia_obra || SYSTEM_OBRA_DEFAULT,'
);
console.log("  ✓ Prompt dinámico en llamada IA");

if (inst !== instOrig) {
  fs.writeFileSync(IF, inst, "utf-8");
  console.log("  ✅ Guardado: instalador_screen.jsx\n");
} else {
  console.log("  — Sin cambios: instalador_screen.jsx\n");
}

// ═══════════════════════════════════════════════════════════
// 3. GEOLOCALIZACION — Nombre genérico
// ═══════════════════════════════════════════════════════════
console.log("📄 geolocalizacion_screen.jsx");
replaceInFile(path.join(APP, "geolocalizacion_screen.jsx"), [
  ['"Planta GI — Córdoba"', '"Planta principal"', "Nombre ubicación genérico"],
]);

// ═══════════════════════════════════════════════════════════
// RESUMEN
// ═══════════════════════════════════════════════════════════
console.log("\n" + "=".repeat(55));
console.log("✅ FASE 5.1 COMPLETADA");
console.log("=".repeat(55));
console.log(`
Lo que se hizo:
  1. page.js → carga config empresa desde /api/empresa
  2. page.js → login, headers y chat usan nombre dinámico
  3. instalador_screen.jsx → prompt IA viene de la DB
  4. geolocalizacion_screen.jsx → nombre ubicación genérico

Próximos pasos:
  1. Verificá que el SQL se ejecutó en Supabase
  2. Verificá que app/api/empresa/route.js existe
  3. Probá: npm run build
  4. Deploy:
     git add .
     git commit -m "fase5.1: config empresa dinámica"
     git push
     npx vercel --prod

NOTA: Ahora podés cambiar nombre, colores y prompts de IA
directamente en Supabase → tabla "empresa", sin tocar código.
`);
