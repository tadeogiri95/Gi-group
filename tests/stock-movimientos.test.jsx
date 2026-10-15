// tests/stock-movimientos.test.jsx — Stock, parte 14 (ítem 40): el operario
// retira o devuelve material escaneando el QR del artículo; la oficina carga
// ingresos y ajustes y anula lo mal cargado (migración 107).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  puedeCargar, puedeAnular, leerCantidadMovimiento, textoMovimiento, HORAS_ANULAR_PROPIO,
} from "../app/lib/movimientosStock.js";
import { movimientoStockBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/stock/movimientos/route.js");
const { default: RetirarMaterial } = await import("../app/components/RetirarMaterial.jsx");
const { default: MovimientosStock } = await import("../app/components/MovimientosStock.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const OTRO = "33333333-3333-3333-3333-333333333333";
const TABLILLA = { sku: "3.3.1.6.109.2", nombre: "Tablilla 0277 negra", unidad: "MT", division: "ALUMINIO", activo: true, disponible: -24, semaforo: "🔴 URGENTE" };

// ─── Reglas ───

test("quién carga qué — retiro y devolución cualquiera; ingreso y ajuste la oficina", () => {
  for (const rol of ["operativo", "administrativo", "gerencial"]) {
    assert.equal(puedeCargar("consumo", rol), true);
    assert.equal(puedeCargar("devolucion", rol), true);
  }
  assert.equal(puedeCargar("ingreso", "operativo"), false);
  assert.equal(puedeCargar("ajuste", "operativo"), false);
  assert.equal(puedeCargar("ingreso", "administrativo"), true);
  assert.equal(puedeCargar("ajuste", "gerencial"), true);
  assert.equal(puedeCargar("otro", "gerencial"), false);
});

test("anular — la oficina cualquiera; el operario lo suyo recién cargado", () => {
  const ahora = Date.parse("2026-10-15T15:00:00Z");
  const mio = { empleado_id: EMP, created_at: "2026-10-15T14:00:00Z", anulado: false };
  assert.equal(puedeAnular(mio, { rol: "operativo", empleadoId: EMP }, ahora), true);
  assert.equal(puedeAnular(mio, { rol: "operativo", empleadoId: OTRO }, ahora), false);
  const viejo = { ...mio, created_at: new Date(ahora - (HORAS_ANULAR_PROPIO + 1) * 3600e3).toISOString() };
  assert.equal(puedeAnular(viejo, { rol: "operativo", empleadoId: EMP }, ahora), false);
  assert.equal(puedeAnular(viejo, { rol: "administrativo", empleadoId: OTRO }, ahora), true);
  assert.equal(puedeAnular({ ...mio, anulado: true }, { rol: "gerencial" }, ahora), false);
});

test("cantidades — como las escribe el operario", () => {
  assert.equal(leerCantidadMovimiento("2,5"), 2.5);
  assert.equal(leerCantidadMovimiento("1.234,5"), 1234.5);
  assert.equal(leerCantidadMovimiento(" 3 "), 3);
  assert.equal(leerCantidadMovimiento("0"), null);
  assert.equal(leerCantidadMovimiento("-2"), null);
  assert.equal(leerCantidadMovimiento("-2", { conSigno: true }), -2);
  assert.equal(leerCantidadMovimiento("muchos"), null);
  assert.equal(leerCantidadMovimiento(""), null);
  assert.equal(textoMovimiento({ tipo: "consumo", cantidad: 3, unidad: "MT", ot: "M-7495" }), "📦 Retiro · 3 MT · OT M-7495");
  assert.equal(textoMovimiento({ tipo: "ajuste", cantidad: 2.5 }), "⚖️ Ajuste · +2,5");
});

test("validación — cantidad positiva salvo ajuste; SKU limpio", () => {
  const ok = (b) => movimientoStockBody.safeParse(b).success;
  assert.equal(ok({ accion: "registrar", tipo: "consumo", sku: "1.1.2", cantidad: 3, ot: "M-7495" }), true);
  assert.equal(ok({ accion: "registrar", tipo: "consumo", sku: "1.1.2", cantidad: -3 }), false);
  assert.equal(ok({ accion: "registrar", tipo: "ajuste", sku: "1.1.2", cantidad: -3 }), true);
  assert.equal(ok({ accion: "registrar", tipo: "ajuste", sku: "1.1.2", cantidad: 0 }), false);
  assert.equal(ok({ accion: "registrar", tipo: "consumo", sku: "1.1.2&x=1", cantidad: 1 }), false);
  assert.equal(ok({ accion: "registrar", tipo: "robo", sku: "1.1.2", cantidad: 1 }), false);
  assert.equal(ok({ accion: "anular", id: 5 }), true);
  assert.equal(ok({ accion: "anular", id: "5" }), false);
});

test("migración 107 — por empresa, sin borrar; datos solo se leen por /api/data", () => {
  const sql = readFileSync(new URL("../supabase/migrations/107_movimientos_stock.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /tenant_isolation_auth_movimientos_stock/);
  assert.match(sql, /grant select, insert, update on public\.movimientos_stock to authenticated/);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*movimientos_stock/i);
  assert.equal(autorizar("movimientos_stock", "GET", { rol: "operativo" }).ok, true);
  for (const metodo of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar("movimientos_stock", metodo, { rol: "gerencial" }).ok, false, metodo);
});

// ─── Ruta ───

function mockRuta({ articulo = TABLILLA, ot = [{ ot: "M-7495" }], mov = null, falla = null } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: articulo ? [articulo] : [] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: ot }) },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ nombre: "Juan Pérez" }] }) },
    {
      match: (u) => u.includes("/rest/v1/movimientos_stock"),
      respond: (u, o) => {
        if (falla) return { status: 404, body: { message: falla } };
        if (!o.method || o.method === "GET") return { status: 200, body: mov ? [mov] : [] };
        const body = JSON.parse(o.body);
        escrito.push({ metodo: o.method, url: u, body });
        return { status: 201, body: [{ id: 9, ...body }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/stock/movimientos", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/stock/movimientos — el operario retira para una OT, con nombre y unidad", async () => {
  const escrito = mockRuta();
  const res = await api.POST(req(await token("operativo"), { accion: "registrar", tipo: "consumo", sku: TABLILLA.sku, cantidad: 3, ot: "M-7495", proveedor: "no va" }));
  assert.equal(res.status, 200);
  const [fila] = escrito;
  assert.equal(fila.metodo, "POST");
  assert.equal(fila.body.empresa_id, E);
  assert.equal(fila.body.tipo, "consumo");
  assert.equal(fila.body.nombre, "Tablilla 0277 negra");
  assert.equal(fila.body.unidad, "MT");
  assert.equal(fila.body.ot, "M-7495");
  assert.equal(fila.body.proveedor, null, "el proveedor es solo de los ingresos");
  assert.equal(fila.body.empleado_id, EMP);
  assert.equal(fila.body.legajo, 7);
  assert.equal(fila.body.empleado_nombre, "Juan Pérez");
});

test("/api/stock/movimientos — el operario no carga ingresos; la oficina sí", async () => {
  const escrito = mockRuta();
  const ingreso = { accion: "registrar", tipo: "ingreso", sku: TABLILLA.sku, cantidad: 10, proveedor: "Aluar", comprobante: "A-0001", precio_unitario: 1500 };
  let res = await api.POST(req(await token("operativo"), ingreso));
  assert.equal(res.status, 403);
  assert.equal(escrito.length, 0);
  res = await api.POST(req(await token("administrativo"), ingreso));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].body.proveedor, "Aluar");
  assert.equal(escrito[0].body.precio_unitario, 1500);
});

test("/api/stock/movimientos — artículo u OT que no existen, y la migración que falta", async () => {
  mockRuta({ articulo: null });
  let res = await api.POST(req(await token("operativo"), { accion: "registrar", tipo: "consumo", sku: "0.0.0", cantidad: 1 }));
  assert.equal(res.status, 404);
  mockRuta({ articulo: { ...TABLILLA, activo: false } });
  res = await api.POST(req(await token("operativo"), { accion: "registrar", tipo: "consumo", sku: TABLILLA.sku, cantidad: 1 }));
  assert.equal(res.status, 409);
  mockRuta({ ot: [] });
  res = await api.POST(req(await token("operativo"), { accion: "registrar", tipo: "consumo", sku: TABLILLA.sku, cantidad: 1, ot: "X-1" }));
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /OT X-1/);
  mockRuta({ falla: 'relation "public.movimientos_stock" does not exist' });
  res = await api.POST(req(await token("operativo"), { accion: "registrar", tipo: "consumo", sku: TABLILLA.sku, cantidad: 1 }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 107/);
});

test("/api/stock/movimientos — anular: lo suyo sí, lo de otro no (salvo la oficina)", async () => {
  const reciente = new Date().toISOString();
  let escrito = mockRuta({ mov: { id: 9, empleado_id: EMP, created_at: reciente, anulado: false } });
  let res = await api.POST(req(await token("operativo"), { accion: "anular", id: 9 }));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.equal(escrito[0].body.anulado, true);
  assert.equal(escrito[0].body.anulado_por, EMP);

  escrito = mockRuta({ mov: { id: 9, empleado_id: OTRO, created_at: reciente, anulado: false } });
  res = await api.POST(req(await token("operativo"), { accion: "anular", id: 9 }));
  assert.equal(res.status, 403);
  assert.equal(escrito.length, 0);
  res = await api.POST(req(await token("gerencial"), { accion: "anular", id: 9 }));
  assert.equal(res.status, 200);

  mockRuta({ mov: null });
  res = await api.POST(req(await token("gerencial"), { accion: "anular", id: 9 }));
  assert.equal(res.status, 404);
});

// ─── Pantallas ───

function mockPantalla({ articulos = [TABLILLA], movs = [] } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/stock/movimientos")) {
      enviados.push(body);
      const mov = { id: 9, ...body, nombre: TABLILLA.nombre, unidad: "MT", created_at: new Date().toISOString(), empleado_id: EMP };
      return new Response(JSON.stringify({ ok: true, movimiento: mov }), { status: 200 });
    }
    if (body?.path?.startsWith("articulos_stock")) return new Response(JSON.stringify({ data: articulos }), { status: 200 });
    if (body?.path?.startsWith("proyectos")) return new Response(JSON.stringify({ data: [{ id: 1, ot: "M-7495", cliente: "Pérez" }] }), { status: 200 });
    if (body?.path?.startsWith("movimientos_stock")) return new Response(JSON.stringify({ data: movs }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return enviados;
}

const OPERARIO = { id: EMP, rol: "operativo", empresa_id: E };

test("retirar material — busca el artículo, elige la OT, pone la cantidad y queda registrado", async () => {
  const enviados = mockPantalla();
  render(<RetirarMaterial empresaId={E} usuario={OPERARIO} onClose={() => {}} />);
  const buscar = screen.getByLabelText("Buscar artículo");
  fireEvent.focus(buscar);
  fireEvent.change(buscar, { target: { value: "tablilla" } });
  fireEvent.click(await screen.findByText("Tablilla 0277 negra"));
  fireEvent.click(await screen.findByLabelText("Retirar para la OT M-7495"));
  fireEvent.change(await screen.findByLabelText("Cantidad (MT)"), { target: { value: "2,5" } });
  fireEvent.click(screen.getByText("Registrar retiro"));
  await waitFor(() => assert.ok(screen.getByText(/Registrado/)));
  assert.deepEqual(enviados[0], { accion: "registrar", tipo: "consumo", sku: TABLILLA.sku, cantidad: 2.5, ot: "M-7495" });
  assert.ok(screen.getByText("Retirar otro para la OT M-7495"));
});

test("retirar material — desde la ficha del QR, sin OT y devolviendo", async () => {
  const enviados = mockPantalla();
  render(<RetirarMaterial empresaId={E} usuario={OPERARIO} skuInicial={TABLILLA.sku} onClose={() => {}} />);
  fireEvent.click(await screen.findByText("Sin OT (consumo general)"));
  fireEvent.click(await screen.findByText("↩️ Devuelvo lo que sobró"));
  fireEvent.change(screen.getByLabelText("Cantidad (MT)"), { target: { value: "1" } });
  fireEvent.click(screen.getByText("Registrar devolución"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].tipo, "devolucion");
  assert.equal(enviados[0].ot, null);
});

test("movimientos en Stock — lista, anular y cargar un ingreso", async () => {
  const movs = [{ id: 4, tipo: "consumo", sku: TABLILLA.sku, nombre: TABLILLA.nombre, cantidad: 3, unidad: "MT", ot: "M-7495", empleado_nombre: "Juan", created_at: "2026-10-15T12:00:00Z", anulado: false }];
  const enviados = mockPantalla({ movs });
  render(<MovimientosStock usuario={{ id: OTRO, rol: "administrativo" }} articulos={[TABLILLA]} />);
  await waitFor(() => assert.ok(screen.getByText("📦 Retiro · 3 MT · OT M-7495")));
  fireEvent.click(screen.getByLabelText(/Anular 📦 Retiro/));
  await waitFor(() => assert.deepEqual(enviados[0], { accion: "anular", id: 4 }));

  fireEvent.click(screen.getByText("＋ Cargar ingreso, ajuste o devolución"));
  fireEvent.change(screen.getByLabelText("Artículo"), { target: { value: "tablilla" } });
  fireEvent.click(screen.getByText("Tablilla 0277 negra"));
  fireEvent.change(screen.getByLabelText("Cantidad (MT)"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Proveedor"), { target: { value: "Aluar" } });
  fireEvent.change(screen.getByLabelText("Precio unitario (sin IVA)"), { target: { value: "1.500,50" } });
  fireEvent.click(screen.getByText("Guardar"));
  await waitFor(() => assert.equal(enviados.length, 2));
  assert.equal(enviados[1].tipo, "ingreso");
  assert.equal(enviados[1].cantidad, 10);
  assert.equal(enviados[1].proveedor, "Aluar");
  assert.equal(enviados[1].precio_unitario, 1500.5);
  assert.equal(enviados[1].ot, null);
});

test("accesos — botón en el inicio del operario, en la ficha y pestaña en Stock", () => {
  const home = readFileSync(new URL("../app/components/screens/HomeEmp.jsx", import.meta.url), "utf8");
  assert.match(home, /title="Retirar material"/);
  const ficha = readFileSync(new URL("../app/components/FichaArticulo.jsx", import.meta.url), "utf8");
  assert.match(ficha, /📦 Retirar o devolver/);
  const stock = readFileSync(new URL("../app/components/StockScreen.jsx", import.meta.url), "utf8");
  assert.match(stock, /<MovimientosStock usuario=\{usuario\} articulos=\{articulos\} \/>/);
});
