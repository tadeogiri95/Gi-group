// tests/indicadores.test.jsx — Órdenes de Producción, parte 7 (ítem 39):
// indicadores del período con lo que ya se registra (tareas, cantidades,
// paradas, no conformidades y OT).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { calcularIndicadores, fmtPorUnidad, singular } from "../app/lib/indicadores.js";
import { CAUSAS_FABRICA } from "../app/lib/causas.js";
import { DEFECTOS_FABRICA } from "../app/lib/calidad.js";
import { hoyArg } from "../app/lib/dates.js";

afterEach(() => cleanup());

const { default: Indicadores } = await import("../app/components/Indicadores.jsx");

const ETAPAS = [
  { codigo: 0, nombre: "Parado" },
  { codigo: 1, nombre: "Corte", unidad: "placas", orden: 1 },
  { codigo: 2, nombre: "Canto", unidad: "metros", orden: 2 },
  { codigo: 5, nombre: "Armado", unidad: "módulos", orden: 5 },
  { codigo: 9, nombre: "Limpieza", orden: 9 },
];
const fin = "2026-10-13T12:00:00Z";
const t = (etapa, min, extra = {}) => ({ etapa, duracion_min: min, hora_fin: fin, ...extra });

const TAREAS = [
  t(1, 60, { cantidad: 10, codigo_proyecto: "7495" }),
  t(1, 30, { cantidad: 5, codigo_proyecto: "7495" }),
  t(1, 30, { codigo_proyecto: "7495" }), // sin cantidad: no entra en el promedio
  t(2, 40, { cantidad: 20, codigo_proyecto: "7500", tipo: "R" }),
  t(5, 240, { cantidad: 2, codigo_proyecto: "7495" }),
  t(9, 0, { codigo_proyecto: "7495" }),
  t(0, 30, { causa: "SM", codigo_proyecto: "7495" }),
  t(0, 10, { causa: "SM" }),
  t(0, 20, { causa: "RO" }),
];
const PROYECTOS = [
  { ot: "7495", cliente: "Siciliano", total_modulos: 12, fecha_entrega: "2026-10-01", estado: "activo" },
  { ot: "7500", cliente: "Ana", fecha_entrega: "2026-10-01", estado: "activo", terminado_planilla: true },
  { ot: "7510", cliente: "Luis", fecha_entrega: "2026-10-01", estado: "cerrado" },
  { ot: "7520", cliente: "Eva", fecha_entrega: "2026-12-01", estado: "activo" },
];
const NC = [
  { defecto: "K1", cantidad: 3, etapa_origen: 2, decision: "reprocesar", minutos_retrabajo: 15 },
  { defecto: "K1", cantidad: 1, etapa_origen: 2, decision: null },
  { defecto: "C1", cantidad: 1, etapa_origen: 1, decision: "rehacer", minutos_retrabajo: 20 },
];

test("indicadores — minutos por unidad solo con las tareas que anotaron cantidad", () => {
  const ind = calcularIndicadores({ tareas: TAREAS, etapas: ETAPAS, causas: CAUSAS_FABRICA, defectos: DEFECTOS_FABRICA, noConformidades: NC, proyectos: PROYECTOS, hoy: "2026-10-13" });
  const corte = ind.etapas.find((e) => e.codigo === 1);
  assert.equal(corte.min, 120);
  assert.equal(corte.cantidad, 15);
  assert.equal(corte.minPorUnidad, 6);
  assert.equal(corte.sinCantidadPct, 25, "30 de 120 minutos sin cantidad");
  const armado = ind.etapas.find((e) => e.codigo === 5);
  assert.equal(armado.modulos, true);
  assert.equal(armado.minPorUnidad, 120, "2 horas por módulo");
  assert.equal(ind.etapas.find((e) => e.codigo === 9).minPorUnidad, null, "sin unidad no hay promedio");
  assert.deepEqual(ind.etapas.map((e) => e.codigo), [1, 2, 5, 9]);
});

test("indicadores — tiempo parado por causa y retrabajo en porcentaje", () => {
  const ind = calcularIndicadores({ tareas: TAREAS, etapas: ETAPAS, causas: CAUSAS_FABRICA, hoy: "2026-10-13" });
  assert.equal(ind.productivoMin, 400);
  assert.equal(ind.paradoMin, 60);
  assert.equal(ind.paradoPct, 13);
  assert.deepEqual(ind.paradas.map((p) => [p.causa, p.nombre, p.min, p.pct]), [["SM", "Sin material", 40, 8.7], ["RO", "Rotura o falla", 20, 4.3]]);
  assert.equal(ind.retrabajoMin, 40);
  assert.equal(ind.retrabajoPct, 10);
});

test("indicadores — no conformidades por defecto, origen y decisión", () => {
  const ind = calcularIndicadores({ tareas: [], etapas: ETAPAS, defectos: DEFECTOS_FABRICA, noConformidades: NC, hoy: "2026-10-13" });
  assert.equal(ind.calidad.piezas, 5);
  assert.equal(ind.calidad.sinDecidir, 1);
  assert.equal(ind.calidad.minutosRetrabajo, 35);
  assert.deepEqual(ind.calidad.porDefecto.map((d) => [d.clave, d.nombre, d.piezas]), [["K1", "Canto despegado o con rebaba", 4], ["C1", "Medida fuera de tolerancia", 1]]);
  assert.deepEqual(ind.calidad.porOrigen.map((o) => [o.nombre, o.piezas]), [["Canto", 4], ["Corte", 1]]);
  assert.deepEqual(ind.calidad.porDecision.map((d) => [d.cod, d.piezas]), [["reprocesar", 3], ["rehacer", 1]]);
});

test("indicadores — horas por OT, horas por módulo y OT atrasadas", () => {
  const ind = calcularIndicadores({ tareas: TAREAS, etapas: ETAPAS, proyectos: PROYECTOS, hoy: "2026-10-13" });
  const ot = ind.ots.find((o) => o.ot === "7495");
  assert.equal(ot.min, 360, "las paradas no suman a la OT");
  assert.equal(ot.modulosHechos, 2);
  assert.equal(ot.minPorModulo, 30);
  assert.equal(ind.ots[0].ot, "7495", "de más a menos horas");
  assert.deepEqual(ind.atrasadas.map((o) => [o.ot, o.dias]), [["7495", 12]], "ni cerradas, ni terminadas en la planilla, ni a tiempo");
});

test("fmtPorUnidad — minutos con coma y horas", () => {
  assert.equal(fmtPorUnidad(4.5), "4,5 min");
  assert.equal(fmtPorUnidad(120), "2 h");
  assert.equal(fmtPorUnidad(95), "1 h 35 min");
  assert.equal(fmtPorUnidad(119.7), "2 h");
  assert.equal(fmtPorUnidad(null), "—");
  assert.deepEqual(["placas", "metros", "módulos", "unidades", "bultos", "kg"].map(singular), ["placa", "metro", "módulo", "unidad", "bulto", "kg"]);
});

test("pantalla — muestra los indicadores del período", async () => {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const path = JSON.parse(opts.body).path || "";
    pedidos.push(path);
    if (path.startsWith("registro_actividades")) return new Response(JSON.stringify({ data: TAREAS }), { status: 200 });
    if (path.startsWith("no_conformidades")) return new Response(JSON.stringify({ data: NC }), { status: 200 });
    if (path.startsWith("proyectos")) return new Response(JSON.stringify({ data: PROYECTOS }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  render(<Indicadores fechaDesde="2026-10-06" fechaHasta="2026-10-12" labelPeriodo="Semana" empresaId="e1" etapas={ETAPAS} causas={CAUSAS_FABRICA} defectos={DEFECTOS_FABRICA} />);
  await waitFor(() => assert.ok(screen.getByText("Tiempo parado")));
  assert.ok(screen.getByText("13 %"));
  assert.ok(screen.getByText("6 min por placa"));
  assert.ok(screen.getByText("2 h por módulo"));
  assert.ok(screen.getByText("SM · Sin material"));
  assert.ok(screen.getByText("K1 · Canto despegado o con rebaba"));
  assert.ok(screen.getByText(/2 de 12 módulos/));
  // La pantalla cuenta el atraso contra el día de hoy: el número cambia con el calendario
  const dias = Math.round((Date.parse(hoyArg()) - Date.parse("2026-10-01")) / 86400000);
  assert.ok(screen.getByText(`${dias} días`));
  const nc = pedidos.find((p) => p.startsWith("no_conformidades"));
  assert.match(nc, /created_at=gte\.2026-10-06&created_at=lt\.2026-10-13/, "incluye todo el último día");
});

test("pantalla — sin la migración 101 igual muestra el resto", async () => {
  global.fetch = async (url, opts) => {
    const path = JSON.parse(opts.body).path || "";
    if (path.startsWith("no_conformidades")) return new Response(JSON.stringify({ error: "relation does not exist" }), { status: 400 });
    if (path.startsWith("registro_actividades")) return new Response(JSON.stringify({ data: TAREAS }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  render(<Indicadores fechaDesde="2026-10-06" fechaHasta="2026-10-12" labelPeriodo="Semana" empresaId="e1" etapas={ETAPAS} causas={CAUSAS_FABRICA} />);
  await waitFor(() => assert.ok(screen.getByText("Tiempo parado")));
  assert.ok(screen.getByText(/Sin piezas no conformes/));
});
