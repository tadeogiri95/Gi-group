// tests/stock-desde-factura.test.jsx — Compra sin orden de compra → stock y
// aviso de ingreso repetido (parte 6 del plan Finanzas e Inventario, 11/11).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { avisoIngresoRepetido, ingresosDeFactura, marcaFacturaSuelta } from "../app/lib/stockIngresos.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const facturas = await import("../app/api/facturas-sueltas/route.js");
const movimientos = await import("../app/api/stock/movimientos/route.js");
const { default: MovimientosStock } = await import("../app/components/MovimientosStock.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const FACTURA = { id: 12, empresa_id: E, tipo: "factura", proveedor: "FAPLAC", numero: "0003-00012", fecha: "2026-11-10", moneda: "USD", tipo_cambio: 1000, anulada_at: null };
const RENGLONES = [
  { id: 1, descripcion: "Placa blanca 18", cantidad: 10, precio: 50, sku: "1.10", asociado_como: "nombre" },
  { id: 2, descripcion: "Flete", cantidad: 1, precio: 20, sku: null, asociado_como: null },
  { id: 3, descripcion: "Bolsa", cantidad: 1, precio: 1, sku: null, asociado_como: "descartado" },
];
const ARTICULOS = [{ sku: "1.10", nombre: "MELAMINA BLANCA 18MM", unidad: "UN", division: "PLACAS" }];

// ─── Reglas ───

test("ingresos de una factura — uno por renglón con artículo, en pesos sin IVA y marcados con la factura", () => {
  const { filas, sinArticulo } = ingresosDeFactura(FACTURA, RENGLONES, ARTICULOS, { empleado_id: EMP, legajo: 7, empleado_nombre: "Ana" });
  assert.equal(filas.length, 1);
  assert.deepEqual(
    [filas[0].tipo, filas[0].sku, filas[0].nombre, filas[0].cantidad, filas[0].precio_unitario, filas[0].proveedor, filas[0].comprobante, filas[0].notas, filas[0].empleado_nombre],
    ["ingreso", "1.10", "MELAMINA BLANCA 18MM", 10, 50000, "FAPLAC", "0003-00012", "Factura sin OC N° 12", "Ana"],
  );
  assert.equal(sinArticulo, 1, "el flete queda afuera; lo que no es del MRP no cuenta");
  assert.equal(marcaFacturaSuelta("12"), "Factura sin OC N° 12");
  assert.equal(avisoIngresoRepetido({ comprobante: "0003-00012", proveedor: "FAPLAC", notas: "OC N° 40", created_at: "2026-11-09T12:00:00Z" }),
    "Ya entró al stock el comprobante 0003-00012 de FAPLAC (OC N° 40, el 09/11/26).");
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (ruta, url, rol, body) => ruta.POST(new Request(url, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, body: JSON.stringify(body),
}));
const aFacturas = (rol, body) => pedir(facturas, "http://localhost/api/facturas-sueltas", rol, body);
const aMovimientos = (rol, body) => pedir(movimientos, "http://localhost/api/stock/movimientos", rol, body);

function mockApi({ factura = FACTURA, renglones = RENGLONES, yaEnStock = false, repetido = null } = {}) {
  const escrito = [];
  const leido = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ nombre: "Ana" }] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: [{ ...ARTICULOS[0], activo: true }] }) },
    { match: (u) => u.includes("/rest/v1/facturas_sueltas_renglones"), respond: () => ({ status: 200, body: renglones }) },
    {
      match: (u) => u.includes("/rest/v1/facturas_sueltas?"),
      respond: (u, o) => {
        if (o?.method === "PATCH") { escrito.push({ tabla: "facturas_sueltas", metodo: "PATCH" }); return { status: 200, body: [{ ...factura, anulada_at: "x" }] }; }
        return { status: 200, body: factura ? [factura] : [] };
      },
    },
    { match: (u) => u.includes("/rest/v1/precios_articulos"), respond: () => ({ status: 204 }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones") || u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/movimientos_stock"),
      respond: (u, o) => {
        const metodo = o?.method || "GET";
        if (metodo === "GET") {
          leido.push(decodeURIComponent(u));
          if (u.includes("notas=eq.")) return { status: 200, body: yaEnStock ? [{ id: 70 }] : [] };
          if (u.includes("comprobante=ilike.")) return { status: 200, body: repetido ? [repetido] : [] };
          return { status: 200, body: [] };
        }
        const body = JSON.parse(o.body);
        escrito.push({ tabla: "movimientos_stock", metodo, url: decodeURIComponent(u), body });
        return { status: metodo === "POST" ? 201 : 200, body: metodo === "PATCH" ? [{ id: 70 }, { id: 71 }] : (Array.isArray(body) ? body : [body]) };
      },
    },
  ]);
  return { escrito, leido };
}

const RECEPCION = { id: 8, proveedor: "FAPLAC", comprobante: "0003-00012", notas: "OC N° 40", created_at: "2026-11-09T12:00:00Z" };

test("/api/facturas-sueltas — 📦 Mandar al stock carga un ingreso por renglón con artículo", async () => {
  const { escrito, leido } = mockApi();
  const r = await aFacturas("administrativo", { accion: "stock", id: 12 });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual([d.cargados, d.sin_articulo], [1, 1]);
  const alta = escrito.find((x) => x.tabla === "movimientos_stock" && x.metodo === "POST");
  assert.deepEqual(alta.body.map((f) => [f.sku, f.cantidad, f.precio_unitario, f.notas, f.empresa_id]), [["1.10", 10, 50000, "Factura sin OC N° 12", E]]);
  assert.ok(leido.some((u) => /comprobante=ilike\.\*12\*/.test(u)), "mira si ya entró");
});

test("/api/facturas-sueltas — si ya llegó con una orden de compra avisa, y con forzar la manda igual", async () => {
  let { escrito } = mockApi({ repetido: RECEPCION });
  let r = await aFacturas("gerencial", { accion: "stock", id: 12 });
  let d = await r.json();
  assert.equal(r.status, 409);
  assert.equal(d.repetido, true);
  assert.match(d.error, /Ya entró al stock el comprobante 0003-00012 de FAPLAC \(OC N° 40/);
  assert.equal(escrito.filter((x) => x.tabla === "movimientos_stock").length, 0);
  ({ escrito } = mockApi({ repetido: RECEPCION }));
  r = await aFacturas("gerencial", { accion: "stock", id: 12, forzar: true });
  assert.equal(r.status, 200);
  assert.equal(escrito.filter((x) => x.tabla === "movimientos_stock").length, 1);
});

test("/api/facturas-sueltas — no se manda dos veces, ni sin artículos, ni una lista; operarios no", async () => {
  mockApi({ yaEnStock: true });
  let r = await aFacturas("gerencial", { accion: "stock", id: 12 });
  assert.deepEqual([r.status, (await r.json()).ya_en_stock], [409, true]);
  mockApi({ renglones: [RENGLONES[1]] });
  r = await aFacturas("gerencial", { accion: "stock", id: 12 });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /asocialos primero/);
  mockApi({ factura: { ...FACTURA, tipo: "lista" } });
  assert.equal((await aFacturas("gerencial", { accion: "stock", id: 12 })).status, 400);
  mockApi({ factura: { ...FACTURA, anulada_at: "2026-11-11" } });
  assert.equal((await aFacturas("gerencial", { accion: "stock", id: 12 })).status, 409);
  assert.equal((await aFacturas("operativo", { accion: "stock", id: 12 })).status, 403);
});

test("/api/facturas-sueltas — al anular la factura sus materiales salen del stock", async () => {
  const { escrito } = mockApi();
  const r = await aFacturas("gerencial", { accion: "anular", id: 12 });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.stock_anulados, 2);
  const baja = escrito.find((x) => x.tabla === "movimientos_stock" && x.metodo === "PATCH");
  assert.match(baja.url, /notas=eq\.Factura sin OC N° 12/);
  assert.equal(baja.body.anulado, true);
});

test("/api/stock/movimientos — un ingreso a mano con un comprobante que ya entró avisa; con forzar se carga", async () => {
  const ingreso = { accion: "registrar", tipo: "ingreso", sku: "1.10", cantidad: 10, proveedor: "Faplac", comprobante: "0003-00012" };
  let { escrito } = mockApi({ repetido: RECEPCION });
  let r = await aMovimientos("administrativo", ingreso);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /OC N° 40/);
  assert.equal(escrito.length, 0);
  ({ escrito } = mockApi({ repetido: RECEPCION }));
  r = await aMovimientos("administrativo", { ...ingreso, forzar: true });
  assert.equal(r.status, 200);
  assert.equal(escrito.length, 1);
  ({ escrito } = mockApi());
  assert.equal((await aMovimientos("administrativo", { ...ingreso, comprobante: null })).status, 200, "sin comprobante no hay con qué comparar");
});

// ─── Pantallas ───

test("Stock — el ingreso repetido se confirma antes de cargarlo", async () => {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/stock/movimientos")) {
      enviados.push(body);
      if (!body.forzar) return new Response(JSON.stringify({ error: "Ya entró al stock el comprobante 0003-00012 de FAPLAC (OC N° 40, el 09/11/26).", repetido: true }), { status: 409 });
      return new Response(JSON.stringify({ ok: true, movimiento: { id: 9, ...body } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  const preguntas = [];
  const confirmar = globalThis.window.confirm;
  globalThis.window.confirm = (t) => { preguntas.push(t); return preguntas.length > 1; };
  try {
    render(<MovimientosStock usuario={{ id: EMP, rol: "administrativo" }} articulos={[{ ...ARTICULOS[0], activo: true }]} />);
    fireEvent.click(screen.getByText("＋ Cargar retiro, devolución, ingreso o ajuste"));
    fireEvent.change(screen.getByLabelText("Artículo"), { target: { value: "melamina" } });
    fireEvent.click(screen.getByText("MELAMINA BLANCA 18MM"));
    fireEvent.change(screen.getByLabelText("Cantidad (UN)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("N° de comprobante"), { target: { value: "0003-00012" } });
    fireEvent.click(screen.getByText("Guardar"));
    await waitFor(() => assert.match(screen.getByRole("alert").textContent, /no hace falta cargarlo de nuevo/));
    assert.equal(enviados.length, 1, "dijo que no: no se cargó");
    fireEvent.click(screen.getByText("Guardar"));
    await waitFor(() => assert.equal(enviados.length, 3));
    assert.equal(enviados[2].forzar, true);
    assert.match(preguntas[1], /¿Es otro ingreso y lo querés cargar igual\?/);
  } finally {
    globalThis.window.confirm = confirmar;
  }
});

test("Compras → Facturas: el botón 📦 Mandar al stock y el aviso en Cargar gasto de Finanzas", () => {
  const fs = readFileSync(new URL("../app/components/FacturasSueltas.jsx", import.meta.url), "utf8");
  assert.match(fs, /📦 Mandar al stock/);
  assert.match(fs, /📦 En el stock/);
  const gasto = readFileSync(new URL("../app/components/FinanzasCargarGasto.jsx", import.meta.url), "utf8");
  assert.match(gasto, /aria-label="Materiales al stock"/);
});
