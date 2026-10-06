// tests/api-empleados-activacion.test.js — POST /api/empleados/activacion
// (generar un código de acceso nuevo; auditoría F2-03 / F4-01)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/empleados/activacion/route.js");
const { hashCodigo } = await import("../app/lib/activacion.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const YO_ID = "22222222-2222-2222-2222-222222222222";
const OTRO_ID = "33333333-3333-3333-3333-333333333333";

async function token(rol) {
  const { token: t } = await signAccessToken({ empleadoId: YO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return t;
}

function req(body, t) {
  const headers = { "Content-Type": "application/json" };
  if (t) headers.Authorization = `Bearer ${t}`;
  return new Request("http://localhost/api/empleados/activacion", { method: "POST", headers, body: JSON.stringify(body) });
}

function mock({ empleado = { id: OTRO_ID, legajo: 8, nombre: "Juan", rol: "operativo" } } = {}) {
  const c = { patch: null, patchUrl: null, empleadoUrl: null };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, o) => url.includes("/rest/v1/empleados?id=eq.") && o?.method === "PATCH",
      respond: (url, o) => { c.patchUrl = url; c.patch = JSON.parse(o.body); return { status: 200, body: [{ id: OTRO_ID }] }; },
    },
    {
      match: (url) => url.includes("/rest/v1/empleados?id=eq."),
      respond: (url) => { c.empleadoUrl = url; return { status: 200, body: empleado ? [empleado] : [] }; },
    },
    { match: (url) => url.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ slug: "acme" }] }) },
  ]);
  return c;
}

test("activacion — sin token → 401", async () => {
  mock();
  const res = await POST(req({ empleado_id: OTRO_ID }));
  assert.equal(res.status, 401);
});

test("activacion — operativo → 403", async () => {
  mock();
  const res = await POST(req({ empleado_id: OTRO_ID }, await token("operativo")));
  assert.equal(res.status, 403);
});

test("activacion — empleado_id inválido → 400", async () => {
  mock();
  const res = await POST(req({ empleado_id: "1 or 1=1" }, await token("gerencial")));
  assert.equal(res.status, 400);
});

test("activacion — no se puede para la propia cuenta → 400", async () => {
  mock();
  const res = await POST(req({ empleado_id: YO_ID }, await token("gerencial")));
  assert.equal(res.status, 400);
});

test("activacion — empleado de otra empresa → 404", async () => {
  const c = mock({ empleado: null });
  const res = await POST(req({ empleado_id: OTRO_ID }, await token("gerencial")));
  assert.equal(res.status, 404);
  assert.ok(c.empleadoUrl.includes(`empresa_id=eq.${EMPRESA_ID}`));
  assert.equal(c.patch, null);
});

test("activacion — administrativo no puede generar códigos para gerenciales ni administrativos", async () => {
  for (const rol of ["gerencial", "administrativo"]) {
    const c = mock({ empleado: { id: OTRO_ID, legajo: 8, nombre: "Jefa", rol } });
    const res = await POST(req({ empleado_id: OTRO_ID }, await token("administrativo")));
    assert.equal(res.status, 403, rol);
    assert.equal(c.patch, null);
  }
});

test("activacion — administrativo puede para un operativo; guarda solo el hash", async () => {
  const c = mock();
  const res = await POST(req({ empleado_id: OTRO_ID }, await token("administrativo")));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.match(json.activacion.codigo, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(json.activacion.link, `https://gypi.app/acme/unirse?code=${json.activacion.codigo}`);
  assert.equal(c.patch.activacion_codigo_hash, hashCodigo(json.activacion.codigo));
  assert.ok(c.patch.activacion_expira);
  assert.deepEqual(Object.keys(c.patch).sort(), ["activacion_codigo_hash", "activacion_expira"], "no toca la contraseña actual");
  assert.ok(c.patchUrl.includes(`empresa_id=eq.${EMPRESA_ID}`));
});

test("activacion — gerencial puede para cualquier rol", async () => {
  mock({ empleado: { id: OTRO_ID, legajo: 8, nombre: "Admin", rol: "administrativo" } });
  const res = await POST(req({ empleado_id: OTRO_ID }, await token("gerencial")));
  assert.equal(res.status, 200);
});
