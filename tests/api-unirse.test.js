// tests/api-unirse.test.js — Tests HTTP de POST /api/unirse (activación con código)
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createFetchMock } from "./helpers/mockFetch.js";
import { _resetBuckets } from "../app/lib/rateLimitMemory.js";
import { hashCodigo, generarCodigo, normalizarCodigo, nuevaActivacion, linkActivacion } from "../app/lib/activacion.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { POST } = await import("../app/api/unirse/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const PASSWORD_OK = "Segura123";
const CODIGO = "K7P2-M9QX";
const HASH = hashCodigo(CODIGO);
const FUTURO = new Date(Date.now() + 86_400_000).toISOString();
const PASADO = new Date(Date.now() - 1000).toISOString();

function req(body) {
  return new Request("http://localhost/api/unirse", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
}

function handlersBase({ empresaActiva = true, empresaFound = true, empleadoFound = true, expira = FUTURO, patchFilas = 1 } = {}) {
  const llamadas = { patchEmpleado: null, patchUrl: null, empleadoUrl: null, sesiones: null };
  const handlers = [
    {
      match: (url) => url.includes("/rest/v1/empresa?slug=eq."),
      respond: () => ({
        status: 200,
        body: empresaFound ? [{ id: EMPRESA_ID, nombre: "Empresa Test", nombre_corto: "EmpTest", activa: empresaActiva }] : [],
      }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/empleados?empresa_id=eq.") && (!opts?.method || opts.method === "GET"),
      respond: (url) => {
        llamadas.empleadoUrl = url;
        const ok = empleadoFound && url.includes(`activacion_codigo_hash=eq.${HASH}`);
        return {
          status: 200,
          body: ok ? [{ id: EMPLEADO_ID, nombre: "Juan Perez", apodo: "Juancho", legajo: 7, rol: "operativo", activacion_expira: expira }] : [],
        };
      },
    },
    {
      match: (url, opts) => url.includes("/rest/v1/empleados?id=eq.") && opts?.method === "PATCH",
      respond: (url, opts) => {
        llamadas.patchUrl = url;
        llamadas.patchEmpleado = JSON.parse(opts.body);
        return { status: 200, body: Array.from({ length: patchFilas }, () => ({ id: EMPLEADO_ID })) };
      },
    },
    {
      match: (url, opts) => url.includes("/rest/v1/sesiones?empleado_id=eq.") && opts?.method === "PATCH",
      respond: (url, opts) => {
        llamadas.sesiones = { url, body: JSON.parse(opts.body) };
        return { status: 200, body: [] };
      },
    },
  ];
  handlers.llamadas = llamadas;
  return handlers;
}

beforeEach(() => {
  _resetBuckets();
  global.fetch = createFetchMock(handlersBase());
});

// ── lib/activacion ──
test("activacion — códigos con formato XXXX-XXXX y sin caracteres ambiguos", () => {
  for (let i = 0; i < 200; i++) {
    const c = generarCodigo();
    assert.match(c, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  }
});

test("activacion — el hash ignora mayúsculas, espacios y guiones", () => {
  assert.equal(normalizarCodigo(" k7p2 m9qx "), "K7P2M9QX");
  assert.equal(hashCodigo("k7p2-m9qx"), HASH);
  assert.equal(hashCodigo("K7P2M9QX"), HASH);
});

test("activacion — nuevaActivacion guarda solo el hash y vence en 14 días", () => {
  const a = nuevaActivacion();
  assert.equal(a.columnas.activacion_codigo_hash, hashCodigo(a.codigo));
  assert.notEqual(a.columnas.activacion_codigo_hash, a.codigo);
  const dias = (new Date(a.columnas.activacion_expira) - Date.now()) / 86_400_000;
  assert.ok(dias > 13.9 && dias <= 14);
});

test("activacion — el link lleva slug y código", () => {
  assert.equal(linkActivacion("https://gypi.app", "acme", "AB12-CD34"), "https://gypi.app/acme/unirse?code=AB12-CD34");
});

// ── validación ──
test("unirse — faltan campos devuelve 400", async () => {
  const res = await POST(req({ slug: "empresa-test" }));
  assert.equal(res.status, 400);
});

test("unirse — ya no acepta legajo (body estricto) → 400", async () => {
  const res = await POST(req({ action: "verificar", slug: "empresa-test", legajo: 7 }));
  assert.equal(res.status, 400);
});

test("unirse — código con largo incorrecto → 404 sin consultar la base", async () => {
  let consultas = 0;
  global.fetch = async () => { consultas++; throw new Error("no debería llamarse"); };
  const res = await POST(req({ action: "verificar", slug: "empresa-test", codigo: "ABCD" }));
  assert.equal(res.status, 404);
  assert.equal(consultas, 0);
});

test("unirse — empresa no encontrada devuelve 404", async () => {
  global.fetch = createFetchMock(handlersBase({ empresaFound: false }));
  const res = await POST(req({ action: "verificar", slug: "no-existe", codigo: CODIGO }));
  assert.equal(res.status, 404);
});

test("unirse — empresa inactiva devuelve 403", async () => {
  global.fetch = createFetchMock(handlersBase({ empresaActiva: false }));
  const res = await POST(req({ action: "verificar", slug: "empresa-test", codigo: CODIGO }));
  assert.equal(res.status, 403);
});

// ── verificar ──
test("unirse — busca por hash del código dentro de la empresa (nunca en texto plano)", async () => {
  const h = handlersBase();
  global.fetch = createFetchMock(h);
  await POST(req({ action: "verificar", slug: "empresa-test", codigo: "k7p2 m9qx" }));
  assert.ok(h.llamadas.empleadoUrl.includes(`empresa_id=eq.${EMPRESA_ID}`));
  assert.ok(h.llamadas.empleadoUrl.includes(`activacion_codigo_hash=eq.${HASH}`));
  assert.ok(!h.llamadas.empleadoUrl.includes("K7P2"));
});

test("unirse — código incorrecto → 404 con mensaje genérico", async () => {
  const res = await POST(req({ action: "verificar", slug: "empresa-test", codigo: "ZZZZ-ZZZZ" }));
  const json = await res.json();
  assert.equal(res.status, 404);
  assert.ok(json.error.includes("no es válido o ya venció"));
});

test("unirse — código vencido → 404", async () => {
  global.fetch = createFetchMock(handlersBase({ expira: PASADO }));
  const res = await POST(req({ action: "verificar", slug: "empresa-test", codigo: CODIGO }));
  assert.equal(res.status, 404);
});

test("unirse — verificar devuelve nombre, apodo y empresa", async () => {
  const res = await POST(req({ action: "verificar", slug: "empresa-test", codigo: CODIGO }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.nombre, "Juan Perez");
  assert.equal(json.apodo, "Juancho");
  assert.equal(json.empresaNombre, "EmpTest");
});

// ── activar ──
test("unirse — activar sin password válida → 400 sin escribir", async () => {
  const h = handlersBase();
  global.fetch = createFetchMock(h);
  const res = await POST(req({ action: "activar", slug: "empresa-test", codigo: CODIGO, password: "corta" }));
  assert.equal(res.status, 400);
  assert.equal(h.llamadas.patchEmpleado, null);
});

test("unirse — activar define contraseña, borra el código y cierra sesiones", async () => {
  const h = handlersBase();
  global.fetch = createFetchMock(h);
  const res = await POST(req({ action: "activar", slug: "empresa-test", codigo: CODIGO, password: PASSWORD_OK }));
  assert.equal(res.status, 200);
  const p = h.llamadas.patchEmpleado;
  assert.ok(await bcrypt.compare(PASSWORD_OK, p.password));
  assert.equal(p.estado_activacion, "activo");
  assert.equal(p.debe_cambiar_password, false);
  assert.equal(p.activacion_codigo_hash, null);
  assert.equal(p.activacion_expira, null);
  // El PATCH filtra también por el hash → uso único atómico
  assert.ok(h.llamadas.patchUrl.includes(`activacion_codigo_hash=eq.${HASH}`));
  assert.ok(h.llamadas.patchUrl.includes(`empresa_id=eq.${EMPRESA_ID}`));
  assert.deepEqual(h.llamadas.sesiones.body, { revocada: true });
});

test("unirse — si otro pedido usó el código primero (0 filas) → 404", async () => {
  global.fetch = createFetchMock(handlersBase({ patchFilas: 0 }));
  const res = await POST(req({ action: "activar", slug: "empresa-test", codigo: CODIGO, password: PASSWORD_OK }));
  assert.equal(res.status, 404);
});

test("unirse — rate limit: 21 intentos → 429", async () => {
  let ultimo;
  for (let i = 0; i < 21; i++) {
    ultimo = await POST(req({ action: "verificar", slug: "empresa-test", codigo: "ZZZZ-ZZZZ" }));
  }
  assert.equal(ultimo.status, 429);
});
