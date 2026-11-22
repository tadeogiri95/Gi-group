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
const { default: FinanzasOtClientes, ComposicionOt } = await import("../app/components/FinanzasOtClientes.jsx");

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

test("cuenta por OT — OT por nombre o alias del cliente, cobros a su OT o sin OT; con IVA y desde; manda el cliente de la OT", () => {
  const precios = new Map([["7001", 1000], ["7003", 2000]]);
  const materiales = new Map([["7002", { total: 300, sinPrecio: 0 }]]);
  const cs = cuentasPorOt({ proyectos: PROYECTOS, precios, materiales, ops: OPS, cuentasDeu: new Set([DEU]), clientes: CLIENTES });
  const hotel = cs.find((c) => c.clave === "c1");
  assert.deepEqual(hotel.ots.map((o) => [o.ot, o.valor, o.estimado]), [["7001", 1000, false], ["7002", 1000, true]]);
  assert.equal(hotel.cobros.length, 3, "la venta no es cobro; el cobro de su OT cargado a Casa Sur va al Hotel (12/11, parte 6)");
  assert.equal(hotel.cobros.find((x) => x.id === 4).proyecto_id, 101);
  assert.ok("a_nombre_de" in hotel.cobros.find((x) => x.id === 4));
  const r = resumirCliente(hotel);
  assert.deepEqual([r.valor, r.cobrado, r.saldo, r.sin_ot, r.estimadas], [2000, 750, 1250, 200, 1]);
  assert.deepEqual(r.ots.find((o) => o.ot === "7001").saldo, 450);
  assert.equal(r.con_iva, 0, "por defecto sin IVA");
  // 201: cada OT con su IVA; la 7001 lleva IVA y la 7002 no
  const conIva = resumirCliente({ ...hotel, ots: hotel.ots.map((o) => (o.ot === "7001" ? { ...o, lleva_iva: true } : o)) });
  assert.deepEqual([conIva.valor, conIva.saldo, conIva.con_iva], [2210, 1460, 1]);
  assert.deepEqual((({ neto, iva, valor }) => [neto, iva, valor])(conIva.ots.find((o) => o.ot === "7001")), [1000, 210, 1210]);
  const desde = resumirCliente(hotel, { desde: "2026-10-01" });
  assert.deepEqual([desde.ots.length, desde.cobrado, desde.saldo], [1, 250, 750]);
  const sur = resumirCliente(cs.find((c) => c.clave === "c2"));
  assert.deepEqual([sur.sin_ot, sur.saldo], [0, 2000], "el cobro de una OT de otro cliente no le resta a Casa Sur");
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
    proyecto_id: 102, ot: "7002", obra: "Habitaciones", descripcion: "", estado: "", fecha: "2026-10-05", valor: 1000, estimado: true, lleva_iva: false, materiales: 300, sin_precio_materiales: 0,
  });
  assert.equal(pedidos.length, 1);
  assert.match(pedidos[0], /ot=in\.\("7002"\)/, "solo la OT sin presupuesto");
});

test("Precios del Plan — se leen todas las páginas (más de 1000 OT) y solo las que tienen precio", async () => {
  const { leerPreciosOt } = await import("../app/lib/finanzasMaterialesOt.js");
  // 1271 OT con precio, como la planilla del 20/11: Supabase da de a 1000
  const todas = Array.from({ length: 1271 }, (_, i) => ({ ot: `M-${7000 + i}`, precio: 100 + i }));
  const urls = [];
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/precios_ot"), respond: (u) => {
      urls.push(decodeURIComponent(u));
      const q = new URL(u).searchParams;
      const desde = Number(q.get("offset") || 0);
      return { status: 200, body: todas.slice(desde, desde + Math.min(Number(q.get("limit") || 1000), 1000)) };
    } },
  ]);
  const precios = await leerPreciosOt(null, E);
  assert.equal(precios.size, 1271, "no se corta en 1000");
  assert.equal(precios.get("M-8270"), 1370, "la última OT también tiene su precio");
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => u.includes("precio=gt.0") && u.includes("order=ot.asc")));
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
  // 201: la 7001 (1000) pasa a llevar IVA → +210
  const casilla = screen.getAllByLabelText(/Lleva IVA/).find((x) => x.closest("tr").textContent.includes("7001"));
  fireEvent.click(casilla);
  await waitFor(() => assert.ok(screen.getByText(/Falta cobrar en total/).textContent.includes("3.460,00")));
  assert.match(screen.getByText(/Falta cobrar en total/).textContent, /1 OT con IVA/);
  fireEvent.click(screen.getByRole("button", { name: /OT sin presupuesto \(1\)/ }));
  assert.ok(screen.getByRole("table", { name: "OT sin presupuesto" }).textContent.includes("7002"));
});

test("Ficha del cliente — las OT que componen la deuda, con IVA", async () => {
  const cs = cuentasPorOt({
    proyectos: PROYECTOS, precios: new Map([["7001", 1000], ["7003", 2000]]), materiales: new Map([["7002", { total: 300, sinPrecio: 2 }]]),
    ops: OPS, cuentasDeu: new Set([DEU]), clientes: CLIENTES,
  });
  global.fetch = async () => new Response(JSON.stringify({ clientes: cs }), { status: 200 });
  const c = cs[0];
  const r = resumirCliente(c);
  const { unmount } = render(<ComposicionOt clave={c.clave} />);
  await waitFor(() => assert.ok(screen.getByText(/Según sus OT falta cobrar/)));
  assert.equal(screen.getByRole("table", { name: "OT del cliente" }).querySelectorAll("tbody tr").length >= r.ots.length, true);
  for (const o of r.ots) assert.ok(screen.getByRole("table", { name: "OT del cliente" }).textContent.includes(o.ot));
  assert.ok(screen.getByText(/Según sus OT falta cobrar/).textContent.includes("sin IVA"));
  for (const x of screen.getAllByLabelText(/Lleva IVA/)) fireEvent.click(x);
  await waitFor(() => assert.ok(screen.getByText(/Según sus OT falta cobrar/).textContent.includes("(con IVA)")));
  unmount();
  render(<ComposicionOt clave="c999999" />);
  await waitFor(() => assert.ok(screen.getByText(/no tiene OT en el Plan/)));
});

// ─── 201: "Lleva IVA (21 %)" en cada OT ───

test("IVA por OT — la casilla guarda lleva_iva en la OT, muestra el total con IVA y avisa si falta la 201", async () => {
  const { default: IvaOt } = await import("../app/components/IvaOt.jsx");
  const { validarPatch } = await import("../app/lib/dataPolicy.js");
  const { describirCambio } = await import("../app/lib/historialOt.js");
  const { textoIvaOt } = await import("../app/lib/finanzasOtClientes.js");
  assert.equal(textoIvaOt(1000, false), "Sin IVA: $ 1.000");
  assert.equal(textoIvaOt(1000, true), "Con IVA: $ 1.210 ($ 1.000 + IVA)");
  const pedidos = [];
  global.fetch = async (u, o) => { pedidos.push({ u: String(u), o }); return new Response("[]", { status: 200 }); };
  let guardado = null;
  render(<IvaOt proyecto={{ id: 55, ot: "7001", lleva_iva: false }} precio={1000} onGuardado={(x) => { guardado = x; }} />);
  assert.ok(screen.getByText("Sin IVA: $ 1.000"));
  fireEvent.click(screen.getByLabelText(/Lleva IVA/));
  await waitFor(() => assert.deepEqual(guardado, { id: 55, lleva_iva: true }));
  assert.ok(screen.getByText("Con IVA: $ 1.210 ($ 1.000 + IVA)"));
  const patch = pedidos.find((p) => String(p.o?.body || "").includes("lleva_iva"));
  assert.ok(patch, "se guardó por /api/data");
  assert.match(String(patch.o.body), /proyectos\?id=eq\.55/);
  assert.match(String(patch.o.body), /"lleva_iva":true/);
  cleanup();
  global.fetch = async () => new Response(JSON.stringify({ error: "column proyectos.lleva_iva does not exist" }), { status: 400 });
  render(<IvaOt proyecto={{ id: 55, ot: "7001" }} precio={1000} />);
  fireEvent.click(screen.getByLabelText(/Lleva IVA/));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /migración 201/));
  // Solo true o false; y queda en el historial de la OT con su texto
  assert.equal(validarPatch("proyectos", { lleva_iva: "si" }, { rol: "gerencial" })?.status, 400);
  assert.equal(validarPatch("proyectos", { lleva_iva: true }, { rol: "gerencial" }), null);
  assert.equal(describirCambio({ tabla: "proyectos", metodo: "PATCH", campos: { lleva_iva: true } }), "Marcó que la OT lleva IVA (21 %)");
  assert.equal(describirCambio({ tabla: "proyectos", metodo: "PATCH", campos: { lleva_iva: false } }), "Marcó que la OT va sin IVA");
});
