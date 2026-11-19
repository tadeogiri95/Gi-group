// tests/finanzas-ajuste-saldo.test.jsx — 19/11 (punto 15): ajuste de saldo
// de un cliente o un proveedor contra "Ajuste de resultados de ejercicios
// anteriores" (patrimonio). No toca caja ni resultado.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { cuentaAjusteAnteriores, cuentaAjusteNueva, leerImporte, operacionAjusteSaldo } from "../app/lib/finanzasAjusteSaldo.js";
import { seccionDe } from "../app/lib/finanzasPatrimonio.js";
import { puedeAnular } from "../app/lib/finanzasCorregir.js";
import { saldosClientes } from "../app/lib/finanzasClientes.js";
import { saldosProveedores } from "../app/lib/finanzasProveedores.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const apiClientes = await import("../app/api/finanzas/clientes/route.js");
const apiProveedores = await import("../app/api/finanzas/proveedores/route.js");
const { default: AjusteSaldo } = await import("../app/components/FinanzasAjusteSaldo.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const PROV = "02.01.02.001.001";
const DEUD = "01.01.02.001.001";
const VENTAS = "04.01.01.001.001";
const CAJA = "01.01.01.001.001";
const CUENTAS = [
  { codigo: PROV, nombre: "Proveedores", activa: true }, { codigo: DEUD, nombre: "Deudores por Ventas", activa: true },
  { codigo: VENTAS, nombre: "Ventas", activa: true }, { codigo: CAJA, nombre: "Caja Principal", activa: true },
];
const AREA = "03.03.01.001.001";

test("cuentaAjusteAnteriores / cuentaAjusteNueva — la busca por nombre; si no está, primer código libre en 03.03.01", () => {
  assert.equal(cuentaAjusteAnteriores(CUENTAS), "");
  assert.equal(cuentaAjusteAnteriores([...CUENTAS, { codigo: "03.03.01.002.001", nombre: "Ajuste De Resultados De Ejercicios Anteriores" }]), "03.03.01.002.001");
  const nueva = cuentaAjusteNueva(CUENTAS);
  assert.deepEqual([nueva.codigo, nueva.rubro, nueva.naturaleza], [AREA, "PATRIMONIO NETO", "H"]);
  assert.equal(cuentaAjusteNueva([...CUENTAS, { codigo: AREA, nombre: "Otra" }]).codigo, "03.03.01.001.002");
  assert.equal(seccionDe(nueva.codigo), "PN", "es patrimonio: no entra en el resultado");
});

test("leerImporte — con coma, con puntos de miles o con signo", () => {
  assert.equal(leerImporte("1.234,56"), 1234.56);
  assert.equal(leerImporte("10.000"), 10000);
  assert.equal(leerImporte("-500"), -500);
  assert.equal(leerImporte("0"), 0);
  assert.equal(leerImporte(""), null);
  assert.equal(leerImporte("abc"), null);
});

const base = { fecha: "2026-11-19", motivo: "Diferencia vieja del libro" };

test("operacionAjusteSaldo — cliente: baja = Ajuste / Deudores; sube = Deudores / Ajuste; nunca una caja", () => {
  const baja = operacionAjusteSaldo({ ...base, lado: "cliente", clave: "c7", nombre: "Felipe", saldoActual: 1500, saldoNuevo: 0 }, { cuentaCc: DEUD, cuentaAjuste: AREA });
  assert.deepEqual([baja.op.cuenta_debe, baja.op.cuenta_haber, baja.op.total, baja.op.cliente_id, baja.diferencia], [AREA, DEUD, 1500, 7, -1500]);
  assert.equal(baja.op.origen, "ajuste_saldo");
  assert.match(baja.op.descripcion, /Ajuste de saldo · Diferencia vieja/);
  const sube = operacionAjusteSaldo({ ...base, lado: "cliente", clave: "c7", nombre: "Felipe", saldoActual: 100, saldoNuevo: 250 }, { cuentaCc: DEUD, cuentaAjuste: AREA });
  assert.deepEqual([sube.op.cuenta_debe, sube.op.cuenta_haber, sube.op.total], [DEUD, AREA, 150]);
  assert.ok(![sube.op.cuenta_debe, sube.op.cuenta_haber].includes(CAJA));
  // El saldo queda en lo pedido
  const ops = [{ fecha: "2026-11-01", cliente_id: 7, total_ars: 1500, cuenta_debe: DEUD, cuenta_haber: VENTAS }, baja.op];
  assert.equal(saldosClientes(ops, new Set([DEUD]), [{ id: 7, nombre: "Felipe" }]).find((s) => s.clave === "c7").saldo, 0);
});

test("operacionAjusteSaldo — proveedor: baja la deuda = Proveedores / Ajuste; sube = Ajuste / Proveedores", () => {
  const baja = operacionAjusteSaldo({ ...base, lado: "proveedor", clave: "p5", nombre: "Carpintería Sur", saldoActual: 800, saldoNuevo: 300 }, { cuentaCc: PROV, cuentaAjuste: AREA });
  assert.deepEqual([baja.op.cuenta_debe, baja.op.cuenta_haber, baja.op.total, baja.op.proveedor_id], [PROV, AREA, 500, 5]);
  const sube = operacionAjusteSaldo({ ...base, lado: "proveedor", clave: "eCARPINTERIASUR", nombre: "Carpintería Sur", saldoActual: -200, saldoNuevo: 0 }, { cuentaCc: PROV, cuentaAjuste: AREA });
  assert.deepEqual([sube.op.cuenta_debe, sube.op.cuenta_haber, sube.op.total, sube.op.proveedor_id, sube.op.entidad], [AREA, PROV, 200, null, "Carpintería Sur"]);
  const ops = [{ fecha: "2026-11-01", proveedor_id: 5, total_ars: 800, cuenta_debe: "05.01", cuenta_haber: PROV }, baja.op];
  assert.equal(saldosProveedores(ops, new Set([PROV]), [{ id: 5, nombre: "Carpintería Sur" }]).find((s) => s.clave === "p5").deuda, 300);
});

test("operacionAjusteSaldo — errores: sin motivo, sin cambio, clave del otro lado, fecha", () => {
  const ctx = { cuentaCc: DEUD, cuentaAjuste: AREA };
  const d = { ...base, lado: "cliente", clave: "c7", nombre: "Felipe", saldoActual: 100, saldoNuevo: 0 };
  assert.match(operacionAjusteSaldo({ ...d, motivo: "" }, ctx).error, /motivo/);
  assert.match(operacionAjusteSaldo({ ...d, saldoNuevo: 100 }, ctx).error, /ya es ese/);
  assert.match(operacionAjusteSaldo({ ...d, clave: "p7" }, ctx).error, /cliente/);
  assert.match(operacionAjusteSaldo({ ...d, fecha: "19/11" }, ctx).error, /fecha/);
  assert.match(operacionAjusteSaldo({ ...d, saldoNuevo: "x" }, ctx).error, /cuánto/);
  assert.match(operacionAjusteSaldo(d, { cuentaCc: DEUD }).error, /ejercicios anteriores/);
});

test("el ajuste se puede anular", () => {
  assert.equal(puedeAnular({ origen: "ajuste_saldo" }), true);
});

/* ─── Las rutas ─────────────────────────────────────────────────────── */

const token = async () => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol: "gerencial" })).token;
const pedir = async (api, url, body) => api.POST(new Request(`http://localhost${url}`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body),
}));

function mockApi({ cuentas = CUENTAS, ops = [] } = {}) {
  const escrito = { cuentas: [], ops: [] };
  const lista = (body) => ({ status: 200, body });
  const post = (dest) => (u, o) => {
    if (o?.method === "POST") {
      const body = JSON.parse(o.body);
      dest.push(body);
      return { status: 201, body: [{ id: 90, ...body }] };
    }
    return null;
  };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => lista([{ plan_activo: "pro", plan_vence: "2099-01-01" }]) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => lista([]) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => lista([{ id: EMP, nombre: "Tadeo" }]) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => lista([]) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: (u, o) => post(escrito.cuentas)(u, o) || lista(cuentas) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => lista([{ id: 7, nombre: "Felipe", activo: true }]) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => lista([{ id: 5, nombre: "Carpintería Sur", activo: true }]) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: (u, o) => post(escrito.ops)(u, o) || lista(ops) },
  ]);
  return escrito;
}

test("/api/finanzas/clientes ajuste_saldo — calcula el saldo de hoy, crea la cuenta y anota el ajuste", async () => {
  const escrito = mockApi({ ops: [{ id: 1, fecha: "2026-11-01", cliente_id: 7, total_ars: 1500, cuenta_debe: DEUD, cuenta_haber: VENTAS }] });
  const res = await pedir(apiClientes, "/api/finanzas/clientes", { accion: "ajuste_saldo", clave: "c7", saldo_nuevo: 0, fecha: "2026-11-19", motivo: "No se le cobra" });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual([d.diferencia, d.saldo_antes, d.cuenta_creada], [-1500, 1500, AREA]);
  assert.equal(escrito.cuentas[0].nombre, "Ajuste de resultados de ejercicios anteriores");
  const op = escrito.ops[0];
  assert.deepEqual([op.cuenta_debe, op.cuenta_haber, op.total, op.cliente_id, op.empresa_id, op.cargada_por_nombre], [AREA, DEUD, 1500, 7, E, "Tadeo"]);
});

test("/api/finanzas/proveedores ajuste_saldo — con la cuenta ya en el plan no la crea; sin motivo no anota nada", async () => {
  const conCuenta = [...CUENTAS, { codigo: "03.03.01.001.004", nombre: "Ajuste de resultados de ejercicios anteriores", activa: true }];
  const deuda = [{ id: 1, fecha: "2026-11-01", proveedor_id: 5, total_ars: 800, cuenta_debe: "05.01", cuenta_haber: PROV }];
  const escrito = mockApi({ cuentas: conCuenta, ops: deuda });
  const res = await pedir(apiProveedores, "/api/finanzas/proveedores", { accion: "ajuste_saldo", clave: "p5", saldo_nuevo: 300, fecha: "2026-11-19", motivo: "Descuento acordado" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cuenta_creada, null);
  assert.equal(escrito.cuentas.length, 0);
  assert.deepEqual([escrito.ops[0].cuenta_debe, escrito.ops[0].cuenta_haber, escrito.ops[0].total], [PROV, "03.03.01.001.004", 500]);
  const sinMotivo = mockApi({ ops: deuda });
  const mal = await pedir(apiProveedores, "/api/finanzas/proveedores", { accion: "ajuste_saldo", clave: "p5", saldo_nuevo: 0, fecha: "2026-11-19", motivo: "" });
  assert.equal(mal.status, 400);
  assert.equal(sinMotivo.cuentas.length + sinMotivo.ops.length, 0, "si no va, tampoco crea la cuenta");
  mockApi({ ops: deuda });
  assert.equal((await pedir(apiProveedores, "/api/finanzas/proveedores", { accion: "ajuste_saldo", clave: "p99", saldo_nuevo: 0, fecha: "2026-11-19", motivo: "x y z" })).status, 404);
});

test("⚖ Ajustar saldo — muestra cuánto suma o resta y manda el saldo nuevo con su signo", async () => {
  const pedidos = [];
  global.fetch = async (u, o) => {
    if (o?.method === "POST") { pedidos.push({ url: String(u), body: JSON.parse(o.body) }); return new Response(JSON.stringify({ ok: true, cuenta_creada: AREA }), { status: 200 }); }
    return new Response("{}", { status: 200 });
  };
  let hecho = 0;
  render(<AjusteSaldo lado="cliente" clave="c7" nombre="Felipe" saldo={1500} onCerrar={() => {}} onHecho={() => { hecho += 1; }} />);
  assert.match(document.body.textContent, /Hoy: Nos debe/);
  assert.match(screen.getByRole("status").textContent, /Queda Al día: el ajuste resta/);
  fireEvent.click(screen.getByRole("button", { name: "Ajustar" }));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /motivo/));
  fireEvent.change(screen.getByLabelText("Tiene que quedar en"), { target: { value: "200" } });
  fireEvent.change(screen.getByLabelText("Para qué lado"), { target: { value: "favor" } });
  assert.match(screen.getByRole("status").textContent, /A favor del cliente .*resta/);
  fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "Pagó de más" } });
  fireEvent.click(screen.getByRole("button", { name: "Ajustar" }));
  await waitFor(() => assert.equal(hecho, 1));
  assert.equal(pedidos[0].url, "/api/finanzas/clientes");
  assert.deepEqual([pedidos[0].body.accion, pedidos[0].body.clave, pedidos[0].body.saldo_nuevo, pedidos[0].body.motivo], ["ajuste_saldo", "c7", -200, "Pagó de más"]);
});
