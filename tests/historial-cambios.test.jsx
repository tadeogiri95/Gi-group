// tests/historial-cambios.test.jsx — 19/11 (punto 12, migración 199): cada
// corrección queda en el historial con qué cambió, quién y cuándo. En
// Materiales, el movimiento corregido queda anulado y se carga uno nuevo.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { conEntrada, cuandoCambio, diferencias, entradaCorreccion, historialDe, MAX_HISTORIAL, textoCambio } from "../app/lib/historialCambios.js";
import { hoyMovimiento, movimientoCorregido } from "../app/lib/movimientosStock.js";
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
const { default: MovimientosStock } = await import("../app/components/MovimientosStock.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const AYER = hoyMovimiento(new Date(Date.now() - 86400000));
const MOV = {
  id: 4, empresa_id: E, tipo: "consumo", sku: "3.3.1.6.109.2", nombre: "Tablilla 0277 negra", unidad: "MT", division: "ALUMINIO",
  cantidad: 3, ot: "M-7495", proveedor: null, comprobante: null, precio_unitario: null, notas: null,
  empleado_id: EMP, legajo: 7, empleado_nombre: "Juan Pérez", anulado: false, anulado_por: null, anulado_at: null,
  fecha: AYER, created_at: new Date(Date.now() - 3600000).toISOString(), historial: [],
};

test("historial — diferencias, entradas y lo que se muestra", () => {
  assert.deepEqual(diferencias({ total: 1210, descripcion: "A" }, { total: 1210.001, descripcion: "B" }, ["total", "descripcion", "fecha"]),
    [{ campo: "descripcion", antes: "A", despues: "B" }]);
  const e = entradaCorreccion({ por: "Tadeo", at: "2026-11-19T15:30:00Z", cambios: [{ campo: "fecha", antes: "2026-11-05", despues: "2026-11-04" }] });
  assert.equal(e.accion, "corregida");
  const largo = Array.from({ length: MAX_HISTORIAL }, (_, i) => ({ at: String(i) }));
  assert.equal(conEntrada(largo, e).length, MAX_HISTORIAL, "se queda con las últimas");
  assert.equal(conEntrada(largo, e).at(-1), e);
  const todo = historialDe({ created_at: "2026-11-05T10:00:00Z", historial: [e] }, { anuladaAt: "2026-11-20T10:00:00Z", anuladaPor: "Felipe", cargadaPor: "Juan" });
  assert.deepEqual(todo.map((h) => [h.accion, h.por]), [["cargada", "Juan"], ["corregida", "Tadeo"], ["anulada", "Felipe"]]);
  assert.equal(textoCambio(e.cambios[0], { etiquetas: { fecha: "Fecha" } }), "Fecha: 05/11/2026 → 04/11/2026");
  assert.equal(textoCambio({ campo: "ot", antes: null, despues: "M-1" }, { etiquetas: { ot: "OT" } }), "OT: (vacío) → M-1");
  assert.equal(cuandoCambio("2026-11-19T15:30:00Z"), "19/11/2026 12:30");
});

test("movimientoCorregido — fecha, cantidad, OT, notas y precio (solo ingreso)", () => {
  const { campos, detalle, errores } = movimientoCorregido(MOV, { cantidad: 5, ot: "M-7495", notas: "  se cortó  mal " });
  assert.deepEqual(errores, []);
  assert.equal(campos.cantidad, 5);
  assert.equal(campos.notas, "se cortó mal");
  assert.deepEqual(detalle, [{ campo: "cantidad", antes: 3, despues: 5 }, { campo: "notas", antes: null, despues: "se cortó mal" }]);
  assert.deepEqual(movimientoCorregido(MOV, { cantidad: 3, ot: "M-7495" }).errores, ["No cambiaste nada."]);
  assert.match(movimientoCorregido(MOV, { cantidad: -1 }).errores[0], /mayor a cero/);
  assert.equal(movimientoCorregido({ ...MOV, tipo: "ajuste" }, { cantidad: -1 }).errores.length, 0, "un ajuste puede restar");
  assert.match(movimientoCorregido(MOV, { precio_unitario: 10 }).errores[0], /solo va en un ingreso/);
  assert.match(movimientoCorregido(MOV, { fecha: "2099-01-01" }).errores[0], /después de hoy/);
  assert.match(movimientoCorregido({ ...MOV, anulado: true }, { cantidad: 5 }).errores[0], /anulado/);
});

test("schema y migración 199", () => {
  const ok = movimientoStockBody.safeParse({ accion: "corregir", id: 4, cambios: { cantidad: 5, ot: "", notas: "" } });
  assert.equal(ok.success, true);
  assert.equal(ok.data.cambios.ot, null);
  assert.equal(ok.data.cambios.notas, null);
  assert.equal(movimientoStockBody.safeParse({ accion: "corregir", id: 4, cambios: { sku: "x" } }).success, false, "el artículo no se cambia");
  const sql = readFileSync(new URL("../supabase/migrations/199_historial_cambios.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /fin_operaciones\s+add column if not exists historial jsonb/);
  assert.match(sql, /movimientos_stock\s+add column if not exists historial jsonb/);
  const m = MIGRACIONES.find((x) => x.n === 199);
  assert.deepEqual(m.tablas, { fin_operaciones: ["historial"], movimientos_stock: ["historial"] });
});

function mockRuta({ mov = MOV, falla = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: (u) => ({ status: 200, body: u.includes("M-9999") ? [] : [{ ot: "M-7877" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ nombre: "Tadeo" }] }) },
    {
      match: (u) => u.includes("/rest/v1/movimientos_stock"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: mov ? [mov] : [] };
        const body = JSON.parse(o.body);
        escrito.push({ metodo: o.method, url: decodeURIComponent(u), body });
        if (o.method === "POST" && falla) return { status: 500, body: { message: "se cortó" } };
        return { status: 201, body: [{ id: o.method === "POST" ? 10 : 4, ...body }] };
      },
    },
  ]);
  return escrito;
}
const token = async (rol, empleadoId = EMP) => (await signAccessToken({ empleadoId, empresaId: E, legajo: 7, rol })).token;
const req = (t, body) => new Request("http://localhost/api/stock/movimientos", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/stock/movimientos corregir — anula el viejo, carga el nuevo y los dos guardan el historial", async () => {
  const escrito = mockRuta();
  const res = await api.POST(req(await token("administrativo"), { accion: "corregir", id: 4, cambios: { cantidad: 5, ot: "M-7877" } }));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito.map((x) => x.metodo), ["PATCH", "POST", "PATCH"]);
  assert.match(escrito[0].url, /id=eq\.4&.*anulado=eq\.false/);
  assert.equal(escrito[0].body.anulado, true);
  const nuevo = escrito[1].body;
  assert.equal(nuevo.cantidad, 5);
  assert.equal(nuevo.ot, "M-7877");
  assert.equal(nuevo.sku, MOV.sku);
  assert.equal(nuevo.empleado_nombre, "Juan Pérez", "sigue siendo de quien lo cargó");
  assert.equal(nuevo.created_at, MOV.created_at);
  assert.equal("id" in nuevo, false);
  assert.equal(nuevo.historial[0].por, "Tadeo");
  assert.match(nuevo.historial[0].nota, /GY-4/);
  assert.deepEqual(nuevo.historial[0].cambios, [{ campo: "cantidad", antes: 3, despues: 5 }, { campo: "ot", antes: "M-7495", despues: "M-7877" }]);
  assert.match(escrito[2].body.historial[0].nota, /GY-10/);

  // Si el nuevo no se guarda, el viejo vuelve a estar vivo
  const fallo = mockRuta({ falla: true });
  assert.notEqual((await api.POST(req(await token("administrativo"), { accion: "corregir", id: 4, cambios: { cantidad: 5 } }))).status, 200);
  assert.equal(fallo.at(-1).body.anulado, false);

  // OT que no existe, o alguien que no lo cargó
  mockRuta();
  assert.equal((await api.POST(req(await token("administrativo"), { accion: "corregir", id: 4, cambios: { ot: "M-9999" } }))).status, 404);
  const ajeno = mockRuta();
  assert.equal((await api.POST(req(await token("operativo", "33333333-3333-3333-3333-333333333333"), { accion: "corregir", id: 4, cambios: { cantidad: 5 } }))).status, 403);
  assert.equal(ajeno.length, 0);
});

test("/api/stock/movimientos corregir — sin la 199, se corrige igual sin historial y avisa", async () => {
  const { historial: _sin, ...viejo } = MOV;
  const escrito = mockRuta({ mov: viejo });
  const res = await api.POST(req(await token("administrativo"), { accion: "corregir", id: 4, cambios: { cantidad: 5 } }));
  assert.equal(res.status, 200);
  assert.match((await res.json()).aviso, /migración 199/);
  assert.deepEqual(escrito.map((x) => x.metodo), ["PATCH", "POST"]);
  assert.equal("historial" in escrito[1].body, false);
});

test("Materiales — ✏ Corregir manda lo cambiado y 🕓 muestra el historial", async () => {
  const enviados = [];
  const corregido = { ...MOV, id: 10, cantidad: 5, historial: [{ at: "2026-11-19T15:30:00Z", por: "Tadeo", accion: "corregida", nota: "Corrige el movimiento GY-4", cambios: [{ campo: "cantidad", antes: 3, despues: 5 }] }] };
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/stock/movimientos")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (body?.path?.startsWith("movimientos_stock")) return new Response(JSON.stringify({ data: [corregido, { ...MOV, anulado: true, anulado_at: "2026-11-19T15:30:00Z" }] }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  render(<MovimientosStock usuario={{ id: EMP, rol: "administrativo" }} articulos={[]} />);
  const [boton] = await waitFor(() => screen.getAllByRole("button", { name: /^Corregir / }));
  fireEvent.click(screen.getAllByRole("button", { name: /^Historial de / })[0]);
  const hist = screen.getByRole("region", { name: "Historial de cambios" });
  assert.match(hist.textContent, /Corregida por Tadeo/);
  assert.match(hist.textContent, /Cantidad: 3 → 5/);
  assert.match(hist.textContent, /GY-4/);

  fireEvent.click(boton);
  fireEvent.change(screen.getByLabelText("Cantidad (MT)"), { target: { value: "6,5" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar corrección" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].accion, "corregir");
  assert.equal(enviados[0].id, 10);
  assert.equal(enviados[0].cambios.cantidad, 6.5);
  assert.equal(enviados[0].cambios.ot, "M-7495");
  assert.equal(enviados[0].cambios.fecha, AYER);
});
