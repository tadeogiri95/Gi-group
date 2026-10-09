// tests/api-empleados-tarjetas-email.test.js — POST /api/empleados/tarjetas-email
// (R10: "Te mando los QR por email" al terminar el alta).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

// lib/email.js crea el cliente de Resend al importarse: la clave va antes.
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.RESEND_API_KEY = "re_test_clave_falsa";

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/empleados/tarjetas-email/route.js");
const { hashCodigo } = await import("../app/lib/activacion.js");

const YO_ID = "22222222-2222-2222-2222-222222222222";
let n = 0;
// Cada prueba usa una empresa distinta: el límite de envíos es por empresa.
const nuevaEmpresa = () => `11111111-1111-1111-1111-${String(++n).padStart(12, "0")}`;

async function token(rol, empresaId) {
  const { token: t } = await signAccessToken({ empleadoId: YO_ID, empresaId, legajo: 1, rol });
  return t;
}

function req(body, t) {
  const headers = { "Content-Type": "application/json" };
  if (t) headers.Authorization = `Bearer ${t}`;
  return new Request("http://localhost/api/empleados/tarjetas-email", { method: "POST", headers, body: JSON.stringify(body) });
}

const EMPLEADOS = [
  { legajo: 7, nombre: "Ana Gómez", activacion_codigo_hash: hashCodigo("ABCD-2345") },
  { legajo: 8, nombre: "Luis Díaz", activacion_codigo_hash: hashCodigo("WXYZ-6789") },
];

function mock({ empresa = { nombre: "Acme", slug: "acme", admin_email: "duena@acme.com" }, empleados = EMPLEADOS, resend = { status: 200, body: { id: "msg_1" } } } = {}) {
  const c = { email: null, empleadosUrl: null };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq.") && u.includes("admin_email"), respond: () => ({ status: 200, body: empresa ? [empresa] : [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?empresa_id=eq."), respond: (u) => { c.empleadosUrl = u; return { status: 200, body: empleados }; } },
    { match: (u) => u.includes("api.resend.com"), respond: (u, o) => { c.email = JSON.parse(o.body); return resend; } },
  ]);
  return c;
}

const TARJETAS = [{ legajo: 7, codigo: "ABCD-2345" }, { legajo: 8, codigo: "WXYZ-6789" }];

test("tarjetas-email — sin token → 401", async () => {
  mock();
  const res = await POST(req({ tarjetas: TARJETAS }));
  assert.equal(res.status, 401);
});

test("tarjetas-email — operativo → 403", async () => {
  mock();
  const res = await POST(req({ tarjetas: TARJETAS }, await token("operativo", nuevaEmpresa())));
  assert.equal(res.status, 403);
});

test("tarjetas-email — sin tarjetas o con datos inválidos → 400 sin mandar nada", async () => {
  const c = mock();
  const t = await token("gerencial", nuevaEmpresa());
  assert.equal((await POST(req({ tarjetas: [] }, t))).status, 400);
  assert.equal((await POST(req({}, t))).status, 400);
  assert.equal((await POST(req({ tarjetas: [{ legajo: "7) or (1=1", codigo: "ABCD-2345" }] }, t))).status, 400);
  assert.equal(c.email, null);
});

test("tarjetas-email — manda al email de la empresa, con el adjunto imprimible y el link armado en el servidor", async () => {
  const empresaId = nuevaEmpresa();
  const c = mock();
  const res = await POST(req({ tarjetas: TARJETAS, to: "otro@malo.com" }, await token("gerencial", empresaId)));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual(d, { ok: true, email: "duena@acme.com", enviadas: 2 });
  assert.ok(c.empleadosUrl.includes(`empresa_id=eq.${empresaId}`), "solo empleados de la propia empresa");
  assert.ok(c.empleadosUrl.includes("legajo=in.(7,8)"));
  assert.deepEqual(c.email.to, "duena@acme.com", "nunca a un destino que venga en el pedido");
  assert.match(c.email.html, /Ana Gómez/);
  assert.match(c.email.html, /ABCD-2345/);
  const adjunto = Buffer.from(c.email.attachments[0].content, "base64").toString("utf8");
  assert.equal(c.email.attachments[0].filename, "tarjetas-gypi.html");
  assert.match(adjunto, /<svg/, "trae los QR");
  assert.match(adjunto, /Legajo 8 · Código WXYZ-6789/);
  assert.match(c.email.html, /\/acme\/unirse\?code=WXYZ-6789/, "el link de cada persona, para reenviarlo");
});

test("tarjetas-email — un código que no coincide con el guardado no sale", async () => {
  const c = mock();
  const res = await POST(req({ tarjetas: [{ legajo: 7, codigo: "ABCD-2345" }, { legajo: 8, codigo: "ZZZZ-2222" }] }, await token("gerencial", nuevaEmpresa())));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).enviadas, 1);
  assert.doesNotMatch(c.email.html, /Luis Díaz/);
});

test("tarjetas-email — si ningún código coincide → 400 y no manda", async () => {
  const c = mock();
  const res = await POST(req({ tarjetas: [{ legajo: 7, codigo: "QQQQ-3333" }] }, await token("gerencial", nuevaEmpresa())));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Generá nuevos desde Personal/);
  assert.equal(c.email, null);
});

test("tarjetas-email — empresa sin email → 400", async () => {
  mock({ empresa: { nombre: "Acme", slug: "acme", admin_email: null } });
  const res = await POST(req({ tarjetas: TARJETAS }, await token("gerencial", nuevaEmpresa())));
  assert.equal(res.status, 400);
});

test("tarjetas-email — si el proveedor de email falla → 502 con mensaje claro", async () => {
  mock({ resend: { status: 500, body: { name: "application_error", message: "caído" } } });
  const res = await POST(req({ tarjetas: TARJETAS }, await token("gerencial", nuevaEmpresa())));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /No pudimos mandar el email/);
});

test("tarjetas-email — más de 5 envíos por hora en la misma empresa → 429", async () => {
  mock();
  const t = await token("gerencial", nuevaEmpresa());
  for (let i = 0; i < 5; i++) assert.equal((await POST(req({ tarjetas: TARJETAS }, t))).status, 200);
  assert.equal((await POST(req({ tarjetas: TARJETAS }, t))).status, 429);
});
