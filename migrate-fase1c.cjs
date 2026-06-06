/**
 * GYPI — Script de migración Fase 1c
 *
 * Arregla:
 * 1. Conflicto dark/light (main wrapper background)
 * 2. Nav bottom con Tailwind
 * 3. Header con Tailwind
 * 4. Status bar falso (lo elimina — no es necesario en web)
 *
 * Ejecución: node migrate-fase1c.cjs
 * Ubicación: raíz del proyecto
 */

const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.join(__dirname, 'app', '[slug]', 'page.js');

if (!fs.existsSync(PAGE_PATH)) {
  console.error('❌ No se encontró app/[slug]/page.js');
  process.exit(1);
}

let code = fs.readFileSync(PAGE_PATH, 'utf8');
const original = code;
let changes = 0;

// ─── FIX 1: Main wrapper - quitar background:C.bg y maxWidth:480 ───
// Patrón actual:
// return<div style={{maxWidth:480,margin:"0 auto",height:"100dvh",background:C.bg,position:"relative",overflow:"hidden",display:"flex",flexDirection:"column"}}>
const oldWrapper = `style={{maxWidth:480,margin:"0 auto",height:"100dvh",background:C.bg,position:"relative",overflow:"hidden",display:"flex",flexDirection:"column"}}`;
const newWrapper = `className="max-w-lg mx-auto h-[100dvh] bg-[var(--color-bg)] relative overflow-hidden flex flex-col"`;

if (code.includes(oldWrapper)) {
  code = code.replace(oldWrapper, newWrapper);
  console.log('✅ Fix 1: Main wrapper migrado a Tailwind (light mode)');
  changes++;
} else {
  // Intentar variante con saltos de línea o espacios
  const altWrapper = /style=\{\{maxWidth:480,margin:"0 auto",height:"100dvh",background:C\.bg[^}]*\}\}/;
  if (altWrapper.test(code)) {
    code = code.replace(altWrapper, newWrapper);
    console.log('✅ Fix 1: Main wrapper migrado (match alternativo)');
    changes++;
  } else {
    console.log('⚠️  Fix 1: No se encontró el main wrapper. Buscando background:C.bg...');
    // Al menos quitar background:C.bg de cualquier lugar del wrapper
    if (code.includes('background:C.bg')) {
      // Reemplazar solo la primera instancia (el wrapper principal)
      code = code.replace('background:C.bg,', '');
      console.log('✅ Fix 1: Eliminado background:C.bg del wrapper');
      changes++;
    }
  }
}

// ─── FIX 2: Eliminar status bar falso (la barra de señal/wifi/batería) ───
// Patrón: <div className="safe-top" style={{display:"flex",justifyContent:"space-between"...
const statusBarRegex = /\{\/\* Status bar \*\/\}\s*<div className="safe-top"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
if (statusBarRegex.test(code)) {
  code = code.replace(statusBarRegex, '');
  console.log('✅ Fix 2: Status bar falso eliminado');
  changes++;
} else {
  // Intentar match más simple
  const simpleStatusBar = /<div className="safe-top" style=\{\{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 22px 0"[^]*?<\/svg>\s*<\/div>\s*<\/div>/;
  if (simpleStatusBar.test(code)) {
    code = code.replace(simpleStatusBar, '');
    console.log('✅ Fix 2: Status bar eliminado (match simple)');
    changes++;
  } else {
    console.log('⚠️  Fix 2: No se encontró status bar. Puede que ya esté eliminado.');
  }
}

// ─── FIX 3: Reemplazar Nav component con versión Tailwind ───
const oldNav = /function Nav\(\{active,onChange,role,pend\}\)\{[\s\S]*?return<div className="safe-bottom"[\s\S]*?\n\}/;
const newNav = `function Nav({active,onChange,role,pend}){
  const items=role==="gerencial"||role==="administrativo"?[["home","Inicio","home"],["solicitudes","Inbox","inbox",pend],["equipo","Equipo","users"],["config","Gestión","settings"]]:[["home","Inicio","home"],["actividad","Actividad","play"],["chat","Chat","chat"],["mis-sols","Solicitudes","clock"]];
  return<nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-around items-center h-16 border-t border-[var(--color-border)] bg-white/95 backdrop-blur-lg pb-[env(safe-area-inset-bottom)] max-w-lg mx-auto">
    {items.map(([id,lbl,iconName,badge])=>{const a=active===id;return<button key={id} onClick={()=>onChange(id)} className={\`flex-1 flex flex-col items-center gap-1 py-1.5 transition-colors \${a?"text-[var(--color-empresa-primary)]":"text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"}\`}>
      <div className={\`relative flex items-center \${a?"bg-[var(--color-empresa-primary)]/10 rounded-xl px-3.5 py-1":""}\`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={a?2.2:1.8} strokeLinecap="round" strokeLinejoin="round">
          {iconName==="home"&&<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10"/>}
          {iconName==="inbox"&&<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>}
          {iconName==="users"&&<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></>}
          {iconName==="settings"&&<><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"/></>}
          {iconName==="play"&&<><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></>}
          {iconName==="chat"&&<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>}
          {iconName==="clock"&&<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>}
        </svg>
        {badge>0&&<span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center border-2 border-white">{badge}</span>}
      </div>
      <span className="text-[10px] font-semibold">{lbl}</span>
    </button>})}
  </nav>;
}`;

if (oldNav.test(code)) {
  code = code.replace(oldNav, newNav);
  console.log('✅ Fix 3: Nav reemplazado con versión Tailwind');
  changes++;
} else {
  console.log('⚠️  Fix 3: No se pudo reemplazar Nav automáticamente.');
  console.log('   El Nav actual seguirá funcionando pero con el look viejo.');
}

// ─── FIX 4: Slug inválido screen - migrar a Tailwind ───
const oldSlugInvalido = /style=\{\{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, color: C\.text, fontFamily: fB, textAlign: "center" \}\}/;
if (oldSlugInvalido.test(code)) {
  code = code.replace(oldSlugInvalido, 'className="max-w-lg mx-auto min-h-[100dvh] flex flex-col items-center justify-center p-7 text-center"');
  console.log('✅ Fix 4: Slug inválido migrado a Tailwind');
  changes++;
} else {
  // Intentar sin espacios exactos
  const altSlug = /style=\{\{maxWidth:\s*480,\s*margin:\s*"0 auto",\s*minHeight:\s*"100dvh"[^}]*color:\s*C\.text[^}]*\}\}/;
  if (altSlug.test(code)) {
    code = code.replace(altSlug, 'className="max-w-lg mx-auto min-h-[100dvh] flex flex-col items-center justify-center p-7 text-center"');
    console.log('✅ Fix 4: Slug inválido migrado (match alt)');
    changes++;
  }
}

// ─── FIX 5: Loading spinner - migrar ───
const oldSpinner = /style=\{\{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14\}\}/;
if (oldSpinner.test(code)) {
  code = code.replace(oldSpinner, 'className="flex-1 flex items-center justify-center flex-col gap-3.5"');
  console.log('✅ Fix 5: Loading spinner migrado');
  changes++;
}

// ─── FIX 6: Quitar el "safe-bottom" del CSS class en Nav si quedó algo viejo ───
// (el nuevo Nav ya tiene pb-[env(safe-area-inset-bottom)])

// ─── GUARDAR ───
if (changes === 0) {
  console.log('\n⚠️  No se detectaron patrones para cambiar.');
  console.log('   Puede que ya se hayan aplicado los cambios.');
  process.exit(0);
}

// Backup
const backupPath = PAGE_PATH + '.pre-1c.bak';
fs.writeFileSync(backupPath, original, 'utf8');
console.log(`\n💾 Backup: app/[slug]/page.js.pre-1c.bak`);

fs.writeFileSync(PAGE_PATH, code, 'utf8');
console.log(`✅ Guardado: app/[slug]/page.js (${changes} cambios aplicados)`);
console.log('\n🎉 Migración Fase 1c completada. Probá con npm run dev');
