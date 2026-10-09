// tests/ux-tablero.test.jsx — Reforma UX R11 (7/8): el tablero del dueño con
// las piezas de diseño. Sin paneles vacíos según los módulos, jornadas con
// leyenda y botones de verdad, y gráficos sin estilos sueltos.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { default: DashboardGerencia } = await import("../app/dashboard_gerencia.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { modulosEfectivos } = await import("../app/lib/modulos.js");

afterEach(() => cleanup());

function tablero({ plan = "planta_15", fichadasHoy = [] } = {}) {
  global.fetch = async () => Response.json({ ok: true, data: [] });
  const destinos = [];
  const ctx = { empleados: [], fichadasHoy, solicitudes: [], notificaciones: [] };
  render(
    <AuthContext.Provider value={{ divisiones: [], usuario: { rol: "gerencial" } }}>
      <DashboardGerencia goto={(d, l) => destinos.push([d, l])} ctx={ctx} reload={() => {}} logout={() => {}} empresa={{ id: "e-1", nombre: "Acme", modulos: modulosEfectivos({ plan }) }} />
    </AuthContext.Provider>
  );
  return destinos;
}

test("tablero — sin Tareas no muestra paneles de producción que siempre estarían vacíos", async () => {
  tablero({ plan: "asistencia_15" });
  await screen.findByRole("region", { name: "Resumen de hoy" });
  assert.equal(screen.queryByRole("region", { name: "Productividad" }), null);
  assert.equal(screen.queryByText("En planta"), null);
  cleanup();
  tablero({ plan: "planta_15" });
  await screen.findByRole("region", { name: "Resumen de hoy" });
  assert.ok(screen.getByRole("region", { name: "Productividad" }));
  assert.ok(screen.getByText(/Del tiempo con tarea cargada/), "explica qué es el porcentaje");
  const enPlanta = screen.getByRole("button", { name: /En planta/ });
  assert.equal(enPlanta.getAttribute("aria-expanded"), "false");
  fireEvent.click(enPlanta);
  assert.equal(enPlanta.getAttribute("aria-expanded"), "true");
  assert.ok(screen.getByRole("button", { name: /Ver detalle por operario/ }));
});

test("jornadas — leyenda de colores y cada persona es un botón que lleva a sus fichajes", async () => {
  const destinos = tablero({ fichadasHoy: [
    { legajo: 7, nombre: "Ana", ingreso: "08:00:00", egreso: "17:00:00" },
    { legajo: 8, nombre: "Luis", ingreso: "08:30:00", egreso: null },
  ] });
  assert.ok(await screen.findByText(/ya salió/));
  assert.ok(screen.getByText(/todavía adentro · tocá a alguien/));
  fireEvent.click(screen.getByRole("button", { name: /Luis: entró 08:30, todavía adentro/ }));
  assert.deepEqual(destinos.at(-1), ["historial-fichajes", 8]);
  assert.ok(screen.getByRole("button", { name: /Ana: entró 08:00, salió 17:00/ }));
});

test("tablero — sin estilos sueltos ni colores a mano: barras y gráficos en SVG", () => {
  const src = readFileSync(new URL("../app/dashboard_gerencia.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /style=\{\{/);
  assert.doesNotMatch(src, /<style>/, "sin animaciones definidas a mano");
  assert.match(src, /<rect width=\{Math\.max\(0, Math\.min\(pct, 100\)\)\}/);
  assert.match(src, /Cómo se arman los puntos/);
});
