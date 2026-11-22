// tests/op-comprobantes-facturas.test.jsx — 22/11: en la orden de pago, el
// PDF (o la foto) de cada factura que se paga llega al CFO como link: en su
// página (/op/<token>), en el resumen y en la orden impresa.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { createFetchMock } from "./helpers/mockFetch.js";
import {
  idsOperacionesDe, mapaComprobantes, conComprobantesFacturas, ponerComprobantesFacturas, datosParaCfo, htmlOrdenPago,
} from "../app/lib/finanzasPagos.js";
import { datosResumenParaCfo, htmlResumenPago } from "../app/lib/finanzasResumenPago.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const E = "11111111-1111-1111-1111-111111111111";
const PDF = `https://test.supabase.co/storage/v1/object/public/reportes-obra/${E}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf`;
const FOTO = `https://test.supabase.co/storage/v1/object/public/reportes-obra/${E}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg`;
const TOKEN = "ordenordenordenordenorden0123456";

const orden = {
  id: 7, empresa_id: E, numero: 12, fecha: "2026-11-20", proveedor_nombre: "Maderas SA", total: 1000, estado: "para_aprobar", token: TOKEN,
  facturas: [
    { op_id: 41, fecha: "2026-11-10", detalle: "Factura A 0001-123", importe: 600 },
    { op_id: 42, fecha: "2026-11-12", detalle: "Factura A 0001-130", importe: 400 },
    { op_id: null, fecha: "2026-11-12", detalle: "Sin compra", importe: 0 },
  ],
  formas: [{ forma: "transferencia", importe: 1000, cuenta: "1.1.2", cuenta_nombre: "Banco" }],
};

test("idsOperacionesDe junta los op_id sin repetir y sin vacíos", () => {
  assert.deepEqual(idsOperacionesDe([orden, orden]), [41, 42]);
  assert.deepEqual(idsOperacionesDe([{ facturas: [] }, {}]), []);
});

test("mapaComprobantes: lista nueva + foto vieja, solo https, con tipo", () => {
  const m = mapaComprobantes([
    { id: 41, comprobantes: [{ url: PDF, nombre: "Factura 123.pdf", tipo: "pdf" }], comprobante_url: PDF },
    { id: 42, comprobantes: null, comprobante_url: FOTO },
    { id: 43, comprobantes: [{ url: "javascript:alert(1)", nombre: "x" }] },
  ]);
  assert.deepEqual(m[41], [{ url: PDF, nombre: "Factura 123.pdf", tipo: "pdf" }]);
  assert.equal(m[42][0].tipo, "foto");
  assert.equal(m[43], undefined);
});

test("datosParaCfo y el PDF de la orden llevan el link de cada factura", () => {
  const o = conComprobantesFacturas(orden, mapaComprobantes([{ id: 41, comprobantes: [{ url: PDF, nombre: "Factura 123.pdf" }] }]));
  const d = datosParaCfo(o, { nombre: "Gi" });
  assert.equal(d.facturas[0].comprobantes[0].url, PDF);
  assert.deepEqual(d.facturas[1].comprobantes, []);
  const html = htmlOrdenPago({ empresa: {}, orden: o });
  assert.match(html, new RegExp(`<a href="${PDF.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}">Factura 123.pdf</a>`));
  // Sin comprobantes la orden sale igual que antes
  assert.doesNotMatch(htmlOrdenPago({ empresa: {}, orden }), /📎/);
});

test("ponerComprobantesFacturas: busca por empresa e ids; sin la 187 usa la foto vieja; si falla, sigue igual", async () => {
  const pedidos = [];
  const conLista = await ponerComprobantesFacturas([orden], E, async (path) => { pedidos.push(path); return [{ id: 42, comprobantes: [{ url: PDF, nombre: "F.pdf" }] }]; });
  assert.match(pedidos[0], new RegExp(`^fin_operaciones\\?empresa_id=eq\\.${E}&id=in\\.\\(41,42\\)&select=id,comprobantes,comprobante_url$`));
  assert.equal(conLista[0].facturas[1].comprobantes[0].nombre, "F.pdf");

  const sin187 = await ponerComprobantesFacturas([orden], E, async (path) => {
    if (path.includes("comprobantes,")) throw new Error("column comprobantes does not exist");
    return [{ id: 41, comprobante_url: FOTO }];
  });
  assert.equal(sin187[0].facturas[0].comprobantes[0].url, FOTO);

  const falla = await ponerComprobantesFacturas([orden], E, async () => { throw new Error("red"); });
  assert.equal(falla[0], orden);
});

test("resumen: los PDF de las facturas van con cada orden y en el PDF del resumen", () => {
  const o = conComprobantesFacturas(orden, mapaComprobantes([{ id: 41, comprobantes: [{ url: PDF, nombre: "Factura 123.pdf" }] }]));
  const d = datosResumenParaCfo({ numero: 3, fecha: "2026-11-20" }, [o], {});
  assert.equal(d.ordenes[0].facturas_comprobantes[0].url, PDF);
  const html = htmlResumenPago({ empresa: {}, resumen: { numero: 3, fecha: "2026-11-20", estado: "borrador" }, ordenes: [o] });
  assert.match(html, />Factura 123\.pdf<\/a>/);
});

test("página del CFO (/op/<token>): muestra el link al PDF de la factura", async () => {
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/fin_ordenes_pago?token=eq."), respond: () => ({ body: [orden] }) },
    { match: (u) => u.includes("/fin_operaciones?"), respond: () => ({ body: [{ id: 41, comprobantes: [{ url: PDF, nombre: "Factura 123.pdf" }], comprobante_url: PDF }] }) },
    { match: (u) => u.includes("/empresa?"), respond: () => ({ body: [{ nombre: "Gi", logo_url: null, plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/config_sistema?"), respond: () => ({ body: [] }) },
    { match: () => true, respond: () => ({ body: [] }) },
  ]);
  const { datosOrdenCfo } = await import("../app/lib/ordenPagoCfo.js");
  const d = await datosOrdenCfo(TOKEN);
  assert.equal(d.facturas[0].comprobantes[0].url, PDF);
  const { default: Pagina } = await import("../app/op/[token]/page.jsx");
  render(await Pagina({ params: Promise.resolve({ token: TOKEN }) }));
  const link = screen.getByRole("link", { name: /Factura 123\.pdf/ });
  assert.equal(link.getAttribute("href"), PDF);
  assert.equal(link.getAttribute("target"), "_blank");
});
