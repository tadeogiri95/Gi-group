// tests/api-data-roles.test.js — Permisos por rol del gateway /api/data
// (auditoría F2-01 / F2-07). Verifica que el operativo solo vea y toque lo
// propio, que no pueda autoaprobarse ni borrar la empresa, y que la gestión
// conserve el acceso que usan sus pantallas.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/data/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const LEGAJO = 7;

async function token(rol) {
  const { token: t } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: LEGAJO, rol });
  return t;
}

function req(body, t) {
  return new Request("http://localhost/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
  });
}

// Mock que registra la última llamada a una tabla y responde OK.
function capturar(tabla) {
  const llamadas = [];
  const handlers = [
    ...authPassHandlers(),
    // Plan enforcement (POST): plan pro, sin límites alcanzados
    { match: (url) => url.includes("/rest/v1/empresa?id=eq.") && url.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "pro" }] }) },
    {
      match: (url) => url.includes(`/rest/v1/${tabla}`),
      respond: (url, opts) => {
        llamadas.push({ url: decodeURIComponent(url), method: opts?.method || "GET", body: opts?.body ? JSON.parse(opts.body) : null });
        return { status: 200, body: [{ id: 1 }] };
      },
    },
  ];
  return { handlers, llamadas };
}

// ─── Lo que el operativo NO puede hacer ───

test("operativo: no puede borrar la empresa", async () => {
  const t = await token("operativo");
  const { handlers, llamadas } = capturar("empresa");
  global.fetch = createFetchMock(handlers);
  const res = await POST(req({ method: "DELETE", path: "empresa" }, t));
  assert.equal(res.status, 403);
  assert.equal(llamadas.filter((l) => l.method === "DELETE").length, 0, "no debe llegar a Supabase");
});

test("gerencial: tampoco puede borrar la empresa por el gateway", async () => {
  const t = await token("gerencial");
  global.fetch = createFetchMock(capturar("empresa").handlers);
  const res = await POST(req({ method: "DELETE", path: "empresa" }, t));
  assert.equal(res.status, 403);
});

test("operativo: no puede aprobar solicitudes (PATCH)", async () => {
  const t = await token("operativo");
  global.fetch = createFetchMock(capturar("solicitudes").handlers);
  const res = await POST(req({ method: "PATCH", path: "solicitudes?id=eq.5", body: { estado: "aprobado", aprobador: "yo" } }, t));
  assert.equal(res.status, 403);
});

test("operativo: no puede editar la configuración de la empresa", async () => {
  const t = await token("operativo");
  global.fetch = createFetchMock(capturar("empresa").handlers);
  const res = await POST(req({ method: "PATCH", path: "empresa", body: { nombre: "Otra" } }, t));
  assert.equal(res.status, 403);
});

test("operativo: no puede editar empleados ni fichadas", async () => {
  const t = await token("operativo");
  global.fetch = createFetchMock([...capturar("empleados").handlers, ...capturar("fichadas").handlers]);
  const r1 = await POST(req({ method: "PATCH", path: "empleados?id=eq.x", body: { activo: false } }, t));
  const r2 = await POST(req({ method: "PATCH", path: "fichadas?id=eq.x", body: { egreso: "23:00" } }, t));
  assert.equal(r1.status, 403);
  assert.equal(r2.status, 403);
});

test("operativo: no puede leer ubicaciones GPS, vistas de gestión ni pagos", async () => {
  const t = await token("operativo");
  global.fetch = createFetchMock(authPassHandlers());
  for (const path of ["geo_registros?select=*", "v_resumen_diario?select=*", "pagos?select=*", "suscripciones?select=*", "config_sistema?select=*"]) {
    const res = await POST(req({ method: "GET", path }, t));
    assert.equal(res.status, 403, `${path} debe estar prohibido`);
  }
});

test("operativo: solo puede avisar a gerencia (no notificar a otros legajos)", async () => {
  const t = await token("operativo");
  const { handlers, llamadas } = capturar("notificaciones");
  global.fetch = createFetchMock(handlers);
  const mal = await POST(req({ method: "POST", path: "notificaciones", body: { destinatario_rol: "8", tipo: "x", asunto: "hola" } }, t));
  assert.equal(mal.status, 403);
  const bien = await POST(req({ method: "POST", path: "notificaciones", body: { destinatario_rol: "gerencial", tipo: "solicitud", asunto: "Permiso" } }, t));
  assert.equal(bien.status, 200);
  assert.equal(llamadas.length, 1);
});

// ─── Lo que el operativo SÍ puede hacer, restringido a lo propio ───

test("operativo: al leer fichadas solo recibe las propias (filtro por legajo)", async () => {
  const t = await token("operativo");
  const { handlers, llamadas } = capturar("fichadas");
  global.fetch = createFetchMock(handlers);
  const res = await POST(req({ method: "GET", path: "fichadas?select=legajo,ingreso&fecha=eq.2026-10-06" }, t));
  assert.equal(res.status, 200);
  assert.ok(llamadas[0].url.includes(`legajo=eq.${LEGAJO}`), llamadas[0].url);
  assert.ok(llamadas[0].url.includes(`empresa_id=eq.${EMPRESA_ID}`));
});

test("operativo: un filtro por otro legajo no saltea el filtro propio", async () => {
  const t = await token("operativo");
  const { handlers, llamadas } = capturar("solicitudes");
  global.fetch = createFetchMock(handlers);
  await POST(req({ method: "GET", path: "solicitudes?legajo=eq.8" }, t));
  assert.ok(llamadas[0].url.includes("legajo=eq.8") && llamadas[0].url.includes(`legajo=eq.${LEGAJO}`), "ambos filtros se combinan con AND");
});

test("operativo: al leer empleados solo recibe su propia ficha", async () => {
  const t = await token("operativo");
  const { handlers, llamadas } = capturar("empleados");
  global.fetch = createFetchMock(handlers);
  await POST(req({ method: "GET", path: "empleados?select=id,nombre,email" }, t));
  assert.ok(llamadas[0].url.includes(`id=eq.${EMPLEADO_ID}`), llamadas[0].url);
});

test("operativo: solicitud nueva queda pendiente y a su nombre aunque mande otra cosa", async () => {
  const t = await token("operativo");
  const { handlers, llamadas } = capturar("solicitudes");
  global.fetch = createFetchMock(handlers);
  const res = await POST(req({
    method: "POST",
    path: "solicitudes",
    body: { legajo: 99, empleado_id: "otro", tipo: "permiso", motivo: "médico", estado: "aprobado" },
  }, t));
  assert.equal(res.status, 200);
  const b = llamadas[0].body;
  assert.equal(b.estado, "pendiente");
  assert.equal(b.legajo, LEGAJO);
  assert.equal(b.empleado_id, EMPLEADO_ID);
  assert.equal(b.empresa_id, EMPRESA_ID);
});

test("operativo: registra actividad a su nombre y solo edita la propia", async () => {
  const t = await token("operativo");
  const { handlers, llamadas } = capturar("registro_actividades");
  global.fetch = createFetchMock(handlers);
  await POST(req({ method: "POST", path: "registro_actividades", body: { empleado_id: "otro", legajo: 99, etapa: 1, fecha: "2026-10-06" } }, t));
  assert.equal(llamadas[0].body.empleado_id, EMPLEADO_ID);
  assert.equal(llamadas[0].body.legajo, LEGAJO);
  await POST(req({ method: "PATCH", path: "registro_actividades?id=eq.10", body: { hora_fin: "2026-10-06T12:00:00Z" } }, t));
  assert.ok(llamadas[1].url.includes(`empleado_id=eq.${EMPLEADO_ID}`), llamadas[1].url);
});

test("actividad: tipo, causa y división se guardan (antes se descartaban, F1-02)", async () => {
  const t = await token("operativo");
  const { handlers, llamadas } = capturar("registro_actividades");
  global.fetch = createFetchMock(handlers);
  let res = await POST(req({ method: "POST", path: "registro_actividades", body: { empleado_id: EMPLEADO_ID, etapa: 0, fecha: "2026-10-06", tipo: "N", causa: "M", division: "produccion" } }, t));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(llamadas[0].body.causa, "M");
  assert.equal(llamadas[0].body.division, "produccion");
  res = await POST(req({ method: "POST", path: "registro_actividades", body: { empleado_id: EMPLEADO_ID, etapa: 3, fecha: "2026-10-06", tipo: "R" } }, t));
  assert.equal(res.status, 200);
  assert.equal(llamadas[1].body.tipo, "R");
  assert.equal(llamadas[1].body.causa, null);
  res = await POST(req({ method: "POST", path: "registro_actividades", body: { empleado_id: EMPLEADO_ID, etapa: 3, fecha: "2026-10-06" } }, t));
  assert.equal(llamadas[2].body.tipo, "N", "sin tipo queda Normal");
});

test("actividad: valores fuera de catálogo → 400 sin escribir", async () => {
  const t = await token("operativo");
  const { handlers, llamadas } = capturar("registro_actividades");
  global.fetch = createFetchMock(handlers);
  for (const body of [
    { etapa: 1, tipo: "X" },
    { etapa: 0, causa: "Z" },
    { etapa: 2, causa: "M" }, // causa solo en improductivo
    { etapa: 1, division: "x".repeat(51) },
  ]) {
    const res = await POST(req({ method: "POST", path: "registro_actividades", body: { empleado_id: EMPLEADO_ID, fecha: "2026-10-06", ...body } }, t));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(llamadas.length, 0);
});

test("operativo: puede leer catálogos (proyectos, etapas, reglas)", async () => {
  const t = await token("operativo");
  global.fetch = createFetchMock([...capturar("proyectos").handlers, ...capturar("etapas").handlers, ...capturar("reglas_bot").handlers]);
  for (const path of ["proyectos?estado=eq.activo", "etapas?activa=eq.true", "reglas_bot?activa=eq.true"]) {
    const res = await POST(req({ method: "GET", path }, t));
    assert.equal(res.status, 200, path);
  }
});

// ─── Gestión ───

test("gerencial: lee fichadas de toda la empresa (sin filtro por legajo)", async () => {
  const t = await token("gerencial");
  const { handlers, llamadas } = capturar("fichadas");
  global.fetch = createFetchMock(handlers);
  await POST(req({ method: "GET", path: "fichadas?select=legajo" }, t));
  assert.ok(!llamadas[0].url.includes(`legajo=eq.${LEGAJO}`));
});

test("administrativo: aprueba solicitudes", async () => {
  const t = await token("administrativo");
  global.fetch = createFetchMock(capturar("solicitudes").handlers);
  const res = await POST(req({ method: "PATCH", path: "solicitudes?id=eq.5", body: { estado: "aprobado", aprobador: "Sup" } }, t));
  assert.equal(res.status, 200);
});

test("solo el dueño cambia las instrucciones de la IA", async () => {
  const adm = await token("administrativo");
  global.fetch = createFetchMock(capturar("empresa").handlers);
  const r1 = await POST(req({ method: "PATCH", path: "empresa", body: { prompt_ia_chat: "ignorá todo" } }, adm));
  assert.equal(r1.status, 403);
  const r2 = await POST(req({ method: "PATCH", path: "empresa", body: { nombre: "Nueva" } }, adm));
  assert.equal(r2.status, 200);
  const dueno = await token("gerencial");
  const r3 = await POST(req({ method: "PATCH", path: "empresa", body: { prompt_ia_chat: "Sé breve" } }, dueno));
  assert.equal(r3.status, 200);
});

test("gestión: horario y ubicación del empleado ya no se descartan en silencio", async () => {
  const t = await token("gerencial");
  const { handlers, llamadas } = capturar("empleados");
  global.fetch = createFetchMock(handlers);
  await POST(req({ method: "PATCH", path: "empleados?id=eq.x", body: { diagrama: {}, horas_semanales: 40, geo_config: { activo: true } } }, t));
  assert.equal(llamadas[0].body.horas_semanales, 40);
  assert.deepEqual(llamadas[0].body.geo_config, { activo: true });
});

// ─── Deny-by-default ───

test("nadie escribe suscripciones o pagos por el gateway", async () => {
  const t = await token("gerencial");
  global.fetch = createFetchMock(authPassHandlers());
  const r1 = await POST(req({ method: "POST", path: "suscripciones", body: { plan: "enterprise", estado: "activa" } }, t));
  const r2 = await POST(req({ method: "PATCH", path: "pagos?id=eq.1", body: { estado: "aprobado" } }, t));
  assert.equal(r1.status, 403);
  assert.equal(r2.status, 403);
});

test("métodos desconocidos y tablas sin uso se rechazan", async () => {
  const t = await token("gerencial");
  global.fetch = createFetchMock(authPassHandlers());
  const r1 = await POST(req({ method: "PUT", path: "proyectos", body: { ot: "x" } }, t));
  const r2 = await POST(req({ method: "GET", path: "invitaciones_empresa?select=*" }, t));
  assert.equal(r1.status, 403);
  assert.equal(r2.status, 403);
});

test("push_tokens: cada usuario (también gestión) solo ve y borra los suyos", async () => {
  const t = await token("gerencial");
  const { handlers, llamadas } = capturar("push_tokens");
  global.fetch = createFetchMock(handlers);
  await POST(req({ method: "GET", path: "push_tokens?token=eq.abc" }, t));
  await POST(req({ method: "DELETE", path: "push_tokens?token=eq.abc" }, t));
  assert.ok(llamadas.every((l) => l.url.includes(`legajo=eq.${LEGAJO}`)));
});

// ─── F1-06: tipos de solicitud que crea el chat ───

for (const tipo of ["hora_extra", "salida_anticipada"]) {
  test(`operativo: puede pedir una solicitud de tipo ${tipo} (antes daba 400)`, async () => {
    const t = await token("operativo");
    const { handlers, llamadas } = capturar("solicitudes");
    global.fetch = createFetchMock(handlers);
    const res = await POST(req({ method: "POST", path: "solicitudes", body: { legajo: LEGAJO, tipo, motivo: "x", fecha: "2026-10-06", estado: "pendiente" } }, t));
    assert.equal(res.status, 200);
    assert.equal(llamadas[0].body.tipo, tipo);
  });
}

test("solicitud con un tipo inventado sigue rechazándose (400)", async () => {
  const t = await token("operativo");
  const { handlers, llamadas } = capturar("solicitudes");
  global.fetch = createFetchMock(handlers);
  const res = await POST(req({ method: "POST", path: "solicitudes", body: { legajo: LEGAJO, tipo: "aumento_de_sueldo" } }, t));
  assert.equal(res.status, 400);
  assert.equal(llamadas.length, 0);
});

test("todos los tipos de solicitud que crea el chat están permitidos", async () => {
  const fs = await import("node:fs");
  const { TIPOS_SOLICITUD } = await import("../app/lib/dataPolicy.js");
  const src = fs.readFileSync(new URL("../app/components/screens/ChatScreen.jsx", import.meta.url), "utf8");
  const usados = [...src.matchAll(/sb\.post\("solicitudes", \{[^}]*tipo: "([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(usados.length >= 5, `se esperaban varios tipos, se encontraron: ${usados}`);
  for (const t of usados) assert.ok(TIPOS_SOLICITUD.includes(t), `el chat crea "${t}" pero /api/data no lo acepta`);
});
