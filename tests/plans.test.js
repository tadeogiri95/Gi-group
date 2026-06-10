import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PLANES, planPermite, planTieneModulo, planLimite } from "../app/lib/plans.js";

// ── planPermite ──────────────────────────────────────────────

describe("planPermite", () => {
  it("free: exportar_csv → false", () => {
    assert.equal(planPermite("free", "exportar_csv"), false);
  });

  it("free: exportar_pdf → false", () => {
    assert.equal(planPermite("free", "exportar_pdf"), false);
  });

  it("free: geolocalizacion → false", () => {
    assert.equal(planPermite("free", "geolocalizacion"), false);
  });

  it("starter: exportar_csv → true", () => {
    assert.equal(planPermite("starter", "exportar_csv"), true);
  });

  it("starter: exportar_pdf → false", () => {
    assert.equal(planPermite("starter", "exportar_pdf"), false);
  });

  it("starter: soporte → true (valor 'email' cuenta como habilitado)", () => {
    assert.equal(planPermite("starter", "soporte"), true);
  });

  it("pro: exportar_pdf → true", () => {
    assert.equal(planPermite("pro", "exportar_pdf"), true);
  });

  it("pro: reglas_bot → true", () => {
    assert.equal(planPermite("pro", "reglas_bot"), true);
  });

  it("pro: soporte → true (valor 'prioritario')", () => {
    assert.equal(planPermite("pro", "soporte"), true);
  });

  it("enterprise: api_access → true", () => {
    assert.equal(planPermite("enterprise", "api_access"), true);
  });

  it("enterprise: soporte → true (valor 'sla')", () => {
    assert.equal(planPermite("enterprise", "soporte"), true);
  });

  it("plan desconocido: cae a free", () => {
    assert.equal(planPermite("unknown_plan", "exportar_csv"), false);
  });

  it("free: branding_gypi → true", () => {
    assert.equal(planPermite("free", "branding_gypi"), true);
  });

  it("pro: branding_gypi → false", () => {
    assert.equal(planPermite("pro", "branding_gypi"), false);
  });
});

// ── planTieneModulo ──────────────────────────────────────────

describe("planTieneModulo", () => {
  it("free: fichaje → true", () => {
    assert.equal(planTieneModulo("free", "fichaje"), true);
  });

  it("free: proyectos → false", () => {
    assert.equal(planTieneModulo("free", "proyectos"), false);
  });

  it("free: calendario → false", () => {
    assert.equal(planTieneModulo("free", "calendario"), false);
  });

  it("starter: proyectos → true", () => {
    assert.equal(planTieneModulo("starter", "proyectos"), true);
  });

  it("starter: calendario → false", () => {
    assert.equal(planTieneModulo("starter", "calendario"), false);
  });

  it("pro: calendario → true", () => {
    assert.equal(planTieneModulo("pro", "calendario"), true);
  });

  it("enterprise: calendario → true", () => {
    assert.equal(planTieneModulo("enterprise", "calendario"), true);
  });

  it("plan desconocido: cae a free (fichaje → true, proyectos → false)", () => {
    assert.equal(planTieneModulo("ghost", "fichaje"), true);
    assert.equal(planTieneModulo("ghost", "proyectos"), false);
  });
});

// ── planLimite ───────────────────────────────────────────────

describe("planLimite", () => {
  it("free: max_empleados → 5", () => {
    assert.equal(planLimite("free", "max_empleados"), 5);
  });

  it("free: max_ubicaciones → 0", () => {
    assert.equal(planLimite("free", "max_ubicaciones"), 0);
  });

  it("starter: max_empleados → 15", () => {
    assert.equal(planLimite("starter", "max_empleados"), 15);
  });

  it("starter: max_ubicaciones → 1", () => {
    assert.equal(planLimite("starter", "max_ubicaciones"), 1);
  });

  it("pro: max_empleados → 50", () => {
    assert.equal(planLimite("pro", "max_empleados"), 50);
  });

  it("pro: max_ubicaciones → 999", () => {
    assert.equal(planLimite("pro", "max_ubicaciones"), 999);
  });

  it("enterprise: max_empleados → 99999", () => {
    assert.equal(planLimite("enterprise", "max_empleados"), 99999);
  });

  it("enterprise: max_ubicaciones → 9999", () => {
    assert.equal(planLimite("enterprise", "max_ubicaciones"), 9999);
  });

  it("plan desconocido: cae a free (max_empleados → 5)", () => {
    assert.equal(planLimite("ghost", "max_empleados"), 5);
  });

  it("campo inexistente: devuelve 0 (fallback ??)", () => {
    assert.equal(planLimite("pro", "campo_inexistente"), 0);
  });

  // enterprise.precio es null → planLimite devuelve 0 (null ?? 0)
  it("enterprise: precio null → 0 por fallback ??", () => {
    assert.equal(planLimite("enterprise", "precio"), 0);
  });
});

// ── PLANES struct sanity ─────────────────────────────────────

describe("PLANES estructura", () => {
  const planIds = ["free", "starter", "pro", "enterprise"];

  it("todos los planes tienen los campos obligatorios", () => {
    const campos = ["id", "nombre", "modulos", "max_empleados", "max_ubicaciones"];
    for (const id of planIds) {
      for (const campo of campos) {
        assert.ok(Object.hasOwn(PLANES[id], campo), `${id}.${campo} falta`);
      }
    }
  });

  it("max_empleados crece monótonamente: free < starter < pro < enterprise", () => {
    assert.ok(PLANES.free.max_empleados < PLANES.starter.max_empleados);
    assert.ok(PLANES.starter.max_empleados < PLANES.pro.max_empleados);
    assert.ok(PLANES.pro.max_empleados < PLANES.enterprise.max_empleados);
  });

  it("free es el único plan con branding_gypi = true", () => {
    assert.equal(PLANES.free.branding_gypi, true);
    assert.equal(PLANES.starter.branding_gypi, false);
    assert.equal(PLANES.pro.branding_gypi, false);
    assert.equal(PLANES.enterprise.branding_gypi, false);
  });

  it("api_access solo en enterprise", () => {
    assert.equal(PLANES.free.api_access, false);
    assert.equal(PLANES.starter.api_access, false);
    assert.equal(PLANES.pro.api_access, false);
    assert.equal(PLANES.enterprise.api_access, true);
  });
});
