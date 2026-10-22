// tests/compras-cotizaciones.test.jsx — Compras (ítem 41, migración 125):
// el proveedor de "A comprar" es opcional. Lo que va sin proveedor queda en
// una orden "A cotizar" que se manda a cotizar a varios proveedores; se anota
// el total y el plazo de cada uno y se elige al ganador.
import "./helpers/domSetup.js";
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  ocACotizar, estadoOcVisible, cotizacionMasBarata, textoCotizacion, htmlOrdenCompra, NOMBRE_A_COTIZAR,
} from "../app/lib/ordenesCompra.js";
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
const { default: OrdenesCompra } = await import("../app/components/OrdenesCompra.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const ALUAR = { id: 1, nombre: "Aluar", activo: true, contacto: "Marta", whatsapp: "11 2345 6789", email: "ventas@aluar.test" };
const EGGER = { id: 2, nombre: "Egger", activo: true };
const OC_COTIZAR = { id: 101, numero: 8, proveedor_id: null, proveedor_nombre: NOMBRE_A_COTIZAR, estado: "borrador", moneda: "ARS", created_at: "2026-10-22T12:00:00Z" };
const ITEMS = [{ id: 1, orden_id: 101, sku: "3.3.1.6", descripcion: "Perfil 0277", unidad: "MT", cantidad: 12, precio_unitario: 1500, cantidad_recibida: 0 }];

// ─── Reglas ───

test("orden A cotizar — borrador sin proveedor; la más barata; texto y PDF sin precios", () => {
  assert.equal(ocACotizar(OC_COTIZAR), true);
  assert.equal(ocACotizar({ ...OC_COTIZAR, proveedor_id: 1 }), false);
  assert.equal(ocACotizar({ ...OC_COTIZAR, estado: "anulada" }), false);
  assert.equal(estadoOcVisible(OC_COTIZAR).nombre, "A cotizar");
  assert.equal(estadoOcVisible({ estado: "enviada", proveedor_id: 1 }).nombre, "Enviada");

  assert.equal(cotizacionMasBarata([{ id: 1, total: 500 }, { id: 2, total: 300 }, { id: 3, total: null }]), 2);
  assert.equal(cotizacionMasBarata([{ id: 1, total: null }]), null);

  const texto = textoCotizacion({ empresa: "GI Group", oc: { ...OC_COTIZAR, fecha_prometida: "2026-10-30" }, items: ITEMS, proveedor: ALUAR });
  assert.match(texto, /^Hola Marta, te pido cotización para GI Group \(pedido N° 8\):/);
  assert.match(texto, /• 12 MT Perfil 0277 \(3\.3\.1\.6\)/);
  assert.match(texto, /Lo necesitamos para el 30\/10\/2026/);
  assert.doesNotMatch(texto, /1\.500|c\/u/, "sin precios");

  const html = htmlOrdenCompra({ oc: OC_COTIZAR, items: ITEMS, proveedor: ALUAR, cotizacion: true });
  assert.match(html, /<h1>Pedido de cotización N° 8<\/h1>/);
  assert.match(html, /<td>Aluar<\/td>/, "va a nombre del proveedor al que se le pide");
  assert.doesNotMatch(html, /Precio unit|Total sin IVA|1\.500/);
  assert.match(htmlOrdenCompra({ oc: { ...OC_COTIZAR, proveedor_nombre: "Aluar" }, items: ITEMS }), /Precio unit/, "la OC común sigue igual");
});

test("validación, migración 125 y permisos de lectura", () => {
  const ok = (b) => comprasBody.safeParse(b).success;
  assert.equal(ok({ accion: "oc_crear", lineas: [{ descripcion: "Perfil", cantidad: 2 }] }), true, "proveedor opcional");
  assert.equal(comprasBody.parse({ accion: "oc_crear", lineas: [{ proveedor_id: null, descripcion: "Perfil", cantidad: 2 }] }).lineas[0].proveedor_id, null);
  assert.equal(ok({ accion: "oc_cotizacion_pedir", id: 101, proveedores: [1, 2] }), true);
  assert.equal(ok({ accion: "oc_cotizacion_pedir", id: 101, proveedores: [] }), false);
  assert.equal(ok({ accion: "oc_cotizacion_guardar", id: 5, total: 1000, plazo_dias: 7, nota: "Pago 30 días" }), true);
  assert.equal(ok({ accion: "oc_cotizacion_guardar", id: 5, plazo_dias: 1.5 }), false);
  assert.equal(ok({ accion: "oc_adjudicar", id: 5 }), true);
  assert.equal(ok({ accion: "oc_cotizacion_quitar", id: 5 }), true);

  const sql = readFileSync(new URL("../supabase/migrations/125_cotizaciones_oc.sql", import.meta.url), "utf8");
  assert.match(sql, /^do \$mig\$/m);
  assert.match(sql, /create table if not exists public\.ordenes_compra_cotizaciones/);
  assert.match(sql, /ordenes_compra_cotizaciones \(orden_id, proveedor_id\)/);
  assert.match(sql, /enable row level security/);
  assert.equal(autorizar("ordenes_compra_cotizaciones", "GET", { rol: "administrativo" }).ok, true);
  assert.equal(autorizar("ordenes_compra_cotizaciones", "POST", { rol: "gerencial" }).ok, false);
  const data = readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8");
  assert.match(data, /"recepciones_compra_items", "ordenes_compra_cotizaciones"\]/, "solo lectura por /api/data");

  // Lo que está a cotizar no va a la planilla como EN TRÁNSITO
  const planilla = readFileSync(new URL("../app/api/stock/planilla/route.js", import.meta.url), "utf8");
  assert.match(planilla, /&proveedor_id=not\.is\.null/);
});

// ─── Ruta ───

function mockRuta({ oc = OC_COTIZAR, cotizaciones = [], proveedores = [ALUAR, EGGER], sin125 = false, adjudicada = true } = {}) {
  const escrito = [];
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return body;
  };
  global.fetch = createFetchMock([
    {
      match: (u) => u.includes("/rest/v1/empleados"),
      respond: (u) => u.includes("solo_su_division")
        ? { status: 200, body: [{ id: EMP, legajo: 7, division: null, solo_su_division: false }] }
        : u.includes("select=id,legajo") ? { status: 200, body: [{ id: EMP, legajo: 7 }] } : { status: 200, body: [{ nombre: "Laura Admin" }] },
    },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: (u) => ({ status: 200, body: proveedores.filter((p) => new RegExp(`[?&]id=eq\\.${p.id}(&|$)`).test(u) || new RegExp(`[?&]id=in\\.\\([^)]*\\b${p.id}\\b`).test(u)) }) },
    { match: (u) => u.includes("/rest/v1/pedidos_compra"), respond: (u, o) => { if (o.method && o.method !== "GET") anotar("pedidos_compra", u, o); return { status: 200, body: [] }; } },
    {
      match: (u) => u.includes("/rest/v1/ordenes_compra_cotizaciones"),
      respond: (u, o) => {
        if (sin125) return { status: 404, body: { code: "42P01", message: 'relation "public.ordenes_compra_cotizaciones" does not exist' } };
        if (!o.method || o.method === "GET") return { status: 200, body: /[?&]id=eq\./.test(u) ? cotizaciones.filter((c) => u.includes(`?id=eq.${c.id}&`)) : cotizaciones };
        const body = anotar("ordenes_compra_cotizaciones", u, o);
        return { status: 201, body: Array.isArray(body) ? body : [body] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/ordenes_compra_items"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: ITEMS };
        const body = anotar("ordenes_compra_items", u, o);
        return { status: 201, body: Array.isArray(body) ? body : [] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/ordenes_compra"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: u.includes("order=numero.desc") ? [{ numero: 7 }] : oc ? [oc] : [] };
        const body = anotar("ordenes_compra", u, o);
        if (o.method === "PATCH" && !adjudicada) return { status: 200, body: [] };
        return { status: 201, body: [{ id: 100 + escrito.filter((x) => x.tabla === "ordenes_compra" && x.metodo === "POST").length, ...oc, ...body }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol = "gerencial") {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/compras", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/compras oc_crear — lo que va sin proveedor queda en una orden A cotizar", async () => {
  const escrito = mockRuta({ oc: null });
  const res = await api.POST(req(await token(), {
    accion: "oc_crear",
    lineas: [
      { proveedor_id: 1, descripcion: "Perfil 0277", cantidad: 12 },
      { descripcion: "Tornillos", cantidad: 2 },
      { proveedor_id: null, descripcion: "Bisagras", cantidad: 10 },
    ],
  }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.ordenes.map((o) => [o.numero, o.proveedor_nombre]), [[8, "Aluar"], [9, "A cotizar"]]);
  const ocs = escrito.filter((x) => x.tabla === "ordenes_compra" && x.metodo === "POST");
  assert.equal(ocs[1].body.proveedor_id, null);
  assert.equal(ocs[1].body.estado, "borrador");
  const its = escrito.filter((x) => x.tabla === "ordenes_compra_items");
  assert.deepEqual(its[1].body.map((i) => [i.orden_id, i.descripcion]), [[102, "Tornillos"], [102, "Bisagras"]]);

  // Todo sin proveedor: una sola orden y no hace falta leer proveedores
  const solo = mockRuta({ oc: null });
  const r2 = await api.POST(req(await token(), { accion: "oc_crear", lineas: [{ descripcion: "Tornillos", cantidad: 2 }] }));
  assert.equal(r2.status, 200);
  assert.deepEqual((await r2.json()).ordenes.map((o) => o.proveedor_nombre), ["A cotizar"]);
  assert.equal(solo.filter((x) => x.tabla === "ordenes_compra").length, 1);
});

test("/api/compras — una orden A cotizar no se manda ni se recibe hasta elegir proveedor", async () => {
  mockRuta();
  let res = await api.POST(req(await token(), { accion: "oc_enviar", id: 101 }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Elegí el proveedor/);
  mockRuta();
  res = await api.POST(req(await token(), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 1 }] }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /a cotizar/);
});

test("/api/compras oc_cotizacion_pedir — anota los proveedores nuevos, sin repetir", async () => {
  const escrito = mockRuta({ cotizaciones: [{ id: 5, orden_id: 101, proveedor_id: 1, proveedor_nombre: "Aluar" }] });
  let res = await api.POST(req(await token(), { accion: "oc_cotizacion_pedir", id: 101, proveedores: [1, 2, 2] }));
  assert.equal(res.status, 200);
  const [ins] = escrito.filter((x) => x.tabla === "ordenes_compra_cotizaciones");
  assert.deepEqual(ins.body.map((c) => [c.orden_id, c.proveedor_id, c.proveedor_nombre, c.pedida_por_nombre]), [[101, 2, "Egger", "Laura Admin"]]);
  assert.equal(ins.body[0].empresa_id, E);

  mockRuta({ oc: { ...OC_COTIZAR, proveedor_id: 1, proveedor_nombre: "Aluar" } });
  assert.equal((await api.POST(req(await token(), { accion: "oc_cotizacion_pedir", id: 101, proveedores: [2] }))).status, 409, "ya tiene proveedor");

  mockRuta({ proveedores: [ALUAR, { ...EGGER, activo: false }] });
  assert.equal((await api.POST(req(await token(), { accion: "oc_cotizacion_pedir", id: 101, proveedores: [2] }))).status, 409, "dado de baja no");

  mockRuta({ sin125: true });
  res = await api.POST(req(await token(), { accion: "oc_cotizacion_pedir", id: 101, proveedores: [1] }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 125/);

  mockRuta();
  assert.equal((await api.POST(req(await token("operativo"), { accion: "oc_cotizacion_pedir", id: 101, proveedores: [1] }))).status, 403, "solo el comprador");
});

test("/api/compras oc_cotizacion_guardar y oc_adjudicar — anota la respuesta y la orden pasa al elegido", async () => {
  const COT = { id: 5, orden_id: 101, proveedor_id: 2, proveedor_nombre: "Egger", respondida_at: null };
  let escrito = mockRuta({ cotizaciones: [COT] });
  let res = await api.POST(req(await token(), { accion: "oc_cotizacion_guardar", id: 5, total: 25000, plazo_dias: 10, nota: "Pago 30 días" }));
  assert.equal(res.status, 200);
  const [g] = escrito.filter((x) => x.tabla === "ordenes_compra_cotizaciones");
  assert.equal(g.body.total, 25000);
  assert.equal(g.body.plazo_dias, 10);
  assert.ok(g.body.respondida_at);

  escrito = mockRuta({ cotizaciones: [COT] });
  res = await api.POST(req(await token(), { accion: "oc_adjudicar", id: 5 }));
  assert.equal(res.status, 200);
  const oc = escrito.find((x) => x.tabla === "ordenes_compra");
  assert.match(oc.url, /id=eq\.101&.*estado=eq\.borrador&proveedor_id=is\.null/, "solo si sigue a cotizar");
  assert.deepEqual([oc.body.proveedor_id, oc.body.proveedor_nombre], [2, "Egger"]);
  const elegida = escrito.find((x) => x.tabla === "ordenes_compra_cotizaciones");
  assert.equal(elegida.body.elegida, true);

  mockRuta({ cotizaciones: [COT], adjudicada: false });
  assert.equal((await api.POST(req(await token(), { accion: "oc_adjudicar", id: 5 }))).status, 409, "otro la eligió antes");

  mockRuta({ cotizaciones: [] });
  assert.equal((await api.POST(req(await token(), { accion: "oc_adjudicar", id: 5 }))).status, 404);

  escrito = mockRuta({ cotizaciones: [COT] });
  res = await api.POST(req(await token(), { accion: "oc_cotizacion_quitar", id: 5 }));
  assert.equal(res.status, 200);
  assert.equal(escrito.find((x) => x.tabla === "ordenes_compra_cotizaciones").metodo, "DELETE");
});

// ─── Pantalla ───

function mockPantalla({ ordenes = [OC_COTIZAR], cotizaciones = [], sin125 = false } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/compras")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const path = body?.path || "";
    if (sin125 && path.startsWith("ordenes_compra_cotizaciones")) {
      return new Response(JSON.stringify({ error: 'relation "public.ordenes_compra_cotizaciones" does not exist' }), { status: 404 });
    }
    const data = path.startsWith("proveedores") ? [ALUAR, EGGER]
      : path.startsWith("ordenes_compra_cotizaciones") ? cotizaciones
        : path.startsWith("ordenes_compra_items") ? ITEMS
          : path.startsWith("ordenes_compra") ? ordenes : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return enviados;
}

test("Órdenes — A cotizar: agrega proveedores, manda el pedido sin precios, anota y elige", async () => {
  const cotizaciones = [
    { id: 5, orden_id: 101, proveedor_id: 1, proveedor_nombre: "Aluar", total: 30000, plazo_dias: 5, created_at: "2026-10-22T12:00:00Z" },
    { id: 6, orden_id: 101, proveedor_id: 2, proveedor_nombre: "Egger", total: null, plazo_dias: null, created_at: "2026-10-22T12:00:00Z" },
  ];
  const enviados = mockPantalla({ cotizaciones });
  render(<OrdenesCompra empresaId={E} empresa={{ nombre: "GI Group" }} />);
  const fila = await screen.findByText("OC N° 8 · A cotizar");
  assert.match(fila.parentElement.textContent, /📨 A cotizar/);
  fireEvent.click(fila);
  await screen.findByText("📨 Pedir cotización");
  assert.equal(screen.queryByText("📤 Marcar como enviada"), null, "no se manda sin proveedor");

  const wa = decodeURIComponent((await screen.findByLabelText("WhatsApp a Aluar")).getAttribute("href"));
  assert.match(wa, /^https:\/\/wa\.me\/5491123456789\?text=Hola Marta, te pido cotización para GI Group \(pedido N° 8\)/);
  assert.doesNotMatch(wa, /c\/u/);
  assert.match(screen.getByLabelText("Email a Aluar").getAttribute("href"), /subject=Pedido%20de%20cotizaci%C3%B3n%20N%C2%B0%208/);
  assert.match(screen.getByText("Aluar").parentElement.textContent, /Más barato/);

  fireEvent.change(screen.getByLabelText("Total sin IVA de Egger"), { target: { value: "28.500" } });
  fireEvent.change(screen.getByLabelText("Plazo en días de Egger"), { target: { value: "10" } });
  fireEvent.click(screen.getAllByText("Guardar respuesta")[1]);
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], { accion: "oc_cotizacion_guardar", id: 6, total: 28500, plazo_dias: 10, nota: null });

  fireEvent.click(screen.getAllByText("✅ Elegir este proveedor")[1]);
  await waitFor(() => assert.equal(enviados.length, 2));
  assert.deepEqual(enviados[1], { accion: "oc_adjudicar", id: 6 });
});

test("Órdenes — A cotizar: agregar un proveedor; sin la migración 125 avisa", async () => {
  let enviados = mockPantalla();
  render(<OrdenesCompra empresaId={E} empresa={{ nombre: "GI Group" }} />);
  fireEvent.click(await screen.findByText("OC N° 8 · A cotizar"));
  await screen.findByText("Todavía no le pediste cotización a nadie.");
  fireEvent.click(screen.getByText("Agregar"));
  assert.match(screen.getByRole("alert").textContent, /Elegí el proveedor/);
  fireEvent.change(screen.getByLabelText("Proveedor para pedir cotización"), { target: { value: "2" } });
  fireEvent.click(screen.getByText("Agregar"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], { accion: "oc_cotizacion_pedir", id: 101, proveedores: [2] });
  cleanup();

  enviados = mockPantalla({ sin125: true });
  render(<OrdenesCompra empresaId={E} empresa={{ nombre: "GI Group" }} />);
  fireEvent.click(await screen.findByText("OC N° 8 · A cotizar"));
  assert.match((await screen.findByText(/migración 125/)).textContent, /falta correr la migración 125/);
});
