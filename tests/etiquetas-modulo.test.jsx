// tests/etiquetas-modulo.test.jsx — Órdenes de Producción, parte 12 (ítem 39):
// etiquetas de módulo con QR para la impresora de etiquetas.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { htmlRotulos, modulosParaEtiquetas, TAMANOS_ETIQUETA } from "../app/lib/carga.js";

afterEach(() => cleanup());

const { default: EtiquetasModulos } = await import("../app/components/EtiquetasModulos.jsx");

test("módulos — uno por módulo; los nombres pegados del Excel van en orden", () => {
  assert.deepEqual(modulosParaEtiquetas(3), [{ numero: 1, contenido: null }, { numero: 2, contenido: null }, { numero: 3, contenido: null }]);
  assert.deepEqual(modulosParaEtiquetas(3, "M.izq\tx\n\n M.central \r\n").map((m) => m.contenido), ["M.izq", "M.central", null], "toma la primera columna y salta renglones vacíos");
  assert.equal(modulosParaEtiquetas(2, "A\nB\nC\nD").length, 4, "con más nombres que módulos manda la lista");
  assert.deepEqual(modulosParaEtiquetas(0), []);
  assert.deepEqual(modulosParaEtiquetas(null, ""), []);
  assert.equal(modulosParaEtiquetas(5000).length, 999);
});

test("etiqueta — dice Módulo N de T, con el nombre y el QR", async () => {
  const html = await htmlRotulos({
    empresa: "GI", proyecto: { ot: "7038", cliente: "Depto 05" },
    bultos: modulosParaEtiquetas(2, "Bast.TV"), link: "https://app/gi?carga=7038", tamano: TAMANOS_ETIQUETA[0], titulo: "Módulo",
  });
  assert.match(html, /<title>Etiquetas OT 7038<\/title>/);
  assert.match(html, /Módulo 1 de 2/);
  assert.match(html, /Módulo 2 de 2/);
  assert.match(html, /Bast\.TV/);
  assert.doesNotMatch(html, /Bulto/);
  assert.match(html, /<svg/);
});

test("pantalla — propone el total de módulos de la OT e imprime todas de una vez", async () => {
  const escrito = [];
  const ventana = { document: { write: (h) => escrito.push(h), close() {} }, focus() {}, print() {} };
  const abrir = window.open;
  window.open = () => ventana;
  try {
    render(<EtiquetasModulos proyecto={{ ot: "7038", cliente: "Depto 05", total_modulos: 3 }} empresa={{ nombre: "GI", slug: "gi" }} onClose={() => {}} />);
    assert.equal(screen.getByLabelText("¿Cuántos módulos tiene la OT?").value, "3");
    assert.match(screen.getByRole("status").textContent, /^3 etiquetas: Módulo 1 de 3/);
    fireEvent.change(screen.getByLabelText("Nombres de los módulos (opcional)"), { target: { value: "M.izq\nM.central\nBast.TV\nAlacena" } });
    assert.match(screen.getByRole("status").textContent, /^4 etiquetas: Módulo 1 de 4 \(M\.izq\)/);
    fireEvent.click(screen.getByText("🖨 Imprimir etiquetas"));
    await waitFor(() => assert.equal(escrito.length, 1));
    assert.equal(escrito[0].match(/class="rotulo"/g).length, 4);
    assert.match(escrito[0], /Módulo 4 de 4/);
    assert.match(escrito[0], /Alacena/);
  } finally {
    window.open = abrir;
  }
});

test("pantalla — sin módulos no deja imprimir", () => {
  render(<EtiquetasModulos proyecto={{ ot: "7038" }} onClose={() => {}} />);
  assert.equal(screen.getByText("Poné cuántos módulos tiene").disabled, true);
});
