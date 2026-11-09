// tests/finanzas-tesoreria.test.jsx — Finanzas, parte F3a (sin migración):
// cajas y bancos con el saldo que sale de las operaciones, saldos iniciales
// copiados de T-OPERACIONES y pasar plata entre cajas.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  saldosTesoreria, totalesTesoreria, movimientosDeCaja, saldosCajasDelLibro, operacionSaldoInicialCaja, cuentaAjusteDe, validarTransferencia,
} from "../app/lib/finanzasTesoreria.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/tesoreria/route.js");
const { default: FinanzasTesoreria } = await import("../app/components/FinanzasTesoreria.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const CAJA = { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true, responsable_id: null };
const CAJA_JUAN = { cuenta: "01.01.01.001.001.02", nombre: "Caja Juan", tipo: "caja", moneda: "ARS", activa: true, responsable_id: EMP };
const BANCO = { cuenta: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", tipo: "banco", moneda: "ARS", activa: true };
const DOLAR = { cuenta: "01.01.01.003.009", nombre: "Banco Credicoop Especial Dolar", tipo: "banco", moneda: "USD", activa: true };
const VIEJA = { cuenta: "01.01.01.001.001.09", nombre: "Caja Vieja", tipo: "caja", moneda: "ARS", activa: false };
const TESORERIA = [CAJA, CAJA_JUAN, BANCO, DOLAR, VIEJA];
const CUENTAS = [{ codigo: "03.01.01.003.001", nombre: "Ajuste De Capital" }, { codigo: "02.01.02.001.001", nombre: "Proveedores" }];
const OPS = [
  { id: 1, fecha: "2026-11-01", tipo: "SALDO INICIAL", total: 100000, total_ars: 100000, cuenta_debe: CAJA.cuenta, cuenta_haber: "03.01.01.003.001" },
  { id: 2, fecha: "2026-11-03", tipo: "PAGO EFECTIVO", total: 30000, total_ars: 30000, cuenta_debe: "02.01.02.001.001", cuenta_haber: CAJA.cuenta },
  { id: 3, fecha: "2026-11-02", tipo: "TRANSF INTERNA", total: 20000, total_ars: 20000, cuenta_debe: CAJA_JUAN.cuenta, cuenta_haber: CAJA.cuenta },
  { id: 4, fecha: "2026-11-04", tipo: "COBRO USD", total: 1000, moneda: "USD", tipo_cambio: 1200, total_ars: 1200000, cuenta_debe: DOLAR.cuenta, cuenta_haber: "03.01.01.003.001" },
  { id: 5, fecha: "2026-11-05", tipo: "PAGO EFECTIVO", total: 999, total_ars: 999, cuenta_debe: "02.01.02.001.001", cuenta_haber: CAJA.cuenta, anulada_at: "2026-11-05" },
];

// ─── Reglas ───

test("saldo — entra al debe, sale al haber; las de dólares en USD; sin anuladas", () => {
  const s = saldosTesoreria(OPS, TESORERIA);
  const de = (c) => s.find((x) => x.cuenta === c.cuenta);
  assert.deepEqual([de(CAJA).saldo, de(CAJA).movimientos, de(CAJA).ultimo], [50000, 3, "2026-11-03"]);
  assert.equal(de(CAJA_JUAN).saldo, 20000);
  assert.equal(de(DOLAR).saldo, 1000, "en dólares cuenta el total en USD");
  assert.equal(de(BANCO).ultimo, "");
  assert.deepEqual(totalesTesoreria([...s, { ...VIEJA, saldo: 5 }]), { ARS: 70000, USD: 1000 }, "las inactivas no suman");
});

test("movimientos — del más viejo al más nuevo con el saldo renglón por renglón", () => {
  const m = movimientosDeCaja(OPS, CAJA);
  assert.deepEqual(m.map((x) => [x.op.id, x.entra, x.sale, x.saldo]), [[1, 100000, 0, 100000], [3, 0, 20000, 80000], [2, 0, 30000, 50000]]);
});

test("saldos del libro — solo CONFIRMADO hasta la fecha de corte, por caja de la lista", () => {
  const grilla = [
    ["C", "fecha_operación", "Total", "cuenta_debe_final", "cuenta_haber_final", "estado"],
    ["1", "15/10/2026", "1000,5", CAJA.cuenta, "x", "CONFIRMADO"],
    ["2", "2026-10-20", "300", BANCO.cuenta, CAJA.cuenta, "CONFIRMADO"],
    ["3", "2026-10-21", "50", CAJA.cuenta, "x", "PENDIENTE"],
    ["4", "2026-11-02", "70", CAJA.cuenta, "x", "CONFIRMADO"],
    ["5", "2026-10-22", "10", "otra", "x", "CONFIRMADO"],
  ];
  const r = saldosCajasDelLibro(grilla, "2026-10-31", TESORERIA);
  const por = Object.fromEntries(r.filas.map((f) => [f.cuenta, f.saldo]));
  assert.deepEqual(por, { [CAJA.cuenta]: 700.5, [BANCO.cuenta]: 300 });
  assert.match(saldosCajasDelLibro([["a", "b"]], "2026-10-31", TESORERIA).error, /no tiene las columnas/);
});

test("saldo inicial — contra Ajuste De Capital; negativo al revés; USD con tipo de cambio", () => {
  const aj = cuentaAjusteDe(CUENTAS);
  assert.equal(aj, "03.01.01.003.001");
  const p = operacionSaldoInicialCaja({ fecha: "2026-10-31", caja: CAJA, saldo: 700.5 }, aj);
  assert.deepEqual([p.cuenta_debe, p.cuenta_haber, p.total, p.total_ars, p.origen, p.origen_id, p.tipo], [CAJA.cuenta, aj, 700.5, 700.5, "saldo_inicial", `t${CAJA.cuenta}`, "SALDO INICIAL"]);
  const n = operacionSaldoInicialCaja({ fecha: "2026-10-31", caja: BANCO, saldo: -50 }, aj);
  assert.deepEqual([n.cuenta_debe, n.cuenta_haber, n.total], [aj, BANCO.cuenta, 50]);
  const u = operacionSaldoInicialCaja({ fecha: "2026-10-31", caja: DOLAR, saldo: 10, tipo_cambio: 1200 }, aj);
  assert.deepEqual([u.moneda, u.total, u.tipo_cambio, u.total_ars], ["USD", 10, 1200, 12000]);
});

test("pasar plata — la que recibe al debe; misma moneda, dos distintas, activas; USD pide tipo de cambio", () => {
  const { op, errores } = validarTransferencia({ desde: CAJA.cuenta, hacia: CAJA_JUAN.cuenta, importe: "1500", fecha: "2026-11-09", descripcion: "para viáticos" }, TESORERIA);
  assert.deepEqual(errores, []);
  assert.deepEqual([op.tipo, op.cuenta_debe, op.cuenta_haber, op.total, op.descripcion], ["TRANSFERENCIA ENTRE CAJAS", CAJA_JUAN.cuenta, CAJA.cuenta, 1500, "De Caja Principal a Caja Juan · para viáticos"]);
  assert.match(validarTransferencia({ desde: CAJA.cuenta, hacia: DOLAR.cuenta, importe: 1, fecha: "2026-11-09" }, TESORERIA).errores.join(), /misma moneda/);
  assert.match(validarTransferencia({ desde: CAJA.cuenta, hacia: CAJA.cuenta, importe: 1, fecha: "2026-11-09" }, TESORERIA).errores.join(), /distintas/);
  assert.match(validarTransferencia({ desde: CAJA.cuenta, hacia: VIEJA.cuenta, importe: 1, fecha: "2026-11-09" }, TESORERIA).errores.join(), /a dónde va/);
  assert.match(validarTransferencia({ desde: CAJA.cuenta, hacia: BANCO.cuenta, importe: 0, fecha: "2026-11-09" }, TESORERIA).errores.join(), /mayor a cero/);
  const usd = validarTransferencia({ desde: DOLAR.cuenta, hacia: { ...DOLAR, cuenta: "x" }.cuenta, importe: 1, fecha: "2026-11-09" }, [...TESORERIA, { ...DOLAR, cuenta: "x", nombre: "Caja dólares" }]);
  assert.match(usd.errores.join(), /tipo de cambio/);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, metodo, body) => api[metodo](new Request("http://localhost/api/finanzas/tesoreria", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi() {
  const escrito = [];
  const leido = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TESORERIA }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ url: u, metodo: o.method, body });
          return { status: 201, body: Array.isArray(body) ? body : [{ id: 77, ...body }] };
        }
        leido.push(u);
        return { status: 200, body: OPS.filter((x) => !x.anulada_at) };
      },
    },
  ]);
  return { escrito, leido };
}

test("/api/finanzas/tesoreria — solo el Dueño", async () => {
  const { escrito } = mockApi();
  for (const rol of ["administrativo", "operativo"]) {
    assert.equal((await pedir(rol, "GET")).status, 403, rol);
    assert.equal((await pedir(rol, "POST", { accion: "transferir" })).status, 403, rol);
  }
  assert.equal(escrito.length, 0);
});

test("/api/finanzas/tesoreria — GET trae las cajas y solo las operaciones que las tocan, sin anuladas", async () => {
  const { leido } = mockApi();
  const res = await pedir("gerencial", "GET");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.tesoreria.length, 5);
  assert.equal(d.operaciones.length, 4);
  assert.match(leido[0], /anulada_at=is\.null/);
  assert.match(decodeURIComponent(leido[0]), /cuenta_debe\.in\.\("01\.01\.01\.001\.001\.01"/);
});

test("/api/finanzas/tesoreria — pasar plata guarda una TRANSF INTERNA con quién la cargó", async () => {
  const { escrito } = mockApi();
  const res = await pedir("gerencial", "POST", { accion: "transferir", desde: BANCO.cuenta, hacia: CAJA.cuenta, importe: 5000, fecha: "2026-11-09" });
  assert.equal(res.status, 200);
  assert.deepEqual([escrito[0].body.tipo, escrito[0].body.cuenta_debe, escrito[0].body.cuenta_haber, escrito[0].body.empresa_id, escrito[0].body.cargada_por_nombre], ["TRANSFERENCIA ENTRE CAJAS", CAJA.cuenta, BANCO.cuenta, E, "Tadeo"]);
  const mal = await pedir("gerencial", "POST", { accion: "transferir", desde: BANCO.cuenta, hacia: DOLAR.cuenta, importe: 5000, fecha: "2026-11-09" });
  assert.equal(mal.status, 400);
});

test("/api/finanzas/tesoreria — saldos iniciales: anula los anteriores de esas cajas y carga los nuevos", async () => {
  const { escrito } = mockApi();
  const sinTc = await pedir("gerencial", "POST", { accion: "saldos_iniciales", fecha: "2026-10-31", filas: [{ cuenta: DOLAR.cuenta, saldo: 10 }] });
  assert.equal(sinTc.status, 400);
  const res = await pedir("gerencial", "POST", { accion: "saldos_iniciales", fecha: "2026-10-31", filas: [{ cuenta: CAJA.cuenta, saldo: 700.5 }, { cuenta: BANCO.cuenta, saldo: 0 }] });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cargados, 1);
  const [anula, nuevos] = escrito;
  assert.equal(anula.metodo, "PATCH");
  assert.match(decodeURIComponent(anula.url), /origen=eq\.saldo_inicial.*origen_id=in\.\("t01\.01\.01\.001\.001\.01","t01\.01\.01\.003\.002"\)/);
  assert.ok(anula.body.anulada_at);
  assert.equal(nuevos.metodo, "POST");
  assert.deepEqual(nuevos.body.map((o) => [o.cuenta_debe, o.total, o.empresa_id]), [[CAJA.cuenta, 700.5, E]]);
});

// ─── Pantalla ───

test("Cajas y bancos — grupos con saldo, ficha con movimientos y pasar plata", async () => {
  const datos = { tesoreria: TESORERIA, cuentas: CUENTAS, personal: [{ id: EMP, nombre: "Juan Pérez" }], operaciones: OPS.filter((o) => !o.anulada_at) };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify(datos), { status: 200 });
  };
  render(<FinanzasTesoreria />);
  await waitFor(() => assert.ok(screen.getByText("Caja Principal")));
  assert.ok(screen.getByRole("region", { name: "Cajas" }));
  assert.ok(screen.getByRole("region", { name: "Bancos" }));
  assert.ok(screen.getByText(/Juan Pérez/), "muestra el responsable");
  assert.equal(screen.queryByText("Caja Vieja"), null, "las inactivas no se ven");
  fireEvent.click(screen.getByText("Caja Principal"));
  const tabla = await screen.findByRole("table", { name: "Movimientos de la caja" });
  assert.equal(tabla.querySelectorAll("tbody tr").length, 3);
  fireEvent.click(screen.getByText("⇄ Pasar plata desde esta caja"));
  assert.equal(screen.getByLabelText("Sale de").value, CAJA.cuenta);
  fireEvent.change(screen.getByLabelText("Va a"), { target: { value: CAJA_JUAN.cuenta } });
  fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "1.500,50" } });
  fireEvent.click(screen.getByRole("button", { name: "Pasar la plata" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].desde, enviados[0].hacia, enviados[0].importe], ["transferir", CAJA.cuenta, CAJA_JUAN.cuenta, 1500.5]);
});
