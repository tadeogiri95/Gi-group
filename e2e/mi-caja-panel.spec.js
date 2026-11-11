// e2e/mi-caja-panel.spec.js — 11/11: en el Panel del Dueño, "📱 Mi caja" se
// abría adentro de su tarjeta (la tarjeta se mueve al pasar el mouse y la
// ventana quedaba cortada). Ahora la ventana ocupa la pantalla, como en el
// Inicio del empleado. Mismo patrón que solicitudes.spec.js: /api/* simulado.
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

const EMPRESA = {
  id: "11111111-1111-1111-1111-111111111111",
  nombre: "Empresa Smoke Test",
  nombre_corto: "SmokeCo",
  slug: "smoke-test",
  color_primario: "#F97316",
  color_secundario: "#7C3AED",
  plan_activo: "pro",
  onboarding_completado: true,
};

const GERENTE = {
  id: "44444444-4444-4444-4444-444444444444",
  empresa_id: EMPRESA.id,
  legajo: 7,
  nombre: "Marta Gerente",
  apodo: "Marta",
  rol: "gerencial",
  diagrama: null,
  debe_cambiar_password: false,
};



async function mockApis(page) {
  await page.route("**/api/empresa**", async (route) => {
    await route.fulfill({ json: EMPRESA });
  });

  await page.route("**/api/config-empresa**", async (route) => {
    await route.fulfill({ json: { divisiones: [], etapas: [] } });
  });

  await page.route("**/api/login-empresa", async (route) => {
    await route.fulfill({
      json: { usuario: GERENTE, expires_in: 1800 },
      headers: { "set-cookie": "gypi_token=fake-jwt-para-e2e; Path=/; HttpOnly" },
    });
  });

  await page.route("**/api/mi-caja", async (route) => {
    await route.fulfill({ json: MI_CAJA });
  });

  await page.route("**/api/data", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const tabla = (body.path || "").split("?")[0];

    // Cualquier escritura que no le importa al test: que no rompa la cadena.
    if (body.method === "POST") {
      await route.fulfill({ json: { ok: true, data: [{}] } });
      return;
    }

    const DATA_POR_TABLA = {
      empleados: [{ id: GERENTE.id, legajo: GERENTE.legajo, nombre: GERENTE.nombre, apodo: GERENTE.apodo, division: "produccion" }],
      fichadas: [],
      solicitudes: [],
      reglas_bot: [],
      notificaciones: [],
    };
    await route.fulfill({ json: { ok: true, data: DATA_POR_TABLA[tabla] ?? [], nextCursor: null } });
  });
}


const MI_CAJA = {
  hoy: "2026-11-11",
  conceptos: { gastos: ["Combustible", "Librería"], ingresos: ["Me dieron plata"] },
  para_confirmar: [],
  esperando: [],
  cajas: [{
    cuenta: "01.01.01.001.001.06", nombre: "Caja Marta", moneda: "ARS", saldo: 125000, para_revisar: 1, destinos: [],
    movimientos: [
      { id: 1, fecha: "2026-11-10", concepto: "Combustible", descripcion: "", sale: 15000, entra: 0, estado: "para_revisar", propia: true },
      { id: 2, fecha: "2026-11-09", concepto: "Me dieron plata", descripcion: "De Caja Principal", sale: 0, entra: 140000, estado: "confirmado", propia: false },
    ],
  }],
};

test("mi caja: desde el Panel del Dueño se abre entera, con el saldo y los botones", async ({ page }) => {
  await mockApis(page);
  await page.goto(`/${EMPRESA.slug}`);
  await page.getByPlaceholder("Legajo o email").fill(String(GERENTE.legajo));
  await page.getByPlaceholder("Contraseña").fill("Segura123");
  await page.getByText("Ingresar", { exact: true }).click();

  const tarjeta = page.getByRole("region", { name: "Mi caja" });
  await expect(tarjeta).toBeVisible({ timeout: 15_000 });
  await tarjeta.getByRole("button").click();

  const ventana = page.getByRole("dialog", { name: "📱 Mi caja" });
  await expect(ventana).toBeVisible();
  // Ocupa toda la pantalla (antes quedaba del tamaño de la tarjeta)
  const caja = await ventana.boundingBox();
  expect(caja.width).toBeGreaterThanOrEqual(1270);
  expect(caja.height).toBeGreaterThanOrEqual(890);
  await expect(ventana.getByText("Caja Marta")).toBeVisible();
  await expect(ventana.getByRole("button", { name: "➖ Gasté" })).toBeVisible();
  await expect(ventana.getByRole("button", { name: "➕ Recibí plata" })).toBeVisible();

  // "Gasté" abre su ventana arriba de la de Mi caja, también entera
  await ventana.getByRole("button", { name: "➖ Gasté" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  const gasto = await page.getByRole("dialog").nth(1).boundingBox();
  expect(gasto.width).toBeGreaterThanOrEqual(1270);
});
