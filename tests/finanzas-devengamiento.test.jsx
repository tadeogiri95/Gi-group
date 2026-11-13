// tests/finanzas-devengamiento.test.jsx — Parte 8 del plan de Tesorería
// (13/11): Finanzas → 📆 Devengamiento. Sin migración.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  renglonesDeCuentas, totalesPorMes, faltaEsteMes, propuestaRecurrente, ventasSosPorMes, configDevengamiento, devengamientoDelMes, mesAnterior,
} from "../app/lib/finanzasDevengamiento.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/devengamiento/route.js");
const { default: FinanzasDevengamiento } = await import("../app/components/FinanzasDevengamiento.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

// Un pedazo del plan de cuentas del libro
const CUENTAS = [
  { codigo: "01.01.01.003.002", nombre: "Banco Credicoop", rubro: "ACTIVO CORRIENTE", linea_eerr: "" },
  { codigo: "01.01.05.001.001", nombre: "Seguros Pagados Por Adelantado", rubro: "ACTIVO CORRIENTE", linea_eerr: "" },
  { codigo: "02.01.02.002.001", nombre: "Anticipo de Clientes", rubro: "PASIVO CORRIENTE", linea_eerr: "" },
  { codigo: "02.01.03.001.001", nombre: "Sueldos A Pagar", rubro: "PASIVO CORRIENTE", linea_eerr: "" },
  { codigo: "02.01.03.014.002", nombre: "Provision SAC", rubro: "PASIVO CORRIENTE", linea_eerr: "" },
  { codigo: "01.02.01.099.001", nombre: "Amortizaciones Acumuladas", rubro: "ACTIVO NO CORRIENTE", linea_eerr: "" },
  { codigo: "04.01.01.001.001", nombre: "Ventas Generales", rubro: "RESULTADO", linea_eerr: "ING_VTA" },
  { codigo: "04.01.01.001.002", nombre: "Entregas Generales", rubro: "RESULTADO", linea_eerr: "ING_ENT" },
  { codigo: "04.01.02.002.001", nombre: "Intereses Ganados", rubro: "RESULTADO", linea_eerr: "" },
  { codigo: "04.02.01.001.003", nombre: "Amortizaciones del Ejercicio", rubro: "RESULTADO", linea_eerr: "CMV_CIF_DEP" },
  { codigo: "04.02.01.001.011", nombre: "Electricidad", rubro: "RESULTADO", linea_eerr: "CMV_CIF_ELE" },
  { codigo: "04.02.01.001.024", nombre: "Intereses", rubro: "RESULTADO", linea_eerr: "FIN_INT" },
  { codigo: "04.02.01.001.039", nombre: "S.a.c.", rubro: "RESULTADO", linea_eerr: "CMV_MOD_SAC" },
  { codigo: "04.02.01.001.040", nombre: "Seguros", rubro: "RESULTADO", linea_eerr: "GO_SEG_OTR" },
  { codigo: "04.02.01.001.042", nombre: "Sueldos", rubro: "RESULTADO", linea_eerr: "" },
  { codigo: "04.02.01.001.047", nombre: "Cargas Sociales", rubro: "RESULTADO", linea_eerr: "" },
  { codigo: "04.02.01.001.060", nombre: "Diferencia cotización Títulos", rubro: "RESULTADO", linea_eerr: "" },
  { codigo: "04.02.01.007.001", nombre: "Sueldos, Jornales y Contribuciones", rubro: "RESULTADO", linea_eerr: "CMV_MOD_SUE" },
  { codigo: "04.02.01.007.014", nombre: "Vacaciones Producción", rubro: "RESULTADO", linea_eerr: "CMV_MOD_VAC" },
  { codigo: "04.03.01.001.001", nombre: "Cuenta rara", rubro: "RESULTADO", linea_eerr: "" },
];
const C = Object.fromEntries(CUENTAS.map((c) => [c.nombre, c.codigo]));
const BANCO = C["Banco Credicoop"];
const op = (fecha, debe, haber, total, extra = {}) => ({ fecha, cuenta_debe: debe, cuenta_haber: haber, total, total_ars: total, ...extra });

test("renglones — por la clasificación del EERR y, si no la tiene, por el nombre", () => {
  const r = renglonesDeCuentas(CUENTAS);
  assert.equal(r.get(C["Entregas Generales"]), "entregas");
  assert.equal(r.has(C["Ventas Generales"]), false, "las ventas no entran en el resultado");
  assert.equal(r.get(C["Electricidad"]), "servicios", "la luz es un servicio aunque el libro la tenga en CIF");
  assert.equal(r.get(C["Amortizaciones del Ejercicio"]), "amortizaciones");
  assert.equal(r.get(C["S.a.c."]), "aguinaldo");
  assert.equal(r.get(C["Vacaciones Producción"]), "vacaciones");
  assert.equal(r.get(C["Sueldos, Jornales y Contribuciones"]), "mod");
  assert.equal(r.get(C["Sueldos"]), "sueldos");
  assert.equal(r.get(C["Cargas Sociales"]), "cargas");
  assert.equal(r.get(C["Intereses Ganados"]), "intereses_gan", "no son intereses pagados");
  assert.equal(r.get(C["Intereses"]), "intereses_pag");
  assert.equal(r.get(C["Diferencia cotización Títulos"]), "dif_cambio");
  assert.equal(r.get(C["Anticipo de Clientes"]), "anticipos");
  assert.equal(r.get(C["Seguros Pagados Por Adelantado"]), "adelantados");
  assert.equal(r.get(C["Cuenta rara"]), "sin_clasificar");
  assert.equal(r.has(BANCO), false, "las cajas y bancos no");
});

const OPS = [
  // septiembre y octubre: luz, sueldos (liquidación), amortización
  op("2026-09-10", C["Electricidad"], BANCO, 1000),
  op("2026-10-10", C["Electricidad"], BANCO, 1200),
  op("2026-09-30", C["Sueldos, Jornales y Contribuciones"], C["Sueldos A Pagar"], 120000, { origen: "liquidacion" }),
  op("2026-10-31", C["Sueldos, Jornales y Contribuciones"], C["Sueldos A Pagar"], 120000, { origen: "liquidacion" }),
  op("2026-09-30", C["Amortizaciones del Ejercicio"], C["Amortizaciones Acumuladas"], 5000),
  op("2026-10-31", C["Amortizaciones del Ejercicio"], C["Amortizaciones Acumuladas"], 5000),
  // noviembre: sueldos y la entrega, sin luz ni amortización
  op("2026-11-30", C["Sueldos"], C["Sueldos A Pagar"], 60000, { origen: "liquidacion" }),
  op("2026-11-15", BANCO, C["Entregas Generales"], 121000, { neto: 100000, total: 121000, total_ars: 121000 }),
  op("2026-11-16", BANCO, C["Anticipo de Clientes"], 50000),
  op("2026-11-17", C["Electricidad"], BANCO, 999, { estado: "para_revisar" }),
  op("2026-11-18", C["Intereses Ganados"], BANCO, 10),
  op("2026-11-19", BANCO, C["Intereses Ganados"], 300),
];

test("totales — sin IVA, ingresos al revés, balance por su lado y sin lo para revisar", () => {
  const t = totalesPorMes(OPS, CUENTAS, ["2026-09", "2026-10", "2026-11"]);
  assert.equal(t.get("entregas").get("2026-11"), 100000, "el neto, sin IVA");
  assert.equal(t.get("anticipos").get("2026-11"), 50000);
  assert.equal(t.get("servicios").get("2026-10"), 1200);
  assert.equal(t.get("servicios").get("2026-11"), undefined, "lo para revisar no cuenta");
  assert.equal(t.get("intereses_gan").get("2026-11"), 290, "ingreso = haber − debe");
  assert.equal(mesAnterior("2026-01"), "2025-12");
});

test("falta este mes — lo de todos los meses, las provisiones y el S.O.S", () => {
  const meses = ["2026-08", "2026-09", "2026-10", "2026-11"];
  const totales = totalesPorMes(OPS, CUENTAS, meses);
  const ops = [...OPS, op("2026-10-05", C["Electricidad"], BANCO, 1, { origen: "sos" })];
  const falta = faltaEsteMes("2026-11", { totales, ops, ventas: { "2026-10": { neto: 1 } } });
  const ids = falta.map((f) => f.id);
  assert.ok(ids.includes("servicios"), "la luz estuvo en septiembre y octubre");
  assert.match(falta.find((f) => f.id === "servicios").texto, /Servicios de noviembre sin cargar \(en octubre: \$ 1\.200,00\)/);
  assert.equal(falta.find((f) => f.id === "amortizaciones").accion, "proponer");
  assert.ok(ids.includes("aguinaldo") && ids.includes("vacaciones"), "hay sueldos y no hay provisión");
  assert.ok(ids.includes("sos") && ids.includes("ventas"));
  assert.ok(!ids.includes("sueldos"), "noviembre ya está liquidado");
  assert.ok(!faltaEsteMes("2026-11", { totales, ops, ocultos: ["servicios"] }).some((f) => f.id === "servicios"), "lo oculto no se pide");
});

test("recurrentes — aguinaldo 1/12, vacaciones 14 días y amortización igual que el mes anterior", () => {
  const totales = totalesPorMes(OPS, CUENTAS, ["2026-09", "2026-10", "2026-11"]);
  const ag = propuestaRecurrente("aguinaldo", "2026-11", { totales, cuentas: CUENTAS, hoy: "2026-11-13" });
  assert.deepEqual([ag.importe, ag.cuenta_debe, ag.cuenta_haber, ag.fecha], [5000, C["S.a.c."], C["Provision SAC"], "2026-11-13"]);
  assert.match(ag.como, /1\/12 de los sueldos de noviembre/);
  const vac = propuestaRecurrente("vacaciones", "2026-10", { totales, cuentas: CUENTAS, hoy: "2026-11-13" });
  assert.equal(vac.importe, 5600, "120.000 ÷ 25 × 14 ÷ 12");
  assert.equal(vac.fecha, "2026-10-31");
  const am = propuestaRecurrente("amortizaciones", "2026-11", { totales, cuentas: CUENTAS });
  assert.deepEqual([am.importe, am.cuenta_haber], [5000, C["Amortizaciones Acumuladas"]]);
  assert.match(am.como, /Igual que en octubre 2026/);
  assert.equal(propuestaRecurrente("seguros", "2026-11", { totales, cuentas: CUENTAS }), null, "sin seguros antes no hay propuesta");
  assert.equal(propuestaRecurrente("servicios", "2026-11", { totales, cuentas: CUENTAS }), null, "no es recurrente");
});

const VENTAS = [
  "Fecha Comprobante;CUIT;Cliente;Comprobante;Neto;IVA;Total",
  "05/10/2026;30-11111111-1;OBRA SA;A-00003-00000010;100.000,00;21.000,00;121.000,00",
  "06/10/2026;30-11111111-1;OBRA SA;NC A-00003-00000002;10.000,00;2.100,00;12.100,00",
  "02/11/2026;30-22222222-2;OTRA SRL;B-00003-00000011;50.000,00;0;50.000,00",
].join("\n");

test("S.O.S ventas — total por mes; la nota de crédito resta", () => {
  const { meses } = ventasSosPorMes(VENTAS);
  assert.deepEqual(meses["2026-10"], { neto: 90000, total: 108900, comprobantes: 2 });
  assert.equal(meses["2026-11"].neto, 50000);
  assert.match(ventasSosPorMes("a;b\n1;2").errores[0], /ventas/);
  assert.deepEqual(configDevengamiento({ ocultos: ["juicios", "no-existe"], ventas_sos: { "2026-10": { neto: 1 }, malo: {} } }).ocultos, ["juicios"]);
  const d = devengamientoDelMes("2026-11", { ops: OPS, cuentas: CUENTAS, config: { ventas_sos: { "2026-11": { neto: 90000, total: 1, comprobantes: 3 } } }, hoy: "2026-11-13" });
  assert.deepEqual([d.ventas.entregas, d.ventas.diferencia], [100000, -10000], "se entregó más de lo facturado");
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, body) => api.POST(new Request("http://localhost/api/finanzas/devengamiento", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, body: JSON.stringify(body) }));
const ver = async (q = "") => api.GET(new Request(`http://localhost/api/finanzas/devengamiento${q}`, { headers: { Authorization: `Bearer ${await token("gerencial")}` } }));

function mockApi(config = null) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: () => ({ status: 200, body: OPS }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push({ metodo: o.method, body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        return { status: 200, body: config ? [{ valor: config, clave: "finanzas_devengamiento" }] : [] };
      },
    },
    { match: (u) => /\/rest\/v1\/(fin_tipos_operacion|fin_tesoreria|fin_centros_costo|proveedores|proyectos)/.test(u), respond: () => ({ status: 200, body: [] }) },
  ]);
  return escrito;
}

test("/api/finanzas/devengamiento — solo el Dueño; el mes con lo que falta", async () => {
  mockApi();
  assert.equal((await pedir("administrativo", { accion: "ocultar", id: "juicios" })).status, 403);
  const r = await ver("?mes=2026-11");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.mes, "2026-11");
  assert.equal(d.items.find((i) => i.id === "entregas").total, 100000);
  assert.ok(d.falta.some((f) => f.id === "servicios"));
  assert.ok(Array.isArray(d.listas.cuentas));
});

test("/api/finanzas/devengamiento — ocultar y guardar el S.O.S ventas sin perder lo demás", async () => {
  let escrito = mockApi();
  assert.equal((await pedir("gerencial", { accion: "ocultar", id: "juicios" })).status, 200);
  assert.deepEqual(escrito[0], { metodo: "POST", body: { empresa_id: E, clave: "finanzas_devengamiento", valor: { ocultos: ["juicios"], ventas_sos: {} } } });
  assert.equal((await pedir("gerencial", { accion: "ocultar", id: "nada" })).status, 400);
  escrito = mockApi({ ocultos: ["juicios"], ventas_sos: { "2026-09": { neto: 5, total: 6, comprobantes: 1 } } });
  const r = await pedir("gerencial", { accion: "ventas", texto: VENTAS, archivo: "ventas.csv" });
  assert.equal(r.status, 200);
  const v = escrito[0].body.valor;
  assert.equal(escrito[0].metodo, "PATCH");
  assert.deepEqual(v.ocultos, ["juicios"]);
  assert.deepEqual(Object.keys(v.ventas_sos).sort(), ["2026-09", "2026-10", "2026-11"]);
  assert.equal(v.ventas_sos["2026-10"].archivo, "ventas.csv");
  assert.equal((await pedir("gerencial", { accion: "ventas", texto: "" })).status, 400);
});

// ─── Pantalla ───

test("pantalla — lo que falta, la propuesta del aguinaldo en el asiento y ocultar", async () => {
  const datos = devengamientoDelMes("2026-11", { ops: OPS, cuentas: CUENTAS, config: {}, hoy: "2026-11-13" });
  const posts = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { posts.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, ocultos: ["juicios"] }), { status: 200 }); }
    return new Response(JSON.stringify({ ...datos, hoy: "2026-11-13", listas: { cuentas: CUENTAS, tipos: [], tesoreria: [], centros: [], proveedores: [], proyectos: [] } }), { status: 200 });
  };
  let ido = null;
  render(<FinanzasDevengamiento onIr={(x) => { ido = x; }} />);
  await screen.findByText(/Falta este mes/);
  assert.ok(screen.getByText(/Servicios de noviembre sin cargar/));
  fireEvent.click(screen.getAllByRole("button", { name: "👷 Ir a Sueldos" })[0]);
  assert.equal(ido, "fin-sueldos");
  const proponer = screen.getAllByRole("button", { name: "✨ Proponer" });
  assert.ok(proponer.length >= 1);
  fireEvent.click(proponer[0]);
  await screen.findByText(/Gypi propone: 1\/12 de los sueldos de noviembre/);
  fireEvent.click(screen.getByRole("button", { name: "Ocultar Juicios" }));
  await waitFor(() => assert.deepEqual(posts[0], { accion: "ocultar", id: "juicios", oculto: true }));
});
