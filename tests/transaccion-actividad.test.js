// tests/transaccion-actividad.test.js — Empezar o terminar una tarea en una sola
// transacción (ítem 38, parte 2): /api/actividad llama a registrar_actividad.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/actividad/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

async function pedir(body) {
  const { token } = await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol: "operativo" });
  return POST(new Request("http://localhost/api/actividad", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
}

function mock(respuestaRpc) {
  const c = { rpc: [] };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/rpc/registrar_actividad"), respond: (u, o) => { c.rpc.push(JSON.parse(o.body)); return typeof respuestaRpc === "function" ? respuestaRpc() : { status: 200, body: respuestaRpc }; } },
    { match: (u) => u.includes("/rest/v1/empleados?id=eq."), respond: () => ({ status: 200, body: [{ division: "", legajo: 7 }] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/realtime/"), respond: () => ({ status: 200, body: {} }) },
  ]);
  return c;
}

test("iniciar — una sola llamada con la empresa y el empleado de la sesión", async () => {
  const c = mock({ ok: true, cerradas: 1, tarea: { id: 5, etapa: 0 } });
  const res = await pedir({ accion: "iniciar", etapa: 0, causa: "M" });
  assert.deepEqual(await res.json(), { ok: true, tarea: { id: 5, etapa: 0 } });
  assert.equal(c.rpc.length, 1);
  assert.equal(c.rpc[0].p_empresa, E);
  assert.equal(c.rpc[0].p_empleado, EMP);
  assert.equal(c.rpc[0].p_observaciones, null);
  assert.deepEqual(
    { ot: c.rpc[0].p_nueva.codigo_proyecto, causa: c.rpc[0].p_nueva.causa, division: c.rpc[0].p_nueva.division, legajo: c.rpc[0].p_nueva.legajo },
    { ot: null, causa: "M", division: "general", legajo: "7" },
    "una espera no lleva OT; sin división queda 'general'",
  );
});

test("finalizar — manda las observaciones y nada para abrir", async () => {
  const c = mock({ ok: true, cerradas: 1 });
  const res = await pedir({ accion: "finalizar", observaciones: "Listo" });
  assert.deepEqual(await res.json(), { ok: true, cerradas: 1 });
  assert.equal(c.rpc[0].p_observaciones, "Listo");
  assert.equal(c.rpc[0].p_nueva, null);
});

test("desfasada — lo dice en palabras simples", async () => {
  mock({ ok: false, tipo: "desfasada" });
  const json = await (await pedir({ accion: "finalizar" })).json();
  assert.equal(json.tipo, "desfasada");
  assert.match(json.error, /sin conexión/);
});

test("si la base no encuentra al empleado no informa éxito", async () => {
  mock({ ok: false, tipo: "sin_empleado" });
  const res = await pedir({ accion: "finalizar" });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).ok, false);
});

test("si la transacción falla (p. ej. un dato inválido) responde error y no queda nada a medias", async () => {
  mock(() => ({ status: 400, body: { message: "violates check constraint" } }));
  const res = await pedir({ accion: "iniciar", etapa: 1, codigo_proyecto: "OT-1" });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).ok, false);
});

test("migración 087 — de a una por empleado, todo o nada y solo para el servidor", () => {
  const sql = readFileSync(new URL("../supabase/migrations/087_registrar_actividad.sql", import.meta.url), "utf8");
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('registrar_actividad:' \|\| p_empleado::text, 0\)\)/);
  assert.match(sql, /hora_fin is null and hora_inicio > p_instante\) then\s+return jsonb_build_object\('ok', false, 'tipo', 'desfasada'\)/);
  assert.match(sql, /security definer\s+set search_path = public/);
  assert.match(sql, /revoke all on function public\.registrar_actividad\([^)]*\) from anon, authenticated;/);
});
