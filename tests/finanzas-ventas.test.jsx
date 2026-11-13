// tests/finanzas-ventas.test.jsx — Finanzas, parte F4b: la venta (OT cargada
// en el Plan con su precio sin IVA: Deudores por Ventas / Ventas Generales) y
// la entrega (OT terminada: Ventas Generales / Entregas Generales) salen solas.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  planVentas, cuentasVentas, leerConfigVentas, centroDeDivision, fechaCarga, sincronizarVentasOt, ORIGEN_VENTA, ORIGEN_ENTREGA,
  planEntregasEstimadas,
} from "../app/lib/finanzasVentas.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/clientes/route.js");
const { default: FinanzasClientes, textoResultadoVentas } = await import("../app/components/FinanzasClientes.jsx");

const E = "33333333-3333-3333-3333-333333333333";
const EMP = "44444444-4444-4444-4444-444444444444";
const DEU = "01.01.02.001.001";
const VG = "04.01.01.001.001";
const EG = "04.01.01.001.002";
const CUENTAS = [
  { codigo: DEU, nombre: "Deudores Por Ventas", activa: true },
  { codigo: VG, nombre: "Ventas Generales", activa: true },
  { codigo: EG, nombre: "Entregas Generales", activa: true },
];
const CTAS = { deudores: DEU, ventas: VG, entregas: EG };
const CENTROS = [{ codigo: "MADERA", division: "Madera", activo: true }, { codigo: "HIERRO", division: "Hierro", activo: true }];
const BCG = { id: 2, nombre: "BCG", alias: [], activo: true };
const CONFIG = { activo: true, desde: "2026-11-01" };
// created_at en UTC: 2026-11-01T02:00Z es todavía 31/10 en Argentina
const OT = (id, x = {}) => ({ id, ot: `M-${id}`, cliente: "BCG", obra: "HOTEL", descripcion: "COCINA", division: "MADERA", estado: "activo", created_at: "2026-11-05T15:00:00Z", ...x });

// ─── Reglas ───

test("cuentas y configuración — por nombre; apagada sin fecha", () => {
  assert.deepEqual(cuentasVentas(CUENTAS), CTAS);
  assert.match(cuentasVentas(CUENTAS.slice(0, 2)).error, /Entregas Generales/);
  assert.deepEqual(leerConfigVentas({ activo: true }), { activo: false, desde: null });
  assert.deepEqual(leerConfigVentas({ activo: true, desde: "2026-11-01" }), CONFIG);
  assert.equal(centroDeDivision("MADERA", CENTROS), "MADERA");
  assert.equal(centroDeDivision("hierro", CENTROS), "HIERRO");
  assert.equal(centroDeDivision("Aluminio", CENTROS), null);
  assert.equal(fechaCarga({ created_at: "2026-11-01T02:00:00Z" }), "2026-10-31", "en hora argentina");
});

test("venta al cargar la OT con precio, entrega al terminarla; las de antes de la fecha no", () => {
  const proyectos = [OT(1), OT(2, { estado: "cerrado" }), OT(3, { created_at: "2026-10-20T15:00:00Z", estado: "cerrado" }), OT(4), OT(5, { cliente: "Cliente Nuevo SA", division: "Aluminio" })];
  const precios = new Map([["M-1", 1000], ["M-2", 2500.5], ["M-3", 9000], ["M-5", 700]]);
  const p = planVentas({ proyectos, precios, operaciones: [], clientes: [BCG], cuentas: CTAS, centros: CENTROS, config: CONFIG, hoy: "2026-11-09" });
  assert.deepEqual(p.crear.map((o) => [o.origen, o.origen_id, o.cuenta_debe, o.cuenta_haber, o.total, o.fecha]), [
    [ORIGEN_VENTA, "p1", DEU, VG, 1000, "2026-11-05"],
    [ORIGEN_VENTA, "p2", DEU, VG, 2500.5, "2026-11-05"],
    [ORIGEN_ENTREGA, "p2", VG, EG, 2500.5, "2026-11-09"],
    [ORIGEN_VENTA, "p5", DEU, VG, 700, "2026-11-05"],
  ], "la 3 es de antes, la 4 no tiene precio");
  const v1 = p.crear[0];
  assert.deepEqual([v1.tipo, v1.cliente_id, v1.entidad, v1.proyecto_id, v1.centro_costo, v1.neto, v1.iva, v1.estado], ["VENTA", 2, "BCG", 1, "MADERA", 1000, 0, "confirmada"]);
  assert.match(v1.descripcion, /^Venta OT M-1 · BCG · HOTEL · COCINA/);
  const v5 = p.crear[3];
  assert.deepEqual([v5.cliente_id, v5.cliente_nombre, v5.centro_costo], [null, "Cliente Nuevo SA", null]);
  assert.deepEqual(p.clientesNuevos, ["Cliente Nuevo SA"]);
});

test("precio cambiado se corrige, sin precio se anula, reabierta anula la entrega, anulada a mano no vuelve", () => {
  const ops = [
    { id: 10, origen: ORIGEN_VENTA, origen_id: "p1", total: 1000 },
    { id: 11, origen: ORIGEN_ENTREGA, origen_id: "p1", total: 1000 },
    { id: 12, origen: ORIGEN_VENTA, origen_id: "p2", total: 500 },
    { id: 13, origen: ORIGEN_VENTA, origen_id: "p3", total: 800, anulada_at: "x", anulada_por_nombre: "Tadeo" },
    { id: 14, origen: ORIGEN_VENTA, origen_id: "p4", total: 300, anulada_at: "x", anulada_por_nombre: "Gypi (la OT quedó sin precio)" },
    { id: 15, origen: ORIGEN_VENTA, origen_id: "p6", total: 50 },
  ];
  const proyectos = [
    OT(1, { estado: "cerrado" }),
    OT(2), // sin precio ahora
    OT(3, { estado: "cerrado" }), // el dueño anuló la venta: ni venta ni entrega
    OT(4), // la anuló Gypi y ahora tiene precio: vuelve
    OT(6, { created_at: "2026-09-01T12:00:00Z", estado: "cerrado" }), // de antes con venta: no crea entrega
  ];
  const precios = { "M-1": 1200, "M-3": 800, "M-4": 300, "M-6": 50 };
  let p = planVentas({ proyectos, precios, operaciones: ops, clientes: [BCG], cuentas: CTAS, config: CONFIG, hoy: "2026-11-09" });
  assert.deepEqual(p.corregir, [{ id: 10, cambios: { neto: 1200, iva: 0, otros_impuestos: 0, total: 1200, total_ars: 1200 } }, { id: 11, cambios: { neto: 1200, iva: 0, otros_impuestos: 0, total: 1200, total_ars: 1200 } }]);
  assert.deepEqual(p.anular.map((a) => a.id), [12]);
  assert.match(p.anular[0].motivo, /^Gypi/);
  assert.deepEqual(p.crear.map((o) => [o.origen, o.origen_id]), [[ORIGEN_VENTA, "p4"]]);
  // La 1 se vuelve a abrir: se anula la entrega
  p = planVentas({ proyectos: [OT(1)], precios: { "M-1": 1000 }, operaciones: ops, clientes: [BCG], cuentas: CTAS, config: CONFIG, hoy: "2026-11-09" });
  assert.deepEqual(p.anular.map((a) => [a.id, a.motivo]), [[11, "Gypi (la OT se volvió a abrir)"]]);
  assert.deepEqual([p.crear.length, p.corregir.length], [0, 0]);
});

// ─── Servidor ───

function mockBase({ config = { activo: true, desde: "2026-11-01" }, modulos = true, proyectos = [OT(1, { cliente: "Nuevo SRL", estado: "cerrado" })], ops = [] } = {}) {
  const escrito = [];
  let idCliente = 100;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: modulos ? [] : [{ modulo: "finanzas", activo: true, apagado: true }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push({ tabla: "config_sistema", metodo: o.method, body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        return { status: 200, body: config ? [{ clave: "finanzas_ventas_ot", valor: config }] : [] };
      },
    },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_centros_costo"), respond: () => ({ status: 200, body: CENTROS }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: proyectos }) },
    { match: (u) => u.includes("/rest/v1/precios_ot"), respond: () => ({ status: 200, body: [{ ot: "M-1", precio: 1000 }] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_clientes"),
      respond: (u, o) => {
        if (o?.method === "POST") { const b = JSON.parse(o.body); escrito.push({ tabla: "fin_clientes", body: b }); return { status: 201, body: [{ id: idCliente++, alias: [], activo: true, ...b }] }; }
        return { status: 200, body: [BCG] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push({ tabla: "fin_operaciones", metodo: o.method, url: u, body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        return { status: 200, body: ops };
      },
    },
  ]);
  return escrito;
}

test("sincronizarVentasOt — crea el cliente que falta y anota venta y entrega con su id", async () => {
  const escrito = mockBase();
  const r = await sincronizarVentasOt(E, { hoy: "2026-11-09" });
  assert.deepEqual([r.accion, r.creadas, r.clientes_nuevos], ["hecha", 2, 1]);
  assert.deepEqual([escrito[0].tabla, escrito[0].body.nombre], ["fin_clientes", "Nuevo SRL"]);
  const ops = escrito[1].body;
  assert.deepEqual(ops.map((o) => [o.origen, o.cliente_id, o.entidad, o.empresa_id, "cliente_nombre" in o]), [
    [ORIGEN_VENTA, 100, "Nuevo SRL", E, false],
    [ORIGEN_ENTREGA, 100, "Nuevo SRL", E, false],
  ]);
  assert.equal(ops[0].cargada_por_nombre, "Gypi (Plan de trabajo)");
});

test("sincronizarVentasOt — apagada o sin Finanzas no hace nada", async () => {
  let escrito = mockBase({ config: { activo: false, desde: "2026-11-01" } });
  assert.equal((await sincronizarVentasOt(E)).accion, "apagada");
  assert.equal(escrito.length, 0);
  escrito = mockBase({ modulos: false });
  // Otra empresa: getModulosEmpresa guarda en memoria por empresa
  assert.equal((await sincronizarVentasOt("55555555-5555-5555-5555-555555555555")).accion, "omitida");
  assert.equal(escrito.length, 0);
});

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, metodo, body) => api[metodo](new Request("http://localhost/api/finanzas/clientes", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

test("/api/finanzas/clientes — prender las ventas: guarda la fecha y las corre; solo el Dueño", async () => {
  let escrito = mockBase({ config: null, proyectos: [] });
  assert.equal((await pedir("administrativo", "POST", { accion: "config_ventas", activo: true, desde: "2026-11-01" })).status, 403);
  assert.equal((await pedir("gerencial", "POST", { accion: "config_ventas", activo: true })).status, 400, "sin fecha");
  const r = await pedir("gerencial", "POST", { accion: "config_ventas", activo: true, desde: "2026-11-01" });
  assert.equal(r.status, 200);
  assert.deepEqual([escrito[0].tabla, escrito[0].metodo, escrito[0].body.valor], ["config_sistema", "POST", { activo: true, desde: "2026-11-01" }]);
  escrito = mockBase({ config: { activo: false, desde: null } });
  assert.equal((await pedir("gerencial", "POST", { accion: "revisar_ventas" })).status, 400, "apagada");
});

test("textoResultadoVentas — cuenta lo que pasó", () => {
  assert.equal(textoResultadoVentas({ accion: "hecha", creadas: 2, anuladas: 1 }), "Ventas y entregas: 2 anotadas, 1 anuladas");
  assert.match(textoResultadoVentas({ accion: "hecha" }), /al día/);
});

// ─── Pantalla ───

test("Clientes — 🧾 Ventas de las OT: se prende con la fecha", async () => {
  const datos = { cuentas: CUENTAS, clientes: [BCG], tesoreria: [], proyectos: [], operaciones: [], cuentas_deudores: [DEU], ventas_ot: { activo: false, desde: null, error: null } };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, resultado: { accion: "hecha", creadas: 3 } }), { status: 200 }); }
    return new Response(JSON.stringify(datos), { status: 200 });
  };
  render(<FinanzasClientes />);
  await waitFor(() => assert.ok(screen.getByText(/todavía no se anotan solas/)));
  fireEvent.click(screen.getByText("🧾 Ventas de las OT"));
  fireEvent.change(screen.getByLabelText("Solo las OT cargadas desde"), { target: { value: "2026-11-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], { accion: "config_ventas", activo: true, desde: "2026-11-01" });
});

test("planEntregasEstimadas: el día en que se vio terminada cada OT sin precio", () => {
  const config = { activo: true, desde: "2026-10-01" };
  const proyectos = [
    { id: 1, ot: "A", estado: "cerrado", created_at: "2026-10-05T12:00:00Z" }, // nueva: hoy
    { id: 2, ot: "B", estado: "cerrado", created_at: "2026-10-05T12:00:00Z" }, // ya tenía fecha: queda
    { id: 3, ot: "C", estado: "cerrado", created_at: "2026-10-05T12:00:00Z" }, // tiene precio: sale
    { id: 4, ot: "D", estado: "activo", created_at: "2026-10-05T12:00:00Z" }, // se reabrió: sale
    { id: 5, ot: "E", estado: "cerrado", created_at: "2026-09-05T12:00:00Z" }, // antes de "desde"
  ];
  const precios = new Map([["C", 1000]]);
  const r = planEntregasEstimadas({ proyectos, precios, config, fechas: { p2: "2026-10-20", p3: "2026-10-21", p4: "2026-10-22" }, hoy: "2026-11-13" });
  assert.deepEqual(r.fechas, { p1: "2026-11-13", p2: "2026-10-20" });
  assert.equal(r.cambio, true);
  assert.equal(planEntregasEstimadas({ proyectos, precios, config, fechas: r.fechas, hoy: "2026-11-14" }).cambio, false);
});
