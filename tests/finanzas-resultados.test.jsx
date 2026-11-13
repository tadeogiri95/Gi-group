// tests/finanzas-resultados.test.jsx — Finanzas, parte F6a: el estado de
// resultados devengado por mes, armado con la clasificacion_eerr del plan de
// cuentas del libro.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { estadoResultados, mesesHasta, nombreMes, finDeMes, importeResultado, seccionDe, configResultados, validarPonderador, resumenDivisiones, divisionDeOp, claveDivision } from "../app/lib/finanzasResultados.js";
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
  assert.deepEqual(configResultados(null), { materiales_pct: 40, ponderador: {} });
  assert.deepEqual(configResultados({ materiales_pct: 0, ponderador: { MUEBLES: 80, ALUMINIO: 20 } }), { materiales_pct: 0, ponderador: { MUEBLES: 80, ALUMINIO: 20 } });
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
  // NIIF: el impuesto a los débitos y créditos va con los gastos de administración
  assert.equal(oct("ADM"), 102000);
  assert.equal(oct("COM"), 0);
  assert.equal(oct("EBIT"), 198000);
  assert.equal(oct("FIN"), 5000, "sin la anulada ni la para revisar");
  assert.equal(oct("RAI"), 193000);
  assert.equal(oct("GAN"), 0);
  assert.equal(oct("RDO_NETO"), 193000);
  assert.ok(r.hay_entregas);
  assert.equal(oct("IVA"), 50000, "IVA aparte");
  assert.equal(r.para_revisar, 1);
  assert.deepEqual(r.sin_linea, [{ codigo: "04.02.01.001.006", nombre: "Comisiones Tarjetas", total: 700 }]);
  assert.equal(fila("FIN").total, 5000, "lo de hace más de 12 meses no entra");
  assert.ok(r.clasificado);

  const real = estadoResultados({ ops: OPS, cuentas: CUENTAS, proyectos: PROYECTOS, hasta: "2026-10", materialesPct: 0 });
  assert.ok(real.filas.some((f) => f.nombre === "Materias Primas"), "con 0 % se usan las cuentas");
  assert.equal(estadoResultados({ ops: OPS, cuentas: CUENTAS.map(({ linea_eerr: _l, ...c }) => c), hasta: "2026-10" }).clasificado, false);
});

test("NIIF — solo las entregas son ingreso; ventas aparte; gastos por función", () => {
  const cuentas = [
    ...CUENTAS,
    { codigo: "04.01.01.001.001", nombre: "Ventas Generales", rubro: "RESULTADO", linea_eerr: "ING_VTA" },
    { codigo: "04.01.02", nombre: "Alquileres ganados", rubro: "RESULTADO", linea_eerr: "ING_ALQ" },
    { codigo: "04.02.05", nombre: "Combustibles y lubricantes", rubro: "RESULTADO", linea_eerr: "GO_LOG_COM" },
    { codigo: "04.02.06", nombre: "Ingresos Brutos", rubro: "RESULTADO", linea_eerr: "IMP_IIBB" },
    { codigo: "04.02.07", nombre: "Multas", rubro: "RESULTADO", linea_eerr: "GO_MUL" },
    { codigo: "04.02.08", nombre: "Impuesto a las Ganancias", rubro: "RESULTADO", linea_eerr: "IMP_GAN" },
  ];
  const ops = [
    op("2026-10-01", "01.01.02.001.001", "04.01.01.001.001", 800000), // OT cargada en el Plan
    op("2026-10-05", "04.01.01.001.001", "04.01.01.001.002", 500000), // entrega
    op("2026-10-06", "01.01.01.003.002", "04.01.02", 20000),
    op("2026-10-07", "04.02.05", "01.01.01.003.002", 30000),
    op("2026-10-08", "04.02.06", "01.01.01.003.002", 15000),
    op("2026-10-09", "04.02.07", "01.01.01.003.002", 1000),
    op("2026-10-10", "04.02.08", "01.01.01.003.002", 40000),
  ];
  const r = estadoResultados({ ops, cuentas, hasta: "2026-10", materialesPct: 0 });
  const oct = (id) => r.filas.find((f) => f.id === id).valores[11];
  assert.equal(oct("ING"), 500000, "solo la entrega");
  assert.equal(oct("VTA"), 300000, "lo vendido sin entregar, aparte");
  assert.ok(r.filas.find((f) => f.id === "VTA").aparte);
  assert.equal(oct("COM"), 45000, "logística e ingresos brutos");
  assert.equal(oct("OTR"), 19000, "alquiler menos multa");
  assert.equal(oct("EBIT"), 474000);
  assert.equal(oct("GAN"), 40000);
  assert.equal(oct("RDO_NETO"), 434000);
  const orden = r.filas.filter((f) => ["seccion", "resultado"].includes(f.tipo)).map((f) => f.id);
  assert.deepEqual(orden, ["ING", "CMV", "UTIL_BRU", "COM", "ADM", "OTR", "EBIT", "FIN", "RAI", "GAN", "RDO_NETO", "VTA"]);
  assert.ok(r.filas.some((f) => f.nombre === "Impuestos: ingresos brutos"));
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

// ─── Por división ───

const CENTROS = [{ codigo: "ALUM", division: "Aluminio" }, { codigo: "GENERAL", division: "GENERAL" }];
const PONDERADOR = { MUEBLES: 80, ALUMINIO: 20 };
// Un sueldo de planta con centro de costo de Aluminio: va entero a Aluminio
const OPS_DIV = [...OPS, op("2026-10-31", "04.02.01.007.001", "02.01.03.001.001", 50000, { centro_costo: "ALUM" })];

test("ponderador: suman 100, de qué división es cada operación", () => {
  assert.deepEqual(validarPonderador({ MUEBLES: "80", " ALUMINIO ": "20,0" }), { ponderador: { MUEBLES: 80, ALUMINIO: 20 } });
  assert.match(validarPonderador({ MUEBLES: 80, ALUMINIO: 15 }).error, /sumar 100 \(ahora suman 95\)/);
  assert.ok(validarPonderador({ MUEBLES: 120 }).error);
  assert.deepEqual(validarPonderador({}), { ponderador: {} });
  assert.equal(claveDivision(" Herrería "), "HERRERIA");
  const ctx = { divisionOt: new Map([[1, "Muebles"]]), divisionCentro: new Map([["ALUM", "ALUMINIO"], ["GENERAL", "GENERAL"]]), divisiones: new Map([["MUEBLES", "MUEBLES"], ["ALUMINIO", "ALUMINIO"]]) };
  assert.equal(divisionDeOp({ proyecto_id: 1, centro_costo: "ALUM" }, ctx), "MUEBLES", "la OT gana");
  assert.equal(divisionDeOp({ centro_costo: "alum" }, ctx), "ALUMINIO");
  assert.equal(divisionDeOp({ centro_costo: "GENERAL" }, ctx), "", "GENERAL no está en el ponderador: compartido");
  assert.equal(divisionDeOp({}, ctx), "");
});

test("estado por división: lo suyo entero y su % de lo compartido", () => {
  const base = { ops: OPS_DIV, cuentas: CUENTAS, proyectos: PROYECTOS, centros: CENTROS, hasta: "2026-10", ponderador: PONDERADOR };
  const t = (r, id) => r.filas.find((f) => f.id === id).valores[11];
  const muebles = estadoResultados({ ...base, division: "MUEBLES" });
  // Entrega 1.000.000 suya; materiales 40 %; sueldos 300.000, adm. 100.000, banco 5.000 e impuesto 2.000 al 80 %
  assert.deepEqual([t(muebles, "ING"), t(muebles, "CMV"), t(muebles, "ADM"), t(muebles, "FIN"), t(muebles, "GAN"), t(muebles, "RDO_NETO")], [1000000, 640000, 81600, 4000, 0, 274400]);
  const alu = estadoResultados({ ...base, division: "ALUMINIO" });
  // 20 % de los sueldos + los 50.000 de su centro de costo
  assert.equal(t(alu, "CMV"), 110000);
  assert.equal(t(alu, "RDO_NETO"), -131400);
  const res = resumenDivisiones({ ...base, materialesPct: 40 });
  assert.deepEqual(res.map((r) => [r.division, r.pct]), [["MUEBLES", 80], ["ALUMINIO", 20], ["", 100]]);
  assert.equal(res[0].resultado + res[1].resultado, res[2].resultado, "las divisiones suman la empresa");
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;

function mockApi({ falta179 = false, ponderador = null } = {}) {
  const pedidos = [];
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => (falta179 ? { status: 400, body: { code: "42703", message: "column fin_cuentas.linea_eerr does not exist" } } : { status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: (u) => { pedidos.push(decodeURIComponent(u)); return { status: 200, body: OPS.filter((o) => !o.anulada_at) }; } },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: PROYECTOS }) },
    { match: (u) => u.includes("/rest/v1/fin_centros_costo"), respond: () => ({ status: 200, body: CENTROS }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push(JSON.parse(o.body)); return { status: 201, body: [] }; }
        return { status: 200, body: [{ valor: { materiales_pct: 30, ...(ponderador ? { ponderador } : {}) } }] };
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
  assert.deepEqual(escrito[0].valor, { materiales_pct: 35.5, ponderador: {} });
  assert.equal((await post({ accion: "config", materiales_pct: 120 })).status, 400);
  assert.equal((await post({ accion: "config", ponderador: { MUEBLES: 80, ALUMINIO: 15 } })).status, 400);
  assert.equal((await post({ accion: "config", ponderador: PONDERADOR })).status, 200);
  assert.deepEqual(escrito[1].valor, { materiales_pct: 30, ponderador: PONDERADOR }, "el % de materiales queda como estaba");
});

test("/api/finanzas/resultados — una división y el resumen", async () => {
  mockApi({ ponderador: PONDERADOR });
  const r = await api.GET(new Request("http://localhost/api/finanzas/resultados?hasta=2026-10&division=ALUMINIO", { headers: { Authorization: `Bearer ${await token("gerencial")}` } }));
  const d = await r.json();
  assert.equal(d.division, "ALUMINIO");
  assert.deepEqual(d.divisiones, ["ALUMINIO", "MUEBLES"]);
  assert.equal(d.por_division.length, 3);
  assert.equal(d.filas.find((f) => f.id === "ING").valores[11], 0, "la entrega de Muebles no está");
});

// ─── Pantalla ───

test("Resultados — muestra el estado y cierra una sección", async () => {
  const datos = { hasta: "2026-10", config: { materiales_pct: 40 }, ...estadoResultados({ ops: OPS, cuentas: CUENTAS, proyectos: PROYECTOS, hasta: "2026-10" }) };
  global.fetch = async () => new Response(JSON.stringify(datos), { status: 200 });
  render(<FinanzasResultados />);
  assert.ok(await screen.findByText("Resultado del período"));
  assert.ok(screen.getByText("Ganancia bruta"));
  assert.ok(screen.getAllByText("193.000").length >= 2);
  assert.ok(screen.getByText(/Ingresos = entregas de las OT/));
  assert.ok(screen.getByText("Sueldos Administración"));
  fireEvent.click(screen.getByRole("button", { name: "Gastos de administración" }));
  assert.equal(screen.queryByText("Sueldos Administración"), null);
  assert.ok(screen.getByText(/1 operaciones para revisar/));
  assert.ok(screen.getByText(/1 cuentas de resultado/));
});

test("Resultados — resumen por división y elegir una", async () => {
  const base = { ops: OPS_DIV, cuentas: CUENTAS, proyectos: PROYECTOS, centros: CENTROS, hasta: "2026-10", ponderador: PONDERADOR };
  const pedidos = [];
  global.fetch = async (u) => {
    pedidos.push(String(u));
    const division = String(u).includes("division=ALUMINIO") ? "ALUMINIO" : "";
    return new Response(JSON.stringify({ hasta: "2026-10", config: { materiales_pct: 40, ponderador: PONDERADOR }, division, divisiones: ["ALUMINIO", "MUEBLES"], por_division: resumenDivisiones(base), ...estadoResultados({ ...base, division }) }), { status: 200 });
  };
  render(<FinanzasResultados />);
  assert.ok(await screen.findByRole("table", { name: "Resumen por división" }));
  assert.ok(screen.getByText("Toda la empresa", { selector: "td" }));
  fireEvent.click(screen.getByRole("button", { name: "ALUMINIO" }));
  assert.ok(await screen.findByText(/ALUMINIO: lo suyo entero/));
  assert.ok(pedidos.some((p) => p.includes("division=ALUMINIO")));
  fireEvent.click(screen.getByRole("button", { name: "⚙ Compartidos" }));
  assert.equal(screen.getByLabelText("Porcentaje de MUEBLES").value, "80");
});

// ─── Entregas con valor estimado (13/11): OT terminadas sin precio en el Plan ───

test("entregas estimadas: renglón aparte por división, cuentan para materiales y no se cuentan dos veces", () => {
  const estimadas = [
    { proyecto_id: 3, fecha: "2026-10-12", valor: 500000 },
    { proyecto_id: 3, fecha: "2025-01-12", valor: 999 }, // fuera de la ventana
    { proyecto_id: 1, fecha: "2026-10-20", valor: 777 }, // ya tiene su entrega de verdad
  ];
  const r = estadoResultados({ ops: OPS, cuentas: CUENTAS, proyectos: [...PROYECTOS, { id: 3, division: "MUEBLES" }], hasta: "2026-10", entregasEstimadas: estimadas });
  const est = r.filas.filter((f) => f.entrega_estimada);
  assert.equal(est.length, 1);
  assert.equal(est[0].nombre, "Entregas con valor estimado (OT sin precio en el Plan) · MUEBLES");
  assert.equal(est[0].valores[11], 500000);
  assert.equal(est[0].estimado, true);
  assert.equal(r.entregas_estimadas, 1);
  // Va en Ingresos, después de las entregas con precio
  const ing = r.filas.filter((f) => f.seccion === "ING" && f.tipo === "linea");
  assert.equal(ing[ing.length - 1].entrega_estimada, true);
  assert.equal(r.filas.find((f) => f.id === "ING").valores[11], 1500000);
  // Materiales: 40 % de todas las entregas (con precio y estimadas)
  assert.equal(r.filas.find((f) => f.id === "materiales|estimado" || f.nombre.startsWith("Costo de materiales")).valores[11], 600000);
  // Vista de ALUMINIO: la OT de Muebles no está
  const alu = estadoResultados({ ops: OPS, cuentas: CUENTAS, proyectos: [...PROYECTOS, { id: 3, division: "MUEBLES" }], hasta: "2026-10", entregasEstimadas: estimadas, ponderador: PONDERADOR, division: "ALUMINIO" });
  assert.equal(alu.filas.filter((f) => f.entrega_estimada).length, 0);
});

test("/api/finanzas/resultados — estima las OT terminadas sin precio con sus necesidades ÷ 0,3", async () => {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: () => ({ status: 200, body: OPS.filter((o) => !o.anulada_at) }) },
    {
      match: (u) => u.includes("/rest/v1/proyectos"),
      respond: (u) => {
        pedidos.push(decodeURIComponent(u));
        if (u.includes("estado=neq.cerrado")) return { status: 200, body: [{ id: 8, ot: "8001", estado: "activo", cliente: "ACME", fecha_entrega: "2026-09-01" }] };
        if (u.includes("fecha_entrega=is.null")) return { status: 200, body: [{ id: 9, ot: "9001", estado: "cerrado", cliente: "Pérez" }, { id: 4, ot: "7002", estado: "cerrado" }] };
        if (u.includes("fecha_entrega=gte.")) return { status: 200, body: [{ id: 3, ot: "7001", estado: "cerrado", fecha_entrega: "2026-06-01" }, { id: 6, ot: "6999", estado: "cerrado", created_at: "2025-01-01T12:00:00Z", fecha_entrega: "2026-08-10" }, { id: 7, ot: "7100", estado: "cerrado", cliente: "Gómez", fecha_entrega: "2026-07-01" }] };
        return { status: 200, body: u.includes("id=in.") ? [{ id: 3, ot: "7001", estado: "cerrado", created_at: "2026-09-01T12:00:00Z" }, { id: 4, ot: "7002", estado: "cerrado", created_at: "2026-09-01T12:00:00Z" }, { id: 5, ot: "7003", estado: "activo", created_at: "2026-09-01T12:00:00Z" }] : [...PROYECTOS, { id: 3, division: "MUEBLES" }, { id: 4, division: "MUEBLES" }, { id: 6, division: "MUEBLES" }] };
      },
    },
    { match: (u) => u.includes("/rest/v1/fin_centros_costo"), respond: () => ({ status: 200, body: CENTROS }) },
    { match: (u) => u.includes("/rest/v1/precios_ot"), respond: () => ({ status: 200, body: [{ ot: "7002", precio: 100 }] }) },
    { match: (u) => u.includes("/rest/v1/necesidades_stock"), respond: () => ({ status: 200, body: [{ ot: "7001", sku: "PL1", cantidad: 3 }, { ot: "6999", sku: "PL1", cantidad: 1 }] }) },
    { match: (u) => u.includes("/rest/v1/precios_fijos_ot"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/v_precios_articulos"), respond: () => ({ status: 200, body: [{ sku: "PL1", fecha: "2026-01-01", precio_ars: 30000 }] }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u) => ({ status: 200, body: [{ valor: u.includes("finanzas_entregas_estimadas") ? { fechas: { p3: "2026-10-12", p4: "2026-10-13", p5: "2026-10-14" } } : { materiales_pct: 40 } }] }),
    },
  ]);
  const r = await api.GET(new Request("http://localhost/api/finanzas/resultados?hasta=2026-10", { headers: { Authorization: `Bearer ${await token("gerencial")}` } }));
  assert.equal(r.status, 200);
  const d = await r.json();
  const est = d.filas.find((f) => f.entrega_estimada);
  // 3 × 30.000 = 90.000 de materiales ÷ 0,3 = 300.000 (la 7002 ya tiene precio; la 7003 se reabrió)
  assert.equal(est.valores[11], 300000);
  // La 6999 se cargó antes del "desde": entra por su fecha de entrega del Plan (agosto). La 7001 queda en la fecha anotada.
  assert.deepEqual(d.estimadas_ot, [{ ot: "6999", fecha: "2026-08-10", valor: 100000 }, { ot: "7001", fecha: "2026-10-12", valor: 300000 }]);
  assert.equal(est.valores[9], 100000);
  // Las que no se pudieron estimar, con su motivo (la 7002 tiene precio: no aparece)
  assert.deepEqual(d.no_estimadas_ot.map((x) => [x.ot, x.motivo, x.fecha]), [["9001", "sin_fecha", ""], ["7100", "sin_necesidades", "2026-07-01"], ["8001", "sin_terminar", "2026-09-01"]]);
  assert.match(d.no_estimadas_ot[1].motivo_texto, /no pasó por el MRP/);
  assert.ok(pedidos.some((p) => p.includes("id=in.(3,4,5)")));
});

test("Resultados — el renglón estimado se ve con otro color y la lista de OT", async () => {
  const proyectos = [...PROYECTOS, { id: 3, division: "MUEBLES" }];
  const datos = { hasta: "2026-10", config: { materiales_pct: 40 }, estimadas_ot: [{ ot: "7001", fecha: "2026-10-12", valor: 300000 }], ...estadoResultados({ ops: OPS, cuentas: CUENTAS, proyectos, hasta: "2026-10", entregasEstimadas: [{ proyecto_id: 3, fecha: "2026-10-12", valor: 300000 }] }) };
  global.fetch = async () => new Response(JSON.stringify(datos), { status: 200 });
  render(<FinanzasResultados />);
  const celda = await screen.findByText(/Entregas con valor estimado \(OT sin precio en el Plan\) · MUEBLES/);
  assert.match(celda.closest("tr").className, /bg-gypi-estimado/);
  assert.ok(screen.getByText(/1 OT terminada sin precio en el Plan de trabajo/));
  assert.ok(screen.getByText("OT 7001"));
  assert.ok(screen.getByText("12/10/26"));
});

test("Resultados — lista de las OT sin precio que no se pudieron estimar, por motivo", async () => {
  const datos = { hasta: "2026-10", config: { materiales_pct: 40 }, no_estimadas_ot: [{ ot: "7100", cliente: "Gómez", fecha: "2026-07-01", motivo: "sin_necesidades", motivo_texto: "No tiene materiales en Gypi (no pasó por el MRP)" }, { ot: "9001", cliente: "", fecha: "", motivo: "sin_fecha", motivo_texto: "Está terminada pero no tiene fecha de entrega en el Plan" }], ...estadoResultados({ ops: OPS, cuentas: CUENTAS, proyectos: PROYECTOS, hasta: "2026-10" }) };
  global.fetch = async () => new Response(JSON.stringify(datos), { status: 200 });
  render(<FinanzasResultados />);
  assert.ok(await screen.findByText(/2 OT sin precio que no se pudieron estimar/));
  assert.ok(screen.getByText("No tiene materiales en Gypi (no pasó por el MRP) (1)"));
  assert.ok(screen.getByText("OT 7100 · Gómez"));
  assert.ok(screen.getByText("sin fecha"));
});
