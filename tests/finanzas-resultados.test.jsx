// tests/finanzas-resultados.test.jsx — Finanzas, parte F6a: el estado de
// resultados devengado por mes, armado con la clasificacion_eerr del plan de
// cuentas del libro.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { estadoResultados, mesesHasta, nombreMes, finDeMes, importeResultado, seccionDe, configResultados } from "../app/lib/finanzasResultados.js";
import { cuentasDeHoja, limpiarFila } from "../app/lib/finanzas.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/resultados/route.js");
const { default: FinanzasResultados } = await import("../app/components/FinanzasResultados.jsx");

const E = "12121212-1212-1212-1212-121212121212";
const EMP = "34343434-3434-3434-3434-343434343434";
const CUENTAS = [
  { codigo: "04.01.01.001.002", nombre: "Entregas Generales", rubro: "RESULTADO", linea_eerr: "ING_ENT" },
  { codigo: "04.02.01.007.001", nombre: "Sueldos, Jornales y Contribuciones", rubro: "RESULTADO", linea_eerr: "CMV_MOD_SUE" },
  { codigo: "01.01.04.001.002", nombre: "Materias Primas", rubro: "ACTIVO CORRIENTE", linea_eerr: "CMV_MAT" },
  { codigo: "04.02.01.007.003", nombre: "Sueldos Administración", rubro: "RESULTADO", linea_eerr: "GO_ADM_SUE" },
  { codigo: "04.02.01.001.008", nombre: "Comisiones Y Gastos Bancarios", rubro: "RESULTADO", linea_eerr: "FIN_COM" },
  { codigo: "04.02.01.001.023", nombre: "Impuesto Debitos Y Creditos", rubro: "RESULTADO", linea_eerr: "IMP_DEB" },
  { codigo: "02.01.03.005.002", nombre: "IVA SALDO DJ A PAGAR", rubro: "PASIVO CORRIENTE", linea_eerr: "IMP_IVA" },
  { codigo: "04.02.01.001.006", nombre: "Comisiones Tarjetas", rubro: "RESULTADO" },
  { codigo: "01.01.02.001.001", nombre: "Deudores Por Ventas", rubro: "ACTIVO CORRIENTE" },
  { codigo: "01.01.01.003.002", nombre: "Banco", rubro: "ACTIVO CORRIENTE" },
];
const op = (fecha, debe, haber, total, extra = {}) => ({ id: Math.random(), fecha, cuenta_debe: debe, cuenta_haber: haber, neto: 0, total, total_ars: total, ...extra });
const OPS = [
  // Entrega de una OT de Muebles: 1.000.000 + IVA
  op("2026-10-05", "01.01.02.001.001", "04.01.01.001.002", 1210000, { neto: 1000000, proyecto_id: 1 }),
  op("2026-10-31", "04.02.01.007.001", "02.01.03.001.001", 300000),
  op("2026-10-31", "04.02.01.007.003", "02.01.03.001.001", 100000),
  op("2026-10-10", "04.02.01.001.008", "01.01.01.003.002", 5000),
  op("2026-10-10", "04.02.01.001.023", "01.01.01.003.002", 2000),
  op("2026-10-20", "02.01.03.005.002", "01.01.01.003.002", 50000),
  op("2026-10-20", "01.01.04.001.002", "02.01.02.001.001", 999999, { neto: 999999 }),
  op("2026-10-21", "04.02.01.001.006", "01.01.01.003.002", 700),
  op("2026-10-22", "04.02.01.001.008", "01.01.01.003.002", 9999, { anulada_at: "x" }),
  op("2026-10-22", "04.02.01.001.008", "01.01.01.003.002", 9999, { estado: "para_revisar" }),
  op("2025-10-22", "04.02.01.001.008", "01.01.01.003.002", 9999),
  // Un descuento en septiembre: entrega al debe
  op("2026-09-15", "04.01.01.001.002", "01.01.02.001.001", 10000, { proyecto_id: 2 }),
];
const PROYECTOS = [{ id: 1, division: "MUEBLES" }, { id: 2, division: "ALUMINIO" }];

test("meses, nombres y neto en pesos", () => {
  assert.deepEqual(mesesHasta("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
  assert.equal(mesesHasta("2026-10").length, 12);
  assert.deepEqual(mesesHasta("x"), []);
  assert.equal(nombreMes("2026-10"), "Oct 26");
  assert.equal(finDeMes("2028-02"), "2028-02-29");
  assert.equal(importeResultado({ neto: 100, total: 121, total_ars: 121 }), 100);
  assert.equal(importeResultado({ neto: 100, total: 121, total_ars: 121000 }), 100000, "en USD, el neto al tipo de cambio");
  assert.equal(importeResultado({ neto: 0, total: 50, total_ars: 50 }), 50);
  assert.deepEqual([seccionDe("GO_ADM_SUE").seccion.id, seccionDe("GO_ADM_SUE").grupo, seccionDe("IMP_IVA").seccion.id, seccionDe("XYZ")], ["GO", "ADM", "IVA", null]);
  assert.deepEqual(configResultados(null), { materiales_pct: 40 });
  assert.deepEqual(configResultados({ materiales_pct: 0 }), { materiales_pct: 0 });
});

test("estado de resultados — renglones, materiales estimados, IVA aparte, resultados y %", () => {
  const r = estadoResultados({ ops: OPS, cuentas: CUENTAS, proyectos: PROYECTOS, hasta: "2026-10" });
  const fila = (id) => r.filas.find((f) => f.id === id);
  const oct = (id) => fila(id).valores[11];
  assert.equal(r.meses[11], "2026-10");
  assert.equal(oct("ING"), 1000000, "ingresos sin IVA");
  assert.ok(r.filas.some((f) => f.nombre === "Entregas Generales · MUEBLES"), "por división");
  assert.equal(fila("ING").valores[10], -10000, "un descuento resta");
  const mat = r.filas.find((f) => f.estimado);
  assert.equal(mat.valores[11], 400000, "40 % de las entregas");
  assert.ok(!r.filas.some((f) => f.nombre === "Materias Primas"), "la compra de materia prima no es costo");
  assert.equal(oct("CMV"), 700000);
  assert.equal(oct("UTIL_BRU"), 300000);
  assert.equal(oct("UTIL_BRU_PCT"), 30);
  assert.equal(oct("GO"), 100000);
  assert.equal(oct("EBIT"), 200000);
  assert.equal(oct("FIN"), 5000, "sin la anulada ni la para revisar");
  assert.equal(oct("IMP"), 2000);
  assert.equal(oct("RDO_NETO"), 193000);
  assert.equal(oct("IVA"), 50000, "IVA aparte");
  assert.equal(r.para_revisar, 1);
  assert.deepEqual(r.sin_linea, [{ codigo: "04.02.01.001.006", nombre: "Comisiones Tarjetas", total: 700 }]);
  assert.equal(fila("FIN").total, 5000, "lo de hace más de 12 meses no entra");
  assert.ok(r.clasificado);

  const real = estadoResultados({ ops: OPS, cuentas: CUENTAS, proyectos: PROYECTOS, hasta: "2026-10", materialesPct: 0 });
  assert.ok(real.filas.some((f) => f.nombre === "Materias Primas"), "con 0 % se usan las cuentas");
  assert.equal(estadoResultados({ ops: OPS, cuentas: CUENTAS.map(({ linea_eerr: _l, ...c }) => c), hasta: "2026-10" }).clasificado, false);
});

test("plan de cuentas — trae clasificacion_eerr y atribucion_div; editar a mano no las borra", () => {
  const r = cuentasDeHoja([
    ["codigo", "nombre", "tipo", "rubro", "imputable", "naturaleza", "clasificacion_eerr", "naturaleza_costo", "atribucion_div"],
    ["04.02.01.007.003", "Sueldos Administración", "", "RESULTADO", "", "D", "GO_ADM_SUE", "FIJO", "PRORRATEO"],
    ["01.01.01.003.002", "Banco", "", "ACTIVO CORRIENTE", "", "D", "—", "", ""],
  ]);
  assert.deepEqual(r.filas.map((c) => [c.linea_eerr, c.atribucion]), [["GO_ADM_SUE", "PRORRATEO"], [null, null]]);
  assert.equal("linea_eerr" in limpiarFila("cuentas", { codigo: "01.01.01.003.002", nombre: "Banco" }).fila, false);
  assert.equal(limpiarFila("cuentas", { codigo: "01.01.01.003.002", nombre: "Banco", linea_eerr: "go_adm" }).fila.linea_eerr, "GO_ADM");
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;

function mockApi({ falta179 = false } = {}) {
  const pedidos = [];
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => (falta179 ? { status: 400, body: { code: "42703", message: "column fin_cuentas.linea_eerr does not exist" } } : { status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: (u) => { pedidos.push(decodeURIComponent(u)); return { status: 200, body: OPS.filter((o) => !o.anulada_at) }; } },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: PROYECTOS }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push(JSON.parse(o.body)); return { status: 201, body: [] }; }
        return { status: 200, body: [{ valor: { materiales_pct: 30 } }] };
      },
    },
  ]);
  return { pedidos, escrito };
}

test("/api/finanzas/resultados — solo el Dueño, los 12 meses y el % guardado", async () => {
  mockApi();
  const get = async (rol, q = "") => api.GET(new Request(`http://localhost/api/finanzas/resultados${q}`, { headers: { Authorization: `Bearer ${await token(rol)}` } }));
  assert.equal((await get("administrativo")).status, 403);
  const { pedidos } = mockApi();
  const r = await get("gerencial", "?hasta=2026-10");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.config.materiales_pct, 30);
  assert.equal(d.filas.find((f) => f.estimado).valores[11], 300000);
  assert.match(pedidos[0], /fecha=gte\.2025-11-01&fecha=lte\.2026-10-31/);
  mockApi({ falta179: true });
  const sin = await get("gerencial", "?hasta=2026-10");
  assert.equal(sin.status, 409);
  assert.match((await sin.json()).error, /179/);
});

test("/api/finanzas/resultados — guardar el % de materiales", async () => {
  const { escrito } = mockApi();
  const post = async (body) => api.POST(new Request("http://localhost/api/finanzas/resultados", { method: "POST", headers: { Authorization: `Bearer ${await token("gerencial")}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await post({ accion: "config", materiales_pct: "35,5" })).status, 200);
  assert.deepEqual(escrito[0].valor, { materiales_pct: 35.5 });
  assert.equal((await post({ accion: "config", materiales_pct: 120 })).status, 400);
});

// ─── Pantalla ───

test("Resultados — muestra el estado y cierra una sección", async () => {
  const datos = { hasta: "2026-10", config: { materiales_pct: 40 }, ...estadoResultados({ ops: OPS, cuentas: CUENTAS, proyectos: PROYECTOS, hasta: "2026-10" }) };
  global.fetch = async () => new Response(JSON.stringify(datos), { status: 200 });
  render(<FinanzasResultados />);
  assert.ok(await screen.findByText("Resultado neto"));
  assert.ok(screen.getByText("193.000"));
  assert.ok(screen.getByText("Sueldos Administración"));
  fireEvent.click(screen.getByRole("button", { name: "Gastos operativos" }));
  assert.equal(screen.queryByText("Sueldos Administración"), null);
  assert.ok(screen.getByText(/1 operaciones para revisar/));
  assert.ok(screen.getByText(/1 cuentas de resultado/));
});
