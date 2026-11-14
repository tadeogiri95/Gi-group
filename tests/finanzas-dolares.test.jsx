// tests/finanzas-dolares.test.jsx — 💱 Comprar o vender dólares (14/11):
// la venta sale al costo promedio de la caja USD y la diferencia de
// cotización va a su cuenta; la compra es una sola operación.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { costoCajaUsd, cuentaDiferenciaSugerida, cuentasParaDiferencia, operacionesDolares, tipoDolares } from "../app/lib/finanzasDolares.js";
import { movimientoCaja } from "../app/lib/finanzasOperaciones.js";
import { sumasYSaldos } from "../app/lib/finanzasMayor.js";
import { SE_ANULAN, puedeCorregir } from "../app/lib/finanzasCorregir.js";
import BotonCargar from "../app/components/FinanzasCargar.jsx";

afterEach(() => cleanup());

const USD = { cuenta: "01.01.01.001.002", nombre: "Caja Dólares", tipo: "caja", moneda: "USD", activa: true };
const PESOS = { cuenta: "01.01.01.001.001", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true };
const CUENTAS = [
  { codigo: "01.01.01.001.001", nombre: "Caja Principal", activa: true },
  { codigo: "01.01.01.001.002", nombre: "Caja Dólares", activa: true },
  { codigo: "04.03", nombre: "Resultados financieros", rubro: "RESULTADO", activa: true },
  { codigo: "04.03.01", nombre: "Diferencia de cambio positiva", rubro: "RESULTADO", activa: true },
  { codigo: "05.03.02", nombre: "Diferencia de cambio negativa", rubro: "RESULTADO", activa: true },
  { codigo: "03.01", nombre: "Capital", activa: true },
];
const TIPOS = [{ codigo: "DÓLARES", nombre: "Dólares (comprar y vender)", grupo: "TESORERÍA", activo: true }];
const CTX = { tipos: TIPOS, cuentas: CUENTAS, tesoreria: [USD, PESOS], centros: [], proveedores: [], proyectos: [] };

// La caja USD: entraron USD 1.000 a $1.200 y USD 1.000 a $1.400 → 2.000 dólares por $2.600.000 (costo $1.300)
const op = (id, fecha, usd, tc, debe, haber) => ({ id, fecha, tipo: "DÓLARES", moneda: "USD", total: usd, neto: usd, iva: 0, otros_impuestos: 0, tipo_cambio: tc, total_ars: usd * tc, cuenta_debe: debe, cuenta_haber: haber });
const OPS = [op(1, "2026-10-01", 1000, 1200, USD.cuenta, PESOS.cuenta), op(2, "2026-11-01", 1000, 1400, USD.cuenta, PESOS.cuenta)];

test("dólares — costo promedio de la caja USD según el Mayor, hasta la fecha", () => {
  assert.deepEqual(costoCajaUsd(OPS, USD, { cuentas: CUENTAS }), { usd: 2000, pesos: 2600000, costo: 1300 });
  assert.deepEqual(costoCajaUsd(OPS, USD, { hasta: "2026-10-15", cuentas: CUENTAS }), { usd: 1000, pesos: 1200000, costo: 1200 });
  assert.equal(costoCajaUsd([], USD).costo, null, "sin dólares no hay costo");
});

test("dólares — vender con ganancia: DÓLARES al costo + diferencia al haber; la caja en pesos recibe lo real", () => {
  const calculado = costoCajaUsd(OPS, USD, { cuentas: CUENTAS });
  const r = operacionesDolares({ accion: "vender", caja_usd: USD.cuenta, caja_pesos: PESOS.cuenta, usd: "1000", tipo_cambio: "1.400", costo: "1300", fecha: "2026-11-14", cuenta_diferencia: "04.03.01" }, { ...CTX, calculado });
  assert.deepEqual(r.errores, []);
  assert.equal(r.ops.length, 2);
  const [venta, dif] = r.ops;
  assert.equal(venta.moneda, "USD");
  assert.equal(venta.total, 1000);
  assert.equal(venta.total_ars, 1300000);
  assert.equal(venta.cuenta_debe, PESOS.cuenta);
  assert.equal(venta.cuenta_haber, USD.cuenta);
  assert.equal(dif.moneda, "ARS");
  assert.equal(dif.total, 100000);
  assert.equal(dif.cuenta_debe, PESOS.cuenta);
  assert.equal(dif.cuenta_haber, "04.03.01");
  assert.ok(r.ops.every((o) => o.origen === "dolares" && o.tipo === "DÓLARES"));
  assert.equal(r.resumen.diferencia, 100000);
  // La caja en pesos suma 1.400.000; la USD baja 1.000 dólares y 1.300.000 pesos
  const todas = [...OPS, ...r.ops.map((o, i) => ({ ...o, id: 10 + i }))];
  const enPesos = todas.reduce((s, o) => s + movimientoCaja(o, PESOS), 0);
  assert.equal(enPesos, -2600000 + 1400000);
  const mayor = new Map(sumasYSaldos(todas, { cuentas: CUENTAS, tipos: TIPOS }).map((c) => [c.codigo, c.saldo]));
  assert.equal(mayor.get(USD.cuenta), 1300000, "quedan USD 1.000 a $1.300");
  assert.equal(mayor.get("04.03.01"), -100000, "la ganancia en la cuenta de diferencia");
});

test("dólares — vender con pérdida: la diferencia va al debe y sale de la caja en pesos", () => {
  const r = operacionesDolares({ accion: "vender", caja_usd: USD.cuenta, caja_pesos: PESOS.cuenta, usd: "500", tipo_cambio: "1250", costo: "1300", fecha: "2026-11-14", cuenta_diferencia: "05.03.02" }, CTX);
  assert.deepEqual(r.errores, []);
  const [venta, dif] = r.ops;
  assert.equal(venta.total_ars, 650000);
  assert.equal(dif.total, 25000);
  assert.equal(dif.cuenta_debe, "05.03.02");
  assert.equal(dif.cuenta_haber, PESOS.cuenta);
});

test("dólares — vender todo al costo calculado deja la caja USD en cero exacto (sin resto de centavos)", () => {
  const ops = [{ ...op(1, "2026-10-01", 3, 1000.0167, USD.cuenta, PESOS.cuenta), total_ars: 3000.05 }]; // 1000,0167 por dólar
  const calculado = costoCajaUsd(ops, USD, { cuentas: CUENTAS });
  assert.equal(calculado.costo, 1000.02);
  const r = operacionesDolares({ accion: "vender", caja_usd: USD.cuenta, caja_pesos: PESOS.cuenta, usd: "3", tipo_cambio: "1000", costo: "1000,02", fecha: "2026-11-14", cuenta_diferencia: "05.03.02" }, { ...CTX, calculado });
  assert.equal(r.ops[0].total_ars, 3000.05);
  const mayor = new Map(sumasYSaldos([...ops, ...r.ops.map((o, i) => ({ ...o, id: 10 + i }))], { cuentas: CUENTAS, tipos: TIPOS }).map((c) => [c.codigo, c.saldo]));
  assert.equal(mayor.get(USD.cuenta) || 0, 0);
});

test("dólares — sin diferencia no hay segunda operación; más de lo que hay avisa", () => {
  const calculado = costoCajaUsd(OPS, USD, { cuentas: CUENTAS });
  const r = operacionesDolares({ accion: "vender", caja_usd: USD.cuenta, caja_pesos: PESOS.cuenta, usd: "2500", tipo_cambio: "1300", costo: "1300", fecha: "2026-11-14" }, { ...CTX, calculado });
  assert.deepEqual(r.errores, []);
  assert.equal(r.ops.length, 1);
  assert.match(r.avisos[0], /queda en negativo/);
});

test("dólares — comprar es una sola DÓLARES al tipo de cambio de la compra", () => {
  const r = operacionesDolares({ accion: "comprar", caja_usd: USD.cuenta, caja_pesos: PESOS.cuenta, usd: "1000", tipo_cambio: "1450", fecha: "2026-11-14" }, CTX);
  assert.deepEqual(r.errores, []);
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].cuenta_debe, USD.cuenta);
  assert.equal(r.ops[0].cuenta_haber, PESOS.cuenta);
  assert.equal(r.ops[0].total_ars, 1450000);
  assert.equal(r.ops[0].tipo_cambio, 1450);
});

test("dólares — lo que falta se dice en castellano", () => {
  const r = operacionesDolares({ accion: "vender", caja_usd: PESOS.cuenta, caja_pesos: USD.cuenta, usd: "", fecha: "" }, CTX);
  assert.ok(r.errores.includes("Elegí la caja o el banco en dólares."));
  assert.ok(r.errores.includes("Elegí la caja o el banco en pesos."));
  assert.ok(r.errores.some((e) => /cuántos dólares/.test(e)));
  assert.ok(r.errores.some((e) => /costo/.test(e)));
  const sinCuenta = operacionesDolares({ accion: "vender", caja_usd: USD.cuenta, caja_pesos: PESOS.cuenta, usd: "10", tipo_cambio: "1400", costo: "1300", fecha: "2026-11-14" }, CTX);
  assert.match(sinCuenta.errores[0], /cuenta de la diferencia/);
  const sinTipo = operacionesDolares({ accion: "comprar", caja_usd: USD.cuenta, caja_pesos: PESOS.cuenta, usd: "10", tipo_cambio: "1400", fecha: "2026-11-14" }, { ...CTX, tipos: [] });
  assert.match(sinTipo.errores[0], /DÓLARES/);
});

test("dólares — tipo y cuenta propuestos", () => {
  assert.equal(tipoDolares([{ codigo: "VENTA USD", activo: true }, { codigo: "COMPRA USD", activo: true }], "comprar").codigo, "COMPRA USD");
  assert.equal(cuentaDiferenciaSugerida(CUENTAS, true), "04.03.01");
  assert.equal(cuentaDiferenciaSugerida(CUENTAS, false), "05.03.02");
  assert.equal(cuentaDiferenciaSugerida([{ codigo: "04.09", nombre: "Otros", linea_eerr: "FIN_DIF", activa: true }], false), "04.09");
  assert.deepEqual(cuentasParaDiferencia(CUENTAS).map((c) => c.codigo), ["04.03.01", "05.03.02"], "solo resultado y sin las que agrupan");
  assert.ok(SE_ANULAN.has("dolares"));
  assert.equal(puedeCorregir({ origen: "dolares" }), false, "se anula entera y se vuelve a cargar");
});

test("➕ Cargar — 💱 vender dólares: trae el costo, muestra la ganancia y guarda con la cuenta propuesta", async () => {
  const LISTAS = { ...CTX, operaciones: [] };
  const posts = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/finanzas/tesoreria")) {
      const body = JSON.parse(opts.body);
      posts.push(body);
      if (body.accion === "dolares_costo") return new Response(JSON.stringify({ ok: true, caja: USD.cuenta, fecha: body.fecha, usd: 2000, pesos: 2600000, costo: 1300, sugeridas: { ganancia: "04.03.01", perdida: "05.03.02" } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, operaciones: [], avisos: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(LISTAS), { status: 200 });
  };
  render(<BotonCargar contexto={{ caja: USD.cuenta }} />);
  fireEvent.click(screen.getByRole("button", { name: "➕ Cargar" }));
  fireEvent.click(screen.getByText("💱 Comprar o vender dólares"));
  await screen.findByRole("dialog", { name: "💱 Comprar o vender dólares" });
  assert.equal(screen.getByLabelText("Caja en dólares").value, "Caja Dólares", "desde la caja USD, sale de esa");
  await waitFor(() => assert.equal(screen.getByLabelText("Costo de esos dólares").value, "1300"));
  fireEvent.change(screen.getByLabelText("Caja en pesos"), { target: { value: "Caja Principal" } });
  fireEvent.change(screen.getByLabelText("Dólares"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Tipo de cambio"), { target: { value: "1400" } });
  assert.ok(screen.getByText(/Ganancia por diferencia de cotización/));
  await waitFor(() => assert.equal(screen.getByLabelText("Cuenta de la diferencia").value, "Diferencia de cambio positiva (04.03.01)"));
  fireEvent.click(screen.getByRole("button", { name: "Cargar la venta" }));
  await waitFor(() => assert.ok(posts.some((p) => p.accion === "dolares")));
  const g = posts.find((p) => p.accion === "dolares");
  assert.equal(g.accion_dolares, "vender");
  assert.equal(g.caja_usd, USD.cuenta);
  assert.equal(g.caja_pesos, PESOS.cuenta);
  assert.equal(g.costo, "1300");
  assert.equal(g.cuenta_diferencia, "04.03.01");
});
