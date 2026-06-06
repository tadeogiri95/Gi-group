/**
 * GYPI — Script de migración Fase 1b
 *
 * Qué hace:
 * 1. Agrega import de LoginScreen y CambiarPasswordScreen (componentes nuevos)
 * 2. Reemplaza las funciones inline LoginScreen y CambiarPasswordScreen en [slug]/page.js
 *    por los imports de los archivos nuevos
 * 3. NO toca la lógica de negocio ni el Nav (eso viene en Fase 1c)
 *
 * Ejecución: node migrate-fase1b.cjs
 * Ubicación: raíz del proyecto (C:\Users\Usuario\Desktop\gi-group-app\)
 */

const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.join(__dirname, 'app', '[slug]', 'page.js');

if (!fs.existsSync(PAGE_PATH)) {
  console.error('❌ No se encontró app/[slug]/page.js');
  console.error('   Asegurate de ejecutar este script desde la raíz del proyecto.');
  process.exit(1);
}

let code = fs.readFileSync(PAGE_PATH, 'utf8');
const original = code;

// ─── PASO 1: Agregar imports de LoginScreen y CambiarPasswordScreen ───

// Buscar la línea de import de Tag/Chip para insertar después
const importAnchor = `import { Tag, Chip } from "../components/ui";`;
const newImports = `import LoginScreenNew from '../components/LoginScreen';
import CambiarPasswordScreenNew from '../components/CambiarPasswordScreen';`;

if (code.includes('LoginScreenNew')) {
  console.log('ℹ️  Los imports ya existen. Saltando paso 1.');
} else if (code.includes(importAnchor)) {
  code = code.replace(
    importAnchor,
    importAnchor + '\n' + newImports
  );
  console.log('✅ Paso 1: Imports agregados');
} else {
  // Fallback: insertar después de la última línea de import
  const lastImportIdx = code.lastIndexOf('\nimport ');
  if (lastImportIdx !== -1) {
    const endOfLine = code.indexOf('\n', lastImportIdx + 1);
    code = code.slice(0, endOfLine + 1) + newImports + '\n' + code.slice(endOfLine + 1);
    console.log('✅ Paso 1: Imports agregados (fallback)');
  } else {
    console.error('❌ No se pudo encontrar dónde insertar los imports.');
    process.exit(1);
  }
}

// ─── PASO 2: Reemplazar uso de LoginScreen en el render ───
// El render actual usa: <LoginScreen onLogin={login} empresa={empresa}/>
// Lo reemplazamos por: <LoginScreenNew onLogin={login} empresa={empresa}/>

const loginUsageOld = '<LoginScreen onLogin={login} empresa={empresa}/>';
const loginUsageNew = '<LoginScreenNew onLogin={login} empresa={empresa}/>';

if (code.includes(loginUsageOld)) {
  code = code.replace(loginUsageOld, loginUsageNew);
  console.log('✅ Paso 2: LoginScreen reemplazado en render');
} else if (code.includes(loginUsageNew)) {
  console.log('ℹ️  LoginScreenNew ya está en uso. Saltando paso 2.');
} else {
  console.log('⚠️  No se encontró el uso exacto de LoginScreen. Revisá manualmente.');
}

// ─── PASO 3: Reemplazar uso de CambiarPasswordScreen en el render ───
const cambiarUsageOld = '<CambiarPasswordScreen usuario={usuario} onDone={(u)=>{login(u);}}/>';
const cambiarUsageNew = '<CambiarPasswordScreenNew usuario={usuario} onDone={(u)=>{login(u);}}/>';

if (code.includes(cambiarUsageOld)) {
  code = code.replace(cambiarUsageOld, cambiarUsageNew);
  console.log('✅ Paso 3: CambiarPasswordScreen reemplazado en render');
} else if (code.includes(cambiarUsageNew)) {
  console.log('ℹ️  CambiarPasswordScreenNew ya está en uso. Saltando paso 3.');
} else {
  console.log('⚠️  No se encontró el uso exacto de CambiarPasswordScreen. Revisá manualmente.');
}

// ─── GUARDAR ───
if (code === original) {
  console.log('\n⚠️  No se hicieron cambios. El archivo ya estaba migrado o no se encontraron los patrones.');
} else {
  // Backup
  const backupPath = PAGE_PATH + '.bak';
  fs.writeFileSync(backupPath, original, 'utf8');
  console.log(`\n💾 Backup guardado en: app/[slug]/page.js.bak`);

  // Guardar
  fs.writeFileSync(PAGE_PATH, code, 'utf8');
  console.log('✅ Archivo actualizado: app/[slug]/page.js');
  console.log('\n🎉 Migración Fase 1b completada.');
  console.log('   Las funciones LoginScreen y CambiarPasswordScreen originales');
  console.log('   siguen en el archivo (como código muerto), las podés borrar después.');
  console.log('\n   Probá con: npm run dev');
}
