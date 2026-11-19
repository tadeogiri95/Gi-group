// tests/finanzas-pct-materiales.test.jsx — 19/11 (punto 9): un solo % de
// materiales para toda Finanzas, 30 % por defecto, en Finanzas → Configuración.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { FACTOR_ESTIMADO, cuentasPorOt, factorDePct, textoPctEstimado, valorOt } from "../app/lib/finanzasOtClientes.js";
import { MATERIALES_PCT, configResultados } from "../app/lib/finanzasResultados.js";
import { planEstimadas } from "../app/lib/finanzasConsumoOt.js";

afterEach(() => cleanup());
const { PctMateriales } = await import("../app/components/FinanzasPctMateriales.jsx");

test("el % por defecto es 30 para todo", () => {
  assert.equal(MATERIALES_PCT, 30);
  assert.equal(configResultados(null).materiales_pct, 30);
  assert.equal(FACTOR_ESTIMADO, 0.3);
});

test("factorDePct — el % guardado; con 0 o algo raro, el 30 %", () => {
  assert.equal(factorDePct(40), 0.4);
  assert.equal(factorDePct(27.5), 0.275);
  assert.equal(factorDePct(0), 0.3);
  assert.equal(factorDePct(undefined), 0.3);
  assert.equal(factorDePct(150), 0.3);
  assert.equal(textoPctEstimado(27.5), "27,5 %");
  assert.equal(textoPctEstimado(0), "30 %");
});

test("valorOt y cuentasPorOt — las OT sin precio valen materiales ÷ el %", () => {
  assert.equal(valorOt(0, { total: 40000 }).valor, 133333.33);
  assert.equal(valorOt(0, { total: 40000 }, 0.4).valor, 100000);
  assert.equal(valorOt(500000, { total: 40000 }, 0.4).valor, 500000, "con precio manda el precio");
  const [c] = cuentasPorOt({ proyectos: [{ id: 1, ot: "7001", cliente: "Gómez" }], materiales: new Map([["7001", { total: 40000 }]]), ops: [], cuentasDeu: new Set(), clientes: [], factor: 0.4 });
  assert.equal(c.ots[0].valor, 100000);
  assert.equal(c.ots[0].estimado, true);
});

test("planEstimadas — la descripción dice el factor usado", () => {
  const r = planEstimadas({
    proyectos: [{ id: 3, ot: "7001", cliente: "Gómez" }], fechas: { p3: "2026-11-10" }, valores: new Map([["p3", 100000]]),
    cuentas: { deudores: "D", entregas: "E" }, hoy: "2026-11-19", factor: 0.4,
  });
  assert.match(r.crear[0].descripcion, /materiales ÷ 0,4\)/);
});

test("Finanzas → Configuración — muestra el % y lo cambia para todo", async () => {
  const pedidos = [];
  let guardado = 30;
  global.fetch = async (u, o) => {
    if (o?.method === "POST") { const b = JSON.parse(o.body); pedidos.push(b); guardado = Number(String(b.materiales_pct).replace(",", ".")); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    if (String(u).includes("/api/finanzas/resultados?solo=config")) return new Response(JSON.stringify({ config: { materiales_pct: guardado, ponderador: {} } }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  render(<PctMateriales />);
  await waitFor(() => assert.match(screen.getByRole("heading").textContent, /% de materiales: 30 %/));
  fireEvent.click(screen.getByRole("button", { name: "Cambiar" }));
  fireEvent.change(screen.getByLabelText("Porcentaje de materiales"), { target: { value: "35" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.match(screen.getByRole("heading").textContent, /35 %/));
  assert.deepEqual([pedidos[0].accion, pedidos[0].materiales_pct], ["config", "35"]);
});
