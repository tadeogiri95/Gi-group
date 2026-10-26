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

test("sin repetidos — sin fila de números arriba: cada dato está en su tarjeta (pedido de Tadeo 19/10)", async () => {
  const destinos = tablero({ modulos: modulosEfectivos({ plan: "planta_15" }), solicitudes: PENDIENTES });
  const sol = await screen.findByRole("region", { name: "Permisos del personal" });
  assert.equal(screen.queryByRole("region", { name: "Resumen de hoy" }), null);
  assert.ok(within(sol).getByText("2 sin responder"));
  assert.equal(screen.queryByText(/pedidos? sin responder$/), null);
  fireEvent.click(within(sol).getByText(/Responder permisos/));
  assert.deepEqual(destinos, ["solicitudes"]);
  const src = readFileSync(new URL("../app/dashboard_gerencia.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /<Stat /);
  assert.doesNotMatch(src, /Jornadas de hoy/, "la llegada de cada uno reemplaza a las jornadas");
  assert.doesNotMatch(src, /etiqueta="Cumplimiento"/, "el % de hoy está solo en la asistencia del día");
  assert.equal((src.match(/<div className="g-kpi-label">Trabajando<\/div>/g) || []).length, 1, "solo en el detalle de En planta, no repetido en Productividad");
});

test("ranking — siempre a la vista, sin botón para mostrarlo", () => {
  const src = readFileSync(new URL("../app/dashboard_gerencia.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /gypi_ver_ranking/);
  assert.doesNotMatch(src, /Mostrar el ranking del mes/);
});

const ENTRA = { in: "00:00", out: "23:59" }; // ya empezó a cualquier hora del día de la prueba
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
      { id: "a", legajo: 1, nombre: "Ana Presente", rol: "operativo", division: "M", activo: true, diagrama: DIAG },
      { id: "b", legajo: 2, nombre: "Beto Ausente", rol: "operativo", division: "M", activo: true, diagrama: DIAG },
      { id: "c", legajo: 3, nombre: "Ceci Franco", rol: "operativo", division: "A", activo: true, diagrama: {} },
      { id: "d", legajo: 4, nombre: "Dani Tarde", rol: "operativo", division: "A", activo: true, diagrama: DIAG },
      { id: "e", legajo: 5, nombre: "Dueño Sin Horario", rol: "gerencial", division: "M", activo: true, diagrama: DIAG },
    ],
    fichadasHoy: [
      { legajo: 1, nombre: "Ana Presente", ingreso: "08:00:00" },
      { legajo: 4, nombre: "Dani Tarde", ingreso: "08:20:00", llegada_tarde: true, minutos_tarde: 20 },
    ],
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

test("panel — OT en curso con su división, y 'Ver las OT' abre Proyectos → OT", async () => {
  const destinos = tableroCompleto();
  const ot = await screen.findByRole("region", { name: "OT en curso" });
  await within(ot).findByText("7495");
  assert.ok(within(ot).getByText("7500"));
  assert.equal(within(ot).queryByText("7600"), null, "sin etapas empezadas no está en curso");
  assert.ok(within(ot).getByText("Muebles: 1"));
  assert.ok(within(ot).getByText("Aluminio: 1"));
  assert.ok(within(ot).getByText(/Muebles · 0 de 2 etapas cerradas · sin liberar/));
  fireEvent.click(within(ot).getByText(/Ver las OT/));
  assert.deepEqual(destinos, ["proyectos:ot"]);
});

test("panel — asistencia del día: solo operarios, por división y total, con la llegada de cada uno", async () => {
  const destinos = tableroCompleto();
  const as = await screen.findByRole("region", { name: "Asistencia del día" });
  const filas = within(as).getAllByRole("row").map((r) => r.textContent.replace(/\s+/g, " ").trim());
  assert.deepEqual(filas.slice(1), [
    "Aluminio1/1 (100%)1/1 (100%)",
    "Muebles1/2 (50%)0/1 (0%)",
    "Total2/3 (67%)1/2 (50%)",
  ]);
  assert.equal(within(as).queryByText("Dueño Sin Horario"), null, "los dueños no cuentan");
  assert.equal(within(as).queryByText("Ceci Franco"), null, "de franco no aparece");
  assert.ok(within(as).getByText("No vino"));
  assert.ok(within(as).getByText("Tarde 20 min"));
  assert.ok(within(as).getByText("A tiempo"));
  fireEvent.click(within(as).getByRole("button", { name: /Beto Ausente: No vino/ }));
  assert.deepEqual(destinos.at(-1), "historial-fichajes");
  assert.ok(within(as).getByRole("button", { name: "Día siguiente" }).disabled, "no hay días futuros");
});

test("panel — pedidos de compras pendientes con su lista", async () => {
  const destinos = tableroCompleto();
  const compras = await screen.findByRole("region", { name: "Pedidos de material" });
  await within(compras).findByText("Placa melamina blanca 18 mm");
  assert.ok(within(compras).getByText("1 pendiente"));
  assert.ok(within(compras).getByText("Juan · OT 7495"));
  fireEvent.click(within(compras).getByText(/Ir a Compras/));
  assert.deepEqual(destinos, ["inventario:compras"]);
});

test("panel — el orden que pidió Tadeo", async () => {
  tableroCompleto();
  await screen.findByRole("region", { name: "OT en curso" });
  await screen.findByRole("region", { name: "Pedidos de material" });
  const orden = ["OT en curso", "Asistencia del día", "Asistencia semanal", "Pedidos de material", "Permisos del personal"];
  const nodos = orden.map((n) => screen.getByRole("region", { name: n }));
  for (let i = 1; i < nodos.length; i++) {
    assert.ok(nodos[i - 1].compareDocumentPosition(nodos[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${orden[i - 1]} antes de ${orden[i]}`);
  }
});

test("el tablero no tiene 'cerrar sesión' suelto (está en Más → Mi cuenta)", async () => {
  tablero({ modulos: modulosEfectivos({ plan: "planta_15" }) });
  await screen.findByRole("region", { name: "Asistencia del día" });
  assert.equal(screen.queryByLabelText("Cerrar sesion"), null);
});

test("llegadasDelDia — hoy, quien todavía no entra no cuenta como falta; sin turno que vino, aparte", async () => {
  const { llegadasDelDia, asistenciaPorDivision, diaKeyDeFecha } = await import("../app/lib/asistenciaDia.js");
  const turno = (h) => ({ lun: { in: h, out: "22:00" } });
  const empleados = [
    { id: 1, legajo: 1, nombre: "Mañana", rol: "operativo", division: "M", diagrama: turno("08:00") },
    { id: 2, legajo: 2, nombre: "Tarde", rol: "operativo", division: "M", diagrama: turno("14:00") },
    { id: 3, legajo: 3, nombre: "Franco", rol: "operativo", division: "M", diagrama: {} },
    { id: 4, legajo: 4, nombre: "Baja", rol: "operativo", division: "M", diagrama: turno("08:00"), activo: false },
  ];
  const fichadas = [{ legajo: 3, ingreso: "09:00:00" }];
  const hoy = llegadasDelDia({ empleados, fichadas, diaKey: "lun", horaActual: "10:00" });
  assert.deepEqual(hoy.map((l) => [l.nombre, l.estado]), [["Mañana", "falta"], ["Tarde", "por_entrar"], ["Franco", "fuera_horario"]]);
  assert.deepEqual(asistenciaPorDivision(hoy).total, { esperados: 1, vinieron: 0, tarde: 0 });
  const pasado = llegadasDelDia({ empleados, fichadas: [], diaKey: "lun" });
  assert.deepEqual(asistenciaPorDivision(pasado).total, { esperados: 2, vinieron: 0, tarde: 0 }, "un día pasado: todos los que tenían turno");
  assert.equal(diaKeyDeFecha("2026-10-19"), "lun");
});

// ── Mantenimiento, parte 36: 🔧 Mantenimiento (reemplaza a 🚚 Flota) y ⏰ OT atrasadas ──
const { alertasMantenimiento, otAtrasadas } = await import("../app/lib/panelMantenimiento.js");

test("otAtrasadas — pasó su fecha objetivo y no están terminadas, la más atrasada arriba, con su %", () => {
  const fila = (ot, fecha_objetivo, cerradas, total, extra = {}) => ({ proyecto: { id: ot, ot, fecha_objetivo, ...extra }, cerradas, celdas: Array(total).fill({}) });
  const filas = [
    fila("1", "2026-10-20", 1, 2),
    fila("2", "2026-10-01", 0, 2),
    fila("3", "2026-10-25", 0, 2), // vence hoy: todavía no está atrasada
    fila("4", "2026-10-02", 2, 2), // todas las etapas cerradas
    fila("5", null, 0, 2),
    fila("6", "2026-10-24", 0, 0), // sin ruta: atrasada sin %
    fila("7", "2026-10-01", 0, 2, { terminado_planilla: true }), // TERMINADO en la planilla
    fila("8", null, 0, 2, { fecha_entrega: "2026-10-01" }), // sin semana: no entra aunque tenga entrega
  ];
  const r = otAtrasadas(filas, { porEscaneo: new Map([["2", { porcentaje: 37 }]]), hoy: "2026-10-25" });
  assert.deepEqual(r.map((x) => [x.fila.proyecto.ot, x.dias, x.porcentaje]), [["2", 24, 37], ["1", 5, 50], ["6", 1, null]]);
});

test("alertasMantenimiento — máquinas paradas arriba, después lo vencido y al final lo de pronto", () => {
  const maquinas = [
    { id: "m1", codigo: "CNC-01", estado: "parada", activo: true, criticidad: "A" },
    { id: "m2", codigo: "SEC-01", estado: "en_servicio", activo: true, criticidad: "B" },
  ];
  const fallas = [
    { id: "f1", maquina_id: "m1", descripcion: "No arranca el husillo", parada: true, estado: "pendiente", created_at: "2026-10-24T10:00:00Z" },
    { id: "f2", maquina_id: "m2", descripcion: "Ruido en la sierra", parada: false, estado: "pendiente", created_at: "2026-10-24T11:00:00Z" },
  ];
  const alertasFlota = [{ patente: "AB123CD", clave: "seguro", nivel: "vencido", texto: "Seguro", falta: true }];
  const r = alertasMantenimiento({ alertasFlota, maquinas, tareas: [], fallas, hoy: "2026-10-25", textoVencimiento: () => "" });
  assert.deepEqual(r.map((a) => [a.quien, a.texto, a.nivel]), [
    ["CNC-01", "Parada: No arranca el husillo", "vencido"],
    ["AB123CD", "Seguro", "vencido"],
    ["SEC-01", "Falla: Ruido en la sierra", "pronto"],
  ]);
  assert.equal(r[0].destino, "mantenimiento:maquinaria");
  assert.equal(r[1].destino, "mantenimiento:flota");
});

test("panel — tarjetas 🔧 Mantenimiento y ⏰ OT atrasadas", async () => {
  const respuestas = {
    proyectos: [
      { id: 1, ot: "7495", cliente: "CEVT", division: "M", semana_objetivo: 2, fecha_objetivo: "2020-01-11", liberada_at: null },
      { id: 2, ot: "7500", cliente: "A tiempo", division: "M", semana_objetivo: 2, fecha_objetivo: "2099-01-10", liberada_at: null },
      { id: 3, ot: "7600", cliente: "Sin semana", division: "M", fecha_entrega: "2020-01-10", liberada_at: null },
    ],
    maquinas: [{ id: "m1", codigo: "CNC-01", nombre: "CNC 1", estado: "parada", activo: true, criticidad: "A" }],
    maquina_fallas: [{ id: "f1", maquina_id: "m1", descripcion: "No arranca", parada: true, estado: "pendiente", created_at: "2026-10-24T10:00:00Z" }],
  };
  global.fetch = async (_url, opts) => {
    const { path } = JSON.parse(opts?.body || "{}");
    return Response.json({ ok: true, data: respuestas[String(path || "").split("?")[0]] || [] });
  };
  const destinos = [];
  render(
    <AuthContext.Provider value={{ divisiones: [{ id: "M", label: "Muebles", ruta_etapas: [1, 2] }], etapas: [{ codigo: 1, nombre: "Corte", orden: 1 }, { codigo: 2, nombre: "Canto", orden: 2 }], usuario: { rol: "gerencial" } }}>
      <DashboardGerencia goto={(d) => destinos.push(d)} ctx={{ empleados: [], fichadasHoy: [], solicitudes: [], notificaciones: [] }} reload={() => {}} logout={() => {}} empresa={{ id: "e-1", nombre: "Acme", modulos: modulosEfectivos({ plan: "planta_15" }) }} />
    </AuthContext.Provider>
  );
  const atr = await screen.findByRole("region", { name: "OT atrasadas" });
  await within(atr).findByText("7495");
  assert.equal(within(atr).queryByText("7500"), null, "la que vence más adelante no está atrasada");
  assert.equal(within(atr).queryByText("7600"), null, "sin semana no cuenta como atrasada");
  assert.ok(within(atr).getByText(/Muebles · S2 \(11\/1\) · 0% hecho/));
  assert.ok(within(atr).getByText(/^\d+ días$/));
  const mant = await screen.findByRole("region", { name: "Mantenimiento" });
  await within(mant).findByText("Parada: No arranca");
  assert.ok(within(mant).getByText("1 parada"));
  assert.equal(screen.queryByRole("region", { name: "Flota" }), null, "🔧 Mantenimiento reemplaza a 🚚 Flota");
  fireEvent.click(within(mant).getByText(/Ir a Maquinaria/));
  assert.deepEqual(destinos, ["mantenimiento:maquinaria"]);
  const ot = screen.getByRole("region", { name: "OT en curso" });
  assert.ok(ot.compareDocumentPosition(atr) & Node.DOCUMENT_POSITION_FOLLOWING, "OT atrasadas va después de OT en curso");
});
