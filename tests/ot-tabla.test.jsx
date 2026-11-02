// tests/ot-tabla.test.jsx — Producción → OT, tabla de la computadora: ordenar
// de forma ascendente o descendente y filtrar por columna (Tadeo, 02/11)
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { filasTablaOt, siguienteOrden, estadosPresentes } from "../app/lib/otTabla.js";

const { default: ProyectosScreen } = await import("../app/proyectos_screen.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
afterEach(() => cleanup());

const fila = (ot, extra = {}) => ({ p: { ot, cliente: extra.cliente || "", fecha_entrega: extra.entrega || null }, pct: extra.pct ?? null, estado: { texto: extra.estado || "Sin empezar" }, entrega: extra.entrega || "", obra: extra.obra || "", valor: extra.valor ?? null });
const FILAS = [
  fila("7495", { cliente: "Banco Norte", pct: 40, estado: "En curso", entrega: "2026-11-20" }),
  fila("7858", { cliente: "CEVT", pct: 100, estado: "Producción terminada", entrega: "2026-11-05", valor: 1000 }),
  fila("812", { cliente: "Álamo SA", pct: null, estado: "Sin empezar" }),
];
const ots = (l) => l.map((f) => f.p.ot);

test("ordenar — ascendente y descendente por columna; los vacíos siempre al final", () => {
  assert.deepEqual(ots(filasTablaOt(FILAS, { orden: { col: "ot", dir: "asc" } })), ["812", "7495", "7858"], "número de OT como número");
  assert.deepEqual(ots(filasTablaOt(FILAS, { orden: { col: "ot", dir: "desc" } })), ["7858", "7495", "812"]);
  assert.deepEqual(ots(filasTablaOt(FILAS, { orden: { col: "cliente", dir: "asc" } })), ["812", "7495", "7858"], "sin importar acentos");
  assert.deepEqual(ots(filasTablaOt(FILAS, { orden: { col: "avance", dir: "desc" } })), ["7858", "7495", "812"]);
  assert.deepEqual(ots(filasTablaOt(FILAS, { orden: { col: "avance", dir: "asc" } })), ["7495", "7858", "812"]);
  assert.deepEqual(ots(filasTablaOt(FILAS, { orden: { col: "entrega", dir: "asc" } })), ["7858", "7495", "812"]);
  assert.deepEqual(ots(filasTablaOt(FILAS, { orden: { col: "entrega", dir: "desc" } })), ["7495", "7858", "812"]);
  assert.deepEqual(ots(filasTablaOt(FILAS)), ["7495", "7858", "812"], "sin orden queda como viene");
  assert.deepEqual(siguienteOrden(null, "ot"), { col: "ot", dir: "asc" });
  assert.deepEqual(siguienteOrden({ col: "ot", dir: "asc" }, "ot"), { col: "ot", dir: "desc" });
  assert.equal(siguienteOrden({ col: "ot", dir: "desc" }, "ot"), null);
  assert.deepEqual(siguienteOrden({ col: "ot", dir: "desc" }, "cliente"), { col: "cliente", dir: "asc" });
});

test("filtrar — texto por columna, estado, rango de avance y valor; se combinan", () => {
  assert.deepEqual(ots(filasTablaOt(FILAS, { filtros: { cliente: "alamo" } })), ["812"]);
  assert.deepEqual(ots(filasTablaOt(FILAS, { filtros: { ot: "78" } })), ["7858"]);
  assert.deepEqual(ots(filasTablaOt(FILAS, { filtros: { estado: "En curso" } })), ["7495"]);
  assert.deepEqual(ots(filasTablaOt(FILAS, { filtros: { avance: "sin" } })), ["812"]);
  assert.deepEqual(ots(filasTablaOt(FILAS, { filtros: { avance: "completa" } })), ["7858"]);
  assert.deepEqual(ots(filasTablaOt(FILAS, { filtros: { valor: "con" } })), ["7858"]);
  assert.deepEqual(ots(filasTablaOt(FILAS, { filtros: { cliente: "n", avance: "empezada" } })), ["7495"]);
  assert.deepEqual(estadosPresentes(FILAS), ["En curso", "Producción terminada", "Sin empezar"]);
});

const E = "11111111-1111-1111-1111-111111111111";
const OTS = [
  { id: 1, ot: "7495", cliente: "Banco Norte", division: "muebles", estado: "activo", fecha_entrega: "2026-11-20" },
  { id: 2, ot: "7858", cliente: "CEVT", division: "muebles", estado: "activo", fecha_entrega: "2026-11-05" },
  { id: 3, ot: "812", cliente: "Álamo SA", division: "muebles", estado: "activo" },
];

test("pantalla — tocar el título ordena (▲ / ▼) y las cajas de abajo filtran", async () => {
  global.fetch = async (url, opts = {}) => {
    const { path = "" } = JSON.parse(opts.body || "{}");
    return new Response(JSON.stringify({ ok: true, data: path.startsWith("proyectos") ? OTS : [] }), { status: 200 });
  };
  render(
    <AuthContext.Provider value={{ divisiones: [{ id: "muebles", label: "Muebles" }], empresa: { id: E, nombre: "Acme", slug: "acme" }, usuario: { rol: "gerencial", empresa_id: E }, updateEmpresa: () => {} }}>
      <ProyectosScreen empresaId={E} />
    </AuthContext.Provider>,
  );
  const tabla = await screen.findByRole("table", { name: "Órdenes de trabajo" });
  const filasOt = () => within(tabla).getAllByRole("button", { name: /Ver el detalle de la OT/ }).map((b) => b.textContent);
  await within(tabla).findByRole("button", { name: "Ver el detalle de la OT 812" });
  const porOt = within(tabla).getByRole("button", { name: "Ordenar por OT" });
  fireEvent.click(porOt);
  assert.deepEqual(filasOt(), ["812", "7495", "7858"]);
  assert.equal(porOt.closest("th").getAttribute("aria-sort"), "ascending");
  fireEvent.click(within(tabla).getByRole("button", { name: /Ordenar por OT/ }));
  assert.deepEqual(filasOt(), ["7858", "7495", "812"]);
  assert.equal(within(tabla).getByRole("button", { name: /Ordenar por OT/ }).closest("th").getAttribute("aria-sort"), "descending");
  // Por entrega: la que no tiene fecha va al final
  fireEvent.click(within(tabla).getByRole("button", { name: "Ordenar por Entrega" }));
  assert.deepEqual(filasOt(), ["7858", "7495", "812"]);
  // Filtro por cliente
  fireEvent.change(within(tabla).getByRole("textbox", { name: "Filtrar Cliente / obra" }), { target: { value: "banco" } });
  assert.deepEqual(filasOt(), ["7495"]);
  fireEvent.change(within(tabla).getByRole("textbox", { name: "Filtrar Cliente / obra" }), { target: { value: "nada" } });
  assert.ok(within(tabla).getByText("Ninguna OT cumple esos filtros."));
  fireEvent.click(within(tabla).getByRole("button", { name: "Limpiar filtros" }));
  assert.equal(filasOt().length, 3);
});
