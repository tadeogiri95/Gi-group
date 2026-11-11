// tests/finanzas-cuenta-elegir.test.jsx — Costos indirectos de fabricación y
// depreciación (11/11, Tadeo): la cuenta se elige al cargar; en el libro, la
// versión 2 de los cambios de cuentas arregla las dos cuentas por defecto.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { cuentaParaElegir, cuentasIniciales, errorAmortizacion, nombreBien } from "../app/lib/finanzasCuentaElegir.js";
import { validarOperacion } from "../app/lib/finanzasOperaciones.js";
import { cambiosCuentasLibro, planArreglado, VERSION_CAMBIOS_CUENTAS } from "../app/lib/finanzasLibroCuentas.js";

afterEach(() => cleanup());

const { default: FinanzasMovimientos } = await import("../app/components/FinanzasMovimientos.jsx");

const CUENTAS = [
  { codigo: "01.01.01.001.001.01", nombre: "Caja Principal", activa: true },
  { codigo: "01.01.04.001.002", nombre: "Materias Primas", activa: true },
  { codigo: "01.01.04.001.007", nombre: "Insumos", activa: true },
  { codigo: "01.02.01.001.001", nombre: "Plazo Fijos Largo Plazo", activa: true },
  { codigo: "01.02.02.001.001", nombre: "Inmuebles - Amort.Acum.", activa: true },
  { codigo: "01.02.02.001.005", nombre: "Maquinarias y herramientas- Amort.Acum.", activa: true },
  { codigo: "01.02.02.001.011", nombre: "Rodados - Amort.Acum.", activa: true },
  { codigo: "01.02.02.001.012", nombre: "Rodados - Valor Costo", activa: true },
  { codigo: "01.02.02.001.007", nombre: "Matrices - Amort.Acum.", activa: false },
  { codigo: "02.01.02.001.001", nombre: "Proveedores", activa: true },
  { codigo: "04.02.01.001.001", nombre: "Agua Potable", activa: true },
  { codigo: "04.02.01.001.003", nombre: "Amortizaciones del Ejercicio", activa: true },
  { codigo: "04.02.01.001.011", nombre: "Electricidad", activa: true },
  { codigo: "04.02.01.001.016", nombre: "Gastos De Fabricacion", activa: true },
  { codigo: "04.02.01.001.054", nombre: "Mantenimiento Maquinas", activa: true },
];
const TESORERIA = [{ cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true }];
const CIF = { codigo: "COSTOS INDIRECTOS DE FABRICACIÓN", grupo: "COMPRAS", cuenta_debe: "04.02.01.001.001", cuenta_haber: "01.01.01.001.001.01", activo: true };
const DEPREC = { codigo: "DEPREC", grupo: "AJUSTES", cuenta_debe: "04.02.01.001.003", cuenta_haber: "01.02.01.001.001", activo: true };
const AMORT = { codigo: "AMORTIZACIONES", nombre: "Amortizaciones", grupo: "AJUSTES", cuenta_debe: "04.02.01.001.003", cuenta_haber: "01.02.01.001.001", activo: true };
const COMPRAS = { codigo: "COMPRAS", nombre: "Compras", grupo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", activo: true };
const TIPOS = [CIF, DEPREC, AMORT, COMPRAS];

test("cuentaParaElegir — amortización: qué bien (amortización acumulada activa); costos indirectos: qué costo; compras: qué se compró", () => {
  const a = cuentaParaElegir(DEPREC, CUENTAS);
  assert.equal(a.lado, "haber");
  assert.equal(a.obligatoria, true);
  assert.deepEqual(a.opciones.map((o) => o.etiqueta), ["Inmuebles", "Maquinarias y herramientas", "Rodados"], "sin la desactivada ni el valor de costo");
  assert.deepEqual(cuentaParaElegir(AMORT, CUENTAS).opciones, a.opciones, "el tipo nuevo igual que DEPREC");
  const c = cuentaParaElegir(CIF, CUENTAS);
  assert.equal(c.lado, "debe");
  assert.equal(c.obligatoria, true);
  assert.deepEqual(c.opciones.map((o) => o.etiqueta), ["Insumos", "Electricidad", "Agua Potable", "Mantenimiento Maquinas", "Gastos De Fabricacion"], "solo las que están en el plan");
  const k = cuentaParaElegir(COMPRAS, CUENTAS);
  assert.equal(k.obligatoria, false);
  assert.equal(k.opciones[0].etiqueta, "Materias Primas");
  assert.equal(cuentaParaElegir({ codigo: "SUELDOS" }, CUENTAS), null);
  assert.equal(cuentaParaElegir(DEPREC, [{ codigo: "1", nombre: "Caja" }]), null, "sin cuentas para elegir no pregunta");
  assert.equal(nombreBien("Maquinarias y herramientas- Amort.Acum."), "Maquinarias y herramientas");
  assert.equal(nombreBien("Rodados - Amort.Acum."), "Rodados");
});

test("cuentasIniciales — si hay que elegir, ese lado arranca vacío; en compras queda la del tipo", () => {
  const ini = { cuenta_debe: "04.02.01.001.003", cuenta_haber: "01.02.01.001.001" };
  assert.deepEqual(cuentasIniciales(DEPREC, CUENTAS, ini), { cuenta_debe: "04.02.01.001.003", cuenta_haber: "" });
  assert.deepEqual(cuentasIniciales(CIF, CUENTAS, { cuenta_debe: "04.02.01.001.001", cuenta_haber: "x" }), { cuenta_debe: "", cuenta_haber: "x" });
  const compra = { cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001" };
  assert.deepEqual(cuentasIniciales(COMPRAS, CUENTAS, compra), compra);
});

test("validarOperacion — una amortización contra Plazo Fijos no se guarda; contra Rodados sí", () => {
  const ctx = { tipos: TIPOS, cuentas: CUENTAS, tesoreria: TESORERIA };
  const op = { fecha: "2026-11-30", tipo: "DEPREC", neto: "1000", cuenta_debe: "04.02.01.001.003", cuenta_haber: "01.02.01.001.001" };
  assert.ok(validarOperacion(op, ctx).errores.some((e) => /elegí qué bien se amortiza/.test(e)));
  assert.deepEqual(validarOperacion({ ...op, cuenta_haber: "01.02.02.001.011" }, ctx).errores, []);
  assert.equal(errorAmortizacion(CIF, "01.02.01.001.001", CUENTAS), null, "solo para amortizaciones");
});

test("Nueva operación — con DEPREC pregunta qué bien y arma el asiento con el elegido", async () => {
  global.fetch = async () => new Response(JSON.stringify({ desde: "2026-11-01", hasta: "2026-11-11", truncado: false, tipos: TIPOS, cuentas: CUENTAS, tesoreria: TESORERIA, centros: [], proveedores: [], proyectos: [], operaciones: [] }), { status: 200 });
  render(<FinanzasMovimientos />);
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "+ Nueva operación" })));
  fireEvent.click(screen.getByRole("button", { name: "+ Nueva operación" }));
  fireEvent.change(screen.getByLabelText("Tipo de operación"), { target: { value: "DEPREC" } });
  const grupo = screen.getByRole("group", { name: "¿Qué bien se amortiza?" });
  assert.ok(grupo);
  assert.ok(!screen.queryByText("Plazo Fijos Largo Plazo"), "no arranca con la cuenta equivocada");
  fireEvent.click(screen.getByRole("button", { name: "Rodados" }));
  assert.ok(screen.getAllByText("Rodados - Amort.Acum.").length > 0, "queda elegido el haber");
  fireEvent.change(screen.getByLabelText("Tipo de operación"), { target: { value: "COSTOS INDIRECTOS DE FABRICACIÓN" } });
  assert.ok(screen.getByRole("group", { name: "¿Qué costo es?" }));
  assert.ok(screen.getByRole("button", { name: "Mantenimiento Maquinas" }));
});

test("libro, versión 2 — con la versión 1 ya aplicada y copiada a Gypi, van solo los dos tipos arreglados", () => {
  assert.equal(VERSION_CAMBIOS_CUENTAS, 2);
  const arreglado = [...CUENTAS, { codigo: "01.02.02.001.023", nombre: "Herramientas - Valor Costo" }];
  assert.equal(planArreglado(arreglado), true);
  const c = cambiosCuentasLibro({ cuentas: arreglado, tipos: TIPOS });
  assert.deepEqual([c.recodificar, c.sacar, c.renombrar, c.nuevas], [[], [], [], []]);
  assert.equal(c.ajuste, null);
  assert.deepEqual(c.tipos.map((t) => [t.codigo, t.debe, t.haber]), [
    ["COSTOS INDIRECTOS DE FABRICACIÓN", "Gastos De Fabricacion", null],
    ["DEPREC", null, "Maquinarias y herramientas- Amort.Acum."],
    ["AMORTIZACIONES", null, "Maquinarias y herramientas- Amort.Acum."],
  ]);
  assert.equal(cambiosCuentasLibro({ cuentas: CUENTAS, tipos: TIPOS }), null, "otro plan: nada");
});
