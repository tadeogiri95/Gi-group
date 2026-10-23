// tests/detalle-op.test.jsx — Órdenes de Producción, parte 3 (ítem 39):
// detalle de una OT con horas por etapa, quién trabajó y retrabajos, sacado
// de las tareas que ya se registran.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock } from "./helpers/mockFetch.js";
import { resumirOp, fmtHoras, minutosDe } from "../app/lib/detalleOp.js";

afterEach(() => cleanup());

const { default: DetalleOp } = await import("../app/components/DetalleOp.jsx");

const ETAPAS = [
  { codigo: 0, nombre: "Parado", icon: "⏸" },
  { codigo: 1, nombre: "Corte", icon: "✂️" },
  { codigo: 2, nombre: "Enchapado", icon: "🪵" },
  { codigo: 3, nombre: "Armado", icon: "🔧" },
  { codigo: 4, nombre: "Pintura", icon: "🎨" },
];
const MUEBLES = { id: "d-m", clave: "MUE", label: "Muebles", ruta_etapas: [1, 2, 3] };
const EMPLEADOS = [
  { id: "e1", legajo: 1, nombre: "Juan Pérez", apodo: "Juancho" },
  { id: "e2", legajo: 2, nombre: "Ana Gómez", apodo: null },
];
const AHORA = Date.parse("2026-10-13T12:00:00Z");
const TAREAS = [
  { empleado_id: "e1", legajo: 1, fecha: "2026-10-10", hora_inicio: "2026-10-10T08:00:00Z", hora_fin: "2026-10-10T10:00:00Z", etapa: 1, tipo: "N", duracion_min: 120 },
  { empleado_id: "e2", legajo: 2, fecha: "2026-10-11", hora_inicio: "2026-10-11T08:00:00Z", hora_fin: "2026-10-11T08:30:00Z", etapa: 3, tipo: "R", duracion_min: 30 },
  { empleado_id: "e1", legajo: 1, fecha: "2026-10-11", hora_inicio: "2026-10-11T09:00:00Z", hora_fin: "2026-10-11T10:00:00Z", etapa: 3, tipo: "N", duracion_min: 60 },
  { empleado_id: null, legajo: 9, fecha: "2026-10-12", hora_inicio: "2026-10-12T08:00:00Z", hora_fin: "2026-10-12T08:15:00Z", etapa: 4, tipo: "C", duracion_min: 15 },
  // Tarea abierta: cuenta hasta ahora
  { empleado_id: "e2", legajo: 2, fecha: "2026-10-13", hora_inicio: "2026-10-13T11:20:00Z", hora_fin: null, etapa: 3, tipo: "N", duracion_min: null },
  // Una parada nunca suma
  { empleado_id: "e1", legajo: 1, fecha: "2026-10-13", hora_inicio: "2026-10-13T08:00:00Z", hora_fin: "2026-10-13T09:00:00Z", etapa: 0, tipo: "N", duracion_min: 60 },
];

test("fmtHoras y minutosDe", () => {
  assert.equal(fmtHoras(95), "1 h 35 min");
  assert.equal(fmtHoras(40), "40 min");
  assert.equal(fmtHoras(120), "2 h");
  assert.equal(fmtHoras(0), "0 min");
  assert.equal(minutosDe({ hora_fin: "x", duracion_min: 45 }), 45);
  assert.equal(minutosDe({ hora_fin: null, hora_inicio: "2026-10-13T11:00:00Z" }, AHORA), 60);
});

test("resumirOp — totales, etapas en el orden de la ruta, personas y retrabajos", () => {
  const r = resumirOp(TAREAS, { etapas: ETAPAS, division: MUEBLES, empleados: EMPLEADOS, ahora: AHORA });
  assert.equal(r.tareas, 5);
  assert.equal(r.totalMin, 120 + 30 + 60 + 15 + 40);
  assert.equal(r.dias, 4);
  assert.equal(r.desde, "2026-10-10");
  assert.equal(r.hasta, "2026-10-13");
  assert.deepEqual(r.ahoraTrabajando, ["Ana Gómez"]);
  // Ruta Corte → Enchapado → Armado (Enchapado sin horas igual aparece), después lo de fuera de la ruta
  assert.deepEqual(r.etapas.map((e) => [e.nombre, Math.round(e.min), e.enRuta]), [
    ["Corte", 120, true], ["Enchapado", 0, true], ["Armado", 130, true], ["Pintura", 15, false],
  ]);
  const armado = r.etapas.find((e) => e.codigo === 3);
  assert.deepEqual(armado.personas.sort(), ["Ana Gómez", "Juancho"]);
  assert.equal(armado.retrabajoMin, 30);
  assert.deepEqual(r.personas.map((p) => p.nombre), ["Juancho", "Ana Gómez", "Legajo 9"]);
  assert.deepEqual(r.retrabajos.map((x) => [x.tipo, x.veces, x.min]), [["R", 1, 30], ["C", 1, 15]]);
  assert.equal(r.retrabajoMin, 45);
});

test("resumirOp — sin ruta, las etapas van por horas y ninguna queda fuera de la ruta", () => {
  const r = resumirOp(TAREAS, { etapas: ETAPAS, division: null, empleados: EMPLEADOS, ahora: AHORA });
  assert.equal(r.tieneRuta, false);
  assert.deepEqual(r.etapas.map((e) => e.nombre), ["Armado", "Corte", "Pintura"]);
  assert.ok(r.etapas.every((e) => e.enRuta));
});

test("resumirOp — OT sin tareas", () => {
  const r = resumirOp([], { etapas: ETAPAS, division: MUEBLES });
  assert.equal(r.tareas, 0);
  assert.equal(r.totalMin, 0);
  assert.equal(r.desde, null);
});

function mockData(tareas, { avance = [], pasos = [] } = {}) {
  const pedidos = [];
  global.fetch = createFetchMock([
    {
      match: (u) => u === "/api/data",
      respond: (u, o) => {
        const { path } = JSON.parse(o.body);
        pedidos.push(path);
        if (path.startsWith("registro_actividades")) return { status: 200, body: { data: path.includes("offset=0") ? tareas : [] } };
        if (path.startsWith("empleados")) return { status: 200, body: { data: EMPLEADOS } };
        if (path.startsWith("avance_etapas")) return { status: 200, body: { data: avance } };
        if (path.startsWith("pasos_pieza")) return { status: 200, body: { data: path.includes("offset=0") ? pasos : [] } };
        return { status: 200, body: { data: [] } };
      },
    },
  ]);
  return pedidos;
}

const OT = { ot: "7495", cliente: "Siciliano", obra: "Mueble TV", division: "MUEBLES", fecha_entrega: "2026-11-01", cantidad: 1 };

test("DetalleOp — pide solo las tareas de esa OT y muestra horas, personas y retrabajos", async () => {
  const cerradas = TAREAS.filter((t) => t.hora_fin && t.etapa > 0);
  const pedidos = mockData(cerradas);
  let cerrado = false;
  render(<DetalleOp proyecto={OT} empresaId="emp-1" etapas={ETAPAS} divisiones={[MUEBLES]} onClose={() => { cerrado = true; }} />);
  assert.ok(screen.getByRole("dialog", { name: "Detalle de la OT 7495" }));
  assert.ok(await screen.findByText("Horas por etapa"));
  const pedido = pedidos.find((p) => p.startsWith("registro_actividades"));
  assert.match(pedido, /empresa_id=eq\.emp-1/);
  assert.match(pedido, /codigo_proyecto=eq\.7495/);
  assert.match(pedido, /select=.*causa,cantidad/);
  assert.ok(screen.getByText("3 h 45 min"), "total de horas");
  assert.ok(screen.getByText("Entrega 1/11/2026 · Cantidad 1"));
  assert.equal(screen.getAllByText("Enchapado").length, 2, "en Etapas y en Horas por etapa");
  assert.ok(screen.getByText("Retrabajo"));
  assert.ok(screen.getByText("Cambio pedido por el cliente"));
  assert.ok(screen.getByText(/fuera de la ruta/));
  fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
  assert.equal(cerrado, true);
});

test("DetalleOp — sin tareas muestra las etapas de la ruta con su estado (auditoría 22/10)", async () => {
  // Ya no se usa "Iniciar Tarea": el detalle no puede decir siempre que nadie registró tareas
  const pedidos = mockData([], {
    avance: [{ ot: "7495", etapa: 1, estado: "aprobada", aprobada_at: "2026-10-20T12:00:00Z" }],
    pasos: [{ pieza_id: 1, etapa: 2 }],
  });
  render(<DetalleOp proyecto={OT} empresaId="emp-1" etapas={ETAPAS} divisiones={[MUEBLES]} onClose={() => {}} />);
  const lista = await screen.findByRole("region", { name: "Etapas de la OT" });
  assert.match(lista.textContent, /Corte.*Firmada el 20\/10\/2026/);
  assert.match(lista.textContent, /Enchapado.*En curso/, "con piezas escaneadas está en curso");
  assert.match(lista.textContent, /Armado.*Pendiente/);
  assert.equal(screen.queryByText(/nadie registró tareas/), null);
  assert.equal(screen.queryByText("Horas por etapa"), null);
  assert.match(pedidos.find((p) => p.startsWith("avance_etapas")), /ot=eq\.7495/);
});

test("DetalleOp — OT sin ruta ni avance avisa que todavía no hay avance", async () => {
  mockData([]);
  render(<DetalleOp proyecto={{ ...OT, division: null }} empresaId="emp-1" etapas={ETAPAS} divisiones={[MUEBLES]} onClose={() => {}} />);
  assert.ok(await screen.findByText("Todavía no hay avance en esta OT: nadie escaneó piezas ni marcó etapas."));
});
