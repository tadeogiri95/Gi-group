// tests/rate-limit.test.js — Tests de lógica de ventanas de rate limiting
import { test } from "node:test";
import assert from "node:assert/strict";
import { ventana15min, validarFormatoEmail } from "../app/lib/rateLimit.js";

function calcularVentana(isoDate) {
  return ventana15min(new Date(isoDate));
}

test("ventana de rate limit — minuto 0 cae en :00", () => {
  assert.equal(calcularVentana("2024-01-15T10:00:00.000Z"), "2024-01-15T10:00");
});

test("ventana de rate limit — minuto 14 cae en :00", () => {
  assert.equal(calcularVentana("2024-01-15T10:14:59.000Z"), "2024-01-15T10:00");
});

test("ventana de rate limit — minuto 15 cae en :15", () => {
  assert.equal(calcularVentana("2024-01-15T10:15:00.000Z"), "2024-01-15T10:15");
});

test("ventana de rate limit — minuto 29 cae en :15", () => {
  assert.equal(calcularVentana("2024-01-15T10:29:00.000Z"), "2024-01-15T10:15");
});

test("ventana de rate limit — minuto 30 cae en :30", () => {
  assert.equal(calcularVentana("2024-01-15T10:30:00.000Z"), "2024-01-15T10:30");
});

test("ventana de rate limit — minuto 45 cae en :45", () => {
  assert.equal(calcularVentana("2024-01-15T10:45:00.000Z"), "2024-01-15T10:45");
});

test("ventana de rate limit — minuto 59 cae en :45", () => {
  assert.equal(calcularVentana("2024-01-15T10:59:59.000Z"), "2024-01-15T10:45");
});

test("ventana de rate limit — cambio de hora es consistente", () => {
  const v1 = calcularVentana("2024-01-15T10:59:59.000Z");
  const v2 = calcularVentana("2024-01-15T11:00:00.000Z");
  assert.notEqual(v1, v2);
  assert.equal(v1, "2024-01-15T10:45");
  assert.equal(v2, "2024-01-15T11:00");
});

test("email válido — formato estándar", () => {
  assert.ok(validarFormatoEmail("usuario@empresa.com"));
});

test("email válido — subdominio", () => {
  assert.ok(validarFormatoEmail("user@mail.empresa.com.ar"));
});

test("email inválido — sin @", () => {
  assert.equal(validarFormatoEmail("usuario.empresa.com"), false);
});

test("email inválido — sin dominio", () => {
  assert.equal(validarFormatoEmail("usuario@"), false);
});

test("email inválido — con espacios", () => {
  assert.equal(validarFormatoEmail("usu ario@empresa.com"), false);
});

test("email inválido — vacío", () => {
  assert.equal(validarFormatoEmail(""), false);
});
