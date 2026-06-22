// tests/api-fichar.test.js — Tests HTTP de POST /api/fichar
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { _resetBuckets } from "../app/lib/rateLimitMemory.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/fichar/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenValido() {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "empleado" });
  return token;
}

function req(body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/fichar", { method: "POST", headers, body: JSON.stringify(body) });
}

// Handlers para el camino feliz de INGRESO: empresa sin geofencing (plan
// free), sin fichada previa hoy, sin diagrama (sin chequeo de tardanza).
function handlersIngresoBasico({ yaFichado = false } = {}) {
  return [
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=timezone"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires" }] }) },
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "free" }] }) },
    {
      match: (url) => url.includes("/rest/v1/fichadas") && url.includes("select=id,ingreso"),
      respond: () => ({ status: 200, body: yaFichado ? [{ id: "f1", ingreso: "08:00:00" }] : [] }),
    },
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=diagrama"), respond: () => ({ status: 200, body: [{ diagrama: null }] }) },
    { match: (url, opts) => url.includes("/rest/v1/fichadas") && opts.method === "POST", respond: () => ({ status: 201, body: [{ id: "nueva-fichada" }] }) },
  ];
}

beforeEach(() => {
  global.fetch = createFetchMock(handlersIngresoBasico());
  // El rate limiter de /api/fichar (10/min por empleado) es un Map en memoria
  // que persiste entre tests del mismo proceso — sin resetear, los tests de
  // este archivo se pisan entre sí al acumularse por encima del límite.
  _resetBuckets();
});

test("fichar — sin token devuelve 401", async () => {
  const res = await POST(req({ accion: "ingreso" }, null));
  assert.equal(res.status, 401);
});

test("fichar — acción inválida devuelve 400", async () => {
  const token = await tokenValido();
  const res = await POST(req({ accion: "almorzar" }, token));
  assert.equal(res.status, 400);
});

test("fichar — ingreso sin geofencing ni diagrama: registra fichada puntual", async () => {
  const token = await tokenValido();
  let fichadaInsertada = null;
  global.fetch = createFetchMock([
    { match: (url, opts) => url.includes("/rest/v1/fichadas") && opts.method === "POST", respond: (url, opts) => { fichadaInsertada = JSON.parse(opts.body); return { status: 201, body: [fichadaInsertada] }; } },
    ...handlersIngresoBasico(),
  ]);

  const res = await POST(req({ accion: "ingreso" }, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.tardanza.estado, "puntual");
  assert.equal(fichadaInsertada.empresa_id, EMPRESA_ID, "la fichada debe asociarse a la empresa del token, no a una recibida del cliente");
  assert.equal(fichadaInsertada.legajo, 7);
});

test("fichar — ingreso ya registrado hoy devuelve ok:false tipo ya_fichado", async () => {
  const token = await tokenValido();
  global.fetch = createFetchMock(handlersIngresoBasico({ yaFichado: true }));

  const res = await POST(req({ accion: "ingreso" }, token));
  const json = await res.json();

  assert.equal(json.ok, false);
  assert.equal(json.tipo, "ya_fichado");
});

test("fichar — geofencing activo (plan starter) sin coordenadas pide GPS", async () => {
  const token = await tokenValido();
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    // La ruta hace una sola query combinada: select=timezone,plan_activo
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=timezone") && url.includes("plan_activo"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "starter" }] }) },
    { match: (url) => url.includes("/rest/v1/geo_zonas"), respond: () => ({ status: 200, body: [{ lat: -34.6, lng: -58.4, radio: 150, nombre: "Planta" }] }) },
  ]);

  const res = await POST(req({ accion: "ingreso" }, token));
  const json = await res.json();

  assert.equal(json.ok, false);
  assert.equal(json.tipo, "geo_requerida");
});

test("fichar — geofencing activo y coordenadas fuera de zona rechaza", async () => {
  const token = await tokenValido();
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    // La ruta hace una sola query combinada: select=timezone,plan_activo
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=timezone") && url.includes("plan_activo"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "starter" }] }) },
    // Zona en Buenos Aires; coordenadas del fichaje van a estar en Córdoba (~650km)
    { match: (url) => url.includes("/rest/v1/geo_zonas"), respond: () => ({ status: 200, body: [{ lat: -34.6037, lng: -58.3816, radio: 150, nombre: "Planta BA" }] }) },
  ]);

  const res = await POST(req({ accion: "ingreso", geo_lat: -31.4201, geo_lng: -64.1888 }, token));
  const json = await res.json();

  assert.equal(json.ok, false);
  assert.equal(json.tipo, "fuera_de_zona");
});

// ─── Integration tests (nuevos) ───────────────────────────────────────────────

test("fichar — ingreso exitoso: empresa_id viene del token, no del body del cliente", async () => {
  const token = await tokenValido();
  let fichadaInsertada = null;
  global.fetch = createFetchMock([
    // El handler de inserción captura lo que se manda a Supabase
    { match: (url, opts) => url.includes("/rest/v1/fichadas") && opts.method === "POST", respond: (url, opts) => { fichadaInsertada = JSON.parse(opts.body); return { status: 201, body: [fichadaInsertada] }; } },
    ...handlersIngresoBasico(),
  ]);

  // El body del cliente intenta inyectar un empresa_id distinto — debe ser ignorado
  const bodyCliente = { accion: "ingreso", empresa_id: "00000000-0000-0000-0000-000000000000" };
  const res = await POST(req(bodyCliente, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  // La fichada persisted debe usar el empresa_id del token, nunca el del cliente
  assert.equal(fichadaInsertada.empresa_id, EMPRESA_ID, "empresa_id debe venir del token");
  assert.notEqual(fichadaInsertada.empresa_id, "00000000-0000-0000-0000-000000000000");
});

test("fichar — ingreso ya registrado hoy devuelve ok:false tipo ya_fichado (integración)", async () => {
  const token = await tokenValido();
  global.fetch = createFetchMock(handlersIngresoBasico({ yaFichado: true }));

  const res = await POST(req({ accion: "ingreso" }, token));
  const json = await res.json();

  assert.equal(res.status, 200, "HTTP 200 aunque ok:false");
  assert.equal(json.ok, false);
  assert.equal(json.tipo, "ya_fichado");
  // El mensaje de error debe incluir la hora de la fichada previa
  assert.ok(json.error.includes("08:00"), "el error debe indicar la hora de la fichada previa");
});

test("fichar — egreso con forzar_cierre_tarea=true cierra tarea activa y registra salida", async () => {
  const token = await tokenValido();
  let tareasActualizadas = false;
  let patchFichadaLlamado = false;

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    // Plan y timezone
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=timezone,plan_activo"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "free" }] }) },
    // Plan solo (fallback si la ruta hace dos GETs separados)
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "free" }] }) },
    // Timezone solo
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=timezone"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires" }] }) },
    // forzar_cierre_tarea=true → PATCH para cerrar tareas activas
    {
      match: (url, opts) => url.includes("/rest/v1/registro_actividades") && opts.method === "PATCH",
      respond: () => { tareasActualizadas = true; return { status: 200, body: [] }; },
    },
    // Fichada de hoy sin egreso (turno abierto)
    {
      match: (url) => url.includes("/rest/v1/fichadas") && url.includes("select=*") && url.includes("limit=1"),
      respond: () => ({ status: 200, body: [{ id: "f-hoy", fecha: "2026-06-16", ingreso: "08:00", egreso: null }] }),
    },
    // Diagrama del empleado (sin diagrama → sin horas extra)
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=diagrama"), respond: () => ({ status: 200, body: [{ diagrama: null }] }) },
    // PATCH de fichada para registrar egreso
    {
      match: (url, opts) => url.includes("/rest/v1/fichadas") && opts.method === "PATCH",
      respond: () => { patchFichadaLlamado = true; return { status: 200, body: [{ id: "f-hoy" }] }; },
    },
  ]);

  const res = await POST(req({ accion: "egreso", forzar_cierre_tarea: true }, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(tareasActualizadas, true, "debe haber hecho PATCH a registro_actividades para cerrar la tarea");
  assert.equal(patchFichadaLlamado, true, "debe haber registrado el egreso en la fichada");
});

test("fichar — egreso sin forzar_cierre_tarea retorna tarea_activa cuando hay tarea abierta", async () => {
  const token = await tokenValido();

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=timezone"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires" }] }) },
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "free" }] }) },
    // Hay una tarea activa sin hora_fin
    {
      match: (url) => url.includes("/rest/v1/registro_actividades") && url.includes("hora_fin=is.null") && url.includes("select=id"),
      respond: () => ({ status: 200, body: [{ id: "tarea-activa-1" }] }),
    },
  ]);

  const res = await POST(req({ accion: "egreso", forzar_cierre_tarea: false }, token));
  const json = await res.json();

  assert.equal(json.ok, false);
  assert.equal(json.tipo, "tarea_activa");
  assert.equal(json.tarea_id, "tarea-activa-1");
});

// ─── Tardanza — regresión para la consolidación con app/lib/calc.js ──────────
// 2026-06-15 es lunes ("lun") en Argentina — fijado con mock.timers para
// controlar la hora real de ingreso sin depender de cuándo corre el test.
// Cada test habilita su propio reloj y lo restaura en el finally: estos
// mocks no deben filtrarse a los otros ~390 tests del proceso.

function handlersConDiagrama(diagramaHoy, { tardesPrevias = null } = {}) {
  const handlers = [
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=diagrama"), respond: () => ({ status: 200, body: [{ diagrama: { lun: diagramaHoy } }] }) },
    ...handlersIngresoBasico(),
  ];
  if (tardesPrevias !== null) {
    handlers.unshift({
      match: (url) => url.includes("llegada_tarde=eq.true"),
      respond: () => ({ status: 200, body: Array.from({ length: tardesPrevias }, (_, i) => ({ id: `t${i}` })) }),
    });
  }
  return handlers;
}

test("fichar — ingreso 3 min tarde (dentro de tolerancia de 5) queda puntual, sin consultar tardanzas previas", async (t) => {
  try {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-06-15T11:03:00.000Z") }); // 08:03 ARG
    const token = await tokenValido();
    // Sin handler de "llegada_tarde=eq.true": si el código lo consultara
    // igual (perdiendo la optimización de no pedir tardanzas previas cuando
    // diff<=5), createFetchMock tira "Sin handler" y el test falla.
    global.fetch = createFetchMock(handlersConDiagrama({ in: "08:00", out: "17:00" }));

    const res = await POST(req({ accion: "ingreso" }, token));
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.tardanza.estado, "puntual");
    assert.equal(json.tardanza.llegadasTarde, 0);
    // app/lib/calc.js calcularTardanza() informa el minuto real (3) en vez de
    // ocultarlo en 0 — el inline viejo lo hardcodeaba en 0 para CUALQUIER
    // llegada dentro de tolerancia. Cambio intencional: no es observable en
    // ningún consumidor (FichadaCard solo lee tardanza.minutos cuando estado
    // es "tarde"/"bloqueado"; minutos_tarde persistido nunca se lee salvo
    // donde llegada_tarde=true, que sigue siendo false acá).
    assert.equal(json.tardanza.minutos, 3);
  } finally {
    t.mock.timers.reset();
  }
});

test("fichar — ingreso 20 min tarde (1ra del mes) queda 'tarde', no bloquea", async (t) => {
  try {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-06-15T11:20:00.000Z") }); // 08:20 ARG
    const token = await tokenValido();
    global.fetch = createFetchMock(handlersConDiagrama({ in: "08:00", out: "17:00" }, { tardesPrevias: 0 }));

    const res = await POST(req({ accion: "ingreso" }, token));
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.tardanza.estado, "tarde");
    assert.equal(json.tardanza.minutos, 20);
    assert.equal(json.tardanza.llegadasTarde, 1);
  } finally {
    t.mock.timers.reset();
  }
});

test("fichar — ingreso 45 min tarde se bloquea por superar tolerancia de 30 min", async (t) => {
  try {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-06-15T11:45:00.000Z") }); // 08:45 ARG
    const token = await tokenValido();
    global.fetch = createFetchMock(handlersConDiagrama({ in: "08:00", out: "17:00" }, { tardesPrevias: 0 }));

    const res = await POST(req({ accion: "ingreso" }, token));
    const json = await res.json();

    assert.equal(json.ok, false);
    assert.equal(json.tipo, "bloqueado_tardanza");
    assert.match(json.error, /45 min/);
    assert.equal(json.tardanza.estado, "bloqueado");
    assert.equal(json.tardanza.minutos, 45);
    assert.equal(json.tardanza.llegadasTarde, 1);
  } finally {
    t.mock.timers.reset();
  }
});

test("fichar — ingreso 10 min tarde se bloquea si es la 3ra llegada tarde del mes", async (t) => {
  try {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-06-15T11:10:00.000Z") }); // 08:10 ARG
    const token = await tokenValido();
    global.fetch = createFetchMock(handlersConDiagrama({ in: "08:00", out: "17:00" }, { tardesPrevias: 2 }));

    const res = await POST(req({ accion: "ingreso" }, token));
    const json = await res.json();

    assert.equal(json.ok, false);
    assert.equal(json.tipo, "bloqueado_3ra_tarde");
    assert.match(json.error, /3ra llegada tarde/);
    assert.equal(json.tardanza.estado, "bloqueado");
    assert.equal(json.tardanza.llegadasTarde, 3);
  } finally {
    t.mock.timers.reset();
  }
});
