// tests/ot-ligada.test.js — migración 194 (14/11): la OT ligada en Pedidos,
// Órdenes de compra y Movimientos de stock (proyecto_id + trigger que liga por
// el texto). Probada además contra PostgreSQL 16 al escribirla.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

const sql = readFileSync(new URL("../supabase/migrations/194_ot_ligada.sql", import.meta.url), "utf8");
const TABLAS = ["pedidos_compra", "ordenes_compra_items", "movimientos_stock"];

test("migración 194 — proyecto_id con clave foránea y trigger en las tres tablas", () => {
  for (const t of TABLAS) {
    assert.match(sql, new RegExp(`alter table public\\.${t} add column if not exists proyecto_id bigint references public\\.proyectos\\(id\\) on delete set null`));
    assert.match(sql, new RegExp(`create trigger ${t}_ligar_ot before insert or update of ot, proyecto_id on public\\.${t}`));
    assert.match(sql, new RegExp(`update public\\.${t} x set proyecto_id = p\\.id, ot = left\\(p\\.ot, 40\\)`), `liga lo viejo de ${t}`);
  }
  assert.match(sql, /function public\.gypi_ot_de_texto\(p_empresa uuid, p_ot text\)/);
  assert.match(sql, /having count\(\*\) = 1/, "por número solo si hay una sola OT");
  assert.match(sql, /^do \$mig\$/m);
  const m = MIGRACIONES.find((x) => x.n === 194);
  assert.deepEqual(Object.keys(m.tablas), TABLAS);
  assert.deepEqual(m.funciones, ["gypi_ot_de_texto"]);
});
