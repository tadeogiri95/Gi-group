// tests/tablero-dueno.test.jsx — Panel de control (Inicio de gerencia).
// Pedido de Tadeo (23/11): solo cuatro bloques y en este orden: Equipo, OT en
// curso en producción (avance real: escaneo o % a mano), escaneos de piezas de
// hoy y Flota. La asistencia todavía no corre por Gypi.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

const { default: DashboardGerencia } = await import("../app/dashboard_gerencia.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { modulosEfectivos } = await import("../app/lib/modulos.js");
const { otEnProduccion, escaneosDelDia, escaneosPorOt, inicioDelDiaArg } = await import("../app/lib/inicioGerencia.js");

afterEach(() => cleanup());

const RESPUESTAS = {
  proyectos: [
    { id: 1, ot: "7495", cliente: "CEVT", division: "M" },
    { id: 2, ot: "7500", cliente: "Terminada", division: "M" },
    { id: 3, ot: "7600", cliente: "Sin empezar", division: "A" },
    { id: 4, ot: "7800", cliente: "A mano", division: "A", avance_manual: { activo: true, etapas: { 1: 30 } } },
  ],
  // 7495: 4 de 10 piezas en Corte (40 %); 7500: todo escaneado (100 %)
  v_avance_piezas: [
    { ot: "7495", etapa: 1, total: 10, pasaron: 4 },
    { ot: "7500", etapa: 1, total: 5, pasaron: 5 },
  ],
  pasos_pieza: [
    { id: 1, ot: "7495", etapa: 1, created_at: "2026-11-23T11:05:00+00:00", piezas_ot: { nombre: "Lateral izq", modulo: "Bajo 1" }, empleados: { nombre: "Juan" } },
    { id: 2, ot: "7495", etapa: 1, created_at: "2026-11-23T12:30:00+00:00", piezas_ot: { nombre: "Puerta", modulo: null }, empleados: { nombre: "Ana" } },
  ],
  vehiculos: [{ id: "v1", patente: "AB123CD", activo: true }],
};

function panel({ modulos = modulosEfectivos({ plan: "planta_15" }), respuestas = RESPUESTAS } = {}) {
  const pedidos = [];
  global.fetch = async (_url, opts) => {
    const { path } = JSON.parse(opts?.body || "{}");
    pedidos.push(String(path || ""));
    return Response.json({ ok: true, data: respuestas[String(path || "").split("?")[0]] || [] });
  };
  const destinos = [];
  const ctx = {
    empleados: [
      { id: "a", nombre: "Ana", division: "M", activo: true },
      { id: "b", nombre: "Beto", division: "A", activo: true },
      { id: "c", nombre: "Baja", division: "A", activo: false },
    ],
    fichadasHoy: [], solicitudes: [{ id: 1, estado: "pendiente", tipo: "permiso" }], notificaciones: [],
  };
  render(
    <AuthContext.Provider value={{
      divisiones: [{ id: "M", label: "Muebles", ruta_etapas: [1] }, { id: "A", label: "Aluminio", ruta_etapas: [1] }],
      etapas: [{ codigo: 1, nombre: "Corte", orden: 1 }], usuario: { rol: "gerencial" },
    }}>
      <DashboardGerencia goto={(d) => destinos.push(d)} ctx={ctx} reload={() => {}} logout={() => {}} empresa={{ id: "e-1", nombre: "Acme", modulos }} />
    </AuthContext.Provider>
  );
  return { destinos, pedidos };
}

test("panel — solo Equipo, OT en curso, Escaneos de hoy y Flota, en ese orden", async () => {
  panel();
  await screen.findByRole("region", { name: "Escaneos de hoy" });
  await screen.findByRole("region", { name: "Flota" });
  const regiones = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
  assert.deepEqual(regiones, ["Equipo", "OT en curso", "Escaneos de hoy", "Flota"]);
  for (const fuera of ["Asistencia del día", "Asistencia semanal", "Permisos del personal", "Pedidos de material", "OT atrasadas", "Mantenimiento", "Alertas activas"]) {
    assert.equal(screen.queryByRole("region", { name: fuera }), null, fuera);
  }
  assert.equal(screen.queryByLabelText("Cerrar sesion"), null, "cerrar sesión está en Más → Mi cuenta");
});

test("panel — Equipo cuenta los activos por división", async () => {
  panel();
  const eq = await screen.findByRole("region", { name: "Equipo" });
  assert.ok(within(eq).getByText("2 activos"));
});

test("panel — OT en curso: solo las que tienen avance real y no llegaron al 100 %", async () => {
  const { destinos } = panel();
  const ot = await screen.findByRole("region", { name: "OT en curso" });
  await within(ot).findByText("7495");
  assert.ok(within(ot).getByText("40%"));
  assert.ok(within(ot).getByText("7800"), "el % cargado a mano también cuenta");
  assert.ok(within(ot).getByText("30%"));
  assert.equal(within(ot).queryByText("7500"), null, "al 100 % ya no está en producción");
  assert.equal(within(ot).queryByText("7600"), null, "sin avance no está en curso");
  assert.ok(within(ot).getByText("Muebles: 1"));
  assert.ok(within(ot).getByText("Aluminio: 1"));
  fireEvent.click(within(ot).getByText(/Ver las OT/));
  assert.deepEqual(destinos, ["proyectos:ot"]);
});

test("panel — escaneos de hoy: lo último arriba, con pieza, proceso y quién", async () => {
  const { pedidos } = panel();
  const esc = await screen.findByRole("region", { name: "Escaneos de hoy" });
  await within(esc).findByText(/Puerta/);
  assert.ok(within(esc).getByText("2 piezas"));
  assert.ok(within(esc).getByText("OT 7495: 2"));
  const filas = within(esc).getAllByText(/· (Juan|Ana)$/).map((n) => n.textContent);
  assert.deepEqual(filas, ["Corte · Ana", "Corte · Juan"]);
  assert.ok(within(esc).getByText(/Lateral izq \(Bajo 1\)/));
  assert.ok(within(esc).getByText("09:30"), "hora de Argentina");
  const q = pedidos.find((p) => p.startsWith("pasos_pieza?"));
  assert.match(q, /created_at=gte\.\d{4}-\d{2}-\d{2}T00%3A00%3A00-03%3A00/);
  assert.match(q, /piezas_ot\(nombre,modulo\),empleados\(nombre\)/);
});

test("panel — Flota: alertas de los vehículos y 'Ir a Flota'", async () => {
  const { destinos } = panel();
  const fl = await screen.findByRole("region", { name: "Flota" });
  await within(fl).findByText("Falta el primer checklist");
  assert.ok(within(fl).getAllByText("AB123CD").length >= 1);
  fireEvent.click(within(fl).getByText(/Ir a Flota/));
  assert.deepEqual(destinos, ["mantenimiento:flota-alertas"]);
});

test("panel — sin OT ni Flota contratados, solo queda Equipo", async () => {
  panel({ modulos: modulosEfectivos({ plan: "asistencia_15" }) });
  await screen.findByRole("region", { name: "Equipo" });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label")), ["Equipo"]);
});

test("otEnProduccion — avance entre 0 y 100, sin cerradas ni terminadas en la planilla, la más avanzada arriba", () => {
  const proyectos = [
    { ot: "1" }, { ot: "2" }, { ot: "3", estado: "cerrado" }, { ot: "4", terminado_planilla: true }, { ot: "5" }, { ot: "6" },
  ];
  const piezas = [
    { ot: "1", etapa: 1, total: 10, pasaron: 2 },
    { ot: "2", etapa: 1, total: 10, pasaron: 10 }, { ot: "2", etapa: 2, total: 10, pasaron: 5 },
    { ot: "3", etapa: 1, total: 10, pasaron: 5 },
    { ot: "4", etapa: 1, total: 10, pasaron: 5 },
    { ot: "5", etapa: 1, total: 10, pasaron: 0 },
    { ot: "6", etapa: 1, total: 4, pasaron: 4 },
  ];
  assert.deepEqual(otEnProduccion(proyectos, piezas).map((f) => [f.proyecto.ot, f.porcentaje]), [["2", 75], ["1", 20]]);
});

test("escaneosDelDia / escaneosPorOt — nombres del proceso, el último primero y cuenta por OT", () => {
  const filas = [
    { id: 1, ot: "A", etapa: 1, created_at: "2026-11-23T10:00:00+00:00", piezas_ot: { nombre: "P1" } },
    { id: 2, ot: "B", etapa: 9, created_at: "2026-11-23T11:00:00+00:00" },
    { id: 3, ot: "A", etapa: 1, created_at: "2026-11-23T12:00:00+00:00", piezas_ot: { nombre: "P3" }, empleados: { nombre: "Eva" } },
  ];
  const e = escaneosDelDia(filas, [{ codigo: 1, nombre: "Corte" }]);
  assert.deepEqual(e.map((x) => [x.id, x.pieza, x.proceso, x.quien]), [[3, "P3", "Corte", "Eva"], [2, "Pieza", "Etapa 9", null], [1, "P1", "Corte", null]]);
  assert.deepEqual(escaneosPorOt(e), [{ ot: "A", cantidad: 2 }, { ot: "B", cantidad: 1 }]);
  assert.equal(inicioDelDiaArg("2026-11-23"), "2026-11-23T00:00:00-03:00");
});

test("panel — sin estilos sueltos ni lo que se sacó del Inicio", () => {
  const src = readFileSync(new URL("../app/dashboard_gerencia.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /<Stat /);
  assert.doesNotMatch(src, /gypi_ver_ranking/);
  for (const fuera of ["Asistencia del día", "Ranking", "Permisos del personal", "TarjetaMinuta", "TarjetaPlata"]) {
    assert.ok(!src.includes(fuera), `queda "${fuera}"`);
  }
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
  assert.equal(r[0].destino, "mantenimiento:maquinaria-alertas");
  assert.equal(r[1].destino, "mantenimiento:flota-alertas");
});
