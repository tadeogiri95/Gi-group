// tests/compras-otras-facturas.test.jsx — Finanzas, parte F2a (3; migración
// 173): una orden de compra facturada en partes por distintos proveedores.
// Cada otra factura es su propia compra en Finanzas, de su proveedor; se
// corrige y se anula con ella, y al anular la OC se anulan todas.
import "./helpers/domSetup.js";
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { faltaFacturar } from "../app/lib/ordenesCompra.js";
import { importesOtraFactura, sincronizarCompra } from "../app/lib/finanzasCompras.js";
import { comprasBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";
import { ORIGENES } from "../app/lib/finanzasOperaciones.js";
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
const ALUAR = { id: 1, nombre: "Aluar", activo: true };
const EGGER = { id: 2, nombre: "Egger", activo: true };
const OC = { id: 101, numero: 8, proveedor_id: 1, proveedor_nombre: "Aluar", estado: "recibida", moneda: "ARS", created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-02T12:00:00Z" };
const ITEMS = [
  { id: 1, orden_id: 101, sku: "3.3.1.6", descripcion: "Perfil 0277", unidad: "MT", cantidad: 12, precio_unitario: 1500, cantidad_recibida: 12, ot: "7961" },
  { id: 2, orden_id: 101, sku: "1.1.2", descripcion: "Placa MDF", unidad: "U", cantidad: 10, precio_unitario: 20000, cantidad_recibida: 10, ot: "7961" },
];
const OTRA = { id: 7, orden_id: 101, proveedor_id: 2, proveedor_nombre: "Egger", numero: "A-1-55", fecha: "2026-11-05", otros_impuestos: 500, renglones: [{ item_id: 2, descripcion: "Placa MDF", cantidad: 10, precio: 20000, iva: 21 }] };

// ─── Reglas ───

test("falta facturar — lo que llegó menos la factura de la OC y las otras", () => {
  assert.equal(faltaFacturar(ITEMS[1], OC, []), 10, "sin factura todavía");
  assert.equal(faltaFacturar(ITEMS[1], { ...OC, factura_numero: "B-1" }, []), 0, "la factura de la OC lleva lo que llegó");
  assert.equal(faltaFacturar({ ...ITEMS[1], cantidad_facturada: 0 }, { ...OC, factura_numero: "B-1" }, []), 10);
  assert.equal(faltaFacturar({ ...ITEMS[1], cantidad_facturada: 4 }, { ...OC, factura_numero: "B-1" }, [{ ...OTRA, renglones: [{ item_id: 2, cantidad: 3 }] }]), 3);
  assert.equal(faltaFacturar(ITEMS[1], OC, [OTRA], 7), 10, "al corregir no cuenta la misma");
  assert.equal(faltaFacturar(ITEMS[1], OC, [{ ...OTRA, anulada_at: "2026-11-06" }]), 10, "la anulada no cuenta");
});

test("importes — en pesos, con IVA por renglón y otros impuestos; la OT si es una sola", () => {
  const i = importesOtraFactura(OTRA, OC, ITEMS);
  assert.deepEqual([i.neto, i.iva, i.otros, i.total], [200000, 42000, 500, 242500]);
  assert.equal(i.ot, "7961");
  assert.match(i.descripcion, /A-1-55 · OC 8 \(otro proveedor\)/);
  assert.equal(importesOtraFactura({ ...OTRA, anulada_at: "2026-11-06" }, OC, ITEMS), null);
  assert.equal(importesOtraFactura(OTRA, { ...OC, estado: "anulada" }, ITEMS), null);
  assert.equal(importesOtraFactura(OTRA, { ...OC, moneda: "USD" }, ITEMS), null, "dólares sin tipo de cambio: todavía no");
  const usd = importesOtraFactura({ ...OTRA, tipo_cambio: 1000, otros_impuestos: 0, renglones: [{ item_id: 2, cantidad: 1, precio: 10, iva: 21 }] }, { ...OC, moneda: "USD" }, ITEMS);
  assert.equal(usd.total, 12100);
  assert.ok(ORIGENES.factura_oc_otra);
});

test("migración 173 — tabla con RLS, sin delete, y solo lectura por /api/data", () => {
  const sql = readFileSync(new URL("../supabase/migrations/173_oc_otras_facturas.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /create table if not exists public\.ordenes_compra_facturas/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /grant select, insert, update on public\.ordenes_compra_facturas to authenticated/);
  assert.equal(autorizar("ordenes_compra_facturas", "GET", { rol: "administrativo" }).ok, true);
  assert.equal(autorizar("ordenes_compra_facturas", "POST", { rol: "gerencial" }).ok, false);
  const ok = comprasBody.safeParse({ accion: "oc_otra_factura_guardar", id: 101, proveedor_id: 2, fecha: "2026-11-05", renglones: [{ item_id: 2, cantidad: 10, precio: 20000, iva: 21 }] });
  assert.equal(ok.success, true);
  assert.equal(ok.data.otros_impuestos, 0);
  assert.equal(comprasBody.safeParse({ accion: "oc_otra_factura_guardar", id: 101, proveedor_id: 2, fecha: "2026-11-05", renglones: [] }).success, false);
  assert.equal(comprasBody.safeParse({ accion: "oc_otra_factura_guardar", id: 101, proveedor_id: 2, fecha: "", renglones: [{ item_id: 2, cantidad: 1, precio: 1, iva: 21 }] }).success, false);
});

// ─── Ruta ───

function mockRuta({ oc = OC, otras = [OTRA], sin173 = false } = {}) {
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
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: (u) => ({ status: 200, body: [ALUAR, EGGER].filter((p) => new RegExp(`[?&]id=eq\\.${p.id}(&|$)`).test(u)).map((p) => ({ ...p, fin_tipo: null })) }) },
    { match: (u) => u.includes("/rest/v1/pedidos_compra"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/ordenes_compra_facturas"),
      respond: (u, o) => {
        if (sin173) return { status: 404, body: { code: "42P01", message: 'relation "public.ordenes_compra_facturas" does not exist' } };
        if (!o.method || o.method === "GET") return { status: 200, body: /[?&]id=eq\./.test(u) ? otras.filter((f) => u.includes(`id=eq.${f.id}&`)) : otras };
        const body = anotar("ordenes_compra_facturas", u, o);
        if (o.method === "PATCH") {
          const f = otras.find((x) => u.includes(`id=eq.${x.id}&`));
          return { status: 200, body: f ? [{ ...f, ...body }] : [] };
        }
        return { status: 201, body: [{ id: 8, ...body }] };
      },
    },
    { match: (u) => u.includes("/rest/v1/ordenes_compra_items"), respond: () => ({ status: 200, body: ITEMS }) },
    {
      match: (u) => u.includes("/rest/v1/ordenes_compra"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: oc ? [oc] : [] };
        const body = anotar("ordenes_compra", u, o);
        return { status: 200, body: [{ ...oc, ...body }] };
      },
    },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: (u, o) => { if (o.method && o.method !== "GET") anotar("fin_operaciones", u, o); return { status: 200, body: [] }; } },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => ({ status: 200, body: [{ codigo: "COMPRA MP", grupo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", activo: true }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [{ id: 9 }] }) },
  ]);
  return escrito;
}

async function token(rol = "gerencial") {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/compras", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const NUEVA = { accion: "oc_otra_factura_guardar", id: 101, proveedor_id: 2, numero: "A-1-55", fecha: "2026-11-05", otros_impuestos: 500, renglones: [{ item_id: 2, cantidad: 10, precio: 20000, iva: 21 }] };

test("/api/compras otra factura — guarda con el nombre del proveedor y la descripción del renglón", async () => {
  const escrito = mockRuta({ otras: [] });
  const res = await api.POST(req(await token(), NUEVA));
  assert.equal(res.status, 200);
  const [ins] = escrito.filter((x) => x.tabla === "ordenes_compra_facturas");
  assert.equal(ins.metodo, "POST");
  assert.deepEqual([ins.body.empresa_id, ins.body.orden_id, ins.body.proveedor_id, ins.body.proveedor_nombre, ins.body.cargada_por_nombre], [E, 101, 2, "Egger", "Laura Admin"]);
  assert.deepEqual(ins.body.renglones, [{ item_id: 2, descripcion: "Placa MDF", cantidad: 10, precio: 20000, iva: 21 }]);
  assert.equal(ins.body.tipo_cambio, null);
});

test("/api/compras otra factura — controles: renglón ajeno, proveedor que no existe, borrador y anulada", async () => {
  mockRuta();
  let res = await api.POST(req(await token(), { ...NUEVA, renglones: [{ item_id: 99, cantidad: 1, precio: 1, iva: 21 }] }));
  assert.equal(res.status, 409);
  mockRuta();
  res = await api.POST(req(await token(), { ...NUEVA, proveedor_id: 5 }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /no está en la lista/);
  mockRuta({ oc: { ...OC, estado: "borrador" } });
  assert.equal((await api.POST(req(await token(), NUEVA))).status, 409);
  mockRuta({ oc: { ...OC, estado: "anulada" } });
  assert.equal((await api.POST(req(await token(), NUEVA))).status, 409);
  mockRuta({ sin173: true });
  res = await api.POST(req(await token(), NUEVA));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 173/);
  mockRuta();
  assert.equal((await api.POST(req(await token("operativo"), NUEVA))).status, 403, "el operario no compra");
});

test("/api/compras otra factura — corregir y anular (no se borra)", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token(), { ...NUEVA, factura_id: 7, numero: "A-1-56" }));
  assert.equal(res.status, 200);
  const [upd] = escrito.filter((x) => x.tabla === "ordenes_compra_facturas");
  assert.equal(upd.metodo, "PATCH");
  assert.match(upd.url, /id=eq\.7&orden_id=eq\.101&.*anulada_at=is\.null/);
  assert.equal(upd.body.numero, "A-1-56");

  escrito = mockRuta();
  res = await api.POST(req(await token(), { accion: "oc_otra_factura_anular", factura_id: 7 }));
  assert.equal(res.status, 200);
  const [anu] = escrito.filter((x) => x.tabla === "ordenes_compra_facturas");
  assert.equal(anu.metodo, "PATCH");
  assert.ok(anu.body.anulada_at);
  assert.equal(anu.body.anulada_por_nombre, "Laura Admin");
  mockRuta({ otras: [] });
  assert.equal((await api.POST(req(await token(), { accion: "oc_otra_factura_anular", factura_id: 7 }))).status, 404);
});

// ─── Finanzas ───

test("Finanzas — la otra factura es una compra de su proveedor, con origen propio", async () => {
  mockRuta();
  const escrito = [];
  const viejo = global.fetch;
  global.fetch = async (u, o = {}) => {
    if (String(u).includes("/rest/v1/fin_operaciones") && o.method === "POST") escrito.push(JSON.parse(o.body));
    return viejo(u, o);
  };
  assert.deepEqual(await sincronizarCompra(E, { origen: "factura_oc_otra", id: 7 }), { accion: "creada" });
  const op = escrito[0];
  assert.deepEqual([op.origen, op.origen_id, op.proveedor_id, op.total, op.proyecto_id, op.tipo, op.estado], ["factura_oc_otra", "7", 2, 242500, 9, "COMPRA MP", "para_revisar"]);
});

test("Finanzas — al anular la OC se anulan también sus otras facturas", async () => {
  const escrito = mockRuta({ oc: { ...OC, estado: "enviada" } });
  const res = await api.POST(req(await token(), { accion: "oc_anular", id: 101 }));
  assert.equal(res.status, 200);
  assert.ok(escrito.some((x) => x.tabla === "ordenes_compra" && x.body.estado === "anulada"));
});

// ─── Pantalla ───

function mockPantalla({ otras = [], sin173 = false } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/compras")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const path = body?.path || "";
    if (sin173 && path.startsWith("ordenes_compra_facturas")) {
      return new Response(JSON.stringify({ error: 'relation "public.ordenes_compra_facturas" does not exist' }), { status: 404 });
    }
    const data = path.startsWith("proveedores") ? [ALUAR, EGGER]
      : path.startsWith("ordenes_compra_facturas") ? otras
        : path.startsWith("ordenes_compra_cotizaciones") ? []
          : path.startsWith("ordenes_compra_items") ? ITEMS
            : path.startsWith("ordenes_compra") ? [OC] : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return enviados;
}

test("Órdenes — ＋ Otra factura: elige proveedor, marca renglones y guarda", async () => {
  const enviados = mockPantalla();
  render(<OrdenesCompra empresaId={E} empresa={{ nombre: "GI Group" }} abrirId={101} />);
  fireEvent.click(await screen.findByText("＋ Otra factura"));
  fireEvent.click(screen.getByText("Guardar factura", { selector: ".g-btn-primary" }));
  assert.match(screen.getByRole("alert").textContent, /Elegí el proveedor/);
  await screen.findByRole("option", { name: "Egger" });
  fireEvent.change(screen.getByLabelText("Proveedor que facturó"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Fecha de factura", { selector: "#otra-fecha" }), { target: { value: "2026-11-05" } });
  fireEvent.change(screen.getByLabelText("N° de factura", { selector: "#otra-numero" }), { target: { value: "A-1-55" } });
  fireEvent.click(screen.getByLabelText("Placa MDF va en esta factura"));
  assert.equal(screen.getByLabelText("Cantidad de Placa MDF en la otra factura").value, "10", "propone lo que falta facturar");
  await waitFor(() => assert.ok(screen.getAllByText(/242\.000/).length));
  fireEvent.click(screen.getByText("Guardar factura", { selector: ".g-btn-primary" }));
  await waitFor(() => assert.equal(enviados.length, 1, screen.queryAllByRole("alert").map((a) => a.textContent).join(" | ")));
  assert.deepEqual(enviados[0], {
    accion: "oc_otra_factura_guardar", id: 101, factura_id: null, proveedor_id: 2, numero: "A-1-55", fecha: "2026-11-05",
    tipo_cambio: null, otros_impuestos: 0, renglones: [{ item_id: 2, cantidad: 10, precio: 20000, iva: 21 }],
  });
});

test("Órdenes — otras facturas: se ven con su total y se anulan en dos pasos; sin la 173 avisa", async () => {
  const enviados = mockPantalla({ otras: [OTRA] });
  render(<OrdenesCompra empresaId={E} empresa={{ nombre: "GI Group" }} abrirId={101} />);
  const lista = await screen.findByRole("list", { name: "Otras facturas" });
  assert.match(lista.textContent, /Egger · A-1-55/);
  assert.match(lista.textContent, /\$ 242\.500/);
  fireEvent.click(screen.getByText("Anular"));
  fireEvent.click(screen.getByText("Sí, anular"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], { accion: "oc_otra_factura_anular", factura_id: 7 });
  cleanup();

  mockPantalla({ sin173: true });
  render(<OrdenesCompra empresaId={E} empresa={{ nombre: "GI Group" }} abrirId={101} />);
  fireEvent.click(await screen.findByText("＋ Otra factura"));
  assert.match(screen.getByRole("alert").textContent, /migración 173/);
});
