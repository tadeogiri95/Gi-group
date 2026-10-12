// tests/rls-rutas-chat.test.js — RLS real en el chat (ítem 37, etapa 2)
// Con RLS_RUTAS=on, /api/chat y /api/chat/query leen los datos de la empresa
// con el pase del usuario (rol authenticated + claim eid). El control de
// costos (rpc_check_rate_limit, audit_log) sigue con service_role.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { jwtVerify } from "jose";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

const SUPABASE_JWT_SECRET = "secreto_jwt_de_supabase_para_tests_123456";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { _resetBuckets } = await import("../app/lib/rateLimitMemory.js");
const chat = await import("../app/api/chat/route.js");
const chatQuery = await import("../app/api/chat/query/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  _resetBuckets();
  process.env.SUPABASE_JWT_SECRET = SUPABASE_JWT_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.RLS_RUTAS = "on";
});

afterEach(() => {
  delete process.env.RLS_RUTAS;
});

async function token(rol) {
  const { token: t } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return t;
}

function req(url, tok, body) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify(body),
  });
}

async function eidDe(headers) {
  const pase = headers.Authorization.replace(/^Bearer /, "");
  const { payload } = await jwtVerify(pase, new TextEncoder().encode(SUPABASE_JWT_SECRET), { audience: "authenticated" });
  return payload.eid;
}

const esServiceRole = (h) => h.Authorization === "Bearer test-service-key";

// Registra con qué headers se pidió cada tabla (sin los chequeos de auth).
function tabla(nombre, capturas, body = []) {
  return {
    match: (url) => url.includes(`/rest/v1/${nombre}?`) || url.includes(`/rest/v1/${nombre}/`),
    respond: (url, opts) => { capturas.push({ tabla: nombre, method: opts.method || "GET", headers: opts.headers }); return typeof body === "function" ? body(url, opts) : { status: 200, body }; },
  };
}

test("chat con RLS_RUTAS=on — el contexto va con el pase del usuario; cupo y rate limit con service_role", async () => {
  const capturas = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { ...tabla("empresa", capturas, [{ nombre: "Acme SA", plan_activo: "pro" }]), match: (url) => url.includes("/rest/v1/empresa?") && url.includes("prompt_ia_chat") },
    tabla("rpc", capturas, 1),
    tabla("audit_log", capturas, (url, opts) => opts.method === "POST"
      ? { status: 201 }
      : { status: 200, body: [], headers: { "content-range": "0-0/0" } }),
    tabla("empleados", capturas, [{ nombre: "Juan Pérez", legajo: 7, rol: "operativo", geo_config: null }]),
    tabla("fichadas", capturas),
    tabla("solicitudes", capturas),
    tabla("reglas_bot", capturas),
    {
      match: (url) => url.includes("api.anthropic.com/v1/messages"),
      respond: () => ({ status: 200, body: { content: [{ type: "text", text: "¡Hola!" }], usage: { input_tokens: 1, output_tokens: 1 }, model: "m" } }),
    },
  ]);
  const res = await chat.POST(req("/api/chat", await token("operativo"), { tipo: "chat", messages: [{ role: "user", content: "hola" }] }));
  assert.equal(res.status, 200);

  const delUsuario = ["empleados", "fichadas", "solicitudes", "reglas_bot"];
  for (const t of delUsuario) {
    const cs = capturas.filter((c) => c.tabla === t);
    assert.ok(cs.length > 0, `consulta ${t}`);
    for (const c of cs) assert.equal(await eidDe(c.headers), EMPRESA_ID, `${t} con el pase del usuario`);
  }
  const empresaChat = capturas.filter((c) => c.tabla === "empresa");
  assert.equal(empresaChat.length, 1);
  assert.equal(await eidDe(empresaChat[0].headers), EMPRESA_ID, "datos de la empresa con el pase del usuario");
  for (const c of capturas.filter((c) => c.tabla === "rpc" || c.tabla === "audit_log")) {
    assert.ok(esServiceRole(c.headers), `${c.tabla} ${c.method} sigue con service_role`);
  }
});

test("chat/query con RLS_RUTAS=on — las consultas van con el pase del usuario", async () => {
  const capturas = [];
  global.fetch = createFetchMock([...authPassHandlers(), tabla("fichadas", capturas, [{ legajo: 7, ingreso: "08:00" }]), tabla("empleados", capturas, [{ legajo: 7, nombre: "Juan" }])]);
  const res = await chatQuery.POST(req("/api/chat/query", await token("gerencial"), { query_type: "fichadas_hoy" }));
  assert.equal(res.status, 200);
  assert.deepEqual(capturas.map((c) => c.tabla), ["fichadas", "empleados"]);
  for (const c of capturas) assert.equal(await eidDe(c.headers), EMPRESA_ID, `${c.tabla} con el pase del usuario`);
});

test("chat/query con RLS_RUTAS=on — la vista v_resumen_diario también va con el pase del usuario (096)", async () => {
  const capturas = [];
  global.fetch = createFetchMock([...authPassHandlers(), tabla("v_resumen_diario", capturas)]);
  const res = await chatQuery.POST(req("/api/chat/query", await token("gerencial"), { query_type: "productividad_promedio" }));
  assert.equal(res.status, 200);
  assert.equal(capturas.length, 1);
  assert.equal(await eidDe(capturas[0].headers), EMPRESA_ID);
});

test("chat/query con RLS_RUTAS apagado — sigue con service_role", async () => {
  delete process.env.RLS_RUTAS;
  const capturas = [];
  global.fetch = createFetchMock([...authPassHandlers(), tabla("fichadas", capturas), tabla("empleados", capturas)]);
  const res = await chatQuery.POST(req("/api/chat/query", await token("gerencial"), { query_type: "fichadas_hoy" }));
  assert.equal(res.status, 200);
  for (const c of capturas) assert.ok(esServiceRole(c.headers));
});

test("chat/query con RLS_RUTAS=on sin SUPABASE_JWT_SECRET — 500 sin consultar", async () => {
  delete process.env.SUPABASE_JWT_SECRET;
  const capturas = [];
  global.fetch = createFetchMock([...authPassHandlers(), tabla("fichadas", capturas), tabla("empleados", capturas)]);
  const res = await chatQuery.POST(req("/api/chat/query", await token("gerencial"), { query_type: "fichadas_hoy" }));
  assert.equal(res.status, 500);
  assert.equal(capturas.length, 0, "no vuelve en silencio a la llave maestra");
});
