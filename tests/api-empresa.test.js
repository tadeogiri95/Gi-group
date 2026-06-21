// tests/api-empresa.test.js — Tests HTTP de GET/PATCH /api/empresa
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { GET, PATCH } = await import("../app/api/empresa/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function getReq(params = {}) {
  const url = new URL("http://localhost/api/empresa");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

function patchReq(body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/empresa", {
    method: "PATCH", headers, body: JSON.stringify(body),
  });
}

const EMPRESA_PUBLICA = {
  id: EMPRESA_ID, nombre: "Empresa Test", nombre_corto: "EmpTest",
  slug: "empresa-test", color_primario: "#F97316", color_secundario: "#7C3AED",
  color_fondo: "#F7F7F5", color_texto: "#1A1A1A", typography: null,
  theme_preset: null, logo_url: null, rubro: "construccion", activa: true,
};

const EMPRESA_COMPLETA = {
  ...EMPRESA_PUBLICA, admin_email: "admin@test.com", plan_activo: "starter",
  onboarding_completado: true, trial_usado: false, max_empleados: 25,
  timezone: "America/Argentina/Buenos_Aires", prompt_ia_obra: null, prompt_ia_chat: null,
  created_at: "2026-01-01T00:00:00Z",
};

// ─── GET con slug (público) ───

test("GET empresa — slug válido devuelve datos públicos", async () => {
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/empresa?slug=eq."),
      respond: () => ({ status: 200, body: [EMPRESA_PUBLICA] }),
    },
  ]);
  const res = await GET(getReq({ slug: "empresa-test" }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.nombre, "Empresa Test");
  assert.equal(json.admin_email, undefined, "no debe exponer admin_email en endpoint público");
  assert.ok(res.headers.get("cache-control")?.includes("public"), "debe tener cache público");
});

test("GET empresa — slug con caracteres especiales se sanitiza", async () => {
  let capturedUrl = null;
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/empresa?slug=eq."),
      respond: (url) => { capturedUrl = url; return { status: 200, body: [EMPRESA_PUBLICA] }; },
    },
  ]);
  await GET(getReq({ slug: "Emp<script>TEST" }));
  assert.ok(capturedUrl, "debe hacer la query a supabase");
  assert.ok(!capturedUrl.includes("<script>"), "debe eliminar caracteres no alfanuméricos");
  assert.ok(capturedUrl.includes("empscripttest") || capturedUrl.includes("emptest"), "debe limpiar a lowercase alfanumérico");
});

test("GET empresa — slug inexistente devuelve 404", async () => {
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/empresa?slug=eq."),
      respond: () => ({ status: 200, body: [] }),
    },
  ]);
  const res = await GET(getReq({ slug: "no-existe" }));
  assert.equal(res.status, 404);
});

test("GET empresa — empresa inactiva devuelve 403", async () => {
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/empresa?slug=eq."),
      respond: () => ({ status: 200, body: [{ ...EMPRESA_PUBLICA, activa: false }] }),
    },
  ]);
  const res = await GET(getReq({ slug: "empresa-test" }));
  assert.equal(res.status, 403);
});

test("GET empresa — slug vacío devuelve 400", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(getReq({ slug: "!!!" }));
  assert.equal(res.status, 400);
});

// ─── GET con token (privado) ───

test("GET empresa — con token devuelve datos completos", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empresa?id=eq.") && !url.includes("email_verificado"),
      respond: () => ({ status: 200, body: [EMPRESA_COMPLETA] }),
    },
  ]);

  const req = new Request("http://localhost/api/empresa", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const res = await GET(req);
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.plan_activo, "starter");
  assert.ok(res.headers.get("cache-control")?.includes("no-store"), "datos privados no deben cachearse");
});

test("GET empresa — sin token ni slug devuelve defaults", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(getReq());
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.nombre, "Gypi", "sin token debe devolver defaults");
});

// ─── PATCH ───

test("PATCH empresa — gerencial puede actualizar nombre y colores", async () => {
  const token = await tokenConRol("gerencial");
  let patchedData = null;

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.") && opts?.method === "PATCH",
      respond: (url, opts) => {
        patchedData = JSON.parse(opts.body);
        return { status: 200, body: [{ ...EMPRESA_COMPLETA, ...patchedData }] };
      },
    },
  ]);

  const res = await PATCH(patchReq({ nombre: "Nuevo Nombre", color_primario: "#FF0000" }, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(patchedData.nombre, "Nuevo Nombre");
  assert.equal(patchedData.color_primario, "#FF0000");
});

test("PATCH empresa — operativo recibe 403", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await PATCH(patchReq({ nombre: "Hack" }, token));
  assert.equal(res.status, 403);
});

test("PATCH empresa — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await PATCH(patchReq({ nombre: "Hack" }, null));
  assert.equal(res.status, 401);
});

test("PATCH empresa — schema strict rechaza campos no definidos", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);

  const res = await PATCH(patchReq({
    nombre: "OK",
    plan_activo: "enterprise",
  }, token));
  assert.equal(res.status, 400, "schema .strict() debe rechazar campos desconocidos como plan_activo");
});

test("PATCH empresa — solo campos editables llegan al DB", async () => {
  const token = await tokenConRol("gerencial");
  let patchedData = null;

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.") && opts?.method === "PATCH",
      respond: (url, opts) => {
        patchedData = JSON.parse(opts.body);
        return { status: 200, body: [EMPRESA_COMPLETA] };
      },
    },
  ]);

  const res = await PATCH(patchReq({
    nombre: "Nombre Nuevo",
    rubro: "construccion",
    color_primario: "#FF0000",
  }, token));

  assert.equal(res.status, 200);
  assert.equal(patchedData.nombre, "Nombre Nuevo");
  assert.equal(patchedData.rubro, "construccion");
  assert.equal(patchedData.color_primario, "#FF0000");
});

test("PATCH empresa — body vacío (sin campos editables) devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await PATCH(patchReq({ plan_activo: "enterprise" }, token));
  assert.equal(res.status, 400);
});
