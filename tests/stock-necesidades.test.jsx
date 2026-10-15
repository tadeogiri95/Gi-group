// tests/stock-necesidades.test.jsx — Stock, parte 16 (ítem 40): lo que
// necesita cada OT (hoja fact_necesidades_stock de la planilla MRP, migración
// 108) contra lo retirado desde la app, en el detalle de la OT.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { createFetchMock } from "./helpers/mockFetch.js";
import { leerNecesidades, materialOt } from "../app/lib/stock.js";
import { autorizar } from "../app/lib/dataPolicy.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { syncStockEmpresa } = await import("../app/lib/syncStock.js");
const { default: MaterialOt } = await import("../app/components/MaterialOt.jsx");

const E = "11111111-1111-1111-1111-111111111111";

// Hoja fact_necesidades_stock publicada como CSV (títulos reales, dos filas arriba)
const NECESIDADES = [
  "AUXILIAR,,,,,,,,,,",
  ",,,,,,,,,,",
  "SKU,FECHA,ARTICULO,CANTIDAD PRESUPUESTADA,CANT. CANCELADA,OT,STOCK DISPONIBLE,¿OBRA TERMINADA?,CLIENTE,OBRA,PROYECTO",
  "1.1.1.2.130.1,31/08/2026,\"MELAMINA SOBRE MDF 18MM-Faplac-PETIRIBI-4,7M2\",\"15,7\",,M-7471,0,NO,GI,Casa,P1",
  "1.1.1.2.130.1,01/09/2026,\"MELAMINA SOBRE MDF 18MM-Faplac-PETIRIBI-4,7M2\",\"4,3\",2,M-7471,0,NO,GI,Casa,P2",
  "1.3.1.24.59.1,01/09/0206,CANTO ABS 22/045-Rehau-PETIRIBI-1 MT,210,,M-7471,0,NO,GI,Casa,P1",
  ",01/09/2026,ARTICULO QUE NO ESTA EN ARTICULOS,3,,M-7471,,NO,GI,Casa,P1",
  "1.1.1.2.130.1,01/09/2026,\"MELAMINA SOBRE MDF 18MM-Faplac-PETIRIBI-4,7M2\",5,,M-7100,0,SI,BCG,Hotel,P3",
  "1.1.1.2.130.1,,MELAMINA,,,,,,,,",
].join("\n");

test("necesidades — junta por OT y artículo, resta lo cancelado y lee los títulos reales", () => {
  const { filas, sinSku, faltaColumnas } = leerNecesidades(NECESIDADES);
  assert.equal(faltaColumnas, false);
  assert.equal(sinSku, 1, "el renglón sin SKU (el nombre no está en ARTICULOS)");
  const porClave = Object.fromEntries(filas.map((f) => [`${f.ot}|${f.sku}`, f]));
  assert.equal(filas.length, 3, "el renglón sin OT no cuenta");
  const melamina = porClave["M-7471|1.1.1.2.130.1"];
  assert.equal(melamina.cantidad, 18, "15,7 + 4,3 − 2 cancelada");
  assert.equal(melamina.fecha, "2026-08-31", "la primera fecha");
  assert.equal(melamina.obra_terminada, false);
  assert.equal(porClave["M-7471|1.3.1.24.59.1"].fecha, null, "el año 0206 es un error de tipeo: sin fecha");
  assert.equal(porClave["M-7100|1.1.1.2.130.1"].obra_terminada, true);
  assert.equal(leerNecesidades("SKU,ARTICULO\n1.2,X").faltaColumnas, true);
});

test("material de la OT — necesario contra retirado (retiros menos devoluciones), faltantes primero", () => {
  const nec = [
    { sku: "A", nombre: "MELAMINA", cantidad: 18 },
    { sku: "B", nombre: "CANTO", cantidad: 210 },
  ];
  const movs = [
    { sku: "A", tipo: "consumo", cantidad: 20, unidad: "M2" },
    { sku: "A", tipo: "devolucion", cantidad: 2 },
    { sku: "B", tipo: "consumo", cantidad: 50 },
    { sku: "B", tipo: "consumo", cantidad: 100, anulado: true },
    { sku: "C", tipo: "consumo", cantidad: 4, nombre: "TORNILLO" },
    { sku: "A", tipo: "ingreso", cantidad: 99 },
  ];
  const m = materialOt(nec, movs, [{ sku: "B", nombre: "CANTO ABS", unidad: "MT" }]);
  assert.deepEqual(m.filas.map((f) => [f.sku, f.necesario, f.retirado, f.falta]), [
    ["B", 210, 50, 160],
    ["A", 18, 18, 0],
    ["C", 0, 4, 0],
  ]);
  assert.equal(m.filas[0].nombre, "CANTO ABS", "el nombre y la unidad del artículo");
  assert.equal(m.filas[0].unidad, "MT");
  assert.equal(m.filas[1].unidad, "M2");
  assert.deepEqual([m.conFalta, m.completos, m.sinNecesidad], [1, 1, 1]);
});

test("migración 108 — por empresa; datos solo se leen por /api/data", () => {
  const sql = readFileSync(new URL("../supabase/migrations/108_necesidades_stock.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /tenant_isolation_auth_necesidades_stock/);
  assert.match(sql, /primary key \(empresa_id, ot, sku\)/);
  assert.match(sql, /grant select, insert, update, delete on public\.necesidades_stock to authenticated/);
  assert.equal(autorizar("necesidades_stock", "GET", { rol: "operativo" }).ok, true);
  for (const metodo of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar("necesidades_stock", metodo, { rol: "gerencial" }).ok, false, metodo);
});

// ─── Sincronización ───

const INVENTARIO = "SKU,ARTICULO,STOCK TOTAL\n1.1.1.2.130.1,MELAMINA,10";

function mockSync({ necesidades = "https://docs.google.com/nec.csv", falla = null } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    { match: (u) => u === "https://docs.google.com/inv.csv", respond: () => ({ status: 200, body: INVENTARIO }) },
    { match: (u) => u === "https://docs.google.com/nec.csv", respond: () => ({ status: 200, body: NECESIDADES }) },
    {
      match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"),
      respond: () => ({ status: 200, body: [{ valor: { inventario: "https://docs.google.com/inv.csv", necesidades } }] }),
    },
    {
      match: (u, o) => ["POST", "PATCH", "DELETE"].includes(o?.method),
      respond: (u, o) => {
        if (falla && u.includes("necesidades_stock")) return { status: 404, body: { message: falla } };
        escrito.push({ metodo: o.method, url: u, body: o.body ? JSON.parse(o.body) : null });
        return { status: 200, body: [] };
      },
    },
  ]);
  return escrito;
}

test("sincronizar — con el link de necesidades copia la hoja y borra lo que ya no está", async () => {
  const escrito = mockSync();
  const r = await syncStockEmpresa(E);
  assert.equal(r.necesidades, 3);
  assert.equal(r.avisoNecesidades, null);
  const subida = escrito.find((w) => w.url.includes("necesidades_stock?on_conflict=empresa_id,ot,sku"));
  assert.equal(subida.body.length, 3);
  assert.ok(subida.body.every((f) => f.empresa_id === E && f.sincronizado_at));
  const borrar = escrito.find((w) => w.metodo === "DELETE");
  assert.match(borrar.url, new RegExp(`necesidades_stock\\?empresa_id=eq\\.${E}&sincronizado_at=lt\\.`));
  const config = escrito.find((w) => w.url.includes("config_sistema"));
  assert.equal(config.body.valor.necesidades, "https://docs.google.com/nec.csv", "no pierde el link");
});

test("sincronizar — sin la migración 108 avisa, y los artículos se copian igual", async () => {
  mockSync({ falla: 'relation "public.necesidades_stock" does not exist' });
  const r = await syncStockEmpresa(E);
  assert.equal(r.articulos, 1);
  assert.match(r.avisoNecesidades, /migración 108/);
});

test("sincronizar — sin link de necesidades no las toca", async () => {
  const escrito = mockSync({ necesidades: null });
  const r = await syncStockEmpresa(E);
  assert.equal(r.necesidades, 0);
  assert.ok(!escrito.some((w) => w.url.includes("necesidades_stock")));
});

// ─── Detalle de la OT ───

test("detalle de la OT — muestra el material con lo que falta", async () => {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    const { path } = JSON.parse(opts.body);
    pedidos.push(path);
    if (path.startsWith("necesidades_stock")) return Response.json({ data: [{ sku: "1.1.1", nombre: "MELAMINA", cantidad: 18 }, { sku: "2.2", nombre: "CANTO", cantidad: 5 }] });
    if (path.startsWith("movimientos_stock")) return Response.json({ data: [{ sku: "1.1.1", tipo: "consumo", cantidad: 3, unidad: "M2" }, { sku: "2.2", tipo: "consumo", cantidad: 5 }] });
    return Response.json({ data: [] });
  };
  render(<MaterialOt ot="M-7471" empresaId={E} />);
  await waitFor(() => assert.ok(screen.getByText("Falta 15")));
  assert.ok(screen.getByText("Retirado 3 de 18 M2"));
  assert.ok(screen.getByText("✅ Completo"));
  assert.ok(screen.getByText(/2 artículos · 1 con faltante · 1 completos/));
  const art = pedidos.find((p) => p.startsWith("articulos_stock"));
  assert.match(art, /sku=in\.\(%221\.1\.1%22,%222\.2%22\)/);
  assert.doesNotMatch(art, /"/, "sin comillas: /api/data las rechaza");
  const detalle = readFileSync(new URL("../app/components/DetalleOp.jsx", import.meta.url), "utf8");
  assert.match(detalle, /<MaterialOt ot=\{proyecto\?\.ot\} empresaId=\{empresaId\} \/>/);
});

test("detalle de la OT — sin necesidades ni retiros no muestra nada", async () => {
  global.fetch = async () => Response.json({ data: [] });
  const { container } = render(<MaterialOt ot="M-1" empresaId={E} />);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(container.textContent, "");
});
