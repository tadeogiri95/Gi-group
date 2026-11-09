// tests/finanzas-unificados.test.jsx — Finanzas, parte 5: cliente que también
// es proveedor, con compensación (sin migración). Datos de mentira.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { cuentasUnificadas, leerPares, operacionCompensacion, sugerirPares } from "../app/lib/finanzasUnificados.js";
import { efectoCliente } from "../app/lib/finanzasClientes.js";
import { efectoDeuda } from "../app/lib/finanzasProveedores.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/unificados/route.js");
const { default: FinanzasUnificados } = await import("../app/components/FinanzasUnificados.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const DEU = "01.01.02.001.001";
const PROV = "02.01.02.001.001";
const VENTAS = "04.01.01.001.001";
const MP = "01.01.04.001.002";
const CUENTAS = [{ codigo: DEU, nombre: "Deudores Por Ventas" }, { codigo: PROV, nombre: "Proveedores" }, { codigo: VENTAS, nombre: "Ventas Generales" }, { codigo: MP, nombre: "Materias Primas" }];
const CLIENTES = [
  { id: 1, nombre: "Carpintería Sur SRL", cuit: "30-11111111-8" },
  { id: 2, nombre: "Hotel Norte", cuit: null, alias: ["HOTEL NORTE SA"] },
  { id: 3, nombre: "Otro Cliente", cuit: null },
  { id: 4, nombre: "Repetido", unido_a: 1 },
];
const PROVEEDORES = [
  { id: 10, nombre: "CARPINTERIA DEL SUR", cuit: "30111111118" },
  { id: 11, nombre: "Hotel Norte S.A.", cuit: null },
  { id: 12, nombre: "Maderas", cuit: null },
];
const ops = [
  { id: 1, fecha: "2026-10-01", cliente_id: 1, total_ars: 1000, cuenta_debe: DEU, cuenta_haber: VENTAS },
  { id: 2, fecha: "2026-10-02", proveedor_id: 10, total_ars: 400, cuenta_debe: MP, cuenta_haber: PROV },
  { id: 3, fecha: "2026-10-03", entidad: "Carpintería Sur SRL", total_ars: 100, cuenta_debe: DEU, cuenta_haber: VENTAS },
];

test("sugerencias — mismo CUIT o mismo nombre, uno con uno, sin los ya unidos ni los repetidos", () => {
  const s = sugerirPares(CLIENTES, PROVEEDORES, []);
  assert.deepEqual(s.map((x) => [x.cliente_id, x.proveedor_id, x.por]), [[1, 10, "cuit"], [2, 11, "nombre"]]);
  assert.deepEqual(sugerirPares(CLIENTES, PROVEEDORES, [{ cliente_id: 1, proveedor_id: 10 }]).map((x) => x.cliente_id), [2]);
  assert.deepEqual(leerPares({ pares: [{ cliente_id: 1, proveedor_id: 10 }, { cliente_id: 1, proveedor_id: 11 }, { cliente_id: "x" }] }), [{ cliente_id: 1, proveedor_id: 10 }]);
});

test("cuenta unificada — nos debe, le debemos, neto; compensar baja las dos sin pasarse", () => {
  const [u] = cuentasUnificadas([{ cliente_id: 1, proveedor_id: 10 }], { ops, clientes: CLIENTES, proveedores: PROVEEDORES, cuentasDeu: new Set([DEU]), cuentasProv: new Set([PROV]) });
  assert.deepEqual([u.nos_debe, u.le_debemos, u.neto, u.compensable, u.cliente, u.proveedor], [1100, 400, 700, 400, "Carpintería Sur SRL", "CARPINTERIA DEL SUR"]);
  const { op } = operacionCompensacion({ fecha: "2026-11-09", importe: 400 }, { cuenta: u, cuentaDeudores: DEU, cuentaProveedores: PROV });
  assert.deepEqual([op.cuenta_debe, op.cuenta_haber, op.total_ars, op.cliente_id, op.proveedor_id, op.tipo, op.origen], [PROV, DEU, 400, 1, 10, "COMPENSACIÓN DE SALDOS", "compensacion"]);
  assert.equal(efectoCliente(op, new Set([DEU])), -400, "baja lo que nos debe");
  assert.equal(efectoDeuda(op, new Set([PROV])), -400, "baja lo que le debemos");
  const ctx = { cuenta: u, cuentaDeudores: DEU, cuentaProveedores: PROV };
  assert.match(operacionCompensacion({ fecha: "2026-11-09", importe: 500 }, ctx).error, /hasta \$ 400,00/);
  assert.match(operacionCompensacion({ fecha: "", importe: 5 }, ctx).error, /fecha/);
  assert.match(operacionCompensacion({ fecha: "2026-11-09", importe: 5 }, { ...ctx, cuenta: null }).error, /no está unido/);
  const [sin] = cuentasUnificadas([{ cliente_id: 3, proveedor_id: 12 }], { ops, clientes: CLIENTES, proveedores: PROVEEDORES, cuentasDeu: new Set([DEU]), cuentasProv: new Set([PROV]) });
  assert.match(operacionCompensacion({ fecha: "2026-11-09", importe: 1 }, { ...ctx, cuenta: sin }).error, /nada para compensar/);
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const llamar = async (metodo, body, rol = "gerencial") => api[metodo](new Request("http://localhost/api/finanzas/unificados", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi(pares = []) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push({ tabla: "config", metodo: o.method, body: JSON.parse(o.body) }); return { status: 201, body: [{}] }; }
        return { status: 200, body: pares.length ? [{ valor: { pares } }] : [] };
      },
    },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => ({ status: 200, body: CLIENTES }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: PROVEEDORES }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") { escrito.push({ tabla: "fin_operaciones", body: JSON.parse(o.body) }); return { status: 201, body: [{}] }; }
        return { status: 200, body: ops };
      },
    },
  ]);
  return escrito;
}

test("/api/finanzas/unificados — solo el Dueño; unir, separar y compensar", async () => {
  let escrito = mockApi();
  assert.equal((await llamar("GET", null, "administrativo")).status, 403);
  const g = await (await llamar("GET")).json();
  assert.deepEqual(g.unificadas, []);
  assert.equal(g.sugeridas.length, 2);
  assert.equal(g.clientes.length, 3, "sin el repetido");
  const u = await llamar("POST", { accion: "unir", cliente_id: 1, proveedor_id: 10 });
  assert.equal(u.status, 200);
  assert.deepEqual(escrito[0].body.valor.pares, [{ cliente_id: 1, proveedor_id: 10 }]);
  assert.equal((await llamar("POST", { accion: "unir", cliente_id: 4, proveedor_id: 10 })).status, 400, "el repetido no");

  escrito = mockApi([{ cliente_id: 1, proveedor_id: 10 }]);
  const g2 = await (await llamar("GET")).json();
  assert.equal(g2.unificadas[0].neto, 700);
  assert.equal((await llamar("POST", { accion: "unir", cliente_id: 2, proveedor_id: 10 })).status, 409);
  const c = await llamar("POST", { accion: "compensar", cliente_id: 1, fecha: "2026-11-09", importe: 400 });
  assert.equal(c.status, 200);
  const op = escrito[0].body;
  assert.deepEqual([op.empresa_id, op.cuenta_debe, op.cuenta_haber, op.total], [E, PROV, DEU, 400]);
  assert.match(op.origen_id, /^cp[0-9a-f]{12}$/);
  assert.equal((await llamar("POST", { accion: "compensar", cliente_id: 1, fecha: "2026-11-09", importe: 401 })).status, 400);
  const s = await llamar("POST", { accion: "separar", cliente_id: 1 });
  assert.equal(s.status, 200);
  assert.deepEqual(escrito.at(-1).body.valor.pares, []);
});

// ─── Pantalla ───

test("Cliente y proveedor — muestra el neto, une lo sugerido y compensa", async () => {
  const enviados = [];
  let d = {
    unificadas: [{ cliente_id: 1, proveedor_id: 10, cliente: "Carpintería Sur SRL", proveedor: "CARPINTERIA DEL SUR", nos_debe: 1100, le_debemos: 400, neto: 700, compensable: 400 }],
    sugeridas: [{ cliente_id: 2, proveedor_id: 11, cliente: "Hotel Norte", proveedor: "Hotel Norte S.A.", por: "nombre" }],
    clientes: [{ id: 3, nombre: "Otro Cliente" }], proveedores: [{ id: 12, nombre: "Maderas" }],
  };
  global.fetch = async (u, o) => {
    if (o?.method === "POST") { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify(d), { status: 200 });
  };
  render(<FinanzasUnificados onCerrar={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText(/Neto: nos debe \$ 700,00/)));
  fireEvent.click(screen.getAllByRole("button", { name: "Unir" })[0]);
  await waitFor(() => assert.deepEqual(enviados[0], { accion: "unir", cliente_id: 2, proveedor_id: 11 }));
  fireEvent.click(screen.getAllByRole("button", { name: "⚖ Compensar" })[0]);
  const imp = await screen.findByLabelText(/Importe/);
  assert.equal(imp.value, "400");
  fireEvent.click(screen.getByRole("button", { name: "Compensar" }));
  await waitFor(() => assert.equal(enviados[1]?.accion, "compensar"));
  assert.deepEqual([enviados[1].cliente_id, enviados[1].importe], [1, 400]);
});
