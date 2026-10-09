// tests/esquema-horas-extra.test.js — fichadas.horas_extra tiene que ser numérica.
// En producción quedó boolean (la 031 no hizo nada porque la columna ya
// existía) y el servidor guarda horas con decimales al fichar la salida:
// Postgres lo rechazaba y no se podía fichar la salida con horas extra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const raiz = new URL("../supabase/", import.meta.url);
const base = readFileSync(new URL("baseline/esquema-base.sql", raiz), "utf8");
const migracion = readFileSync(new URL("migrations/085_horas_extra_numerica.sql", raiz), "utf8");

test("la línea base de producción tiene horas_extra boolean (el problema)", () => {
  assert.match(base, /horas_extra boolean DEFAULT false/);
});

test("085 la pasa a numeric solo si es boolean, conserva los datos y deja default 0", () => {
  assert.match(migracion, /data_type FROM information_schema\.columns[\s\S]*column_name = 'horas_extra'\) = 'boolean'/);
  assert.match(migracion, /ALTER COLUMN horas_extra TYPE numeric\s+USING \(CASE WHEN horas_extra THEN COALESCE\(horas_extras, 1\) ELSE 0 END\)/);
  assert.match(migracion, /ALTER COLUMN horas_extra SET DEFAULT 0/);
});

test("085 es la primera migración posterior a la línea base que toca horas_extra", () => {
  const posteriores = readdirSync(new URL("migrations/", raiz))
    .filter((n) => /^\d{3}_/.test(n) && Number(n.slice(0, 3)) >= 73 && Number(n.slice(0, 3)) < 85);
  for (const n of posteriores) {
    assert.doesNotMatch(readFileSync(new URL(`migrations/${n}`, raiz), "utf8"), /\bhoras_extra\b/, n);
  }
});

test("el servidor guarda horas_extra como número al fichar la salida", () => {
  const fichar = readFileSync(new URL("../app/lib/ficharServidor.js", import.meta.url), "utf8");
  assert.match(fichar, /horas_extra: horasExtra,/);
});
