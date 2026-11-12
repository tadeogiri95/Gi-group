// tests/finanzas-inversiones.test.jsx — FCI con el saldo real y títulos
// públicos y privados con láminas y cotización (pedido del 12/11).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  ajusteFci, ajusteTitulos, contextoInversiones, leerTitulos, movimientoTitulo, saldoHasta, valorEspecie, valorTitulos,
} from "../app/lib/finanzasInversiones.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/inversiones/route.js");
const { default: Inversiones } = await import("../app/components/FinanzasInversiones.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const BANCO = "01.01.01.003.002";
const FCI = "01.01.01.099.002";
const TIT = "01.01.01.099.004";
const INT = "04.01.02.002.001";
const DIF = "04.02.01.001.060";
const AJ = "03.01.01.001.002";
const CUENTAS = [
  { codigo: BANCO, nombre: "Banco Credicoop CTA CTE" }, { codigo: FCI, nombre: "FCI" }, { codigo: TIT, nombre: "Titulo Públicos y Privados" },
  { codigo: INT, nombre: "Intereses Ganados" }, { codigo: DIF, nombre: "Diferencia cotización Títulos" }, { codigo: AJ, nombre: "Ajuste De Capital" },
];
const TIPOS = [{ codigo: "RENDIMIENTOS FINANCIEROS" }, { codigo: "INVERSIONES FINANCIERAS" }, { codigo: "VENTA TÍTULOS PÚBLICOS" }, { codigo: "SALDO INICIAL" }];
const { ctx } = contextoInversiones({ tipos: TIPOS, cuentas: CUENTAS });
const OPS = [
  { id: 1, fecha: "2026-10-01", total: 1000000, total_ars: 1000000, cuenta_debe: FCI, cuenta_haber: BANCO },
  { id: 2, fecha: "2026-11-01", total: 200000, total_ars: 200000, cuenta_debe: BANCO, cuenta_haber: FCI },
  { id: 3, fecha: "2026-11-05", total: 50000, total_ars: 50000, cuenta_debe: FCI, cuenta_haber: BANCO, anulada_at: "2026-11-06" },
  { id: 4, fecha: "2026-10-15", total: 300000, total_ars: 300000, cuenta_debe: TIT, cuenta_haber: BANCO },
];

test("contextoInversiones — busca las cuentas y los tipos del libro por nombre", () => {
  assert.equal(ctx.rendimiento, "RENDIMIENTOS FINANCIEROS");
  assert.equal(ctx.intereses, INT);
  assert.equal(ctx.diferencia, DIF);
  assert.equal(ctx.titulos, TIT);
  assert.equal(ctx.ajuste, AJ);
  assert.equal(ctx.compra, "INVERSIONES FINANCIERAS");
  assert.equal(ctx.venta, "VENTA TÍTULOS PÚBLICOS");
  assert.match(contextoInversiones({ tipos: [], cuentas: [] }).errores.join(" "), /RENDIMIENTOS FINANCIEROS.*Intereses Ganados/);
});

test("ajusteFci — la diferencia con el saldo real son los intereses", () => {
  assert.equal(saldoHasta(OPS, FCI), 800000, "lo anulado no cuenta");
  assert.equal(saldoHasta(OPS, FCI, "2026-10-31"), 1000000);
  const caja = { cuenta: FCI, tipo: "fci", moneda: "ARS" };
  const r = ajusteFci({ caja, ops: OPS, saldoReal: 812345.67, fecha: "2026-11-10", hoy: "2026-11-12", ctx });
  assert.deepEqual(r.errores, []);
  assert.equal(r.diferencia, 12345.67);
  assert.equal(r.op.cuenta_debe, FCI);
  assert.equal(r.op.cuenta_haber, INT);
  assert.equal(r.op.total, 12345.67);
  assert.equal(r.op.origen, "fci");
  assert.equal(r.op.origen_id, `fci${FCI}:2026-11-10`);
  assert.match(r.op.descripcion, /Intereses del FCI al 10\/11\/2026/);
  // Si bajó, al revés
  const baja = ajusteFci({ caja, ops: OPS, saldoReal: 799000, fecha: "2026-11-10", hoy: "2026-11-12", ctx });
  assert.equal(baja.op.cuenta_debe, INT);
  assert.equal(baja.op.total, 1000);
  // Igual: nada para cargar
  assert.equal(ajusteFci({ caja, ops: OPS, saldoReal: 800000, fecha: "2026-11-10", hoy: "2026-11-12", ctx }).op, null);
  assert.match(ajusteFci({ caja, ops: OPS, saldoReal: 1, fecha: "2026-12-01", hoy: "2026-11-12", ctx }).errores.join(" "), /futura/);
  assert.match(ajusteFci({ caja: { ...caja, tipo: "banco" }, ops: OPS, saldoReal: 1, fecha: "2026-11-10", ctx }).errores.join(" "), /fondo común/);
});

const GD35 = { id: "GD35-a", especie: "GD35", clase: "publico", moneda: "USD", laminas: 10000, cotizacion: 70, por: 100 };
const YPF = { id: "YPF-b", especie: "YPF", clase: "privado", moneda: "ARS", laminas: 100, cotizacion: 40000, por: 1 };

test("títulos — valor = láminas × cotización (bonos cada 100, acciones por una)", () => {
  assert.equal(valorEspecie(GD35), 7000);
  assert.equal(valorEspecie(YPF), 4000000);
  assert.deepEqual(valorTitulos([GD35, YPF], 1000), { ars: 11000000, falta_tc: false });
  assert.equal(valorTitulos([GD35, YPF]).falta_tc, true);
  const leido = leerTitulos({ especies: [GD35, { especie: "" }, GD35, YPF], tipo_cambio: 1000 });
  assert.deepEqual(leido.especies.map((e) => e.id), ["GD35-a", "YPF-b"], "sin rotos ni repetidos");
  assert.equal(leerTitulos(null).especies.length, 0);
});

test("ajusteTitulos — lleva la cuenta a lo que valen como diferencia de cotización", () => {
  const r = ajusteTitulos({ cuenta: TIT, ops: OPS, especies: [GD35, YPF], tipoCambio: 1000, fecha: "2026-11-12", ctx });
  assert.deepEqual(r.errores, []);
  assert.equal(r.saldo, 300000);
  assert.equal(r.diferencia, 10700000);
  assert.equal(r.op.cuenta_debe, TIT);
  assert.equal(r.op.cuenta_haber, DIF);
  assert.equal(r.op.origen_id, "tit:2026-11-12");
  assert.match(ajusteTitulos({ cuenta: TIT, ops: OPS, especies: [GD35], fecha: "2026-11-12", ctx }).errores.join(" "), /tipo de cambio/);
});

test("movimientoTitulo — compra y venta mueven la plata y las láminas; inicial va contra Ajuste De Capital", () => {
  const tesoreria = [{ cuenta: BANCO, moneda: "ARS", tipo: "banco" }];
  const c = movimientoTitulo({ especie: YPF, como: "compra", laminas: 50, importe: 2000000, caja: BANCO, fecha: "2026-11-12", hoy: "2026-11-12", cuenta: TIT, ctx, tesoreria });
  assert.deepEqual(c.errores, []);
  assert.equal(c.laminas, 150);
  assert.equal(c.op.cuenta_debe, TIT);
  assert.equal(c.op.cuenta_haber, BANCO);
  assert.match(c.op.descripcion, /Compra de 50 láminas de YPF/);
  const v = movimientoTitulo({ especie: YPF, como: "venta", laminas: 100, importe: 4100000, caja: BANCO, fecha: "2026-11-12", hoy: "2026-11-12", cuenta: TIT, ctx, tesoreria });
  assert.equal(v.laminas, 0);
  assert.equal(v.op.cuenta_debe, BANCO);
  assert.equal(v.op.tipo, "VENTA TÍTULOS PÚBLICOS");
  assert.match(movimientoTitulo({ especie: YPF, como: "venta", laminas: 101, importe: 1, caja: BANCO, fecha: "2026-11-12", cuenta: TIT, ctx, tesoreria }).errores.join(" "), /no se pueden vender más/);
  const i = movimientoTitulo({ especie: GD35, como: "inicial", laminas: 10000, importe: 7000000, fecha: "2026-11-12", cuenta: TIT, ctx, tesoreria });
  assert.equal(i.op.cuenta_haber, AJ);
  assert.equal(i.op.tipo, "SALDO INICIAL");
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const pedir = async (rol, metodo, body) => api[metodo](new Request("http://localhost/api/finanzas/inversiones", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ titulos = { especies: [YPF], cuenta: TIT } } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push({ tabla: "config", metodo: o.method, body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        return { status: 200, body: titulos ? [{ valor: titulos }] : [] };
      },
    },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: [{ cuenta: BANCO, nombre: "Banco Credicoop", tipo: "banco", moneda: "ARS", activa: true }, { cuenta: FCI, nombre: "FCI Credicoop", tipo: "fci", moneda: "ARS", activa: true }] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => ({ status: 200, body: TIPOS }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") { const body = JSON.parse(o.body); escrito.push({ tabla: "op", metodo: "POST", body }); return { status: 201, body: [{ id: 99, ...body }] }; }
        if (u.includes("origen_id=eq.")) return { status: 200, body: [] };
        return { status: 200, body: OPS.filter((x) => !x.anulada_at) };
      },
    },
  ]);
  return { escrito };
}

test("/api/finanzas/inversiones GET — FCI con su saldo y títulos con su valor", async () => {
  mockApi();
  const res = await pedir("gerencial", "GET");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual(d.fci, [{ cuenta: FCI, nombre: "FCI Credicoop", moneda: "ARS", saldo: 800000 }]);
  assert.equal(d.titulos.cuenta, TIT);
  assert.equal(d.titulos.saldo, 300000);
  assert.equal(d.titulos.valor, 4000000);
  assert.deepEqual(d.cajas.map((c) => c.cuenta), [BANCO]);
  // Solo el Dueño
  mockApi();
  assert.equal((await pedir("administrativo", "GET")).status, 403);
});

test("/api/finanzas/inversiones POST — FCI, compra y cotización", async () => {
  let m = mockApi();
  let res = await pedir("gerencial", "POST", { accion: "fci", cuenta: FCI, saldo_real: 810000, fecha: "2026-11-10" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).diferencia, 10000);
  assert.equal(m.escrito[0].body.cuenta_haber, INT);
  assert.equal(m.escrito[0].body.empresa_id, E);
  assert.equal(m.escrito[0].body.cargada_por_nombre, "Tadeo");

  m = mockApi();
  res = await pedir("gerencial", "POST", { accion: "titulo_mover", id: "YPF-b", como: "compra", laminas: 10, importe: 400000, caja: BANCO, fecha: "2026-11-10" });
  assert.equal(res.status, 200);
  assert.equal(m.escrito[0].body.cuenta_debe, TIT);
  assert.equal(m.escrito[1].tabla, "config");
  assert.equal(m.escrito[1].metodo, "PATCH");
  assert.equal(m.escrito[1].body.valor.especies[0].laminas, 110);

  m = mockApi();
  res = await pedir("gerencial", "POST", { accion: "cotizar", cotizaciones: { "YPF-b": 41000 }, fecha: "2026-11-10" });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.valor, 4100000);
  assert.equal(m.escrito[0].body.total, 3800000);
  assert.equal(m.escrito[0].body.cuenta_haber, DIF);
  assert.equal(m.escrito[1].body.valor.especies[0].cotizacion, 41000);

  // Agregar uno que ya está, o sacar uno con láminas: no
  mockApi();
  assert.equal((await pedir("gerencial", "POST", { accion: "titulo_alta", como: "cargada", especie: { especie: "ypf", laminas: 1, cotizacion: 1 } })).status, 400);
  mockApi();
  assert.equal((await pedir("gerencial", "POST", { accion: "titulo_quitar", id: "YPF-b" })).status, 400);
  // La primera vez se crea la lista
  m = mockApi({ titulos: null });
  res = await pedir("gerencial", "POST", { accion: "titulo_alta", como: "cargada", especie: { especie: "al30", clase: "publico", moneda: "USD", laminas: 5000, cotizacion: 65, por: 100 } });
  assert.equal(res.status, 200);
  assert.equal(m.escrito.length, 1, "ya cargado: no se carga ninguna operación");
  assert.equal(m.escrito[0].metodo, "POST");
  assert.equal(m.escrito[0].body.valor.especies[0].especie, "AL30");
  assert.equal(m.escrito[0].body.valor.especies[0].laminas, 5000);
});

// ─── Pantalla ───

test("Inversiones — el FCI muestra la diferencia antes de guardar y manda el saldo real", async () => {
  const pedidos = [];
  global.fetch = async (u, o) => {
    if (o?.method === "POST") { pedidos.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, diferencia: 12345.67 }), { status: 200 }); }
    return new Response(JSON.stringify({
      hoy: "2026-11-12", avisos: [], cajas: [{ cuenta: BANCO, nombre: "Banco Credicoop" }],
      fci: [{ cuenta: FCI, nombre: "FCI Credicoop", moneda: "ARS", saldo: 800000 }],
      titulos: { cuenta: TIT, nombre_cuenta: "Titulo Públicos y Privados", saldo: 300000, valor: 4000000, falta_tc: false, tipo_cambio: null, especies: [{ ...YPF, valor: 4000000 }] },
    }), { status: 200 });
  };
  render(<Inversiones />);
  await waitFor(() => screen.getByText("FCI Credicoop"));
  assert.ok(screen.getByRole("table", { name: "Títulos" }));
  assert.ok(screen.getByRole("button", { name: "Vender YPF" }));
  fireEvent.click(screen.getByRole("button", { name: /Actualizar con el saldo real/ }));
  fireEvent.change(screen.getByLabelText("Saldo real"), { target: { value: "812.345,67" } });
  assert.ok(screen.getByText(/Entran \$\s?12\.345,67 de intereses/));
  fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.deepEqual(pedidos[0], { accion: "fci", cuenta: FCI, saldo_real: 812345.67, fecha: "2026-11-12" });
});
