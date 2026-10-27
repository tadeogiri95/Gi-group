// tests/tipo-proyecto.test.jsx — Tipo de proyecto de cada OT para la
// planificación (migración 139): sale solo de la descripción y se puede
// cambiar a mano; mecanizados y gabinetes por placa por tipo, y el switch del
// cálculo de mecanizados (por tipo, o % de placas × mecanizados por placa).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { tipoAutomatico, tipoDeOt, TIPOS_PROYECTO } from "../app/lib/tipoProyecto.js";
import { normalizarParametros, parametrosFaltantes, relacionesTipo } from "../app/lib/planificacion.js";
import { horasOt } from "../app/lib/cargaPlanta.js";
import { stripUnallowedFields } from "../app/lib/validate.ts";

const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { default: PlanificacionScreen } = await import("../app/components/PlanificacionScreen.jsx");

afterEach(() => cleanup());

test("tipoAutomatico — palabras clave en el orden del estudio; la OT mixta queda en el primero", () => {
  const casos = {
    "COCINA + ISLA": "cocina",
    "BAJO MESADA + ALACENAS ASADOR": "cocina",
    "PLACARD PUERTAS CORREDIZAS": "placard",
    "PUERTAS INTERIORES": "puertas",
    "P2 - PUERTA DE BAÑO": "puertas",
    "VANITORY + MESADA": "bano",
    "LAVADERO - BAJO MESADA (casas 19 a 22)": "lavadero",
    "RACK TV - DORM IZQ": "rack",
    "REVESTIMIENTO PASILLO SUITE": "revestimiento",
    "RESPALDO + MESAS DE LUZ": "dormitorio",
    "ESCRITORIO HALL": "escritorio",
    "RECEPCIÓN ADMINISTRACIÓN": "comercial",
    "VESTIDOR SUITE": "vestidor",
    "VAJILLERO COMEDOR": "otros",
  };
  for (const [d, t] of Object.entries(casos)) assert.equal(tipoAutomatico(d), t, d);
  assert.equal(tipoAutomatico(""), null);
  assert.equal(tipoAutomatico(null), null);
});

test("tipoDeOt — el elegido a mano gana; uno que no existe vuelve al automático", () => {
  assert.deepEqual(tipoDeOt({ descripcion: "COCINA", tipo_proyecto: "placard" }), { id: "placard", manual: true });
  assert.deepEqual(tipoDeOt({ descripcion: "COCINA", tipo_proyecto: null }), { id: "cocina", manual: false });
  assert.deepEqual(tipoDeOt({ descripcion: "COCINA", tipo_proyecto: "xx" }), { id: "cocina", manual: false });
  assert.deepEqual(stripUnallowedFields({ tipo_proyecto: "rack" }, "proyectos", "PATCH"), { tipo_proyecto: "rack" });
});

test("normalizarParametros — cada tipo viene con los valores del estudio; el % solo falta en modo %", () => {
  const p = normalizarParametros(null);
  assert.equal(p.modo_mecanizado, "tipo");
  assert.deepEqual(p.por_tipo.rack, { mec: 7.4, gab: 1.18 });
  assert.deepEqual(p.por_tipo.cocina, { mec: 2.6, gab: 1.47 });
  assert.deepEqual(p.por_tipo.global, { mec: 2.7, gab: 1.31 });
  assert.equal(Object.keys(p.por_tipo).length, TIPOS_PROYECTO.length + 1);
  assert.ok(!parametrosFaltantes(p).includes("Placas que se mecanizan"));
  assert.ok(parametrosFaltantes({ ...p, modo_mecanizado: "porcentaje" }).includes("Placas que se mecanizan"));
  // Lo cargado gana; lo inválido vuelve al valor del estudio
  const q = normalizarParametros({ por_tipo: { rack: { mec: "8,5", gab: -1 } } });
  assert.deepEqual(q.por_tipo.rack, { mec: 8.5, gab: 1.18 });
  assert.deepEqual(relacionesTipo(q, null), { mec: 2.7, gab: 1.31 });
});

test("horasOt — mecanizados por tipo, con el switch en %, y MECANIZADOS de la planilla", () => {
  const base = { min_placa: 0, min_metro_canto: 0, min_mecanizado: 2, min_armado_gabinete: 60, eficiencia: 100, pct_mecanizado: 50 };
  const rack = { ot: "1", descripcion: "RACK TV", placas: 10 };
  const porTipo = horasOt(rack, normalizarParametros(base));
  assert.equal(porTipo.tipo, "rack");
  assert.equal(Math.round(porTipo.mecanizados * 10) / 10, 74);
  assert.equal(Math.round(porTipo.etapas.mecanizado.gente * 100) / 100, Math.round(74 * 2 / 60 * 100) / 100);
  const pct = horasOt(rack, normalizarParametros({ ...base, modo_mecanizado: "porcentaje" }));
  assert.equal(Math.round(pct.mecanizados * 10) / 10, 37);
  const planilla = horasOt({ ...rack, placas_mecanizadas: 20 }, normalizarParametros({ ...base, modo_mecanizado: "porcentaje" }));
  assert.equal(planilla.mecanizados, 20);
  assert.equal(planilla.origenMecanizados, "planilla");
  // Gabinetes por placa del tipo, si la OT no tiene módulos
  const placard = horasOt({ ot: "2", descripcion: "PLACARD", placas: 10 }, normalizarParametros(base));
  assert.equal(Math.round(placard.gabinetes * 10) / 10, 6.9);
  assert.equal(horasOt({ ot: "3", descripcion: "PLACARD", tipo_proyecto: "bano", placas: 10 }, normalizarParametros(base)).gabinetes, 29.5);
});

// ─── Pantallas ───

const DIVISIONES = [{ id: "d-m", clave: "MUE", label: "Muebles" }];

function mockData({ proyectos = [], cfg = [], falla139 = false } = {}) {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("/api/planificacion")) return new Response(JSON.stringify({ ok: true, plan: null }), { status: 200 });
    const body = opts?.body ? JSON.parse(opts.body) : {};
    pedidos.push(body);
    const path = body.path || "";
    const lista = (data) => new Response(JSON.stringify({ data: path.includes("offset=0") || !path.includes("offset=") ? data : [] }), { status: 200 });
    if (body.method === "PATCH" && path.startsWith("proyectos") && falla139) {
      return new Response(JSON.stringify({ error: "column \"tipo_proyecto\" of relation \"proyectos\" does not exist" }), { status: 400 });
    }
    if (body.method === "GET" && path.startsWith("proyectos")) return lista(proyectos);
    if (body.method === "GET" && path.startsWith("config_sistema") && path.includes("clave=eq.planificacion")) return lista(cfg);
    return lista([]);
  };
  return pedidos;
}

const pantalla = () => render(
  <AuthContext.Provider value={{ divisiones: DIVISIONES, etapas: [], usuario: { rol: "gerencial" } }}>
    <PlanificacionScreen empresaId="emp-1" />
  </AuthContext.Provider>
);

test("⚙ Parámetros — switch del cálculo de mecanizados y tabla por tipo", async () => {
  const pedidos = mockData();
  pantalla();
  fireEvent.click(await screen.findByText("⚙ Parámetros"));
  const form = await screen.findByRole("region", { name: "Parámetros de la planificación" });
  assert.equal(within(form).queryByLabelText(/^Placas que se mecanizan/), null);
  assert.equal(within(form).getByLabelText("Mecanizados por placa de Rack TV / living").value, "7,4");
  fireEvent.click(within(form).getByText("% de placas × mecanizados por placa"));
  assert.ok(within(form).getByLabelText(/^Placas que se mecanizan/));
  fireEvent.change(within(form).getByLabelText("Mecanizados por placa de Cocina"), { target: { value: "3,5" } });
  fireEvent.click(screen.getByText("Guardar parámetros"));
  await waitFor(() => assert.ok(pedidos.some((p) => p.method === "POST" && p.path === "config_sistema")));
  const valor = pedidos.find((p) => p.method === "POST" && p.path === "config_sistema").body.valor;
  assert.equal(valor.modo_mecanizado, "porcentaje");
  assert.equal(valor.por_tipo.cocina.mec, 3.5);
  assert.equal(valor.por_tipo.rack.mec, 7.4);
});

test("⚙ Parámetros — un valor vacío o mal escrito en la tabla no deja guardar", async () => {
  mockData();
  pantalla();
  fireEvent.click(await screen.findByText("⚙ Parámetros"));
  const form = await screen.findByRole("region", { name: "Parámetros de la planificación" });
  fireEvent.change(within(form).getByLabelText("Gabinetes por placa de Placard"), { target: { value: "" } });
  assert.ok(within(form).getByText(/Gabinetes por placa: falta el número/));
  assert.equal(screen.getByText("Guardar parámetros").closest("button").disabled, true);
});

test("📊 Carga — el tipo viene de la descripción y se cambia a mano", async () => {
  const pedidos = mockData({ proyectos: [{ id: 7, ot: "M-7637", cliente: "Rinaudo", descripcion: "COCINA + ISLA", division: "Muebles", estado: "activo", placas: 7 }] });
  pantalla();
  const tipo = await screen.findByLabelText("Tipo de proyecto de la OT M-7637");
  assert.equal(tipo.selectedOptions[0].textContent, "Cocina (automático)");
  fireEvent.change(tipo, { target: { value: "rack" } });
  await waitFor(() => assert.ok(pedidos.some((p) => p.method === "PATCH" && p.path === "proyectos?id=eq.7" && p.body.tipo_proyecto === "rack")));
  await waitFor(() => assert.equal(screen.getByLabelText("Tipo de proyecto de la OT M-7637").value, "rack"));
});

test("📊 Carga — sin la migración 139 avisa al cambiar el tipo", async () => {
  mockData({ proyectos: [{ id: 7, ot: "M-7637", descripcion: "COCINA", division: "Muebles", estado: "activo" }], falla139: true });
  pantalla();
  fireEvent.change(await screen.findByLabelText("Tipo de proyecto de la OT M-7637"), { target: { value: "rack" } });
  assert.ok(await screen.findByText(/falta correr la migración 139/));
});
