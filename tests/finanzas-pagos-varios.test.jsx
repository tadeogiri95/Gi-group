// tests/finanzas-pagos-varios.test.jsx — 19/11 (pedido de Tadeo): en ➕
// Cargar, "Pagos" (varios a la vez, cada uno con su comprobante). Se pagan ya
// o van en una orden de pago para el CFO, que se paga cuando la firma.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  erroresPagos, ordenesDePagos, renglonPagoVacio, textoResultadoPagos, totalPagos,
} from "../app/lib/finanzasPagosVarios.js";
import { DOCUMENTOS } from "../app/components/FinanzasCargar.jsx";

afterEach(() => cleanup());
const { default: PagosVarios } = await import("../app/components/FinanzasPagosVarios.jsx");

const CAJA = { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true };
const BANCO = { cuenta: "01.01.01.003.002", nombre: "Banco Credicoop", tipo: "banco", moneda: "ARS", activa: true };
const CHEQUE = { id: 31, importe: 250000, banco: "Galicia", numero: "123", fecha_pago: "2026-12-01", clase: "tercero", estado: "en_cartera" };
const PDF = { url: "https://x/f.pdf", nombre: "factura.pdf", tipo: "pdf" };

test("en ➕ Cargar dice Pagos, no Pago a un proveedor", () => {
  const d = DOCUMENTOS.find((x) => x.id === "pago");
  assert.equal(d.nombre, "Pagos");
  assert.match(d.detalle, /CFO/);
});

test("renglón vacío: con un solo banco ya viene elegido", () => {
  const r = renglonPagoVacio({ proveedorId: 5, cajas: [CAJA], bancos: [BANCO] });
  assert.deepEqual([r.proveedor, r.forma, r.cuenta], ["5", "transferencia", BANCO.cuenta]);
  assert.equal(renglonPagoVacio({ cajas: [CAJA], bancos: [] }).cuenta, CAJA.cuenta, "sin banco, efectivo de la única caja");
});

test("lo que falta en cada pago, el total y el cheque repetido", () => {
  const rs = [
    { proveedor: "5", forma: "transferencia", cuenta: BANCO.cuenta, importe: "1.500,50" },
    { proveedor: "", forma: "efectivo", cuenta: "", importe: "" },
    { proveedor: "6", forma: "cheque_tercero", cheque_id: "31" },
    { proveedor: "7", forma: "cheque_tercero", cheque_id: "31" },
    { proveedor: "8", forma: "echeq", importe: "100" },
  ];
  assert.deepEqual(erroresPagos(rs, { cheques: [CHEQUE], fecha: "2026-11-19" }), [
    "Pago 2: elegí el proveedor", "Pago 2: poné el importe", "Pago 2: elegí la caja",
    "Pago 4: ese cheque ya está en otro pago", "Pago 5: falta cuándo vence el e-cheq",
  ]);
  assert.equal(totalPagos(rs, [CHEQUE]), 1500.5 + 250000 + 250000 + 100);
  assert.deepEqual(erroresPagos([], { fecha: "" }), ["Falta la fecha", "Agregá al menos un pago"]);
});

test("una orden por pago, con su comprobante y la nota", () => {
  const [a, b] = ordenesDePagos([
    { proveedor: "5", forma: "transferencia", cuenta: BANCO.cuenta, importe: "1.500,50", nota: "Fc A 12", comprobantes: [PDF] },
    { proveedor: "6", forma: "cheque_tercero", cheque_id: "31", importe: "999", comprobantes: [] },
  ], { fecha: "2026-11-19", notas: "Semana 47" });
  assert.deepEqual(a, {
    proveedor_id: 5, fecha: "2026-11-19", notas: "Fc A 12 · Semana 47", facturas: [],
    formas: [{ forma: "transferencia", importe: 1500.5, cuenta: BANCO.cuenta }], adjuntos: [PDF],
  });
  assert.deepEqual(b.formas, [{ forma: "cheque_tercero", cheque_id: "31" }], "el cheque va por su importe, no el escrito");
  assert.equal(b.adjuntos, undefined);
});

test("aviso al terminar", () => {
  assert.equal(textoResultadoPagos({ pagados: 2 }), "2 pagos guardados");
  assert.match(textoResultadoPagos({ pagados: 1, aElegir: [14] }), /^1 pago guardado\. La orden N° 14 quedó en Órdenes de pago/);
});

const DATOS = {
  tesoreria: [CAJA, BANCO], cheques: [CHEQUE], proveedores: [{ id: 5, nombre: "ACERCO S A", activo: true }, { id: 6, nombre: "EGGER", activo: true }],
  cfo: { nombre: "Laura", telefono: "3515551234" }, empresa: { nombre: "Gi Group" },
};

function mockPagos({ elegir = false } = {}) {
  const pedidos = [];
  let n = 40;
  global.fetch = async (url, o) => {
    if (o?.method !== "POST") return new Response(JSON.stringify({ pares: [] }), { status: 200 });
    const b = JSON.parse(o.body);
    pedidos.push(b);
    if (b.accion === "crear") { n += 1; return new Response(JSON.stringify({ orden: { id: n, numero: n, estado: "borrador", fecha: b.orden.fecha, formas: b.orden.formas } }), { status: 200 }); }
    if (b.accion === "pagar") return elegir ? new Response(JSON.stringify({ error: "elegí", elegir: [{ id: 1 }] }), { status: 409 }) : new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (b.accion === "resumen_crear") return new Response(JSON.stringify({ ok: true, resumen: { id: 9, numero: 3 }, url: "https://gypi/op/resumen/t" }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  return pedidos;
}

async function cargarDos() {
  fireEvent.change(screen.getByLabelText("Proveedor del pago 1"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Importe del pago 1"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "＋ Otro pago" }));
  fireEvent.change(screen.getByLabelText("Proveedor del pago 2"), { target: { value: "6" } });
  fireEvent.change(screen.getByLabelText("Con qué se paga el pago 2"), { target: { value: "cheque_tercero" } });
  fireEvent.change(screen.getByLabelText("Cheque de la cartera del pago 2"), { target: { value: "31" } });
}

test("💸 Guardar pagos: crea y paga cada uno en el momento", async () => {
  const pedidos = mockPagos();
  let hecho = 0;
  render(<PagosVarios datos={DATOS} onCerrar={() => {}} onHecho={() => { hecho++; }} />);
  await cargarDos();
  assert.match(screen.getByText(/^Total:/).textContent, /251\.000,00/);
  fireEvent.click(screen.getByRole("button", { name: "💸 Guardar pagos" }));
  await waitFor(() => assert.equal(hecho, 1));
  assert.deepEqual(pedidos.map((p) => p.accion), ["crear", "pagar", "crear", "pagar"]);
  assert.equal(pedidos[0].orden.formas[0].cuenta, BANCO.cuenta);
  assert.deepEqual(pedidos[2].orden.formas, [{ forma: "cheque_tercero", cheque_id: "31" }]);
});

test("💸 Guardar pagos: si el pago ya puede estar en el banco, la orden queda para elegir", async () => {
  mockPagos({ elegir: true });
  let hecho = 0;
  render(<PagosVarios datos={DATOS} onCerrar={() => {}} onHecho={() => { hecho++; }} />);
  fireEvent.change(screen.getByLabelText("Proveedor del pago 1"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Importe del pago 1"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "💸 Guardar pagos" }));
  await waitFor(() => assert.equal(hecho, 1, "la orden ya está creada: no queda en la ventana para no repetirla"));
});

test("📋 Armar orden de pago para el CFO: órdenes sin pagar, en un resumen mandado por WhatsApp", async () => {
  const pedidos = mockPagos();
  const abiertos = [];
  global.window.open = (u) => { abiertos.push(u); };
  let hecho = 0;
  render(<PagosVarios datos={DATOS} onCerrar={() => {}} onHecho={() => { hecho++; }} />);
  await cargarDos();
  fireEvent.click(screen.getByRole("button", { name: "📋 Armar orden de pago para el CFO" }));
  await waitFor(() => assert.equal(hecho, 1));
  assert.deepEqual(pedidos.map((p) => p.accion), ["crear", "crear", "resumen_crear"], "no paga nada: se paga cuando el CFO firma");
  assert.deepEqual(pedidos[2].resumen.ordenes, [41, 42]);
  assert.equal(pedidos[2].mandar, true);
  assert.match(decodeURIComponent(abiertos[0]), /wa\.me\/.*Hola Laura.*resumen de órdenes de pago N° 3/s);
});

test("con lo que falta, avisa y no manda nada", async () => {
  const pedidos = mockPagos();
  render(<PagosVarios datos={DATOS} onCerrar={() => {}} onHecho={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "💸 Guardar pagos" }));
  assert.match(screen.getByRole("alert").textContent, /Pago 1: elegí el proveedor/);
  assert.equal(pedidos.length, 0);
});
