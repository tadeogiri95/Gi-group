// tests/panel-plata.test.jsx — 💰 La plata en el Panel de control (auditoría
// del 12/11, parte 12; sin migración).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { otsBajoMargen, resumenPlata } from "../app/lib/panelPlata.js";
import { flujoPrevisto } from "../app/lib/finanzasFlujo.js";

const { default: TarjetaPlata } = await import("../app/components/TarjetaPlata.jsx");
afterEach(() => cleanup());

const PREV = flujoPrevisto({
  hoy: "2026-11-12", saldoHoy: 1000000,
  ordenes: [{ estado: "aprobada", fecha: "2026-11-13", total: 300000, numero: 1, proveedor_nombre: "X" }],
  cobros: [{ fecha: "2026-11-30", importe: 2000000, texto: "OT 1" }, { fecha: null, importe: 500000, texto: "sin fecha" }],
  aPagar: [{ fecha: "2026-11-16", importe: 1500000, texto: "F" }, { fecha: "2027-03-01", importe: 100000, texto: "G" }],
});

test("resumen — hoy, lo que nos deben, lo que debemos y la caja en 4 semanas; la peor semana en rojo", () => {
  const r = resumenPlata(PREV);
  assert.equal(r.hoy, 1000000);
  assert.equal(r.nosDeben, 2500000, "con lo que no tiene fecha");
  assert.equal(r.debemos, 1900000, "facturas sin orden más órdenes de pago");
  assert.equal(r.semana4, "2026-11-30");
  assert.equal(r.en4, 1000000 - 300000 - 1500000 + 2000000);
  assert.deepEqual(r.peor, { semana: "2026-11-16", saldo: -800000 });
  assert.equal(resumenPlata(null), null);
});

test("margen — solo las bajas, la peor primero", () => {
  const r = otsBajoMargen([
    { ot: "7961", cliente: "RIOFRIO", margen: 7, margen_bajo: true },
    { ot: "7942", margen: 25, margen_bajo: false },
    { ot: "7860", cliente: "CEVT", margen: -2.5, margen_bajo: true },
    { ot: "7990", margen: null, margen_bajo: false },
  ]);
  assert.deepEqual(r.map((x) => x.ot), ["7860", "7961"]);
});

test("💰 tarjeta — los cuatro números, el aviso de caja en rojo y las OT bajo el margen; cada cosa lleva a su pantalla", async () => {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/finanzas/flujo")) return new Response(JSON.stringify({ previsto: PREV }), { status: 200 });
    if (u.includes("/api/costo-reporte")) return new Response(JSON.stringify({ ok: true, margen_minimo: 10, filas: [{ ot: "7961", cliente: "RIOFRIO", margen: 7, margen_bajo: true }] }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const idas = [];
  render(<TarjetaPlata goto={(x) => idas.push(x)} />);
  await screen.findByText("💰 La plata");
  const zona = screen.getByRole("region", { name: "La plata" });
  assert.match(zona.textContent, /En cajas y bancos hoy\$ 1\.000\.000/);
  assert.match(zona.textContent, /Nos deben \(OT\)\$ 2\.500\.000/);
  assert.match(zona.textContent, /Debemos a proveedores\$ 1\.900\.000/);
  assert.match(zona.textContent, /Caja al 30\/11\$ 1\.200\.000/);
  assert.match(screen.getByRole("alert").textContent, /queda en -?\$ -?800\.000 la semana del 16\/11/);
  await screen.findByText(/1 OT va por debajo del margen mínimo \(10 %\)/);
  assert.ok(screen.getByText(/7961 RIOFRIO: 7 %/));
  fireEvent.click(screen.getByText("Nos deben (OT)"));
  fireEvent.click(screen.getByText(/1 OT va por debajo/));
  assert.deepEqual(idas, ["finanzas:fin-clientes", "proyectos:reportes"]);
});

test("💰 tarjeta — si Finanzas no responde y no hay margen, no aparece", async () => {
  global.fetch = async () => new Response("{}", { status: 403 });
  const { container } = render(<TarjetaPlata goto={() => {}} />);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(container.textContent, "");
});
