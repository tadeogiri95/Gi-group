// e2e/fichar-gps.spec.js — Operario ficha con el botón grande y el GPS del
// teléfono (F1-16, F1-17, ítem 35). El permiso de ubicación y la posición los
// da playwright.config.js; /api/* se intercepta como en smoke.spec.js.
import { test, expect } from "@playwright/test";

const EMPRESA = {
  id: "11111111-1111-1111-1111-111111111111",
  nombre: "Empresa GPS Test",
  nombre_corto: "GpsCo",
  slug: "gps-test",
  color_primario: "#F97316",
  color_secundario: "#7C3AED",
  plan_activo: "pro",
  onboarding_completado: true,
};

const USUARIO = {
  id: "22222222-2222-2222-2222-222222222222",
  empresa_id: EMPRESA.id,
  legajo: 7,
  nombre: "Ana Test",
  apodo: "Ana",
  rol: "operativo",
  diagrama: null,
  debe_cambiar_password: false,
};

async function mockApis(page, fichadas) {
  await page.route("**/api/empresa**", (route) => route.fulfill({ json: EMPRESA }));
  await page.route("**/api/config-empresa**", (route) => route.fulfill({ json: { divisiones: [], etapas: [] } }));
  await page.route("**/api/login-empresa", (route) => route.fulfill({
    json: { usuario: USUARIO, expires_in: 1800 },
    headers: { "set-cookie": "gypi_token=fake-jwt-para-e2e; Path=/; HttpOnly" },
  }));
  await page.route("**/api/data", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const tabla = (body.path || "").split("?")[0];
    await route.fulfill({ json: { ok: true, data: tabla === "empleados" ? [USUARIO] : [], nextCursor: null } });
  });
  await page.route("**/api/fichar", async (route) => {
    fichadas.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ json: { ok: true, hora: "08:02", tardanza: { estado: "puntual", minutos: 0 } } });
  });
}

test("operario: ficha la entrada con el botón grande y manda la ubicación del teléfono", async ({ page }) => {
  const fichadas = [];
  await mockApis(page, fichadas);
  await page.goto(`/${EMPRESA.slug}`);

  await page.getByPlaceholder("Legajo o email").fill(String(USUARIO.legajo));
  await page.getByPlaceholder("Contraseña").fill("Segura123");
  await page.getByText("Ingresar", { exact: true }).click();
  await expect(page.getByText(`Hola, ${USUARIO.apodo}`)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /Fichar ingreso/i }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText(/Ingreso fichado a las 08:02/)).toBeVisible({ timeout: 10_000 });

  expect(fichadas).toHaveLength(1);
  expect(fichadas[0].accion).toBe("ingreso");
  expect(fichadas[0].geo_lat).toBeCloseTo(-31.4201, 3);
  expect(fichadas[0].geo_lng).toBeCloseTo(-64.1888, 3);
  expect(fichadas[0].geo_precision).toBe(20);
});
