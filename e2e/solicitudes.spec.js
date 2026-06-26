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

const SOLICITUD_ID = "33333333-3333-3333-3333-333333333333";

// tipo "permiso" sin palabras clave de permiso-de-ingreso/cambio-de-horario
// cae en el branch genérico de InboxScreen.resolver() (solo dispara un POST
// a notificaciones además del PATCH), que es lo único que nos importa mockear.
function crearSolicitudPendiente() {
  return {
    id: SOLICITUD_ID,
    empleado_id: "22222222-2222-2222-2222-222222222222",
    legajo: GERENTE.legajo,
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

  await page.route("**/api/data", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const tabla = (body.path || "").split("?")[0];

    // PATCH a solicitudes (aprobar/rechazar) — muta el estado compartido para
    // que los refetch posteriores (cargarSolicitudes() + reload de HomeContent)
    // vean la solicitud ya resuelta y deje de listarse como pendiente.
    if (tabla === "solicitudes" && body.method === "PATCH") {
      const id = (body.path.match(/id=eq\.([^&]+)/) || [])[1];
      state.solicitudes = state.solicitudes.map((s) => (s.id === id ? { ...s, ...body.body } : s));
      await route.fulfill({ json: { ok: true, data: state.solicitudes.filter((s) => s.id === id) } });
      return;
    }

    // Cualquier otra escritura (ej. POST a notificaciones tras resolver) —
    // no le importa al test, solo que no rompa la cadena de promesas.
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

  // ─── Ir al Inbox y ver la solicitud pendiente ───
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Inbox" }).click();

  await expect(page.getByText("Permiso médico")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: `Aprobar solicitud de legajo ${GERENTE.legajo}` })).toBeVisible();

  // ─── Aprobarla ───
  await page.getByRole("button", { name: `Aprobar solicitud de legajo ${GERENTE.legajo}` }).click();

  // ─── Desaparece de "Pendientes" ───
  // Acotado a la Bandeja de solicitudes (Inbox): DashboardGerencia queda
  // montado en segundo plano (oculto con CSS, no desmontado — ver commit
  // 9f21451) y su propia sección "Solicitudes pendientes" en Inicio
  // también puede mostrar el mismo texto, lo que rompe un getByText
  // global en modo estricto (resuelve a 2 elementos).
  const bandeja = page.getByRole("region", { name: "Bandeja de solicitudes" });
  await expect(bandeja.getByText("Permiso médico")).not.toBeVisible({ timeout: 10_000 });
  await expect(bandeja.getByText("Todo al día")).toBeVisible();
});
