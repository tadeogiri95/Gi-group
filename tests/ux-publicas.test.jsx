// tests/ux-publicas.test.jsx — Reforma UX R11 (8/8): páginas públicas (inicio
// y precios) con las piezas de diseño, y con datos ciertos.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup } from "@testing-library/react";

const { default: TablaPrecios } = await import("../app/components/TablaPrecios.jsx");
const { DIAS_TRIAL } = await import("../app/lib/plans.js");
const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

afterEach(() => cleanup());

test("inicio — los datos son ciertos: los días de prueba salen del plan y no hay cifras inventadas", () => {
  const src = leer("app/page.js");
  assert.doesNotMatch(src, /value: 14, suffix: " días"/, "decía 14 días de prueba y son " + DIAS_TRIAL);
  assert.doesNotMatch(src, /99, suffix: "%"/, "el 99% de disponibilidad no tenía respaldo");
  assert.doesNotMatch(src, /Empezá con 30 días/, "los días de prueba vienen de DIAS_TRIAL");
  assert.doesNotMatch(src, /canales por área/, "el chat es un asistente, no canales entre equipos");
  assert.match(src, /\$\{DIAS_TRIAL\} días/);
});

test("inicio — en castellano y con las palabras de la app", () => {
  const src = leer("app/page.js");
  assert.doesNotMatch(src, />Features</);
  assert.doesNotMatch(src, /App progresiva \(PWA\)/);
  assert.match(src, /Qué hace Gypi/);
  assert.match(src, /Se usa desde el celular, sin descargar nada/);
  // Los campos del registro tienen su etiqueta asociada
  assert.match(src, /htmlFor=\{`registro-\$\{f\.k\}`\}/);
  // El menú de arriba toma fondo al desplazar la caja de la página (no la ventana)
  assert.match(src, /onScroll=\{alDesplazar\}/);
  assert.doesNotMatch(src, /window\.addEventListener\("scroll"/);
});

test("precios — 'Crear mi empresa gratis' abre el registro directo (antes caía en el inicio)", () => {
  assert.match(leer("app/pricing/page.js"), /href="\/\?registro=1"/);
  assert.match(leer("app/pricing/PricingCards.jsx"), /router\.push\("\/\?registro=1"\)/);
  assert.match(leer("app/page.js"), /searchParams\.get\("registro"\) === "1"/);
});

test("tabla de precios — botón de prueba de 48 px y sin estilos sueltos", () => {
  render(<TablaPrecios onEmpezar={() => {}} />);
  const probar = screen.getAllByRole("button", { name: `Probar ${DIAS_TRIAL} días gratis` });
  assert.equal(probar.length, 2);
  assert.match(probar[0].className, /min-h-12/);
  for (const ruta of ["app/page.js", "app/pricing/page.js", "app/components/TablaPrecios.jsx"]) {
    assert.doesNotMatch(leer(ruta), /style=\{\{/, ruta);
  }
});
