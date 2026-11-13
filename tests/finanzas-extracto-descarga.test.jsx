// tests/finanzas-extracto-descarga.test.jsx — Finanzas: descargar el
// extracto de cajas y bancos en PDF o Excel (13/11, sin migración).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { unzipSync, strFromU8 } from "fflate";
import { armarExtracto, hayFiltros, htmlExtracto, nombreArchivoExtracto, xlsxExtracto } from "../app/lib/finanzasExtractoDescarga.js";
import { armarXlsx, letraColumna, serieExcel } from "../app/lib/xlsxSimple.js";

afterEach(() => cleanup());
const { default: DescargarExtracto } = await import("../app/components/FinanzasDescargarExtracto.jsx");

const CAJA = { cuenta: "C1", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true };
const BANCO = { cuenta: "B1", nombre: "Banco Credicoop", tipo: "banco", moneda: "ARS", activa: true };
const DOLAR = { cuenta: "U1", nombre: "Caja Dólares", tipo: "caja", moneda: "USD", activa: true };
const VACIA = { cuenta: "C9", nombre: "Caja Vacía", tipo: "caja", moneda: "ARS", activa: true };
const TESO = [CAJA, BANCO, DOLAR, VACIA];
const op = (id, fecha, debe, haber, total, extra = {}) => ({ id, fecha, tipo: "T", cuenta_debe: debe, cuenta_haber: haber, total, total_ars: total, moneda: "ARS", estado: "confirmada", ...extra });
const OPS = [
  op(1, "2026-10-20", "C1", "AJ", 1000),                       // antes del período: saldo inicial
  op(2, "2026-11-02", "C1", "VTA", 500, { tipo: "COBRO", proveedor_id: 7 }),
  op(3, "2026-11-03", "GAS", "C1", 200, { tipo: "PAGO", descripcion: "Nafta" }),
  op(4, "2026-11-04", "B1", "C1", 300, { tipo: "TRANSFERENCIA ENTRE CAJAS" }), // pase: sale de caja, entra al banco
  op(5, "2026-11-05", "GAS", "C1", 999, { anulada_at: "2026-11-06T00:00:00Z" }), // anulada: no sale
  op(6, "2026-11-30", "C1", "VTA", 50),                        // después del período
  op(7, "2026-11-05", "U1", "VTA", 10, { moneda: "USD", total_ars: 15000 }),
];
const nombres = { entidad: (o) => (o.proveedor_id === 7 ? "Pinturería Sur" : o.entidad || ""), ot: () => "" };

test("un bloque por cuenta con saldo inicial, ingresos, egresos y saldo final; lo anulado no sale", () => {
  const ex = armarExtracto({ operaciones: OPS, tesoreria: TESO, desde: "2026-11-01", hasta: "2026-11-15", nombres });
  assert.deepEqual(ex.bloques.map((b) => b.nombre), ["Caja Principal", "Banco Credicoop", "Caja Dólares"]);
  const caja = ex.bloques.find((b) => b.cuenta === "C1");
  assert.equal(caja.saldo_inicial, 1000);
  assert.equal(caja.ingresos, 500);
  assert.equal(caja.egresos, 500);
  assert.equal(caja.saldo_final, 1000);
  assert.deepEqual(caja.filas.map((f) => f.saldo), [1500, 1300, 1000]);
  assert.equal(caja.filas[0].quien, "Pinturería Sur");
  assert.equal(caja.filas[2].contra, "Banco Credicoop");
  const banco = ex.bloques.find((b) => b.cuenta === "B1");
  assert.equal(banco.ingresos, 300);
  assert.equal(banco.filas[0].contra, "Caja Principal");
  // Dólares en dólares, con total aparte
  assert.equal(ex.bloques.find((b) => b.cuenta === "U1").ingresos, 10);
  assert.deepEqual(ex.totales.USD, { cuentas: 1, saldo_inicial: 0, ingresos: 10, egresos: 0, saldo_final: 10 });
  assert.equal(ex.totales.ARS.saldo_final, 1300);
  // La caja sin movimientos ni saldo no va
  assert.ok(!ex.bloques.some((b) => b.cuenta === "C9"));
});

test("con una caja elegida va solo esa; con filtros el saldo final sigue siendo el de toda la cuenta", () => {
  const una = armarExtracto({ operaciones: OPS, tesoreria: TESO, desde: "2026-11-01", hasta: "2026-11-15", filtros: { caja: "C9" } });
  assert.equal(una.bloques.length, 1);
  assert.equal(una.bloques[0].filas.length, 0);
  const f = armarExtracto({ operaciones: OPS, tesoreria: TESO, desde: "2026-11-01", hasta: "2026-11-15", filtros: { caja: "C1", buscar: "nafta" }, nombres });
  assert.equal(f.filtrado, true);
  assert.equal(f.bloques[0].filas.length, 1);
  assert.equal(f.bloques[0].egresos, 200);
  assert.equal(f.bloques[0].ingresos, 0);
  assert.equal(f.bloques[0].saldo_final, 1000);
  assert.equal(f.bloques[0].filas[0].saldo, null);
  assert.equal(hayFiltros({ caja: "C1" }), false);
  assert.equal(hayFiltros({ tipo: "PAGO" }), true);
  assert.equal(nombreArchivoExtracto(f), "extracto-caja-principal-2026-11-01-a-2026-11-15");
});

test("el Excel tiene hoja Resumen y Movimientos, con importes como números y fechas como fechas", () => {
  const ex = armarExtracto({ operaciones: OPS, tesoreria: TESO, desde: "2026-11-01", hasta: "2026-11-15", nombres });
  const zip = unzipSync(xlsxExtracto(ex, { filtrosTexto: ["Caja Principal"] }));
  const libro = strFromU8(zip["xl/workbook.xml"]);
  assert.match(libro, /name="Resumen"/);
  assert.match(libro, /name="Movimientos"/);
  const resumen = strFromU8(zip["xl/worksheets/sheet1.xml"]);
  assert.match(resumen, /Caja Principal/);
  assert.match(resumen, /Total en pesos/);
  assert.match(resumen, /<c r="G\d+" s="2"><v>1000<\/v><\/c>/);
  const movs = strFromU8(zip["xl/worksheets/sheet2.xml"]);
  assert.match(movs, /Pinturería Sur/);
  assert.match(movs, new RegExp(`<c r="C\\d+" s="4"><v>${serieExcel("2026-11-02")}</v></c>`));
  assert.ok(zip["xl/styles.xml"] && zip["[Content_Types].xml"]);
});

test("xlsx simple: columnas, fechas de Excel, texto escapado y nombres de hoja válidos", () => {
  assert.equal(letraColumna(0), "A");
  assert.equal(letraColumna(25), "Z");
  assert.equal(letraColumna(26), "AA");
  assert.equal(serieExcel("1900-01-01"), 2);
  assert.equal(serieExcel("2026-11-13"), 46339);
  const zip = unzipSync(armarXlsx([{ nombre: "A/B", filas: [["<x> & \"y\"", 3.14159, "=SUMA(1)"]] }, { nombre: "A/B", filas: [] }]));
  const libro = strFromU8(zip["xl/workbook.xml"]);
  assert.match(libro, /name="A B"/);
  assert.match(libro, /name="A B 2"/);
  const hoja = strFromU8(zip["xl/worksheets/sheet1.xml"]);
  assert.match(hoja, /&lt;x&gt; &amp; &quot;y&quot;/);
  assert.match(hoja, /<v>3.14<\/v>/);
  assert.match(hoja, /t="inlineStr"><is><t xml:space="preserve">=SUMA\(1\)/);
});

test("la hoja del PDF lleva resumen, un bloque por cuenta y el aviso de filtros", () => {
  const ex = armarExtracto({ operaciones: OPS, tesoreria: TESO, desde: "2026-11-01", hasta: "2026-11-15", nombres });
  const html = htmlExtracto(ex, { empresa: "Gi <Group>" });
  assert.match(html, /Extracto de cajas y bancos · Gi &lt;Group&gt;/);
  assert.match(html, /Resumen por cuenta/);
  assert.equal((html.match(/<section class="cuenta">/g) || []).length, 3);
  assert.match(html, /Del 01\/11\/2026 al 15\/11\/2026/);
  assert.doesNotMatch(html, /Con filtros/);
  const f = armarExtracto({ operaciones: OPS, tesoreria: TESO, desde: "2026-11-01", hasta: "2026-11-15", filtros: { tipo: "PAGO" } });
  assert.match(htmlExtracto(f), /Con filtros/);
});

test("la ventana deja elegir fechas, PDF o Excel y muestra los filtros", () => {
  render(<DescargarExtracto onCerrar={() => {}} desde="2026-11-01" hasta="2026-11-15" filtros={{ tipo: "PAGO" }} filtrosTexto={["Pago"]} operaciones={OPS} tesoreria={TESO} listas={{ tipos: [], proveedores: [], proyectos: [] }} />);
  assert.ok(screen.getByRole("button", { name: /PDF/ }));
  assert.ok(screen.getByRole("button", { name: /Excel/ }));
  assert.ok(screen.getByText("Pago"));
  assert.ok(screen.getByText(/solo de lo filtrado/));
  assert.equal(screen.getByDisplayValue("2026-11-01").type, "date");
});
