// tests/conexiones-finanzas.test.jsx — Conexiones extra del plan Finanzas e
// Inventario (11/11): orden recibida sin factura, saldo de cada OC en Pagos y
// ticket de materiales de Mi caja al stock.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { faltaFacturaOc } from "../app/lib/ordenesCompra.js";
import { pendientesFinanzas } from "../app/lib/finanzasInicio.js";

afterEach(() => cleanup());
const { default: OrdenesCompra } = await import("../app/components/OrdenesCompra.jsx");

// ─── Orden recibida sin factura ───

test("falta la factura — llegó mercadería y no se cargó la factura", () => {
  assert.equal(faltaFacturaOc({ estado: "recibida", factura_numero: null }), true);
  assert.equal(faltaFacturaOc({ estado: "recibida_parcial", factura_numero: "  " }), true);
  assert.equal(faltaFacturaOc({ estado: "cerrada_faltantes" }), true);
  assert.equal(faltaFacturaOc({ estado: "recibida", factura_numero: "A 0003-00012" }), false);
  assert.equal(faltaFacturaOc({ estado: "recibida", factura_fecha: "2026-11-10" }), false, "con fecha de factura cuenta como cargada");
  assert.equal(faltaFacturaOc({ estado: "enviada" }), false, "todavía no llegó nada");
  assert.equal(faltaFacturaOc({ estado: "anulada" }), false);
});

test("Finanzas → Inicio: Para hacer avisa las órdenes recibidas sin factura y lleva a Compras", () => {
  const [p] = pendientesFinanzas({ hoy: "2026-11-11", sinFactura: 2 });
  assert.deepEqual([p.id, p.ir, p.cantidad, p.tono], ["sin_factura", "inventario:compras", 2, "ambar"]);
  assert.match(p.texto, /2 órdenes de compra recibidas sin factura: cargalas en Compras para que entren a Finanzas/);
  assert.match(pendientesFinanzas({ hoy: "2026-11-11", sinFactura: 1 })[0].texto, /^1 orden de compra recibida sin factura/);
});

test("Compras → Órdenes: el filtro 🧾 Recibidas sin factura y la marca en cada una", async () => {
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (String(url).includes("/api/data") && String(body.path || "").startsWith("ordenes_compra?")) {
      return new Response(JSON.stringify({ ok: true, data: [
        { id: 1, numero: 40, proveedor_nombre: "FAPLAC", estado: "recibida", factura_numero: null, created_at: "2026-11-08T12:00:00Z" },
        { id: 2, numero: 41, proveedor_nombre: "HERRAJES SRL", estado: "recibida", factura_numero: "A 1-2", created_at: "2026-11-09T12:00:00Z" },
        { id: 3, numero: 42, proveedor_nombre: "MADERAS SA", estado: "enviada", factura_numero: null, created_at: "2026-11-10T12:00:00Z" },
      ] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 });
  };
  render(<OrdenesCompra empresaId="e1" filtroInicial="sin_factura" />);
  await waitFor(() => screen.getByText("OC N° 40 · FAPLAC"));
  assert.equal(screen.queryByText("OC N° 41 · HERRAJES SRL"), null);
  assert.equal(screen.queryByText("OC N° 42 · MADERAS SA"), null);
  assert.match(screen.getByText("OC N° 40 · FAPLAC").parentElement.textContent, /🧾 Falta la factura/);
  assert.equal(screen.getByLabelText("Qué órdenes ver").value, "sin_factura");
});

// ─── Saldo de cada OC en Pagos ───

const { saldosPorOc } = await import("../app/lib/finanzasProveedores.js");
const { SaldoPorOc } = await import("../app/components/FinanzasPagos.jsx");
const PROV = "02.01.01";
const OPS = [
  { id: 1, fecha: "2026-10-01", proveedor_id: 7, total_ars: 1000, cuenta_debe: "05.01.01", cuenta_haber: PROV, origen: "factura_oc", origen_id: "40", descripcion: "Factura A 1-1 · OC 40" },
  { id: 2, fecha: "2026-10-05", proveedor_id: 7, total_ars: 200, cuenta_debe: "05.01.01", cuenta_haber: PROV, origen: "factura_oc_otra", origen_id: "3", descripcion: "Factura B 2-9 · OC 40 (otro proveedor)" },
  { id: 3, fecha: "2026-10-10", proveedor_id: 7, total_ars: 500, cuenta_debe: "05.01.01", cuenta_haber: PROV, origen: "factura_oc", origen_id: "41", descripcion: "Factura A 1-2 · OC 41" },
  { id: 4, fecha: "2026-10-20", proveedor_id: 7, total_ars: 1100, cuenta_debe: PROV, cuenta_haber: "01.01.01.001.002", origen: "orden_pago", descripcion: "Pago" },
  { id: 5, fecha: "2026-10-02", proveedor_id: 8, total_ars: 300, cuenta_debe: "05.01.01", cuenta_haber: PROV, origen: "factura_suelta", descripcion: "Factura suelta 9" },
];

test("saldo por OC — junta las facturas de cada OC y aplica los pagos a lo más viejo", () => {
  const s = saldosPorOc(OPS, new Set([PROV]), [{ id: 7, nombre: "FAPLAC" }]);
  assert.deepEqual(s.map((x) => [x.numero, x.proveedor, x.facturado, x.pagado, x.falta]), [
    [41, "FAPLAC", 500, 0, 500],
    [40, "FAPLAC", 1200, 1100, 100],
  ], "1.100 pagados van a lo más viejo: la OC 40 (1.000 + 100 de los 200); la factura suelta no es de una OC");
});

test("Pagos → 📄 Saldo por orden de compra: lo que falta, y las pagadas a pedido", async () => {
  global.fetch = async () => new Response(JSON.stringify({ operaciones: OPS, cuentas_proveedores: [PROV], proveedores: [{ id: 7, nombre: "FAPLAC" }] }), { status: 200 });
  render(<SaldoPorOc />);
  await waitFor(() => screen.getByLabelText("Saldo por orden de compra"));
  assert.ok(screen.getByText("OC N° 41"));
  assert.ok(screen.getByText("OC N° 40"), "la 40 todavía debe 100");
  assert.equal(screen.queryByText("✅ Pagada"), null);
  cleanup();
  global.fetch = async () => new Response(JSON.stringify({ operaciones: [...OPS, { id: 6, fecha: "2026-10-25", proveedor_id: 7, total_ars: 600, cuenta_debe: PROV, cuenta_haber: "01.01.01.001.002", origen: "orden_pago" }], cuentas_proveedores: [PROV], proveedores: [{ id: 7, nombre: "FAPLAC" }] }), { status: 200 });
  render(<SaldoPorOc />);
  await waitFor(() => screen.getByText(/Todas las órdenes de compra facturadas están pagadas/));
  screen.getByLabelText("Ver también las pagadas").click();
  await waitFor(() => assert.equal(screen.getAllByText("✅ Pagada").length, 2));
});
