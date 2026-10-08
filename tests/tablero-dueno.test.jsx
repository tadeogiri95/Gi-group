// tests/tablero-dueno.test.jsx — Reforma UX R9: el tablero del dueño en 30 s.
// Arriba 4 números con nombre completo; cada número en un solo lugar; el
// ranking entre compañeros solo si el dueño lo pide.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

const { default: DashboardGerencia } = await import("../app/dashboard_gerencia.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { modulosEfectivos } = await import("../app/lib/modulos.js");

afterEach(() => cleanup());

function tablero({ modulos, solicitudes = [] } = {}) {
  global.fetch = async () => Response.json({ ok: true, data: [] });
  const destinos = [];
  const ctx = { empleados: [], fichadasHoy: [], solicitudes, notificaciones: [] };
  render(
    <AuthContext.Provider value={{ divisiones: [], usuario: { rol: "gerencial" } }}>
      <DashboardGerencia goto={(d) => destinos.push(d)} ctx={ctx} reload={() => {}} logout={() => {}} empresa={{ id: "e-1", nombre: "Acme", modulos }} />
    </AuthContext.Provider>
  );
  return destinos;
}

const PENDIENTES = [
  { id: 1, estado: "pendiente", tipo: "vacaciones", nombre_empleado: "Ana", motivo: "Viaje" },
  { id: 2, estado: "pendiente", tipo: "permiso", nombre_empleado: "Luis", motivo: "Médico" },
];

test("resumen de hoy — 4 números con su nombre completo, y los tocables llevan al detalle", async () => {
  const destinos = tablero({ modulos: modulosEfectivos({ plan: "planta_15" }), solicitudes: PENDIENTES });
  const resumen = await screen.findByRole("region", { name: "Resumen de hoy" });
  for (const etiqueta of ["Vinieron hoy (de los esperados)", "Faltan hoy", "Parados ahora", "Pedidos sin responder"]) {
    assert.ok(within(resumen).getByText(etiqueta), etiqueta);
  }
  assert.ok(within(resumen).getByText("2"), "2 pedidos sin responder");
  fireEvent.click(within(resumen).getByText("Pedidos sin responder"));
  fireEvent.click(within(resumen).getByText("Parados ahora"));
  assert.deepEqual(destinos, ["solicitudes", "ger-actividad"]);
});

test("resumen de hoy — sin Tareas, en lugar de 'Parados' muestra las tardanzas de la semana", async () => {
  tablero({ modulos: modulosEfectivos({ plan: "asistencia_15" }) });
  const resumen = await screen.findByRole("region", { name: "Resumen de hoy" });
  assert.ok(within(resumen).getByText("Tardanzas esta semana"));
  assert.equal(within(resumen).queryByText("Parados ahora"), null);
});

test("sin repetidos — los avisos no repiten los números del resumen", async () => {
  tablero({ modulos: modulosEfectivos({ plan: "planta_15" }), solicitudes: PENDIENTES });
  await screen.findByRole("region", { name: "Resumen de hoy" });
  assert.equal(screen.queryByText(/pedidos? sin responder$/), null, "el aviso de pedidos se fue: está arriba");
  const src = readFileSync(new URL("../app/dashboard_gerencia.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /ausente\$\{ausentes > 1/);
  assert.equal((src.match(/<div className="g-kpi-label">Trabajando<\/div>/g) || []).length, 1, "solo en el detalle de En planta, no repetido en Productividad");
  assert.doesNotMatch(src, /<div className="g-kpi-label">Presentes<\/div>/);
});

test("ranking — apagado por defecto: se muestra solo si el dueño lo pide (y se recuerda)", () => {
  const src = readFileSync(new URL("../app/dashboard_gerencia.jsx", import.meta.url), "utf8");
  assert.match(src, /localStorage\.getItem\("gypi_ver_ranking"\) === "1"/);
  assert.match(src, /ranking\.length > 0 && !verRanking && \(/);
  assert.match(src, /Mostrar el ranking del mes/);
  assert.match(src, /Ocultar el ranking/);
});

test("el tablero no tiene 'cerrar sesión' suelto (está en Más → Mi cuenta)", async () => {
  tablero({ modulos: modulosEfectivos({ plan: "planta_15" }) });
  await screen.findByRole("region", { name: "Resumen de hoy" });
  assert.equal(screen.queryByLabelText("Cerrar sesion"), null);
});
