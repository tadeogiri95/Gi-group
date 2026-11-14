// tests/finanzas-anticipos.test.jsx — anticipos de sueldo de los dueños
// (14/11): sueldo fijo, anticipos por combustible del mes en su caja y
// descuento al pagar el sueldo.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  anticiposPorMes, cuentaAnticipos, descontadosDe, leerFijos, mesDeLiquidacion, operacionDescuentoAnticipos, resumenAnticipos,
} from "../app/lib/finanzasAnticipos.js";
import { leerConfigSueldos, validarConfigSueldos } from "../app/lib/finanzasSueldos.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/sueldos/route.js");
const { AnticiposSueldo } = await import("../app/components/MiCaja.jsx");

const E = "77777777-7777-7777-7777-777777777777";
const EMP = "66666666-6666-6666-6666-666666666666";
const DUENO = "e1";
const ANT = "01.01.03.014.001";
const APAGAR = "02.01.03.001.001";
const CAJA_EZE = "01.01.01.001.001.03";
const BANCO = "01.01.01.003.002";
const CUENTAS = [
  { codigo: ANT, nombre: "Anticipo De Sueldos" }, { codigo: APAGAR, nombre: "Sueldos A Pagar" },
  { codigo: "04.02.01.007.001", nombre: "Sueldos, Jornales y Contribuciones" }, { codigo: "04.02.01.001.005", nombre: "Combustibles Y Lubricantes" },
];
const carga = (id, fecha, total, extra = {}) => ({
  id, fecha, total, total_ars: total, cuenta_debe: ANT, cuenta_haber: CAJA_EZE, descripcion: "Anticipo de sueldo por carga de combustible · Caja Ezequiel", ...extra,
});
// El ejemplo de Tadeo: sueldo 100, anticipos 10, 10 y 15 en noviembre
const OPS = [
  carga(1, "2026-11-03", 10), carga(2, "2026-11-12", 10), carga(3, "2026-11-20", 15),
  carga(4, "2026-11-21", 99, { anulada_at: "2026-11-21" }),
  carga(5, "2026-11-22", 50, { descripcion: "Adelanto de sueldo · Caja Ezequiel" }),
  carga(6, "2026-11-22", 40, { cuenta_haber: "otra caja" }),
  { id: 7, fecha: "2026-11-05", total: 500, total_ars: 500, cuenta_debe: "04.02.01.001.005", cuenta_haber: CAJA_EZE, descripcion: "Combustible · Caja Ezequiel" },
];

test("el ejemplo — 10 + 10 + 15 = 35 de anticipos; del sueldo de 100 quedan 65 para liquidar", () => {
  const r = resumenAnticipos({ ops: OPS, cuentaAnticipo: ANT, cajas: [CAJA_EZE], sueldo: 100, empleadoId: DUENO, hoy: "2026-11-25" });
  assert.equal(r.meses.length, 1);
  assert.deepEqual(r.meses[0].lineas, [{ nombre: "Anticipos de sueldo por cargas de combustible - Noviembre", importe: 35 }]);
  assert.equal(r.meses[0].a_liquidar, 65);
  assert.equal(r.sueldo, 100);
  assert.equal(resumenAnticipos({ ops: OPS, cuentaAnticipo: ANT, cajas: [CAJA_EZE], sueldo: 0, empleadoId: DUENO, hoy: "2026-11-25" }), null, "sin sueldo fijo no se muestra");
});

test("en diciembre — noviembre sigue a la vista hasta que se descuenta al pagar el sueldo", () => {
  const base = { ops: OPS, cuentaAnticipo: ANT, cajas: [CAJA_EZE], sueldo: 100, empleadoId: DUENO, hoy: "2026-12-03" };
  let r = resumenAnticipos(base);
  assert.deepEqual(r.meses.map((m) => [m.nombre, m.anticipos, m.a_liquidar]), [["Diciembre", 0, 100], ["Noviembre", 35, 65]]);
  const descuento = { id: 90, origen: "pago_sueldo", origen_id: `l7:${DUENO}:a202611`, total: 35, total_ars: 35 };
  assert.deepEqual(descontadosDe([descuento, { ...descuento, origen_id: "l7:otro:a202611" }], DUENO), { "2026-11": 35 });
  r = resumenAnticipos({ ...base, descuentos: [descuento] });
  assert.deepEqual(r.meses.map((m) => m.nombre), ["Diciembre"]);
});

test("solo las cargas de combustible desde sus cajas: no un adelanto (puede ser de un empleado), no otra caja, no anuladas", () => {
  const m = anticiposPorMes(OPS, { cuentaAnticipo: ANT, cajas: [CAJA_EZE] });
  assert.equal(m.get("2026-11").total, 35);
  assert.equal(cuentaAnticipos(CUENTAS), ANT);
});

test("el mes de la liquidación — por el período, o por la fecha", () => {
  assert.equal(mesDeLiquidacion({ periodo: "Noviembre 2026", fecha: "2026-12-05" }), "2026-11");
  assert.equal(mesDeLiquidacion({ periodo: "Sueldos nov", fecha: "2026-11-30" }), "2026-11");
});

test("sueldo fijo — se guarda en la configuración de Sueldos", () => {
  const { valor, errores } = validarConfigSueldos({ conceptos: [], areas: {}, fijos: { [DUENO]: "100.000,50", e2: "" } }, CUENTAS);
  assert.deepEqual(errores, []);
  assert.deepEqual(valor.fijos, { [DUENO]: 100000.5 });
  assert.match(validarConfigSueldos({ fijos: { [DUENO]: "-3" } }, CUENTAS).errores[0], /mayor a cero/);
  assert.deepEqual(leerConfigSueldos({ fijos: { [DUENO]: 100, malo: "x" } }, CUENTAS).fijos, { [DUENO]: 100 });
  assert.deepEqual(leerFijos(null), {});
});

test("el descuento — Sueldos A Pagar contra Anticipo de sueldos, cuenta como pagado", () => {
  const op = operacionDescuentoAnticipos({ liq: { id: 7, periodo: "Noviembre 2026" }, renglon: { empleado_id: DUENO, nombre: "Ezequiel" }, importe: 35, fecha: "2026-12-05", mes: "2026-11" }, { cuentaAPagar: APAGAR, cuentaAnticipo: ANT });
  assert.deepEqual([op.cuenta_debe, op.cuenta_haber, op.total, op.tipo, op.origen, op.origen_id], [APAGAR, ANT, 35, "SUELDOS", "pago_sueldo", `l7:${DUENO}:a202611`]);
  assert.match(op.descripcion, /Descuento de anticipos de sueldo de Noviembre/);
});

// ─── Servidor: pagar con descuento ───

const LIQ = { id: 7, empresa_id: E, periodo: "Noviembre 2026", fecha: "2026-11-30", estado: "confirmada", renglones: [{ empleado_id: DUENO, nombre: "Ezequiel", valores: { basico: 100 } }] };

function mockApi({ pagos = [] } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?") && u.includes(`id=eq.${EMP}`), respond: () => ({ status: 200, body: [{ nombre: "Tadeo" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: DUENO, nombre: "Ezequiel", activo: true }] }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: [{ cuenta: BANCO, nombre: "Credicoop", tipo: "banco", moneda: "ARS" }, { cuenta: CAJA_EZE, nombre: "Caja Ezequiel", tipo: "caja", moneda: "ARS", responsable_id: DUENO }] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [{ valor: { conceptos: [], areas: {}, fijos: { [DUENO]: 100 } } }] }) },
    { match: (u) => u.includes("/rest/v1/fin_liquidaciones"), respond: () => ({ status: 200, body: [LIQ] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") { escrito.push(JSON.parse(o.body)); return { status: 201, body: [] }; }
        if (decodeURIComponent(u).includes(`cuenta_debe=eq.${ANT}`)) return { status: 200, body: OPS.filter((x) => x.cuenta_debe === ANT && !x.anulada_at) };
        return { status: 200, body: pagos };
      },
    },
  ]);
  return escrito;
}
const pedir = async (body) => api.POST(new Request("http://localhost/api/finanzas/sueldos", {
  method: "POST",
  headers: { Authorization: `Bearer ${(await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol: "gerencial" })).token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));

test("/api/finanzas/sueldos — pagar descontando los anticipos: 35 contra el anticipo y 65 desde el banco", async () => {
  const escrito = mockApi();
  assert.equal((await pedir({ accion: "pagar", id: 7, pagos: [{ empleado_id: DUENO, importe: 70, cuenta: BANCO, fecha: "2026-12-05", descontar: true }] })).status, 400, "70 + 35 pasa los 100");
  const r = await pedir({ accion: "pagar", id: 7, pagos: [{ empleado_id: DUENO, importe: 65, cuenta: BANCO, fecha: "2026-12-05", descontar: true }] });
  assert.equal(r.status, 200);
  const ops = escrito.at(-1);
  assert.deepEqual(ops.map((o) => [o.cuenta_debe, o.cuenta_haber, o.total, o.origen_id]), [[APAGAR, ANT, 35, `l7:${DUENO}:a202611`], [APAGAR, BANCO, 65, `l7:${DUENO}:1`]]);
});

test("/api/finanzas/sueldos — no descuenta dos veces el mismo mes", async () => {
  mockApi({ pagos: [{ id: 90, origen: "pago_sueldo", origen_id: `l7:${DUENO}:a202611`, total: 35, total_ars: 35 }] });
  const r = await pedir({ accion: "pagar", id: 7, pagos: [{ empleado_id: DUENO, importe: 65, cuenta: BANCO, fecha: "2026-12-05", descontar: true }] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /no tiene anticipos/);
});

// ─── Pantalla ───

test("Mi caja — el dueño ve los anticipos del mes y el sueldo a liquidar", () => {
  const resumen = resumenAnticipos({ ops: OPS, cuentaAnticipo: ANT, cajas: [CAJA_EZE], sueldo: 100, empleadoId: DUENO, hoy: "2026-11-25" });
  render(<AnticiposSueldo resumen={resumen} />);
  assert.ok(screen.getByText("Anticipos de sueldo por cargas de combustible - Noviembre"));
  assert.ok(screen.getByText("$ 35,00"));
  assert.ok(screen.getByText("Sueldo Noviembre a liquidar"));
  assert.ok(screen.getByText("$ 65,00"));
});
