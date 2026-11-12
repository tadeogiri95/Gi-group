// tests/cliente-ot.test.jsx — Cada OT unida a su cliente de Finanzas
// (auditoría del 12/11, parte 6; migración 184): manda el cliente de la OT; la
// venta, la entrega y los cobros de la OT lo siguen.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFetchMock } from "./helpers/mockFetch.js";
import { armarCobro, clienteDeOt } from "../app/lib/finanzasClientes.js";
import { ORIGEN_ENTREGA, ORIGEN_VENTA, planClientesOt, planVentas, sincronizarVentasOt } from "../app/lib/finanzasVentas.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const E = "33333333-3333-3333-3333-333333333333";
const DEU = "01.01.02.001.001";
const VG = "04.01.01.001.001";
const EG = "04.01.01.001.002";
const CTAS = { deudores: DEU, ventas: VG, entregas: EG };
const BCG = { id: 2, nombre: "BCG", alias: [], activo: true };
const STOM = { id: 3, nombre: "STOM SAS", alias: [], activo: true };
const VIEJO = { id: 4, nombre: "BCG VIEJO", alias: [], activo: false, unido_a: 2 };
const CLIENTES = [BCG, STOM, VIEJO];
const OT = (id, x = {}) => ({ id, ot: `M-${id}`, cliente: "BCG", obra: "HOTEL", descripcion: "COCINA", division: "MADERA", estado: "activo", created_at: "2026-11-05T15:00:00Z", ...x });

test("cliente de la OT — el unido, el de su nombre, o al que se unió", () => {
  assert.equal(clienteDeOt({ cliente: "BCG" }, CLIENTES), 2);
  assert.equal(clienteDeOt({ cliente: "STOM" }, CLIENTES), 3, "STOM = STOM SAS, como la venta");
  assert.equal(clienteDeOt({ cliente: "BCG", cliente_id: 3 }, CLIENTES), 3, "si ya quedó unida, ese");
  assert.equal(clienteDeOt({ cliente: "Otro", cliente_id: 4 }, CLIENTES), 2, "el unido a otro va al que queda");
  assert.equal(clienteDeOt({ cliente: "BCG", cliente_id: 99 }, CLIENTES), 2, "un id que no existe: por el nombre");
  assert.equal(clienteDeOt({ cliente: "Nadie" }, CLIENTES), null);
});

test("unir OT y pasar cobros — solo lo que cambió; sin la 184 no une; los cobros siguen a la OT", () => {
  const proyectos = [
    { id: 1, cliente: "BCG", cliente_id: null },
    { id: 2, cliente: "BCG", cliente_id: 2 },
    { id: 3, cliente: "STOM SAS", cliente_id: 2 },
    { id: 4, cliente: "", cliente_id: 3 },
    { id: 5, cliente: "Nadie", cliente_id: null },
  ];
  const plan = planClientesOt(proyectos, CLIENTES, [
    { id: 70, proyecto_id: 1, cliente_id: 3 },
    { id: 71, proyecto_id: 2, cliente_id: 2 },
    { id: 72, proyecto_id: 1, cliente_id: 4 },
  ]);
  // La 3 ya quedó unida a BCG (2): se respeta; la 4 sin nombre queda como estaba
  assert.deepEqual([...plan.ligar.entries()], [[2, [1]]]);
  assert.deepEqual(plan.cobros, [{ id: 70, cambios: { cliente_id: 2, entidad: "BCG" } }], "el 72 es de BCG VIEJO, unido a BCG");
  assert.equal(planClientesOt([{ id: 1, cliente: "BCG" }], CLIENTES).ligar.size, 0, "sin la columna no se une");
});

test("venta y entrega — si el cliente de la OT cambió, lo siguen (junto con el precio)", () => {
  const ops = [
    { id: 10, origen: ORIGEN_VENTA, origen_id: "p1", total: 1000, cliente_id: 3 },
    { id: 11, origen: ORIGEN_ENTREGA, origen_id: "p1", total: 900, cliente_id: 3 },
    { id: 12, origen: ORIGEN_VENTA, origen_id: "p2", total: 500, cliente_id: 2 },
  ];
  const p = planVentas({
    proyectos: [OT(1, { estado: "cerrado" }), OT(2)], precios: new Map([["M-1", 1000], ["M-2", 500]]), operaciones: ops,
    clientes: CLIENTES, cuentas: CTAS, centros: [], config: { activo: true, desde: "2026-11-01" }, hoy: "2026-11-09",
  });
  assert.deepEqual(p.corregir, [
    { id: 10, cambios: { cliente_id: 2, entidad: "BCG" } },
    { id: 11, cambios: { neto: 1000, iva: 0, otros_impuestos: 0, total: 1000, total_ars: 1000, cliente_id: 2, entidad: "BCG" } },
  ]);
  assert.deepEqual(p.crear, []);
});

test("cobro — la OT de otro cliente no se le carga a este", () => {
  const ctx = {
    cliente: STOM, clientes: CLIENTES, proyectos: [{ id: 1, ot: "M-1", cliente: "BCG", cliente_id: 2 }],
    cuentas: [{ codigo: DEU, nombre: "Deudores Por Ventas" }], tesoreria: [{ codigo: "01.01.01.001", tipo: "caja", moneda: "ARS", activa: true }], grupo: "cb1",
  };
  const r = armarCobro({ fecha: "2026-11-10", proyecto_id: 1, formas: [{ forma: "efectivo", importe: 100, cuenta: "01.01.01.001" }] }, ctx);
  assert.ok(r.errores.some((x) => /La OT M-1 es de BCG/.test(x)));
  const ok = armarCobro({ fecha: "2026-11-10", proyecto_id: 1, formas: [{ forma: "efectivo", importe: 100, cuenta: "01.01.01.001" }] }, { ...ctx, cliente: BCG });
  assert.equal(ok.errores.some((x) => /La OT/.test(x)), false);
});

test("sincronización — con las ventas apagadas igual une cada OT a su cliente", async () => {
  const escrito = [];
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [{ modulo: "finanzas", activo: true }] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => ({ status: 200, body: CLIENTES }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/proyectos"),
      respond: (u, o) => {
        if (o.method === "PATCH") { escrito.push({ url: u, body: JSON.parse(o.body) }); return { status: 200, body: [] }; }
        return { status: 200, body: [{ id: 1, ot: "M-1", cliente: "STOM", cliente_id: null }, { id: 2, ot: "M-2", cliente: "BCG", cliente_id: 2 }] };
      },
    },
  ]);
  const r = await sincronizarVentasOt(E);
  assert.equal(r.accion, "apagada");
  assert.equal(escrito.length, 1);
  assert.ok(escrito[0].url.endsWith(`/rest/v1/proyectos?empresa_id=eq.${E}&id=in.(1)`));
  assert.deepEqual(escrito[0].body, { cliente_id: 3 }, "STOM es STOM SAS; la M-2 ya estaba");
});

test("migración 184 — la columna con su índice", () => {
  const sql = readFileSync(new URL("../supabase/migrations/184_cliente_ot.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.proyectos add column if not exists cliente_id bigint references public\.fin_clientes\(id\) on delete set null/);
  assert.match(sql, /create index if not exists proyectos_cliente_id_idx/);
  assert.match(sql, /notify pgrst/);
});
