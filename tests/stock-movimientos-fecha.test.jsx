// tests/stock-movimientos-fecha.test.jsx — 19/11 (migración 197): cada
// ingreso y consumo de Materiales tiene la fecha del día en que pasó, que la
// oficina elige al cargarlo. Sin la columna, se carga como antes.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { fechaDelMovimiento, hoyMovimiento, diaDelMovimiento, fechaCorta } from "../app/lib/movimientosStock.js";
import { movimientoParaPlanilla } from "../app/lib/planillaMrp.js";
import { movimientoStockBody } from "../app/lib/schemas.ts";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/stock/movimientos/route.js");
const { default: MovimientosStock, cuandoFue } = await import("../app/components/MovimientosStock.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const TABLILLA = { sku: "3.3.1.6.109.2", nombre: "Tablilla 0277 negra", unidad: "MT", division: "ALUMINIO", activo: true };

test("fecha del movimiento — hoy por defecto, ni futura ni de hace más de un año", () => {
  const ahora = new Date("2026-11-19T02:00:00Z"); // 18/11 23 h en Argentina
  assert.equal(hoyMovimiento(ahora), "2026-11-18");
  assert.deepEqual(fechaDelMovimiento(null, ahora), { fecha: "2026-11-18" });
  assert.deepEqual(fechaDelMovimiento("2026-11-10", ahora), { fecha: "2026-11-10" });
  assert.match(fechaDelMovimiento("2026-11-19", ahora).error, /después de hoy/);
  assert.match(fechaDelMovimiento("2025-10-01", ahora).error, /más de un año/);
  assert.match(fechaDelMovimiento("2026-02-30", ahora).error, /no es válida/);
  assert.equal(diaDelMovimiento({ fecha: "2026-11-10", created_at: "2026-11-18T12:00:00Z" }), "2026-11-10");
  assert.equal(diaDelMovimiento({ created_at: "2026-11-19T01:00:00Z" }), "2026-11-18", "sin la 197, el día en que se cargó (hora argentina)");
  assert.equal(fechaCorta("2026-11-10"), "10/11/2026");
});

test("schema — fecha opcional en registrar y registrar_varios", () => {
  const uno = movimientoStockBody.safeParse({ accion: "registrar", tipo: "consumo", sku: TABLILLA.sku, cantidad: 2, fecha: "2026-11-10" });
  assert.equal(uno.success, true);
  assert.equal(uno.data.fecha, "2026-11-10");
  assert.equal(movimientoStockBody.safeParse({ accion: "registrar", tipo: "consumo", sku: TABLILLA.sku, cantidad: 2 }).data.fecha, null);
  assert.equal(movimientoStockBody.safeParse({ accion: "registrar", tipo: "consumo", sku: TABLILLA.sku, cantidad: 2, fecha: "10/11/2026" }).success, false);
  const varios = movimientoStockBody.safeParse({ accion: "registrar_varios", tipo: "consumo", renglones: [{ sku: TABLILLA.sku, cantidad: 1 }], fecha: "2026-11-10" });
  assert.equal(varios.data.fecha, "2026-11-10");
});

test("migración 197 — agrega fecha, completa las viejas con el día de carga y queda en el chequeo", () => {
  const sql = readFileSync(new URL("../supabase/migrations/197_fecha_movimientos_stock.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists fecha date/);
  assert.match(sql, /set fecha = \(created_at at time zone 'America\/Argentina\/Buenos_Aires'\)::date/);
  assert.match(sql, /do \$mig\$/);
  assert.ok(MIGRACIONES.some((m) => m.n === 197 && m.tablas.movimientos_stock.includes("fecha")));
});

function mockRuta({ sinColumna = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: [TABLILLA] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [{ ot: "M-7495" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ nombre: "Juan Pérez" }] }) },
    {
      match: (u) => u.includes("/rest/v1/movimientos_stock"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: [] };
        const body = JSON.parse(o.body);
        const filas = Array.isArray(body) ? body : [body];
        if (sinColumna && filas.some((f) => "fecha" in f)) {
          return { status: 400, body: { code: "PGRST204", message: "Could not find the 'fecha' column of 'movimientos_stock' in the schema cache" } };
        }
        escrito.push(body);
        return { status: 201, body: filas.map((f, i) => ({ id: 9 + i, ...f })) };
      },
    },
  ]);
  return escrito;
}
const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const req = (t, body) => new Request("http://localhost/api/stock/movimientos", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/stock/movimientos — guarda la fecha elegida, o la de hoy", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token("administrativo"), { accion: "registrar", tipo: "ajuste", sku: TABLILLA.sku, cantidad: -2, fecha: "2026-11-10" }));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].fecha, "2026-11-10");

  escrito = mockRuta();
  res = await api.POST(req(await token("operativo"), { accion: "registrar_varios", tipo: "consumo", renglones: [{ sku: TABLILLA.sku, cantidad: 1, ot: "M-7495" }] }));
  assert.equal(res.status, 200);
  assert.equal(escrito[0][0].fecha, hoyMovimiento());

  escrito = mockRuta();
  res = await api.POST(req(await token("administrativo"), { accion: "registrar", tipo: "ajuste", sku: TABLILLA.sku, cantidad: 1, fecha: "2099-01-01" }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /después de hoy/);
  assert.equal(escrito.length, 0);
});

test("/api/stock/movimientos — sin la migración 197 se carga igual, sin la fecha", async () => {
  let escrito = mockRuta({ sinColumna: true });
  let res = await api.POST(req(await token("operativo"), { accion: "registrar", tipo: "consumo", sku: TABLILLA.sku, cantidad: 3, fecha: "2026-11-10" }));
  assert.equal(res.status, 200);
  assert.equal(escrito.length, 1);
  assert.equal("fecha" in escrito[0], false);

  escrito = mockRuta({ sinColumna: true });
  res = await api.POST(req(await token("operativo"), { accion: "registrar_varios", tipo: "devolucion", renglones: [{ sku: TABLILLA.sku, cantidad: 1 }] }));
  assert.equal(res.status, 200);
  assert.equal("fecha" in escrito[0][0], false);
});

test("planilla MRP — el movimiento va con la fecha en que pasó", () => {
  const m = { id: 5, tipo: "consumo", sku: TABLILLA.sku, cantidad: 2, created_at: "2026-11-18T12:00:00Z" };
  assert.equal(movimientoParaPlanilla({ ...m, fecha: "2026-11-10" }).fecha, "2026-11-10");
  assert.equal(movimientoParaPlanilla(m).fecha, "2026-11-18", "sin la 197, el día en que se cargó");
});

test("Materiales — elegir la fecha al cargar y verla en la lista", async () => {
  const enviados = [];
  const movs = [{ id: 4, tipo: "consumo", sku: TABLILLA.sku, nombre: TABLILLA.nombre, cantidad: 3, unidad: "MT", fecha: "2026-11-10", created_at: "2026-11-18T15:00:00Z", anulado: false }];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/stock/movimientos")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (body?.path?.startsWith("movimientos_stock")) return new Response(JSON.stringify({ data: movs }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  render(<MovimientosStock usuario={{ id: EMP, rol: "administrativo" }} articulos={[TABLILLA]} />);
  await waitFor(() => assert.ok(screen.getByText(/10\/11\/2026 · cargado/)));

  fireEvent.click(screen.getByText("📤 Cargar consumo"));
  const fecha = screen.getByLabelText("Fecha");
  assert.equal(fecha.value, hoyMovimiento(), "arranca en hoy");
  fireEvent.change(screen.getByLabelText("Artículo"), { target: { value: "tablilla" } });
  fireEvent.click(screen.getByText("Tablilla 0277 negra"));
  fireEvent.change(screen.getByLabelText("Cantidad de Tablilla 0277 negra"), { target: { value: "4" } });
  fireEvent.change(fecha, { target: { value: "2026-11-12" } });
  fireEvent.click(screen.getByText("Guardar"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].accion, "registrar_varios");
  assert.equal(enviados[0].fecha, "2026-11-12");
});

test("cuándo fue — una sola fecha si se cargó el mismo día", () => {
  assert.doesNotMatch(cuandoFue({ fecha: "2026-11-18", created_at: "2026-11-18T15:00:00Z" }), /cargado/);
  assert.match(cuandoFue({ fecha: "2026-11-10", created_at: "2026-11-18T15:00:00Z" }), /^10\/11\/2026 · cargado /);
});
