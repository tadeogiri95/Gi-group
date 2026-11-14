// tests/finanzas-consumo-ot.test.js — etapa 5 de la auditoría de Finanzas
// integrada (14/11): el consumo de materiales al entregar la OT y las
// entregas estimadas de las OT sin precio entran al libro.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planConsumos, planEstimadas, otsParaCalcular, cuentasConsumo, clientesNuevosDe,
  ORIGEN_CONSUMO, ORIGEN_ESTIMADA, TIPO_CONSUMO, DIAS_CORREGIR,
} from "../app/lib/finanzasConsumoOt.js";
import { entregasDeOts, ORIGEN_ENTREGA } from "../app/lib/finanzasVentas.js";
import { estadoResultados } from "../app/lib/finanzasResultados.js";
import { pendientesFinanzas } from "../app/lib/finanzasInicio.js";
import { puedeConfirmar, puedeAnular, dondeSeCambia } from "../app/lib/finanzasCorregir.js";
import { ORIGENES_NO_GASTO } from "../app/lib/costoReal.js";
import { ORIGENES } from "../app/lib/finanzasOperaciones.js";

const CUENTAS = { costo: "04.02.01.001.009", materias: "01.01.04.001.002" };
const VENTA = { deudores: "01.01.02.001.001", entregas: "04.01.01.001.002" };
const OT = (id, extra = {}) => ({ id, ot: `M-${id}`, cliente: "Hotel Norte", obra: "Torre", descripcion: "Cocina", division: "MUEBLES", ...extra });
const HOY = "2026-11-14";

test("cuentas del consumo — por nombre, y avisa si falta alguna", () => {
  const plan = [
    { codigo: "04.02.01.001.009", nombre: "Costo De Mercaderia Vendida" },
    { codigo: "01.01.04.001.002", nombre: "Materias Primas" },
    { codigo: "01.01.04.001.003", nombre: "Materias Primas Varias" },
  ];
  assert.deepEqual(cuentasConsumo(plan), CUENTAS);
  assert.match(cuentasConsumo(plan.slice(1)).error, /Costo De Mercaderia Vendida/);
});

test("consumo — al entregar la OT: Costo de Mercadería Vendida contra Materias Primas, con su costo real", () => {
  const r = planConsumos({
    proyectos: [OT(1), OT(2)], entregas: new Map([["p1", "2026-11-10"], ["p2", "2026-11-11"]]),
    materiales: new Map([["p1", 250000.456], ["p2", 0]]), operaciones: [], cuentas: CUENTAS, centro: () => "MADERA", hoy: HOY,
  });
  assert.equal(r.crear.length, 1, "sin materiales no hay consumo");
  const c = r.crear[0];
  assert.deepEqual([c.cuenta_debe, c.cuenta_haber, c.total, c.fecha, c.tipo, c.origen, c.origen_id, c.estado, c.proyecto_id, c.centro_costo],
    [CUENTAS.costo, CUENTAS.materias, 250000.46, "2026-11-10", TIPO_CONSUMO, ORIGEN_CONSUMO, "p1", "confirmada", 1, "MADERA"]);
  assert.match(c.descripcion, /^Consumo de materiales/);
});

test("consumo — corrige el importe, anula si la OT se reabre y no recrea lo anulado a mano", () => {
  const ops = [
    { id: 10, origen_id: "p1", fecha: "2026-11-10", total: 100 },
    { id: 11, origen_id: "p2", fecha: "2026-11-10", total: 100 },
    { id: 12, origen_id: "p3", fecha: "2026-11-10", total: 100, anulada_at: "x", anulada_por_nombre: "Tadeo" },
  ];
  const r = planConsumos({
    proyectos: [OT(1), OT(2), OT(3)], entregas: new Map([["p1", "2026-11-10"], ["p3", "2026-11-10"]]),
    materiales: new Map([["p1", 150], ["p3", 500]]), operaciones: ops, cuentas: CUENTAS, hoy: HOY,
  });
  assert.deepEqual(r.corregir, [{ id: 10, cambios: { neto: 150, total: 150, total_ars: 150 } }]);
  assert.deepEqual(r.anular, [{ id: 11, motivo: "Gypi (la OT se volvió a abrir)" }]);
  assert.equal(r.crear.length, 0);
});

test("consumo — pasados los días de corrección, el importe queda fijo y no se recalcula", () => {
  const viejo = "2026-08-01";
  const ops = [{ id: 10, origen: ORIGEN_CONSUMO, origen_id: "p1", fecha: viejo, total: 100 }];
  const entregas = new Map([["p1", viejo], ["p2", viejo], ["p3", "2026-11-01"]]);
  assert.deepEqual([...otsParaCalcular({ entregas, operaciones: ops, hoy: HOY })], ["p3"]);
  const r = planConsumos({ proyectos: [OT(1)], entregas, materiales: new Map([["p1", 999]]), operaciones: ops, cuentas: CUENTAS, hoy: HOY });
  assert.deepEqual([r.corregir.length, r.anular.length], [0, 0]);
  assert.equal(DIAS_CORREGIR, 60);
});

test("entregas de las OT — las con precio por su entrega, las sin precio por la estimada", () => {
  const ops = [
    { id: 1, origen: ORIGEN_ENTREGA, origen_id: "p1", fecha: "2026-11-02" },
    { id: 2, origen: ORIGEN_ENTREGA, origen_id: "p2", fecha: "2026-11-03" },
    { id: 3, origen: "venta_ot", origen_id: "p4", fecha: "2026-11-03" },
  ];
  const plan = { crear: [{ origen: ORIGEN_ENTREGA, origen_id: "p5", fecha: "2026-11-14" }], anular: [{ id: 2 }] };
  const m = entregasDeOts(ops, plan, { p6: "2026-11-12", p1: "2026-01-01" });
  assert.deepEqual([...m], [["p1", "2026-11-02"], ["p5", "2026-11-14"], ["p6", "2026-11-12"]]);
});

test("entrega estimada — para revisar, Deudores contra Entregas, con el cliente de la OT", () => {
  const clientes = [{ id: 7, nombre: "HOTEL NORTE", activo: true }];
  const r = planEstimadas({
    proyectos: [OT(1), OT(2, { cliente: "Nuevo SRL" })], fechas: { p1: "2026-11-10", p2: "2026-11-11" },
    valores: new Map([["p1", 300000], ["p2", 100]]), operaciones: [], clientes, cuentas: VENTA, hoy: HOY,
  });
  assert.deepEqual(r.crear.map((o) => [o.origen_id, o.estado, o.cuenta_debe, o.cuenta_haber, o.total, o.cliente_id, o.entidad, o.cliente_nombre]), [
    ["p1", "para_revisar", VENTA.deudores, VENTA.entregas, 300000, 7, "HOTEL NORTE", null],
    ["p2", "para_revisar", VENTA.deudores, VENTA.entregas, 100, null, "Nuevo SRL", "Nuevo SRL"],
  ]);
  assert.equal(r.crear[0].origen, ORIGEN_ESTIMADA);
  assert.deepEqual(clientesNuevosDe(r.crear), ["Nuevo SRL"]);
});

test("entrega estimada — se anula si le ponen precio; la confirmada no se toca", () => {
  const ops = [
    { id: 20, origen_id: "p1", fecha: "2026-11-10", total: 100, estado: "para_revisar" },
    { id: 21, origen_id: "p2", fecha: "2026-11-10", total: 100, estado: "confirmada" },
    { id: 22, origen_id: "p3", fecha: "2026-11-10", total: 100, estado: "para_revisar" },
  ];
  const r = planEstimadas({
    proyectos: [OT(1), OT(2), OT(3)], fechas: { p2: "2026-11-10", p3: "2026-11-10" },
    valores: new Map([["p2", 999], ["p3", 120]]), operaciones: ops, cuentas: VENTA, hoy: HOY,
  });
  assert.deepEqual(r.anular, [{ id: 20, motivo: "Gypi (la OT tiene precio o se volvió a abrir)" }]);
  assert.deepEqual(r.corregir, [{ id: 22, cambios: { neto: 120, total: 120, total_ars: 120 } }]);
  const calc = otsParaCalcular({ entregas: new Map([["p2", "2026-11-10"], ["p3", "2026-11-10"]]), operaciones: ops.map((o) => ({ ...o, origen: ORIGEN_ESTIMADA })), hoy: HOY, origen: ORIGEN_ESTIMADA });
  assert.deepEqual([...calc], ["p3"], "la confirmada no se vuelve a calcular");
});

test("estado de resultados — el asiento de consumo es el costo de materiales de su OT", () => {
  const cuentas = [
    { codigo: "04.01.01.001.002", nombre: "Entregas Generales", linea_eerr: "ING_ENT" },
    { codigo: "01.01.04.001.002", nombre: "Materias Primas", linea_eerr: "CMV_MAT" },
    { codigo: "04.02.01.001.009", nombre: "Costo De Mercaderia Vendida" },
    { codigo: "01.01.02.001.001", nombre: "Deudores Por Ventas" },
  ];
  const op = (fecha, debe, haber, total, extra = {}) => ({ id: Math.random(), fecha, cuenta_debe: debe, cuenta_haber: haber, neto: total, total, total_ars: total, ...extra });
  const ops = [
    op("2026-11-05", "01.01.02.001.001", "04.01.01.001.002", 1000000, { proyecto_id: 1 }),
    op("2026-11-05", "01.01.02.001.001", "04.01.01.001.002", 500000, { proyecto_id: 2 }),
    // La OT 1 tiene su consumo; la 2 no (va con el 40 %)
    op("2026-11-05", "04.02.01.001.009", "01.01.04.001.002", 300000, { proyecto_id: 1, origen: "consumo_ot" }),
    // Una compra de material: es stock, no costo
    op("2026-11-02", "01.01.04.001.002", "02.01.02.001.001", 800000),
  ];
  const r = estadoResultados({ ops, cuentas, proyectos: [{ id: 1, division: "MUEBLES" }, { id: 2, division: "MUEBLES" }], hasta: "2026-11" });
  const fila = (re) => r.filas.find((f) => re.test(f.nombre || ""));
  assert.equal(fila(/asiento de consumo/).valores[11], 300000);
  assert.equal(fila(/asiento de consumo/).estimado, false);
  assert.equal(fila(/estimado 40/).valores[11], 200000, "solo la entrega sin consumo va al %");
  assert.equal(r.sin_linea.length, 0, "Costo de Mercadería Vendida no queda como cuenta sin clasificar");
  // Sin consumo, igual que antes
  const antes = estadoResultados({ ops: ops.filter((o) => o.origen !== "consumo_ot"), cuentas, proyectos: [], hasta: "2026-11" });
  assert.equal(antes.filas.find((f) => /estimado 40/.test(f.nombre || "")).valores[11], 600000);
});

test("Inicio — las entregas estimadas tienen su aviso, aparte de las otras para revisar", () => {
  const p = pendientesFinanzas({ hoy: HOY, revisar: [{ origen: "entrega_estimada", total: 1000 }, { origen: "entrega_estimada", total: 500 }, { origen: "factura_oc" }] });
  const est = p.find((x) => x.id === "estimadas");
  assert.deepEqual([est.cantidad, est.importe, est.ir], [2, 1500, "fin-tesoreria"]);
  assert.match(est.texto, /2 OT entregadas sin precio/);
  assert.equal(p.find((x) => x.id === "revisar").cantidad, 1);
});

test("Movimientos — la estimada se confirma o se anula; el consumo se cambia desde la OT", () => {
  const est = { origen: "entrega_estimada", estado: "para_revisar" };
  assert.equal(puedeConfirmar(est), true);
  assert.equal(puedeConfirmar({ ...est, estado: "confirmada" }), false);
  assert.equal(puedeConfirmar({ origen: "mi_caja", estado: "para_revisar" }), false);
  assert.equal(puedeAnular(est), true);
  assert.equal(puedeAnular({ origen: "consumo_ot" }), false);
  assert.match(dondeSeCambia({ origen: "consumo_ot" }), /la OT/);
  assert.ok(ORIGENES.consumo_ot && ORIGENES.entrega_estimada);
});

test("costo de la OT — el consumo y la entrega estimada no son gastos de la OT", () => {
  assert.ok(ORIGENES_NO_GASTO.has("consumo_ot"));
  assert.ok(ORIGENES_NO_GASTO.has("entrega_estimada"));
});
