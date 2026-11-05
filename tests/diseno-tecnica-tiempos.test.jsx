// tests/diseno-tecnica-tiempos.test.jsx — Diseño y Técnica, parte 47
// (migración 160; app/lib/disenoTecnicaPlan.js): días de Diseño por defecto,
// tabla de horas de Técnica por tipo × clase, arquitectas con su % y la
// corrección a mano en el Detalle de la OT.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { normalizarParametros, normalizarDisenoTecnica, DIAS_DISENO_DEFECTO, HORAS_DIA_DEFECTO } from "../app/lib/planificacion.js";
import { tiemposOt, cuerpoTiempos, horasDeTabla, errorDisenoTecnica, textoDiasHabiles } from "../app/lib/disenoTecnicaPlan.js";
import { validarPatch } from "../app/lib/dataPolicy.js";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { default: PlanificacionScreen } = await import("../app/components/PlanificacionScreen.jsx");
const { default: DisenoTecnicaOt, textoTiempos } = await import("../app/components/DisenoTecnicaOt.jsx");

const sinRed = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
global.fetch = sinRed;
afterEach(() => { cleanup(); localStorage.clear(); global.fetch = sinRed; });
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); });

test("normalizarDisenoTecnica — sin cargar: 10 días de Diseño, 9 h de jornada, tabla vacía y sin arquitectas", () => {
  const dt = normalizarDisenoTecnica(null);
  assert.equal(dt.dias_diseno, DIAS_DISENO_DEFECTO);
  assert.equal(DIAS_DISENO_DEFECTO, 10);
  assert.equal(dt.horas_dia, HORAS_DIA_DEFECTO);
  assert.equal(HORAS_DIA_DEFECTO, 9);
  assert.deepEqual(dt.horas.cocina, { A: null, B: null, C: null });
  assert.deepEqual(dt.horas.global, { A: null, B: null, C: null });
  assert.deepEqual(dt.arquitectas, []);
  assert.deepEqual(normalizarParametros(null).diseno_tecnica, dt, "viaja dentro de la config de planificación");
});

test("normalizarDisenoTecnica — limpia lo inválido y las arquitectas repetidas", () => {
  const dt = normalizarDisenoTecnica({
    dias_diseno: "7,5", horas_dia: 0,
    horas: { cocina: { A: "40", B: 20.5, C: -1 }, placard: { A: 2.3 } },
    arquitectas: [{ id: "e1", pct_tecnica: 100 }, { id: "e1", pct_tecnica: 0 }, { id: "e2", pct_tecnica: "85" }, { id: "e3", pct_tecnica: 120 }, { id: "", pct_tecnica: 50 }],
  });
  assert.equal(dt.dias_diseno, 7.5);
  assert.equal(dt.horas_dia, 9);
  assert.deepEqual(dt.horas.cocina, { A: 40, B: 20.5, C: null });
  assert.equal(dt.horas.placard.A, null, "de a media hora");
  assert.deepEqual(dt.arquitectas, [{ id: "e1", pct_tecnica: 100 }, { id: "e2", pct_tecnica: 85 }]);
});

test("tiemposOt — Diseño fijo, Técnica de la tabla según tipo y clase, y lo cargado a mano manda", () => {
  const dt = normalizarDisenoTecnica({ horas: { cocina: { A: 40, B: 20 }, global: { C: 6 } } });
  const cocinaA = tiemposOt({ descripcion: "COCINA", clase_auto: "A" }, dt);
  assert.equal(cocinaA.diasDiseno, 10);
  assert.equal(cocinaA.horasTecnica, 40);
  assert.equal(cocinaA.diasTecnica, 4.5, "40 h ÷ 9 h = 4,4 → de a medio día");
  assert.equal(cocinaA.sinDato, null);
  assert.equal(tiemposOt({ descripcion: "COCINA", clase_auto: "C" }, dt).horasTecnica, 6, "vacío en el tipo = Sin tipo");
  const sinHoras = tiemposOt({ descripcion: "PLACARD" }, dt);
  assert.equal(sinHoras.clase, "B");
  assert.equal(sinHoras.horasTecnica, null);
  assert.match(sinHoras.sinDato, /clase B/);
  const manual = tiemposOt({ descripcion: "COCINA", clase_auto: "A", dias_diseno: "3", horas_tecnica: 12.5 }, dt);
  assert.equal(manual.diasDiseno, 3);
  assert.equal(manual.diasManual, true);
  assert.equal(manual.horasTecnica, 12.5);
  assert.equal(manual.horasManual, true);
  assert.equal(horasDeTabla(dt, null, "C"), 6);
  assert.match(textoTiempos(cocinaA), /^Diseño: 10 días hábiles\. Técnica: 40 h \(Cocina, clase A\) = 4,5 días hábiles de una arquitecta\.$/);
  assert.match(textoTiempos(manual), /Diseño: 3 días hábiles \(a mano\)\. Técnica: 12,5 h \(a mano\)/);
  assert.equal(textoDiasHabiles(1), "1 día hábil");
});

test("cuerpoTiempos y validarPatch — de a medio día y media hora; vacío vuelve a automático", () => {
  assert.deepEqual(cuerpoTiempos({ dias: "", horas: "" }).cuerpo, { dias_diseno: null, horas_tecnica: null });
  assert.deepEqual(cuerpoTiempos({ dias: "2,5", horas: "30" }).cuerpo, { dias_diseno: 2.5, horas_tecnica: 30 });
  assert.equal(cuerpoTiempos({ dias: "2,3", horas: "" }).cuerpo, null);
  assert.match(cuerpoTiempos({ dias: "abc", horas: "" }).errores.dias, /solo el número/);
  assert.match(errorDisenoTecnica("horas_tecnica", 2000), /Entre 0,5 y 1000/);
  assert.equal(validarPatch("proyectos", { dias_diseno: 2.5, horas_tecnica: 30 }), null);
  assert.equal(validarPatch("proyectos", { dias_diseno: null, horas_tecnica: null }), null);
  assert.equal(validarPatch("proyectos", { dias_diseno: 0.3 })?.status, 400);
  assert.equal(validarPatch("proyectos", { horas_tecnica: "20" })?.status, 400);
});

test("migración 160 — columnas registradas y SQL en un solo bloque", () => {
  const m = MIGRACIONES.find((x) => x.n === 160);
  assert.deepEqual(m.tablas.proyectos, ["dias_diseno", "horas_tecnica"]);
  const sql = readFileSync(new URL("../supabase/migrations/160_diseno_tecnica_tiempos.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /add column if not exists dias_diseno/);
  assert.match(sql, /add column if not exists horas_tecnica/);
});

// ─── ⚙ Parámetros → 📐 Diseño y Técnica ─────────────────────────────────────

const DIVISIONES = [{ id: "d-m", clave: "MUE", label: "Muebles", ruta_etapas: [1] }];
const ETAPAS = [{ codigo: 1, nombre: "Corte" }];
const EMPLEADOS = [{ id: 11, nombre: "Georgina Rossi" }, { id: 12, nombre: "María José Torres" }, { id: 13, nombre: "Sofía Scarafiocca" }];

function mockData(cfg = []) {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    pedidos.push(body);
    const path = body.path || "";
    if (body.method === "GET" && path.startsWith("config_sistema")) return new Response(JSON.stringify({ data: cfg }), { status: 200 });
    if (body.method === "GET" && path.startsWith("empleados")) return new Response(JSON.stringify({ data: path.includes("offset=0") ? EMPLEADOS : [] }), { status: 200 });
    return new Response(JSON.stringify({ data: path.includes("offset=") ? [] : null }), { status: 200 });
  };
  return pedidos;
}

test("⚙ Parámetros — 📐 Diseño y Técnica: días, tabla tipo × clase y arquitectas con su %", async () => {
  const pedidos = mockData([]);
  render(
    <AuthContext.Provider value={{ divisiones: DIVISIONES, etapas: ETAPAS, usuario: { rol: "gerencial" } }}>
      <PlanificacionScreen empresaId="emp-1" />
    </AuthContext.Provider>
  );
  fireEvent.click(await screen.findByText("⚙ Parámetros"));
  const card = await screen.findByRole("region", { name: "Parámetros de Diseño y Técnica" }).catch(() => screen.getByLabelText("Parámetros de Diseño y Técnica"));
  assert.equal(within(card).getByLabelText(/^Días de Diseño/).value, "10");
  assert.equal(within(card).getByLabelText(/^Jornada/).value, "9");
  fireEvent.change(within(card).getByLabelText("Horas de Técnica de Cocina clase A"), { target: { value: "40" } });
  fireEvent.change(within(card).getByLabelText("Horas de Técnica de Cocina clase B"), { target: { value: "2,3" } });
  assert.ok(within(card).getByText(/B: De a media unidad/));
  assert.equal(screen.getByText("Guardar parámetros").disabled, true);
  fireEvent.change(within(card).getByLabelText("Horas de Técnica de Cocina clase B"), { target: { value: "20,5" } });
  await waitFor(() => assert.ok(within(card).getByRole("option", { name: "Sofía Scarafiocca" })));
  fireEvent.change(within(card).getByLabelText("Elegir arquitecta"), { target: { value: "13" } });
  fireEvent.click(within(card).getByText("➕ Agregar"));
  fireEvent.change(within(card).getByLabelText("% de Técnica de Sofía Scarafiocca"), { target: { value: "85" } });
  assert.ok(within(card).getByText("% Técnica · 15 % Diseño"));
  assert.equal(within(card).queryByRole("option", { name: "Sofía Scarafiocca" }), null, "ya elegida");
  fireEvent.click(screen.getByText("Guardar parámetros"));
  await screen.findByText("✅ Parámetros guardados");
  const post = pedidos.find((p) => p.method === "POST" && p.path === "config_sistema");
  assert.equal(post.body.valor.diseno_tecnica.dias_diseno, 10);
  assert.deepEqual(post.body.valor.diseno_tecnica.horas.cocina, { A: 40, B: 20.5, C: null });
  assert.deepEqual(post.body.valor.diseno_tecnica.arquitectas, [{ id: "13", pct_tecnica: 85 }]);
});

// ─── Detalle de la OT ───────────────────────────────────────────────────────

test("Detalle OT — muestra los tiempos y gestión los corrige a mano", async () => {
  const patches = [];
  global.fetch = async (url, opts = {}) => {
    const { method, path, body } = JSON.parse(opts.body || "{}");
    if (method === "PATCH") { patches.push({ path, body }); return new Response(JSON.stringify({ data: [] }), { status: 200 }); }
    if (String(path).startsWith("config_sistema")) {
      return new Response(JSON.stringify({ data: [{ valor: { diseno_tecnica: { horas: { cocina: { B: 18 } } } } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  let guardado = null;
  render(<DisenoTecnicaOt proyecto={{ id: 5, ot: "M-7900", descripcion: "COCINA", clase_auto: "B" }} empresaId="e1" puedeEditar onGuardado={(v) => { guardado = v; }} />);
  await esperar();
  const tiempos = screen.getByLabelText("Tiempos de Diseño y Técnica");
  assert.match(tiempos.textContent, /Diseño: 10 días hábiles\. Técnica: 18 h \(Cocina, clase B\) = 2 días hábiles/);
  fireEvent.click(screen.getByText("✏ Corregir tiempos"));
  fireEvent.change(screen.getByLabelText("Días hábiles de Diseño"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Horas de Técnica"), { target: { value: "24,5" } });
  fireEvent.click(screen.getByText("Guardar"));
  await esperar();
  assert.deepEqual(patches[0], { path: "proyectos?id=eq.5", body: { dias_diseno: 5, horas_tecnica: 24.5 } });
  assert.deepEqual(guardado, { id: 5, dias_diseno: 5, horas_tecnica: 24.5 });
  assert.match(tiempos.textContent, /Diseño: 5 días hábiles \(a mano\)\. Técnica: 24,5 h \(a mano\)/);
  fireEvent.click(screen.getByText("↺ Volver a automático"));
  await esperar();
  assert.deepEqual(patches[1].body, { dias_diseno: null, horas_tecnica: null });
});

test("Detalle OT — sin la migración 160 avisa qué falta; sin permiso no hay botones", async () => {
  global.fetch = async (url, opts = {}) => {
    const { method } = JSON.parse(opts.body || "{}");
    if (method === "PATCH") return new Response(JSON.stringify({ error: 'column "dias_diseno" does not exist' }), { status: 400 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  render(<DisenoTecnicaOt proyecto={{ id: 5, ot: "M-1", descripcion: "PLACARD" }} empresaId="e1" puedeEditar />);
  await esperar();
  assert.match(screen.getByLabelText("Tiempos de Diseño y Técnica").textContent, /Falta cargar las horas de Técnica de la clase B/);
  fireEvent.click(screen.getByText("✏ Corregir tiempos"));
  fireEvent.change(screen.getByLabelText("Días hábiles de Diseño"), { target: { value: "5" } });
  fireEvent.click(screen.getByText("Guardar"));
  await esperar();
  assert.match(screen.getByRole("alert").textContent, /migración 160/);
  cleanup();
  render(<DisenoTecnicaOt proyecto={{ id: 5, ot: "M-1", descripcion: "PLACARD" }} empresaId="e1" />);
  await esperar();
  assert.equal(screen.queryByText("✏ Corregir tiempos"), null);
});
