// ═══════════════════════════════════════════════════════════
// FASE 5.2 — Multi-tenancy: aislamiento de datos por empresa
// Ejecutar desde la raíz del proyecto:
//   node fase5-2-multi-tenant.js
//
// ANTES de ejecutar:
//   1. Ejecutar el SQL en Supabase (01-empresa-id-y-rls.sql)
//   2. Copiar route-registro-empresa.js a app/api/registro-empresa/route.js
//   3. Copiar route-login-empresa.js a app/api/login/route.js (REEMPLAZA el actual)
//   4. Copiar admin_empresa_screen.jsx a app/admin_empresa_screen.jsx
//
// DESPUÉS de ejecutar:
//   npm run build
//   git add . && git commit -m "fase5.2: multi-tenancy" && git push
//   npx vercel --prod
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
      else console.log(`  — No match regex: ${t.desc}`);
    } else if (t.find) {
      console.log(`  — No encontrado: ${t.desc}`);
    }
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`✅ Actualizado: ${filePath}\n`);
  } else {
    console.log(`— Sin cambios: ${filePath}\n`);
  }
}

function patchAll(filePath, findStr, replaceStr, desc) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  No existe: ${filePath}`);
    return;
  }
  let content = fs.readFileSync(filePath, "utf-8");
  const original = content;
  while (content.includes(findStr)) {
    content = content.replace(findStr, replaceStr);
  }
  if (content !== original) {
    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`  ✓ ${desc}`);
  }
}

console.log("\n🔧 FASE 5.2 — Multi-tenancy\n");

// ═══════════════════════════════════════════
// 1. page.js — Cambios principales
// ═══════════════════════════════════════════
console.log("📄 page.js — Cambios principales");

const pageFile = path.join(APP, "page.js");
let pageContent = fs.readFileSync(pageFile, "utf-8");
const pageOriginal = pageContent;

// 1a. Agregar import de AdminEmpresaScreen y RegistroScreen
if (!pageContent.includes("AdminEmpresaScreen")) {
  pageContent = pageContent.replace(
    "import InstaladorScreen from './instalador_screen.jsx';",
    `import InstaladorScreen from './instalador_screen.jsx';
import AdminEmpresaScreen from './admin_empresa_screen';`
  );
  console.log("  ✓ Import AdminEmpresaScreen");
}

// 1b. Agregar RegistroScreen inline (antes de LoginScreen)
if (!pageContent.includes("RegistroEmpresaScreen")) {
  pageContent = pageContent.replace(
    "/* ═══ LOGIN ═══ */",
    `/* ═══ REGISTRO EMPRESA ═══ */
function RegistroEmpresaScreen({onBack,onRegistro}){
  const [form,setForm]=useState({nombre_empresa:"",nombre_admin:"",email:"",password:"",rubro:""});
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [ok,setOk]=useState(false);

  const rubros=["industria","construcción","servicios","comercio","tecnología","salud","educación","otro"];

  const registrar=async()=>{
    if(!form.nombre_empresa||!form.nombre_admin||!form.email||!form.password){setError("Completá todos los campos");return;}
    if(form.password.length<6){setError("La contraseña debe tener al menos 6 caracteres");return;}
    setLoading(true);setError("");
    try{
      const res=await fetch("/api/registro-empresa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      const data=await res.json();
      if(!res.ok||data.error){setError(data.error||"Error al registrar");setLoading(false);return;}
      setOk(true);
      setTimeout(()=>onRegistro(data.usuario),2000);
    }catch(err){setError(err.message);setLoading(false);}
  };

  if(ok)return <div style={{display:"flex",flexDirection:"column",height:"100%",alignItems:"center",justifyContent:"center",padding:"0 28px"}}>
    <div style={{fontSize:52,marginBottom:16}}>🎉</div>
    <h2 style={{margin:0,fontFamily:fH,fontSize:24,fontWeight:700,color:C.green,textAlign:"center"}}>¡Empresa creada!</h2>
    <p style={{color:C.dim,fontSize:14,textAlign:"center",marginTop:8}}>Ingresando al panel de administración...</p>
  </div>;

  return <div style={{display:"flex",flexDirection:"column",height:"100%",padding:"0 28px",justifyContent:"center",overflowY:"auto"}}>
    <button onClick={onBack} style={{background:"none",border:"none",color:C.amber,cursor:"pointer",fontSize:13,fontFamily:fB,padding:"8px 0",textAlign:"left",marginBottom:8}}>← Volver al login</button>
    <h1 style={{margin:0,fontFamily:fH,fontSize:26,fontWeight:700,color:C.text}}>Registrar empresa</h1>
    <div style={{fontSize:13,color:C.dim,marginTop:6,marginBottom:24}}>Creá tu cuenta y empezá a gestionar tu equipo</div>
    {[{k:"nombre_empresa",l:"Nombre de tu empresa",p:"Ej: Metalúrgica García"},{k:"nombre_admin",l:"Tu nombre completo",p:"Ej: Juan García"},{k:"email",l:"Email",p:"admin@tuempresa.com",type:"email"},{k:"password",l:"Contraseña",p:"Mínimo 6 caracteres",type:"password"}].map(f=>
      <div key={f.k} style={{marginBottom:12}}>
        <label style={{display:"block",fontSize:11,fontWeight:700,color:C.dim,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{f.l}</label>
        <input type={f.type||"text"} value={form[f.k]} onChange={e=>setForm({...form,[f.k]:e.target.value})} placeholder={f.p} style={{width:"100%",padding:"12px 14px",borderRadius:12,background:C.surface,border:\`1px solid \${C.border}\`,color:C.text,fontSize:14,fontFamily:fB,outline:"none",boxSizing:"border-box"}}/>
      </div>
    )}
    <div style={{marginBottom:16}}>
      <label style={{display:"block",fontSize:11,fontWeight:700,color:C.dim,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Rubro</label>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {rubros.map(r=><button key={r} onClick={()=>setForm({...form,rubro:r})} style={{padding:"6px 12px",borderRadius:20,border:\`1px solid \${form.rubro===r?C.amber:C.border}\`,background:form.rubro===r?\`\${C.amber}22\`:"transparent",color:form.rubro===r?C.amber:C.dim,fontSize:12,fontWeight:600,fontFamily:fB,cursor:"pointer",textTransform:"capitalize"}}>{r}</button>)}
      </div>
    </div>
    <button onClick={registrar} disabled={loading} style={{width:"100%",padding:14,borderRadius:12,background:C.amber,color:"#000",border:"none",fontSize:15,fontWeight:700,fontFamily:fB,cursor:"pointer",marginBottom:8,opacity:loading?0.6:1}}>{loading?"Creando empresa...":"Crear empresa"}</button>
    {error&&<div style={{padding:12,background:C.redS,color:C.red,borderRadius:10,fontSize:12,marginTop:8}}>{error}</div>}
  </div>;
}

/* ═══ LOGIN ═══ */`
  );
  console.log("  ✓ Agregar RegistroEmpresaScreen");
}

// 1c. Agregar link "Registrar empresa" al login
if (!pageContent.includes("showRegistro")) {
  // Agregar estado showRegistro al componente Home
  pageContent = pageContent.replace(
    "const [historialLegajo,setHistorialLegajo]=useState(null);",
    `const [historialLegajo,setHistorialLegajo]=useState(null);
  const [showRegistro,setShowRegistro]=useState(false);`
  );
  console.log("  ✓ Estado showRegistro");

  // Agregar botón de registro debajo del login
  pageContent = pageContent.replace(
    '{error&&<div style={{padding:12,background:C.redS,color:C.red,borderRadius:10,fontSize:12,marginTop:8}}>{error}</div>}\n  </div>;\n}',
    `{error&&<div style={{padding:12,background:C.redS,color:C.red,borderRadius:10,fontSize:12,marginTop:8}}>{error}</div>}
    <div style={{textAlign:"center",marginTop:20}}><span style={{fontSize:13,color:C.dim}}>¿No tenés cuenta? </span><button onClick={()=>onRegistrar&&onRegistrar()} style={{background:"none",border:"none",color:C.amber,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:fB}}>Registrar empresa</button></div>
  </div>;
}`
  );
  console.log("  ✓ Botón registrar empresa en login");

  // Agregar prop onRegistrar a LoginScreen
  pageContent = pageContent.replace(
    "function LoginScreen({onLogin})",
    "function LoginScreen({onLogin,onRegistrar})"
  );
  console.log("  ✓ Prop onRegistrar en LoginScreen");

  // Modificar el render para mostrar registro o login
  pageContent = pageContent.replace(
    '<div style={{flex:1,overflow:"hidden"}}><LoginScreen onLogin={login}/></div>',
    `<div style={{flex:1,overflow:"hidden"}}>{showRegistro?<RegistroEmpresaScreen onBack={()=>setShowRegistro(false)} onRegistro={(u)=>{setShowRegistro(false);login(u);}}/>:<LoginScreen onLogin={login} onRegistrar={()=>setShowRegistro(true)}/>}</div>`
  );
  console.log("  ✓ Render condicional login/registro");
}

// 1d. Guardar empresa_id del usuario logueado y pasarlo a las queries
// El login ahora devuelve usuario.empresa_id y usuario.empresa

// 1e. Modificar loadData para filtrar por empresa_id
if (!pageContent.includes("empresa_id=eq.${usuario.empresa_id}") && pageContent.includes("empleados?select=*&activo=eq.true&order=legajo.asc")) {
  pageContent = pageContent.replace(
    'sb.get("empleados?select=*&activo=eq.true&order=legajo.asc")',
    'sb.get(`empleados?select=*&activo=eq.true&empresa_id=eq.${usuario.empresa_id}&order=legajo.asc`)'
  );
  console.log("  ✓ Filtrar empleados por empresa_id");

  pageContent = pageContent.replace(
    'sb.get("solicitudes?select=*&order=created_at.desc&limit=50")',
    'sb.get(`solicitudes?select=*&empresa_id=eq.${usuario.empresa_id}&order=created_at.desc&limit=50`)'
  );
  console.log("  ✓ Filtrar solicitudes por empresa_id");

  pageContent = pageContent.replace(
    'sb.get("reglas_bot?activa=eq.true&order=id.asc")',
    'sb.get(`reglas_bot?activa=eq.true&empresa_id=eq.${usuario.empresa_id}&order=id.asc`)'
  );
  console.log("  ✓ Filtrar reglas_bot por empresa_id");
}

// 1f. Agregar empresa_id a todos los POST
const postTables = ["fichadas", "solicitudes", "notificaciones", "mensajes_chat", "reglas_bot"];
for (const table of postTables) {
  const postPattern = `sb.post("${table}",{`;
  if (pageContent.includes(postPattern)) {
    patchAll(pageFile + "_tmp", "", "", ""); // no-op
    let count = 0;
    while (pageContent.includes(postPattern)) {
      pageContent = pageContent.replace(
        postPattern,
        `sb.post("${table}",{empresa_id:usuario.empresa_id,`
      );
      count++;
    }
    if (count > 0) console.log(`  ✓ Agregar empresa_id a POST ${table} (${count}x)`);
  }
}

// 1g. Agregar tab "Admin" al nav de gerenciales
if (!pageContent.includes('"admin"')) {
  pageContent = pageContent.replace(
    '["equipo","Equipo",Ic.users]',
    '["equipo","Equipo",Ic.users],["admin","Admin",Ic.gear]'
  );
  console.log("  ✓ Tab Admin en nav gerencial");

  // Agregar render de AdminEmpresaScreen
  pageContent = pageContent.replace(
    '{isGer&&screen==="reportes"&&<ReportesScreen/>}',
    `{isGer&&screen==="reportes"&&<ReportesScreen/>}
        {isGer&&screen==="admin"&&<AdminEmpresaScreen empresa={usuario.empresa} empresaId={usuario.empresa_id} onUpdate={(e)=>{const u={...usuario,empresa:e};setUsuario(u);try{localStorage.setItem("gi-session",JSON.stringify(u));}catch{}}}/>}`
  );
  console.log("  ✓ Render AdminEmpresaScreen");
}

// 1h. Actualizar el header del chat para usar nombre dinámico de empresa
if (pageContent.includes("Asistente GI")) {
  pageContent = pageContent.replace(
    "Asistente GI",
    '${usuario.empresa?.nombre_corto||"Gypi"} IA'
  );
  // Necesitamos que sea template literal
  pageContent = pageContent.replace(
    `'$\{usuario.empresa?.nombre_corto||"Gypi"} IA'`,
    '`${usuario.empresa?.nombre_corto||"Gypi"} IA`'
  );
  console.log("  ✓ Nombre dinámico del asistente");
}

// 1i. Actualizar logo en login
if (pageContent.includes('<span style={{fontFamily:fH,fontSize:26,fontWeight:800}}>GI</span>')) {
  pageContent = pageContent.replace(
    '<span style={{fontFamily:fH,fontSize:26,fontWeight:800}}>GI</span>',
    '<span style={{fontFamily:fH,fontSize:22,fontWeight:800}}>Gypi</span>'
  );
  console.log("  ✓ Logo login actualizado");
}

if (pageContent.includes("Iniciá sesión en App GI")) {
  pageContent = pageContent.replace("Iniciá sesión en App GI", "Iniciá sesión");
  console.log("  ✓ Texto login actualizado");
}

// Guardar page.js
if (pageContent !== pageOriginal) {
  fs.writeFileSync(pageFile, pageContent, "utf-8");
  console.log(`✅ Actualizado: ${pageFile}\n`);
} else {
  console.log(`— Sin cambios: ${pageFile}\n`);
}

// ═══════════════════════════════════════════
// 2. Screens que hacen queries — agregar empresa_id
// ═══════════════════════════════════════════

// 2a. dashboard_gerencia.jsx
console.log("📄 dashboard_gerencia.jsx");
const dashFile = path.join(APP, "dashboard_gerencia.jsx");
if (fs.existsSync(dashFile)) {
  let dash = fs.readFileSync(dashFile, "utf-8");
  const dashOrig = dash;
  
  // Las queries del dashboard usan ctx que viene de page.js (ya filtrado)
  // Pero las queries directas de fichadas y resumen necesitan empresa_id
  
  // Agregar empresa_id a queries de fichadas
  if (dash.includes("v_resumen_diario?fecha=eq.")) {
    dash = dash.replace(
      /v_resumen_diario\?fecha=eq\.\$\{([^}]+)\}&select=\*/g,
      'v_resumen_diario?fecha=eq.${$1}&empresa_id=eq.${props?.empresaId||""}&select=*'
    );
    console.log("  ✓ Filtrar v_resumen_diario por empresa_id");
  }

  // Agregar prop empresaId
  if (!dash.includes("empresaId") && dash.includes("function DashboardGerencia(")) {
    // El dashboard recibe props — verificar qué recibe
    const match = dash.match(/function DashboardGerencia\(([^)]*)\)/);
    if (match) {
      console.log(`  — Dashboard recibe: ${match[1]}`);
    }
  }

  if (dash !== dashOrig) {
    fs.writeFileSync(dashFile, dash, "utf-8");
    console.log(`✅ Actualizado: ${dashFile}\n`);
  } else {
    console.log(`— Sin cambios: ${dashFile}\n`);
  }
}

// 2b. reportes_screen.jsx
console.log("📄 reportes_screen.jsx");
const repFile = path.join(APP, "reportes_screen.jsx");
if (fs.existsSync(repFile)) {
  let rep = fs.readFileSync(repFile, "utf-8");
  const repOrig = rep;
  
  // reportes_obra queries
  if (rep.includes("reportes_obra?fecha=eq.")) {
    rep = rep.replace(
      /reportes_obra\?fecha=eq\./g,
      'reportes_obra?empresa_id=eq.${empresaId}&fecha=eq.'
    );
    console.log("  ✓ Filtrar reportes_obra por empresa_id");
  }

  // fichadas queries  
  if (rep.includes("fichadas?fecha=gte.") || rep.includes("fichadas?select=legajo")) {
    rep = rep.replace(
      /fichadas\?fecha=gte\./g,
      'fichadas?empresa_id=eq.${empresaId}&fecha=gte.'
    );
    rep = rep.replace(
      /fichadas\?select=legajo,fecha/g,
      'fichadas?empresa_id=eq.${empresaId}&select=legajo,fecha'
    );
    console.log("  ✓ Filtrar fichadas en reportes por empresa_id");
  }
  
  if (rep !== repOrig) {
    fs.writeFileSync(repFile, rep, "utf-8");
    console.log(`✅ Actualizado: ${repFile}\n`);
  } else {
    console.log(`— Sin cambios: ${repFile}\n`);
  }
}

// 2c. gestion_personal_screen.jsx
console.log("📄 gestion_personal_screen.jsx");
const gestFile = path.join(APP, "gestion_personal_screen.jsx");
if (fs.existsSync(gestFile)) {
  let gest = fs.readFileSync(gestFile, "utf-8");
  const gestOrig = gest;
  
  // empleados queries
  if (gest.includes("empleados?select=*&order=nombre.asc")) {
    gest = gest.replace(
      'empleados?select=*&order=nombre.asc',
      'empleados?select=*&empresa_id=eq.${empresaId}&order=nombre.asc'
    );
    console.log("  ✓ Filtrar empleados por empresa_id");
  }

  // POST empleados — agregar empresa_id
  if (gest.includes('sb.post("empleados",{') && !gest.includes('empresa_id:empresaId')) {
    gest = gest.replace(
      /sb\.post\("empleados",\{/g,
      'sb.post("empleados",{empresa_id:empresaId,'
    );
    console.log("  ✓ Agregar empresa_id a POST empleados");
  }
  
  if (gest !== gestOrig) {
    fs.writeFileSync(gestFile, gest, "utf-8");
    console.log(`✅ Actualizado: ${gestFile}\n`);
  } else {
    console.log(`— Sin cambios: ${gestFile}\n`);
  }
}

// 2d. instalador_screen.jsx
console.log("📄 instalador_screen.jsx");
const instFile = path.join(APP, "instalador_screen.jsx");
if (fs.existsSync(instFile)) {
  let inst = fs.readFileSync(instFile, "utf-8");
  const instOrig = inst;
  
  if (inst.includes('sb.post("reportes_obra",{') && !inst.includes('empresa_id:usuario.empresa_id')) {
    inst = inst.replace(
      /sb\.post\("reportes_obra",\{/g,
      'sb.post("reportes_obra",{empresa_id:usuario.empresa_id,'
    );
    console.log("  ✓ Agregar empresa_id a POST reportes_obra");
  }
  
  if (inst !== instOrig) {
    fs.writeFileSync(instFile, inst, "utf-8");
    console.log(`✅ Actualizado: ${instFile}\n`);
  } else {
    console.log(`— Sin cambios: ${instFile}\n`);
  }
}

// 2e. calendario_screen.jsx
console.log("📄 calendario_screen.jsx");
const calFile = path.join(APP, "calendario_screen.jsx");
if (fs.existsSync(calFile)) {
  let cal = fs.readFileSync(calFile, "utf-8");
  const calOrig = cal;
  
  if (cal.includes("notas_calendario?fecha=gte.")) {
    cal = cal.replace(
      /notas_calendario\?fecha=gte\./g,
      'notas_calendario?empresa_id=eq.${empresaId}&fecha=gte.'
    );
    console.log("  ✓ Filtrar notas_calendario por empresa_id");
  }

  if (cal.includes('sb.post("notas_calendario",{') && !cal.includes('empresa_id:empresaId')) {
    cal = cal.replace(
      /sb\.post\("notas_calendario",\{/g,
      'sb.post("notas_calendario",{empresa_id:empresaId,'
    );
    console.log("  ✓ Agregar empresa_id a POST notas_calendario");
  }
  
  if (cal !== calOrig) {
    fs.writeFileSync(calFile, cal, "utf-8");
    console.log(`✅ Actualizado: ${calFile}\n`);
  } else {
    console.log(`— Sin cambios: ${calFile}\n`);
  }
}

// 2f. geolocalizacion_screen.jsx
console.log("📄 geolocalizacion_screen.jsx");
const geoFile = path.join(APP, "geolocalizacion_screen.jsx");
if (fs.existsSync(geoFile)) {
  let geo = fs.readFileSync(geoFile, "utf-8");
  const geoOrig = geo;
  
  if (geo.includes("config_sistema?clave=eq.ubicaciones_fichaje")) {
    geo = geo.replace(
      'config_sistema?clave=eq.ubicaciones_fichaje&select=valor',
      'config_sistema?clave=eq.ubicaciones_fichaje&empresa_id=eq.${empresaId}&select=valor'
    );
    console.log("  ✓ Filtrar config_sistema por empresa_id");
  }

  if (geo.includes("empleados?activo=eq.true&order=nombre.asc")) {
    geo = geo.replace(
      /empleados\?activo=eq\.true&order=nombre\.asc/g,
      'empleados?activo=eq.true&empresa_id=eq.${empresaId}&order=nombre.asc'
    );
    console.log("  ✓ Filtrar empleados en geo por empresa_id");
  }

  if (geo.includes('sb.post("config_sistema",{') && !geo.includes('empresa_id:empresaId')) {
    geo = geo.replace(
      /sb\.post\("config_sistema",\{/g,
      'sb.post("config_sistema",{empresa_id:empresaId,'
    );
    console.log("  ✓ Agregar empresa_id a POST config_sistema");
  }

  if (geo.includes('sb.patch("config_sistema?clave=eq.ubicaciones_fichaje"')) {
    geo = geo.replace(
      'sb.patch("config_sistema?clave=eq.ubicaciones_fichaje"',
      'sb.patch(`config_sistema?clave=eq.ubicaciones_fichaje&empresa_id=eq.${empresaId}`'
    );
    console.log("  ✓ Agregar empresa_id a PATCH config_sistema");
  }
  
  if (geo !== geoOrig) {
    fs.writeFileSync(geoFile, geo, "utf-8");
    console.log(`✅ Actualizado: ${geoFile}\n`);
  } else {
    console.log(`— Sin cambios: ${geoFile}\n`);
  }
}

// 2g. grilla_horario_screen.jsx
console.log("📄 grilla_horario_screen.jsx");
const grillaFile = path.join(APP, "grilla_horario_screen.jsx");
if (fs.existsSync(grillaFile)) {
  let grilla = fs.readFileSync(grillaFile, "utf-8");
  const grillaOrig = grilla;
  
  if (grilla.includes("empleados?activo=eq.true") && !grilla.includes("empresa_id=eq.${empresaId}")) {
    grilla = grilla.replace(
      /empleados\?activo=eq\.true&order=nombre\.asc&select=([^"]+)/g,
      'empleados?activo=eq.true&empresa_id=eq.${empresaId}&order=nombre.asc&select=$1'
    );
    console.log("  ✓ Filtrar empleados en grilla por empresa_id");
  }
  
  if (grilla !== grillaOrig) {
    fs.writeFileSync(grillaFile, grilla, "utf-8");
    console.log(`✅ Actualizado: ${grillaFile}\n`);
  } else {
    console.log(`— Sin cambios: ${grillaFile}\n`);
  }
}

// 2h. gerencia_actividad_screen.jsx
console.log("📄 gerencia_actividad_screen.jsx");
const gerActFile = path.join(APP, "gerencia_actividad_screen.jsx");
if (fs.existsSync(gerActFile)) {
  let gerAct = fs.readFileSync(gerActFile, "utf-8");
  const gerActOrig = gerAct;
  
  if (gerAct.includes("empleados?activo=eq.true") && !gerAct.includes("empresa_id=eq.${empresaId}")) {
    gerAct = gerAct.replace(
      /empleados\?activo=eq\.true&select=([^"]+)/g,
      'empleados?activo=eq.true&empresa_id=eq.${empresaId}&select=$1'
    );
    console.log("  ✓ Filtrar empleados en gerencia actividad por empresa_id");
  }

  if (gerAct.includes("catalogo_etapas?activo=eq.true")) {
    gerAct = gerAct.replace(
      'catalogo_etapas?activo=eq.true&order=orden.asc',
      'catalogo_etapas?activo=eq.true&empresa_id=eq.${empresaId}&order=orden.asc'
    );
    console.log("  ✓ Filtrar catalogo_etapas por empresa_id");
  }
  
  if (gerAct !== gerActOrig) {
    fs.writeFileSync(gerActFile, gerAct, "utf-8");
    console.log(`✅ Actualizado: ${gerActFile}\n`);
  } else {
    console.log(`— Sin cambios: ${gerActFile}\n`);
  }
}

// ═══════════════════════════════════════════
// NOTA IMPORTANTE
// ═══════════════════════════════════════════
console.log("═══════════════════════════════════════════════════");
console.log("");
console.log("⚠️  IMPORTANTE: Algunas pantallas (reportes, calendario,");
console.log("   geolocalizacion, grilla, gerencia_actividad) necesitan");
console.log("   recibir empresaId como prop desde page.js.");
console.log("");
console.log("   El script ya filtró las queries, pero las variables");
console.log("   empresaId deben llegar desde el usuario logueado.");
console.log("");
console.log("   En page.js, los componentes que se renderizan así:");
console.log("     <ReportesScreen/>");
console.log("   Deben pasar a:");
console.log("     <ReportesScreen empresaId={usuario.empresa_id}/>");
console.log("");
console.log("   Esto se hace en el siguiente paso automáticamente.");
console.log("═══════════════════════════════════════════════════\n");

// Paso automático: actualizar renders en page.js para pasar empresaId
let pageContent2 = fs.readFileSync(pageFile, "utf-8");
const pageOrig2 = pageContent2;

const screenProps = [
  ["<ReportesScreen/>", "<ReportesScreen empresaId={usuario.empresa_id}/>"],
  ["<GrillaHorarioScreen/>", "<GrillaHorarioScreen empresaId={usuario.empresa_id}/>"],
  ["<GeolocalizacionScreen/>", "<GeolocalizacionScreen empresaId={usuario.empresa_id}/>"],
  ["<CalendarioScreen/>", "<CalendarioScreen empresaId={usuario.empresa_id}/>"],
  ["<GerenciaActividadScreen/>", "<GerenciaActividadScreen empresaId={usuario.empresa_id}/>"],
  ["<GestionPersonalScreen ctx={ctx} reload={loadData}/>", "<GestionPersonalScreen ctx={ctx} reload={loadData} empresaId={usuario.empresa_id}/>"],
];

for (const [find, replace] of screenProps) {
  if (pageContent2.includes(find)) {
    pageContent2 = pageContent2.replace(find, replace);
    console.log(`  ✓ Pasar empresaId a ${find.match(/<(\w+)/)[1]}`);
  }
}

if (pageContent2 !== pageOrig2) {
  fs.writeFileSync(pageFile, pageContent2, "utf-8");
  console.log(`\n✅ Props actualizados en page.js\n`);
}

// ═══════════════════════════════════════════
// FIN
// ═══════════════════════════════════════════
console.log("═══════════════════════════════════════════════════");
console.log("✅ FASE 5.2 completada");
console.log("");
console.log("Próximos pasos:");
console.log("  1. npm run build");
console.log("  2. Si hay errores, copialos y mandámelos");
console.log("  3. Si compila bien:");
console.log('     git add .');
console.log('     git commit -m "fase5.2: multi-tenancy"');
console.log('     git push');
console.log('     npx vercel --prod');
console.log("═══════════════════════════════════════════════════\n");
