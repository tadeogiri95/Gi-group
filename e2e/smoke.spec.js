// e2e/smoke.spec.js — Smoke test E2E: login → fichar ingreso/egreso → ver historial
//
// Corre contra el dev server real (npm run dev) pero intercepta las
// llamadas a /api/* con datos de prueba — no requiere una Supabase real
// ni credenciales. El objetivo es validar que el camino crítico de
// navegación y UI no se rompe entre deploys, no la corrección exacta de
// los datos (eso ya lo cubren los tests HTTP de cada ruta).
import { test, expect } from "@playwright/test";

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

const USUARIO = {
  id: "22222222-2222-2222-2222-222222222222",
  empresa_id: EMPRESA.id,
  legajo: 7,
  nombre: "Ana Test",
  apodo: "Ana",
  rol: "empleado",
  diagrama: null,
  debe_cambiar_password: false,
};

// Datos por defecto para cualquier tabla consultada vía /api/data — el
// smoke test no necesita datos reales, solo que la UI no se rompa.
const DATA_POR_TABLA = {
  empleados: [USUARIO],
  fichadas: [],
  solicitudes: [],
  notificaciones: [],
  reglas_bot: [],
  mensajes_chat: [],
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
      json: { usuario: USUARIO, expires_in: 1800 },
      headers: { "set-cookie": "gypi_token=fake-jwt-para-smoke-test; Path=/; HttpOnly" },
    });
  });

  await page.route("**/api/data", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const tabla = (body.path || "").split("?")[0];
    await route.fulfill({ json: { ok: true, data: DATA_POR_TABLA[tabla] ?? [], nextCursor: null } });
  });

  await page.route("**/api/fichar", async (route) => {
    await route.fulfill({ json: { ok: true, hora: "08:05", tardanza: { estado: "puntual", minutos: 0 } } });
  });
}

test("smoke: login → fichar ingreso → ver historial", async ({ page }) => {
  await mockApis(page);

  await page.goto(`/${EMPRESA.slug}`);

  // ─── Login ───
  await page.getByPlaceholder("Legajo o email").fill(String(USUARIO.legajo));
  await page.getByPlaceholder("Contraseña").fill("Segura123");
  await page.getByText("Ingresar", { exact: true }).click();

  await expect(page.getByText(`Hola, ${USUARIO.apodo}`)).toBeVisible({ timeout: 10_000 });

  // ─── Ir al chat y fichar ingreso ("Ya llegué" es acción directa, sin IA) ───
  await page.getByText("Chat", { exact: true }).click();
  await page.getByText("Ya llegué", { exact: true }).click();
  await expect(page.getByText(/Fichado|Ingreso registrado/i)).toBeVisible({ timeout: 10_000 });

  // ─── Fichar egreso ("Me voy" es la otra acción directa, sin IA) ───
  await page.getByText("Me voy", { exact: true }).click();
  await expect(page.getByText(/Salida registrada/i)).toBeVisible({ timeout: 10_000 });

  // ─── Volver a inicio (el chat ocupa toda la pantalla, sin nav) y ver historial ───
  await page.goBack();
  await expect(page.getByText(`Hola, ${USUARIO.apodo}`)).toBeVisible({ timeout: 10_000 });
  await page.getByText("Historial de fichajes", { exact: true }).click();
  await expect(page.getByText(/Fichajes|Mi asistencia/i)).toBeVisible({ timeout: 10_000 });
});
