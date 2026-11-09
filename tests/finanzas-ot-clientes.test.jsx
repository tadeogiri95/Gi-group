// tests/finanzas-ot-clientes.test.jsx — Finanzas, parte 6: cuenta corriente
// de clientes por OT (sin migración). Datos de mentira.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { cuentasPorOt, materialesOt, resumirCliente, valorOt } from "../app/lib/finanzasOtClientes.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/ot-clientes/route.js");
const { default: FinanzasOtClientes } = await import("../app/components/FinanzasOtClientes.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const DEU = "01.01.02.001.001";
const VENTAS = "04.01.01.001.001";
const BANCO = "01.01.01.003.002";
const CLIENTES = [{ id: 1, nombre: "Hotel Norte", alias: ["HOTEL NORTE SA"] }, { id: 2, nombre: "Casa Sur" }];
const PROYECTOS = [
  { id: 101, ot: "7001", cliente: "Hotel Norte SA", obra: "Lobby", created_at: "2026-09-10T12:00:00Z" },
  { id: 102, ot: "7002", cliente: "HOTEL NORTE", obra: "Habitaciones", created_at: "2026-10-05T12:00:00Z" },
  { id: 103, ot: "7003", cliente: "Casa Sur", obra: "Cocina", created_at: "2026-10-06T12:00:00Z" },
  { id: 104, ot: "7004", cliente: "", obra: "Sin cliente" },
];
const OPS = [
  { id: 1, fecha: "2026-09-20", cliente_id: 1, proyecto_id: 101, total_ars: 500, cuenta_debe: BANCO, cuenta_haber: DEU },
  { id: 2, fecha: "2026-10-10", entidad: "Hotel Norte", total_ars: 200, cuenta_debe: BANCO, cuenta_haber: DEU },
  { id: 3, fecha: "2026-10-01", cliente_id: 1, proyecto_id: 101, total_ars: 9999, cuenta_debe: DEU, cuenta_haber: VENTAS },
  { id: 4, fecha: "2026-10-11", cliente_id: 2, proyecto_id: 101, total_ars: 50, cuenta_debe: BANCO, cuenta_haber: DEU },
];

test("valor de la OT — presupuesto; si no, materiales ÷ 0,3 estimado; materiales con precio fijo o por fecha", () => {
  assert.deepEqual(valorOt(1000, { total: 300 }), { valor: 1000, estimado: false });
  assert.deepEqual(valorOt(0, { total: 300 }), { valor: 1000, estimado: true });
  assert.equal(valorOt(null, null).sin_valor, true);
  const m = materialesOt({
    necesidades: [{ sku: "A", cantidad: 2 }, { sku: "A", cantidad: 1 }, { sku: "B", cantidad: 10 }, { sku: "C", cantidad: 1 }],
    fijos: new Map([["A", { precio_ars: 100 }]]),
    precios: new Map([["B", [{ fecha: "2026-01-01", precio_ars: 5 }, { fecha: "2026-12-01", precio_ars: 50 }]]]),
    fechaOt: "2026-10-01",
  });
  assert.deepEqual(m, { total: 350, sinPrecio: 1, articulos: 3 });
});

test("cuenta por OT — OT por nombre o alias del cliente, cobros a su OT o sin OT; con IVA y desde", () => {
  const precios = new Map([["7001", 1000], ["7003", 2000]]);
  const materiales = new Map([["7002", { total: 300, sinPrecio: 0 }]]);
  const cs = cuentasPorOt({ proyectos: PROYECTOS, precios, materiales, ops: OPS, cuentasDeu: new Set([DEU]), clientes: CLIENTES });
  const hotel = cs.find((c) => c.clave === "c1");
  assert.deepEqual(hotel.ots.map((o) => [o.ot, o.valor, o.estimado]), [["7001", 1000, false], ["7002", 1000, true]]);
  assert.equal(hotel.cobros.length, 2, "la venta no es cobro");
  const r = resumirCliente(hotel);
  assert.deepEqual([r.valor, r.cobrado, r.saldo, r.sin_ot, r.estimadas], [2000, 700, 1300, 200, 1]);
  assert.deepEqual(r.ots.find((o) => o.ot === "7001").saldo, 500);
  const conIva = resumirCliente(hotel, { conIva: true });
  assert.deepEqual([conIva.valor, conIva.saldo], [2420, 1720]);
  const desde = resumirCliente(hotel, { desde: "2026-10-01" });
  assert.deepEqual([desde.ots.length, desde.cobrado, desde.saldo], [1, 200, 800]);
  const sur = resumirCliente(cs.find((c) => c.clave === "c2"));
  assert.deepEqual([sur.sin_ot, sur.saldo], [50, 1950], "un cobro con OT de otro cliente cuenta como sin OT");
  assert.equal(cs.length, 2, "la OT sin cliente no aparece");
});

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;

test("/api/finanzas/ot-clientes — solo el Dueño; materiales solo de las OT sin presupuesto", async () => {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: [{ codigo: DEU, nombre: "Deudores Por Ventas" }] }) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => ({ status: 200, body: CLIENTES }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: PROYECTOS }) },
    { match: (u) => u.includes("/rest/v1/precios_ot"), respond: () => ({ status: 200, body: [{ ot: "7001", precio: 1000 }, { ot: "7003", precio: 2000 }] }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: () => ({ status: 200, body: OPS }) },
    { match: (u) => u.includes("/rest/v1/necesidades_stock"), respond: (u) => { pedidos.push(decodeURIComponent(u)); return { status: 200, body: [{ ot: "7002", sku: "A", cantidad: 3 }] }; } },
    { match: (u) => u.includes("/rest/v1/precios_fijos_ot"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/v_precios_articulos"), respond: () => ({ status: 200, body: [{ sku: "A", fecha: "2026-01-01", precio_ars: 100 }] }) },
  ]);
  const pedir = async (rol) => api.GET(new Request("http://localhost/api/finanzas/ot-clientes", { headers: { Authorization: `Bearer ${await token(rol)}` } }));
  assert.equal((await pedir("administrativo")).status, 403);
  const res = await pedir("gerencial");
  assert.equal(res.status, 200);
  const d = await res.json();
  const hotel = d.clientes.find((c) => c.clave === "c1");
  assert.deepEqual(hotel.ots.find((o) => o.ot === "7002"), {
    proyecto_id: 102, ot: "7002", obra: "Habitaciones", descripcion: "", estado: "", fecha: "2026-10-05", valor: 1000, estimado: true, materiales: 300, sin_precio_materiales: 0,
  });
  assert.equal(pedidos.length, 1);
  assert.match(pedidos[0], /ot=in\.\("7002"\)/, "solo la OT sin presupuesto");
});

test("Cuenta por OT — saldo por cliente, OT estimada en amarillo, con IVA y lista de OT sin presupuesto", async () => {
  const cs = cuentasPorOt({
    proyectos: PROYECTOS, precios: new Map([["7001", 1000], ["7003", 2000]]), materiales: new Map([["7002", { total: 300, sinPrecio: 2 }]]),
    ops: OPS, cuentasDeu: new Set([DEU]), clientes: CLIENTES,
  });
  global.fetch = async () => new Response(JSON.stringify({ clientes: cs }), { status: 200 });
  render(<FinanzasOtClientes onCerrar={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("Hotel Norte")));
  assert.ok(screen.getByText(/Falta cobrar en total/).textContent.includes("3.250,00"));
  assert.ok(screen.getByText(/⚠ Estimado: falta el presupuesto/).textContent.includes("2 artículos sin precio"));
  fireEvent.click(screen.getByLabelText(/Con IVA/));
  assert.ok(screen.getByText(/Falta cobrar en total/).textContent.includes("4.090,00"));
  fireEvent.click(screen.getByRole("button", { name: /OT sin presupuesto \(1\)/ }));
  assert.ok(screen.getByRole("table", { name: "OT sin presupuesto" }).textContent.includes("7002"));
});
