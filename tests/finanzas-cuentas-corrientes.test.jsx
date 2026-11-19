// tests/finanzas-cuentas-corrientes.test.jsx — 19/11 (pedido de Tadeo):
// Clientes y Proveedores juntos en 📒 Cuentas corrientes, porque hay
// clientes que también son proveedores y al revés.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { cuentasCorrientes, entraEnFiltro, filtroInicialCc, totalesCc } from "../app/lib/finanzasCuentasCorrientes.js";
import { opcionesBoton } from "../app/lib/menuGestion.js";

afterEach(() => cleanup());
const { default: FinanzasCuentasCorrientes } = await import("../app/components/FinanzasCuentasCorrientes.jsx");

const CLI = [
  { clave: "c1", cliente_id: 1, nombre: "Gómez", saldo: 1000, ultimo: "2026-11-10" },
  { clave: "c2", cliente_id: 2, nombre: "Maderas Sur", saldo: 300, ultimo: "2026-11-01" },
  { clave: "c3", cliente_id: 3, nombre: "Pérez", saldo: 0, ultimo: "" },
];
const PROV = [
  { clave: "p7", proveedor_id: 7, nombre: "Maderas Sur SRL", deuda: 800, ultimo: "2026-11-12" },
  { clave: "p8", proveedor_id: 8, nombre: "Herrajes", deuda: 500, ultimo: "2026-11-05" },
];

test("un renglón por persona: el cliente y el proveedor unidos van juntos con el neto", () => {
  const r = cuentasCorrientes({ clientes: CLI, proveedores: PROV, pares: [{ cliente_id: 2, proveedor_id: 7 }] });
  assert.equal(r.length, 4);
  const ambos = r.find((x) => x.tipo === "ambos");
  assert.deepEqual([ambos.nombre, ambos.nos_debe, ambos.le_debemos, ambos.neto, ambos.ultimo], ["Maderas Sur", 300, 800, -500, "2026-11-12"]);
  assert.equal(r[0].nombre, "Gómez", "primero los saldos más grandes");
  assert.deepEqual(r.map((x) => x.tipo).sort(), ["ambos", "cliente", "cliente", "proveedor"]);
});

test("un proveedor unido sin movimientos igual va con su cliente", () => {
  const r = cuentasCorrientes({ clientes: CLI, proveedores: [], pares: [{ cliente_id: 1, proveedor_id: 9, proveedor: "Gómez Hnos" }] });
  const g = r.find((x) => x.cliente?.cliente_id === 1);
  assert.equal(g.tipo, "ambos");
  assert.equal(g.proveedor.proveedor_id, 9);
  assert.equal(g.neto, 1000);
});

test("filtros, totales y el filtro de los links viejos", () => {
  const r = cuentasCorrientes({ clientes: CLI, proveedores: PROV, pares: [{ cliente_id: 2, proveedor_id: 7 }] });
  const n = (f) => r.filter((x) => entraEnFiltro(x, f)).length;
  assert.deepEqual([n("saldo"), n("clientes"), n("proveedores"), n("ambos"), n("todos")], [3, 3, 2, 1, 4]);
  assert.deepEqual(totalesCc(r), { nos_deben: 1300, debemos: 1300, neto: 0 });
  assert.equal(filtroInicialCc("fin-clientes"), "clientes");
  assert.equal(filtroInicialCc("fin-proveedores"), "proveedores");
  assert.equal(filtroInicialCc(null), "saldo");
});

test("menú — Cuentas corrientes reemplaza a Clientes y Proveedores; los links viejos la abren", () => {
  const ids = opcionesBoton("finanzas", { modulos: ["proyectos", "finanzas"] }, { rol: "gerencial" }).map((o) => o.id);
  assert.ok(ids.includes("fin-cuentas"));
  assert.ok(!ids.includes("fin-clientes") && !ids.includes("fin-proveedores"));
  const boton = readFileSync(new URL("../app/components/screens/BotonGestionScreen.jsx", import.meta.url), "utf8");
  assert.match(boton, /"fin-clientes": "fin-cuentas", "fin-proveedores": "fin-cuentas"/);
  assert.match(boton, /<FinanzasCuentasCorrientes seccion=\{seccion\} \/>/);
});

const ok = (b) => new Response(JSON.stringify(b), { status: 200 });

test("pantalla — una lista, filtros y el que es las dos cosas con su neto", async () => {
  global.fetch = async (u) => {
    const url = String(u);
    if (url.includes("/api/finanzas/clientes")) {
      return ok({
        cuentas: [], tesoreria: [], proyectos: [], cuentas_deudores: ["DEU"], ventas_ot: { activo: false },
        clientes: [{ id: 1, nombre: "Gómez" }, { id: 2, nombre: "Maderas Sur" }],
        operaciones: [
          { id: 1, fecha: "2026-11-01", cliente_id: 1, cuenta_debe: "DEU", cuenta_haber: "VTA", total_ars: 1000 },
          { id: 2, fecha: "2026-11-02", cliente_id: 2, cuenta_debe: "DEU", cuenta_haber: "VTA", total_ars: 300 },
        ],
      });
    }
    if (url.includes("/api/finanzas/proveedores")) {
      return ok({
        cuentas: [], cuentas_guardadas: {}, cuentas_proveedores: ["PRV"], proveedores: [{ id: 7, nombre: "Maderas Sur" }, { id: 8, nombre: "Herrajes" }],
        operaciones: [
          { id: 3, fecha: "2026-11-03", proveedor_id: 7, cuenta_debe: "MAT", cuenta_haber: "PRV", total_ars: 800 },
          { id: 4, fecha: "2026-11-04", proveedor_id: 8, cuenta_debe: "MAT", cuenta_haber: "PRV", total_ars: 500 },
        ],
      });
    }
    if (url.includes("/api/finanzas/unificados")) return ok({ pares: [{ cliente_id: 2, proveedor_id: 7 }], unificadas: [] });
    return ok({});
  };
  render(<FinanzasCuentasCorrientes />);
  const lista = await screen.findByRole("list", { name: "Cuentas corrientes" });
  assert.equal(within(lista).getAllByRole("listitem").length, 3);
  const maderas = within(lista).getByRole("button", { name: /Maderas Sur/ });
  assert.match(maderas.textContent, /Neto: le debemos \$\s?500/);
  assert.match(maderas.textContent, /Cliente y proveedor/);

  fireEvent.click(screen.getByRole("button", { name: /^Proveedores \(2\)/ }));
  await waitFor(() => assert.equal(within(screen.getByRole("list", { name: "Cuentas corrientes" })).getAllByRole("listitem").length, 2));

  fireEvent.click(maderas.isConnected ? maderas : within(screen.getByRole("list", { name: "Cuentas corrientes" })).getByRole("button", { name: /Maderas Sur/ }));
  const ficha = await screen.findByRole("dialog");
  assert.ok(within(ficha).getByRole("button", { name: "👥 Ver como cliente" }));
  assert.ok(within(ficha).getByRole("button", { name: "🏭 Ver como proveedor" }));
  assert.ok(within(ficha).getByRole("button", { name: /Compensar/ }), "nos debe 300 y le debemos 800: se pueden compensar 300");
});

test("pantalla — desde el link viejo de Clientes abre con el filtro de clientes", async () => {
  global.fetch = async (u) => {
    const url = String(u);
    if (url.includes("/clientes")) return ok({ cuentas: [], clientes: [{ id: 1, nombre: "Gómez" }], operaciones: [], cuentas_deudores: ["DEU"], ventas_ot: {} });
    if (url.includes("/proveedores")) return ok({ cuentas: [], proveedores: [], operaciones: [], cuentas_proveedores: ["PRV"] });
    return ok({ pares: [] });
  };
  render(<FinanzasCuentasCorrientes seccion="fin-clientes" />);
  const chip = await screen.findByRole("button", { name: /^Clientes \(1\)/ });
  assert.match(chip.className + (chip.getAttribute("aria-pressed") || ""), /active|true/);
});
