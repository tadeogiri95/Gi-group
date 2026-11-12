// tests/interfaz-finanzas-stock.test.jsx — Revisión de interfaz (parte 8 del
// plan Finanzas e Inventario, 11/11): la plata con signo y la caja en
// Movimientos, filtros plegados y el Stock más compacto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ladoCaja } from "../app/lib/finanzasOperaciones.js";

const TES = [{ cuenta: "01.01.01.001.001", nombre: "Caja Principal" }, { cuenta: "01.01.01.001.002", nombre: "Banco Galicia" }];

test("ladoCaja — entra, sale, pase o nada", () => {
  assert.deepEqual(ladoCaja({ cuenta_debe: "01.01.01.001.002", cuenta_haber: "01.03.01" }, TES), { como: "entra", texto: "Entró a Banco Galicia" });
  assert.deepEqual(ladoCaja({ cuenta_debe: "05.02.01", cuenta_haber: "01.01.01.001.001" }, TES), { como: "sale", texto: "Salió de Caja Principal" });
  assert.deepEqual(ladoCaja({ cuenta_debe: "01.01.01.001.002", cuenta_haber: "01.01.01.001.001" }, TES), { como: "pase", texto: "De Caja Principal a Banco Galicia" });
  assert.deepEqual(ladoCaja({ cuenta_debe: "05.01.01", cuenta_haber: "02.01.01" }, TES), { como: null, texto: null }, "una compra a cuenta corriente no toca caja");
  assert.deepEqual(ladoCaja({}, undefined), { como: null, texto: null });
});

test("pantallas — filtros plegados en Movimientos y Stock compacto", () => {
  const mov = readFileSync(new URL("../app/components/FinanzasMovimientos.jsx", import.meta.url), "utf8");
  assert.match(mov, /⚙ Filtros/);
  assert.match(mov, /aria-expanded=\{verFiltros\}/);
  const stock = readFileSync(new URL("../app/components/StockScreen.jsx", import.meta.url), "utf8");
  assert.match(stock, /elegidos\.size > 0 && \(/, "las etiquetas aparecen al tildar");
  assert.match(stock, /aria-label="Artículo nuevo \(no está en la planilla\)"/);
});
