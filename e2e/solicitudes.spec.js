// e2e/solicitudes.spec.js — E2E: login gerencial → ver solicitud pendiente
// en el Inbox → aprobarla → confirmar que desaparece de "Pendientes".
//
// Mismo patrón que smoke.spec.js: corre contra el dev server real pero
// intercepta /api/* con datos de prueba — no requiere Supabase real ni
// credenciales.
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

const SOLICITUD_ID = 33;

// Aprobar/rechazar va a POST /api/solicitudes/resolver (ítem 38): el servidor
// guarda todo junto. El mock marca la solicitud como resuelta en el estado.
function crearSolicitudPendiente() {
  return {
    id: SOLICITUD_ID,
    empleado_id: "22222222-2222-2222-2222-222222222222",
    legajo: GERENTE.legajo,
    nombre_empleado: "Juan Pérez",
    tipo: "permiso",
    estado: "pendiente",
    motivo: "Permiso médico",
    detalle: null,
    fecha: "2026-06-20",
    created_at: "2026-06-20T10:00:00Z",
    desde: null,
    datos_horario: null,
  };
}

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

  await page.route("**/api/solicitudes/resolver", async (route) => {
    const { id, estado } = JSON.parse(route.request().postData() || "{}");
    state.solicitudes = state.solicitudes.map((s) => (s.id === id ? { ...s, estado } : s));
    await route.fulfill({ json: { ok: true, push: null } });
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
      solicitudes: state.solicitudes,
      reglas_bot: [],
      notificaciones: [],
    };
    await route.fulfill({ json: { ok: true, data: DATA_POR_TABLA[tabla] ?? [], nextCursor: null } });
  });
}

test("solicitudes: gerencia aprueba una solicitud pendiente desde el Inbox", async ({ page }) => {
  const state = { solicitudes: [crearSolicitudPendiente()] };
  await mockApis(page, state);


  await page.goto(`/${EMPRESA.slug}`);

  // ─── Login como gerencial ───
  await page.getByPlaceholder("Legajo o email").fill(String(GERENTE.legajo));
  await page.getByPlaceholder("Contraseña").fill("Segura123");
  await page.getByText("Ingresar", { exact: true }).click();

  // ─── Ir a Pedidos y ver la solicitud pendiente ───
  await expect(page.getByRole("navigation").getByRole("button", { name: "Pedidos", exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("navigation").getByRole("button", { name: "Pedidos", exact: true }).click();

  await expect(page.getByText("Permiso médico")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Aprobar solicitud de Juan Pérez" })).toBeVisible();

  // ─── Aprobarla (pide confirmación y deja 5 s para deshacer, F4-07) ───
  await page.getByRole("button", { name: "Aprobar solicitud de Juan Pérez" }).click();
  await page.getByRole("button", { name: "Sí, aprobar" }).click();
  await expect(page.getByRole("button", { name: "Deshacer" })).toBeVisible();

  // ─── Desaparece de "Pendientes" ───
  // Acotado a la Bandeja de solicitudes (Inbox): DashboardGerencia queda
  // montado en segundo plano (oculto con CSS, no desmontado — ver commit
  // 9f21451) y su propia sección "Solicitudes pendientes" en Inicio
  // también puede mostrar el mismo texto, lo que rompe un getByText
  // global en modo estricto (resuelve a 2 elementos).
  const bandeja = page.getByRole("region", { name: "Bandeja de solicitudes" });
  await expect(bandeja.getByText("Permiso médico")).not.toBeVisible({ timeout: 15_000 });
  await expect(bandeja.getByText("Todo al día")).toBeVisible();
});
