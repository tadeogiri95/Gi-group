// tests/finanzas-clientes.test.jsx — Finanzas, parte F4a (migración 177):
// clientes con sus otros nombres, cuenta corriente contra Deudores por
// Ventas, saldos iniciales del libro y cobros (efectivo, transferencia,
// cheque a la cartera y dólares como en el libro).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  cuentasDeudores, indiceClientes, claveCliente, saldosClientes, movimientosCliente, saldoPorOt, emparejarCliente, saldosClientesDelLibro,
  operacionSaldoInicialCliente, clientesNuevosDeOt, validarCliente, unirClientes, armarCobro,
} from "../app/lib/finanzasClientes.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/clientes/route.js");
const { default: FinanzasClientes } = await import("../app/components/FinanzasClientes.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const DEU = "01.01.02.001.001";
const AJ = "03.01.01.002.001";
const CUENTAS = [
  { codigo: DEU, nombre: "Deudores Por Ventas", activa: true },
  { codigo: AJ, nombre: "Ajuste De Capital", activa: true },
  { codigo: "04.01.01.001.002", nombre: "Entregas Generales", activa: true },
  { codigo: "01.01.01.002.001", nombre: "Valores A Depositar", activa: true },
  { codigo: "01.01.01.022.001", nombre: "Valores A Depositar - E-Cheq", activa: true },
];
const CAJA = { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true };
const BANCO = { cuenta: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", tipo: "banco", moneda: "ARS", activa: true };
const DOLAR = { cuenta: "01.01.01.008.001", nombre: "Moneda Extranjera", tipo: "caja", moneda: "USD", activa: true };
const TESORERIA = [CAJA, BANCO, DOLAR];
const STOM = { id: 1, nombre: "STOM SAS", alias: ["STOM"], activo: true };
const BCG = { id: 2, nombre: "BCG", alias: [], activo: true };
const VIEJO = { id: 3, nombre: "TWINS INGENIERIA S R L", alias: [], activo: false, unido_a: 4 };
const TWINS = { id: 4, nombre: "TWINS INGENIERIA S.R.L", alias: [], activo: true };
const CLIENTES = [STOM, BCG, VIEJO, TWINS];
const PROYECTOS = [{ id: 10, ot: "M-7100", cliente: "BCG", obra: "HOTEL AMANCAY" }, { id: 11, ot: "M-7370", cliente: "CRISTANI GABRIEL", obra: "CASA" }, { id: 12, ot: "M-7371", cliente: "Stom", obra: "X" }];
const OPS = [
  { id: 1, fecha: "2026-09-01", tipo: "SALDO INICIAL", cliente_id: 2, entidad: "BCG", total_ars: 100000, cuenta_debe: DEU, cuenta_haber: AJ },
  { id: 2, fecha: "2026-10-01", tipo: "VENTA", cliente_id: 2, total_ars: 50000, cuenta_debe: DEU, cuenta_haber: "04.01.01.001.002", proyecto_id: 10 },
  { id: 3, fecha: "2026-10-05", tipo: "COBRO TRANSF", cliente_id: 2, total_ars: 30000, cuenta_debe: BANCO.cuenta, cuenta_haber: DEU, proyecto_id: 10 },
  { id: 4, fecha: "2026-10-06", tipo: "RECEPCIÓN ECHEQ", entidad: "Stom", total_ars: 20000, cuenta_debe: "01.01.01.022.001", cuenta_haber: DEU },
  { id: 5, fecha: "2026-10-07", tipo: "COBRO EFECTIVO", cliente_id: 3, total_ars: 5000, cuenta_debe: CAJA.cuenta, cuenta_haber: DEU },
  { id: 6, fecha: "2026-10-08", tipo: "COBRO EFECTIVO", entidad: "Nadie Conocido", total_ars: 1000, cuenta_debe: CAJA.cuenta, cuenta_haber: DEU },
  { id: 7, fecha: "2026-10-09", tipo: "COBRO EFECTIVO", cliente_id: 2, total_ars: 999, cuenta_debe: CAJA.cuenta, cuenta_haber: DEU, anulada_at: "x" },
];
const DEUS = cuentasDeudores(CUENTAS);

// ─── Reglas ───

test("de quién es — el cliente, o el que tiene ese nombre o alias; los unidos van al que quedó", () => {
  const ix = indiceClientes(CLIENTES);
  assert.equal(claveCliente({ cliente_id: 2 }, ix), "c2");
  assert.equal(claveCliente({ entidad: "stom" }, ix), "c1", "por alias, sin mayúsculas");
  assert.equal(claveCliente({ cliente_id: 3 }, ix), "c4", "unido a TWINS S.R.L");
  assert.equal(claveCliente({ entidad: "TWINS INGENIERIA S R L" }, ix), "c4");
  assert.equal(claveCliente({ entidad: "Nadie Conocido" }, ix), "eNADIECONOCIDO");
});

test("cuenta corriente — al debe nos deben más, al haber cobramos; activos sin movimientos también", () => {
  const s = saldosClientes(OPS, DEUS, CLIENTES);
  const de = (k) => s.find((x) => x.clave === k);
  assert.deepEqual([de("c2").vendido, de("c2").cobrado, de("c2").saldo], [150000, 30000, 120000]);
  assert.equal(de("c1").saldo, -20000, "a favor");
  assert.equal(de("c4").saldo, -5000);
  assert.equal(de("eNADIECONOCIDO").cliente_id, null);
  assert.equal(s.some((x) => x.clave === "c3"), false, "el unido no aparece");
  const m = movimientosCliente(OPS, "c2", DEUS, CLIENTES);
  assert.deepEqual(m.map((x) => [x.op.id, x.venta, x.cobro, x.saldo]), [[1, 100000, 0, 100000], [2, 50000, 0, 150000], [3, 0, 30000, 120000]]);
  assert.deepEqual(saldoPorOt(m), [{ proyecto_id: 10, vendido: 50000, cobrado: 30000, falta: 20000 }]);
});

test("emparejar y traer de las OT — por nombre, alias o uno que empieza con el otro", () => {
  assert.equal(emparejarCliente("Stom S.A.S.", CLIENTES)?.id, 1);
  assert.equal(emparejarCliente("bcg", CLIENTES)?.id, 2);
  assert.equal(emparejarCliente("TWINS INGENIERIA S R L", CLIENTES)?.id, 4, "el inactivo no; el que empieza igual sí");
  assert.equal(emparejarCliente("Otro", CLIENTES), null);
  assert.deepEqual(clientesNuevosDeOt(PROYECTOS, CLIENTES), ["CRISTANI GABRIEL"]);
});

test("datos del cliente y unir", () => {
  assert.match(validarCliente({ nombre: " " }).errores.join(), /nombre/);
  assert.match(validarCliente({ nombre: "X", email: "malo" }).errores.join(), /email/);
  assert.deepEqual(validarCliente({ nombre: "STOM SAS", alias: ["stom sas", "STOM", "STOM"] }).cliente.alias, ["STOM"]);
  assert.deepEqual(unirClientes(TWINS, { ...VIEJO, alias: ["TWINS"] }), { a: { alias: ["TWINS"] }, b: { activo: false, unido_a: 4 } });
});

test("saldos del libro — al debe de Deudores sube, juntando nombres; saldo inicial contra Ajuste De Capital", () => {
  const grilla = [
    ["fecha_operación", "id_entidad", "Total", "cuenta_debe_final", "cuenta_haber_final", "estado"],
    ["01/10/2026", "STOM", "1000", DEU, "04.01.01.001.002", "CONFIRMADO"],
    ["02/10/2026", "Stom.", "300", BANCO.cuenta, DEU, "CONFIRMADO"],
    ["03/10/2026", "BCG", "500", BANCO.cuenta, DEU, "CONFIRMADO"],
    ["05/11/2026", "BCG", "9999", DEU, "x", "CONFIRMADO"],
  ];
  const r = saldosClientesDelLibro(grilla, "2026-10-31", DEUS);
  assert.deepEqual(r.filas.map((f) => [f.nombre, f.saldo, f.variantes]), [["STOM", 700, 2], ["BCG", -500, 1]]);
  const p = operacionSaldoInicialCliente({ fecha: "2026-10-31", cliente: STOM, saldo: 700 }, { cuentaDeudores: DEU, cuentaAjuste: AJ });
  assert.deepEqual([p.cuenta_debe, p.cuenta_haber, p.cliente_id, p.entidad, p.origen_id, p.total], [DEU, AJ, 1, "STOM SAS", "c1", 700]);
  const n = operacionSaldoInicialCliente({ fecha: "2026-10-31", cliente: BCG, saldo: -500 }, { cuentaDeudores: DEU, cuentaAjuste: AJ });
  assert.deepEqual([n.cuenta_debe, n.cuenta_haber], [AJ, DEU]);
});

const CTX = { cliente: BCG, cuentas: CUENTAS, tesoreria: TESORERIA, proyectos: PROYECTOS, grupo: "cb0123456789ab" };

test("cobrar — efectivo a una caja y transferencia a un banco, contra Deudores, con OT", () => {
  const r = armarCobro({ fecha: "2026-11-09", proyecto_id: 10, notas: "seña", formas: [
    { forma: "efectivo", importe: 1000, cuenta: CAJA.cuenta },
    { forma: "transferencia", importe: "2500.5", cuenta: BANCO.cuenta },
  ] }, CTX);
  assert.deepEqual(r.errores, []);
  assert.equal(r.total, 3500.5);
  assert.deepEqual(r.ops.map((o) => [o.tipo, o.cuenta_debe, o.cuenta_haber, o.total_ars, o.cliente_id, o.entidad, o.proyecto_id, o.origen, o.origen_id]), [
    ["COBRO A CLIENTES", CAJA.cuenta, DEU, 1000, 2, "BCG", 10, "cobro", "cb0123456789ab:0"],
    ["COBRO A CLIENTES", BANCO.cuenta, DEU, 2500.5, 2, "BCG", 10, "cobro", "cb0123456789ab:1"],
  ]);
  assert.match(r.ops[0].descripcion, /Cobro a BCG · Efectivo a Caja Principal · seña/);
});

test("cobrar — dólares como en el libro: la caja en USD contra Ajuste y el cliente en pesos", () => {
  const r = armarCobro({ fecha: "2026-11-09", formas: [{ forma: "dolares", importe: 4000, tipo_cambio: 1533.6, cuenta: DOLAR.cuenta }] }, CTX);
  assert.deepEqual(r.errores, []);
  const [a, b] = r.ops;
  assert.deepEqual([a.cuenta_debe, a.cuenta_haber, a.moneda, a.total, a.tipo_cambio, a.total_ars], [DOLAR.cuenta, AJ, "USD", 4000, 1533.6, 6134400]);
  assert.deepEqual([b.cuenta_debe, b.cuenta_haber, b.moneda, b.total, b.total_ars, b.cliente_id], [AJ, DEU, "ARS", 6134400, 6134400, 2]);
  assert.equal(r.total, 6134400);
});

test("cobrar — cheque a la cartera; y lo que no corresponde se rechaza", () => {
  const r = armarCobro({ fecha: "2026-11-09", formas: [{ forma: "cheque", importe: 5000, tipo_cheque: "echeq_diferido", banco: "Galicia", numero: "77", fecha_pago: "2026-12-09" }] }, CTX);
  assert.deepEqual(r.errores, []);
  assert.deepEqual([r.cheques[0].cheque.clase, r.cheques[0].cheque.estado, r.cheques[0].cheque.recibido_de, r.cheques[0].op.tipo, r.cheques[0].op.cliente_id], ["tercero", "en_cartera", "BCG", "COBRO A CLIENTES", 2]);
  const err = (forma) => armarCobro({ fecha: "2026-11-09", formas: [forma] }, CTX).errores.join(" | ");
  assert.match(err({ forma: "efectivo", importe: 10, cuenta: BANCO.cuenta }), /caja donde entró/);
  assert.match(err({ forma: "transferencia", importe: 10, cuenta: CAJA.cuenta }), /banco donde entró/);
  assert.match(err({ forma: "dolares", importe: 10, cuenta: DOLAR.cuenta }), /tipo de cambio/);
  assert.match(err({ forma: "dolares", importe: 10, tipo_cambio: 1000, cuenta: CAJA.cuenta }), /en dólares/);
  assert.match(err({ forma: "cheque", importe: 10, tipo_cheque: "echeq_diferido" }), /fecha de pago/);
  assert.match(err({ forma: "efectivo", importe: 0, cuenta: CAJA.cuenta }), /mayor a cero/);
  assert.match(armarCobro({ fecha: "2026-11-09", proyecto_id: 99, formas: [{ forma: "efectivo", importe: 1, cuenta: CAJA.cuenta }] }, CTX).errores.join(), /OT/);
  assert.match(armarCobro({ fecha: "2026-11-09", formas: [] }, { ...CTX, cliente: VIEJO }).errores.join(), /cliente/);
});

test("migración 177 — fin_clientes con RLS solo Dueño y cliente_id en las operaciones", () => {
  const sql = readFileSync(new URL("../supabase/migrations/177_finanzas_clientes.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /create table if not exists public\.fin_clientes/);
  assert.match(sql, /add column if not exists cliente_id bigint references public\.fin_clientes/);
  assert.match(sql, /->>'rol'\) = 'gerencial'/);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*fin_clientes/);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, metodo, body) => api[metodo](new Request("http://localhost/api/finanzas/clientes", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ sin177 = false, cheques = [] } = {}) {
  const escrito = [];
  const leido = [];
  let idCheque = 50;
  let idCliente = 100;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TESORERIA }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: PROYECTOS }) },
    {
      match: (u) => u.includes("/rest/v1/fin_clientes"),
      respond: (u, o) => {
        if (sin177) return { status: 404, body: { code: "42P01", message: 'relation "public.fin_clientes" does not exist' } };
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "fin_clientes", url: u, metodo: o.method, body });
          return { status: 201, body: (Array.isArray(body) ? body : [body]).map((b) => ({ id: idCliente++, alias: [], activo: true, ...b })) };
        }
        leido.push(u);
        return { status: 200, body: CLIENTES };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_cheques"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "fin_cheques", url: u, metodo: o.method, body });
          return { status: 201, body: [{ id: idCheque++, ...body }] };
        }
        return { status: 200, body: cheques };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "fin_operaciones", url: u, metodo: o.method, body });
          return { status: 201, body: (Array.isArray(body) ? body : [body]).map((b, i) => ({ id: 70 + i, ...b })) };
        }
        leido.push(u);
        return { status: 200, body: u.includes("origen_id=like.") ? [{ id: 71 }, { id: 72 }] : OPS };
      },
    },
  ]);
  return { escrito, leido };
}

test("/api/finanzas/clientes — solo el Dueño; sin la 177 avisa", async () => {
  const { escrito } = mockApi();
  for (const rol of ["administrativo", "operativo"]) {
    assert.equal((await pedir(rol, "GET")).status, 403, rol);
    assert.equal((await pedir(rol, "POST", { accion: "cobrar" })).status, 403, rol);
  }
  assert.equal(escrito.length, 0);
  mockApi({ sin177: true });
  const r = await pedir("gerencial", "GET");
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /migración 177/);
});

test("/api/finanzas/clientes — GET trae clientes y solo lo que toca Deudores por Ventas", async () => {
  const { leido } = mockApi();
  const r = await pedir("gerencial", "GET");
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(d.cuentas_deudores, [DEU]);
  assert.match(decodeURIComponent(leido.find((u) => u.includes("fin_operaciones"))), /cuenta_debe\.in\.\("01\.01\.02\.001\.001"\)/);
});

test("/api/finanzas/clientes — cobrar con cheque: el cheque a la cartera y su operación con el cliente", async () => {
  const { escrito } = mockApi();
  const r = await pedir("gerencial", "POST", { accion: "cobrar", cliente_id: 2, fecha: "2026-11-09", proyecto_id: 10, formas: [
    { forma: "efectivo", importe: 1000, cuenta: CAJA.cuenta },
    { forma: "cheque", importe: 5000, tipo_cheque: "cheque_fisico", banco: "Bancor", numero: "9", fecha_pago: "2026-12-01" },
  ] });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.total, 6000);
  const [efectivo, cheque, opCheque, union] = escrito;
  assert.deepEqual([efectivo.tabla, efectivo.body[0].tipo, efectivo.body[0].cliente_id, efectivo.body[0].cargada_por_nombre], ["fin_operaciones", "COBRO A CLIENTES", 2, "Tadeo"]);
  assert.deepEqual([cheque.tabla, cheque.body.estado, cheque.body.recibido_de, cheque.body.origen], ["fin_cheques", "en_cartera", "BCG", "manual"]);
  assert.deepEqual([opCheque.body.tipo, opCheque.body.cuenta_debe, opCheque.body.cuenta_haber, opCheque.body.cliente_id, opCheque.body.proyecto_id, opCheque.body.origen],
    ["COBRO A CLIENTES", "01.01.01.002.001", DEU, 2, 10, "cobro"]);
  assert.match(opCheque.body.origen_id, new RegExp(`^${d.grupo}:1$`));
  assert.deepEqual([union.tabla, union.body.op_alta_id], ["fin_cheques", 70]);
});

test("/api/finanzas/clientes — anular un cobro: no si el cheque ya se usó", async () => {
  let { escrito } = mockApi({ cheques: [{ id: 50, estado: "depositado", numero: "9" }] });
  let r = await pedir("gerencial", "POST", { accion: "anular_cobro", grupo: "cb0123456789ab" });
  assert.equal(r.status, 409);
  assert.equal(escrito.length, 0);
  ({ escrito } = mockApi({ cheques: [{ id: 50, estado: "en_cartera" }] }));
  r = await pedir("gerencial", "POST", { accion: "anular_cobro", grupo: "cb0123456789ab" });
  assert.equal(r.status, 200);
  assert.match(escrito[0].url, /id=in\.\(71,72\)/);
  assert.ok(escrito[0].body.anulada_at);
  assert.deepEqual([escrito[1].tabla, escrito[1].body.estado], ["fin_cheques", "anulado"]);
  assert.equal((await pedir("gerencial", "POST", { accion: "anular_cobro", grupo: "x;drop" })).status, 400);
});

test("/api/finanzas/clientes — saldos iniciales: crea los que faltan y junta dos nombres del mismo", async () => {
  const { escrito } = mockApi();
  const r = await pedir("gerencial", "POST", { accion: "saldos_iniciales", fecha: "2026-10-31", filas: [
    { nombre: "STOM", saldo: 700 }, { nombre: "Stom S.A.S", saldo: 300 }, { cliente_id: 2, nombre: "BCG", saldo: -500 }, { nombre: "CRISTANI GABRIEL", saldo: 80 },
  ] });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual([d.cargados, d.clientes_nuevos], [3, 1]);
  assert.deepEqual([escrito[0].tabla, escrito[0].body.nombre], ["fin_clientes", "CRISTANI GABRIEL"]);
  const nuevos = escrito.find((x) => x.tabla === "fin_operaciones" && x.metodo === "POST").body;
  assert.deepEqual(nuevos.map((o) => [o.cliente_id, o.cuenta_debe, o.total]), [[1, DEU, 1000], [2, AJ, 500], [100, DEU, 80]]);
});

test("/api/finanzas/clientes — traer de las OT y unir", async () => {
  let { escrito } = mockApi();
  let r = await pedir("gerencial", "POST", { accion: "traer_de_ot" });
  assert.equal((await r.json()).agregados, 1);
  assert.deepEqual(escrito[0].body.map((c) => c.nombre), ["CRISTANI GABRIEL"]);
  ({ escrito } = mockApi());
  r = await pedir("gerencial", "POST", { accion: "unir", a: 2, b: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(escrito.map((x) => [x.tabla, x.url.match(/[?&](?:cliente_)?id=eq\.(\d+)/)?.[1]]), [["fin_clientes", "2"], ["fin_clientes", "1"], ["fin_operaciones", "1"]]);
  assert.deepEqual(escrito[0].body.alias, ["STOM SAS", "STOM"]);
  assert.equal(escrito[2].body.cliente_id, 2);
  assert.equal((await pedir("gerencial", "POST", { accion: "crear", cliente: { nombre: "stom" } })).status, 409, "ya está");
});

// ─── Pantalla ───

test("Clientes — saldos, ficha y cobrar en efectivo", async () => {
  const datos = { cuentas: CUENTAS, clientes: CLIENTES, tesoreria: TESORERIA, proyectos: PROYECTOS, operaciones: OPS.filter((o) => !o.anulada_at), cuentas_deudores: [DEU] };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, total: 1000 }), { status: 200 }); }
    return new Response(JSON.stringify(datos), { status: 200 });
  };
  render(<FinanzasClientes />);
  await waitFor(() => assert.ok(screen.getByText("BCG")));
  assert.ok(screen.getByText(/Nos debe \$ 120\.000,00/));
  fireEvent.click(screen.getByText("BCG"));
  // La ficha abre en las OT que componen la deuda (este cliente no tiene OT en la respuesta)
  await waitFor(() => assert.ok(screen.getByText(/no tiene OT en el Plan/)));
  fireEvent.click(screen.getByText(/^Movimientos \(/));
  assert.ok(screen.getByRole("table", { name: "Movimientos del cliente" }));
  fireEvent.click(screen.getByText(/Ventas anotadas por OT \(1\)/));
  assert.ok(screen.getByText("M-7100 · BCG · HOTEL AMANCAY"));
  fireEvent.click(screen.getByText("💵 Cobrar"));
  fireEvent.click(screen.getByRole("button", { name: "Efectivo" }));
  fireEvent.change(screen.getByLabelText("Importe 1"), { target: { value: "1.000" } });
  fireEvent.change(screen.getByLabelText("Dónde entró 1"), { target: { value: CAJA.cuenta } });
  fireEvent.change(screen.getByLabelText("OT del cobro"), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "Cargar el cobro" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].cliente_id, enviados[0].proyecto_id, enviados[0].formas[0].forma, enviados[0].formas[0].importe, enviados[0].formas[0].cuenta], ["cobrar", 2, 10, "efectivo", 1000, CAJA.cuenta]);
});
