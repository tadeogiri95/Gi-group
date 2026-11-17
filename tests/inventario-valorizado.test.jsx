// tests/inventario-valorizado.test.jsx — Materiales → 📊 Inventario (pedido de
// Tadeo 17/11; migración 196): stock valorizado a una fecha con el último
// precio de compra sin IVA, y cargar ingresos y consumos a la vista.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  deshacerMovimientos, efectoMovimiento, fechaValida, filtrarInventario, finDelDia, inventarioXlsx, sumaValor, ultimoPrecioHasta, valorizar,
} from "../app/lib/inventarioValorizado.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/stock/inventario/route.js");
const { default: InventarioScreen, textoOrigen } = await import("../app/components/InventarioScreen.jsx");
const { default: MovimientosStock } = await import("../app/components/MovimientosStock.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

// ─── Reglas ───

test("movimientos — ingreso y devolución suman, consumo resta, ajuste con su signo, anulado nada", () => {
  assert.equal(efectoMovimiento({ tipo: "ingreso", cantidad: 10 }), 10);
  assert.equal(efectoMovimiento({ tipo: "devolucion", cantidad: 2 }), 2);
  assert.equal(efectoMovimiento({ tipo: "consumo", cantidad: 3 }), -3);
  assert.equal(efectoMovimiento({ tipo: "ajuste", cantidad: -4 }), -4);
  assert.equal(efectoMovimiento({ tipo: "ingreso", cantidad: 10, anulado: true }), 0);
  // Stock de hoy 20; después del día elegido entraron 10 y se retiraron 3 → ese día había 13
  const r = deshacerMovimientos(new Map([["A", 20]]), [{ sku: "A", tipo: "ingreso", cantidad: 10 }, { sku: "A", tipo: "consumo", cantidad: 3 }]);
  assert.equal(r.get("A"), 13);
});

test("precio — el último hasta el día elegido, sin pasarse", () => {
  const precios = [
    { sku: "A", fecha: "2026-10-01", precio_ars: 100, origen: "mrp" },
    { sku: "A", fecha: "2026-11-01", precio_ars: 120, origen: "oc" },
    { sku: "A", fecha: "2026-11-10", precio_ars: 150, origen: "factura" },
  ];
  assert.equal(ultimoPrecioHasta(precios, "2026-11-05").precio_ars, 120);
  assert.equal(ultimoPrecioHasta(precios, "2026-11-10").precio_ars, 150);
  assert.equal(ultimoPrecioHasta(precios, "2026-09-01"), null);
});

test("valorizar — cantidad × precio, total, sin precio y negativos no suman, por división", () => {
  const articulos = [
    { sku: "A", nombre: "Melamina blanca 18", unidad: "PL", division: "MADERA", ultimo_precio: 999 },
    { sku: "B", nombre: "Bisagra", unidad: "UN", division: "HERRAJES", ultimo_precio: 50 },
    { sku: "C", nombre: "Tornillo", unidad: "UN", division: "HERRAJES" },
    { sku: "D", nombre: "Canto", unidad: "MT", division: "MADERA", ultimo_precio: 10 },
  ];
  const cantidades = new Map([["A", 10], ["B", 4], ["C", 100], ["D", -5], ["E", 0]]);
  const precios = [{ sku: "A", fecha: "2026-11-01", precio_ars: 30000, origen: "factura", proveedor: "Faplac" }];
  const inv = valorizar({ fecha: "2026-11-15", articulos, cantidades, precios });
  assert.equal(inv.total, 300200, "A con la factura (no el de la planilla) + B con el de la planilla");
  assert.equal(inv.sin_precio, 1);
  assert.equal(inv.negativos, 1);
  assert.equal(inv.articulos, 4, "lo que está en cero no aparece");
  const a = inv.filas.find((f) => f.sku === "A");
  assert.equal(a.precio, 30000);
  assert.equal(a.origen_precio, "Factura");
  assert.equal(inv.filas.find((f) => f.sku === "B").origen_precio, "Último precio de la planilla");
  assert.equal(inv.filas.find((f) => f.sku === "D").valor, null);
  assert.equal(inv.filas[0].sku, "A", "de mayor a menor valor");
  assert.deepEqual(inv.por_division, [{ division: "MADERA", valor: 300000 }, { division: "HERRAJES", valor: 200 }]);
  assert.equal(sumaValor(filtrarInventario(inv.filas, { division: "HERRAJES" })), 200);
  assert.equal(filtrarInventario(inv.filas, { texto: "melam" }).length, 1);
  const xlsx = inventarioXlsx(inv, { empresa: "Acme" });
  assert.ok(xlsx instanceof Uint8Array && xlsx.length > 500, "un .xlsx de verdad");
});

test("fechas — válidas y fin del día en hora argentina", () => {
  assert.equal(fechaValida("2026-11-17"), true);
  assert.equal(fechaValida("2026-02-30"), false);
  assert.equal(fechaValida("17/11/2026"), false);
  assert.equal(finDelDia("2026-11-16"), "2026-11-17T02:59:59.999Z");
});

test("migración 196 — foto por empresa, solo lectura para la app, una por noche con pg_cron", () => {
  const sql = readFileSync(new URL("../supabase/migrations/196_fotos_stock.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /grant select on public\.stock_fotos to authenticated/);
  assert.doesNotMatch(sql, /grant[^;]*(insert|update|delete)[^;]*stock_fotos/i);
  assert.match(sql, /cron\.schedule\('gypi-foto-stock', '55 2 \* \* \*'/);
  assert.doesNotMatch(sql, /CRON_SECRET/, "es solo SQL, no necesita clave");
});

// ─── Ruta ───

function mockRuta({ fotos = null, movs = [], sinFotos = false } = {}) {
  const urls = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: [{ sku: "A", nombre: "Melamina", division: "MADERA", stock: 20, activo: true }] }) },
    {
      match: (u) => u.includes("/rest/v1/stock_fotos"),
      respond: (u) => {
        urls.push(u);
        if (sinFotos) return { status: 404, body: { message: "relation stock_fotos does not exist" } };
        if (!fotos) return { status: 200, body: [] };
        return { status: 200, body: u.includes("select=fecha") ? [{ fecha: fotos.fecha }] : fotos.filas };
      },
    },
    { match: (u) => u.includes("/rest/v1/movimientos_stock"), respond: (u) => { urls.push(u); return { status: 200, body: movs }; } },
    { match: (u) => u.includes("/rest/v1/v_precios_articulos"), respond: (u) => { urls.push(u); return { status: 200, body: [{ sku: "A", fecha: "2026-01-02", precio_ars: 1000, origen: "oc" }] }; } },
  ]);
  return urls;
}

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, fecha) => new Request(`http://localhost/api/stock/inventario${fecha ? `?fecha=${fecha}` : ""}`, { headers: { Authorization: `Bearer ${t}` } });

test("/api/stock/inventario — hoy: el stock de la planilla × el último precio", async () => {
  mockRuta();
  const res = await api.GET(req(await token("gerencial")));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.desde, "hoy");
  assert.equal(d.total, 20000);
});

test("/api/stock/inventario — el operario no lo ve; fecha inválida", async () => {
  mockRuta();
  assert.equal((await api.GET(req(await token("operativo")))).status, 403);
  assert.equal((await api.GET(req(await token("gerencial"), "2026-13-01"))).status, 400);
});

test("/api/stock/inventario — día pasado sin foto: deshace los movimientos de después", async () => {
  const urls = mockRuta({ movs: [{ id: 1, sku: "A", tipo: "ingreso", cantidad: 8 }] });
  const d = await (await api.GET(req(await token("administrativo"), "2026-01-05"))).json();
  assert.equal(d.desde, "hoy");
  assert.equal(d.filas[0].cantidad, 12);
  assert.equal(d.movimientos_deshechos, 1);
  assert.ok(urls.some((u) => u.includes("movimientos_stock") && u.includes("created_at=gt.2026-01-06T02%3A59%3A59.999Z")));
  assert.ok(urls.some((u) => u.includes("v_precios_articulos") && u.includes("fecha=lte.2026-01-05")));
});

test("/api/stock/inventario — con foto del mismo día no deshace nada; sin la 196 avisa", async () => {
  let urls = mockRuta({ fotos: { fecha: "2026-01-05", filas: [{ sku: "A", stock: 7 }] } });
  let d = await (await api.GET(req(await token("gerencial"), "2026-01-05"))).json();
  assert.equal(d.desde, "foto");
  assert.equal(d.filas[0].cantidad, 7);
  assert.ok(!urls.some((u) => u.includes("movimientos_stock")));
  assert.match(textoOrigen(d), /Foto del stock guardada la noche del 05\/01\/2026/);

  urls = mockRuta({ fotos: { fecha: "2026-01-07", filas: [{ sku: "A", stock: 7 }] }, movs: [{ id: 1, sku: "A", tipo: "consumo", cantidad: 2 }] });
  d = await (await api.GET(req(await token("gerencial"), "2026-01-05"))).json();
  assert.equal(d.filas[0].cantidad, 9, "foto del 7 + lo retirado entre el 5 y el 7");
  assert.ok(urls.some((u) => u.includes("movimientos_stock") && u.includes("created_at=lte.2026-01-08T02%3A59%3A59.999Z")));

  mockRuta({ sinFotos: true });
  d = await (await api.GET(req(await token("gerencial"), "2026-01-05"))).json();
  assert.equal(d.sin_fotos, true);
  assert.equal(d.filas[0].cantidad, 20);
});

// ─── Pantallas ───

test("pantalla Inventario — total, lista, filtro y botones para cargar", async () => {
  const pedidos = [];
  global.fetch = async (url) => {
    pedidos.push(String(url));
    return new Response(JSON.stringify({
      fecha: "2026-11-17", hoy: "2026-11-17", desde: "hoy", total: 300200, articulos: 2, sin_precio: 1, negativos: 0,
      por_division: [{ division: "MADERA", valor: 300000 }, { division: "HERRAJES", valor: 200 }],
      filas: [
        { sku: "A", nombre: "Melamina blanca 18", unidad: "PL", division: "MADERA", cantidad: 10, precio: 30000, valor: 300000, origen_precio: "Factura" },
        { sku: "B", nombre: "Bisagra", unidad: "UN", division: "HERRAJES", cantidad: 4, precio: 50, valor: 200 },
        { sku: "C", nombre: "Tornillo", unidad: "UN", division: "HERRAJES", cantidad: 100, precio: null, valor: null },
      ],
    }), { status: 200 });
  };
  const elegidos = [];
  render(<InventarioScreen usuario={{ rol: "gerencial" }} onCargar={(t) => elegidos.push(t)} />);
  await waitFor(() => screen.getByText("Melamina blanca 18"));
  assert.ok(pedidos.some((u) => u.includes("/api/stock/inventario?fecha=")));
  assert.ok(screen.getAllByText("$ 300.200").length >= 1);
  assert.ok(screen.getByText(/1 artículo sin precio no suma/));
  fireEvent.click(screen.getByRole("button", { name: "HERRAJES" }));
  assert.ok(screen.getByText("2 de 3 artículos · $ 200"));
  assert.equal(screen.queryByText("Melamina blanca 18"), null);
  fireEvent.click(screen.getByText("📥 Cargar ingreso"));
  fireEvent.click(screen.getByText("📤 Cargar consumo"));
  assert.deepEqual(elegidos, ["ingreso", "consumo"]);
});

test("Movimientos — 📤 Cargar consumo abre el formulario directo en Retiro", async () => {
  global.fetch = async () => new Response("[]", { status: 200 });
  render(<MovimientosStock usuario={{ rol: "gerencial" }} articulos={[]} tipoInicial="consumo" />);
  const retiro = screen.getByText("📦 Retiro").closest("button");
  assert.equal(retiro.getAttribute("aria-pressed"), "true");
});

test("Materiales — Inventario y Movimientos con lugar propio; Stock ya no los esconde", () => {
  const boton = readFileSync(new URL("../app/components/screens/BotonGestionScreen.jsx", import.meta.url), "utf8");
  assert.match(boton, /actual\.id === "inventario-valorizado" && <InventarioScreen/);
  assert.match(boton, /actual\.id === "movimientos" && <MovimientosScreen/);
  const stock = readFileSync(new URL("../app/components/StockScreen.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(stock, /setVista\("movimientos"\)/);
  assert.match(stock, /<BotonesCargar/);
});

test("Movimientos — el 📤 pedido desde Stock abre el formulario una sola vez", async () => {
  const { default: MovimientosScreen, pedirCarga } = await import("../app/components/MovimientosScreen.jsx");
  global.fetch = async () => new Response("[]", { status: 200 });
  pedirCarga("consumo");
  render(<MovimientosScreen usuario={{ rol: "gerencial" }} />);
  assert.equal(screen.getByText("📦 Retiro").closest("button").getAttribute("aria-pressed"), "true");
  cleanup();
  render(<MovimientosScreen usuario={{ rol: "gerencial" }} />);
  assert.ok(screen.getByText("📥 Cargar ingreso"), "volver a la pestaña no reabre el formulario");
});
