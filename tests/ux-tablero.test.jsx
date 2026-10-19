// tests/ux-tablero.test.jsx — Reforma UX R11 (7/8): el tablero del dueño con
// las piezas de diseño. Sin paneles vacíos según los módulos, llegadas con
// botones de verdad, y gráficos sin estilos sueltos.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { default: DashboardGerencia } = await import("../app/dashboard_gerencia.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { modulosEfectivos } = await import("../app/lib/modulos.js");
const { ahoraArg } = await import("../app/lib/dates.js");

afterEach(() => cleanup());

function tablero({ plan = "planta_15", fichadasHoy = [], empleados = [] } = {}) {
  global.fetch = async () => Response.json({ ok: true, data: [] });
  const destinos = [];
  const ctx = { empleados, fichadasHoy, solicitudes: [], notificaciones: [] };
  render(
    <AuthContext.Provider value={{ divisiones: [], usuario: { rol: "gerencial" } }}>
      <DashboardGerencia goto={(d, l) => destinos.push([d, l])} ctx={ctx} reload={() => {}} logout={() => {}} empresa={{ id: "e-1", nombre: "Acme", modulos: modulosEfectivos({ plan }) }} />
    </AuthContext.Provider>
  );
  return destinos;
}

test("tablero — sin el registro de tareas no muestra paneles de producción que siempre estarían vacíos", async () => {
  for (const plan of ["asistencia_15", "planta_15"]) {
    tablero({ plan });
    await screen.findByRole("region", { name: "Asistencia del día" });
    assert.equal(screen.queryByRole("region", { name: "Productividad" }), null, plan);
    assert.equal(screen.queryByText("En planta"), null, plan);
    cleanup();
  }
});

test("registro de tareas — apagado desde 2026-10; con él vuelven En vivo y Producción", async () => {
  const { conRegistroTareas, REGISTRO_TAREAS } = await import("../app/lib/modulos.js");
  assert.equal(REGISTRO_TAREAS, false);
  assert.equal(conRegistroTareas({ modulos: ["actividad"] }), false);
  const indicadores = readFileSync(new URL("../app/components/Indicadores.jsx", import.meta.url), "utf8");
  assert.match(indicadores, /conTareas\s*\n?\s*\? sbGetAll\(`registro_actividades/, "sin el registro no se piden las tareas");
});

test("llegadas — cada persona es un botón que lleva a sus fichajes (reemplaza a las jornadas)", async () => {
  const turno = { [ahoraArg().diaKey]: { in: "00:00", out: "23:59" } };
  const destinos = tablero({
    empleados: [
      { id: "7", legajo: 7, nombre: "Ana", rol: "operativo", diagrama: turno },
      { id: "8", legajo: 8, nombre: "Luis", rol: "operativo", diagrama: turno },
    ],
    fichadasHoy: [
      { legajo: 7, nombre: "Ana", ingreso: "08:00:00", egreso: "17:00:00" },
      { legajo: 8, nombre: "Luis", ingreso: "08:30:00", egreso: null },
    ],
  });
  assert.ok(await screen.findByText(/Tocá a alguien para ver sus fichajes/));
  fireEvent.click(screen.getByRole("button", { name: /Luis: A tiempo, entra 00:00 · llegó 08:30\. Ver sus fichajes/ }));
  assert.deepEqual(destinos.at(-1), ["historial-fichajes", 8]);
  assert.ok(screen.getByRole("button", { name: /Ana: A tiempo, entra 00:00 · llegó 08:00 · salió 17:00/ }));
});

test("tablero — sin estilos sueltos ni colores a mano: barras y gráficos en SVG", () => {
  const src = readFileSync(new URL("../app/dashboard_gerencia.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /style=\{\{/);
  assert.doesNotMatch(src, /<style>/, "sin animaciones definidas a mano");
  assert.match(src, /<rect width=\{Math\.max\(0, Math\.min\(pct, 100\)\)\}/);
  assert.match(src, /Cómo se arman los puntos/);
});
