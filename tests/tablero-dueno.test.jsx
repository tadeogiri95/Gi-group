// tests/tablero-dueno.test.jsx — Reforma UX R9: el tablero del dueño en 30 s.
// Arriba 4 números con nombre completo; cada número en un solo lugar; el
// Pedido de Tadeo (19/10): OT en curso, presentes con quiénes faltan,
// pedidos de compras y el ranking siempre a la vista.
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
  for (const etiqueta of ["Vinieron hoy (de los esperados)", "Faltan hoy", "Parados ahora", "Solicitudes sin responder"]) {
    assert.ok(within(resumen).getByText(etiqueta), etiqueta);
  }
  assert.ok(within(resumen).getByText("2"), "2 solicitudes sin responder");
  fireEvent.click(within(resumen).getByText("Solicitudes sin responder"));
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

test("ranking — siempre a la vista, sin botón para mostrarlo", () => {
  const src = readFileSync(new URL("../app/dashboard_gerencia.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /gypi_ver_ranking/);
  assert.doesNotMatch(src, /Mostrar el ranking del mes/);
});

const ENTRA = { in: "08:00", out: "17:00" };
const DIAG = { lun: ENTRA, mar: ENTRA, mie: ENTRA, jue: ENTRA, vie: ENTRA, sab: ENTRA, dom: ENTRA };

function tableroCompleto() {
  const respuestas = {
    proyectos: [
      { id: 1, ot: "7495", cliente: "CEVT", division: "M", liberada_at: null },
      { id: 2, ot: "7500", cliente: "Otra", division: "A", liberada_at: "2026-10-18T10:00:00Z" },
      { id: 3, ot: "7600", cliente: "Sin empezar", division: "M", liberada_at: null },
    ],
    avance_etapas: [{ ot: "7500", etapa: 1, estado: "terminada" }],
    registro_actividades: [{ codigo_proyecto: "7495", etapa: 1 }],
    pedidos_compra: [{ id: 9, descripcion: "Placa melamina blanca 18 mm", cantidad: 12, unidad: "u", ot: "7495", empleado_nombre: "Juan" }],
  };
  global.fetch = async (_url, opts) => {
    const { path } = JSON.parse(opts?.body || "{}");
    const tabla = String(path || "").split("?")[0];
    return Response.json({ ok: true, data: respuestas[tabla] || [] });
  };
  const destinos = [];
  const ctx = {
    empleados: [
      { id: "a", legajo: 1, nombre: "Ana Presente", activo: true, diagrama: DIAG },
      { id: "b", legajo: 2, nombre: "Beto Ausente", activo: true, diagrama: DIAG },
      { id: "c", legajo: 3, nombre: "Ceci Franco", activo: true, diagrama: {} },
    ],
    fichadasHoy: [{ legajo: 1, nombre: "Ana Presente", ingreso: "08:00:00" }],
    solicitudes: [], notificaciones: [],
  };
  const divisiones = [
    { id: "M", label: "Muebles", ruta_etapas: [1, 2] },
    { id: "A", label: "Aluminio", ruta_etapas: [1, 2] },
  ];
  const etapas = [{ codigo: 1, nombre: "Corte", orden: 1 }, { codigo: 2, nombre: "Canto", orden: 2 }];
  render(
    <AuthContext.Provider value={{ divisiones, etapas, usuario: { rol: "gerencial" } }}>
      <DashboardGerencia goto={(d) => destinos.push(d)} ctx={ctx} reload={() => {}} logout={() => {}} empresa={{ id: "e-1", nombre: "Acme", modulos: modulosEfectivos({ plan: "planta_15" }) }} />
    </AuthContext.Provider>
  );
  return destinos;
}

test("panel — OT en curso con su división, y 'Ver las OT' abre Planta → OT", async () => {
  const destinos = tableroCompleto();
  const ot = await screen.findByRole("region", { name: "OT en curso" });
  await within(ot).findByText("7495");
  assert.ok(within(ot).getByText("7500"));
  assert.equal(within(ot).queryByText("7600"), null, "sin etapas empezadas no está en curso");
  assert.ok(within(ot).getByText("Muebles: 1"));
  assert.ok(within(ot).getByText("Aluminio: 1"));
  assert.ok(within(ot).getByText(/Muebles · 0 de 2 etapas cerradas · sin liberar/));
  fireEvent.click(within(ot).getByText(/Ver las OT/));
  assert.deepEqual(destinos, ["planta:ot"]);
});

test("panel — presentes hoy: presentes sobre el total y quiénes faltan", async () => {
  tableroCompleto();
  const pres = await screen.findByRole("region", { name: "Presentes hoy" });
  assert.ok(within(pres).getByText("1/3"));
  assert.ok(within(pres).getByText("Beto Ausente"));
  assert.equal(within(pres).queryByText("Ceci Franco"), null, "quien no tiene turno no falta");
  assert.ok(within(pres).getByText(/1 persona no tiene turno hoy/));
});

test("panel — pedidos de compras pendientes con su lista", async () => {
  const destinos = tableroCompleto();
  const compras = await screen.findByRole("region", { name: "Pedidos de compras" });
  await within(compras).findByText("Placa melamina blanca 18 mm");
  assert.ok(within(compras).getByText("1 pendiente"));
  assert.ok(within(compras).getByText("Juan · OT 7495"));
  fireEvent.click(within(compras).getByText(/Ir a Compras/));
  assert.deepEqual(destinos, ["planta:compras"]);
});

test("panel — el orden que pidió Tadeo", async () => {
  tableroCompleto();
  await screen.findByRole("region", { name: "OT en curso" });
  await screen.findByRole("region", { name: "Pedidos de compras" });
  const orden = ["OT en curso", "Presentes hoy", "Asistencia", "Pedidos de compras", "Jornadas hoy", "Solicitudes del personal"];
  const nodos = orden.map((n) => screen.getByRole("region", { name: n }));
  for (let i = 1; i < nodos.length; i++) {
    assert.ok(nodos[i - 1].compareDocumentPosition(nodos[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${orden[i - 1]} antes de ${orden[i]}`);
  }
});

test("el tablero no tiene 'cerrar sesión' suelto (está en Más → Mi cuenta)", async () => {
  tablero({ modulos: modulosEfectivos({ plan: "planta_15" }) });
  await screen.findByRole("region", { name: "Resumen de hoy" });
  assert.equal(screen.queryByLabelText("Cerrar sesion"), null);
});
