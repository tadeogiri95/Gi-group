// tests/costo-materiales.test.jsx — Costo de materiales por OT, parte B:
// precio de cada artículo según la fecha de la OT, fijo en la OT (migración
// 165), y 💲 Costo de materiales en el detalle.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { elegirPrecio, fechaCargaOt, costoMaterialesOt, filaPrecioFijo } from "../app/lib/costoMateriales.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/costo-ot/route.js");
const { _limpiarCacheAlcance } = await import("../app/lib/alcance.js");
const { default: CostoMaterialesOt } = await import("../app/components/CostoMaterialesOt.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

const P = (fecha, precio_ars, extra = {}) => ({ fecha, precio: precio_ars, moneda: "ARS", precio_ars, origen: "mrp", referencia: `R-${fecha}-${precio_ars}`, ...extra });

test("precio — el más cercano a la fecha de la OT sin pasarse; si no hay, el primero después; sin fecha, el último", () => {
  const precios = [P("2026-01-10", 100), P("2026-03-01", 120), P("2026-06-01", 150)];
  assert.equal(elegirPrecio(precios, "2026-04-15").precio_ars, 120);
  assert.equal(elegirPrecio(precios, "2026-03-01").precio_ars, 120, "el mismo día cuenta");
  assert.equal(elegirPrecio(precios, "2025-12-01").precio_ars, 100, "sin anterior: el primero después");
  assert.equal(elegirPrecio(precios, null).precio_ars, 150, "sin fecha: el último");
  assert.equal(elegirPrecio([P("2026-01-01", null)], "2026-02-01"), null, "en dólares sin tipo de cambio no sirve");
  assert.equal(elegirPrecio([], "2026-02-01"), null);
  const usd = elegirPrecio([P("2026-02-01", 1500, { precio: 1.5, moneda: "USD", tipo_cambio: 1000, origen: "oc" })], "2026-03-01");
  const fila = filaPrecioFijo(E, "M-1", "1.2", usd);
  assert.deepEqual([fila.precio, fila.moneda, fila.tipo_cambio, fila.precio_ars, fila.origen], [1.5, "USD", 1000, 1500, "oc"]);
});

test("fecha de la OT — el día en que entró a Gypi, en hora argentina", () => {
  assert.equal(fechaCargaOt({ created_at: "2026-11-08T02:00:00Z" }), "2026-11-07", "las 23 h del 7 en Argentina");
  assert.equal(fechaCargaOt({ created_at: "2026-11-08T15:00:00Z" }), "2026-11-08");
  assert.equal(fechaCargaOt({}), null);
  assert.equal(fechaCargaOt(null), null);
});

test("costo — cantidad × precio fijo, sin precio primero (provisorio), lo retirado al lado", () => {
  const c = costoMaterialesOt({
    necesidades: [{ sku: "A", nombre: "MELAMINA", cantidad: 10 }, { sku: "B", nombre: "CANTO", cantidad: 200 }, { sku: "C", nombre: "TORNILLO", cantidad: 50 }, { sku: "D", cantidad: 0 }],
    fijos: [{ sku: "A", fecha: "2026-03-01", precio: 80000, precio_ars: 80000, moneda: "ARS", origen: "mrp", proveedor: "FAPLAC" }, { sku: "B", fecha: "2026-04-01", precio: 1.5, precio_ars: 1500, moneda: "USD", tipo_cambio: 1000, origen: "oc" }],
    articulos: [{ sku: "B", nombre: "CANTO ABS", unidad: "MT" }],
    movimientos: [{ sku: "A", tipo: "consumo", cantidad: 12 }, { sku: "A", tipo: "devolucion", cantidad: 2 }, { sku: "A", tipo: "consumo", cantidad: 99, anulado: true }],
  });
  assert.deepEqual(c.filas.map((f) => [f.sku, f.sinPrecio, f.subtotal]), [["C", true, null], ["A", false, 800000], ["B", false, 300000]]);
  assert.equal(c.total, 1100000);
  assert.equal(c.sinPrecio, 1);
  assert.equal(c.provisorio, true);
  assert.equal(c.filas[1].retirado, 10);
  assert.equal(c.filas[2].nombre, "CANTO ABS");
  assert.equal(costoMaterialesOt({ necesidades: [{ sku: "A", cantidad: 1 }], fijos: [{ sku: "A", fecha: "2026-01-01", precio_ars: 5, precio: 5 }] }).provisorio, false);
});

test("migración 165 — un bloque, clave por OT y artículo, solo el dueño con su pase", () => {
  const sql = readFileSync(new URL("../supabase/migrations/165_precios_fijos_ot.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /primary key \(empresa_id, ot, sku\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /= 'gerencial'/);
  assert.match(sql, /anterior\s+jsonb/);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, { ot = "M-7471", body } = {}) => new Request(`http://localhost/api/costo-ot${body ? "" : `?ot=${encodeURIComponent(ot)}`}`, {
  method: body ? "POST" : "GET",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
  body: body ? JSON.stringify(body) : undefined,
});

function mockApi({ fijos = [], precios = [], supervisor = false } = {}) {
  const escrito = [];
  let guardados = [...fijos];
  _limpiarCacheAlcance();
  global.fetch = createFetchMock([
    { match: (u) => u.includes("select=id,solo_su_division"), respond: () => ({ status: 200, body: [{ id: EMP, solo_su_division: supervisor }] }) },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [{ ot: "M-7471", created_at: "2026-04-15T15:00:00Z" }] }) },
    { match: (u) => u.includes("/rest/v1/necesidades_stock?"), respond: () => ({ status: 200, body: [{ sku: "A", nombre: "MELAMINA", cantidad: 10 }, { sku: "B", nombre: "CANTO", cantidad: 5 }] }) },
    { match: (u) => u.includes("/rest/v1/movimientos_stock?"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock?"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ nombre: "Tadeo" }] }) },
    { match: (u) => u.includes("/rest/v1/v_precios_articulos?"), respond: (u) => ({ status: 200, body: precios.filter((p) => u.includes(encodeURIComponent(p.sku))) }) },
    {
      match: (u) => u.includes("/rest/v1/precios_fijos_ot"),
      respond: (u, o) => {
        if (!o?.method || o.method === "GET") return { status: 200, body: guardados.filter((f) => !u.includes("&sku=eq.") || u.includes(`sku=eq.${encodeURIComponent(f.sku)}`)) };
        const body = JSON.parse(o.body);
        escrito.push({ metodo: o.method, url: u, body, prefer: o.headers?.Prefer });
        if (o.method === "POST") guardados = [...guardados, ...body];
        return { status: 200, body: [] };
      },
    },
  ]);
  return escrito;
}

test("/api/costo-ot — solo el dueño y el supervisor", async () => {
  const escrito = mockApi();
  for (const rol of ["operativo", "administrativo"]) {
    assert.equal((await api.GET(req(await token(rol)))).status, 403, rol);
    assert.equal((await api.POST(req(await token(rol), { body: { accion: "rebuscar", ot: "M-7471", sku: "A" } }))).status, 403, rol);
  }
  assert.equal(escrito.length, 0);
  mockApi({ supervisor: true });
  assert.equal((await api.GET(req(await token("administrativo")))).status, 200, "supervisor");
});

test("/api/costo-ot — el artículo sin precio fijo lo busca por la fecha de la OT y queda fijo; el que ya tenía no cambia", async () => {
  const escrito = mockApi({
    fijos: [{ empresa_id: E, ot: "M-7471", sku: "A", fecha: "2026-01-01", precio: 70000, precio_ars: 70000, moneda: "ARS", origen: "mrp" }],
    precios: [P("2026-01-01", 70000, { sku: "A" }), P("2026-10-01", 99000, { sku: "A" }), P("2026-03-01", 900, { sku: "B" }), P("2026-05-01", 1000, { sku: "B" })],
  });
  const res = await api.GET(req(await token("gerencial")));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.fecha_ot, "2026-04-15");
  const post = escrito.find((w) => w.metodo === "POST");
  assert.deepEqual(post.body.map((f) => [f.sku, f.precio_ars, f.fecha]), [["B", 900, "2026-03-01"]], "solo el que faltaba, con el precio anterior más cercano");
  assert.match(post.prefer, /ignore-duplicates/, "nunca pisa un precio ya fijo");
  assert.equal(d.total, 10 * 70000 + 5 * 900, "A sigue con su precio fijo aunque haya uno más nuevo");
  assert.equal(d.provisorio, false);
});

test("/api/costo-ot — volver a buscar precio anota quién y el de antes", async () => {
  const escrito = mockApi({
    fijos: [{ empresa_id: E, ot: "M-7471", sku: "A", fecha: "2026-01-01", precio: 70000, precio_ars: 70000, moneda: "ARS", origen: "mrp", referencia: "viejo" }],
    precios: [P("2026-01-01", 70000, { sku: "A" }), P("2026-04-10", 75000, { sku: "A", origen: "oc" })],
  });
  const res = await api.POST(req(await token("gerencial"), { body: { accion: "rebuscar", ot: "M-7471", sku: "A" } }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cambio, true);
  const patch = escrito.find((w) => w.metodo === "PATCH");
  assert.match(patch.url, new RegExp(`precios_fijos_ot\\?empresa_id=eq\\.${E}&ot=eq\\.M-7471&sku=eq\\.A`));
  assert.equal(patch.body.precio_ars, 75000);
  assert.equal(patch.body.cambiado_por_nombre, "Tadeo");
  assert.deepEqual([patch.body.anterior.precio_ars, patch.body.anterior.fecha], [70000, "2026-01-01"]);
});

// ─── Pantalla ───

test("detalle — 💲 Costo de materiales con renglones, origen, sin precio en rojo y provisorio", async () => {
  global.fetch = async () => Response.json({
    ok: true, ot: "M-7471", fecha_ot: "2026-04-15", total: 800000, sinPrecio: 1, provisorio: true,
    filas: [
      { sku: "C", nombre: "TORNILLO", cantidad: 50, sinPrecio: true, retirado: 0 },
      { sku: "A", nombre: "MELAMINA", cantidad: 10, unidad: "PL", precio: 80000, subtotal: 800000, fecha: "2026-03-01", origen: "oc", proveedor: "FAPLAC", comprobante: "A-12", retirado: 4 },
    ],
  });
  render(<CostoMaterialesOt ot="M-7471" />);
  await waitFor(() => screen.getByText(/Provisorio: faltan precios de 1 artículo/));
  assert.ok(screen.getByText("Sin precio"));
  const items = screen.getAllByRole("listitem");
  assert.match(items[0].className, /border-gypi-red/);
  assert.match(items[1].textContent, /10 PL × \$ 80\.000,00 · retirado 4/);
  assert.match(items[1].textContent, /🧾 Factura de OC · 01\/03\/2026 · FAPLAC · A-12/);
  assert.ok(screen.getByText("$ 800.000", { selector: "span" }));
  const detalle = readFileSync(new URL("../app/components/DetalleOp.jsx", import.meta.url), "utf8");
  assert.match(detalle, /\{verCostos && <CostoMaterialesOt ot=\{proyecto\?\.ot\} \/>\}/);
});
