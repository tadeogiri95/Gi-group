// tests/api-solicitudes-resolver.test.js — POST /api/solicitudes/resolver
// (ítem 38: aprobar o rechazar en una sola transacción).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/solicitudes/resolver/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const YO_ID = "22222222-2222-2222-2222-222222222222";
const EMP_ID = "33333333-3333-3333-3333-333333333333";

async function token(rol) {
  const { token: t } = await signAccessToken({ empleadoId: YO_ID, empresaId: EMPRESA_ID, legajo: 1, rol });
  return t;
}

function req(body, t) {
  const headers = { "Content-Type": "application/json" };
  if (t) headers.Authorization = `Bearer ${t}`;
  return new Request("http://localhost/api/solicitudes/resolver", { method: "POST", headers, body: JSON.stringify(body) });
}

const PERMISO = { id: 42, empleado_id: EMP_ID, legajo: 7, tipo: "permiso", motivo: "Turno médico", estado: "pendiente", fecha: "2026-10-08", created_at: "2026-10-07T12:00:00Z" };

function mock({ sol = PERMISO, rpc = "ok", fichada = null, diagrama = null } = {}) {
  const c = { rpc: null, solUrl: null, lecturasExtra: [] };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/rpc/resolver_solicitud"), respond: (u, o) => { c.rpc = JSON.parse(o.body); return { status: 200, body: JSON.stringify(rpc) }; } },
    { match: (u) => u.includes("/rest/v1/solicitudes?id=eq."), respond: (u) => { c.solUrl = u; return { status: 200, body: sol ? [sol] : [] }; } },
    { match: (u) => u.includes(`/rest/v1/empleados?id=eq.${YO_ID}`), respond: () => ({ status: 200, body: [{ apodo: "Laura", nombre: "Laura Gómez" }] }) },
    { match: (u) => u.includes(`/rest/v1/empleados?id=eq.${EMP_ID}`), respond: (u) => { c.lecturasExtra.push(u); return { status: 200, body: [{ diagrama }] }; } },
    { match: (u) => u.includes("/rest/v1/fichadas?"), respond: (u) => { c.lecturasExtra.push(u); return { status: 200, body: fichada ? [fichada] : [] }; } },
    { match: (u) => u.includes("/rest/v1/empresa?") && u.includes("timezone"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa?") && u.includes("plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
  ]);
  return c;
}

test("resolver — sin token → 401", async () => {
  mock();
  assert.equal((await POST(req({ id: 42, estado: "aprobado" }))).status, 401);
});

test("resolver — un operativo no puede → 403 y no escribe", async () => {
  const c = mock();
  assert.equal((await POST(req({ id: 42, estado: "aprobado" }, await token("operativo")))).status, 403);
  assert.equal(c.rpc, null);
});

test("resolver — datos inválidos → 400", async () => {
  mock();
  const t = await token("gerencial");
  assert.equal((await POST(req({ id: "42 or 1=1", estado: "aprobado" }, t))).status, 400);
  assert.equal((await POST(req({ id: 42, estado: "registrado" }, t))).status, 400);
  assert.equal((await POST(req({ id: 42, estado: "aprobado", extra: 1 }, t))).status, 400);
});

test("resolver — de otra empresa o inexistente → 404", async () => {
  const c = mock({ sol: null });
  const res = await POST(req({ id: 42, estado: "aprobado" }, await token("gerencial")));
  assert.equal(res.status, 404);
  assert.ok(c.solUrl.includes(`empresa_id=eq.${EMPRESA_ID}`));
  assert.equal(c.rpc, null);
});

test("resolver — ya resuelta antes de empezar → 409 sin escribir", async () => {
  const c = mock({ sol: { ...PERMISO, estado: "aprobado" } });
  const res = await POST(req({ id: 42, estado: "rechazado" }, await token("gerencial")));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).tipo, "ya_resuelta");
  assert.equal(c.rpc, null);
});

test("resolver — otra persona la resolvió mientras tanto (la base dice ya_resuelta) → 409", async () => {
  mock({ rpc: "ya_resuelta" });
  const res = await POST(req({ id: 42, estado: "aprobado" }, await token("gerencial")));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Otra persona ya respondió/);
});

test("resolver — rechazo con nota: todo en una llamada a la base, con el aviso armado", async () => {
  const c = mock();
  const res = await POST(req({ id: 42, estado: "rechazado", nota: "  Falta el certificado " }, await token("administrativo")));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual(d.push, { legajo: "7", titulo: "❌ Permiso rechazado", cuerpo: "Tu Permiso fue rechazado por Laura" });
  assert.equal(c.rpc.p_empresa, EMPRESA_ID, "la empresa sale de la sesión");
  assert.equal(c.rpc.p_id, 42);
  assert.equal(c.rpc.p_estado, "rechazado");
  assert.equal(c.rpc.p_aprobador, "Laura");
  assert.equal(c.rpc.p_nota, "Falta el certificado");
  assert.equal(c.rpc.p_fichada, null);
  assert.equal(c.rpc.p_horas_extra, null);
  assert.equal(c.rpc.p_notificacion.destinatario_rol, "7");
  assert.match(c.rpc.p_notificacion.detalle, /Comentario: "Falta el certificado"$/);
});

test("resolver — permiso de ingreso aprobado: manda la fichada a crear en la misma transacción", async () => {
  const c = mock({ sol: { ...PERMISO, motivo: "🔓 Permiso de ingreso (08:40)" } });
  const res = await POST(req({ id: 42, estado: "aprobado" }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.equal(c.rpc.p_fichada.empleado_id, EMP_ID);
  assert.equal(c.rpc.p_fichada.legajo, 7);
  assert.equal(c.rpc.p_fichada.ingreso, "08:40");
  assert.match(c.rpc.p_fichada.fecha, /^\d{4}-\d{2}-\d{2}$/);
});

test("resolver — hora extra aprobada: busca la fichada de la empresa y manda las horas", async () => {
  const c = mock({
    sol: { ...PERMISO, tipo: "hora_extra", motivo: "Hora extra", fecha: "2026-10-05" },
    fichada: { id: "f-50", fecha: "2026-10-05", ingreso: "08:30:00", egreso: "18:00:00" },
    diagrama: { lun: { in: "08:00", out: "17:00" } },
  });
  const res = await POST(req({ id: 42, estado: "aprobado" }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.deepEqual(c.rpc.p_horas_extra, { fichada_id: "f-50", horas: 0.5 });
  assert.ok(c.lecturasExtra.every((u) => u.includes(`empresa_id=eq.${EMPRESA_ID}`)), "las lecturas quedan dentro de la empresa");
});

test("migración 086 — bloquea la fila, verifica que siga pendiente y solo la usa el servidor", async () => {
  const fs = await import("node:fs");
  const sql = fs.readFileSync(new URL("../supabase/migrations/086_resolver_solicitud.sql", import.meta.url), "utf8");
  assert.match(sql, /for update;/);
  assert.match(sql, /if v_estado is distinct from 'pendiente' then\s+return 'ya_resuelta';/);
  assert.match(sql, /security definer\s+set search_path = public/);
  assert.match(sql, /revoke all on function public\.resolver_solicitud\([^)]*\) from anon, authenticated;/);
  assert.match(sql, /on conflict \(empresa_id, empleado_id, fecha\) do nothing/);
});
