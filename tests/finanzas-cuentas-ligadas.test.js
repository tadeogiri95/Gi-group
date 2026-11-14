// tests/finanzas-cuentas-ligadas.test.js — migración 193 (14/11): la cuenta
// del debe y del haber de cada operación ligada al plan de cuentas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cuentaFueraDelPlan, errorFinanzas, textoCuentaFueraDelPlan } from "../app/lib/finanzasApi.js";
import { pendientesFinanzas } from "../app/lib/finanzasInicio.js";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

const sql = readFileSync(new URL("../supabase/migrations/193_cuentas_ligadas.sql", import.meta.url), "utf8");
// Como lo devuelve PostgREST al chocar con la clave foránea
const ERROR = new Error(`POST fin_operaciones: {"code":"23503","details":"Key (empresa_id, cuenta_debe)=(11111111-1111-1111-1111-111111111111, 99.01.01) is not present in table \\"fin_cuentas\\".","hint":null,"message":"insert or update on table \\"fin_operaciones\\" violates foreign key constraint \\"fin_operaciones_cuenta_debe_plan\\""}`);

test("migración 193 — claves foráneas al plan, sin romper lo viejo, y la lista de cuentas fuera del plan", () => {
  for (const lado of ["debe", "haber"]) {
    assert.match(sql, new RegExp(`constraint fin_operaciones_cuenta_${lado}_plan\\s+foreign key \\(empresa_id, cuenta_${lado}\\) references public\\.fin_cuentas \\(empresa_id, codigo\\) not valid`));
  }
  assert.match(sql, /validate constraint fin_operaciones_cuenta_debe_plan/);
  assert.match(sql, /exception when foreign_key_violation/);
  assert.match(sql, /function public\.fin_cuentas_sin_plan\(p_empresa uuid\)/);
  assert.match(sql, /^do \$mig\$/m);
  assert.deepEqual(MIGRACIONES.find((m) => m.n === 193).funciones, ["fin_cuentas_sin_plan"]);
});

test("error de la base — la cuenta fuera del plan se explica en castellano", async () => {
  assert.equal(cuentaFueraDelPlan(ERROR), "99.01.01");
  assert.equal(cuentaFueraDelPlan(new Error("otra cosa")), null);
  const r = errorFinanzas(ERROR, "prueba");
  assert.equal(r.status, 400);
  const d = await r.json();
  assert.equal(d.error, textoCuentaFueraDelPlan("99.01.01"));
  assert.match(d.error, /La cuenta 99\.01\.01 no está en el plan de cuentas/);
});

test("Inicio — avisa las cuentas usadas que no están en el plan", () => {
  const p = pendientesFinanzas({ hoy: "2026-11-14", cuentasSinPlan: [{ cuenta: "99.01.01", operaciones: 3 }, { cuenta: "99.02", operaciones: 1 }] });
  assert.deepEqual(p.map((x) => [x.id, x.ir, x.cantidad, x.tono]), [["cuentas_sin_plan", "fin-config", 4, "rojo"]]);
  assert.match(p[0].texto, /2 cuentas usadas no están en el plan de cuentas \(99\.01\.01, 99\.02\)/);
  assert.equal(pendientesFinanzas({ hoy: "2026-11-14" }).length, 0);
});
