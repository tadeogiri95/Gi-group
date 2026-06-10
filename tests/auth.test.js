// tests/auth.test.js — Tests de validarPassword (pure function, sin deps externos)
import { test } from "node:test";
import assert from "node:assert/strict";

import { validarPassword } from "../app/lib/validators.ts";

test("validarPassword — acepta contraseña válida", () => {
  const r = validarPassword("Segura123");
  assert.equal(r.valido, true);
});

test("validarPassword — rechaza undefined", () => {
  const r = validarPassword(undefined);
  assert.equal(r.valido, false);
  assert.ok(r.error);
});

test("validarPassword — rechaza null", () => {
  assert.equal(validarPassword(null).valido, false);
});

test("validarPassword — rechaza string vacío", () => {
  assert.equal(validarPassword("").valido, false);
});

test("validarPassword — rechaza menos de 8 caracteres", () => {
  const r = validarPassword("Abc1234");
  assert.equal(r.valido, false);
  assert.match(r.error, /8/);
});

test("validarPassword — rechaza sin mayúscula", () => {
  const r = validarPassword("segura123");
  assert.equal(r.valido, false);
  assert.match(r.error, /mayúscula/i);
});

test("validarPassword — rechaza sin minúscula", () => {
  const r = validarPassword("SEGURA123");
  assert.equal(r.valido, false);
  assert.match(r.error, /minúscula/i);
});

test("validarPassword — rechaza sin número", () => {
  const r = validarPassword("SeguraABC");
  assert.equal(r.valido, false);
  assert.match(r.error, /número/i);
});

test("validarPassword — acepta exactamente 8 caracteres válidos", () => {
  assert.equal(validarPassword("Secure1x").valido, true);
});

test("validarPassword — acepta contraseña larga con símbolos", () => {
  assert.equal(validarPassword("MiClave$Segura999!").valido, true);
});
