// tests/flujo-adelante.test.js — Lo que viene en el flujo con lo que ya se
// sabe: cobros por OT, facturas a pagar y OC abiertas (auditoría 12/11, parte 11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cobrosDeOts, diasDePago, pagosAProveedores, pagosDeOcAbiertas } from "../app/lib/finanzasFlujoAdelante.js";
import { flujoPrevisto } from "../app/lib/finanzasFlujo.js";

const HOY = "2026-11-12";
const CUENTAS = [
  { codigo: "01.01.02", nombre: "Deudores Por Ventas" },
  { codigo: "02.01.01", nombre: "Proveedores" },
  { codigo: "01.01.01", nombre: "Caja" },
  { codigo: "05.01", nombre: "Compras" },
  { codigo: "04.01", nombre: "Ventas Generales" },
];
const op = (x) => ({ anulada_at: null, estado: "confirmada", ...x });

test("días de pago — de la condición de pago escrita", () => {
  assert.equal(diasDePago("30 días"), 30);
  assert.equal(diasDePago("30/60/90"), 30);
  assert.equal(diasDePago("Contado"), 0);
  assert.equal(diasDePago(null), 0);
  assert.equal(diasDePago("a 999 días"), 365);
});

test("facturas a pagar — las más viejas se pagan primero; lo que ya está en una orden de pago no se repite", () => {
  const ops = [
    op({ id: 1, fecha: "2026-11-01", proveedor_id: 5, total_ars: 1000, cuenta_debe: "05.01", cuenta_haber: "02.01.01", referencia: "A-1" }),
    op({ id: 2, fecha: "2026-11-05", proveedor_id: 5, total_ars: 2000, cuenta_debe: "05.01", cuenta_haber: "02.01.01", referencia: "A-2" }),
    op({ id: 3, fecha: "2026-11-06", proveedor_id: 5, total_ars: 500, cuenta_debe: "02.01.01", cuenta_haber: "01.01.01" }),
    op({ id: 4, fecha: "2026-11-07", proveedor_id: 6, total_ars: 300, cuenta_debe: "05.01", cuenta_haber: "02.01.01", estado: "para_revisar" }),
  ];
  const r = pagosAProveedores({
    ops, cuentas: CUENTAS, hoy: HOY,
    proveedores: [{ id: 5, nombre: "MADERAS SA", condicion_pago: "30 días" }],
    ordenes: [{ proveedor_id: 5, estado: "aprobada", total: 400 }, { proveedor_id: 5, estado: "pagada", total: 9999 }],
  });
  // A-1: 1000 - 500 pagado - 400 en orden = 100; A-2 entera
  assert.deepEqual(r.map((x) => [x.fecha, x.importe]), [["2026-12-01", 100], ["2026-12-05", 2000]]);
  assert.match(r[0].texto, /MADERAS SA · A-1 · vence 01\/12/);
  assert.equal(r.some((x) => /6/.test(x.texto)), false, "lo que está para revisar no entra");
});

test("OC abiertas — con IVA, cuando llegan más los días de pago; las de dólares se avisan", () => {
  const { pagos, en_dolares } = pagosDeOcAbiertas({
    hoy: HOY,
    proveedores: [{ id: 5, nombre: "MADERAS SA", plazo_dias: 3, condicion_pago: "15 días" }],
    ocs: [
      { id: 1, numero: 41, proveedor_id: 5, proveedor_nombre: "MADERAS SA", moneda: "ARS", estado: "enviada", enviada_at: "2026-11-10T12:00:00Z" },
      { id: 2, numero: 42, proveedor_id: 5, moneda: "ARS", estado: "recibida_parcial", fecha_prometida: "2026-11-20" },
      { id: 3, numero: 43, proveedor_id: 5, moneda: "USD", estado: "enviada" },
      { id: 4, numero: 44, proveedor_id: 5, moneda: "ARS", estado: "recibida_parcial", factura_numero: "A-9" },
      { id: 5, numero: 45, proveedor_id: 5, moneda: "ARS", estado: "borrador" },
    ],
    items: [
      { orden_id: 1, cantidad: 10, precio_unitario: 100, iva_alicuota: null },
      { orden_id: 2, cantidad: 2, precio_unitario: 1000, iva_alicuota: 10.5 },
      { orden_id: 4, cantidad: 1, precio_unitario: 5000 },
    ],
  });
  assert.deepEqual(pagos.map((p) => [p.fecha, p.importe]), [["2026-11-28", 1210], ["2026-12-05", 2210]]);
  assert.match(pagos[0].texto, /OC N° 41 · MADERAS SA · llega 13\/11, se paga 28\/11/);
  assert.equal(en_dolares, 1);
});

test("cobros por OT — lo que falta cobrar, para la entrega; entregada o vencida va a hoy; sin OT, más adelante", () => {
  const ops = [
    op({ id: 1, fecha: "2026-11-01", proyecto_id: 10, total_ars: 9000, cuenta_debe: "01.01.02", cuenta_haber: "04.01", origen: "venta_ot" }),
    op({ id: 2, fecha: "2026-11-03", proyecto_id: 10, total_ars: 4000, cuenta_debe: "01.01.01", cuenta_haber: "01.01.02", origen: "cobro" }),
    op({ id: 3, fecha: "2026-11-02", proyecto_id: 11, total_ars: 5000, cuenta_debe: "01.01.02", cuenta_haber: "04.01", origen: "venta_ot" }),
    op({ id: 4, fecha: "2026-11-09", proyecto_id: 11, total_ars: 5000, cuenta_debe: "04.01", cuenta_haber: "04.02", origen: "entrega_ot" }),
    op({ id: 5, fecha: "2026-11-02", proyecto_id: 12, total_ars: 700, cuenta_debe: "01.01.02", cuenta_haber: "04.01", origen: "venta_ot" }),
    op({ id: 6, fecha: "2026-10-01", total_ars: 300, cuenta_debe: "01.01.02", cuenta_haber: "04.01", origen: "saldo_inicial" }),
    op({ id: 7, fecha: "2026-11-02", proyecto_id: 13, total_ars: 800, cuenta_debe: "01.01.02", cuenta_haber: "04.01", origen: "venta_ot", anulada_at: "x" }),
  ];
  const { cobros } = cobrosDeOts({
    ops, cuentas: CUENTAS, hoy: HOY,
    proyectos: [{ id: 10, ot: "7961", cliente: "RIOFRIO", fecha_entrega: "2026-11-30" }, { id: 11, ot: "7942", cliente: "CEVT" }, { id: 12, ot: "7860", cliente: "CEVT" }],
  });
  assert.deepEqual(cobros.map((c) => [c.fecha, c.importe]), [["2026-11-30", 5000], [HOY, 5000], [null, 700], [null, 300]]);
  assert.match(cobros[0].texto, /7961.*entrega 30\/11/);
  assert.match(cobros[1].texto, /entregada el 09\/11/);
  assert.match(cobros[2].texto, /sin fecha de entrega/);
});

test("flujo previsto — los tres renglones nuevos, con su signo; sin fecha va a Después", () => {
  const p = flujoPrevisto({
    hoy: HOY, saldoHoy: 10000,
    cobros: [{ fecha: "2026-11-30", importe: 5000, texto: "OT 7961" }, { fecha: null, importe: 700, texto: "sin fecha" }],
    aPagar: [{ fecha: "2026-11-01", importe: 100, texto: "vencida" }],
    ocs: [{ fecha: "2026-11-28", importe: 1210, texto: "OC 41" }],
  });
  const fila = (id) => p.filas.find((f) => f.id === id);
  assert.equal(fila("cobros").valores[3], 5000, "semana del 30/11");
  assert.equal(fila("cobros").despues, 700);
  assert.equal(fila("a_pagar").valores[0], -100, "lo vencido, en la primera semana");
  assert.equal(fila("ocs").valores[2], -1210);
  assert.equal(p.saldo[0], 9900);
  assert.equal(p.saldo[2], 9900 - 1210);
  assert.equal(p.saldo[3], 9900 - 1210 + 5000);
});
