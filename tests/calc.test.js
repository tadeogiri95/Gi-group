// ═══════════════════════════════════════════════════════════
// tests/calc.test.js — Tests con Node.js nativo (sin jest)
//
// Ejecutar:
//   npm test
//   (equivalente a: node --test tests/calc.test.js)
//
// Requiere Node 20+ (que ya usás por Next 16 / Vercel).
// ═══════════════════════════════════════════════════════════

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  haversine,
  parseHoraAMinutos,
  calcularTardanza,
  calcularHorasTrabajadas,
  contarLlegadasTarde,
} from "../app/lib/calc.js";

import { passwordInicial } from "../app/lib/passwords.js";


// ═══════════════════════════════════════════════════════════
// haversine
// ═══════════════════════════════════════════════════════════
test("haversine — mismo punto devuelve 0", () => {
  assert.equal(haversine(-31.4135, -64.1811, -31.4135, -64.1811), 0);
});

test("haversine — distancia conocida Córdoba ↔ Buenos Aires ≈ 645 km", () => {
  // Córdoba capital: -31.4135, -64.1811
  // Obelisco BA:    -34.6037, -58.3816
  const d = haversine(-31.4135, -64.1811, -34.6037, -58.3816);
  // Aceptamos ±5 km de error
  assert.ok(d > 640000 && d < 650000, `Esperaba ~645km, obtuve ${Math.round(d)}m`);
});

test("haversine — 100 metros aprox (1 grado lat ≈ 111km)", () => {
  // ~0.001 grados de latitud ≈ 111 metros
  const d = haversine(-31.4135, -64.1811, -31.4135 + 0.001, -64.1811);
  assert.ok(d > 100 && d < 120, `Esperaba ~111m, obtuve ${Math.round(d)}m`);
});

test("haversine — es simétrica", () => {
  const a = haversine(-31.4135, -64.1811, -34.6037, -58.3816);
  const b = haversine(-34.6037, -58.3816, -31.4135, -64.1811);
  assert.equal(Math.round(a), Math.round(b));
});


// ═══════════════════════════════════════════════════════════
// parseHoraAMinutos
// ═══════════════════════════════════════════════════════════
test("parseHoraAMinutos — formatos válidos", () => {
  assert.equal(parseHoraAMinutos("00:00"), 0);
  assert.equal(parseHoraAMinutos("08:00"), 480);
  assert.equal(parseHoraAMinutos("8:00"), 480);
  assert.equal(parseHoraAMinutos("23:59"), 23 * 60 + 59);
});

test("parseHoraAMinutos — formatos inválidos devuelven null", () => {
  assert.equal(parseHoraAMinutos("25:00"), null);
  assert.equal(parseHoraAMinutos("12:60"), null);
  assert.equal(parseHoraAMinutos("hola"), null);
  assert.equal(parseHoraAMinutos(""), null);
  assert.equal(parseHoraAMinutos(null), null);
  assert.equal(parseHoraAMinutos(undefined), null);
});


// ═══════════════════════════════════════════════════════════
// calcularTardanza
// ═══════════════════════════════════════════════════════════
test("calcularTardanza — llegada antes del horario es puntual", () => {
  const r = calcularTardanza("08:00", "07:50", 0);
  assert.equal(r.estado, "puntual");
  assert.equal(r.minutos, 0);
});

test("calcularTardanza — llegada exacta es puntual", () => {
  const r = calcularTardanza("08:00", "08:00", 0);
  assert.equal(r.estado, "puntual");
  assert.equal(r.minutos, 0);
});

test("calcularTardanza — 5 min de tolerancia se acepta como puntual", () => {
  const r = calcularTardanza("08:00", "08:05", 0);
  assert.equal(r.estado, "puntual");
});

test("calcularTardanza — 6 minutos ya es tarde (1ra del mes)", () => {
  const r = calcularTardanza("08:00", "08:06", 0);
  assert.equal(r.estado, "tarde");
  assert.equal(r.minutos, 6);
  assert.equal(r.llegadasTarde, 1);
});

test("calcularTardanza — 20 min tarde con 1 previa es tarde (2da)", () => {
  const r = calcularTardanza("08:00", "08:20", 1);
  assert.equal(r.estado, "tarde");
  assert.equal(r.minutos, 20);
  assert.equal(r.llegadasTarde, 2);
});

test("calcularTardanza — 3ra tarde del mes se bloquea aunque sea poca demora", () => {
  const r = calcularTardanza("08:00", "08:10", 2);
  assert.equal(r.estado, "bloqueado");
  assert.equal(r.llegadasTarde, 3);
  assert.match(r.motivo, /3ra/);
});

test("calcularTardanza — más de 30 min se bloquea aunque sea la 1ra", () => {
  const r = calcularTardanza("08:00", "08:45", 0);
  assert.equal(r.estado, "bloqueado");
  assert.equal(r.minutos, 45);
  assert.match(r.motivo, /30 min/);
});

test("calcularTardanza — horario inválido cae en puntual sin romper", () => {
  const r = calcularTardanza("nope", "08:00", 0);
  assert.equal(r.estado, "puntual");
});


// ═══════════════════════════════════════════════════════════
// calcularHorasTrabajadas
// ═══════════════════════════════════════════════════════════
test("calcularHorasTrabajadas — jornada típica 8 horas", () => {
  assert.equal(calcularHorasTrabajadas("08:00", "16:00"), 8);
});

test("calcularHorasTrabajadas — jornada con fracción", () => {
  assert.equal(calcularHorasTrabajadas("08:00", "16:30"), 8.5);
});

test("calcularHorasTrabajadas — jornada 9hs típica industria", () => {
  assert.equal(calcularHorasTrabajadas("07:00", "16:00"), 9);
});

test("calcularHorasTrabajadas — egreso antes del ingreso devuelve 0", () => {
  // Evita horas negativas. Si pasa esto en producción es un error de datos.
  assert.equal(calcularHorasTrabajadas("16:00", "08:00"), 0);
});

test("calcularHorasTrabajadas — datos faltantes devuelve 0", () => {
  assert.equal(calcularHorasTrabajadas(null, "16:00"), 0);
  assert.equal(calcularHorasTrabajadas("08:00", null), 0);
  assert.equal(calcularHorasTrabajadas("", ""), 0);
});


// ═══════════════════════════════════════════════════════════
// contarLlegadasTarde
// ═══════════════════════════════════════════════════════════
test("contarLlegadasTarde — array vacío", () => {
  const r = contarLlegadasTarde([]);
  assert.equal(r.total, 0);
  assert.equal(r.pierdePresentismo, false);
});

test("contarLlegadasTarde — 2 tardes no pierde presentismo todavía", () => {
  const r = contarLlegadasTarde([
    { llegada_tarde: true },
    { llegada_tarde: false },
    { llegada_tarde: true },
  ]);
  assert.equal(r.total, 2);
  assert.equal(r.pierdePresentismo, false);
});

test("contarLlegadasTarde — 3 tardes pierde presentismo", () => {
  const r = contarLlegadasTarde([
    { llegada_tarde: true },
    { llegada_tarde: true },
    { llegada_tarde: true },
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.pierdePresentismo, true);
});

test("contarLlegadasTarde — input no-array es seguro", () => {
  assert.deepEqual(contarLlegadasTarde(null), { total: 0, pierdePresentismo: false });
  assert.deepEqual(contarLlegadasTarde(undefined), { total: 0, pierdePresentismo: false });
});


// ═══════════════════════════════════════════════════════════
// passwordInicial
// ═══════════════════════════════════════════════════════════
test("passwordInicial — devuelve string de 10 caracteres", () => {
  const p = passwordInicial();
  assert.equal(typeof p, "string");
  assert.equal(p.length, 10);
});

test("passwordInicial — sólo usa caracteres del alfabeto seguro", () => {
  const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]+$/;
  for (let i = 0; i < 50; i++) {
    const p = passwordInicial();
    assert.ok(allowed.test(p), `Password "${p}" contiene caracteres no permitidos`);
  }
});

test("passwordInicial — produce passwords distintos (no es determinista)", () => {
  const set = new Set();
  for (let i = 0; i < 100; i++) set.add(passwordInicial());
  // Con 100 generaciones, esperar al menos 95 únicos (margen ridículo, en la práctica son 100)
  assert.ok(set.size > 95, `Sólo ${set.size} únicos de 100`);
});

test("passwordInicial — no incluye caracteres confundibles (0, O, I, l, 1)", () => {
  // El alfabeto excluye 0, O, I, l, 1 a propósito para no confundir al
  // empleado cuando ve la clave inicial por primera vez.
  const prohibidos = /[0OIl1]/;
  for (let i = 0; i < 50; i++) {
    const p = passwordInicial();
    assert.ok(!prohibidos.test(p), `Password "${p}" contiene caracteres confundibles`);
  }
});
