// tests/finanzas-conceptos-caja.test.jsx — "¿En qué?" de las cajas (14/11):
// lista fija de conceptos de caja, escritos normal, con su reseña, su cuenta
// del plan y su tipo de operación.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  CONCEPTOS_GASTO, CONCEPTOS_INGRESO, conceptosCajaDisponibles, conceptoDeOperacion, cuentaDelConcepto,
} from "../app/lib/finanzasConceptosCaja.js";
import { conceptosMiCaja, conceptosMiCajaTodos, nombreNormal, resumenMiCaja, validarMovimientoMiCaja } from "../app/lib/finanzasMiCaja.js";
import { TIPOS_NUEVOS, claveTipo } from "../app/lib/finanzasTipos.js";

afterEach(() => cleanup());
const { default: MiCaja } = await import("../app/components/MiCaja.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const CAJA = { cuenta: "01.01.01.001.001.03", nombre: "Caja Ezequiel", tipo: "caja", moneda: "ARS", activa: true };
// Las cuentas del plan del libro (dim_plan_cuentas) que usan los conceptos
const PLAN = [...CONCEPTOS_GASTO, ...CONCEPTOS_INGRESO].map((c) => ({ codigo: c.cuenta, nombre: c.nombreCuenta }))
  .filter((c, i, a) => a.findIndex((x) => x.codigo === c.codigo) === i);
const TIPOS = TIPOS_NUEVOS.map((t) => ({ codigo: t.codigo, nombre: t.nombre, grupo: t.grupo, cuenta_debe: "x", cuenta_haber: "y", activo: true }));
const CTX = { caja: CAJA, supabaseUrl: "https://test.supabase.co", empresaId: E, hoy: "2026-11-14" };

test("la lista — nombres escritos normal, reseña con ejemplo, tipo de la lista y sin reintegro de combustible", () => {
  const todos = [...CONCEPTOS_GASTO, ...CONCEPTOS_INGRESO];
  const tipos = new Set(TIPOS_NUEVOS.map((t) => claveTipo(t.codigo)));
  for (const c of todos) {
    assert.notEqual(c.nombre, c.nombre.toUpperCase(), `${c.nombre} no va en mayúscula`);
    assert.notEqual(c.grupo, c.grupo.toUpperCase(), `${c.grupo} no va en mayúscula`);
    assert.match(c.leyenda, /Ej\.: /, `${c.nombre} trae ejemplo`);
    assert.ok(tipos.has(claveTipo(c.tipo)), `${c.tipo} es un tipo de la lista`);
    assert.match(c.cuenta, /^0[1-4](\.\d{2,3})+$/, `${c.nombre} con código del plan`);
  }
  assert.equal(new Set(CONCEPTOS_GASTO.map((c) => c.id)).size, CONCEPTOS_GASTO.length);
  assert.equal(new Set(CONCEPTOS_INGRESO.map((c) => c.id)).size, CONCEPTOS_INGRESO.length);
  assert.ok(!todos.some((c) => /reintegro/i.test(c.nombre)), "sin reintegro de combustible (pedido de Tadeo)");
  assert.ok(CONCEPTOS_GASTO.some((c) => c.id === "anticipo_combustible"));
  // Nada de devengamiento ni tesorería entre cajas
  assert.ok(!todos.some((c) => ["VENTA", "AMORTIZACIONES", "TRANSFERENCIA ENTRE CAJAS", "PLAZO FIJO", "PAGO A PROVEEDORES"].includes(c.tipo)));
});

test("la cuenta — por código del libro; si cambió el código, por nombre; sin la cuenta el concepto no aparece", () => {
  const combustible = CONCEPTOS_GASTO.find((c) => c.id === "combustible");
  assert.equal(cuentaDelConcepto(combustible, PLAN), "04.02.01.001.005");
  assert.equal(cuentaDelConcepto(combustible, [{ codigo: "5.1.9", nombre: "combustibles y lubricantes" }]), "5.1.9");
  assert.equal(cuentaDelConcepto(combustible, [{ codigo: "04.02.01.001.005", nombre: "Combustibles Y Lubricantes", activa: false }]), null);
  const d = conceptosCajaDisponibles(TIPOS, PLAN.filter((c) => c.codigo !== "04.02.01.001.034"));
  assert.ok(!d.gastos.some((c) => c.codigo === "publicidad"), "sin la cuenta de publicidad no se ofrece");
  assert.equal(d.gastos.length, CONCEPTOS_GASTO.length - 1);
  assert.equal(d.ingresos.length, CONCEPTOS_INGRESO.length);
});

test("Mi caja — con el plan usa la lista fija; sin el plan, los tipos como antes, escritos normal", () => {
  const c = conceptosMiCaja({ ocultos: { gastos: ["publicidad"] } }, TIPOS, PLAN);
  assert.equal(c.gastos[0].nombre, "Combustible");
  assert.equal(c.gastos[0].grupo, "Vehículos y traslados");
  assert.ok(!c.gastos.some((x) => x.codigo === "publicidad"), "el dueño la escondió");
  assert.ok(c.ingresos.find((x) => x.codigo === "cobro_cliente").pide_cliente, "el cobro a un cliente pide el cliente");
  assert.ok(!c.ingresos.find((x) => x.codigo === "otros_ingresos").pide_cliente);
  const viejos = conceptosMiCajaTodos([{ codigo: "PAGO GASTOS DE LOGÍSTICA", cuenta_debe: "05.1", activo: true }], []);
  assert.equal(viejos.fijos, false);
  assert.deepEqual(viejos.gastos.map((x) => x.nombre), ["Pago gastos de logística"]);
  assert.equal(nombreNormal("PAGO GASTOS DE LOGÍSTICA"), "Pago gastos de logística");
  assert.equal(nombreNormal("Viáticos"), "Viáticos");
  assert.equal(nombreNormal("IVA"), "IVA");
});

test("el asiento — la cuenta del concepto y su tipo; sueldos sin IVA", () => {
  const conceptos = conceptosMiCaja(null, TIPOS, PLAN);
  let r = validarMovimientoMiCaja({ clase: "gasto", concepto: "combustible", importe: 30000, fecha: "2026-11-10", letra: "A", neto: 24793.39, iva: 5206.61 }, { ...CTX, conceptos });
  assert.deepEqual(r.errores, []);
  assert.deepEqual([r.op.tipo, r.op.cuenta_debe, r.op.cuenta_haber, r.op.iva], ["GASTOS DE LOGÍSTICA", "04.02.01.001.005", CAJA.cuenta, 5206.61]);
  assert.match(r.op.descripcion, /^Combustible · Caja Ezequiel/);
  r = validarMovimientoMiCaja({ clase: "gasto", concepto: "anticipo_combustible", importe: 10000, fecha: "2026-11-10", letra: "A", neto: 8264.46, iva: 1735.54 }, { ...CTX, conceptos });
  assert.deepEqual([r.op.tipo, r.op.cuenta_debe, r.op.iva, r.op.neto], ["SUELDOS", "01.01.03.014.001", 0, 10000], "un anticipo no separa IVA");
  r = validarMovimientoMiCaja({ clase: "ingreso", concepto: "intereses", importe: 500, fecha: "2026-11-10" }, { ...CTX, conceptos });
  assert.deepEqual([r.op.tipo, r.op.cuenta_debe, r.op.cuenta_haber], ["RENDIMIENTOS FINANCIEROS", CAJA.cuenta, "04.01.02.002.001"]);
});

test("el movimiento — se reconoce su concepto, también entre dos con la misma cuenta", () => {
  const todos = conceptosMiCajaTodos(TIPOS, PLAN);
  const op = (tipo, debe, descripcion) => ({ id: 1, fecha: "2026-11-10", tipo, cuenta_debe: debe, cuenta_haber: CAJA.cuenta, total: 100, total_ars: 100, descripcion });
  assert.equal(conceptoDeOperacion(op("SUELDOS", "01.01.03.014.001", "Anticipo de sueldo por carga de combustible · Caja Ezequiel"), CAJA.cuenta, todos).codigo, "anticipo_combustible");
  assert.equal(conceptoDeOperacion(op("SUELDOS", "01.01.03.014.001", "Adelanto de sueldo · Caja Ezequiel"), CAJA.cuenta, todos).codigo, "adelanto_sueldo");
  assert.equal(conceptoDeOperacion(op("OTROS GASTOS", "04.02.01.001.019", "x"), CAJA.cuenta, todos).codigo, "otros_gastos");
  assert.equal(conceptoDeOperacion(op("GASTOS DE ADMINISTRACIÓN", "04.02.01.001.019", "x"), CAJA.cuenta, todos).codigo, "limpieza");
  assert.equal(conceptoDeOperacion(op("TRANSFERENCIA ENTRE CAJAS", "01.01.01.001.001.01", "x"), CAJA.cuenta, todos), null);
  const r = resumenMiCaja([op("GASTOS DE LOGÍSTICA", "04.02.01.001.005", "")], CAJA, new Map(), (o, c) => conceptoDeOperacion(o, c.cuenta, todos)?.nombre);
  assert.equal(r.movimientos[0].concepto, "Combustible");
});

test("Mi caja — ¿En qué? con los conceptos por grupo y la reseña al elegir", async () => {
  const datos = { cajas: [resumenMiCaja([], CAJA, new Map())], conceptos: conceptosMiCaja(null, TIPOS, PLAN), hoy: "2026-11-14", cargar: () => {} };
  const enviados = [];
  global.fetch = async (url, o = {}) => { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
  render(<MiCaja datos={datos} onClose={() => {}} onCambio={() => {}} />);
  fireEvent.click(screen.getByText("➖ Gasté"));
  assert.ok(screen.getByText("¿En qué?"));
  fireEvent.click(screen.getByRole("button", { name: "Combustible" }));
  assert.match(screen.getByRole("note").textContent, /Nafta, gasoil, GNC/);
  fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "15000" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].concepto, "combustible");
});
