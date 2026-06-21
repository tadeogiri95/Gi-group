// tests/api-refresh-token.test.js — Tests HTTP de POST /api/refresh-token
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signRefreshToken, signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/refresh-token/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function refreshTokenValido() {
  const { token, jti } = await signRefreshToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID });
  return { token, jti };
}

async function accessTokenValido() {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  return token;
}

function req(body) {
  return new Request("http://localhost/api/refresh-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function handlersBase(refreshJti) {
  return [
    {
      match: (url) => url.includes("/rest/v1/sesiones?refresh_jti=eq."),
      respond: (url) => {
        if (refreshJti && url.includes(`refresh_jti=eq.${refreshJti}`)) {
          return { status: 200, body: [{ id: "sesion-1" }] };
        }
        return { status: 200, body: [] };
      },
    },
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("activo=eq.true"),
      respond: () => ({
        status: 200,
        body: [{ id: EMPLEADO_ID, legajo: 7, empresa_id: EMPRESA_ID, rol: "gerencial" }],
      }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "PATCH",
      respond: () => ({ status: 200, body: [] }),
    },
  ];
}

test("refresh-token — sin refresh_token devuelve 400", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(req({}));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("requerido"));
});

test("refresh-token — token inválido devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(req({ refresh_token: "token-invalido-basura" }));
  assert.equal(res.status, 401);
});

test("refresh-token — access token (type!=refresh) devuelve 401", async () => {
  const accessToken = await accessTokenValido();
  global.fetch = createFetchMock([]);
  const res = await POST(req({ refresh_token: accessToken }));
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("inválido"));
});

test("refresh-token — sesión revocada (JTI no matchea) devuelve 401", async () => {
  const { token } = await refreshTokenValido();
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/sesiones?refresh_jti=eq."),
      respond: () => ({ status: 200, body: [] }),
    },
  ]);
  const res = await POST(req({ refresh_token: token }));
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("Sesión expirada"));
});

test("refresh-token — empleado inactivo devuelve 401", async () => {
  const { token, jti } = await refreshTokenValido();
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/sesiones?refresh_jti=eq."),
      respond: () => ({ status: 200, body: [{ id: "sesion-1" }] }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("activo=eq.true"),
      respond: () => ({ status: 200, body: [] }),
    },
  ]);
  const res = await POST(req({ refresh_token: token }));
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("inactivo"));
});

test("refresh-token — rotación exitosa devuelve nuevo token y cookies httpOnly", async () => {
  const { token, jti } = await refreshTokenValido();
  let sessionPatched = false;
  let patchBody = null;

  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/sesiones?refresh_jti=eq."),
      respond: () => ({ status: 200, body: [{ id: "sesion-1" }] }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("activo=eq.true"),
      respond: () => ({
        status: 200,
        body: [{ id: EMPLEADO_ID, legajo: 7, empresa_id: EMPRESA_ID, rol: "gerencial" }],
      }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/sesiones?id=eq.") && opts?.method === "PATCH",
      respond: (url, opts) => {
        sessionPatched = true;
        patchBody = JSON.parse(opts.body);
        return { status: 200, body: [] };
      },
    },
  ]);

  const res = await POST(req({ refresh_token: token }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.ok(json.token, "debe devolver un nuevo access token");
  assert.equal(json.expires_in, 30 * 60);
  assert.equal(sessionPatched, true, "debe actualizar la sesión con el nuevo JTI");
  assert.ok(patchBody.refresh_jti, "debe rotar el refresh_jti");
  assert.ok(patchBody.token_hash, "debe actualizar token_hash");

  const setCookie = res.headers.get("set-cookie") || "";
  assert.ok(setCookie.includes("gypi_token="), "debe setear cookie gypi_token");
  assert.ok(setCookie.includes("gypi_refresh="), "debe setear cookie gypi_refresh");
});

test("refresh-token — fallo en PATCH de sesión devuelve 503 (no emite tokens inseguros)", async () => {
  const { token, jti } = await refreshTokenValido();

  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/sesiones?refresh_jti=eq."),
      respond: () => ({ status: 200, body: [{ id: "sesion-1" }] }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("activo=eq.true"),
      respond: () => ({
        status: 200,
        body: [{ id: EMPLEADO_ID, legajo: 7, empresa_id: EMPRESA_ID, rol: "gerencial" }],
      }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/sesiones?id=eq.") && opts?.method === "PATCH",
      respond: () => ({ status: 500, body: "DB connection error" }),
    },
  ]);

  const res = await POST(req({ refresh_token: token }));
  assert.equal(res.status, 503, "debe devolver 503 si no puede garantizar la rotación atómica");
});
