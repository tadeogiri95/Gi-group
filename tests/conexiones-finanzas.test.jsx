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
