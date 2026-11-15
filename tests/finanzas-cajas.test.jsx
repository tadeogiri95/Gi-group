// tests/finanzas-cajas.test.jsx — 15/11 (Tadeo): crear y eliminar cajas desde
// Tesorería, y el cobro del Desarrollismo (seña de una casa) imputado a su obra.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { codigoNuevaCaja, comoEliminarCaja, limpiarCajaNueva } from "../app/lib/finanzasCajas.js";
import { centrosParaElegir, cuentasCobroDesarrollismo, obraNueva, pideObra, TIPO_COBRO_DESARROLLISMO } from "../app/lib/finanzasDesarrollismo.js";
import BotonCargar from "../app/components/FinanzasCargar.jsx";
import { EliminarCaja, NuevaCaja } from "../app/components/FinanzasCajaAlta.jsx";

afterEach(() => cleanup());

const CAJAS = [
  { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.001.001.13", nombre: "Caja Lautaro Ruibal", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", tipo: "banco", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.008.001", nombre: "USD Físico en caja", tipo: "caja", moneda: "USD", activa: true },
];
const CUENTAS = [
  { codigo: "01.01.01.001.001.01", nombre: "Caja Principal", activa: true },
  { codigo: "01.01.01.001.001.13", nombre: "Caja Lautaro Ruibal", activa: true },
  { codigo: "01.01.01.001.001.14", nombre: "Caja Desarrollista", activa: true },
  { codigo: "01.01.01.001.001.15", nombre: "Caja Virtual", activa: true },
  { codigo: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", activa: true },
  { codigo: "02.01.02.002.001", nombre: "Anticipo de Clientes", activa: true },
  { codigo: "04.01.03.001.002", nombre: "Ventas Desarrollismo", activa: true },
];

test("nueva caja — usa la cuenta del plan con ese nombre que todavía no es caja", () => {
  assert.deepEqual(codigoNuevaCaja({ nombre: "caja desarrollista", tipo: "caja", moneda: "ARS" }, CAJAS, CUENTAS), { codigo: "01.01.01.001.001.14", reusa: true });
});

test("nueva caja — el siguiente número junto a las cajas del mismo tipo y moneda, sin pisar el plan", () => {
  // .14 y .15 están en el plan (aunque no son cajas): sigue la .16
  assert.deepEqual(codigoNuevaCaja({ nombre: "Caja Obra Numa", tipo: "caja", moneda: "ARS" }, CAJAS, CUENTAS), { codigo: "01.01.01.001.001.16", reusa: false });
  assert.deepEqual(codigoNuevaCaja({ nombre: "Banco Galicia", tipo: "banco", moneda: "ARS" }, CAJAS, CUENTAS), { codigo: "01.01.01.003.003", reusa: false });
  assert.deepEqual(codigoNuevaCaja({ nombre: "Dólares Desarrollista", tipo: "caja", moneda: "USD" }, CAJAS, CUENTAS), { codigo: "01.01.01.008.002", reusa: false });
});

test("nueva caja — no repite el nombre ni acepta uno vacío", () => {
  assert.match(codigoNuevaCaja({ nombre: "Caja Principal", tipo: "caja" }, CAJAS, CUENTAS).error, /Ya hay una caja/);
  assert.match(limpiarCajaNueva({ nombre: "  " }).error, /Falta el nombre/);
  assert.deepEqual(limpiarCajaNueva({ nombre: "Caja X", tipo: "fci", moneda: "EUR", responsable_id: "x" }).caja, { nombre: "Caja X", tipo: "caja", moneda: "ARS", responsable_id: null });
});

test("eliminar caja — sin uso se borra; con movimientos se archiva solo con saldo en cero", () => {
  const caja = CAJAS[1];
  assert.equal(comoEliminarCaja(caja, []).accion, "borrar");
  assert.equal(comoEliminarCaja(caja, [], 1).accion, "archivar", "con un cheque o un extracto no se borra");
  const entra = { cuenta_debe: caja.cuenta, cuenta_haber: "x", total: 100, total_ars: 100 };
  const sale = { cuenta_debe: "x", cuenta_haber: caja.cuenta, total: 100, total_ars: 100 };
  assert.deepEqual(comoEliminarCaja(caja, [entra]), { accion: "saldo", saldo: 100, movimientos: 1 });
  assert.deepEqual(comoEliminarCaja(caja, [entra, sale]), { accion: "archivar", saldo: 0, movimientos: 2 });
  assert.equal(comoEliminarCaja(caja, [{ ...entra, anulada_at: "2026-11-01" }]).accion, "archivar", "una anulada también cuenta como uso");
});

const CENTROS = [
  { codigo: "MADERA", division: "MADERA", activo: true },
  { codigo: "DESARROLLISTA NUMA", division: "DESARROLLISTA", activo: true },
  { codigo: "DESARROLLISTA 34/04", division: "DESARROLLISTA", activo: true },
  { codigo: "DESARROLLISTA VIEJA", division: "DESARROLLISTA", activo: false },
];
const COBRO = { codigo: TIPO_COBRO_DESARROLLISMO, nombre: "Desarrollismo: cobros por ventas", grupo: "INVERSIÓN", cuenta_debe: null, cuenta_haber: null, activo: true };

test("desarrollismo — pide obra, las obras primero, y el cobro va de la caja a Anticipo de Clientes", () => {
  assert.equal(pideObra(COBRO), true);
  assert.equal(pideObra({ codigo: "SERVICIOS" }), false);
  assert.deepEqual(centrosParaElegir(COBRO, CENTROS).map((c) => c.codigo), ["DESARROLLISTA NUMA", "DESARROLLISTA 34/04", "MADERA"]);
  const tesoreria = [...CAJAS, { cuenta: "01.01.01.001.001.14", nombre: "Caja Desarrollista", tipo: "caja", moneda: "ARS", activa: true }];
  assert.deepEqual(cuentasCobroDesarrollismo(COBRO, { cuentas: CUENTAS, tesoreria }), { cuenta_debe: "01.01.01.001.001.14", cuenta_haber: "02.01.02.002.001" });
  assert.deepEqual(cuentasCobroDesarrollismo(COBRO, { cuentas: CUENTAS, tesoreria }, "01.01.01.003.002").cuenta_debe, "01.01.01.003.002", "la caja elegida en Tesorería manda");
  assert.deepEqual(cuentasCobroDesarrollismo({ codigo: "SERVICIOS" }, { cuentas: CUENTAS, tesoreria }), {});
  assert.deepEqual(obraNueva("Campo Grande", CENTROS).fila.codigo, "DESARROLLISTA CAMPO GRANDE");
  assert.match(obraNueva("numa", CENTROS).error, /ya existe/);
});

function mockListas(tesoreria) {
  const pedidos = [];
  const listas = {
    tipos: [COBRO], cuentas: CUENTAS, tesoreria, proveedores: [], proyectos: [], centros: CENTROS, operaciones: [],
  };
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    pedidos.push({ u, body: opts.body ? JSON.parse(opts.body) : null });
    if (opts.method === "POST" && u.includes("/api/finanzas/operaciones")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (opts.method === "POST" && u.endsWith("/api/finanzas")) return new Response(JSON.stringify({ ok: true, fila: { cuenta: "01.01.01.001.001.14", nombre: "Caja Desarrollista" }, reusa: true, accion: "archivar" }), { status: 200 });
    if (u.includes("/api/finanzas/personas")) return new Response(JSON.stringify({ personas: [] }), { status: 200 });
    return new Response(JSON.stringify(listas), { status: 200 });
  };
  return pedidos;
}

test("➕ Cargar → 🏠 Cobro del Desarrollismo — arranca con la caja y Anticipo de Clientes y pide la obra", async () => {
  const tesoreria = [...CAJAS, { cuenta: "01.01.01.001.001.14", nombre: "Caja Desarrollista", tipo: "caja", moneda: "ARS", activa: true }];
  const pedidos = mockListas(tesoreria);
  render(<BotonCargar />);
  fireEvent.click(screen.getByRole("button", { name: "➕ Cargar" }));
  fireEvent.click(screen.getByText("🏠 Cobro del Desarrollismo"));
  await waitFor(() => assert.ok(screen.getByText(/Una seña o una cuota queda en/)));
  assert.match(screen.getByText(/^Haber:/).textContent, /Anticipo de Clientes/);
  assert.match(screen.getByText(/^Debe:/).textContent, /Caja Desarrollista/);
  fireEvent.change(screen.getAllByPlaceholderText("0,00")[0], { target: { value: "5000000" } });
  fireEvent.click(screen.getByRole("button", { name: /^Guardar/ }));
  await waitFor(() => assert.ok(screen.getByText(/Elegí la obra del Desarrollismo/)));
  assert.equal(pedidos.filter((p) => p.body?.accion === "crear").length, 0, "sin obra no se guarda");
});

test("Nueva caja y Eliminar caja — mandan lo justo al servidor", async () => {
  const pedidos = mockListas(CAJAS);
  let creada = null;
  render(<NuevaCaja personal={[]} onCerrar={() => {}} onCreada={(c) => { creada = c; }} />);
  fireEvent.change(screen.getByPlaceholderText("Caja Desarrollista"), { target: { value: "Caja Desarrollista" } });
  fireEvent.click(screen.getByRole("button", { name: "Crear caja" }));
  await waitFor(() => assert.ok(creada));
  assert.deepEqual(pedidos.at(-1).body, { accion: "caja_nueva", caja: { nombre: "Caja Desarrollista", tipo: "caja", moneda: "ARS", responsable_id: null } });
  cleanup();

  const caja = CAJAS[1];
  const { unmount } = render(<EliminarCaja caja={caja} operaciones={[{ cuenta_debe: caja.cuenta, cuenta_haber: "x", total: 50, total_ars: 50 }]} onCerrar={() => {}} onHecho={() => {}} />);
  assert.ok(screen.getByText(/Primero pasá esa plata a otra caja/));
  assert.equal(screen.queryByRole("button", { name: /Archivar|Eliminar/ }), null);
  unmount();

  let hecho = false;
  render(<EliminarCaja caja={caja} operaciones={[]} onCerrar={() => {}} onHecho={() => { hecho = true; }} />);
  fireEvent.click(screen.getByRole("button", { name: "🗑 Eliminar" }));
  await waitFor(() => assert.ok(hecho));
  assert.deepEqual(pedidos.at(-1).body, { accion: "caja_eliminar", cuenta: caja.cuenta });
});
