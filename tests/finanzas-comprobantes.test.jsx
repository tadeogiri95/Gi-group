// tests/finanzas-comprobantes.test.jsx — Finanzas (11/11): el mismo
// comprobante no entra dos veces, venga de Mi caja, de Cargar un gasto, de una
// factura de OC o del S.O.S; y la pantalla de Mi caja con los datos del ticket.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { claveComprobante, mismoComprobante, comprobanteRepetido, movimientoParecido, avisoRepetido } from "../app/lib/finanzasComprobantes.js";
import { importesTicket, referenciaTicket, validarMovimientoMiCaja, resumenMiCaja } from "../app/lib/finanzasMiCaja.js";
import { compararSos } from "../app/lib/finanzasSos.js";

afterEach(() => cleanup());
const { default: MiCaja } = await import("../app/components/MiCaja.jsx");

const CAJA = { cuenta: "01.01.01.001.001.02", nombre: "Caja Juan", tipo: "caja", moneda: "ARS", activa: true };
const CONCEPTOS = { gastos: [{ codigo: "COMPRAS", nombre: "Compra con o sin factura", cuenta: "05.01", grupo: "Compras" }], ingresos: [] };

test("número del comprobante — se entiende escrito de cualquier forma", () => {
  assert.deepEqual(claveComprobante("A 00003-00012345"), { clase: "FC", letra: "A", pv: 3, numero: 12345 });
  assert.deepEqual(claveComprobante("FC A-00003-00012345"), { clase: "FC", letra: "A", pv: 3, numero: 12345 });
  assert.deepEqual(claveComprobante("NC B-3-12"), { clase: "NC", letra: "B", pv: 3, numero: 12 });
  assert.deepEqual(claveComprobante("0003-00012345"), { clase: "FC", letra: null, pv: 3, numero: 12345 });
  assert.deepEqual(claveComprobante("000300012345"), { clase: "FC", letra: null, pv: 3, numero: 12345 });
  assert.deepEqual(claveComprobante("12345"), { clase: "FC", letra: null, pv: null, numero: 12345 });
  assert.deepEqual(claveComprobante("Sin factura (comprobante 778)"), { clase: "FC", letra: null, pv: null, numero: 778 });
  for (const nada of ["", null, "GY-F-12", "FS-3", "Libro, renglón 40", "sin número"]) assert.equal(claveComprobante(nada), null, String(nada));
});

test("mismo comprobante — lo que no se sabe no separa; letra, punto de venta o clase distintos sí", () => {
  assert.ok(mismoComprobante("A 00003-00012345", "FC A-00003-00012345"));
  assert.ok(mismoComprobante("A 00003-00012345", "3-12345"), "una compra cargada sin letra");
  assert.ok(mismoComprobante("A 00003-00012345", "12345"), "solo el número de un lado");
  assert.ok(!mismoComprobante("12345", "12345"), "solo el número de los dos lados: muy poco");
  assert.ok(!mismoComprobante("A 00003-00012345", "B 00003-00012345"));
  assert.ok(!mismoComprobante("A 00003-00012345", "A 00004-00012345"));
  assert.ok(!mismoComprobante("FC A-00003-00012345", "NC A-00003-00012345"));
});

test("comprobante repetido — mismo número y mismo proveedor, por id o por nombre; anuladas no cuentan", () => {
  const proveedores = [{ id: 7, nombre: "Ferretería Centro SRL" }, { id: 8, nombre: "YPF SA" }];
  const ops = [
    { id: 1, fecha: "2026-10-30", origen: "gasto", referencia: "A 00004-00001234", proveedor_id: 7 },
    { id: 2, fecha: "2026-10-31", origen: "sos", referencia: "FC B-00001-00000099", proveedor_id: null, entidad: "KIOSCO EL SOL" },
    { id: 3, fecha: "2026-10-31", origen: "mi_caja", referencia: "C 00002-00000055", proveedor_id: 8, anulada_at: "2026-11-01T00:00:00Z" },
  ];
  assert.equal(comprobanteRepetido({ referencia: "A 00004-00001234", proveedor_id: 7 }, ops, proveedores)?.id, 1);
  assert.equal(comprobanteRepetido({ referencia: "A 00004-00001234", entidad: "FERRETERIA CENTRO S.R.L." }, ops, proveedores)?.id, 1, "escrito a mano, mismo nombre");
  assert.equal(comprobanteRepetido({ referencia: "A 00004-00001234", proveedor_id: 8 }, ops, proveedores), null, "el mismo número de otro proveedor es otra factura");
  assert.equal(comprobanteRepetido({ referencia: "B 00001-00000099", entidad: "Kiosco El Sol" }, ops, proveedores)?.id, 2);
  assert.equal(comprobanteRepetido({ referencia: "C 00002-00000055", proveedor_id: 8 }, ops, proveedores), null, "la anulada no cuenta");
  assert.equal(comprobanteRepetido({ referencia: null, proveedor_id: 7 }, ops, proveedores), null);
  assert.equal(avisoRepetido(ops[0], "Esa factura"), "Esa factura ya está cargada (del 30/10/2026, como gasto).");
  assert.equal(avisoRepetido(ops[1], "Este ticket"), "Este ticket ya está cargado (del 31/10/2026, desde el S.O.S Contador).");
});

test("movimiento parecido — misma caja, mismo importe y hasta 3 días: el más cercano", () => {
  const ops = [
    { id: 1, fecha: "2026-10-25", total: 8000, cuenta_haber: CAJA.cuenta },
    { id: 2, fecha: "2026-10-30", total: 8000, cuenta_haber: CAJA.cuenta },
    { id: 3, fecha: "2026-11-01", total: 8000, cuenta_haber: "01.01.01.001.001.01" },
    { id: 4, fecha: "2026-11-01", total: 8000.5, cuenta_haber: CAJA.cuenta },
    { id: 5, fecha: "2026-11-01", total: 8000, cuenta_debe: CAJA.cuenta, cuenta_haber: "04.01" },
  ];
  const nuevo = { fecha: "2026-11-01", total: 8000, cuenta_debe: "05.01", cuenta_haber: CAJA.cuenta };
  assert.equal(movimientoParecido(nuevo, ops, CAJA.cuenta)?.id, 2);
  assert.equal(movimientoParecido({ ...nuevo, fecha: "2026-11-10" }, ops, CAJA.cuenta), null);
});

test("Mi caja — el número va como en Cargar un gasto y el IVA solo si cierra con el total", () => {
  assert.equal(referenciaTicket({ letra: "A", punto_venta: "4", numero: "1234" }), "A 00004-00001234");
  assert.equal(referenciaTicket({ letra: "", punto_venta: "4", numero: "1234" }), "00004-00001234");
  assert.equal(referenciaTicket({ numero: "778" }), "778");
  assert.equal(referenciaTicket({ letra: "A" }), null);
  assert.deepEqual(importesTicket({ letra: "A", neto: 10000, iva: 2100 }, 12100), { neto: 10000, iva: 2100, otros: 0, letra: "A" });
  assert.deepEqual(importesTicket({ letra: "A", neto: 10000, iva: 2100 }, 15000), { neto: 15000, iva: 0, otros: 0, letra: "A" }, "corrigió el importe: todo al neto");
  assert.deepEqual(importesTicket({ letra: "B", neto: 10000, iva: 2100 }, 12100), { neto: 12100, iva: 0, otros: 0, letra: "B" });
  assert.deepEqual(importesTicket({ letra: "B", neto: 11900, otros_impuestos: 200 }, 12100), { neto: 11900, iva: 0, otros: 200, letra: "B" }, "percepción aparte");
});

test("Mi caja — el comercio que no está en la lista queda escrito con su CUIT; un CUIT mal escrito no pasa", () => {
  const ctx = { caja: CAJA, conceptos: CONCEPTOS, hoy: "2026-11-11", proveedores: [{ id: 7, nombre: "Ferretería Centro SRL", cuit: "30711222339" }] };
  const base = { clase: "gasto", concepto: "COMPRAS", importe: 500, fecha: "2026-11-10" };
  const { op } = validarMovimientoMiCaja({ ...base, comercio: "Kiosco El Sol", cuit: "20123456786" }, ctx);
  assert.deepEqual([op.proveedor_id, op.entidad, op.referencia], [null, "Kiosco El Sol", null]);
  assert.match(op.descripcion, /Kiosco El Sol · CUIT 20-12345678-6/);
  assert.equal(validarMovimientoMiCaja({ ...base, cuit: "30711222339" }, ctx).op.proveedor_id, 7, "por CUIT aunque no escriba el nombre");
  assert.equal(validarMovimientoMiCaja({ ...base, proveedor_id: 999, comercio: "Otro" }, ctx).op.proveedor_id, null, "un proveedor que no es de la empresa no se usa");
  assert.match(validarMovimientoMiCaja({ ...base, cuit: "123" }, ctx).errores[0], /CUIT/);
});

test("S.O.S — una factura ya cargada desde Mi caja queda «ya está», aunque no toque Proveedores", () => {
  const filas = [
    { clave: "sos30711222339FCA0000400001234", renglon: 2, fecha: "2026-11-05", cuit: "30711222339", nombre: "FERRETERIA CENTRO SRL", clase: "FC", letra: "A", pv: 4, numero: 1234, comprobante: "A-00004-00001234", total: 12100, signo: 1, moneda: "ARS" },
    { clave: "sos30711222339FCA0000400001235", renglon: 3, fecha: "2026-11-05", cuit: "30711222339", nombre: "FERRETERIA CENTRO SRL", clase: "FC", letra: "A", pv: 4, numero: 1235, comprobante: "A-00004-00001235", total: 900, signo: 1, moneda: "ARS" },
  ];
  const conComprobante = [{ id: 60, fecha: "2026-11-01", origen: "mi_caja", referencia: "A 00004-00001234", proveedor_id: 7, total_ars: 12100, cuenta_debe: "05.01", cuenta_haber: CAJA.cuenta }];
  const out = compararSos(filas, { operaciones: [], proveedores: [{ id: 7, nombre: "Ferretería Centro SRL", cuit: "30-71122233-9" }], cuentasProv: new Set(["02.01"]), conComprobante });
  assert.deepEqual(out.map((f) => [f.estado, f.op_id ?? null]), [["ya_esta", 60], ["nueva", null]]);
});

// ─── Pantalla ───

function abrirGasto(respuestas) {
  const datos = { cajas: [{ ...resumenMiCaja([], CAJA), destinos: [] }], conceptos: CONCEPTOS, hoy: "2026-11-11" };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    enviados.push(JSON.parse(o.body));
    const [status, body] = respuestas.shift() || [200, { ok: true }];
    return new Response(JSON.stringify(body), { status });
  };
  const hecho = [];
  render(<MiCaja datos={datos} onClose={() => {}} onCambio={() => hecho.push(1)} />);
  fireEvent.click(screen.getByText("➖ Gasté"));
  return { enviados, hecho };
}

test("Mi caja — comercio y número de factura a mano, y se mandan al guardar", async () => {
  const { enviados } = abrirGasto([]);
  fireEvent.click(screen.getByText(/Comercio y número de factura/));
  fireEvent.change(screen.getByLabelText("Comercio"), { target: { value: "Ferretería Centro" } });
  fireEvent.change(screen.getByLabelText("Letra"), { target: { value: "A" } });
  fireEvent.change(screen.getByLabelText("Punto de venta"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("Número"), { target: { value: "1234" } });
  fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "12.100" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  const b = enviados[0];
  assert.deepEqual([b.accion, b.concepto, b.importe, b.comercio, b.letra, b.punto_venta, b.numero], ["cargar", "COMPRAS", 12100, "Ferretería Centro", "A", "4", "1234"]);
});

test("Mi caja — si ya hay uno igual pregunta: «es el mismo» no guarda, «es otro» guarda", async () => {
  const pregunta = [409, { error: "Ya hay uno igual en esta caja: $ 500,00 del 10/11/2026. ¿Es otro?", parecido: true }];
  const { enviados, hecho } = abrirGasto([pregunta, pregunta]);
  fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "500" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  assert.ok(await screen.findByText(/Ya hay uno igual en esta caja/));
  fireEvent.click(screen.getByRole("button", { name: "No, es el mismo" }));
  assert.equal(screen.queryByText(/Ya hay uno igual/), null);
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Sí, es otro: guardar" }));
  await waitFor(() => assert.equal(enviados.length, 3));
  assert.equal(enviados[0].igual_confirmado, undefined);
  assert.equal(enviados[2].igual_confirmado, true);
  await waitFor(() => assert.equal(hecho.length, 1));
});
