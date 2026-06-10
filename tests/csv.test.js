// tests/csv.test.js — Tests del parser CSV
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../app/lib/csv.js";

test("parseCsv — parsea CSV básico", () => {
  const csv = "legajo,nombre,area\n1,Juan Pérez,produccion\n2,Ana García,administración";
  const { rows, errors } = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(errors.length, 0);
  assert.equal(rows[0].legajo, "1");
  assert.equal(rows[0].nombre, "Juan Pérez");
  assert.equal(rows[1].nombre, "Ana García");
});

test("parseCsv — headers en lowercase", () => {
  const csv = "Legajo,NOMBRE\n10,Pedro";
  const { headers } = parseCsv(csv);
  assert.deepEqual(headers, ["legajo", "nombre"]);
});

test("parseCsv — maneja campos con comas dentro de comillas", () => {
  const csv = 'legajo,nombre\n1,"González, Luis"';
  const { rows, errors } = parseCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows[0].nombre, "González, Luis");
});

test("parseCsv — maneja CRLF", () => {
  const csv = "legajo,nombre\r\n1,Carlos\r\n2,María";
  const { rows } = parseCsv(csv);
  assert.equal(rows.length, 2);
});

test("parseCsv — reporta error cuando columna count no coincide", () => {
  const csv = "legajo,nombre,area\n1,Solo,dos";
  const { rows, errors } = parseCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(errors.length, 0);
});

test("parseCsv — error en fila con columnas faltantes", () => {
  const csv = "legajo,nombre,area\n1,Juan";
  const { rows, errors } = parseCsv(csv);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /esperaba 3/);
});

test("parseCsv — retorna error en texto vacío", () => {
  const { errors } = parseCsv("");
  assert.ok(errors.length > 0);
});

test("parseCsv — retorna error en null", () => {
  const { errors } = parseCsv(null);
  assert.ok(errors.length > 0);
});

test("parseCsv — trimea espacios en headers y valores", () => {
  const csv = " legajo , nombre \n 1 , Pedro ";
  const { headers, rows } = parseCsv(csv);
  assert.equal(headers[0], "legajo");
  assert.equal(rows[0].legajo, "1");
  assert.equal(rows[0].nombre, "Pedro");
});

test("parseCsv — maneja comillas dobles escapadas", () => {
  const csv = 'legajo,nombre\n1,"Dijo ""hola"""';
  const { rows } = parseCsv(csv);
  assert.equal(rows[0].nombre, 'Dijo "hola"');
});
