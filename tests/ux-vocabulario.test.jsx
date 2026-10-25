// tests/ux-vocabulario.test.jsx — Reforma UX R3: un nombre para cada cosa.
// Si alguien vuelve a escribir un término viejo en una pantalla, falla.
import "./helpers/domSetup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const { nombreRol, VOCABULARIO } = await import("../app/lib/textos.js");
const { getItems } = await import("../app/components/nav/BottomNav.jsx");

test("roles con nombres que la gente entiende", () => {
  assert.equal(nombreRol("operativo"), "Operario");
  assert.equal(nombreRol("administrativo"), "Administración");
  assert.equal(nombreRol("administrativo", { soloSuDivision: true }), "Supervisor");
  assert.equal(nombreRol("gerencial"), "Dueño");
  assert.equal(nombreRol(undefined), "Operario");
});

test("barra de abajo: gestión con sus cinco botones; el operario ve Inicio, Permisos y Mi cuenta", () => {
  assert.deepEqual(getItems("gerencial", 0).map((i) => i.label), ["Inicio", "Proyectos", "Inventario", "Mantenimiento", "Más"]);
  assert.deepEqual(getItems("operativo", 0).map((i) => i.label), ["Inicio", "Permisos", "Mi cuenta"]);
  assert.equal(VOCABULARIO.entrada, "Entrada");
});

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return ["api", "superadmin", "docs"].includes(n) ? [] : archivos(p);
    return /\.(jsx|js)$/.test(n) ? [p] : [];
  });
}

// Términos viejos que ya no se muestran (ver VOCABULARIO en app/lib/textos.js)
const PROHIBIDOS = [
  /label: ['"]Inbox['"]/, /"Inbox"/, /Mi Jornada/, /Reglas IA/, /REGLAS DEL BOT/, /Hablale al bot/,
  /Fichar ingreso/, /Ingreso fichado/, /Registrar espera \/ tiempo muerto/, /Nuevo proyecto/,
  /Buscar proyecto/, /label: ['"]Chat['"]/, /label: "Proyectos"/, /label: "Personal"/,
  // Revisión de la interfaz (2026-10): "Permisos" es lo del personal y "Pedidos de material" lo de Compras
  /Solicitudes del personal/, /Pedidos de compras/, /label: ['"]Pedidos['"]/, /"Mis pedidos"/,
];

test("ninguna pantalla usa los nombres viejos", () => {
  const hallados = [];
  for (const f of archivos(new URL("../app", import.meta.url).pathname)) {
    if (f.endsWith("/lib/textos.js")) continue; // ahí se documentan los nombres viejos
    const src = readFileSync(f, "utf8");
    // "Proyectos" volvió como nombre del botón de la barra que agrupa OT y
    // Reportes (menú nuevo, parte 32); la lista sigue llamándose "OT"
    const permitidos = f.endsWith("/lib/menuGestion.js") ? [String(/label: "Proyectos"/)] : [];
    for (const re of PROHIBIDOS) if (!permitidos.includes(String(re)) && re.test(src)) hallados.push(`${f.split("/app/")[1]}: ${re}`);
  }
  assert.deepEqual(hallados, []);
});

test("Equipo muestra el rol con su nombre, no el interno", () => {
  const src = readFileSync(new URL("../app/gestion_personal_screen.jsx", import.meta.url), "utf8");
  assert.match(src, /\{nombreRol\(r\)\}<\/button>/);
  assert.match(src, /nombreRol\(emp\.rol, \{ soloSuDivision: emp\.solo_su_division \}\)/);
  assert.doesNotMatch(src, /\{emp\.rol \|\| "operativo"\}/);
});
