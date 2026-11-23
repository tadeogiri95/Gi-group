// tests/finanzas-cuentas-pagar-cobrar.test.jsx — 19/11 (pedido de Tadeo):
// Informes → Cuentas a cobrar y a pagar, como Resultados y Flujo: el total,
// quién, y hace cuánto. Se baja en PDF o Excel.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { cuentasPagarCobrar, diasEntre, informeCuentas, pctTramos, pendientesFifo, tramoDeDias } from "../app/lib/finanzasCuentasPagarCobrar.js";
import { opcionesBoton } from "../app/lib/menuGestion.js";
import { GRUPOS_FINANZAS } from "../app/lib/finanzasInicio.js";

afterEach(() => cleanup());
const { default: Pantalla } = await import("../app/components/FinanzasCuentasPagarCobrar.jsx");

const DEU = new Set(["DEU"]);
const PRV = new Set(["PRV"]);
const venta = (id, fecha, cliente_id, total) => ({ id, fecha, cliente_id, cuenta_debe: "DEU", cuenta_haber: "VTA", total_ars: total });
const cobro = (id, fecha, cliente_id, total) => ({ id, fecha, cliente_id, cuenta_debe: "CAJA", cuenta_haber: "DEU", total_ars: total });
const compra = (id, fecha, proveedor_id, total) => ({ id, fecha, proveedor_id, cuenta_debe: "MAT", cuenta_haber: "PRV", total_ars: total });
const pago = (id, fecha, proveedor_id, total) => ({ id, fecha, proveedor_id, cuenta_debe: "PRV", cuenta_haber: "BCO", total_ars: total });

const CLIENTES = [{ id: 1, nombre: "Gómez" }, { id: 2, nombre: "Pérez" }];
const PROVEEDORES = [{ id: 7, nombre: "Egger" }];
const OPS_C = [
  venta(1, "2026-07-01", 1, 1000), venta(2, "2026-10-10", 1, 500), venta(3, "2026-11-15", 1, 200),
  cobro(4, "2026-11-01", 1, 1200), // tapa la de julio y 200 de la de octubre
  venta(5, "2026-11-10", 2, 100), cobro(6, "2026-11-12", 2, 300), // Pérez: 200 a favor
  { ...venta(9, "2026-11-18", 1, 999), anulada_at: "2026-11-18" },
];
const OPS_P = [compra(10, "2026-08-01", 7, 400), compra(11, "2026-11-05", 7, 600), pago(12, "2026-11-10", 7, 100)];

test("días y tramos", () => {
  assert.equal(diasEntre("2026-11-01", "2026-11-19"), 18);
  assert.deepEqual([30, 31, 60, 61, 90, 91].map(tramoDeDias), ["d30", "d60", "d60", "d90", "d90", "mas"]);
});

test("lo cobrado o pagado tapa lo más viejo primero", () => {
  assert.deepEqual(pendientesFifo([
    { fecha: "2026-07-01", efecto: 1000 }, { fecha: "2026-10-10", efecto: 500 }, { fecha: "2026-11-01", efecto: -1200 },
  ], "2026-11-19"), [{ fecha: "2026-10-10", falta: 300, dias: 40 }]);
});

test("a cobrar y a pagar a una fecha, con su antigüedad", () => {
  const r = cuentasPagarCobrar({ opsClientes: OPS_C, opsProveedores: OPS_P, cuentasDeu: DEU, cuentasProv: PRV, clientes: CLIENTES, proveedores: PROVEEDORES, hasta: "2026-11-19" });
  assert.equal(r.a_cobrar.total, 500);
  assert.equal(r.a_cobrar.cantidad, 1);
  assert.equal(r.a_cobrar.a_favor, 200, "Pérez pagó de más");
  assert.deepEqual(r.a_cobrar.renglones[0].tramos, { d30: 200, d60: 300, d90: 0, mas: 0 });
  assert.equal(r.a_cobrar.renglones[0].dias, 40);
  assert.equal(r.a_pagar.total, 900);
  assert.deepEqual(r.a_pagar.tramos, { d30: 600, d60: 0, d90: 0, mas: 300 }, "el pago tapa 100 de la compra de agosto");
  assert.deepEqual(pctTramos(r.a_pagar), { d30: 66.7, d60: 0, d90: 0, mas: 33.3 });

  const antes = cuentasPagarCobrar({ opsClientes: OPS_C, opsProveedores: OPS_P, cuentasDeu: DEU, cuentasProv: PRV, clientes: CLIENTES, proveedores: PROVEEDORES, hasta: "2026-10-31" });
  assert.equal(antes.a_cobrar.total, 1500, "al 31/10 todavía no había cobrado");
  assert.deepEqual(antes.a_cobrar.renglones[0].tramos, { d30: 500, d60: 0, d90: 0, mas: 1000 });
});

test("el informe para bajar: PDF y Excel con los tramos", () => {
  const r = cuentasPagarCobrar({ opsClientes: OPS_C, opsProveedores: OPS_P, cuentasDeu: DEU, cuentasProv: PRV, clientes: CLIENTES, proveedores: PROVEEDORES, hasta: "2026-11-19" });
  const inf = informeCuentas(r, "pagar", { empresa: "Gi Group" });
  assert.equal(inf.titulo, "Cuentas a pagar al 19/11/2026");
  const html = inf.html();
  assert.match(html, /Más de 90 días/);
  assert.match(html, /Egger/);
  const [hoja] = inf.hojas();
  assert.deepEqual(hoja.filas[4].slice(0, 1), ["Egger"]);
  assert.equal(hoja.filas[4][5].v, 900);
});

test("menú — en Informes, al lado del Flujo de caja", () => {
  const ids = opcionesBoton("finanzas", { modulos: ["proyectos", "finanzas"] }, { rol: "gerencial" }).map((o) => o.id);
  assert.equal(ids[ids.indexOf("fin-flujo") + 1], "fin-cxp");
  assert.ok(GRUPOS_FINANZAS.find((g) => g.id === "informes").opciones.includes("fin-cxp"));
});

test("pantalla — a cobrar y a pagar, con los botones para bajarlo", async () => {
  global.fetch = async (u) => {
    const url = String(u);
    if (url.includes("/clientes")) return new Response(JSON.stringify({ clientes: CLIENTES, operaciones: OPS_C, cuentas_deudores: ["DEU"] }), { status: 200 });
    return new Response(JSON.stringify({ proveedores: PROVEEDORES, operaciones: OPS_P, cuentas_proveedores: ["PRV"] }), { status: 200 });
  };
  render(<Pantalla />);
  const cobrar = await screen.findByRole("region", { name: "A cobrar (clientes)" });
  assert.ok(within(cobrar).getByText("Gómez"));
  fireEvent.click(screen.getByRole("button", { name: /^A pagar \(proveedores\)/ }));
  const pagar = await screen.findByRole("region", { name: "A pagar (proveedores)" });
  assert.ok(within(pagar).getByText("Egger"));
  assert.ok(screen.getByRole("button", { name: "📄 PDF" }));
  assert.ok(screen.getByRole("button", { name: "📊 Excel" }));
});
