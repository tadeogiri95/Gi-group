// tests/cc-medio-pago-entregas.test.jsx — Resúmenes de cuenta (22/11, sin
// migración): el medio de pago de cada cobro y pago, y las OT del cliente
// separadas en entregadas y pendientes de entrega. Datos de mentira.
import "./helpers/domSetup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { medioDePago } from "../app/lib/finanzasTipos.js";
import { cuentasPorOt, repartoEntrega, resumirCliente } from "../app/lib/finanzasOtClientes.js";
import { estadoCliente, estadoProveedor, htmlEstadoCuenta } from "../app/lib/finanzasEstadoCuenta.js";

const DEU = "01.01.02.001.001";
const PROV = "02.01.01.001.001";
const BANCO = "01.01.01.003.002";
const CAJA = "01.01.01.001.001";
const DOLARES = "01.01.01.002.001";
const CARTERA = "01.01.01.022.002";
const TESORERIA = [
  { cuenta: BANCO, nombre: "Galicia", tipo: "banco", moneda: "ARS" },
  { cuenta: CAJA, nombre: "Caja chica", tipo: "caja", moneda: "ARS" },
  { cuenta: DOLARES, nombre: "Caja dólares", tipo: "caja", moneda: "USD" },
];
const CUENTAS = [{ codigo: CARTERA, nombre: "Valores a depositar" }, { codigo: DEU, nombre: "Deudores por Ventas" }];
const ctx = { tesoreria: TESORERIA, cuentas: CUENTAS };

test("medio de pago — transferencia con el banco, efectivo, dólares, cheque, compensación; nada si no hubo plata", () => {
  assert.equal(medioDePago({ cuenta_debe: BANCO, cuenta_haber: DEU }, ctx), "Transferencia · Galicia");
  assert.equal(medioDePago({ cuenta_debe: PROV, cuenta_haber: BANCO }, ctx), "Transferencia · Galicia");
  assert.equal(medioDePago({ cuenta_debe: CAJA, cuenta_haber: DEU }, ctx), "Efectivo");
  assert.equal(medioDePago({ cuenta_debe: DOLARES, cuenta_haber: DEU }, ctx), "Dólares");
  assert.equal(medioDePago({ cuenta_debe: CARTERA, cuenta_haber: DEU }, ctx), "Cheque o e-cheq");
  assert.equal(medioDePago({ cuenta_debe: PROV, cuenta_haber: DEU, origen: "compensacion" }, ctx), "Compensación");
  assert.equal(medioDePago({ cuenta_debe: DEU, cuenta_haber: "04.01.01.001.001" }, ctx), "", "una venta no tiene medio");
});

test("cuenta por OT — cada OT dice si se entregó y cuándo; cada cobro su medio", () => {
  const [c] = cuentasPorOt({
    proyectos: [
      { id: 1, ot: "7001", cliente: "Hotel Norte", estado: "cerrado", created_at: "2026-09-01T12:00:00Z" },
      { id: 2, ot: "7002", cliente: "Hotel Norte", estado: "", created_at: "2026-10-01T12:00:00Z" },
    ],
    precios: new Map([["7001", 1000], ["7002", 500]]),
    ops: [{ id: 9, fecha: "2026-10-05", entidad: "Hotel Norte", total_ars: 300, cuenta_debe: BANCO, cuenta_haber: DEU }],
    cuentasDeu: new Set([DEU]),
    clientes: [],
    entregas: new Map([["p1", "2026-09-30"]]),
    medioDe: (op) => medioDePago(op, ctx),
  });
  assert.deepEqual(c.ots.map((o) => [o.ot, o.entregada, o.entrega]), [["7001", true, "2026-09-30"], ["7002", false, ""]]);
  assert.equal(c.cobros[0].medio, "Transferencia · Galicia");
});

test("resumen — cuánto del saldo es de OT entregadas y cuánto de las que faltan entregar; los cobros sin OT pagan primero las entregadas", () => {
  const filas = [
    { valor: 1000, cobrado: 200, saldo: 800, entregada: true },
    { valor: 500, cobrado: 600, saldo: -100, entregada: false },
    { valor: 400, cobrado: 0, saldo: 400, entregada: false },
  ];
  const r = repartoEntrega(filas, 300);
  assert.deepEqual(r.entregadas, { n: 1, valor: 1000, cobrado: 200, saldo: 400 }, "300 sueltos + 100 de más van a la entregada");
  assert.deepEqual(r.pendientes, { n: 2, valor: 900, cobrado: 600, saldo: 400 });
  assert.equal(r.a_favor, 0);
  assert.equal(r.entregadas.saldo + r.pendientes.saldo - r.a_favor, 1900 - 800 - 300, "suma el saldo de siempre");
  const sobra = repartoEntrega([{ valor: 100, cobrado: 0, saldo: 100, entregada: true }], 150);
  assert.deepEqual([sobra.entregadas.saldo, sobra.a_favor], [0, 50]);
  const res = resumirCliente({ ots: [{ proyecto_id: 1, ot: "1", valor: 100, fecha: "2026-01-01", entregada: true }], cobros: [] });
  assert.equal(res.entregadas.saldo, 100);
});

const CLI = {
  nombre: "Constructora Ejemplo",
  ots: [
    { proyecto_id: 1, ot: "7795", obra: "Edificio Norte", descripcion: "Cocina", fecha: "2026-08-05", valor: 1000, entregada: false },
    { proyecto_id: 2, ot: "7796", obra: "Edificio Norte", descripcion: "Placares", fecha: "2026-09-02", valor: 500, entregada: true, entrega: "2026-09-25" },
    { proyecto_id: 3, ot: "7797", obra: "Casa Sur", descripcion: "Baño", fecha: "2026-10-03", valor: 300, entregada: true, entrega: "2026-10-20" },
  ],
  cobros: [
    { fecha: "2026-08-12", importe: 200, proyecto_id: 1, medio: "Efectivo" },
    { fecha: "2026-10-01", importe: 700, proyecto_id: null, medio: "Transferencia · Galicia" },
  ],
};

test("estado de cuenta del cliente — el medio en cada pago; entregadas con lo que deben y pendientes de entrega con su anticipo", () => {
  const s = estadoCliente(CLI, { hoy: "2026-11-20" });
  assert.equal(s.movimientos.find((m) => m.abono === 200).detalle, "Efectivo · OT 7795 · Edificio Norte · Cocina");
  assert.equal(s.movimientos.find((m) => m.abono === 700).detalle, "Transferencia · Galicia");
  // El pago suelto de 700 va primero a las entregadas más viejas: 7796 (500) y 7797 (200 de 300)
  assert.deepEqual(s.entrega.entregadas.map((p) => [p.concepto.slice(0, 7), p.entrega, p.importe, p.pagado, p.falta, p.dias]), [["OT 7797", "2026-10-20", 300, 200, 100, 31]]);
  assert.deepEqual(s.entrega.por_entregar.map((p) => [p.concepto.slice(0, 7), p.importe, p.pagado, p.falta]), [["OT 7795", 1000, 200, 800]]);
  assert.deepEqual([s.entrega.falta_entregadas, s.entrega.falta_por_entregar, s.entrega.a_favor], [100, 800, 0]);
  assert.equal(s.entrega.falta_entregadas + s.entrega.falta_por_entregar, s.saldo, "explica el saldo");
  // Al 30/09 la 7797 no existía y la 7796 ya estaba entregada; al 20/09, todavía no
  const antes = estadoCliente(CLI, { hasta: "2026-09-20", hoy: "2026-11-20" });
  assert.deepEqual(antes.entrega.por_entregar.map((p) => p.concepto.slice(0, 7)), ["OT 7795", "OT 7796"]);
  assert.equal(antes.entrega.entregadas.length, 0);
});

test("la hoja — secciones de entregadas y pendientes de entrega, y el medio de los pagos al proveedor", () => {
  const cliente = estadoCliente(CLI, { hoy: "2026-11-20" });
  const proveedor = estadoProveedor([
    { op: { fecha: "2026-10-01", referencia: "0005-00012001" }, compra: 1000, pago: 0 },
    { op: { fecha: "2026-10-15", referencia: "OP 12" }, compra: 0, pago: 400, medio: "Cheque o e-cheq" },
  ], { hoy: "2026-11-20" });
  assert.equal(proveedor.movimientos[1].detalle, "N° OP 12 · Cheque o e-cheq");
  const html = htmlEstadoCuenta({ empresa: { nombre: "Muebles" }, nombre: "Constructora Ejemplo", cliente, hoy: "2026-11-20" });
  assert.match(html, /OT entregadas con saldo pendiente/);
  assert.match(html, /OT pendientes de entrega/);
  assert.match(html, /corresponde a OT ya entregadas/);
  assert.match(html, /Transferencia · Galicia/);
  assert.doesNotMatch(html, /Pendiente de pago al/, "del cliente se reemplaza por las dos listas");
  const htmlProv = htmlEstadoCuenta({ empresa: {}, nombre: "Proveedor", proveedor, hoy: "2026-11-20" });
  assert.match(htmlProv, /Pendiente de pago al/);
  assert.match(htmlProv, /Cheque o e-cheq/);
});
