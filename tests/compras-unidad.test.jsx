// tests/compras-unidad.test.jsx — Unidad de compra en las órdenes de compra
// (Compras, ítem 41; migración 152): al proveedor se le pide en cajas, rollos
// o metros aunque el stock lleve otra unidad, y al recibir entra al stock
// convertido.
import "./helpers/domSetup.js";
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  factorItem, cantidadEnStock, precioEnStock, convertirUnidad, equivalenciaStock, ultimaUnidadPorSku, lineasAComprar, pedidosAlCerrar,
  textoOrdenCompra,
} from "../app/lib/ordenesCompra.js";
import { ordenesParaPlanilla } from "../app/lib/planillaMrp.js";
import { comprasBody } from "../app/lib/schemas.ts";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";
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
const { default: AComprar } = await import("../app/components/AComprar.jsx");
const { default: OrdenesCompra } = await import("../app/components/OrdenesCompra.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const ALUAR = { id: 1, nombre: "Aluar", activo: true, contacto: "Marta", whatsapp: "11 2345 6789" };
const TORNILLO = { sku: "5.1.1", nombre: "Tornillo 4x40", unidad: "unidades", semaforo: "🔴 URGENTE", sugerido: 120, multiplo: null, ultimo_precio: 10, activo: true };
// 4 cajas de 50 tornillos a $500 la caja
const RENGLON = { id: 1, orden_id: 101, sku: "5.1.1", descripcion: "Tornillo 4x40", unidad: "caja", unidad_stock: "unidades", factor: 50, cantidad: 4, precio_unitario: 500, cantidad_recibida: 0, ot: null, pedido_id: 5 };

// ─── Reglas ───

test("conversión: cantidad y precio pasan de la unidad de compra a la del stock", () => {
  assert.equal(factorItem({}), 1, "sin la 152 es la misma unidad");
  assert.equal(factorItem({ factor: 0 }), 1);
  assert.equal(factorItem(RENGLON), 50);
  assert.equal(cantidadEnStock(3, RENGLON), 150);
  assert.equal(cantidadEnStock(2.5, { factor: 0.1 }), 0.25, "sin errores de coma flotante");
  assert.equal(precioEnStock(500, RENGLON), 10);
  assert.equal(precioEnStock(null, RENGLON), null);
  assert.equal(equivalenciaStock(3, RENGLON), "= 150 unidades al stock");
  assert.equal(equivalenciaStock(null, RENGLON), "1 caja = 50 unidades");
  assert.equal(equivalenciaStock(3, { unidad: "MT" }), "", "en la misma unidad no dice nada");
  // 120 unidades a $10 → 2,4 cajas de 50 a $500; y de vuelta
  assert.deepEqual(convertirUnidad({ cantidad: 120, precio: 10 }, 50), { cantidad: 2.4, precio: 500 });
  assert.deepEqual(convertirUnidad({ cantidad: 2.4, precio: 500, factor: 50 }, 1), { cantidad: 120, precio: 10 });
  assert.deepEqual(convertirUnidad({ cantidad: null, precio: null }, 50), { cantidad: null, precio: null });
});

test("A comprar recuerda la última unidad de compra de cada artículo", () => {
  const items = [
    { sku: "5.1.1", unidad: "caja", factor: 50, unidad_stock: "unidades" },
    { sku: "5.1.1", unidad: "unidades", factor: 1 },
    { sku: "3.3.1.6", unidad: "MT", factor: 1 },
  ];
  const recordadas = ultimaUnidadPorSku(items);
  assert.deepEqual([...recordadas.keys()], ["5.1.1"], "solo se recuerda si era otra unidad");
  assert.equal(ultimaUnidadPorSku([{ sku: "5.1.1", unidad: "unidades", factor: 1 }, ...items]).size, 0, "la más nueva manda");

  const [l] = lineasAComprar({ articulos: [TORNILLO], unidadPorSku: recordadas });
  assert.deepEqual(
    { unidad: l.unidad, unidad_base: l.unidad_base, factor: l.factor, unidad_stock: l.unidad_stock, cantidad: l.cantidad, precio: l.precio_unitario },
    { unidad: "caja", unidad_base: "unidades", factor: 50, unidad_stock: "unidades", cantidad: 2.4, precio: 500 },
  );
  const [sin] = lineasAComprar({ articulos: [TORNILLO] });
  assert.deepEqual({ unidad: sin.unidad, factor: sin.factor, unidad_stock: sin.unidad_stock, cantidad: sin.cantidad }, { unidad: "unidades", factor: 1, unidad_stock: null, cantidad: 120 });
  // Si la planilla cambió la unidad del artículo, no se propone la vieja conversión
  const [otra] = lineasAComprar({ articulos: [{ ...TORNILLO, unidad: "kg" }], unidadPorSku: recordadas });
  assert.equal(otra.factor, 1);
});

test("lo que falta vuelve a A comprar y va a la planilla en la unidad del stock", () => {
  const recibido = { ...RENGLON, cantidad_recibida: 3 };
  assert.deepEqual(pedidosAlCerrar([recibido]).nuevos, [{ pedido_id: 5, cantidad: 50 }], "falta 1 caja = 50 unidades");
  const [fila] = ordenesParaPlanilla([{ id: 101, numero: 8, proveedor_nombre: "Aluar", estado: "enviada", created_at: "2026-11-02T12:00:00Z" }], [recibido], "America/Argentina/Buenos_Aires");
  assert.equal(fila.cantidad, 50);
});

test("la OC le pide al proveedor en la unidad de compra", () => {
  const texto = textoOrdenCompra({ empresa: "GI Group", oc: { numero: 8, moneda: "ARS", proveedor_nombre: "Aluar" }, items: [RENGLON], proveedor: ALUAR });
  assert.match(texto, /• 4 caja Tornillo 4x40/);
});

test("validación — unidad de compra al armar y al corregir la OC", () => {
  const ok = (b) => comprasBody.safeParse(b).success;
  const linea = { proveedor_id: 1, sku: "5.1.1", descripcion: "Tornillo", unidad: "caja", cantidad: 4, precio_unitario: 500, factor: 50, unidad_stock: "unidades" };
  assert.equal(ok({ accion: "oc_crear", lineas: [linea] }), true);
  assert.equal(comprasBody.parse({ accion: "oc_crear", lineas: [{ ...linea, factor: undefined }] }).lineas[0].factor, 1, "sin factor es la misma unidad");
  assert.equal(ok({ accion: "oc_crear", lineas: [{ ...linea, factor: 0 }] }), false);
  assert.equal(ok({ accion: "oc_crear", lineas: [{ ...linea, factor: -2 }] }), false);
  assert.equal(ok({ accion: "oc_guardar", id: 101, items: [{ id: 1, cantidad: 4, precio_unitario: 500, unidad: "caja", factor: 50, unidad_stock: "unidades" }] }), true);
  assert.equal(ok({ accion: "oc_guardar", id: 101, items: [{ id: 1, cantidad: 4, precio_unitario: 500, unidad: "x".repeat(21), factor: 50 }] }), false);
});

test("migración 152 — columnas en los renglones y la recepción convierte al stock", () => {
  const sql = readFileSync(new URL("../supabase/migrations/152_unidad_compra_oc.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists factor numeric not null default 1/);
  assert.match(sql, /add column if not exists unidad_stock text/);
  assert.match(sql, /check \(factor > 0/);
  assert.match(sql, /create or replace function public\.compras_recibir\(/);
  assert.match(sql, /round\(v_cantidad \* v_factor, 3\)/, "al stock entra cantidad × factor");
  assert.match(sql, /create or replace function public\.compras_factura\(/);
  assert.match(sql, /round\(v_l\.cantidad \* v_l\.factor, 3\)/);
  assert.match(sql, /v_l\.precio_unitario \/ v_l\.factor/, "el precio del ingreso va por unidad de stock");
  assert.match(sql, /grant execute on function public\.compras_recibir\(uuid, bigint, jsonb, jsonb\) to service_role/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.ok(MIGRACIONES.some((m) => m.n === 152 && m.tablas.ordenes_compra_items.includes("factor")), "el chequeo de la base la conoce");
});

// ─── Ruta ───

function mockRuta({ items = [RENGLON], faltaColumna = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    {
      match: (u) => u.includes("/rest/v1/rpc/compras_"),
      respond: (u, o) => {
        const body = JSON.parse(o.body);
        escrito.push({ tabla: `rpc:${u.split("/rpc/")[1]}`, body });
        return { status: 200, body: { ok: true, recepcion: { id: 77 }, estado: "recibida_parcial", ingresos: 1 } };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/empleados"),
      respond: (u) => u.includes("solo_su_division")
        ? { status: 200, body: [{ id: EMP, legajo: 7, division: null, solo_su_division: false }] }
        : u.includes("select=id,legajo") ? { status: 200, body: [{ id: EMP, legajo: 7 }] } : { status: 200, body: [{ nombre: "Laura Admin" }] },
    },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: [ALUAR] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: [{ sku: "5.1.1", nombre: "Tornillo 4x40", unidad: "unidades", division: null }] }) },
    { match: (u) => u.includes("/rest/v1/pedidos_compra"), respond: (u, o) => ({ status: 200, body: o.method === "GET" || !o.method ? [{ id: 5, estado: "pendiente", notas: null }] : [] }) },
    {
      match: (u) => u.includes("/rest/v1/ordenes_compra_items"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: items };
        if (faltaColumna && String(o.body).includes("factor")) {
          return { status: 400, body: { code: "PGRST204", message: "Could not find the 'factor' column of 'ordenes_compra_items' in the schema cache" } };
        }
        const body = JSON.parse(o.body);
        escrito.push({ tabla: "ordenes_compra_items", metodo: o.method, body });
        return { status: 201, body: Array.isArray(body) ? body : [body] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/ordenes_compra"),
      respond: (u, o) => {
        const oc = { id: 101, numero: 8, proveedor_id: 1, proveedor_nombre: "Aluar", estado: "enviada", moneda: "ARS" };
        if (!o.method || o.method === "GET") return { status: 200, body: u.includes("order=numero.desc") ? [{ numero: 7 }] : [oc] };
        const body = JSON.parse(o.body);
        escrito.push({ tabla: "ordenes_compra", metodo: o.method, body });
        return { status: 201, body: [{ ...oc, ...body, id: 101 }] };
      },
    },
  ]);
  return escrito;
}

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const req = (t, body) => new Request("http://localhost/api/compras", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/compras oc_crear — el renglón en cajas guarda cuántas unidades trae cada una", async () => {
  const escrito = mockRuta();
  const res = await api.POST(req(await token("gerencial"), {
    accion: "oc_crear",
    lineas: [
      { proveedor_id: 1, sku: "5.1.1", descripcion: "Tornillo 4x40", unidad: "caja", cantidad: 4, precio_unitario: 500, factor: 50, unidad_stock: "unidades", pedido_id: 5 },
      { proveedor_id: 1, sku: "3.3.1.6", descripcion: "Perfil", unidad: "MT", cantidad: 12, precio_unitario: null },
    ],
  }));
  assert.equal(res.status, 200);
  const filas = escrito.find((x) => x.tabla === "ordenes_compra_items").body;
  assert.deepEqual([filas[0].unidad, filas[0].factor, filas[0].unidad_stock], ["caja", 50, "unidades"]);
  assert.equal("factor" in filas[1], false, "en la misma unidad no manda columnas nuevas (anda sin la 152)");
});

test("/api/compras — sin la migración 152 lo dice al comprar en otra unidad", async () => {
  mockRuta({ faltaColumna: true });
  const res = await api.POST(req(await token("gerencial"), {
    accion: "oc_crear", lineas: [{ proveedor_id: 1, sku: "5.1.1", descripcion: "Tornillo 4x40", unidad: "caja", cantidad: 4, factor: 50, unidad_stock: "unidades" }],
  }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 152/);
});

test("/api/compras recepcion_crear — 3 cajas se reciben en cajas y el ingreso va por unidad del stock", async () => {
  const escrito = mockRuta();
  const res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 3 }] }));
  assert.equal(res.status, 200);
  const [linea] = escrito.find((x) => x.tabla === "rpc:compras_recibir").body.p_lineas;
  assert.equal(linea.cantidad, 3, "lo recibido queda en cajas (la base lo multiplica por 50)");
  assert.equal(linea.ingreso.unidad, "unidades");
  assert.equal(linea.ingreso.precio_unitario, 10, "$500 la caja ÷ 50");
});

test("/api/compras oc_guardar — cambiar la unidad de un renglón en borrador", async () => {
  const escrito = mockRuta();
  global.fetch = ((orig) => async (u, o = {}) => {
    // La OC está en borrador
    if (String(u).includes("/rest/v1/ordenes_compra?") && (!o.method || o.method === "GET") && !String(u).includes("numero.desc")) {
      return new Response(JSON.stringify([{ id: 101, numero: 8, proveedor_id: 1, proveedor_nombre: "Aluar", estado: "borrador", moneda: "ARS" }]), { status: 200 });
    }
    return orig(u, o);
  })(global.fetch);
  const res = await api.POST(req(await token("gerencial"), { accion: "oc_guardar", id: 101, items: [{ id: 1, cantidad: 2.4, precio_unitario: 500, unidad: "caja", factor: 50, unidad_stock: "unidades" }] }));
  assert.equal(res.status, 200);
  const patch = escrito.find((x) => x.tabla === "ordenes_compra_items" && x.metodo === "PATCH").body;
  assert.deepEqual(patch, { cantidad: 2.4, precio_unitario: 500, unidad: "caja", factor: 50, unidad_stock: "unidades" });
});

// ─── Pantallas ───

function mockPantalla({ ordenes = [], items = [], pedidos = [], articulos = [TORNILLO], proveedores = [ALUAR] } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/compras")) {
      enviados.push(body);
      if (body.accion === "oc_crear") return new Response(JSON.stringify({ ok: true, ordenes: [{ id: 101, numero: 8, proveedor_nombre: "Aluar" }] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const path = body?.path || "";
    const data = path.startsWith("articulos_stock") ? articulos
      : path.startsWith("pedidos_compra") ? pedidos
        : path.startsWith("proveedores") ? proveedores
          : path.startsWith("ordenes_compra_items") ? items
            : path.startsWith("ordenes_compra") ? ordenes : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return enviados;
}

test("A comprar — cambia a cajas de 50: convierte cantidad y precio y arma la OC en cajas", async () => {
  const enviados = mockPantalla();
  render(<AComprar empresaId={E} />);
  fireEvent.click(await screen.findByLabelText("Comprar Tornillo 4x40"));
  assert.equal(screen.getByLabelText("Cantidad de Tornillo 4x40").value, "120");
  assert.ok(screen.getByText("📏 Se compra en unidades"));
  fireEvent.click(screen.getByLabelText("Cambiar unidad de Tornillo 4x40"));
  fireEvent.change(screen.getByLabelText("Unidad de compra"), { target: { value: "caja" } });
  fireEvent.change(screen.getByLabelText("¿Cuántas unidades trae cada una?"), { target: { value: "50" } });
  fireEvent.click(screen.getByText("Usar esta unidad"));
  assert.equal(screen.getByLabelText("Cantidad de Tornillo 4x40").value, "2,4");
  assert.equal(screen.getByLabelText("Precio sin IVA de Tornillo 4x40").value, "500");
  assert.ok(screen.getByText("Cantidad (caja)"));
  assert.ok(screen.getByText("Precio por caja sin IVA"));
  assert.ok(screen.getByText("= 120 unidades al stock"));
  fireEvent.change(screen.getByLabelText("Cantidad de Tornillo 4x40"), { target: { value: "3" } });
  assert.ok(screen.getByText("= 150 unidades al stock"));
  fireEvent.change(screen.getByLabelText("Proveedor de Tornillo 4x40"), { target: { value: "1" } });
  fireEvent.click(screen.getByText("Armar órdenes de compra"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0].lineas[0], {
    proveedor_id: 1, sku: "5.1.1", descripcion: "Tornillo 4x40", unidad: "caja", cantidad: 3, precio_unitario: 500, pedido_id: null, ot: null,
    factor: 50, unidad_stock: "unidades",
  });
});

test("A comprar — sin unidad o sin cuántas trae, avisa y no cambia", async () => {
  mockPantalla();
  render(<AComprar empresaId={E} />);
  fireEvent.click(await screen.findByLabelText("Comprar Tornillo 4x40"));
  fireEvent.click(screen.getByLabelText("Cambiar unidad de Tornillo 4x40"));
  fireEvent.click(screen.getByText("Usar esta unidad"));
  assert.ok(screen.getByText(/Poné la unidad de compra/));
  fireEvent.change(screen.getByLabelText("Unidad de compra"), { target: { value: "caja" } });
  fireEvent.click(screen.getByText("Usar esta unidad"));
  assert.ok(screen.getByText("Poné cuántas unidades trae cada caja"));
  assert.equal(screen.getByLabelText("Cantidad de Tornillo 4x40").value, "120");
});

test("Órdenes — en borrador se pasa un renglón a cajas y se guarda con la conversión", async () => {
  const ordenes = [{ id: 101, numero: 8, proveedor_id: 1, proveedor_nombre: "Aluar", estado: "borrador", moneda: "ARS", created_at: "2026-11-02T12:00:00Z" }];
  const items = [{ id: 1, orden_id: 101, sku: "5.1.1", descripcion: "Tornillo 4x40", unidad: "unidades", factor: 1, unidad_stock: null, cantidad: 200, precio_unitario: 10, cantidad_recibida: 0 }];
  const enviados = mockPantalla({ ordenes, items });
  render(<OrdenesCompra empresaId={E} empresa={{ nombre: "GI Group" }} />);
  fireEvent.click(await screen.findByText("OC N° 8 · Aluar"));
  fireEvent.click(await screen.findByLabelText("Cambiar unidad de Tornillo 4x40"));
  fireEvent.change(screen.getByLabelText("Unidad de compra"), { target: { value: "caja" } });
  fireEvent.change(screen.getByLabelText("¿Cuántas unidades trae cada una?"), { target: { value: "50" } });
  fireEvent.click(screen.getByText("Usar esta unidad"));
  assert.equal(screen.getByLabelText("Cantidad de Tornillo 4x40").value, "4");
  assert.equal(screen.getByLabelText("Precio sin IVA de Tornillo 4x40").value, "500");
  assert.ok(screen.getByText("= 200 unidades al stock"));
  assert.ok(screen.getByText("Total sin IVA: $ 2.000"), "el total no cambia");
  assert.match(decodeURIComponent(screen.getByText("💬 WhatsApp").getAttribute("href")), /• 4 caja Tornillo 4x40/);
  fireEvent.click(screen.getByText("Guardar cambios"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0].items, [{ id: 1, cantidad: 4, precio_unitario: 500, unidad: "caja", factor: 50, unidad_stock: "unidades" }]);
});
