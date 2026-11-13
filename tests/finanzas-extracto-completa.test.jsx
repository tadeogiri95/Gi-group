// tests/finanzas-extracto-completa.test.jsx — Parte 5 del plan de Tesorería
// (13/11): el extracto del banco completa lo pendiente (cheques, órdenes de
// pago, plazos fijos) en vez de cargarlo nuevo, el resumen antes de cargar y
// el registro de cada carga para deshacerla (migración 188).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { pendientesDelExtracto, resumenDeCarga, idsParaDeshacer, textoCarga } from "../app/lib/finanzasExtractoPendientes.js";
import { estadoDePlazos } from "../app/lib/finanzasPlazosFijos.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/banco/route.js");
const { CargasAnteriores } = await import("../app/components/FinanzasExtracto.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const BANCO = "01.01.01.003.002";
const PF = "01.01.01.005.001";

// ─── Reglas ───

const CHEQUES = [
  { id: 1, clase: "propio", estado: "pendiente", numero: "123", beneficiario: "Maderas SA", fecha_pago: "2026-10-10", importe: 50000, cuenta_banco: null },
  { id: 2, clase: "tercero", estado: "en_cartera", numero: "999", recibido_de: "Bosques SA", fecha_pago: "2026-10-05", importe: 80000 },
  { id: 3, clase: "propio", estado: "pendiente", numero: "124", beneficiario: "Otro", fecha_pago: "2026-10-10", importe: 50000, cuenta_banco: "otro banco" },
];
const ORDENES = [
  { id: 7, numero: 15, proveedor_nombre: "Herrajes SRL", fecha: "2026-10-08", estado: "aprobada", formas: [{ forma: "transferencia", cuenta: BANCO, importe: 12000 }] },
  { id: 8, numero: 16, proveedor_nombre: "Pagada", fecha: "2026-10-08", estado: "pagada", formas: [{ forma: "transferencia", cuenta: BANCO, importe: 3000 }] },
];
const PLAZOS = [{ certificado: "415171", vencimiento: "2026-10-20", depositado: 1000000, interes: 25000, moneda: "ARS" }];

test("pendientes — cheque por debitar, cheque depositado, orden por transferencia y plazo fijo", () => {
  const filas = [
    { fecha: "2026-10-12", importe: -50000 },
    { fecha: "2026-10-09", importe: 80000 },
    { fecha: "2026-10-09", importe: -12000 },
    { fecha: "2026-10-21", importe: 1025000 },
    { fecha: "2026-10-09", importe: -3000 },
    { fecha: "2026-10-12", importe: -50000 },
    { fecha: "2026-10-12", importe: -50000, op: { id: 1 } },
  ];
  const m = pendientesDelExtracto(filas, { cheques: CHEQUES, ordenes: ORDENES, plazos: PLAZOS, cuenta: BANCO });
  assert.equal(m.get(0).clase, "cheque");
  assert.deepEqual(m.get(0).accion, { url: "/api/finanzas/cheques", body: { accion: "cambiar", id: 1, a: "debitado", cuenta_banco: BANCO, fecha: "2026-10-12" } });
  assert.match(m.get(0).texto, /Débito del cheque N° 123 a Maderas SA/);
  assert.equal(m.get(1).accion.body.a, "depositado");
  assert.deepEqual(m.get(2).accion, { url: "/api/finanzas/pagos", body: { accion: "pagar", id: 7, fecha: "2026-10-09" } });
  assert.match(m.get(3).texto, /Capital e interés del plazo fijo 415171/);
  assert.equal(m.has(4), false, "una orden pagada no espera nada");
  assert.equal(m.has(5), false, "cada cheque sirve para un solo renglón (el de otro banco no cuenta)");
  assert.equal(m.has(6), false, "lo que ya está en Gypi no");
  const lejos = pendientesDelExtracto([{ fecha: "2026-11-30", importe: -50000 }], { cheques: CHEQUES, cuenta: BANCO });
  assert.equal(lejos.size, 0, "fuera de los días de margen");
});

test("resumen de la carga — entra, sale y cómo queda contra el banco", () => {
  const r = resumenDeCarga([{ importe: 100 }, { importe: -30.5 }], { saldoGypi: 1000, saldoBanco: 1069.5 });
  assert.deepEqual(r, { n: 2, entra: 100, sale: 30.5, queda: 1069.5, diferencia: 0, cierra: true });
  const sin = resumenDeCarga([{ importe: 10 }], { saldoGypi: 0 });
  assert.deepEqual([sin.diferencia, sin.cierra], [null, false]);
});

test("deshacer — todas las de la carga o solo las elegidas que son suyas", () => {
  const carga = { op_ids: [5, 6, 7] };
  assert.deepEqual(idsParaDeshacer(carga), [5, 6, 7]);
  assert.deepEqual(idsParaDeshacer(carga, [6, "7", 99, 6]), [6, 7]);
  assert.deepEqual(idsParaDeshacer({}, null), []);
  assert.match(textoCarga({ archivo: "oct.csv", desde: "2026-10-01", hasta: "2026-10-31", cargadas: 3, movimientos: 9, cargada_por_nombre: "Tadeo" }), /oct\.csv · del 01\/10\/2026 al 31\/10\/2026 · 3 cargados de 9 · Tadeo/);
});

test("plazos fijos — la constitución y el vencimiento que trajo el extracto se unen, no se cargan otra vez", () => {
  const p = { certificado: "415171", constituido: "2026-09-20", vencimiento: "2026-10-20", depositado: 1000000, interes: 25000 };
  const ops = [
    { id: 1, origen: "banco", fecha: "2026-09-21", total: 1000000, cuenta_debe: PF, cuenta_haber: BANCO, descripcion: "Constitucion PF 99887766" },
    { id: 2, origen: "banco", fecha: "2026-10-20", total: 1000000, cuenta_debe: BANCO, cuenta_haber: PF, descripcion: "Vencimiento Plazo Fijo 415171999" },
  ];
  const e = estadoDePlazos([p], ops, [PF]).get("415171");
  assert.deepEqual([e.c?.id, e.r?.id], [1, 2]);
  const lejos = estadoDePlazos([p], [{ ...ops[0], fecha: "2026-09-01" }], [PF]).get("415171");
  assert.equal(lejos.c, null, "más de 3 días de la constitución no es la misma");
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const auth = async (rol) => ({ Authorization: `Bearer ${await token(rol)}` });
const post = async (rol, body) => api.POST(new Request("http://localhost/api/finanzas/banco", { method: "POST", headers: { "Content-Type": "application/json", ...(await auth(rol)) }, body: JSON.stringify(body) }));
const get = async (rol, q) => api.GET(new Request(`http://localhost/api/finanzas/banco${q}`, { headers: await auth(rol) }));

function mockApi({ sinTabla = false, vivas = [] } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_cargas_banco"),
      respond: (u, o) => {
        if (sinTabla) return { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.fin_cargas_banco' in the schema cache" } };
        if (o?.method === "PATCH") { escrito.push({ tabla: "fin_cargas_banco", url: decodeURIComponent(u), body: JSON.parse(o.body) }); return { status: 200, body: [{}] }; }
        return { status: 200, body: [{ id: 4, cuenta: BANCO, archivo: "oct.csv", cargadas: 3, movimientos: 9, op_ids: [5, 6, 7] }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "PATCH") {
          escrito.push({ tabla: "fin_operaciones", url: decodeURIComponent(u), body: JSON.parse(o.body) });
          const ids = /id=in\.\(([^)]*)\)/.exec(decodeURIComponent(u))[1].split(",");
          return { status: 200, body: ids.map((id) => ({ id: Number(id) })) };
        }
        if (u.includes("select=id&")) return { status: 200, body: vivas.map((id) => ({ id })) };
        return { status: 200, body: [{ id: 5, fecha: "2026-10-01", tipo: "PAGO IMPUESTO", total: 10, cuenta_debe: "x", cuenta_haber: BANCO }] };
      },
    },
  ]);
  return escrito;
}

test("/api/finanzas/banco — cargas: solo el Dueño, la lista y el aviso de la 188", async () => {
  mockApi();
  assert.equal((await get("administrativo", `?cuenta=${BANCO}`)).status, 403);
  const d = await (await get("gerencial", `?cuenta=${BANCO}`)).json();
  assert.deepEqual([d.cargas.length, d.falta_migracion], [1, false]);
  const c = await (await get("gerencial", "?carga=4")).json();
  assert.deepEqual([c.carga.id, c.operaciones.length], [4, 1]);
  mockApi({ sinTabla: true });
  assert.deepEqual(await (await get("gerencial", `?cuenta=${BANCO}`)).json(), { cargas: [], falta_migracion: true });
});

test("/api/finanzas/banco — deshacer: anula solo las del extracto de esa carga y la marca deshecha cuando no queda ninguna", async () => {
  let escrito = mockApi({ vivas: [5] });
  const r = await post("gerencial", { accion: "deshacer", id: 4, ops: [6, 7, 99] });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, anuladas: 2, vivas: 1, deshecha: false });
  const anula = escrito.find((x) => x.tabla === "fin_operaciones");
  assert.match(anula.url, /origen=eq\.banco&anulada_at=is\.null&id=in\.\(6,7\)/);
  assert.equal(anula.body.anulada_por_nombre, "Tadeo");
  assert.equal(escrito.some((x) => x.tabla === "fin_cargas_banco"), false);
  escrito = mockApi({ vivas: [] });
  const todo = await (await post("gerencial", { accion: "deshacer", id: 4 })).json();
  assert.equal(todo.deshecha, true);
  assert.match(escrito.find((x) => x.tabla === "fin_operaciones").url, /id=in\.\(5,6,7\)/);
  assert.ok(escrito.find((x) => x.tabla === "fin_cargas_banco").body.deshecha_at);
  assert.equal((await post("gerencial", { accion: "deshacer", id: 4, ops: [99] })).status, 400);
});

// ─── Pantalla ───

test("cargas anteriores — ver los movimientos y deshacer los elegidos", async () => {
  const posts = [];
  global.window.confirm = () => true;
  global.fetch = async (url, o = {}) => {
    const u = String(url);
    if (o.method === "POST") { posts.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, anuladas: 1, deshecha: false }), { status: 200 }); }
    if (u.includes("carga=4")) return new Response(JSON.stringify({ carga: { id: 4 }, operaciones: [{ id: 5, fecha: "2026-10-01", tipo: "PAGO IMPUESTO", total: 10, cuenta_debe: "x", cuenta_haber: BANCO }, { id: 6, fecha: "2026-10-02", tipo: "COBRO", total: 20, cuenta_debe: BANCO, cuenta_haber: "y" }] }), { status: 200 });
    return new Response(JSON.stringify({ cargas: [{ id: 4, archivo: "oct.csv", desde: "2026-10-01", hasta: "2026-10-31", cargadas: 2, movimientos: 9, created_at: "2026-11-13T10:00:00Z" }] }), { status: 200 });
  };
  let deshecho = 0;
  render(<CargasAnteriores caja={{ cuenta: BANCO, nombre: "Credicoop" }} onDeshecho={() => { deshecho += 1; }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Ver o deshacer" }));
  fireEvent.click(await screen.findByLabelText("Deshacer el movimiento 6"));
  fireEvent.click(screen.getByRole("button", { name: /Deshacer 1 elegidos/ }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.deepEqual(posts[0], { accion: "deshacer", id: 4, ops: [6] });
  await waitFor(() => assert.equal(deshecho, 1));
});

test("extracto — el renglón 🔗 se completa con su pantalla y muestra el resumen de lo nuevo", async () => {
  const { default: SubirExtracto } = await import("../app/components/FinanzasExtracto.jsx");
  const pedidos = [];
  const pendiente = { clase: "cheque", id: 1, texto: "Débito del cheque N° 123 a Maderas SA (vence 10/10/2026)", boton: "Marcar el cheque debitado", accion: { url: "/api/finanzas/cheques", body: { accion: "cambiar", id: 1, a: "debitado", cuenta_banco: BANCO, fecha: "2026-10-12" } } };
  global.fetch = async (url, o = {}) => {
    const u = String(url);
    if (o.body instanceof FormData) {
      return new Response(JSON.stringify({
        ok: true, archivo: "oct.csv", desde: "2026-10-01", hasta: "2026-10-31", control: { calculado: 950, final: 950, ok: true }, reglas: 1,
        saldo_gypi: { saldo: 1000, origenes: [] }, repetidos: [], sin_banco: [],
        filas: [
          { fecha: "2026-10-12", descripcion: "ECHEQ 123", importe: -50000, marca: "m1", op: null, pendiente, sugerencia: { tipo: "PAGO A PROVEEDORES", contra: "02.01" } },
          { fecha: "2026-10-15", descripcion: "Impuesto", importe: -50, marca: "m2", op: null, pendiente: null, sugerencia: { tipo: "PAGO IMPUESTO", contra: "04.01" } },
        ],
      }), { status: 200 });
    }
    if (o.method === "POST") { pedidos.push({ u, body: JSON.parse(o.body) }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify({ cargas: [] }), { status: 200 });
  };
  let cambios = 0;
  const datos = { cuentas: [{ codigo: "02.01", nombre: "Proveedores" }, { codigo: "04.01", nombre: "Impuestos" }], tipos: [{ codigo: "PAGO A PROVEEDORES" }, { codigo: "PAGO IMPUESTO" }] };
  render(<SubirExtracto caja={{ cuenta: BANCO, nombre: "Credicoop" }} datos={datos} onCerrar={() => {}} onCargado={() => {}} onCambio={() => { cambios += 1; }} />);
  fireEvent.change(screen.getByLabelText("Archivo del extracto"), { target: { files: [new File(["x"], "oct.csv")] } });
  await screen.findByText(/Completa algo pendiente: Débito del cheque N° 123/);
  assert.ok(screen.getByText(/1 completan algo pendiente/));
  assert.equal(screen.getByLabelText("Cargar renglón 1").checked, false, "lo que completa algo no se tilda para cargar");
  const resumen = screen.getByRole("region", { name: "Resumen de la carga" });
  assert.match(resumen.textContent, /Vas a cargar 1 movimientos/);
  assert.match(resumen.textContent, /Gypi queda en \$ 950,00 ✓ igual que el banco/);
  fireEvent.click(screen.getByRole("button", { name: "Marcar el cheque debitado" }));
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.deepEqual([pedidos[0].u, pedidos[0].body], ["/api/finanzas/cheques", pendiente.accion.body]);
  await waitFor(() => assert.equal(cambios, 1));
  await waitFor(() => assert.equal(screen.queryByText(/Completa algo pendiente/), null));
  assert.ok(screen.getByText(/1 ya completados/));
});
