// tests/compras-cierre-faltantes.test.jsx — Compras (ítem 41, migración 123):
// una OC recibida en parte se cierra con faltantes. Lo que no llegó no va a
// venir: la OC deja de contar como abierta y lo que faltó de cada pedido de
// un jefe vuelve a "A comprar".
import "./helpers/domSetup.js";
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { ESTADOS_OC, ESTADOS_OC_ABIERTA, ESTADOS_OC_RECIBIBLE, lineasAComprar, pedidosAlCerrar, htmlOrdenCompra } from "../app/lib/ordenesCompra.js";
import { comprasBody } from "../app/lib/schemas.ts";
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
const OC = { id: 101, numero: 12, proveedor_id: 1, proveedor_nombre: "Miguel Ángel Papa", estado: "recibida_parcial", moneda: "ARS", enviada_at: "2026-10-17T12:00:00Z", created_at: "2026-10-17T12:00:00Z" };
// Llegó entero, llegó una parte, no llegó nada y uno del MRP sin pedido
const ITEMS = [
  { id: 1, orden_id: 101, sku: "A", descripcion: "Bisagra", unidad: "u", cantidad: 10, cantidad_recibida: 10, pedido_id: 5 },
  { id: 2, orden_id: 101, sku: "B", descripcion: "Perfil", unidad: "MT", cantidad: 12, cantidad_recibida: 5, pedido_id: 6 },
  { id: 3, orden_id: 101, sku: null, descripcion: "Tornillos", unidad: "cajas", cantidad: 2, cantidad_recibida: 0, pedido_id: 7 },
  { id: 4, orden_id: 101, sku: "C", descripcion: "Placa", unidad: "u", cantidad: 3, cantidad_recibida: 1, pedido_id: null },
];
const PEDIDO_6 = { id: 6, sku: "B", descripcion: "Perfil", unidad: "MT", cantidad: 12, ot: "M-7495", para_fecha: "2026-10-25", notas: "anodizado", division: "ALUMINIO", estado: "en_oc", empleado_id: EMP, empleado_nombre: "Pedro Jefe" };

test("reglas — qué pasa con cada pedido al cerrar", () => {
  assert.deepEqual(pedidosAlCerrar(ITEMS), { completos: [5], volver: [7], nuevos: [{ pedido_id: 6, cantidad: 7 }] });
  assert.equal(ESTADOS_OC.cerrada_faltantes.nombre, "Cerrada con faltantes");
  assert.equal(ESTADOS_OC_ABIERTA.includes("cerrada_faltantes"), false, "no cuenta como OC abierta en la planilla");
  assert.equal(ESTADOS_OC_RECIBIBLE.includes("cerrada_faltantes"), false, "no se recibe más");
  const [l] = lineasAComprar({ pedidos: [{ id: 9, estado: "pendiente", descripcion: "Perfil", cantidad: 7, empleado_nombre: "Pedro", faltante_de: "OC N° 12 · Miguel Ángel Papa" }] });
  assert.match(l.detalle, /faltó de la OC N° 12 · Miguel Ángel Papa/);
  const html = htmlOrdenCompra({ oc: { ...OC, estado: "cerrada_faltantes", cerrada_motivo: "sin stock", cerrada_at: "2026-10-21T15:00:00Z" }, items: ITEMS });
  assert.match(html, /Cerrada con faltantes el 21\/10\/2026/);
});

test("validación y migración 123", () => {
  const ok = (b) => comprasBody.safeParse(b).success;
  assert.equal(ok({ accion: "oc_cerrar_faltantes", id: 101, motivo: "El proveedor no tenía" }), true);
  assert.equal(ok({ accion: "oc_cerrar_faltantes", id: 101, motivo: " " }), false, "el motivo es obligatorio");
  assert.equal(ok({ accion: "oc_cerrar_faltantes", id: 101 }), false);
  const sql = readFileSync(new URL("../supabase/migrations/123_oc_cerrar_faltantes.sql", import.meta.url), "utf8");
  assert.match(sql, /'cerrada_faltantes'/);
  for (const col of ["cerrada_motivo", "cerrada_por", "cerrada_por_nombre", "cerrada_at", "faltante_de"]) assert.match(sql, new RegExp(`add column if not exists ${col}`));
  assert.match(sql, /^do \$mig\$/m);
});

function mockRuta({ oc = OC, items = ITEMS, pedidos = [PEDIDO_6], fallaPatch = null } = {}) {
  const escrito = [];
  const tabla = (nombre, leer) => ({
    match: (u) => u.includes(`/rest/v1/${nombre}?`) || u.endsWith(`/rest/v1/${nombre}`),
    respond: (u, o) => {
      if (!o.method || o.method === "GET") return { status: 200, body: leer(u) };
      if (fallaPatch && o.method === "PATCH") return { status: 400, body: { code: "PGRST204", message: fallaPatch } };
      const body = o.body ? JSON.parse(o.body) : null;
      escrito.push({ tabla: nombre, metodo: o.method, url: u, body });
      return { status: o.method === "POST" ? 201 : 200, body: Array.isArray(body) ? body : [{ ...oc, ...body }] };
    },
  });
  global.fetch = createFetchMock([
    {
      match: (u) => u.includes("/rest/v1/empleados"),
      respond: (u) => u.includes("solo_su_division")
        ? { status: 200, body: [{ id: EMP, legajo: 7, division: null, solo_su_division: false }] }
        : u.includes("select=id,legajo") ? { status: 200, body: [{ id: EMP, legajo: 7 }] } : { status: 200, body: [{ nombre: "Tadeo" }] },
    },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    tabla("ordenes_compra_items", () => items.map((it) => ({ ...it }))),
    tabla("ordenes_compra", () => (oc ? [oc] : [])),
    tabla("pedidos_compra", () => pedidos),
  ]);
  return escrito;
}

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const req = (t, body) => new Request("http://localhost/api/compras", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/compras oc_cerrar_faltantes — cierra con motivo y lo que faltó vuelve a A comprar", async () => {
  const escrito = mockRuta();
  const res = await api.POST(req(await token("gerencial"), { accion: "oc_cerrar_faltantes", id: 101, motivo: "No tenía stock" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).vuelven, 2);
  const cab = escrito.find((x) => x.tabla === "ordenes_compra");
  assert.match(cab.url, /estado=in\.\(recibida_parcial\)/);
  assert.deepEqual({ estado: cab.body.estado, motivo: cab.body.cerrada_motivo, por: cab.body.cerrada_por, nombre: cab.body.cerrada_por_nombre },
    { estado: "cerrada_faltantes", motivo: "No tenía stock", por: EMP, nombre: "Tadeo" });
  const volver = escrito.find((x) => x.tabla === "pedidos_compra" && x.body.estado === "pendiente" && x.metodo === "PATCH");
  assert.match(volver.url, /id=in\.\(7\)&estado=eq\.en_oc/);
  assert.deepEqual(volver.body, { estado: "pendiente", orden_id: null, faltante_de: "OC N° 12 · Miguel Ángel Papa" });
  const recibidos = escrito.find((x) => x.tabla === "pedidos_compra" && x.body.estado === "recibido");
  assert.match(recibidos.url, /id=in\.\(5,6\)/);
  const [nuevo] = escrito.find((x) => x.tabla === "pedidos_compra" && x.metodo === "POST").body;
  assert.deepEqual(
    { cantidad: nuevo.cantidad, sku: nuevo.sku, ot: nuevo.ot, estado: nuevo.estado, quien: nuevo.empleado_nombre, de: nuevo.faltante_de, notas: nuevo.notas },
    { cantidad: 7, sku: "B", ot: "M-7495", estado: "pendiente", quien: "Pedro Jefe", de: "OC N° 12 · Miguel Ángel Papa", notas: "anodizado" },
  );
});

test("/api/compras oc_cerrar_faltantes — sin nada recibido se anula; supervisor no; sin migración avisa", async () => {
  let escrito = mockRuta({ oc: { ...OC, estado: "enviada" } });
  let res = await api.POST(req(await token("gerencial"), { accion: "oc_cerrar_faltantes", id: 101, motivo: "x" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /anulala/);
  assert.equal(escrito.length, 0);

  escrito = mockRuta();
  const fetchBase = global.fetch;
  global.fetch = (u, o) => (String(u).includes("solo_su_division")
    ? Promise.resolve(new Response(JSON.stringify([{ id: EMP, legajo: 7, division: "ALUMINIO", solo_su_division: true }]), { status: 200, headers: { "Content-Type": "application/json" } }))
    : fetchBase(u, o));
  res = await api.POST(req(await token("administrativo"), { accion: "oc_cerrar_faltantes", id: 101, motivo: "x" }));
  assert.equal(res.status, 403, "el jefe de taller no cierra órdenes");
  assert.equal(escrito.length, 0);

  _limpiarCacheAlcance();
  mockRuta({ fallaPatch: "Could not find the 'cerrada_motivo' column of 'ordenes_compra' in the schema cache" });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_cerrar_faltantes", id: 101, motivo: "x" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 123/);
});

test("pantalla — Cerrar con faltantes pide motivo y muestra lo que no llegó", async () => {
  const posts = [];
  let oc = { ...OC };
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/compras")) {
      posts.push(body);
      oc = { ...oc, estado: "cerrada_faltantes", cerrada_motivo: "No tenía stock", cerrada_por_nombre: "Tadeo", cerrada_at: "2026-10-21T15:00:00Z" };
      return new Response(JSON.stringify({ ok: true, vuelven: 2 }), { status: 200 });
    }
    const path = body?.path || "";
    const data = path.startsWith("ordenes_compra_items") ? ITEMS : path.startsWith("ordenes_compra") ? [oc] : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  render(<OrdenesCompra empresaId={E} />);
  fireEvent.click(await screen.findByText("OC N° 12 · Miguel Ángel Papa"));
  fireEvent.click(await screen.findByRole("button", { name: /Cerrar con faltantes/ }));
  const faltan = screen.getByRole("list", { name: "Lo que no llegó" });
  assert.match(faltan.textContent, /Perfil: faltan 7/);
  assert.match(faltan.textContent, /Tornillos: faltan 2/);
  assert.doesNotMatch(faltan.textContent, /Bisagra/);
  fireEvent.click(screen.getByRole("button", { name: "Cerrar orden" }));
  assert.match((await screen.findByRole("alert")).textContent, /por qué/);
  assert.equal(posts.length, 0);
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "No tenía stock" } });
  fireEvent.click(screen.getByRole("button", { name: "Cerrar orden" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.deepEqual(posts[0], { accion: "oc_cerrar_faltantes", id: 101, motivo: "No tenía stock" });
  assert.ok(await screen.findByText(/2 pedidos volvieron a "A comprar"/));
  assert.ok(await screen.findByText(/Cerrada con faltantes por Tadeo/));
});
