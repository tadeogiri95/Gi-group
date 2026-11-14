// tests/finanzas-cargar.test.jsx — etapa 3 de la auditoría de Finanzas
// integrada (14/11): el botón ➕ Cargar abre siempre el mismo formulario de
// cada documento, completado con lo que se sabe (la caja, la persona).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import BotonCargar, { DOCUMENTOS } from "../app/components/FinanzasCargar.jsx";
import FinanzasInicio from "../app/components/FinanzasInicio.jsx";

afterEach(() => cleanup());

const CAJA = { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true };
const BANCO = { cuenta: "01.01.01.003.002", nombre: "Banco Credicoop", tipo: "banco", moneda: "ARS", activa: true };
const LISTAS = {
  tipos: [{ codigo: "SERVICIOS", nombre: "Servicios", grupo: "GASTOS", cuenta_debe: "05.02.01", cuenta_haber: "01.01.01.001.001", activo: true }],
  cuentas: [{ codigo: "05.02.01", nombre: "Servicios", activa: true }], tesoreria: [CAJA, BANCO], proveedores: [{ id: 5, nombre: "ACERCO S A", activo: true }],
  proyectos: [], centros: [], operaciones: [],
};
const CLIENTES = { tesoreria: [CAJA, BANCO], proyectos: [], clientes: [{ id: 7, nombre: "HOTEL NORTE", activo: true }, { id: 8, nombre: "VIEJO", activo: true, unido_a: 7 }], operaciones: [], cuentas: [] };

function mock() {
  const pedidos = [];
  global.fetch = async (url) => {
    const u = String(url);
    pedidos.push(u);
    if (u.includes("/api/finanzas/clientes")) return new Response(JSON.stringify(CLIENTES), { status: 200 });
    if (u.includes("/api/finanzas/inicio")) return new Response(JSON.stringify({ saldo: { ARS: 0, USD: 0 }, mes: { entro: 0, salio: 0 }, pendientes: [] }), { status: 200 });
    return new Response(JSON.stringify(LISTAS), { status: 200 });
  };
  return pedidos;
}

test("➕ Cargar — muestra los cuatro documentos y la otra operación", async () => {
  mock();
  render(<BotonCargar />);
  fireEvent.click(screen.getByRole("button", { name: "➕ Cargar" }));
  for (const d of DOCUMENTOS) assert.ok(screen.getByText(`${d.icono} ${d.nombre}`), d.nombre);
  assert.ok(screen.getByText(/^Otra operación/));
});

test("➕ Cargar — cobro: primero el cliente (sin los unidos), después el mismo Cobrar de la ficha, con la caja puesta", async () => {
  mock();
  render(<BotonCargar contexto={{ caja: CAJA.cuenta }} />);
  fireEvent.click(screen.getByRole("button", { name: "➕ Cargar" }));
  fireEvent.click(screen.getByText("💵 Cobro de un cliente"));
  const sel = await screen.findByLabelText("Cliente que pagó");
  assert.equal([...sel.querySelectorAll("option")].some((o) => o.textContent === "VIEJO"), false, "el unido no aparece");
  fireEvent.change(sel, { target: { value: "HOTEL NORTE" } });
  fireEvent.click(screen.getByRole("button", { name: "Seguir" }));
  await screen.findByRole("dialog", { name: "Cobrar a HOTEL NORTE" });
  assert.equal(screen.getByLabelText("Dónde entró 1").value, "Caja Principal", "desde una caja, entra en esa caja");
  assert.equal(screen.getByRole("button", { name: "Efectivo" }).getAttribute("aria-pressed"), "true");
});

test("➕ Cargar — con un solo documento abre su formulario directo, con el proveedor puesto", async () => {
  mock();
  render(<BotonCargar documentos={["gasto"]} contexto={{ proveedorId: 5 }}>🧾 Factura o gasto</BotonCargar>);
  fireEvent.click(screen.getByRole("button", { name: "🧾 Factura o gasto" }));
  await waitFor(() => assert.equal(screen.getByLabelText("Proveedor del gasto").value, "ACERCO S A"));
});

test("➕ Cargar — en la ficha del proveedor el pago abre el suyo (con sus facturas pendientes)", async () => {
  const pedidos = mock();
  let pago = 0;
  render(<BotonCargar contexto={{ proveedorId: 5 }} onPago={() => { pago++; }} />);
  fireEvent.click(screen.getByRole("button", { name: "➕ Cargar" }));
  fireEvent.click(screen.getByText("💸 Pago a un proveedor"));
  assert.equal(pago, 1);
  assert.equal(pedidos.length, 0, "no lee nada: lo abre la ficha");
});

test("➕ Cargar — entre cajas es el mismo Pasar plata, saliendo de la caja elegida", async () => {
  mock();
  render(<BotonCargar contexto={{ caja: BANCO.cuenta }} />);
  fireEvent.click(screen.getByRole("button", { name: "➕ Cargar" }));
  fireEvent.click(screen.getByText("⇄ Entre cajas y bancos"));
  await waitFor(() => assert.equal(screen.getByLabelText("Sale de").value, "Banco Credicoop"));
});

test("Inicio de Finanzas — ➕ Cargar arriba de todo", async () => {
  mock();
  render(<FinanzasInicio opciones={[]} onIr={() => {}} />);
  assert.ok(screen.getByRole("button", { name: "➕ Cargar" }));
  assert.ok(screen.getByText(/siempre desde acá/));
});
