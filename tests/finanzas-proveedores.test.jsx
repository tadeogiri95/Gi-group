// tests/finanzas-proveedores.test.jsx — Finanzas, parte F2a (2): cuenta
// corriente de proveedores (sin migración). Deuda = comprado - pagado, pagos a
// las facturas más viejas, saldos iniciales del libro a una fecha de corte con
// los nombres escritos distinto juntos, y que solo el Dueño entre.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  claveNombre, cuentasProveedores, efectoDeuda, saldosProveedores, movimientosProveedor, pendientesProveedor,
  emparejarProveedor, saldosDelLibro, fechaDelLibro, operacionSaldoInicial,
} from "../app/lib/finanzasProveedores.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/proveedores/route.js");
const { default: FinanzasProveedores } = await import("../app/components/FinanzasProveedores.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const PROV = "02.01.02.001.001";
const AJUSTE = "03.01.01.002.001";
const MP = "01.01.04.001.002";
const BANCO = "01.01.01.003.002";
const CUENTAS = [
  { codigo: MP, nombre: "Materias Primas", activa: true },
  { codigo: BANCO, nombre: "Banco Credicoop CTA CTE", activa: true },
  { codigo: PROV, nombre: "Proveedores", activa: true },
  { codigo: AJUSTE, nombre: "Ajuste De Capital", activa: true },
];
const CP = new Set([PROV]);
const PROVEEDORES = [{ id: 5, nombre: "ACERCO S A", activo: true }, { id: 6, nombre: "BOSQUES DEL SUR SA", activo: true }];
const compra = (id, fecha, total, extra = {}) => ({ id, fecha, tipo: "COMPRA MP", proveedor_id: 5, total_ars: total, total, cuenta_debe: MP, cuenta_haber: PROV, ...extra });
const pago = (id, fecha, total, extra = {}) => ({ id, fecha, tipo: "PAGO TRANSF", proveedor_id: 5, total_ars: total, total, cuenta_debe: PROV, cuenta_haber: BANCO, ...extra });

// ─── Reglas ───

test("nombres — mayúsculas, acentos, puntos y espacios no cuentan", () => {
  assert.equal(claveNombre("Bosques Del Sur S.A."), "BOSQUESDELSURSA");
  assert.equal(claveNombre("BOSQUES DEL SUR S.A. "), claveNombre("bosques del sur sa"));
  assert.equal(claveNombre("Pañol Ñandú"), "PANOLNANDU");
  assert.equal(emparejarProveedor("Bosques del Sur S.A.", PROVEEDORES).id, 6);
  assert.equal(emparejarProveedor("ACERCO S.", PROVEEDORES).id, 5, "abreviado al final");
  assert.equal(emparejarProveedor("Shell", PROVEEDORES), null);
  assert.deepEqual([...cuentasProveedores(CUENTAS)], [PROV]);
});

test("deuda — la compra la sube, el pago la baja, lo anulado y lo que no toca Proveedores no cuenta", () => {
  assert.equal(efectoDeuda(compra(1, "2026-11-01", 100), CP), 100);
  assert.equal(efectoDeuda(pago(2, "2026-11-02", 40), CP), -40);
  assert.equal(efectoDeuda(compra(3, "2026-11-01", 100, { anulada_at: "2026-11-02" }), CP), 0);
  assert.equal(efectoDeuda({ total_ars: 50, cuenta_debe: MP, cuenta_haber: BANCO }, CP), 0);
});

test("saldos — uno por proveedor; los nombres escritos sin proveedor de la lista se juntan", () => {
  const ops = [
    compra(1, "2026-10-01", 1000), pago(2, "2026-10-15", 300),
    compra(3, "2026-10-02", 500, { proveedor_id: null, entidad: "Shell S.A." }),
    compra(4, "2026-10-20", 200, { proveedor_id: null, entidad: "SHELL SA" }),
    pago(5, "2026-10-21", 900, { proveedor_id: 6 }),
  ];
  const s = saldosProveedores(ops, CP, PROVEEDORES);
  assert.deepEqual(s.map((x) => [x.nombre, x.deuda]), [["ACERCO S A", 700], ["Shell S.A.", 700], ["BOSQUES DEL SUR SA", -900]]);
  assert.deepEqual([s[0].comprado, s[0].pagado, s[0].ultimo], [1000, 300, "2026-10-15"]);
  assert.equal(s[1].ultimo, "2026-10-20");
});

test("ficha — saldo renglón por renglón y los pagos van a las facturas más viejas", () => {
  const ops = [compra(3, "2026-10-20", 500), pago(2, "2026-10-10", 1200), compra(1, "2026-10-01", 1000), compra(4, "2026-11-01", 300)];
  const m = movimientosProveedor(ops, "p5", CP);
  assert.deepEqual(m.map((x) => [x.op.id, x.saldo]), [[1, 1000], [2, -200], [3, 300], [4, 600]]);
  const p = pendientesProveedor(m, "2026-11-09");
  assert.deepEqual(p.map((x) => [x.op.id, x.falta, x.dias]), [[3, 300, 20], [4, 300, 8]]);
});

test("libro — suma T-OPERACIONES hasta la fecha de corte, solo confirmadas, por nombre", () => {
  const grilla = [
    ["fecha_operación", "id_entidad", "Total", "cuenta_debe_final", "cuenta_haber_final", "estado"],
    ["46000", "Bosques Del Sur S.A.", "1000", MP, PROV, "CONFIRMADO"],
    ["46001", "BOSQUES DEL SUR S.A.", "400,5", PROV, BANCO, "CONFIRMADO"],
    ["46002", "Bosques del Sur S.A.", "50", MP, PROV, "CONFIRMADO"],
    ["46003", "Bosques Del Sur S.A.", "999", MP, PROV, "BORRADOR"],
    ["46400", "Bosques Del Sur S.A.", "777", MP, PROV, "CONFIRMADO"],
    ["46000", "Shell", "80", MP, BANCO, "CONFIRMADO"],
    ["46000", "Exa", "100", PROV, BANCO, "CONFIRMADO"],
    ["46000", "Cero", "100", MP, PROV, "CONFIRMADO"],
    ["46001", "Cero", "100", PROV, BANCO, "CONFIRMADO"],
  ];
  const { filas, error } = saldosDelLibro(grilla, fechaDelLibro("46010"), CP);
  assert.equal(error, undefined);
  assert.deepEqual(filas.map((f) => [f.nombre, f.deuda, f.variantes]), [["Bosques Del Sur S.A.", 649.5, 3], ["Exa", -100, 1]]);
  assert.equal(saldosDelLibro([["fecha"]], "2026-11-09", CP).error.includes("T-OPERACIONES"), true);
  assert.equal(fechaDelLibro("46000"), "2025-12-09");
  assert.equal(fechaDelLibro("9/3/2026"), "2026-03-09");
  assert.equal(fechaDelLibro("2026-03-09"), "2026-03-09");
  assert.equal(fechaDelLibro("hola"), null);
});

test("saldo inicial — deuda al haber de Proveedores contra Ajuste De Capital; a favor, al revés", () => {
  const ctx = { cuentaProveedores: PROV, cuentaAjuste: AJUSTE };
  const d = operacionSaldoInicial({ fecha: "2026-11-09", proveedor_id: 5, nombre: "ACERCO", deuda: 1500 }, ctx);
  assert.deepEqual([d.cuenta_debe, d.cuenta_haber, d.total_ars, d.origen, d.origen_id, d.entidad], [AJUSTE, PROV, 1500, "saldo_inicial", "p5", null]);
  const f = operacionSaldoInicial({ fecha: "2026-11-09", nombre: "Exa S.A.", deuda: -100 }, ctx);
  assert.deepEqual([f.cuenta_debe, f.cuenta_haber, f.total, f.origen_id, f.entidad], [PROV, AJUSTE, 100, "eEXASA", "Exa S.A."]);
  assert.match(d.descripcion, /09\/11\/2026/);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, metodo, body) => api[metodo](new Request("http://localhost/api/finanzas/proveedores", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ cuentas = CUENTAS } = {}) {
  const escrito = [];
  const leido = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push({ url: u, metodo: o.method, body: JSON.parse(o.body) }); return { status: 201, body: [{}] }; }
        leido.push(u);
        return { status: 200, body: [compra(1, "2026-11-01", 100)] };
      },
    },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: cuentas }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: PROVEEDORES }) },
  ]);
  return { escrito, leido };
}

test("/api/finanzas/proveedores — ni la oficina ni el operario", async () => {
  const { escrito } = mockApi();
  for (const rol of ["administrativo", "operativo"]) {
    assert.equal((await pedir(rol, "GET")).status, 403, rol);
    assert.equal((await pedir(rol, "POST", { accion: "saldos_iniciales", fecha: "2026-11-09", filas: [{ nombre: "X", deuda: 1 }] })).status, 403, rol);
  }
  assert.equal(escrito.length, 0);
});

test("/api/finanzas/proveedores — el Dueño ve las operaciones que tocan Proveedores", async () => {
  const { leido } = mockApi();
  const res = await pedir("gerencial", "GET");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual(d.cuentas_proveedores, [PROV]);
  assert.equal(d.operaciones.length, 1);
  assert.match(decodeURIComponent(leido[0]), /or=\(cuenta_debe\.in\.\(02\.01\.02\.001\.001\),cuenta_haber\.in\.\(02\.01\.02\.001\.001\)\)/);
  assert.match(leido[0], /anulada_at=is\.null/);
});

test("/api/finanzas/proveedores — saldos iniciales: reemplaza el anterior, junta los del mismo proveedor y salta los en cero", async () => {
  const { escrito } = mockApi();
  const res = await pedir("gerencial", "POST", {
    accion: "saldos_iniciales", fecha: "2026-11-09",
    filas: [
      { proveedor_id: 5, nombre: "ACERCO S A", deuda: 1000 },
      { proveedor_id: 5, nombre: "ACERCO SA", deuda: 250.5 },
      { nombre: "Exa S.A.", deuda: -100 },
      { nombre: "Cero", deuda: 0 },
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, cargados: 2 });
  assert.equal(escrito[0].metodo, "PATCH");
  assert.match(decodeURIComponent(escrito[0].url), /origen=eq\.saldo_inicial&anulada_at=is\.null&origen_id=in\.\("p5","eEXASA"\)/);
  assert.ok(escrito[0].body.anulada_at);
  const nuevos = escrito[1].body;
  assert.equal(escrito[1].metodo, "POST");
  assert.deepEqual(nuevos.map((n) => [n.origen_id, n.total, n.cuenta_haber]), [["p5", 1250.5, PROV], ["eEXASA", 100, AJUSTE]]);
  assert.equal(nuevos[0].empresa_id, E);
  assert.equal(nuevos[0].tipo, "SALDO INICIAL");
});

test("/api/finanzas/proveedores — controles: fecha, proveedor que no existe y plan de cuentas sin Ajuste", async () => {
  const { escrito } = mockApi();
  assert.equal((await pedir("gerencial", "POST", { accion: "saldos_iniciales", fecha: "", filas: [{ nombre: "X", deuda: 1 }] })).status, 400);
  assert.equal((await pedir("gerencial", "POST", { accion: "saldos_iniciales", fecha: "2026-11-09", filas: [] })).status, 400);
  const mal = await pedir("gerencial", "POST", { accion: "saldos_iniciales", fecha: "2026-11-09", filas: [{ proveedor_id: 99, nombre: "X", deuda: 1 }] });
  assert.equal(mal.status, 400);
  assert.match((await mal.json()).error, /no está en la lista/);
  assert.equal((await pedir("gerencial", "POST", { accion: "borrar" })).status, 400);
  mockApi({ cuentas: CUENTAS.filter((c) => c.codigo !== AJUSTE) });
  const sin = await pedir("gerencial", "POST", { accion: "saldos_iniciales", fecha: "2026-11-09", filas: [{ nombre: "X", deuda: 1 }] });
  assert.match((await sin.json()).error, /Ajuste De Capital/);
  assert.equal(escrito.length, 0);
});

// ─── Pantalla ───

test("Proveedores — lista con lo que les debemos, ficha con lo que falta pagar", async () => {
  const datos = {
    cuentas: CUENTAS, proveedores: PROVEEDORES, cuentas_proveedores: [PROV],
    operaciones: [compra(1, "2026-10-01", 1000), pago(2, "2026-10-15", 300), pago(3, "2026-10-21", 900, { proveedor_id: 6 })],
  };
  global.fetch = async () => new Response(JSON.stringify(datos), { status: 200 });
  render(<FinanzasProveedores />);
  await waitFor(() => assert.ok(screen.getByText("ACERCO S A")));
  assert.ok(screen.getByText("Le debemos $ 700,00"));
  assert.equal(screen.queryByText("BOSQUES DEL SUR SA"), null, "el que tiene saldo a favor no está en Les debemos");
  fireEvent.click(screen.getByRole("button", { name: /A favor \(1\)/ }));
  await waitFor(() => assert.ok(screen.getByText("A favor $ 900,00")));
  fireEvent.click(screen.getByRole("button", { name: /Les debemos \(1\)/ }));
  fireEvent.click(screen.getByText("ACERCO S A"));
  const falta = await screen.findByRole("table", { name: "Falta pagar" });
  assert.match(falta.textContent, /700,00/);
  fireEvent.click(screen.getByRole("button", { name: /Movimientos \(2\)/ }));
  assert.ok(screen.getByRole("table", { name: "Movimientos del proveedor" }));
});

test("Proveedores — sin el libro copiado manda a Configuración", async () => {
  global.fetch = async () => new Response(JSON.stringify({ cuentas: [], proveedores: [], operaciones: [], cuentas_proveedores: [] }), { status: 200 });
  render(<FinanzasProveedores />);
  await waitFor(() => assert.ok(screen.getByText(/Primero copiá el libro/)));
});
