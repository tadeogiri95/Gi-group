// tests/ordenar-datos.test.jsx — Ordenar datos (auditoría 01/11, PR 6): OT
// activas sin movimiento (aviso y cierre en lote con vista previa) y stock
// negativo separado de los urgentes.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { otSinMovimiento, ultimosPasos, enTandas } from "../app/lib/otOrdenar.js";
import { filtrarArticulos, stockNegativo } from "../app/lib/stock.js";
import CerrarOtViejas from "../app/components/CerrarOtViejas.jsx";

afterEach(() => cleanup());

const proyectos = [
  { id: 1, ot: "100", estado: "activo", created_at: "2026-05-01T10:00:00Z", cliente: "Vieja" },          // último escaneo en agosto
  { id: 2, ot: "200", estado: "activo", created_at: "2026-07-01T10:00:00Z", cliente: "Nunca escaneada" }, // sin escaneos
  { id: 3, ot: "300", estado: "activo", created_at: "2026-05-01T10:00:00Z", cliente: "Viva" },           // escaneó ayer
  { id: 4, ot: "400", estado: "cerrado", created_at: "2026-01-01T10:00:00Z" },                           // ya cerrada
  { id: 5, ot: "500", estado: "activo", created_at: "2026-10-20T10:00:00Z", cliente: "Nueva" },          // alta reciente
  { id: 6, ot: "600", estado: "activo", terminado_planilla: true, created_at: "2026-04-01T10:00:00Z", cliente: "Terminada" },
];
const piezas = [
  { ot: "100", etapa: 1, total: 10, pasaron: 10, ultimo_paso: "2026-08-10T12:00:00Z" },
  { ot: "100", etapa: 2, total: 10, pasaron: 10, ultimo_paso: "2026-08-20T12:00:00Z" },
  { ot: "300", etapa: 1, total: 10, pasaron: 3, ultimo_paso: "2026-10-31T12:00:00Z" },
];

test("OT sin movimiento — por último escaneo o, si nunca se escaneó, desde el alta; la más quieta primero", () => {
  assert.equal(ultimosPasos(piezas).get("100"), "2026-08-20T12:00:00Z");
  const l = otSinMovimiento(proyectos, piezas, { hoy: "2026-11-01", dias: 30 });
  assert.deepEqual(l.map((x) => [x.p.ot, x.dias]), [["600", 214], ["200", 123], ["100", 73]]);
  assert.equal(l.find((x) => x.p.ot === "100").motivo, "Producción al 100 % · último escaneo el 20/8/26");
  assert.equal(l.find((x) => x.p.ot === "200").motivo, "sin escaneos ni cargas manuales, alta el 1/7/26");
  assert.equal(l.find((x) => x.p.ot === "600").motivo, "Terminada en la planilla · sin escaneos ni cargas manuales, alta el 1/4/26");
  // Con 90 días la de agosto todavía no entra
  assert.deepEqual(otSinMovimiento(proyectos, piezas, { hoy: "2026-11-01", dias: 90 }).map((x) => x.p.ot), ["600", "200"]);
  assert.deepEqual(enTandas([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("una OT con cargas manuales recientes cuenta como activa (Tadeo, 01/11)", () => {
  const ps = [
    { id: 7, ot: "700", estado: "activo", created_at: "2026-03-01T10:00:00Z", avance_manual: { activo: true, etapas: { 1: 50 }, at: "2026-10-25T13:00:00Z" } },
    { id: 8, ot: "800", estado: "activo", created_at: "2026-03-01T10:00:00Z", avance_manual: { activo: true, etapas: { 1: 50 }, at: "2026-08-01T13:00:00Z" } },
    { id: 9, ot: "100", estado: "activo", created_at: "2026-05-01T10:00:00Z", avance_manual: { activo: true, etapas: { 3: 20 }, at: "2026-10-30T13:00:00Z" } },
  ];
  const l = otSinMovimiento(ps, piezas, { hoy: "2026-11-01", dias: 30 });
  // 700: carga manual hace 7 días; 100: escaneada en agosto pero con carga manual el 30/10 → activas
  assert.deepEqual(l.map((x) => x.p.ot), ["800"]);
  assert.equal(l[0].motivo, "última carga manual el 1/8/26");
  assert.equal(l[0].dias, 92);
});

test("Cerrar OT viejas — vista previa, destildar y cerrar las elegidas", async () => {
  const cerradas = [];
  render(<CerrarOtViejas abierto proyectos={proyectos} piezas={piezas} hoy="2026-11-01" onCerrar={async (ids) => { cerradas.push(...ids); }} onClose={() => {}} />);
  // Por defecto 60 días: entran 600, 200 y 100
  const lista = await screen.findByRole("list", { name: "OT sin movimiento" });
  assert.equal(within(lista).getAllByRole("checkbox").length, 3);
  fireEvent.click(within(lista).getByRole("checkbox", { name: "Cerrar la OT 200" }));
  fireEvent.click(screen.getByRole("button", { name: "Cerrar 2 OT" }));
  await waitFor(() => assert.deepEqual(cerradas.sort(), [1, 6]));
  // Con 180 días solo queda la terminada
  fireEvent.change(screen.getByRole("combobox", { name: "Días sin movimiento" }), { target: { value: "180" } });
  assert.equal(within(screen.getByRole("list", { name: "OT sin movimiento" })).getAllByRole("checkbox").length, 1);
});

test("OT — aviso que filtra las quietas y botón de cierre en lote; cierra por id en tandas", () => {
  const ot = readFileSync(new URL("../app/proyectos_screen.jsx", import.meta.url), "utf8");
  assert.match(ot, /\{ id: "quietas", texto: `⏸ \$\{quietas\.size\} sin movimiento/);
  assert.match(ot, /🧹 Cerrar OT viejas en lote/);
  assert.match(ot, /sb\.patch\(`proyectos\?id=in\.\(\$\{tanda\.join\(","\)\}\)`, \{ estado: "cerrado" \}\)/);
});

test("Stock — el negativo no es urgente: va aparte para corregirlo en la planilla", () => {
  const arts = [
    { sku: "A", nombre: "Bisagra", semaforo: "🔴 URGENTE", stock: -427 },
    { sku: "B", nombre: "Placa", semaforo: "🔴 URGENTE", stock: 2 },
    { sku: "C", nombre: "Tornillo", semaforo: "✅ OK", stock: -1 },
    { sku: "D", nombre: "Canto", semaforo: "✅ OK", stock: 10 },
  ];
  assert.equal(stockNegativo(arts[0]), true);
  assert.equal(stockNegativo({ stock: null }), false);
  assert.deepEqual(filtrarArticulos(arts, { urgentes: true }).map((a) => a.sku), ["B"]);
  assert.deepEqual(filtrarArticulos(arts, { negativos: true }).map((a) => a.sku), ["A", "C"]);
  assert.equal(filtrarArticulos(arts).length, 4, "sin filtro se ven todos");
});
