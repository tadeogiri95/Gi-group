// tests/precios-articulos.test.jsx — Costo de materiales por OT, parte A:
// lista de precios con fecha (hoja fact_ingresos_stock de la planilla MRP y
// facturas de OC; migración 164).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { createFetchMock } from "./helpers/mockFetch.js";
import { leerIngresosMrp, historialPrecios, textoPrecio, ultimosPrecios, textoFechaPrecio, veePrecios } from "../app/lib/preciosArticulos.js";
import { autorizar } from "../app/lib/dataPolicy.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { syncStockEmpresa } = await import("../app/lib/syncStock.js");
const { PreciosArticulo } = await import("../app/components/FichaArticulo.jsx");

const E = "11111111-1111-1111-1111-111111111111";

// Hoja fact_ingresos_stock publicada como CSV (títulos reales del libro MRP)
const INGRESOS = [
  "ID_INGRESO,ID_SKU,ID_PROVEEDOR,FECHA CARGA,NOMBRE NORMALIZADO,PROVEEDOR,N° COMPROBANTE,FECHA COMPRA,CANTIDAD INGRESADA,PRECIO UNIT. S/IVA,PRECIO TOTAL S/IVA,IVA,TOTAL",
  '7aa18670,1.3.2.69.155.5.3.53,884,30/03/2026,BISAGRA 35 CODO 0-S/Marca-S/COLOR-1 PZ,GRUPO EURO SA,A-0001-123,28/03/2026,100," $514,00"," $51.400,00",,',
  '29277915,1.3.2.21.155.5.3.603,884,30/03/2026,ESCUADRA SOPORTE,GRUPO EURO SA,,,10," $1.012,00",,,',
  'GY-55,1.3.2.69.155.5.3.53,,01/11/2026,BISAGRA 35 CODO,GRUPO EURO SA,F-9,01/11/2026,50," $600,00",,,',
  'aa000001,1.3.2.69.155.5.3.53,884,02/04/2026,BISAGRA 35 CODO,GRUPO EURO SA,,02/04/2026,5," $0,00",,,',
  ',1.1.1.2.130.1,,05/05/2026,MELAMINA,FAPLAC,X-1,05/05/2026,2," $80.000,00",,,',
  ',1.1.1.2.130.1,,05/05/2026,MELAMINA,FAPLAC,X-1,05/05/2026,2," $80.000,00",,,',
  "bb000002,,,05/05/2026,SIN SKU,FAPLAC,,05/05/2026,2,100,,,",
].join("\n");

test("ingresos MRP — lee precio sin IVA, fecha de compra (o de carga), proveedor y comprobante", () => {
  const { filas, salteados, faltaColumnas } = leerIngresosMrp(INGRESOS);
  assert.equal(faltaColumnas, false);
  assert.equal(filas.length, 4);
  const [bisagra, escuadra, mel1, mel2] = filas;
  assert.deepEqual(
    [bisagra.sku, bisagra.fecha, bisagra.precio, bisagra.precio_ars, bisagra.moneda, bisagra.origen, bisagra.referencia, bisagra.proveedor, bisagra.comprobante, bisagra.cantidad],
    ["1.3.2.69.155.5.3.53", "2026-03-28", 514, 514, "ARS", "mrp", "ING-7aa18670", "GRUPO EURO SA", "A-0001-123", 100]
  );
  assert.equal(escuadra.fecha, "2026-03-30", "sin fecha de compra usa la de carga");
  assert.equal(escuadra.precio, 1012);
  assert.equal(mel1.precio, 80000);
  assert.notEqual(mel1.referencia, mel2.referencia, "dos renglones iguales sin ID no se pisan");
  assert.equal(salteados, 3, "GY- (ya viene de la OC), precio 0 y sin SKU");
  assert.ok(!filas.some((f) => f.referencia.includes("GY")));
  assert.equal(leerIngresosMrp("SKU,ARTICULO\n1.2,X").faltaColumnas, true);
});

test("historial y texto de precios", () => {
  const h = historialPrecios([{ fecha: "2026-01-01" }, { fecha: "2026-03-01" }, { fecha: "2026-02-01" }]);
  assert.deepEqual(h.map((p) => p.fecha), ["2026-03-01", "2026-02-01", "2026-01-01"]);
  assert.equal(textoPrecio(1234.5), "$ 1.234,50");
  assert.equal(textoPrecio(10, "USD"), "US$ 10,00");
  assert.equal(textoPrecio(null), "—");
});

test("migración 164 — un bloque, solo Dueño y Administración, vista con las facturas de OC", () => {
  const sql = readFileSync(new URL("../supabase/migrations/164_precios_articulos.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /in \('gerencial', 'administrativo'\)/);
  assert.match(sql, /precios_articulos_referencia on public\.precios_articulos \(empresa_id, origen, referencia\)/);
  assert.match(sql, /security_invoker = true/);
  assert.match(sql, /o\.estado <> 'anulada'/, "las OC anuladas no cuentan");
  assert.match(sql, /i\.factor/, "precio por unidad de stock (152)");
  assert.match(sql, /o\.tipo_cambio/, "en dólares pasa a pesos con el tipo de cambio de la factura");
  for (const t of ["precios_articulos", "v_precios_articulos"]) {
    assert.equal(autorizar(t, "GET", { rol: "gerencial" }).ok, true, t);
    assert.equal(autorizar(t, "GET", { rol: "administrativo" }).ok, true, t);
    assert.equal(autorizar(t, "GET", { rol: "operativo" }).ok, false, `${t}: el operario no ve precios`);
    for (const m of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar(t, m, { rol: "gerencial" }).ok, false, `${t} ${m}`);
  }
});

// ─── Sincronización ───

function mockSync({ ingresos = "https://docs.google.com/ing.csv", falla = null } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    { match: (u) => u.startsWith("https://docs.google.com/inv.csv"), respond: () => ({ status: 200, body: "SKU,ARTICULO,STOCK TOTAL\n1.1.1.2.130.1,MELAMINA,10" }) },
    { match: (u) => u.startsWith("https://docs.google.com/ing.csv"), respond: () => ({ status: 200, body: INGRESOS }) },
    {
      match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"),
      respond: () => ({ status: 200, body: [{ valor: { inventario: "https://docs.google.com/inv.csv", ingresos } }] }),
    },
    {
      match: (u, o) => ["POST", "PATCH", "DELETE"].includes(o?.method),
      respond: (u, o) => {
        if (falla && u.includes("precios_articulos")) return { status: 404, body: { message: falla } };
        escrito.push({ metodo: o.method, url: u, body: o.body ? JSON.parse(o.body) : null });
        return { status: 200, body: [] };
      },
    },
  ]);
  return escrito;
}

test("sincronizar — con el link de ingresos copia los precios y borra los que ya no están", async () => {
  const escrito = mockSync();
  const r = await syncStockEmpresa(E);
  assert.equal(r.precios, 4);
  assert.equal(r.avisoPrecios, null);
  const subida = escrito.find((w) => w.url.includes("precios_articulos?on_conflict=empresa_id,origen,referencia"));
  assert.equal(subida.body.length, 4);
  assert.ok(subida.body.every((f) => f.empresa_id === E && f.sincronizado_at && f.origen === "mrp"));
  const borrar = escrito.find((w) => w.metodo === "DELETE" && w.url.includes("precios_articulos"));
  assert.match(borrar.url, new RegExp(`precios_articulos\\?empresa_id=eq\\.${E}&origen=eq\\.mrp&sincronizado_at=lt\\.`), "solo los de la planilla");
  const config = escrito.find((w) => w.url.includes("config_sistema"));
  assert.equal(config.body.valor.ingresos, "https://docs.google.com/ing.csv", "no pierde el link");
});

test("sincronizar — sin la migración 164 avisa, y los artículos se copian igual", async () => {
  mockSync({ falla: 'relation "public.precios_articulos" does not exist' });
  const r = await syncStockEmpresa(E);
  assert.equal(r.articulos, 1);
  assert.match(r.avisoPrecios, /migración 164/);
});

test("sincronizar — sin link de ingresos no toca los precios", async () => {
  const escrito = mockSync({ ingresos: null });
  const r = await syncStockEmpresa(E);
  assert.equal(r.precios, 0);
  assert.ok(!escrito.some((w) => w.url.includes("precios_articulos")));
});

// ─── Ficha del artículo ───

test("ficha — historial de precios con origen, y en dólares el tipo de cambio", async () => {
  global.fetch = async (url, opts = {}) => {
    const { path } = JSON.parse(opts.body);
    if (!path.startsWith("v_precios_articulos")) return Response.json({ data: [] });
    return Response.json({
      data: [
        { fecha: "2026-03-28", precio: 514, moneda: "ARS", precio_ars: 514, origen: "mrp", proveedor: "GRUPO EURO SA", comprobante: "A-1" },
        { fecha: "2026-10-02", precio: 1.5, moneda: "USD", tipo_cambio: 1000, precio_ars: 1500, origen: "oc", proveedor: "HAFELE", comprobante: "B-2" },
      ],
    });
  };
  render(<PreciosArticulo sku="1.3.2.69.155.5.3.53" />);
  await waitFor(() => screen.getByLabelText("Último precio"));
  assert.match(screen.getByLabelText("Último precio").textContent, /\$ 1\.500,00.*Del 02\/10\/2026 · HAFELE · US\$ 1,50/, "arriba, el último precio con fecha");
  const items = screen.getAllByRole("listitem");
  assert.match(items[0].textContent, /02\/10\/2026.*HAFELE.*\$ 1\.500,00.*US\$ 1,50 × 1000/, "el más nuevo primero");
  assert.match(items[1].textContent, /28\/03\/2026.*GRUPO EURO SA.*A-1.*\$ 514,00/);
});

test("ultimosPrecios: la compra más nueva de cada artículo, y si no hay, el de la planilla sin fecha", () => {
  const m = ultimosPrecios(
    [
      { sku: "A-1", fecha: "2026-11-14", precio_ars: 1500, precio: 1.5, moneda: "USD", origen: "oc", proveedor: "HAFELE" },
      { sku: "A-1", fecha: "2026-11-14", precio_ars: 999, moneda: "ARS", origen: "mrp" },
      { sku: "A-1", fecha: "2026-03-28", precio_ars: 514, moneda: "ARS", origen: "mrp" },
      { sku: "B-2", fecha: "2026-01-02", precio_ars: null, moneda: "USD", origen: "oc" },
      { sku: "C-3", fecha: "2026-02-01T00:00:00", precio_ars: "80.5", moneda: "ARS", origen: "factura" },
    ],
    [{ sku: "A-1", ultimo_precio: 1 }, { sku: "B-2", ultimo_precio: 42 }, { sku: "D-4", ultimo_precio: 0 }],
  );
  assert.deepEqual(m.get("A-1"), { precio: 1500, fecha: "2026-11-14", origen: "oc", proveedor: "HAFELE", moneda: "USD", precio_usd: 1.5 });
  assert.equal(m.get("B-2").precio, 42, "sin precio en pesos: usa el de la planilla");
  assert.equal(m.get("B-2").fecha, null);
  assert.equal(m.get("C-3").fecha, "2026-02-01");
  assert.equal(m.has("D-4"), false);
  assert.equal(textoFechaPrecio(m.get("A-1")), "14/11/2026");
  assert.equal(textoFechaPrecio(m.get("B-2")), "sin fecha");
  assert.equal(veePrecios({ rol: "gerencial" }) && veePrecios({ rol: "administrativo" }), true);
  assert.equal(veePrecios({ rol: "operativo" }), false);
});
