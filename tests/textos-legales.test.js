// tests/textos-legales.test.js — Textos legales (ítem 29, F2-17, F6-07): lo publicado
// no contradice al sistema y los borradores para el abogado están completos.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const leer = (ruta) => fs.readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

test("privacidad publicada — nombra a todos los proveedores que tratan datos", () => {
  const p = leer("app/privacy/page.js");
  for (const proveedor of ["Supabase", "Vercel", "Firebase", "Anthropic", "Resend", "Mercado Pago", "Sentry"]) {
    assert.ok(p.includes(proveedor), `falta ${proveedor}`);
  }
  assert.match(p, /fuera de Argentina/);
  assert.match(p, /90 días/, "plazo de las ubicaciones (limpiar-tokens borra geo_registros a los 90 días)");
  assert.ok(!p.includes("Este permiso es opcional"), "el GPS no es opcional si la empresa exige fichar en el lugar (F2-17)");
});

test("términos publicados — ya no ofrecen un plan gratuito (D20)", () => {
  const t = leer("app/terms/page.js");
  assert.ok(!t.includes("planes gratuitos y de pago"));
  assert.ok(!t.includes("Para el plan gratuito (Free)"));
  assert.match(t, /prueba gratuita de 30 días/);
});

test("borradores para el abogado — existen, avisan que son borradores y marcan lo que falta completar", () => {
  for (const archivo of ["README.md", "terminos.md", "privacidad.md", "acuerdo-tratamiento-datos.md"]) {
    const texto = leer(`auditoria/legal/${archivo}`);
    assert.match(texto, /revisi[oó]n/i, `${archivo} sin aviso de revisión`);
  }
  for (const archivo of ["terminos.md", "privacidad.md", "acuerdo-tratamiento-datos.md"]) {
    assert.match(leer(`auditoria/legal/${archivo}`), /BORRADOR PARA REVISIÓN LEGAL/);
    assert.match(leer(`auditoria/legal/${archivo}`), /\[NOMBRE Y APELLIDO DEL TITULAR\]/);
  }
  const privacidad = leer("auditoria/legal/privacidad.md");
  assert.match(privacidad, /AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA/, "leyenda obligatoria de la AAIP");
  for (const proveedor of ["Supabase", "Vercel", "Anthropic", "Resend", "Google", "Mercado Pago", "Sentry"]) {
    assert.ok(privacidad.includes(proveedor), `privacidad: falta ${proveedor}`);
    assert.ok(leer("auditoria/legal/acuerdo-tratamiento-datos.md").includes(proveedor.split(" ")[0]), `acuerdo: falta ${proveedor}`);
  }
});
