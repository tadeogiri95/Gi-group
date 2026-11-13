// tests/finanzas-meses-cerrados.test.jsx — Parte 9 del plan de Tesorería
// (13/11): cerrar y reabrir meses. Migración 190.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { nombreMes, mesCerradoDeError, textoMesCerrado, cerrarMes, reabrirMes, estadoMes } from "../app/lib/finanzasMeses.js";
import { devengamientoDelMes } from "../app/lib/finanzasDevengamiento.js";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { errorFinanzas } = await import("../app/lib/finanzasApi.js");
const { safeErrorMessage } = await import("../app/lib/validate.ts");
const api = await import("../app/api/finanzas/meses/route.js");
const { default: FinanzasDevengamiento } = await import("../app/components/FinanzasDevengamiento.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const AHORA = "2026-11-13T15:00:00.000Z";

test("reglas — cerrar solo meses que empezaron; reabrir pide el motivo y queda en el historial", () => {
  assert.equal(nombreMes("2026-10"), "octubre de 2026");
  assert.match(cerrarMes(null, { mes: "2026-12", hoy: "2026-11-13", quien: "Tadeo", ahora: AHORA }).error, /todavía no empezó/);
  assert.match(cerrarMes(null, { mes: "2026-13", hoy: "2026-11-13" }).error, /Elegí un mes/);
  const c = cerrarMes(null, { mes: "2026-10", hoy: "2026-11-13", quien: "Tadeo", ahora: AHORA }).cambios;
  assert.equal(c.cerrado, true);
  assert.equal(c.cerrado_por_nombre, "Tadeo");
  assert.deepEqual(c.historial, [{ accion: "cerrar", at: AHORA, por: "Tadeo" }]);
  assert.match(cerrarMes(c, { mes: "2026-10", hoy: "2026-11-13" }).error, /ya está cerrado/);

  assert.match(reabrirMes(c, { mes: "2026-10", motivo: "  " }).error, /motivo/);
  assert.match(reabrirMes(null, { mes: "2026-10", motivo: "x" }).error, /no está cerrado/);
  assert.match(reabrirMes(c, { mes: "2026-10", motivo: "x".repeat(501) }).error, /muy largo/);
  const r = reabrirMes(c, { mes: "2026-10", motivo: " Faltaba la luz ", quien: "Ana", ahora: "2026-11-14T10:00:00.000Z" }).cambios;
  assert.equal(r.cerrado, false);
  assert.equal(r.motivo, "Faltaba la luz");
  assert.equal(r.reabierto_por_nombre, "Ana");
  assert.equal(r.historial.length, 2);
  assert.deepEqual(r.historial[1], { accion: "reabrir", at: "2026-11-14T10:00:00.000Z", por: "Ana", motivo: "Faltaba la luz" });
  // Se puede volver a cerrar y el historial sigue
  assert.equal(cerrarMes({ ...c, ...r }, { mes: "2026-10", hoy: "2026-11-13", ahora: AHORA }).cambios.historial.length, 3);
  assert.deepEqual(estadoMes("2026-09", null), { mes: "2026-09", nombre: "septiembre de 2026", cerrado: false, cerrado_at: null, cerrado_por_nombre: null, reabierto_at: null, reabierto_por_nombre: null, motivo: null, historial: [] });
});

test("el error de la base sale en castellano (409 en Finanzas)", async () => {
  const err = new Error('POST fin_operaciones: {"code":"P0001","message":"MES_CERRADO 2026-10"}');
  assert.equal(mesCerradoDeError(err), "2026-10");
  assert.equal(mesCerradoDeError(new Error("otra cosa")), null);
  assert.match(textoMesCerrado("2026-10"), /^Octubre de 2026 está cerrado: no se puede cargar, corregir ni anular/);
  const r = errorFinanzas(err, "test");
  assert.equal(r.status, 409);
  const d = await r.json();
  assert.equal(d.mes_cerrado, "2026-10");
  assert.match(d.error, /Octubre de 2026 está cerrado/);
  // Las rutas que no son de Finanzas (Mi caja, Compras) usan safeErrorMessage
  assert.match(safeErrorMessage(err), /Octubre de 2026 está cerrado/);
});

test("migración 190 — tabla, trigger que bloquea todo lo que cambia los números, y registrada", () => {
  const sql = readFileSync(new URL("../supabase/migrations/190_meses_cerrados.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /create table if not exists public\.fin_meses_cerrados/);
  assert.match(sql, /tenant_isolation_auth_fin_meses_cerrados/);
  assert.match(sql, /before insert or update or delete on public\.fin_operaciones/);
  assert.match(sql, /MES_CERRADO %/);
  for (const col of ["fecha", "cuenta_debe", "cuenta_haber", "total", "estado", "anulada_at"]) assert.match(sql, new RegExp(`old\\.${col}`));
  const m = MIGRACIONES.find((x) => x.n === 190);
  assert.equal(m.archivo, "190_meses_cerrados.sql");
  assert.ok(m.tablas.fin_meses_cerrados);
});

// ─── API ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, body) => api.POST(new Request("http://localhost/api/finanzas/meses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, body: JSON.stringify(body) }));
const ver = async (q = "") => api.GET(new Request(`http://localhost/api/finanzas/meses${q}`, { headers: { Authorization: `Bearer ${await token("gerencial")}` } }));

function mockApi({ fila = null, sinTabla = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ nombre: "Tadeo" }] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_meses_cerrados"),
      respond: (u, o) => {
        if (sinTabla) return { status: 404, body: { code: "42P01", message: 'relation "public.fin_meses_cerrados" does not exist' } };
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push({ metodo: o.method, url: u, body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        return { status: 200, body: fila ? [fila] : [] };
      },
    },
  ]);
  return escrito;
}

test("/api/finanzas/meses — solo el Dueño; cerrar y reabrir con motivo", async () => {
  let escrito = mockApi();
  assert.equal((await pedir("administrativo", { accion: "cerrar", mes: "2026-10" })).status, 403);
  assert.equal((await pedir("gerencial", { accion: "borrar", mes: "2026-10" })).status, 400);
  assert.equal((await pedir("gerencial", { accion: "cerrar", mes: "2099-01" })).status, 400);
  const r = await pedir("gerencial", { accion: "cerrar", mes: "2026-10" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mes.cerrado, true);
  assert.equal(escrito.length, 1);
  assert.equal(escrito[0].metodo, "POST");
  assert.equal(escrito[0].body.empresa_id, E);
  assert.equal(escrito[0].body.mes, "2026-10");
  assert.equal(escrito[0].body.cerrado_por_nombre, "Tadeo");
  assert.equal(escrito[0].body.historial[0].accion, "cerrar");

  const fila = { mes: "2026-10", cerrado: true, cerrado_at: AHORA, cerrado_por_nombre: "Tadeo", historial: [{ accion: "cerrar", at: AHORA, por: "Tadeo" }] };
  escrito = mockApi({ fila });
  assert.equal((await pedir("gerencial", { accion: "reabrir", mes: "2026-10" })).status, 400, "sin motivo no");
  assert.equal((await pedir("gerencial", { accion: "reabrir", mes: "2026-10", motivo: "Faltaba la luz" })).status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.match(escrito[0].url, /mes=eq\.2026-10/);
  assert.equal(escrito[0].body.cerrado, false);
  assert.equal(escrito[0].body.motivo, "Faltaba la luz");
  assert.equal(escrito[0].body.historial.length, 2);

  const v = await ver("?mes=2026-10");
  assert.equal((await v.json()).mes.cerrado, true);
});

test("/api/finanzas/meses — sin la migración 190, avisa cuál correr", async () => {
  mockApi({ sinTabla: true });
  const r = await ver("?mes=2026-10");
  assert.equal(r.status, 409);
  const d = await r.json();
  assert.equal(d.falta_migracion, 190);
  assert.match(d.error, /migración 190/);
});

// ─── Pantalla ───

const LISTAS = { cuentas: [], tipos: [], tesoreria: [], centros: [], proveedores: [], proyectos: [] };

function mockPantalla(cierre) {
  const datos = devengamientoDelMes("2026-10", { ops: [], cuentas: [], config: {}, hoy: "2026-11-13" });
  const posts = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { posts.push({ url: String(url), body: JSON.parse(o.body) }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify({ ...datos, hoy: "2026-11-13", listas: LISTAS, cierre }), { status: 200 });
  };
  return posts;
}

test("pantalla — 🔒 Cerrar el mes pide confirmación", async () => {
  const posts = mockPantalla(estadoMes("2026-10", null));
  render(<FinanzasDevengamiento />);
  fireEvent.click(await screen.findByRole("button", { name: "🔒 Cerrar octubre de 2026" }));
  await screen.findByText(/nadie puede cargar, corregir ni anular nada con fecha de ese mes/);
  fireEvent.click(screen.getByRole("button", { name: "🔒 Cerrar el mes" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.match(posts[0].url, /\/api\/finanzas\/meses$/);
  assert.deepEqual(posts[0].body, { accion: "cerrar", mes: "2026-10", motivo: "" });
});

test("pantalla — mes cerrado: aviso, sin botones para cargar, y 🔓 Reabrir con motivo", async () => {
  const cierre = estadoMes("2026-10", { cerrado: true, cerrado_at: AHORA, cerrado_por_nombre: "Tadeo", historial: [{ accion: "cerrar", at: AHORA, por: "Tadeo" }] });
  const posts = mockPantalla(cierre);
  render(<FinanzasDevengamiento />);
  await screen.findByText(/octubre de 2026 está cerrado/);
  assert.equal(screen.queryByRole("button", { name: /🔒 Cerrar octubre/ }), null);
  for (const b of screen.getAllByRole("button", { name: /＋ Cargar gasto|＋ Asiento/ })) assert.equal(b.disabled, true);
  assert.ok(screen.getByText(/Historial \(1\)/));
  fireEvent.click(screen.getByRole("button", { name: "🔓 Reabrir" }));
  const reabrir = await screen.findAllByRole("button", { name: "🔓 Reabrir" });
  fireEvent.click(reabrir[reabrir.length - 1]);
  await screen.findByText(/Escribí el motivo/);
  assert.equal(posts.length, 0);
  fireEvent.change(screen.getByLabelText("Motivo para reabrir"), { target: { value: "Faltaba la luz" } });
  fireEvent.click(reabrir[reabrir.length - 1]);
  await waitFor(() => assert.equal(posts.length, 1));
  assert.deepEqual(posts[0].body, { accion: "reabrir", mes: "2026-10", motivo: "Faltaba la luz" });
});
