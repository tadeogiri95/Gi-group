// tests/ux-tablero.test.jsx — Reforma UX R11 (7/8): el tablero del dueño con
// las piezas de diseño: gráficos sin estilos sueltos. El Panel de control
// (Inicio) se prueba en tests/tablero-dueno.test.jsx.
import "./helpers/domSetup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("registro de tareas — apagado desde 2026-10; con él vuelven En vivo y Producción", async () => {
  const { conRegistroTareas, REGISTRO_TAREAS } = await import("../app/lib/modulos.js");
  assert.equal(REGISTRO_TAREAS, false);
  assert.equal(conRegistroTareas({ modulos: ["actividad"] }), false);
  const indicadores = readFileSync(new URL("../app/components/Indicadores.jsx", import.meta.url), "utf8");
  assert.match(indicadores, /conTareas\s*\n?\s*\? sbGetAll\(`registro_actividades/, "sin el registro no se piden las tareas");
});

test("tablero — sin estilos sueltos ni colores a mano: barras y gráficos en SVG", () => {
  const src = readFileSync(new URL("../app/dashboard_gerencia.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /style=\{\{/);
  assert.doesNotMatch(src, /<style>/, "sin animaciones definidas a mano");
  assert.match(src, /<rect width=\{Math\.max\(0, Math\.min\(pct, 100\)\)\}/);
});
