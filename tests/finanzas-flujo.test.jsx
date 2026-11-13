// tests/finanzas-flujo.test.jsx — Finanzas, parte F6b: el flujo de caja real
// por mes (como FLUJO_V2 del libro) y lo que viene por semana.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { flujoDeHoja, validarLineasFlujo, lineaDe, deltaCaja, cajasPorMoneda, flujoReal, flujoPrevisto, saldoCajas, seccionFlujo, lunesDe } from "../app/lib/finanzasFlujo.js";
import { leerLibro } from "../app/lib/finanzas.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/flujo/route.js");
const { default: FinanzasFlujo } = await import("../app/components/FinanzasFlujo.jsx");

const E = "56565656-5656-5656-5656-565656565656";
const EMP = "78787878-7878-7878-7878-787878787878";
const CAJA = "01.01.01.001.001.01";
const BANCO = "01.01.01.003.002";
const USD = "01.01.01.002.001";
const TES = [{ cuenta: CAJA, moneda: "ARS" }, { cuenta: BANCO, moneda: "ARS" }, { cuenta: USD, moneda: "USD" }];
const DIM_FLUJO = [
  ["cod_tipo_op", "linea_flujo", "signo_esperado", "nota", "", "centro_costo", "linea_flujo"],
  ["COBRO TRANSF", "ING_TRANSF", 1, "", "", "DESARROLLISTA NUMA", "DESARR | NUMA"],
  ["PAGO SUELDO", "EGR_SUELDOS", -1],
  ["INVERSIONES DESARROLLISMO", "(por centro de costo → cols F:G)", -1],
  ["TRANSF INTERNA", "TES_TRANSF_INTERNA", 0],
  ["PAGO DE DIVIDENDOS", "DIVIDENDOS", -1],
];
const LINEAS = flujoDeHoja(DIM_FLUJO);
const op = (fecha, tipo, debe, haber, total, extra = {}) => ({ fecha, tipo, cuenta_debe: debe, cuenta_haber: haber, total, total_ars: total, ...extra });
const OPS = [
  op("2026-08-20", "COBRO TRANSF", BANCO, "01.01.02.001.001", 1000),
  op("2026-09-03", "COBRO TRANSF", BANCO, "01.01.02.001.001", 5000),
  op("2026-09-10", "PAGO SUELDO", "02.01.03.001.001", CAJA, 2000),
  op("2026-09-11", "TRANSF INTERNA", CAJA, BANCO, 700),
  op("2026-10-01", "INVERSIONES DESARROLLISMO", "04.09", BANCO, 300, { centro_costo: "Desarrollista Numa" }),
  op("2026-10-02", "INVERSIONES DESARROLLISMO", "04.09", BANCO, 50),
  op("2026-10-03", "PAGO RARO", "04.10", CAJA, 10),
  op("2026-10-04", "PAGO DE DIVIDENDOS", "03.01", USD, 100, { moneda: "USD", total_ars: 120000 }),
  op("2026-10-05", "COMPRA MP", "01.01.04", "02.01.02", 99999),
  op("2026-10-06", "PAGO SUELDO", "02.01.03.001.001", CAJA, 999, { anulada_at: "x" }),
  op("2026-10-06", "PAGO SUELDO", "02.01.03.001.001", CAJA, 999, { estado: "para_revisar" }),
];

test("dim_flujo, línea de cada operación y cuánto mueve la caja", () => {
  assert.deepEqual(LINEAS.tipos, { "COBRO TRANSF": "ING_TRANSF", "PAGO SUELDO": "EGR_SUELDOS", "TRANSF INTERNA": "TES_TRANSF_INTERNA", "PAGO DE DIVIDENDOS": "DIVIDENDOS" });
  assert.deepEqual(LINEAS.centros, { "DESARROLLISTA NUMA": "DESARR | NUMA" });
  assert.ok(flujoDeHoja([["otra"]]).avisos.length);
  assert.equal(lineaDe({ tipo: "cobro transf" }, LINEAS), "ING_TRANSF");
  assert.equal(lineaDe({ tipo: "INVERSIONES DESARROLLISMO", centro_costo: "Desarrollista Numa" }, LINEAS), "DESARR | NUMA");
  assert.equal(lineaDe({ tipo: "INVERSIONES DESARROLLISMO", centro_costo: "OTRA" }, LINEAS), "DESARR | CC NUEVA");
  assert.equal(lineaDe({ tipo: "INVERSIONES DESARROLLISMO" }, LINEAS), "DESARR | SIN CC");
  assert.equal(lineaDe({ tipo: "NADA" }, LINEAS), "SIN CLASIFICAR");
  const cajas = cajasPorMoneda(TES);
  assert.deepEqual(deltaCaja(OPS[1], cajas), { ARS: 5000, USD: 0 });
  assert.deepEqual(deltaCaja(OPS[3], cajas), { ARS: 0, USD: 0 }, "entre dos cajas no mueve");
  assert.deepEqual(deltaCaja(OPS[7], cajas), { ARS: 0, USD: -100 });
  assert.deepEqual([seccionFlujo("EGR_SUELDOS"), seccionFlujo("DESARR | NUMA"), seccionFlujo("DIVIDENDOS"), seccionFlujo("TES_USD"), seccionFlujo("SIN CLASIFICAR")], ["OPE", "INV", "FIN", "TES", "SIN"]);
  assert.deepEqual(validarLineasFlujo({ tipos: { " cobro ": "ING_X", "": "Y" }, centros: 3 }), { tipos: { COBRO: "ING_X" }, centros: {} });
});

test("flujo real — apertura, líneas por sección, neto y cierre por moneda", () => {
  const r = flujoReal({ ops: OPS, tesoreria: TES, lineas: LINEAS, meses: ["2026-09", "2026-10"] });
  const a = r.monedas.ARS;
  assert.equal(a.apertura, 1000, "lo de antes del primer mes");
  const fila = (id) => a.filas.find((f) => f.id === id);
  assert.deepEqual(fila("OPE").valores, [3000, 0]);
  assert.deepEqual(fila("OPE|ING_TRANSF").valores, [5000, 0]);
  assert.equal(fila("OPE|ING_TRANSF").nombre, "Cobros a clientes");
  // Todo Desarrollismo junto, abierto por centro de costo (también el que no tiene)
  assert.deepEqual(fila("INV").valores, [0, -350]);
  assert.equal(fila("INV|INV_DESARROLLISMO").nombre, "Inversiones Desarrollismo");
  assert.deepEqual(fila("INV|INV_DESARROLLISMO").valores, [0, -350]);
  assert.equal(fila("INV|INV_DESARROLLISMO|DESARR | NUMA").nombre, "NUMA");
  assert.equal(fila("INV|INV_DESARROLLISMO|DESARR | NUMA").total, -300);
  assert.equal(fila("INV|INV_DESARROLLISMO|DESARR | SIN CC").nombre, "⚠ Sin centro de costo");
  assert.deepEqual(fila("SIN").valores, [0, -10]);
  // Las demás líneas, abiertas en la cuenta de enfrente de la caja
  assert.equal(fila("OPE|EGR_SUELDOS|02.01.03.001.001").tipo, "cuenta");
  assert.equal(fila("OPE|EGR_SUELDOS|02.01.03.001.001").total, -2000);
  assert.deepEqual(a.neto, [3000, -360], "el detalle no se cuenta dos veces");
  assert.deepEqual(a.cierre, [4000, 3640]);
  assert.deepEqual(r.monedas.USD.cierre, [0, -100]);
  assert.deepEqual(r.tipos_sin_linea, ["INVERSIONES DESARROLLISMO", "PAGO RARO"]);
  assert.equal(saldoCajas(OPS, TES), 3640);
});

test("flujo real — cuentas con nombre y Desarrollismo con cobros, aportes y centro nuevo", () => {
  const cuentas = [{ codigo: "05.03.01", nombre: "Combustibles y lubricantes" }, { codigo: "05.03.02", nombre: "Movilidad" }];
  const lin = { tipos: { "PAGO GASTOS DE LOGÍSTICA": "EGR_LOGISTICA", "COBRO VTA DES": "ING_DESARR_VENTAS" }, centros: { NUMA: "DESARR | NUMA" } };
  const ops = [
    op("2026-10-01", "PAGO GASTOS DE LOGÍSTICA", "05.03.01", CAJA, 100),
    op("2026-10-02", "PAGO GASTOS DE LOGÍSTICA", "05.03.02", CAJA, 40),
    op("2026-10-03", "PAGO GASTOS DE LOGÍSTICA", "05.03.01", BANCO, 60),
    op("2026-10-04", "COBRO VTA DES", BANCO, "04.05", 500),
    op("2026-10-05", "INVERSIONES DESARROLLISMO", "04.09", BANCO, 70, { centro_costo: "Campo" }),
  ];
  const f = flujoReal({ ops, tesoreria: TES, cuentas, lineas: lin, meses: ["2026-10"] }).monedas.ARS.filas;
  const de = (l) => f.filter((x) => x.linea === l && x.tipo !== "linea").map((x) => [x.nombre, x.total]);
  assert.deepEqual(de("EGR_LOGISTICA"), [["Combustibles y lubricantes", -160], ["Movilidad", -40]]);
  assert.deepEqual(de("INV_DESARROLLISMO"), [["Cobros por ventas Desarrollismo", 500], ["Campo (⚠ sin línea en dim_flujo)", -70]]);
  assert.equal(f.filter((x) => x.tipo === "linea" && x.linea === "INV_DESARROLLISMO").length, 1);
});

test("lo que viene — por semana, lo vencido en la primera, saldo proyectado", () => {
  assert.equal(lunesDe("2026-11-09"), "2026-11-09");
  assert.equal(lunesDe("2026-11-15"), "2026-11-09");
  const p = flujoPrevisto({
    hoy: "2026-11-11", saldoHoy: 10000,
    cheques: [
      { clase: "tercero", estado: "en_cartera", fecha_pago: "2026-11-05", importe: 3000, banco: "Galicia", numero: "1" },
      { clase: "propio", estado: "pendiente", fecha_pago: "2026-11-18", importe: 4000, beneficiario: "Acerco" },
      { clase: "propio", estado: "pendiente", fecha_pago: "2027-03-01", importe: 1 },
    ],
    ordenes: [{ estado: "aprobada", fecha: "2026-11-01", total: 500, numero: 7, proveedor_nombre: "Acerco" }, { estado: "pagada", fecha: "2026-11-12", total: 9 }],
    sueldos: [{ fecha: "2026-11-05", importe: 6000, detalle: "Sueldos Octubre 2026" }],
  });
  assert.equal(p.semanas[0], "2026-11-09");
  const f = (id) => p.filas.find((x) => x.id === id);
  assert.deepEqual([f("cheques_terceros").valores[0], f("cheques_propios").valores[1], f("ordenes").valores[0], f("sueldos").valores[0]], [3000, -4000, -500, -6000]);
  assert.equal(f("cheques_propios").despues, -1);
  assert.deepEqual(p.saldo.slice(0, 2), [6500, 2500]);
  assert.equal(f("ordenes").detalle[0][0].texto, "OP N° 7 · Acerco");
});

test("copiar del libro — trae dim_flujo si está", () => {
  const l = leerLibro([{ nombre: "dim_flujo", grilla: DIM_FLUJO }]);
  assert.equal(Object.keys(l.flujo.tipos).length, 4);
  assert.equal(leerLibro([]).flujo, null);
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;

function mockApi() {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: () => ({ status: 200, body: OPS.filter((o) => !o.anulada_at) }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TES }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cheques"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_ordenes_pago"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_liquidaciones"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push(JSON.parse(o.body)); return { status: 201, body: [] }; }
        return { status: 200, body: decodeURIComponent(u).includes("finanzas_flujo") ? [{ valor: LINEAS }] : [] };
      },
    },
  ]);
  return escrito;
}

test("/api/finanzas/flujo — solo el Dueño; el flujo y lo que viene", async () => {
  mockApi();
  const get = async (rol, q = "") => api.GET(new Request(`http://localhost/api/finanzas/flujo${q}`, { headers: { Authorization: `Bearer ${await token(rol)}` } }));
  assert.equal((await get("administrativo")).status, 403);
  const r = await get("gerencial", "?hasta=2026-10");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual(d.monedas.ARS.cierre.slice(-2), [4000, 3640]);
  assert.equal(d.previsto.saldo_hoy, 3640);
  assert.equal(d.lineas_cargadas, 4);
});

test("/api/finanzas/flujo — guardar las líneas", async () => {
  const escrito = mockApi();
  const post = async (body) => api.POST(new Request("http://localhost/api/finanzas/flujo", { method: "POST", headers: { Authorization: `Bearer ${await token("gerencial")}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await post({ accion: "lineas", tipos: {} })).status, 400);
  const r = await post({ accion: "lineas", ...LINEAS });
  assert.equal(r.status, 200);
  assert.equal(escrito[0].valor.tipos["PAGO SUELDO"], "EGR_SUELDOS");
});

// ─── Pantalla ───

test("Flujo de caja — lo que viene, el flujo por mes y dólares", async () => {
  const real = flujoReal({ ops: OPS, tesoreria: TES, lineas: LINEAS, meses: ["2026-09", "2026-10"] });
  const previsto = flujoPrevisto({ hoy: "2026-11-11", saldoHoy: 3640, sueldos: [{ fecha: "2026-11-05", importe: 6000, detalle: "Sueldos Octubre 2026" }] });
  global.fetch = async () => new Response(JSON.stringify({ hasta: "2026-10", ...real, previsto, lineas_cargadas: 4 }), { status: 200 });
  render(<FinanzasFlujo />);
  assert.ok(await screen.findByText("Cobros a clientes"));
  assert.ok(screen.getByText("Saldo al cerrar el mes"));
  assert.ok(screen.getByText("Inversiones Desarrollismo"));
  assert.ok(screen.getByText("NUMA"));
  fireEvent.click(screen.getByLabelText(/Abrir cada línea en sus cuentas/));
  assert.equal(screen.queryByText("NUMA"), null, "sin el detalle quedan las líneas");
  assert.ok(screen.getByText("Inversiones Desarrollismo"));
  fireEvent.click(screen.getByRole("button", { name: /Sueldos por pagar, semana/ }));
  assert.ok(screen.getByText("Sueldos Octubre 2026"));
  fireEvent.click(screen.getByRole("button", { name: "Dólares" }));
  assert.ok(screen.getByText("Pago de dividendos"));
});
