// tests/compras.test.jsx — Compras, parte 20 (ítem 41): proveedores y pedidos
// de material. Piden jefes de taller, gerencia, dueños y Administración (los
// operarios no); los proveedores los maneja Administración sin división
// asignada o gerencia (migración 113).
import "./helpers/domSetup.js";
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  puedePedir, puedeComprar, puedeAnularPedido, leerListaProveedores, formatoCuit, numeroWhatsapp, textoPedido, filtrarPedidos,
} from "../app/lib/compras.js";
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
const { default: ComprasScreen } = await import("../app/components/ComprasScreen.jsx");
const { default: ProveedoresCompras } = await import("../app/components/ProveedoresCompras.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const OTRO = "33333333-3333-3333-3333-333333333333";
const PLACA = { sku: "1.1.2.18", nombre: "Placa melamina blanca 18 mm", unidad: "placas", division: "MUEBLES" };

// ─── Reglas ───

test("quién pide y quién compra — operarios no piden; el supervisor de división pide pero no compra", () => {
  assert.equal(puedePedir("operativo"), false);
  assert.equal(puedePedir("administrativo"), true);
  assert.equal(puedePedir("gerencial"), true);
  assert.equal(puedeComprar("gerencial"), true);
  assert.equal(puedeComprar("administrativo", null), true);
  assert.equal(puedeComprar("administrativo", { division: "MUEBLES", ids: [], legajos: [] }), false);
  assert.equal(puedeComprar("operativo"), false);
});

test("anular un pedido — el suyo pendiente; el comprador cualquiera pendiente; en OC nadie", () => {
  const p = { estado: "pendiente", empleado_id: EMP };
  assert.equal(puedeAnularPedido(p, { empleadoId: EMP }), true);
  assert.equal(puedeAnularPedido(p, { empleadoId: OTRO }), false);
  assert.equal(puedeAnularPedido(p, { comprador: true, empleadoId: OTRO }), true);
  assert.equal(puedeAnularPedido({ ...p, estado: "en_oc" }, { comprador: true }), false);
  assert.equal(puedeAnularPedido({ ...p, estado: "anulado" }, { empleadoId: EMP }), false);
});

test("lista de proveedores pegada de TABLAS — sin título, vacíos ni repetidos", () => {
  const texto = "PROVEEDORES\nAluar\n\n  Egger   Argentina \naluar\nFaplac\tx\n";
  assert.deepEqual(leerListaProveedores(texto), ["Aluar", "Egger Argentina", "Faplac"]);
  assert.equal(leerListaProveedores("a\nb\nc", 2).length, 2);
});

test("CUIT, WhatsApp y texto del pedido", () => {
  assert.equal(formatoCuit("20223334445"), "20-22333444-5");
  assert.equal(formatoCuit("20 22333444 5"), "20-22333444-5");
  assert.equal(formatoCuit("sin cuit"), "sin cuit");
  assert.equal(numeroWhatsapp("11 2345-6789"), "5491123456789");
  assert.equal(numeroWhatsapp("011 2345-6789"), "5491123456789");
  assert.equal(numeroWhatsapp("+54 9 341 555 1234"), "5493415551234");
  assert.equal(numeroWhatsapp("123"), null);
  assert.equal(numeroWhatsapp(""), null);
  assert.equal(textoPedido({ descripcion: "Placa", cantidad: 1234.5, unidad: "placas", ot: "M-7495" }), "Placa · 1.234,5 placas · OT M-7495");
  assert.equal(textoPedido({ sku: "1.1", cantidad: 2 }), "1.1 · 2");
  const lista = [{ descripcion: "Placa", estado: "pendiente", empleado_nombre: "Ana" }, { descripcion: "Bisagra", estado: "en_oc", ot: "M-1" }];
  assert.equal(filtrarPedidos(lista, { estado: "pendiente" }).length, 1);
  assert.equal(filtrarPedidos(lista, { texto: "ana" })[0].descripcion, "Placa");
  assert.equal(filtrarPedidos(lista, { texto: "m-1" })[0].descripcion, "Bisagra");
});

test("validación — pedido con artículo o descripción y cantidad positiva; email válido", () => {
  const ok = (b) => comprasBody.safeParse(b).success;
  assert.equal(ok({ accion: "pedido_crear", sku: "1.1.2", cantidad: 3 }), true);
  assert.equal(ok({ accion: "pedido_crear", descripcion: "Tornillos 4x40", unidad: "cajas", cantidad: 2, para_fecha: "2026-10-20" }), true);
  assert.equal(ok({ accion: "pedido_crear", cantidad: 3 }), false);
  assert.equal(ok({ accion: "pedido_crear", sku: "1.1.2", cantidad: 0 }), false);
  assert.equal(ok({ accion: "pedido_crear", sku: "1.1.2&x=1", cantidad: 1 }), false);
  assert.equal(ok({ accion: "pedido_crear", sku: "1.1.2", cantidad: 1, para_fecha: "20/10" }), false);
  assert.equal(ok({ accion: "pedido_crear", sku: "1.1.2", cantidad: 1, empresa_id: E }), false);
  assert.equal(ok({ accion: "proveedor_guardar", nombre: "Aluar", email: "" }), true);
  assert.equal(ok({ accion: "proveedor_guardar", nombre: "Aluar", email: "no-es-mail" }), false);
  assert.equal(ok({ accion: "proveedor_guardar", nombre: "Aluar", plazo_dias: 400 }), false);
  assert.equal(ok({ accion: "proveedor_guardar", nombre: "" }), false);
  assert.equal(ok({ accion: "proveedor_baja", id: 3, activo: false }), true);
  assert.equal(ok({ accion: "proveedores_importar", nombres: [] }), false);
  assert.equal(ok({ accion: "pedido_anular", id: "3" }), false);
});

test("migración 113 — por empresa, sin borrar; se lee por /api/data solo gestión", () => {
  const sql = readFileSync(new URL("../supabase/migrations/113_compras_pedidos.sql", import.meta.url), "utf8");
  for (const t of ["proveedores", "pedidos_compra"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t}`));
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`tenant_isolation_auth_${t}`));
    assert.match(sql, new RegExp(`grant select, insert, update on public\\.${t} to authenticated`));
    assert.doesNotMatch(sql, new RegExp(`grant[^;]*delete[^;]*${t}`, "i"));
    assert.equal(autorizar(t, "GET", { rol: "operativo" }).ok, false);
    assert.equal(autorizar(t, "GET", { rol: "administrativo" }).ok, true);
    for (const metodo of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar(t, metodo, { rol: "gerencial" }).ok, false, `${t} ${metodo}`);
  }
  assert.match(sql, /proveedores_empresa_nombre on public\.proveedores \(empresa_id, lower\(nombre\)\)/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Ruta ───

function mockRuta({ supervisor = null, articulo = PLACA, ot = [{ ot: "M-7495" }], pedido = null, proveedores = [], falla = null, duplicado = false } = {}) {
  const escrito = [];
  const escribir = (tabla) => (u, o) => {
    if (falla) return { status: 404, body: { message: falla } };
    if (!o.method || o.method === "GET") return { status: 200, body: tabla === "pedidos_compra" ? (pedido ? [pedido] : []) : proveedores };
    if (duplicado) return { status: 409, body: { code: "23505", message: "duplicate key value violates unique constraint" } };
    const body = JSON.parse(o.body);
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return { status: 201, body: Array.isArray(body) ? body : [{ id: 9, ...body }] };
  };
  global.fetch = createFetchMock([
    // Antes que authPassHandlers: ahí el alcance siempre es "no supervisor"
    {
      match: (u) => u.includes("/rest/v1/empleados"),
      respond: (u) => u.includes("solo_su_division")
        ? { status: 200, body: [{ id: EMP, legajo: 7, division: supervisor, solo_su_division: Boolean(supervisor) }] }
        : u.includes("select=id,legajo")
          ? { status: 200, body: [{ id: EMP, legajo: 7 }] }
          : { status: 200, body: [{ nombre: "Ana Jefa", division: "MUEBLES" }] },
    },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: articulo ? [articulo] : [] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: ot }) },
    { match: (u) => u.includes("/rest/v1/pedidos_compra"), respond: escribir("pedidos_compra") },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: escribir("proveedores") },
  ]);
  return escrito;
}

async function token(rol, empleadoId = EMP) {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/compras", {
  method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

test("/api/compras GET — dice si la sesión compra", async () => {
  mockRuta();
  assert.deepEqual(await (await api.GET(req(await token("gerencial")))).json(), { comprador: true, puede_pedir: true });
  assert.deepEqual(await (await api.GET(req(await token("operativo")))).json(), { comprador: false, puede_pedir: false });
  mockRuta({ supervisor: "MUEBLES" });
  assert.deepEqual(await (await api.GET(req(await token("administrativo")))).json(), { comprador: false, puede_pedir: true });
});

test("/api/compras — el jefe de taller pide del catálogo para una OT; queda pendiente con su nombre", async () => {
  const escrito = mockRuta({ supervisor: "MUEBLES" });
  const res = await api.POST(req(await token("administrativo"), { accion: "pedido_crear", sku: PLACA.sku, cantidad: 4, ot: "M-7495", para_fecha: "2026-10-20" }));
  assert.equal(res.status, 200);
  const [fila] = escrito;
  assert.equal(fila.tabla, "pedidos_compra");
  assert.equal(fila.body.empresa_id, E);
  assert.equal(fila.body.estado, "pendiente");
  assert.equal(fila.body.descripcion, PLACA.nombre);
  assert.equal(fila.body.unidad, "placas");
  assert.equal(fila.body.ot, "M-7495");
  assert.equal(fila.body.para_fecha, "2026-10-20");
  assert.equal(fila.body.division, "MUEBLES");
  assert.equal(fila.body.empleado_id, EMP);
  assert.equal(fila.body.empleado_nombre, "Ana Jefa");
});

test("/api/compras — material escrito a mano, sin catálogo", async () => {
  const escrito = mockRuta();
  const res = await api.POST(req(await token("gerencial"), { accion: "pedido_crear", descripcion: "Tornillos 4x40", unidad: "cajas", cantidad: 2 }));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].body.sku, null);
  assert.equal(escrito[0].body.descripcion, "Tornillos 4x40");
  assert.equal(escrito[0].body.unidad, "cajas");
});

test("/api/compras — el operario no pide; artículo u OT que no existen", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token("operativo"), { accion: "pedido_crear", sku: PLACA.sku, cantidad: 1 }));
  assert.equal(res.status, 403);
  assert.equal(escrito.length, 0);
  escrito = mockRuta({ articulo: null });
  res = await api.POST(req(await token("gerencial"), { accion: "pedido_crear", sku: "0.0.0", cantidad: 1 }));
  assert.equal(res.status, 404);
  mockRuta({ ot: [] });
  res = await api.POST(req(await token("gerencial"), { accion: "pedido_crear", sku: PLACA.sku, cantidad: 1, ot: "X-1" }));
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /OT X-1/);
});

test("/api/compras — anular: el suyo sí, el de otro no (salvo el comprador), en OC no", async () => {
  let escrito = mockRuta({ supervisor: "MUEBLES", pedido: { id: 5, estado: "pendiente", empleado_id: EMP } });
  let res = await api.POST(req(await token("administrativo"), { accion: "pedido_anular", id: 5 }));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.match(escrito[0].url, /estado=eq\.pendiente/);
  assert.equal(escrito[0].body.estado, "anulado");
  assert.equal(escrito[0].body.anulado_por, EMP);

  _limpiarCacheAlcance();
  escrito = mockRuta({ supervisor: "MUEBLES", pedido: { id: 5, estado: "pendiente", empleado_id: OTRO } });
  res = await api.POST(req(await token("administrativo"), { accion: "pedido_anular", id: 5 }));
  assert.equal(res.status, 403);
  assert.equal(escrito.length, 0);
  res = await api.POST(req(await token("gerencial"), { accion: "pedido_anular", id: 5 }));
  assert.equal(res.status, 200);

  escrito = mockRuta({ pedido: { id: 5, estado: "en_oc", empleado_id: EMP } });
  res = await api.POST(req(await token("gerencial"), { accion: "pedido_anular", id: 5 }));
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /orden de compra/);

  mockRuta({ pedido: null });
  res = await api.POST(req(await token("gerencial"), { accion: "pedido_anular", id: 5 }));
  assert.equal(res.status, 404);
});

test("/api/compras — proveedores: Administración sí, el supervisor de división no", async () => {
  let escrito = mockRuta({ supervisor: "MUEBLES" });
  let res = await api.POST(req(await token("administrativo"), { accion: "proveedor_guardar", nombre: "Aluar" }));
  assert.equal(res.status, 403);
  assert.equal(escrito.length, 0);

  _limpiarCacheAlcance();
  escrito = mockRuta();
  res = await api.POST(req(await token("administrativo"), { accion: "proveedor_guardar", nombre: "  Aluar   SA ", cuit: "30123456789", whatsapp: "11 2345 6789", plazo_dias: 7 }));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "POST");
  assert.equal(escrito[0].body.nombre, "Aluar SA");
  assert.equal(escrito[0].body.cuit, "30-12345678-9");
  assert.equal(escrito[0].body.plazo_dias, 7);
  assert.equal(escrito[0].body.empresa_id, E);

  escrito = mockRuta();
  res = await api.POST(req(await token("gerencial"), { accion: "proveedor_baja", id: 3, activo: false }));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.equal(escrito[0].body.activo, false);
  assert.match(escrito[0].url, /proveedores\?id=eq\.3&empresa_id=eq\./);

  mockRuta({ duplicado: true });
  res = await api.POST(req(await token("gerencial"), { accion: "proveedor_guardar", nombre: "Aluar" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Ya hay un proveedor que se llama Aluar/);
});

test("/api/compras — importar de la planilla agrega solo los que faltan", async () => {
  const escrito = mockRuta({ proveedores: [{ nombre: "ALUAR" }] });
  const res = await api.POST(req(await token("gerencial"), { accion: "proveedores_importar", nombres: ["Aluar", "Egger", "egger", "Faplac"] }));
  assert.deepEqual(await res.json(), { ok: true, agregados: 2, ya_estaban: 2 });
  assert.deepEqual(escrito[0].body.map((p) => p.nombre), ["Egger", "Faplac"]);
});

test("/api/compras — si falta la migración 113 lo dice", async () => {
  mockRuta({ falla: 'relation "public.pedidos_compra" does not exist' });
  const res = await api.POST(req(await token("gerencial"), { accion: "pedido_crear", sku: PLACA.sku, cantidad: 1 }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 113/);
});

// ─── Pantallas ───

function mockPantalla({ comprador = false, puedePedir: pide = true, pedidos = [], proveedores = [] } = {}) {
  const enviados = [];
  const leidos = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/compras")) {
      if (!body) return new Response(JSON.stringify({ comprador, puede_pedir: pide }), { status: 200 });
      enviados.push(body);
      const extra = body.accion === "proveedores_importar" ? { agregados: body.nombres.length, ya_estaban: 0 } : {};
      return new Response(JSON.stringify({ ok: true, pedido: { ...body, descripcion: body.descripcion || PLACA.nombre, unidad: body.unidad || PLACA.unidad }, ...extra }), { status: 200 });
    }
    if (body?.path) leidos.push(body.path);
    if (body?.path?.startsWith("articulos_stock")) return new Response(JSON.stringify({ data: [PLACA] }), { status: 200 });
    if (body?.path?.startsWith("proyectos")) return new Response(JSON.stringify({ data: [{ ot: "M-7495" }] }), { status: 200 });
    if (body?.path?.startsWith("pedidos_compra")) return new Response(JSON.stringify({ data: pedidos }), { status: 200 });
    if (body?.path?.startsWith("proveedores")) return new Response(JSON.stringify({ data: proveedores }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return { enviados, leidos };
}

const JEFE = { id: EMP, rol: "administrativo", empresa_id: E };

test("🛒 pedir material — busca la placa, pone cantidad y OT; el jefe ve solo sus pedidos", async () => {
  const { enviados, leidos } = mockPantalla();
  render(<ComprasScreen empresaId={E} usuario={JEFE} />);
  fireEvent.click(await screen.findByText("🛒 Pedir material"));
  await waitFor(() => assert.ok(leidos.some((p) => p.startsWith("articulos_stock"))));
  assert.ok(leidos.some((p) => p.startsWith("pedidos_compra") && p.includes(`empleado_id=eq.${EMP}`)), "el jefe ve lo suyo");
  assert.equal(screen.queryByText("🏭 Proveedores"), null, "el jefe no maneja proveedores");
  fireEvent.change(screen.getByLabelText("Material"), { target: { value: "melamina" } });
  fireEvent.click(await screen.findByText(PLACA.nombre));
  fireEvent.change(screen.getByLabelText("Cantidad (placas)"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("OT (opcional)"), { target: { value: "M-7495" } });
  fireEvent.change(screen.getByLabelText("Para cuándo"), { target: { value: "2026-10-20" } });
  fireEvent.click(screen.getByText("Pedir"));
  await waitFor(() => assert.ok(screen.getByText(/Pedido cargado/)));
  assert.deepEqual(enviados[0], { accion: "pedido_crear", sku: PLACA.sku, descripcion: null, unidad: null, cantidad: 4, ot: "M-7495", para_fecha: "2026-10-20", notas: null });
  fireEvent.click(screen.getByText("Pedir otro"));
  assert.equal(screen.getByLabelText("OT (opcional)").value, "M-7495", "pedir otro mantiene la OT");
});

test("🛒 pedir material — algo que no está en el catálogo, con unidad", async () => {
  const { enviados } = mockPantalla();
  render(<ComprasScreen empresaId={E} usuario={JEFE} />);
  fireEvent.click(await screen.findByText("🛒 Pedir material"));
  fireEvent.change(screen.getByLabelText("Material"), { target: { value: "Tornillos 4x40" } });
  fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Unidad"), { target: { value: "cajas" } });
  fireEvent.click(screen.getByText("Pedir"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].sku, null);
  assert.equal(enviados[0].descripcion, "Tornillos 4x40");
  assert.equal(enviados[0].unidad, "cajas");
});

test("compras — el operario no ve el botón de pedir", async () => {
  mockPantalla({ puedePedir: false });
  render(<ComprasScreen empresaId={E} usuario={{ id: EMP, rol: "operativo" }} />);
  await screen.findByText("Todavía no hiciste pedidos de material.");
  assert.equal(screen.queryByText("🛒 Pedir material"), null);
});

test("compras — Administración ve todos los pedidos pendientes y anula", async () => {
  const pedidos = [
    { id: 5, descripcion: "Placa", cantidad: 4, unidad: "placas", ot: "M-7495", estado: "pendiente", empleado_id: OTRO, empleado_nombre: "Ana Jefa", created_at: "2026-10-17T12:00:00Z" },
    { id: 6, descripcion: "Bisagra", cantidad: 10, estado: "en_oc", empleado_id: OTRO, empleado_nombre: "Luis", created_at: "2026-10-16T12:00:00Z" },
  ];
  const { enviados, leidos } = mockPantalla({ comprador: true, pedidos });
  render(<ComprasScreen empresaId={E} usuario={{ id: EMP, rol: "administrativo" }} />);
  await screen.findByText("Placa · 4 placas · OT M-7495");
  assert.ok(!leidos.find((p) => p.startsWith("pedidos_compra")).includes("empleado_id"), "el comprador ve todos");
  assert.equal(screen.queryByText(/Bisagra/), null, "arranca mostrando los pendientes");
  fireEvent.click(screen.getByLabelText("Anular pedido de Placa · 4 placas · OT M-7495"));
  await waitFor(() => assert.deepEqual(enviados[0], { accion: "pedido_anular", id: 5 }));
  fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "" } });
  assert.ok(screen.getByText("Bisagra · 10"));
  assert.ok(screen.getByText("🏭 Proveedores"));
});

test("proveedores — traer la lista de la planilla, editar y dar de baja", async () => {
  const proveedores = [{ id: 3, nombre: "Aluar", whatsapp: "11 2345 6789", plazo_dias: 7, activo: true }];
  const { enviados } = mockPantalla({ comprador: true, proveedores });
  render(<ProveedoresCompras empresaId={E} />);
  await screen.findByText("Aluar");
  assert.equal(screen.getByLabelText("WhatsApp de Aluar").getAttribute("href"), "https://wa.me/5491123456789");
  assert.ok(screen.getByText("7 días"));

  fireEvent.click(screen.getByText("📋 Traer de la planilla"));
  fireEvent.change(screen.getByLabelText("Lista de proveedores"), { target: { value: "PROVEEDORES\nEgger\nFaplac\negger" } });
  assert.ok(screen.getByText("2 nombres para agregar"));
  fireEvent.click(screen.getByText("Agregar"));
  await waitFor(() => assert.deepEqual(enviados[0], { accion: "proveedores_importar", nombres: ["Egger", "Faplac"] }));
  await screen.findByText(/Agregué 2 proveedores/);

  fireEvent.click(screen.getByLabelText("Editar Aluar"));
  fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "30123456789" } });
  fireEvent.change(screen.getByLabelText("Condición de pago"), { target: { value: "30 días" } });
  fireEvent.click(screen.getByText("Guardar"));
  await waitFor(() => assert.equal(enviados.length, 2));
  assert.deepEqual(enviados[1], {
    accion: "proveedor_guardar", id: 3, nombre: "Aluar", cuit: "30123456789", contacto: null, whatsapp: "11 2345 6789",
    email: null, plazo_dias: 7, condicion_pago: "30 días", notas: null,
  });

  fireEvent.click(await screen.findByLabelText("Dar de baja Aluar"));
  await waitFor(() => assert.deepEqual(enviados[2], { accion: "proveedor_baja", id: 3, activo: false }));
});

test("accesos — pestaña Compras en Planta", () => {
  const planta = readFileSync(new URL("../app/components/screens/PlantaScreen.jsx", import.meta.url), "utf8");
  assert.match(planta, /\{ id: "compras", label: "Compras", modulo: "proyectos" \}/);
  assert.match(planta, /<ComprasScreen empresaId=\{empresaId\} empresa=\{empresa\} usuario=\{usuario\} \/>/);
});
