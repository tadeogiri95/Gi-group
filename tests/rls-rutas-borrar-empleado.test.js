// tests/rls-rutas-borrar-empleado.test.js — RLS real al borrar los datos de
// un empleado (ítem 37, etapa 2). Con RLS_RUTAS=on, la lectura y la
// anonimización van con el pase del usuario en vez de service_role.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { jwtVerify } from "jose";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

const SUPABASE_JWT_SECRET = "secreto_jwt_de_supabase_para_tests_123456";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/admin/borrar-empleado/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const OTRO_ID = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = SUPABASE_JWT_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.RLS_RUTAS = "on";
});

afterEach(() => {
  delete process.env.RLS_RUTAS;
});

async function pedido() {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  return new Request("http://localhost/api/admin/borrar-empleado", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ empleado_id: OTRO_ID }),
  });
}

function capturar(capturas) {
  return {
    match: (url) => url.includes(`/rest/v1/empleados?id=eq.${OTRO_ID}`),
    respond: (url, opts) => {
      capturas.push({ method: opts.method || "GET", headers: opts.headers });
      return opts.method === "PATCH" ? { status: 204 } : { status: 200, body: [{ id: OTRO_ID, legajo: 9, nombre: "Ana" }] };
    },
  };
}

async function eidDe(headers) {
  const pase = headers.Authorization.replace(/^Bearer /, "");
  const { payload } = await jwtVerify(pase, new TextEncoder().encode(SUPABASE_JWT_SECRET), { audience: "authenticated" });
  return payload.eid;
}

test("borrar-empleado con RLS_RUTAS=on — lee y anonimiza con el pase del usuario", async () => {
  const capturas = [];
  global.fetch = createFetchMock([...authPassHandlers(), capturar(capturas)]);
  const res = await POST(await pedido());
  assert.equal(res.status, 200);
  assert.deepEqual(capturas.map((c) => c.method), ["GET", "PATCH"]);
  for (const c of capturas) assert.equal(await eidDe(c.headers), EMPRESA_ID);
  assert.equal(capturas[1].headers.Prefer, "return=minimal");
});

test("borrar-empleado con RLS_RUTAS apagado — sigue con service_role", async () => {
  delete process.env.RLS_RUTAS;
  const capturas = [];
  global.fetch = createFetchMock([...authPassHandlers(), capturar(capturas)]);
  const res = await POST(await pedido());
  assert.equal(res.status, 200);
  for (const c of capturas) assert.equal(c.headers.Authorization, "Bearer test-service-key");
});
