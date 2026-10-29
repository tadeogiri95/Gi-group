// tests/ajustes-tiempo.test.jsx — "⏱ Faltan X h" por proceso y motivo de cada
// corrimiento (Tadeo, 29/10; migración 145; app/lib/ajustesTiempo.js).
import "./helpers/domSetup.js";
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { validarAjuste, faltanManual, horasManuales, atrasosSinMotivo, textoMotivo, MOTIVOS_TIEMPO } from "../app/lib/ajustesTiempo.js";
import { planVivo, ultimaConfirmacion } from "../app/lib/ganttPlan.js";
import { autorizar, prepararBodyPost } from "../app/lib/dataPolicy.js";

const { default: GanttOt } = await import("../app/components/GanttOt.jsx");

const sinRed = async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
global.fetch = sinRed;
afterEach(() => { cleanup(); global.fetch = sinRed; mock.timers.reset(); });

// Con la fecha fija, findBy/waitFor no avanzan: se deja terminar lo pendiente a mano
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); });

const AJUSTE = { ot: "7100", etapa: "corte", tipo: "faltan", horas: 3, motivo: "falla_maquina", detalle: null, pendiente: 0.5, dias: 2 };

test("motivos — los seis que pidió Tadeo, y Otros con su renglón", () => {
  assert.deepEqual(MOTIVOS_TIEMPO.map((m) => m.label), ["Falta de material", "Falla de máquina", "Corte de electricidad", "Tiempo de planificación subestimado", "Interrupción del trabajo", "Otros"]);
  assert.equal(textoMotivo({ motivo: "otros", detalle: "Faltó el chofer" }), "Otros: Faltó el chofer");
  assert.equal(textoMotivo({ motivo: "falta_material" }), "Falta de material");
});

test("validarAjuste — el motivo es obligatorio; Otros pide el renglón; Faltan pide las horas", () => {
  assert.equal(validarAjuste(AJUSTE), null);
  assert.equal(validarAjuste({ ...AJUSTE, motivo: null }), "Elegí el motivo");
  assert.equal(validarAjuste({ ...AJUSTE, motivo: "otros", detalle: "  " }), "Escribí cuál es el motivo");
  assert.equal(validarAjuste({ ...AJUSTE, motivo: "otros", detalle: "Lluvia" }), null);
  assert.equal(validarAjuste({ ...AJUSTE, horas: NaN }), "Escribí cuántas horas faltan");
  assert.equal(validarAjuste({ ...AJUSTE, tipo: "corrimiento", horas: null }), null);
  assert.equal(validarAjuste({ ...AJUSTE, etapa: "pintura" }), "Proceso inválido");
});

test("faltanManual — manda el último; baja en la misma proporción que lo escaneado", () => {
  const m = faltanManual([
    { ...AJUSTE, horas: 3, created_at: "2026-10-26T10:00:00Z" },
    { ...AJUSTE, horas: 5, created_at: "2026-10-27T10:00:00Z" },
    { ...AJUSTE, tipo: "corrimiento", horas: null, created_at: "2026-10-28T10:00:00Z" },
  ]);
  assert.deepEqual(m.get("7100|corte"), { horas: 5, pendiente: 0.5 });
  assert.equal(horasManuales(m.get("7100|corte"), 0.5), 5);
  assert.equal(horasManuales(m.get("7100|corte"), 0.25), 2.5, "se escaneó la mitad de lo que faltaba");
  assert.equal(horasManuales({ horas: 4, pendiente: null }, 0.3), 4, "sin escaneo manda lo cargado");
});

test("atrasosSinMotivo — corridos sin un motivo que cubra esos días desde que se confirmó el plan", () => {
  const vivo = new Map([
    ["7100", { ot: "7100", procesos: [{ etapa: "corte", nombre: "Corte", diasCorrido: 3 }, { etapa: "armado", nombre: "Armado", diasCorrido: 0 }] }],
    ["7200", { ot: "7200", procesos: [{ etapa: "canteado", nombre: "Canteado", diasCorrido: 5 }] }],
  ]);
  assert.deepEqual(atrasosSinMotivo(vivo, []).map((a) => `${a.ot} ${a.etapa} ${a.dias}`), ["7200 canteado 5", "7100 corte 3"]);
  const ajustes = [
    { ot: "7100", etapa: "corte", tipo: "corrimiento", dias: 3, created_at: "2026-10-27T10:00:00Z" },
    { ot: "7200", etapa: "canteado", tipo: "corrimiento", dias: 2, created_at: "2026-10-27T10:00:00Z" },
  ];
  assert.deepEqual(atrasosSinMotivo(vivo, ajustes).map((a) => a.ot), ["7200"], "se corrió más que lo anotado: vuelve a pedirlo");
  assert.deepEqual(atrasosSinMotivo(vivo, ajustes, "2026-10-28T00:00:00Z").map((a) => a.ot), ["7200", "7100"], "lo anotado antes de confirmar no cuenta");
  assert.equal(ultimaConfirmacion([{ confirmado_at: "2026-10-20T10:00:00Z" }, { confirmado_at: "2026-10-25T10:00:00Z" }, { confirmado_at: "9999" }]), "2026-10-25T10:00:00Z");
});

test("planVivo — el Faltan X h manda sobre el cálculo hasta que el proceso termina", () => {
  const items = [{ ot: "A", etapa: "corte", fecha: "2026-10-26", horas: 8, orden: 0 }, { ot: "A", etapa: "armado", fecha: "2026-10-27", horas: 4, orden: 0 }];
  const base = { proyectos: new Map([["A", { ot: "A" }]]), etapasCodigo: { corte: 1, armado: 4 }, hoy: "2026-10-26" };
  const sin = planVivo(items, base).get("A").procesos.find((q) => q.etapa === "corte");
  assert.equal(sin.horas, 8);
  assert.equal(sin.manual, false);
  const con = planVivo(items, { ...base, manual: new Map([["A|corte", { horas: 20, pendiente: null }]]) }).get("A");
  const corte = con.procesos.find((q) => q.etapa === "corte");
  assert.equal(corte.horas, 20);
  assert.equal(corte.manual, true);
  assert.ok(con.procesos.find((q) => q.etapa === "armado").desde > sin.hasta, "lo que viene detrás se corre");
  // Terminado: ya no manda
  const hecho = planVivo(items, { ...base, piezas: [{ ot: "A", etapa: 1, total: 10, pasaron: 10, primer_paso: "2026-10-26T12:00:00Z", ultimo_paso: "2026-10-26T15:00:00Z" }], manual: new Map([["A|corte", { horas: 20, pendiente: null }]]) });
  assert.equal(hecho.get("A").procesos.find((q) => q.etapa === "corte").completo, true);
});

test("/api/data — lo cargan gerencia, supervisores y administración; quién lo cargó sale de la sesión", () => {
  assert.equal(autorizar("ajustes_tiempo_ot", "POST", { rol: "gerencial" }).ok, true);
  assert.equal(autorizar("ajustes_tiempo_ot", "POST", { rol: "administrativo" }).ok, true);
  assert.equal(autorizar("ajustes_tiempo_ot", "POST", { rol: "operativo" }).ok, false);
  assert.equal(autorizar("ajustes_tiempo_ot", "PATCH", { rol: "gerencial" }).ok, false, "no se editan");
  assert.equal(autorizar("ajustes_tiempo_ot", "DELETE", { rol: "gerencial" }).ok, false, "no se borran");
  const r = prepararBodyPost("ajustes_tiempo_ot", { ...AJUSTE, creado_por: "otro" }, { rol: "administrativo", empleado_id: "e-1" }, null);
  assert.equal(r.body.creado_por, "e-1");
  assert.equal(prepararBodyPost("ajustes_tiempo_ot", { ...AJUSTE, motivo: "otros" }, { rol: "gerencial" }, null).status, 400);
  assert.match(readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8"), /"ajustes_tiempo_ot"/, "en TABLAS_PERMITIDAS");
  const sql = readFileSync(new URL("../supabase/migrations/145_ajustes_tiempo_ot.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /enable row level security/);
});

// Hoy = lunes 26/10/2026: el Corte de la 7100 no se hizo y se corrió 7 días
const PLAN = [{
  id: 1, tipo: "semana", desde: "2026-10-12", hasta: "2026-11-30", confirmado_at: "2026-10-18T12:00:00Z", items: [
    { ot: "7100", etapa: "corte", fecha: "2026-10-19", horas: 6, orden: 0 },
    { ot: "7100", etapa: "corte", fecha: "2026-10-20", horas: 6, orden: 0 },
    { ot: "7100", etapa: "armado", fecha: "2026-10-30", horas: 6, orden: 0 },
  ],
}];
const ETAPAS = [{ codigo: 1, nombre: "Corte" }, { codigo: 2, nombre: "Canteado" }, { codigo: 3, nombre: "Mecanizado CNC" }, { codigo: 4, nombre: "Armado" }];
const DIV = [{ id: "M", label: "Muebles", ruta_etapas: [1, 2, 3, 4] }];
const PROYECTOS = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo", fecha_objetivo: "2026-10-31" }];

function conApi(guardados) {
  global.fetch = async (url, opts = {}) => {
    const { method, path, body } = JSON.parse(opts.body || "{}");
    if (method === "POST" && path === "ajustes_tiempo_ot") { guardados.push(body); return new Response(JSON.stringify({ data: [body] }), { status: 200 }); }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
}

test("📅 Gantt — 📝 Atrasos sin motivo: se anota por qué se corrió y sale de la lista", async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-26T15:00:00Z") });
  const guardados = [];
  conApi(guardados);
  render(<GanttOt proyectos={PROYECTOS} divisiones={DIV} etapas={ETAPAS} planes={PLAN} cfgValor={null} puedeAjustar usuarioNombre="Tadeo"
    avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  await esperar();
  const lista = screen.getByRole("group", { name: "Atrasos sin motivo" });
  assert.match(lista.textContent, /7100 · Corte · ↪ se corrió 7 días/);
  fireEvent.click(within(lista).getByRole("button", { name: "Anotar por qué se corrió Corte de la OT 7100" }));
  const dialogo = screen.getByRole("dialog", { name: "⏱ Corte de la OT 7100" });
  assert.ok(!within(dialogo).queryByLabelText("Faltan (horas)"), "solo el motivo");
  fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
  assert.equal(within(dialogo).getByRole("alert").textContent, "Elegí el motivo", "el motivo es obligatorio");
  fireEvent.click(within(dialogo).getByRole("radio", { name: "Otros" }));
  fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
  assert.equal(within(dialogo).getByRole("alert").textContent, "Escribí cuál es el motivo");
  fireEvent.change(within(dialogo).getByLabelText("¿Cuál?"), { target: { value: "Faltó el operario" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
  await esperar();
  assert.ok(!screen.queryByRole("dialog"), "se cierra al guardar");
  assert.equal(guardados.length, 1);
  assert.deepEqual({ ...guardados[0] }, { ot: "7100", etapa: "corte", tipo: "corrimiento", motivo: "otros", detalle: "Faltó el operario", horas: null, pendiente: 1, dias: 7, creado_nombre: "Tadeo" });
  assert.ok(!screen.queryByRole("group", { name: "Atrasos sin motivo" }), "ya tiene motivo");
});

test("📅 Gantt — ⏱ Faltan X h: se toca el proceso, se escriben las horas y el motivo, y el Gantt se corre", async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-26T15:00:00Z") });
  const guardados = [];
  conApi(guardados);
  const { container } = render(<GanttOt proyectos={PROYECTOS} divisiones={DIV} etapas={ETAPAS} planes={PLAN} cfgValor={null} puedeAjustar
    avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  await esperar();
  assert.ok(screen.getByRole("group", { name: "Atrasos sin motivo" }));
  fireEvent.click(screen.getByRole("button", { name: "⏱ Corte de la OT 7100: cuánto falta" }));
  const dialogo = screen.getByRole("dialog", { name: "⏱ Corte de la OT 7100" });
  assert.equal(within(dialogo).getByLabelText("Faltan (horas)").value, "12", "arranca con lo que calcula el plan");
  fireEvent.change(within(dialogo).getByLabelText("Faltan (horas)"), { target: { value: "30" } });
  fireEvent.click(within(dialogo).getByRole("radio", { name: "Falla de máquina" }));
  fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
  await esperar();
  assert.ok(!screen.queryByRole("dialog"), "se cierra al guardar");
  assert.equal(guardados[0].tipo, "faltan");
  assert.equal(guardados[0].horas, 30);
  assert.equal(guardados[0].motivo, "falla_maquina");
  assert.ok(guardados[0].dias > 7, `con 30 h se corre más: ${guardados[0].dias}`);
  const textos = [...container.querySelectorAll('[data-ot="7100"] svg text')].map((t) => t.textContent);
  assert.ok(textos.some((t) => /^30 h ⏱/.test(t)), textos.join(" | "));
  assert.ok(!screen.queryByRole("group", { name: "Atrasos sin motivo" }), "el motivo cubre lo que se corrió");
});

test("📅 Gantt — sin permiso (operario o jefe sin gestión) no se puede tocar", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-26T15:00:00Z") });
  render(<GanttOt proyectos={PROYECTOS} divisiones={DIV} etapas={ETAPAS} planes={PLAN} cfgValor={null}
    avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  assert.ok(!screen.queryByRole("button", { name: /cuánto falta/ }));
  assert.ok(!screen.queryByRole("group", { name: "Atrasos sin motivo" }));
});
