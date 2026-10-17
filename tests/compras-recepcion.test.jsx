// tests/compras-recepcion.test.jsx — Compras, parte 22 (ítem 41): los jefes
// de taller o Administración reciben la OC con el remito; cada renglón con
// SKU entra como ingreso de stock; la factura puede llegar después y, si
// cambia el precio, el ingreso se reemplaza (migración 115).
import "./helpers/domSetup.js";
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { pendienteItem, estadoTrasRecepcion, precioEnPesos } from "../app/lib/ordenesCompra.js";
import { comprasBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";
import { _limpiarCacheAlcance } from "../app/lib/alcance.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
beforeEach(() => _limpiarCacheAlcance());
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/compras/route.js");
const { default: RecibirCompra } = await import("../app/components/RecibirCompra.jsx");
const { default: OrdenesCompra } = await import("../app/components/OrdenesCompra.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const OC = { id: 101, numero: 8, proveedor_id: 1, proveedor_nombre: "Aluar", estado: "enviada", moneda: "ARS", enviada_at: "2026-10-17T12:00:00Z", created_at: "2026-10-17T12:00:00Z" };
const PERFIL = { id: 1, orden_id: 101, sku: "3.3.1.6", descripcion: "Perfil 0277", unidad: "MT", cantidad: 12, precio_unitario: 1500, cantidad_recibida: 0, ot: "M-7495", pedido_id: 5 };
const TORNILLOS = { id: 2, orden_id: 101, sku: null, descripcion: "Tornillos 4x40", unidad: "cajas", cantidad: 2, precio_unitario: null, cantidad_recibida: 0, ot: null, pedido_id: 6 };

// ─── Reglas ───

test("lo que falta, el estado de la OC y el precio en pesos", () => {
  assert.equal(pendienteItem({ cantidad: 12, cantidad_recibida: 5 }), 7);
  assert.equal(pendienteItem({ cantidad: 12, cantidad_recibida: 15 }), 0, "si vino de más no queda negativo");
  assert.equal(pendienteItem({ cantidad: 0.3, cantidad_recibida: 0.1 }), 0.2);
  assert.equal(estadoTrasRecepcion([{ cantidad: 2, cantidad_recibida: 2 }, { cantidad: 1, cantidad_recibida: 1 }]), "recibida");
  assert.equal(estadoTrasRecepcion([{ cantidad: 2, cantidad_recibida: 1 }, { cantidad: 1, cantidad_recibida: 0 }]), "recibida_parcial");
  assert.equal(estadoTrasRecepcion([{ cantidad: 2, cantidad_recibida: 0 }]), "enviada");
  assert.equal(precioEnPesos(1500.555, "ARS"), 1500.56);
  assert.equal(precioEnPesos(10, "USD", 1050), 10500);
  assert.equal(precioEnPesos(10, "USD", null), null, "en dólares sin tipo de cambio no hay precio en pesos");
  assert.equal(precioEnPesos(null, "ARS"), null);
});

test("validación — recepción con remito, factura", () => {
  const ok = (b) => comprasBody.safeParse(b).success;
  const rec = { accion: "recepcion_crear", orden_id: 101, remito: "0004-00012345", items: [{ item_id: 1, cantidad: 12 }] };
  assert.equal(ok(rec), true);
  assert.equal(ok({ ...rec, remito: " " }), false, "el remito es obligatorio");
  assert.equal(ok({ ...rec, items: [] }), false);
  assert.equal(ok({ ...rec, items: [{ item_id: 1, cantidad: 0 }] }), false);
  assert.equal(ok({ ...rec, foto_url: "https://x.test/remito.jpg" }), true);
  assert.equal(ok({ ...rec, foto_url: "no es url" }), false);
  assert.equal(ok({ accion: "recepcion_anular", id: 3 }), true);
  assert.equal(ok({ accion: "oc_factura", id: 101, factura_numero: "A-0003-00001234", factura_fecha: "2026-10-20", tipo_cambio: 1050, precios: [{ item_id: 1, precio_unitario: 1600 }] }), true);
  assert.equal(ok({ accion: "oc_factura", id: 101, tipo_cambio: 0 }), false);
});

test("migración 115 — recepciones por empresa, sin borrar; factura en la OC", () => {
  const sql = readFileSync(new URL("../supabase/migrations/115_compras_recepciones.sql", import.meta.url), "utf8");
  for (const col of ["factura_numero", "factura_fecha", "tipo_cambio"]) assert.match(sql, new RegExp(`add column if not exists ${col}`));
  assert.match(sql, /movimiento_id\s+bigint references public\.movimientos_stock\(id\)/);
  for (const t of ["recepciones_compra", "recepciones_compra_items"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`tenant_isolation_auth_${t} on`));
    assert.match(sql, new RegExp(`grant select, insert, update on public\\.${t} to authenticated`));
    assert.doesNotMatch(sql, new RegExp(`grant[^;]*delete[^;]*${t}`, "i"));
    assert.equal(autorizar(t, "GET", { rol: "operativo" }).ok, false);
    assert.equal(autorizar(t, "GET", { rol: "administrativo" }).ok, true);
    for (const metodo of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar(t, metodo, { rol: "gerencial" }).ok, false, `${t} ${metodo}`);
  }
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Ruta ───

function mockRuta({ supervisor = null, oc = OC, items = [PERFIL, TORNILLOS], recepcion = null, lineas = [], movs = [], recepciones = [], falla = null } = {}) {
  const escrito = [];
  let siguienteMov = 500;
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return body;
  };
  const tabla = (nombre, leer) => ({
    match: (u) => u.includes(`/rest/v1/${nombre}?`) || u.endsWith(`/rest/v1/${nombre}`),
    respond: (u, o) => {
      if (falla && nombre.startsWith("recepciones")) return { status: 404, body: { message: falla } };
      if (!o.method || o.method === "GET") return { status: 200, body: leer(u) };
      const body = anotar(nombre, u, o);
      if (nombre === "movimientos_stock" && o.method === "POST") {
        const lista = Array.isArray(body) ? body : [body];
        return { status: 201, body: lista.map((m) => ({ id: siguienteMov++, ...m })) };
      }
      return { status: o.method === "POST" ? 201 : 200, body: Array.isArray(body) ? body : [{ id: 77, ...body }] };
    },
  });
  global.fetch = createFetchMock([
    {
      match: (u) => u.includes("/rest/v1/empleados"),
      respond: (u) => u.includes("solo_su_division")
        ? { status: 200, body: [{ id: EMP, legajo: 7, division: supervisor, solo_su_division: Boolean(supervisor) }] }
        : u.includes("select=id,legajo") ? { status: 200, body: [{ id: EMP, legajo: 7 }] } : { status: 200, body: [{ nombre: "Pedro Jefe" }] },
    },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: [{ sku: "3.3.1.6", nombre: "Tablilla perfil 0277", unidad: "MT", division: "ALUMINIO" }] }) },
    tabla("recepciones_compra_items", () => lineas),
    tabla("recepciones_compra", () => (recepcion ? [recepcion] : recepciones)),
    tabla("ordenes_compra_items", () => items.map((it) => ({ ...it }))),
    tabla("ordenes_compra", () => (oc ? [oc] : [])),
    tabla("movimientos_stock", () => movs),
    tabla("pedidos_compra", () => []),
  ]);
  return escrito;
}

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/compras", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/compras recepcion_crear — el jefe recibe todo: ingreso de stock, OC recibida y pedidos recibidos", async () => {
  const escrito = mockRuta({ supervisor: "ALUMINIO" });
  const res = await api.POST(req(await token("administrativo"), {
    accion: "recepcion_crear", orden_id: 101, remito: "0004-00012345", items: [{ item_id: 1, cantidad: 12 }, { item_id: 2, cantidad: 2 }],
  }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.estado, "recibida");
  assert.equal(data.ingresos, 1, "los tornillos no son del stock: no generan ingreso");
  const [rec] = escrito.filter((x) => x.tabla === "recepciones_compra");
  assert.equal(rec.body.remito, "0004-00012345");
  assert.equal(rec.body.empleado_nombre, "Pedro Jefe");
  const [mov] = escrito.filter((x) => x.tabla === "movimientos_stock");
  assert.deepEqual(
    { tipo: mov.body[0].tipo, sku: mov.body[0].sku, nombre: mov.body[0].nombre, cantidad: mov.body[0].cantidad, ot: mov.body[0].ot, proveedor: mov.body[0].proveedor, comprobante: mov.body[0].comprobante, precio: mov.body[0].precio_unitario, notas: mov.body[0].notas },
    { tipo: "ingreso", sku: "3.3.1.6", nombre: "Tablilla perfil 0277", cantidad: 12, ot: "M-7495", proveedor: "Aluar", comprobante: "0004-00012345", precio: 1500, notas: "OC N° 8" },
  );
  const [lin] = escrito.filter((x) => x.tabla === "recepciones_compra_items");
  assert.deepEqual(lin.body.map((l) => [l.item_id, l.cantidad, l.movimiento_id]), [[1, 12, 500], [2, 2, null]]);
  const recibidos = escrito.filter((x) => x.tabla === "ordenes_compra_items" && x.metodo === "PATCH").map((x) => x.body.cantidad_recibida);
  assert.deepEqual(recibidos, [12, 2]);
  const est = escrito.find((x) => x.tabla === "ordenes_compra" && x.metodo === "PATCH");
  assert.equal(est.body.estado, "recibida");
  const ped = escrito.find((x) => x.tabla === "pedidos_compra" && x.body.estado === "recibido");
  assert.match(ped.url, /id=in\.\(5,6\)&estado=eq\.en_oc/);
});

test("/api/compras recepcion_crear — llega una parte; en dólares sin tipo de cambio va sin precio", async () => {
  const escrito = mockRuta({ oc: { ...OC, moneda: "USD" } });
  const res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 5 }] }));
  assert.equal((await res.json()).estado, "recibida_parcial");
  assert.equal(escrito.find((x) => x.tabla === "movimientos_stock").body[0].precio_unitario, null);
  assert.equal(escrito.some((x) => x.tabla === "pedidos_compra" && x.body.estado === "recibido"), false);
});

test("/api/compras recepcion_crear — operario no; OC anulada o recibida no; renglón de otra OC no", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token("operativo"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 1 }] }));
  assert.equal(res.status, 403);
  assert.equal(escrito.length, 0);
  mockRuta({ oc: { ...OC, estado: "anulada" } });
  res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 1 }] }));
  assert.equal(res.status, 409);
  mockRuta({ oc: { ...OC, estado: "recibida" } });
  res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 1 }] }));
  assert.match((await res.json()).error, /recibió completa/);
  escrito = mockRuta();
  res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 99, cantidad: 1 }] }));
  assert.equal(res.status, 409);
  assert.equal(escrito.length, 0);
});

test("/api/compras recepcion_anular — Administración anula: ingresos anulados, cantidades y estado vuelven", async () => {
  const items = [{ ...PERFIL, cantidad_recibida: 12 }, { ...TORNILLOS, cantidad_recibida: 2 }];
  let escrito = mockRuta({ supervisor: "ALUMINIO", recepcion: { id: 9, orden_id: 101, remito: "R-1", anulada: false } });
  let res = await api.POST(req(await token("administrativo"), { accion: "recepcion_anular", id: 9 }));
  assert.equal(res.status, 403, "el jefe de taller no anula");
  assert.equal(escrito.length, 0);

  _limpiarCacheAlcance();
  escrito = mockRuta({
    oc: { ...OC, estado: "recibida" }, items, recepcion: { id: 9, orden_id: 101, remito: "R-1", anulada: false },
    lineas: [{ item_id: 1, cantidad: 12, movimiento_id: 500 }, { item_id: 2, cantidad: 2, movimiento_id: null }],
  });
  res = await api.POST(req(await token("gerencial"), { accion: "recepcion_anular", id: 9 }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).estado, "enviada");
  const mov = escrito.find((x) => x.tabla === "movimientos_stock");
  assert.match(mov.url, /id=in\.\(500\)&anulado=eq\.false/);
  assert.equal(mov.body.anulado, true);
  assert.deepEqual(escrito.filter((x) => x.tabla === "ordenes_compra_items").map((x) => x.body.cantidad_recibida), [0, 0]);
  assert.equal(escrito.find((x) => x.tabla === "recepciones_compra").body.anulada, true);
  const ped = escrito.find((x) => x.tabla === "pedidos_compra");
  assert.match(ped.url, /estado=eq\.recibido/);
  assert.deepEqual(ped.body, { estado: "en_oc" });
});

test("/api/compras oc_factura — precio nuevo: el ingreso se reemplaza con la factura como comprobante", async () => {
  const items = [{ ...PERFIL, cantidad_recibida: 12 }];
  const escrito = mockRuta({
    oc: { ...OC, estado: "recibida" }, items,
    recepciones: [{ id: 9, remito: "R-1" }],
    lineas: [{ id: 30, recepcion_id: 9, item_id: 1, cantidad: 12, movimiento_id: 500 }],
    movs: [{ id: 500, sku: "3.3.1.6", nombre: "Tablilla perfil 0277", unidad: "MT", division: "ALUMINIO", precio_unitario: 1500, comprobante: "R-1", anulado: false }],
  });
  const res = await api.POST(req(await token("gerencial"), {
    accion: "oc_factura", id: 101, factura_numero: "A-0003-00001234", factura_fecha: "2026-10-20", precios: [{ item_id: 1, precio_unitario: 1600 }],
  }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).reemplazados, 1);
  assert.deepEqual(escrito.find((x) => x.tabla === "ordenes_compra_items").body, { precio_unitario: 1600 });
  const cab = escrito.find((x) => x.tabla === "ordenes_compra");
  assert.equal(cab.body.factura_numero, "A-0003-00001234");
  assert.equal(cab.body.tipo_cambio, null, "en pesos no lleva tipo de cambio");
  const nuevo = escrito.find((x) => x.tabla === "movimientos_stock" && x.metodo === "POST");
  assert.equal(nuevo.body.precio_unitario, 1600);
  assert.equal(nuevo.body.comprobante, "A-0003-00001234");
  assert.equal(nuevo.body.cantidad, 12);
  const viejo = escrito.find((x) => x.tabla === "movimientos_stock" && x.metodo === "PATCH");
  assert.match(viejo.url, /id=eq\.500/);
  assert.equal(viejo.body.anulado, true);
  assert.deepEqual(escrito.find((x) => x.tabla === "recepciones_compra_items").body, { movimiento_id: 500 }, "el renglón apunta al ingreso nuevo");
});

test("/api/compras oc_factura — mismo precio y comprobante: no toca los ingresos; OC anulada no", async () => {
  let escrito = mockRuta({
    oc: { ...OC, estado: "recibida", factura_numero: "F-1" }, items: [{ ...PERFIL, cantidad_recibida: 12 }],
    recepciones: [{ id: 9, remito: "R-1" }],
    lineas: [{ id: 30, recepcion_id: 9, item_id: 1, cantidad: 12, movimiento_id: 500 }],
    movs: [{ id: 500, precio_unitario: 1500, comprobante: "F-1", anulado: false }],
  });
  let res = await api.POST(req(await token("gerencial"), { accion: "oc_factura", id: 101, factura_numero: "F-1" }));
  assert.equal((await res.json()).reemplazados, 0);
  assert.equal(escrito.some((x) => x.tabla === "movimientos_stock"), false);

  escrito = mockRuta({ oc: { ...OC, estado: "anulada" } });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_factura", id: 101, factura_numero: "F-1" }));
  assert.equal(res.status, 409);

  mockRuta({ supervisor: "ALUMINIO" });
  res = await api.POST(req(await token("administrativo"), { accion: "oc_factura", id: 101, factura_numero: "F-1" }));
  assert.equal(res.status, 403, "la factura la carga Administración");
});

test("/api/compras — si falta la migración 115 lo dice", async () => {
  mockRuta({ falla: 'relation "public.recepciones_compra" does not exist' });
  const res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 1 }] }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 115/);
});

// ─── Pantallas ───

function mockPantalla({ ordenes = [OC], items = [PERFIL, TORNILLOS], recepciones = [] } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/compras")) {
      enviados.push(body);
      const extra = body.accion === "recepcion_crear" ? { estado: "recibida_parcial", ingresos: 1 } : body.accion === "oc_factura" ? { reemplazados: 1 } : {};
      return new Response(JSON.stringify({ ok: true, ...extra }), { status: 200 });
    }
    const path = body?.path || "";
    const data = path.startsWith("ordenes_compra_items") ? items
      : path.startsWith("ordenes_compra") ? ordenes
        : path.startsWith("recepciones_compra") ? recepciones
          : path.startsWith("proveedores") ? [{ id: 1, nombre: "Aluar" }] : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return enviados;
}

test("Recibir — el jefe abre la OC, ajusta lo que llegó y pone el remito", async () => {
  const enviados = mockPantalla({ items: [{ ...PERFIL, cantidad_recibida: 4 }, TORNILLOS] });
  render(<RecibirCompra empresaId={E} />);
  fireEvent.click(await screen.findByText("OC N° 8 · Aluar"));
  const perfil = await screen.findByLabelText("Llegó ahora de Perfil 0277");
  assert.equal(perfil.value, "8", "arranca con lo que falta");
  assert.ok(screen.getByText(/Pedido 12 MT · Llegó 4 · Falta 8/));
  fireEvent.change(screen.getByLabelText("Llegó ahora de Tornillos 4x40"), { target: { value: "" } });
  fireEvent.click(screen.getByText("📦 Registrar lo que llegó"));
  assert.match(screen.getByRole("alert").textContent, /N° de remito/);
  fireEvent.change(screen.getByLabelText("N° de remito"), { target: { value: "0004-00012345" } });
  fireEvent.click(screen.getByText("📦 Registrar lo que llegó"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], { accion: "recepcion_crear", orden_id: 101, remito: "0004-00012345", foto_url: null, notas: null, items: [{ item_id: 1, cantidad: 8 }] });
  await screen.findByText(/Recepción guardada y 1 ingreso de stock cargado\. La orden quedó recibida en parte\./);
});

test("Recibir — Administración ve las recepciones y anula una; el jefe no", async () => {
  const recepciones = [{ id: 9, remito: "R-1", empleado_nombre: "Pedro", created_at: "2026-10-17T15:00:00Z", anulada: false, foto_url: "https://x.test/r.jpg" }];
  let enviados = mockPantalla({ recepciones });
  render(<RecibirCompra empresaId={E} />);
  fireEvent.click(await screen.findByText("OC N° 8 · Aluar"));
  await screen.findByText("Remito R-1");
  assert.equal(screen.queryByLabelText("Anular recepción del remito R-1"), null);
  cleanup();
  enviados = mockPantalla({ recepciones });
  render(<RecibirCompra empresaId={E} comprador />);
  fireEvent.click(await screen.findByText("OC N° 8 · Aluar"));
  fireEvent.click(await screen.findByLabelText("Anular recepción del remito R-1"));
  await waitFor(() => assert.deepEqual(enviados[0], { accion: "recepcion_anular", id: 9 }));
});

test("Órdenes — la factura con tipo de cambio y precio final", async () => {
  const usd = { ...OC, moneda: "USD", estado: "recibida_parcial", updated_at: "x" };
  const enviados = mockPantalla({ ordenes: [usd], items: [{ ...PERFIL, precio_unitario: 10, cantidad_recibida: 4 }] });
  render(<OrdenesCompra empresaId={E} />);
  fireEvent.click(await screen.findByText("OC N° 8 · Aluar"));
  fireEvent.change(await screen.findByLabelText("N° de factura"), { target: { value: "A-0003-00001234" } });
  fireEvent.change(screen.getByLabelText("Tipo de cambio (pesos por dólar)"), { target: { value: "1.050" } });
  fireEvent.change(screen.getByLabelText("Precio final de Perfil 0277"), { target: { value: "11,5" } });
  fireEvent.click(screen.getByText("Guardar factura"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], { accion: "oc_factura", id: 101, factura_numero: "A-0003-00001234", factura_fecha: null, tipo_cambio: 1050, precios: [{ item_id: 1, precio_unitario: 11.5 }] });
  await screen.findByText(/Corregí 1 ingreso de stock con el precio nuevo/);
});

test("accesos — Recibir para jefes y comprador", () => {
  const src = readFileSync(new URL("../app/components/ComprasScreen.jsx", import.meta.url), "utf8");
  assert.match(src, /PESTANAS_JEFE = \[\["pedidos", "🛒 Pedidos"\], \["recibir", "📦 Recibir"\]\]/);
  assert.match(src, /\["recibir", "📦 Recibir"\], \["proveedores", "🏭 Proveedores"\], \["reportes", "📊 Reportes"\]\]/);
  assert.match(src, /vista === "recibir" && permisos\.puede_pedir/);
});
