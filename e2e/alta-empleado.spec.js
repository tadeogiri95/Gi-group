// e2e/alta-empleado.spec.js — E2E: login gerencial → Equipo → alta de un
// empleado nuevo → aparece en la lista.
//
// Cubre el flujo migrado a POST /api/empleados (bcrypt server-side, legajo
// único, límite de plan): asegura que la pantalla realmente pega a esa ruta
// (y no al viejo camino por /api/data) y que el refetch posterior lista al
// empleado creado.
//
// Mismo patrón que smoke.spec.js: corre contra el dev server real pero
// intercepta /api/* con datos de prueba — no requiere Supabase real.
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

async function mockApis(page, state) {
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

  // La ruta nueva del alta — acá tiene que llegar el POST (no a /api/data)
  await page.route("**/api/empleados**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      state.altaRecibida = body;
      const nuevo = {
        id: "55555555-5555-5555-5555-555555555555",
        empresa_id: EMPRESA.id,
        legajo: parseInt(body.legajo, 10),
        nombre: body.nombre,
        apodo: body.apodo,
        rol: body.rol || "operativo",
        area: body.area || "produccion",
        division: body.division || null,
        activo: true,
        debe_cambiar_password: true,
        estado_activacion: body.pre_cargado || body.email ? "pendiente_activacion" : "activo",
      };
      state.empleados.push(nuevo);
      await route.fulfill({ status: 201, json: nuevo });
      return;
    }
    await route.fulfill({ json: state.empleados });
  });

  await page.route("**/api/data", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const tabla = (body.path || "").split("?")[0];

    if (body.method === "POST" || body.method === "PATCH") {
      await route.fulfill({ json: { ok: true, data: [{}] } });
      return;
    }

    const DATA_POR_TABLA = {
      empleados: state.empleados,
      fichadas: [],
      solicitudes: [],
      reglas_bot: [],
      notificaciones: [],
    };
    await route.fulfill({ json: { ok: true, data: DATA_POR_TABLA[tabla] ?? [], nextCursor: null } });
  });
}

test("alta de empleado: gerencia crea un empleado y aparece en la lista", async ({ page }) => {
  const state = {
    empleados: [{ id: GERENTE.id, legajo: GERENTE.legajo, nombre: GERENTE.nombre, apodo: GERENTE.apodo, rol: "gerencial", division: null, activo: true }],
    altaRecibida: null,
  };
  await mockApis(page, state);


  await page.goto(`/${EMPRESA.slug}`);

  // ─── Login como gerencial ───
  await page.getByPlaceholder("Legajo o email").fill(String(GERENTE.legajo));
  await page.getByPlaceholder("Contraseña").fill("Segura123");
  await page.getByText("Ingresar", { exact: true }).click();

  // ─── Ir a Equipo ───
  await expect(page.getByRole("button", { name: "Equipo" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Equipo" }).click();

  // ─── Abrir el modal de alta ───
  await page.getByRole("button", { name: "+ Alta" }).click();
  const modal = page.getByRole("dialog", { name: "Alta de empleado" });
  await expect(modal).toBeVisible();

  // Los inputs del modal van en orden: nombre, legajo, apodo, email
  const inputs = modal.locator("input.g-input");
  await inputs.nth(0).fill("juana prueba");
  await inputs.nth(1).fill("123");

  await modal.getByRole("button", { name: "Dar de alta" }).click();

  // ─── El alta pegó a /api/empleados con el payload correcto ───
  await expect
    .poll(() => state.altaRecibida, { timeout: 10_000, message: "el alta debe ir a POST /api/empleados" })
    .not.toBe(null);
  expect(state.altaRecibida.nombre).toBe("Juana Prueba"); // capitalizado client-side
  expect(state.altaRecibida.legajo).toBe("123");
  expect(state.altaRecibida).not.toHaveProperty("password"); // la contraseña se genera y hashea server-side

  // ─── El refetch posterior lista al empleado nuevo ───
  await expect(page.getByText("Juana Prueba")).toBeVisible({ timeout: 10_000 });
});
