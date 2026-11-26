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
  const dias = (Date.parse(patchBody.expira_en) - Date.now()) / 86400000;
  assert.ok(dias > 29.9 && dias <= 30, "la sesión se extiende 30 días desde este uso (F1-03)");

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

test("refresh-token — solo busca sesiones no revocadas (F2-12: revocar por cambio de contraseña corta la renovación)", async () => {
  const { token } = await refreshTokenValido();
  let urlSesion = null;
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/sesiones?refresh_jti=eq."),
      respond: (url) => { urlSesion = url; return { status: 200, body: [] }; },
    },
  ]);
  const res = await POST(req({ refresh_token: token }));
  assert.equal(res.status, 401);
  assert.ok(urlSesion.includes("revocada=eq.false"), urlSesion);
});

// ── Gracia de 2 minutos y fallas pasajeras (migración 212) ──

test("refresh-token — pase recién reemplazado (otra pestaña renovó): devuelve el pase vigente sin rotar", async () => {
  const { token, jti } = await refreshTokenValido();
  let patcheo = false;
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/sesiones?refresh_jti=eq."),
      respond: () => ({ status: 200, body: [] }),
    },
    {
      match: (url) => url.includes("/rest/v1/sesiones?refresh_jti_anterior=eq."),
      respond: (url) => {
        assert.ok(url.includes(`refresh_jti_anterior=eq.${jti}`));
        assert.ok(url.includes("rotado_en=gt."));
        assert.ok(url.includes("revocada=eq.false"));
        return { status: 200, body: [{ id: "sesion-1", jti: "jti-vigente", refresh_jti: "refresh-vigente" }] };
      },
    },
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("activo=eq.true"),
      respond: () => ({ status: 200, body: [{ id: EMPLEADO_ID, legajo: 7, empresa_id: EMPRESA_ID, rol: "gerencial" }] }),
    },
    {
      match: (url, opts) => opts?.method === "PATCH",
      respond: () => { patcheo = true; return { status: 200, body: [] }; },
    },
  ]);
  const res = await POST(req({ refresh_token: token }));
  assert.equal(res.status, 200);
  assert.equal(patcheo, false, "en gracia no vuelve a rotar");
  const { verifyToken } = await import("../app/lib/jwt.ts");
  const json = await res.json();
  const acceso = await verifyToken(json.token, "acceso");
  assert.equal(acceso.jti, "jti-vigente", "las dos pestañas quedan con el mismo pase");
  const setCookie = res.headers.get("set-cookie") || "";
  const refreshCookie = setCookie.match(/gypi_refresh=([^;]+)/)[1];
  const refresh = await verifyToken(refreshCookie, "refresh");
  assert.equal(refresh.jti, "refresh-vigente");
});

test("refresh-token — la base no responde: 503 (reintentar), no 401 (cerrar sesión)", async () => {
  const { token } = await refreshTokenValido();
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/sesiones?refresh_jti=eq."),
      respond: () => ({ status: 500, body: "timeout" }),
    },
  ]);
  const res = await POST(req({ refresh_token: token }));
  assert.equal(res.status, 503);
});

test("refresh-token — falla al buscar el empleado: 503, no 'usuario inactivo'", async () => {
  const { token } = await refreshTokenValido();
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/sesiones?refresh_jti=eq."),
      respond: () => ({ status: 200, body: [{ id: "sesion-1" }] }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados"),
      respond: () => ({ status: 503, body: "caída" }),
    },
  ]);
  const res = await POST(req({ refresh_token: token }));
  assert.equal(res.status, 503);
});

test("refresh-token — al rotar guarda el pase anterior para la gracia; sin la 212 guarda igual", async () => {
  const { token, jti } = await refreshTokenValido();
  const cuerpos = [];
  global.fetch = createFetchMock([
    ...handlersBase(jti).filter((h) => !h.match("https://x/rest/v1/sesiones?id=eq.1", { method: "PATCH" })),
    {
      match: (url, opts) => url.includes("/rest/v1/sesiones?id=eq.") && opts?.method === "PATCH",
      respond: (url, opts) => {
        const b = JSON.parse(opts.body);
        cuerpos.push(b);
        // Base sin la migración 212: la columna nueva no existe
        if ("refresh_jti_anterior" in b) return { status: 400, body: { code: "PGRST204" } };
        return { status: 200, body: [] };
      },
    },
  ]);
  const res = await POST(req({ refresh_token: token }));
  assert.equal(res.status, 200);
  assert.equal(cuerpos.length, 2);
  assert.equal(cuerpos[0].refresh_jti_anterior, jti);
  assert.ok(cuerpos[0].rotado_en);
  assert.equal("refresh_jti_anterior" in cuerpos[1], false);
});
