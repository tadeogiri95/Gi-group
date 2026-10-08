// tests/api-billing-create-subscription.test.js — Tests HTTP de POST /api/billing/create-subscription
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-fake-token";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/billing/create-subscription/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function postReq(token, body = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/billing/create-subscription", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ── Helpers de mock ──
// La empresa trae sus datos de facturación completos (ítem 26: sin ellos no se contrata)
const PERFIL_FISCAL = { razon_social: "Acme SA", cuit: "20409378472", condicion_iva: "responsable_inscripto", domicilio_fiscal: "Calle 123" };

function sbEmpresa(data) {
  return {
    match: (url) => /\/rest\/v1\/empresa\?id=eq\./.test(url) && !url.includes("email_verificado"),
    respond: () => ({ status: 200, body: data ? [{ ...PERFIL_FISCAL, ...data }] : [] }),
  };
}

function sbPostSuscripciones(id = "susc-1") {
  return {
    match: (url, opts) => /\/rest\/v1\/suscripciones/.test(url) && opts.method === "POST",
    respond: () => ({ status: 201, body: [{ id }] }),
  };
}

function sbPatchOk() {
  return {
    match: (url, opts) => /\/rest\/v1\/suscripciones\?id=eq\./.test(url) && opts.method === "PATCH",
    respond: () => ({ status: 200, body: {} }),
  };
}

function mpCrearPreapproval(id = "mp-123", init_point = "https://mp.com/pay") {
  return {
    match: (url, opts) => url.includes("api.mercadopago.com") && url.includes("/preapproval") && opts.method === "POST",
    respond: () => ({ status: 200, body: { id, init_point } }),
  };
}

function mpCrearPreapprovalFalla() {
  return {
    match: (url, opts) => url.includes("api.mercadopago.com") && url.includes("/preapproval") && opts.method === "POST",
    respond: () => ({ status: 400, body: { message: "collector_id 123456789 is invalid for marketplace app" } }),
  };
}

function sbEmpleadosActivos(n) {
  return {
    match: (url) => /\/rest\/v1\/empleados\?empresa_id=eq\./.test(url) && url.includes("activo=eq.true"),
    respond: () => ({ status: 200, body: Array.from({ length: n }, (_, i) => ({ id: `e${i}` })) }),
  };
}

function sbCotizacionHoy(usd_ars = 1185) {
  return {
    match: (url) => url.includes("/rest/v1/cotizaciones?fecha=eq."),
    respond: () => ({ status: 200, body: [{ fecha: "2026-10-08", usd_ars, fuente: "test" }] }),
  };
}

function capturarSuscripcion(destino) {
  return {
    match: (url, opts) => /\/rest\/v1\/suscripciones/.test(url) && opts.method === "POST",
    respond: (url, opts) => { destino.body = JSON.parse(opts.body); return { status: 201, body: [{ id: "susc-1" }] }; },
  };
}

// ── Tests ──

test("create-subscription — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq(null, { linea: "asistencia" }));
  assert.equal(res.status, 401);
});

test("create-subscription — rol operativo devuelve 403", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(postReq(token, { linea: "asistencia" }));
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.ok(json.error);
});

test("create-subscription — línea inválida (o un plan viejo) devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  for (const body of [{ linea: "galaxy" }, { plan: "pro" }]) {
    const res = await POST(postReq(token, body));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /[Pp]lan/);
  }
});

test("create-subscription — periodo, tramo o add-on inválidos devuelven 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const casos = [
    [{ linea: "asistencia", periodo: "semanal" }, /[Pp]eriodo/],
    [{ linea: "asistencia", tramo: 25 }, /[Tt]ramo/],
    [{ linea: "asistencia", addons: ["stock"] }, /add-on/],
  ];
  for (const [body, re] of casos) {
    const res = await POST(postReq(token, body));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, re);
  }
});

test("create-subscription — el tramo no puede ser menor que los operarios activos", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers(), sbEmpleadosActivos(22)]);
  const res = await POST(postReq(token, { linea: "planta", tramo: 15 }));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.tramo_minimo, 40);
  assert.match(json.error, /22 operarios/);
});

test("create-subscription — más de 80 operarios activos es Enterprise", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers(), sbEmpleadosActivos(81)]);
  const res = await POST(postReq(token, { linea: "asistencia" }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).tipo, "enterprise");
});

test("create-subscription — sin cotización disponible no se crea nada (503)", async () => {
  const token = await tokenConRol("gerencial");
  const prev = process.env.COTIZACION_USD_ARS;
  delete process.env.COTIZACION_USD_ARS;
  let creada = false;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpleadosActivos(3),
    { match: (url) => url.includes("/rest/v1/cotizaciones"), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("dolarapi.com"), respond: () => ({ status: 503, body: {} }) },
    { match: (url, opts) => url.includes("/rest/v1/suscripciones") && opts.method === "POST", respond: () => { creada = true; return { status: 201, body: [{ id: "x" }] }; } },
  ]);
  try {
    const res = await POST(postReq(token, { linea: "asistencia" }));
    assert.equal(res.status, 503);
    assert.equal(creada, false);
  } finally {
    if (prev !== undefined) process.env.COTIZACION_USD_ARS = prev;
  }
});

test("create-subscription — empresa sin admin_email devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpleadosActivos(3),
    sbCotizacionHoy(),
    sbEmpresa({ admin_email: null, nombre: "Test", slug: "test" }),
  ]);
  const res = await POST(postReq(token, { linea: "asistencia" }));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("email"), `error deberia mencionar email: ${json.error}`);
});

test("create-subscription — flujo exitoso: precio en USD con add-ons, convertido a pesos y guardado", async () => {
  const token = await tokenConRol("gerencial");
  const susc = {};
  let montoMP = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpleadosActivos(12),
    sbCotizacionHoy(1185),
    sbEmpresa({ admin_email: "a@test.com", nombre: "Test", slug: "test" }),
    capturarSuscripcion(susc),
    {
      match: (url, opts) => url.includes("api.mercadopago.com") && url.includes("/preapproval") && opts.method === "POST",
      respond: (url, opts) => { montoMP = JSON.parse(opts.body).auto_recurring.transaction_amount; return { status: 200, body: { id: "mp-123", init_point: "https://mp.com/pay" } }; },
    },
    sbPatchOk(),
  ]);
  const res = await POST(postReq(token, { linea: "planta", addons: ["ia", "campo"], periodo: "mensual" }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.init_point, "https://mp.com/pay");
  assert.equal(json.suscripcion_id, "susc-1");
  assert.equal(json.mp_preapproval_id, "mp-123");
  // 12 activos → tramo 15: USD 45 + 15 (IA) + 20 (campo) = 80 → × 1185 = 94.800
  assert.equal(json.plan, "planta_15");
  assert.equal(susc.body.plan, "planta_15");
  assert.equal(susc.body.precio_usd, 80);
  assert.equal(susc.body.precio, 94800);
  assert.equal(susc.body.cotizacion, 1185);
  assert.deepEqual(susc.body.addons, ["ia", "campo"]);
  assert.equal(montoMP, 94800);
});

test("create-subscription — anual: 20% menos por mes y Mercado Pago cobra los 12 meses", async () => {
  const token = await tokenConRol("gerencial");
  const susc = {};
  let montoMP = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpleadosActivos(30),
    sbCotizacionHoy(1000),
    sbEmpresa({ admin_email: "a@test.com", nombre: "Test", slug: "test" }),
    capturarSuscripcion(susc),
    {
      match: (url, opts) => url.includes("api.mercadopago.com") && url.includes("/preapproval") && opts.method === "POST",
      respond: (url, opts) => { montoMP = JSON.parse(opts.body).auto_recurring.transaction_amount; return { status: 200, body: { id: "mp-9", init_point: "https://mp.com/pay" } }; },
    },
    sbPatchOk(),
  ]);
  const res = await POST(postReq(token, { linea: "asistencia", tramo: 80, periodo: "anual" }));
  assert.equal(res.status, 200);
  // USD 80 × 0,8 = 64 por mes → $64.000 por mes → $768.000 por año
  assert.equal(susc.body.precio_usd, 64);
  assert.equal(susc.body.precio, 64000);
  assert.equal(montoMP, 768000);
});

test("create-subscription — fallo de Mercado Pago al crear el preapproval devuelve 500 sin exponer el detalle de MP", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpleadosActivos(3),
    sbCotizacionHoy(),
    sbEmpresa({ admin_email: "a@test.com", nombre: "Test", slug: "test" }),
    sbPostSuscripciones("susc-1"),
    mpCrearPreapprovalFalla(),
  ]);
  const res = await POST(postReq(token, { linea: "asistencia", periodo: "mensual" }));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(!json.error.includes("collector_id"), "no debe exponer el mensaje crudo de la API de Mercado Pago");
});
