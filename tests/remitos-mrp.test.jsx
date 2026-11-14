// tests/remitos-mrp.test.jsx — Remitos: cada renglón con un artículo del MRP
// (el más parecido si no hay uno igual) y carga a mano (pedido del 12/11).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { articuloDeRenglon, borradorRemito, palabrasArticulo, parecidosArticulo, validarRemito } from "../app/lib/remitosStock.js";

afterEach(() => cleanup());
const { default: RemitosFoto } = await import("../app/components/RemitosFoto.jsx");

const ARTICULOS = [
  ["1.1.18.1", "Placa melamina blanca 18 mm", "UN"], ["1.1.18.2", "Placa melamina gris grafito 18 mm", "UN"], ["1.1.15.1", "Placa melamina blanca 15 mm", "UN"],
  ["4.1.2.7", "Bisagra cazoleta 35 cierre suave", "UN"], ["4.1.2.8", "Bisagra cazoleta 35 codo 0", "UN"],
  ["4.2.1.1", "Corredera telescópica 450", "PAR"], ["4.2.1.2", "Corredera telescópica 500", "PAR"],
  ["3.3.1.6", "Tapacanto PVC blanco 22 mm", "MT"], ["5.1.1.1", "Tornillo 4x50", "UN"], ["5.1.1.2", "Tornillo 4x40", "UN"],
].map(([sku, nombre, unidad]) => ({ sku, nombre, unidad }));

test("palabrasArticulo — medidas, abreviaturas y centímetros", () => {
  assert.deepEqual(palabrasArticulo("MELAMINA BCA 18MM 2,60X1,83"), ["melamina", "bca", "18", "2.60", "1.83"]);
  assert.deepEqual(palabrasArticulo("Corredera telesc. 45 cm"), ["corredera", "telesc", "45", "450"]);
  assert.deepEqual(palabrasArticulo("Tapacanto 22x0,45"), ["tapacanto", "22", "0.45"]);
});

test("parecidosArticulo — reconoce como lo escribe el proveedor y no confunde las medidas", () => {
  const de = (d) => articuloDeRenglon({ descripcion: d, codigo: "" }, { articulos: ARTICULOS });
  for (const [d, sku] of [
    ["MELAMINA BCA 18MM 2,60X1,83", "1.1.18.1"], ["Bisagra cazoleta C/ cierre suave 35mm", "4.1.2.7"], ["CORREDERA TELESC. 45 CM", "4.2.1.1"],
    ["Corredera telescopica 500mm", "4.2.1.2"], ["Tapacanto PVC Blanco 22x0,45", "3.3.1.6"], ["TORN. 4X50 FIX", "5.1.1.1"], ["Placa melamina blanca 15", "1.1.15.1"],
  ]) {
    const r = de(d);
    assert.equal(r.sku, sku, d);
    assert.equal(r.como, "parecido", d);
  }
  // Sin uno que gane claro: no se pone solo, pero se ofrecen los parecidos
  const dudoso = de("Placa melamina 18");
  assert.equal(dudoso.sku, null);
  assert.deepEqual(dudoso.opciones.map((o) => o.sku), ["1.1.18.1", "1.1.18.2", "1.1.15.1"]);
  assert.deepEqual(de("Cola vinílica 1 kg").opciones, [], "lo que no está en el MRP no se inventa");
  assert.equal(de("Tornillo 4x50").como, "nombre", "el nombre igual sigue ganando");
  assert.equal(parecidosArticulo("", ARTICULOS).length, 0);
});

test("borrador y validar — el renglón trae las opciones y se guarda cómo se eligió", () => {
  const b = borradorRemito({ proveedor: "FAPLAC", renglones: [{ descripcion: "Placa melamina 18", codigo: "", cantidad: 10 }, { descripcion: "MELAMINA BCA 18MM", codigo: "", cantidad: 4 }] }, { articulos: ARTICULOS });
  assert.equal(b.renglones[0].sku, null);
  assert.equal(b.renglones[0].opciones.length, 3);
  assert.deepEqual([b.renglones[1].sku, b.renglones[1].como], ["1.1.18.1", "parecido"]);
  const { remito } = validarRemito({ proveedor: "X", renglones: [{ descripcion: "a", cantidad: 1, sku: "1.1.18.1", como: "parecido" }, { descripcion: "b", cantidad: 1, sku: "5.1.1.1", como: "cualquiera" }] });
  assert.equal(remito.renglones[0].como, "parecido");
  assert.equal(remito.renglones[1].como, undefined);
});

function mockPantalla() {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    if (!opts.body) return new Response(JSON.stringify({ ok: true, pendientes: [], revisados: [], puede_confirmar: true }), { status: 200 });
    if (String(opts.body).includes("proveedores?")) return new Response(JSON.stringify({ data: [{ id: 2, nombre: "Herrajes del Centro SRL", activo: true }] }), { status: 200 });
    enviados.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ ok: true, id: 9, estado: "confirmado", cargados: 1 }), { status: 200 });
  };
  return enviados;
}

test("pantalla — ✍ a mano: se elige el artículo del MRP y entra al stock", async () => {
  const enviados = mockPantalla();
  render(<RemitosFoto articulos={ARTICULOS} />);
  fireEvent.click(await screen.findByText("✍ Cargar un remito a mano"));
  assert.ok(screen.getByText("✍ Remito a mano"));
  fireEvent.change(screen.getByLabelText("Proveedor"), { target: { value: "HERRAJES DEL CENTR" } });
  assert.ok(await screen.findByText(/No está en la lista de proveedores/), "etapa 2: avisa si no está en la lista");
  fireEvent.change(screen.getByLabelText("Proveedor"), { target: { value: "HERRAJES DEL CENTRO" } });
  assert.equal(screen.queryByText(/No está en la lista de proveedores/), null, "igual a 'Herrajes del Centro SRL'");
  fireEvent.change(screen.getByLabelText("Buscar el artículo de Renglón 1"), { target: { value: "corredera 450" } });
  fireEvent.click(screen.getByText("Corredera telescópica 450"));
  assert.ok(screen.getByText(/elegido a mano/));
  fireEvent.change(screen.getByLabelText("Cantidad de Corredera telescópica 450"), { target: { value: "12" } });
  fireEvent.click(screen.getByText("✅ Confirmar ingreso"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].accion, "guardar");
  assert.equal(enviados[0].confirmar, true);
  assert.equal(enviados[0].foto_url, null);
  assert.deepEqual(enviados[0].renglones, [{ descripcion: "Corredera telescópica 450", codigo: null, cantidad: "12", sku: "4.2.1.1", como: "mano" }]);
});

test("pantalla — un renglón dudoso muestra los parecidos del MRP para elegir de un toque", async () => {
  const pend = { id: 3, origen: "remito", proveedor: "FAPLAC", numero: "1", fecha: "2026-11-11", estado: "para_revisar", renglones: [{ descripcion: "Placa melamina 18", cantidad: 10, sku: null }, { descripcion: "MELAMINA BCA 18MM", cantidad: 4, sku: "1.1.18.1", como: "parecido" }] };
  global.fetch = async () => new Response(JSON.stringify({ ok: true, pendientes: [pend], revisados: [], puede_confirmar: true }), { status: 200 });
  render(<RemitosFoto articulos={ARTICULOS} />);
  fireEvent.click(await screen.findByText("Revisar"));
  assert.ok(screen.getByText(/el más parecido: revisalo/));
  const lista = screen.getByRole("list", { name: "Parecidos a Placa melamina 18" });
  assert.equal(lista.querySelectorAll("button").length, 3);
  fireEvent.click(screen.getByText("Placa melamina gris grafito 18 mm"));
  assert.equal(screen.queryByRole("list", { name: "Parecidos a Placa melamina 18" }), null);
  assert.equal(screen.queryByText(/Para confirmarlo/), null, "ya no falta ninguno");
});
