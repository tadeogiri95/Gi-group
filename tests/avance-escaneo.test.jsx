// tests/avance-escaneo.test.jsx — Seguimiento de OT por escaneo, parte 25:
// % de avance de producción por etapa y por OT contando piezas escaneadas
// (vista v_avance_piezas, migración 118). Un escaneo cuenta como etapa en curso.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { pct, porcentajeOt, avancePorOt, clavesEscaneadas, avancePiezas } from "../app/lib/piezas.js";
import { autorizar } from "../app/lib/dataPolicy.js";

afterEach(() => cleanup());

const { default: TableroOt } = await import("../app/components/TableroOt.jsx");
const { default: DetalleOp } = await import("../app/components/DetalleOp.jsx");
const { leerAvanceYHoras } = await import("../app/lib/otEnCursoDatos.js");

const E = "11111111-1111-1111-1111-111111111111";
const ETAPAS = [
  { codigo: 1, nombre: "Corte", icon: "✂️", orden: 1, por_pieza: true },
  { codigo: 2, nombre: "Canteado", icon: "📏", orden: 2, por_pieza: true },
  { codigo: 3, nombre: "Armado", icon: "🔧", orden: 3 },
];

// ─── Cuentas ───

test("pct — redondea para abajo: 100% solo cuando pasaron todas", () => {
  assert.equal(pct(0, 10), 0);
  assert.equal(pct(5, 10), 50);
  assert.equal(pct(199, 200), 99);
  assert.equal(pct(200, 200), 100);
  assert.equal(pct(3, 2), 100, "no pasa de 100");
  assert.equal(pct(0, 0), null);
});

test("porcentajeOt — cuenta piezas: suma escaneadas sobre suma total de las etapas", () => {
  // Corte 100 de 100, Canto 0 de 20 → 100 / 120 = 83%
  assert.equal(porcentajeOt([{ codigo: 1, total: 100, pasaron: 100 }, { codigo: 2, total: 20, pasaron: 0 }]), 83);
  assert.equal(porcentajeOt([]), null);
});

test("avancePorOt — agrupa la vista por OT en el orden de las etapas", () => {
  const m = avancePorOt([
    { ot: "7495", etapa: 2, total: 50, pasaron: 10 },
    { ot: "7495", etapa: 1, total: 50, pasaron: 50 },
    { ot: "7858", etapa: 1, total: 8, pasaron: 0 },
    { ot: "7859", etapa: 1, total: 0, pasaron: 0 },
  ], [1, 2]);
  assert.deepEqual(m.get("7495"), {
    porcentaje: 60,
    etapas: [{ codigo: 1, total: 50, pasaron: 50, porcentaje: 100 }, { codigo: 2, total: 50, pasaron: 10, porcentaje: 20 }],
  });
  assert.equal(m.get("7858").porcentaje, 0);
  assert.equal(m.has("7859"), false, "sin piezas no hay %");
});

test("clavesEscaneadas — solo las etapas con algún escaneo", () => {
  assert.deepEqual(clavesEscaneadas([{ ot: "7495", etapa: 1, pasaron: 3 }, { ot: "7495", etapa: 2, pasaron: 0 }]), ["7495|1"]);
});

test("la vista y el detalle cuentan igual: un escaneo de una etapa que la pieza no lleva no suma", () => {
  const piezas = [{ id: 1, etapas: [1, 2] }, { id: 2, etapas: [1] }];
  const a = avancePiezas(piezas, [{ pieza_id: 1, etapa: 1 }, { pieza_id: 2, etapa: 2 }], [1, 2]);
  assert.equal(porcentajeOt(a), 33);
});

// ─── Migración y permisos ───

test("118 — vista con security_invoker, solo lectura para authenticated y sin anon", () => {
  const sql = readFileSync(new URL("../supabase/migrations/118_v_avance_piezas.sql", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();
  assert.match(sql, /create or replace view public\.v_avance_piezas\s+with \(security_invoker = true\)/);
  assert.match(sql, /grant select on public\.v_avance_piezas to authenticated/);
  assert.ok(!/grant[^;]*to\s+anon/.test(sql));
  assert.match(sql, /s\.etapa = e\.etapa/, "solo cuentan escaneos de etapas que la pieza lleva");
});

test("v_avance_piezas — se lee por /api/data y no se escribe", () => {
  assert.equal(autorizar("v_avance_piezas", "GET", { rol: "empleado" }).ok, true);
  assert.equal(autorizar("v_avance_piezas", "POST", { rol: "admin" }).ok, false);
  const route = readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8");
  assert.match(route, /TABLAS_SOLO_LECTURA = \[[^\]]*"v_avance_piezas"/);
});

// ─── Pantallas ───

function mockData(rutas) {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    const path = body?.path || "";
    pedidos.push(path);
    for (const [prefijo, data] of Object.entries(rutas)) {
      if (path.startsWith(prefijo)) return new Response(JSON.stringify({ data: path.includes("offset=0") ? data : [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return pedidos;
}

test("leerAvanceYHoras — una etapa con piezas escaneadas cuenta como en curso", async () => {
  const pedidos = mockData({ v_avance_piezas: [{ ot: "7495", etapa: 1, total: 10, pasaron: 4 }, { ot: "7495", etapa: 2, total: 10, pasaron: 0 }] });
  const d = await leerAvanceYHoras(E);
  assert.ok(d.horas.has("7495|1"));
  assert.ok(!d.horas.has("7495|2"));
  assert.equal(d.piezas.length, 2);
  assert.ok(pedidos.some((p) => p.startsWith(`v_avance_piezas?empresa_id=eq.${E}`)));
});

test("leerAvanceYHoras — sin la migración 118 sigue andando", async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: "relation v_avance_piezas does not exist" }), { status: 400 });
  const d = await leerAvanceYHoras(E);
  assert.deepEqual(d.piezas, []);
});

test("Tablero — muestra el % de la OT y de cada etapa, y la etapa escaneada queda en curso", async () => {
  mockData({ v_avance_piezas: [{ ot: "7495", etapa: 1, total: 40, pasaron: 30 }, { ot: "7495", etapa: 2, total: 40, pasaron: 0 }] });
  render(<TableroOt proyectos={[{ id: 1, ot: "7495", division: "otra" }]} empresaId={E} etapas={ETAPAS} divisiones={[]} checklist={[]} />);
  assert.ok(await screen.findByText("🧩 Producción 37% por escaneo"));
  const corte = screen.getByLabelText("Corte de la OT 7495: En curso");
  assert.match(corte.textContent, /75%/);
  fireEvent.click(corte);
  assert.ok(screen.getByText("🧩 30 de 40 piezas escaneadas (75%)"));
});

test("DetalleOp — % de producción por escaneo con una barra por etapa", async () => {
  const piezas = [{ id: 1, etapas: [1, 2] }, { id: 2, etapas: [1, 2] }, { id: 3, etapas: [1] }, { id: 4, etapas: [1] }];
  mockData({ piezas_ot: piezas, pasos_pieza: [{ pieza_id: 1, etapa: 1 }, { pieza_id: 2, etapa: 1 }, { pieza_id: 3, etapa: 1 }, { pieza_id: 1, etapa: 2 }] });
  render(<DetalleOp proyecto={{ ot: "7495", cliente: "Siciliano" }} empresaId="emp-1" etapas={ETAPAS} divisiones={[]} onClose={() => {}} />);
  const seccion = await screen.findByRole("region", { name: "Avance de producción por escaneo" });
  // Corte 3 de 4 + Canteado 1 de 2 = 4 de 6 → 66%
  assert.match(seccion.textContent, /66%/);
  assert.match(seccion.textContent, /Corte75%/);
  assert.match(seccion.textContent, /3 de 4 piezas/);
  assert.match(seccion.textContent, /1 de 2 piezas/);
});

test("DetalleOp — OT sin piezas cargadas no muestra el %", async () => {
  mockData({});
  render(<DetalleOp proyecto={{ ot: "7495" }} empresaId="emp-1" etapas={ETAPAS} divisiones={[]} onClose={() => {}} />);
  await waitFor(() => screen.getByText("Todavía nadie registró tareas en esta OT."));
  assert.equal(screen.queryByRole("region", { name: "Avance de producción por escaneo" }), null);
});
