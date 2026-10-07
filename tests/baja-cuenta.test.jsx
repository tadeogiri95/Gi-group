// tests/baja-cuenta.test.jsx — Exportación self-service y baja de cuenta con
// 30 días de retención y borrado definitivo (F6-01, ítem 28).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.CRON_SECRET = "test-cron-secret";
process.env.RESEND_API_KEY = "re_test_dummy_key";
process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-mp";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

const exp = await import("../app/lib/exportar.js");
const baja = await import("../app/lib/bajaCuenta.js");
const { signAccessToken, signReactivarToken } = await import("../app/lib/jwt.ts");
const { GET: exportar } = await import("../app/api/cuenta/exportar/route.js");
const { POST: darDeBaja } = await import("../app/api/cuenta/baja/route.js");
const { POST: reactivar } = await import("../app/api/cuenta/reactivar/route.js");
const { GET: purgarCron } = await import("../app/api/cron/purgar-empresas/route.js");
const { POST: login } = await import("../app/api/login-empresa/route.js");
const { default: CuentaDatos } = await import("../app/components/CuentaDatos.jsx");

afterEach(() => cleanup());

const E = "11111111-1111-1111-1111-111111111111";
const DIA = 86400000;

async function token(rol = "gerencial") {
  return (await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: E, legajo: 1, rol })).token;
}
const conToken = async (url, init = {}, rol) => new Request(url, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}`, ...(init.headers || {}) } });

// ── lib/exportar ──

test("aCsv — sin secretos, con BOM, comillas y protección contra fórmulas", () => {
  const csv = exp.aCsv([
    { id: 1, nombre: "Ana, \"la jefa\"", password: "$2b$hash", pin_hash: "x", diagrama: { lun: null } },
    { id: 2, nombre: "=HYPERLINK(\"http://x\")", horas: -3, extra: "solo acá" },
  ]);
  assert.ok(csv.startsWith("﻿"));
  const [cab, f1, f2] = csv.slice(1).trim().split("\r\n");
  assert.equal(cab, "id,nombre,diagrama,horas,extra");
  assert.ok(!csv.includes("$2b$hash") && !csv.includes("pin_hash"));
  assert.equal(f1, '1,"Ana, ""la jefa""","{""lun"":null}",,');
  assert.ok(f2.startsWith(`2,"'=HYPERLINK`), "la fórmula queda como texto");
  assert.ok(f2.includes(",-3,"), "los negativos siguen siendo números");
  assert.deepEqual(exp.sinSecretos({ a: 1, token: "t", admin_password: "p" }), { a: 1 });
});

test("armarZip — se puede abrir y trae cada archivo", () => {
  const zip = exp.armarZip({ "a.csv": "hola,ñandú", "LEEME.txt": "x" });
  const archivos = unzipSync(zip);
  assert.deepEqual(Object.keys(archivos).sort(), ["LEEME.txt", "a.csv"]);
  assert.equal(strFromU8(archivos["a.csv"]), "hola,ñandú");
});

// ── /api/cuenta/exportar ──

test("exportar — solo el dueño", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await exportar(await conToken("http://localhost/api/cuenta/exportar", {}, "administrativo"));
  assert.equal(res.status, 403);
});

test("exportar — zip con un CSV por tabla, sin contraseñas, y avisa lo que no se pudo", async () => {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("rpc_login_attempt"), respond: () => ({ status: 200, body: 1 }) },
    { match: (url) => url.includes("/rest/v1/audit_log"), respond: () => ({ status: 201, body: [] }) },
    { match: (url) => url.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ id: E, nombre: "Acme", slug: "acme", admin_password: "secreto", email_verify_token: "t" }] }) },
    { match: (url) => url.includes("/rest/v1/geo_registros"), respond: () => ({ status: 500, body: { message: "caído" } }) },
    {
      match: (url) => url.includes("/rest/v1/") && url.includes(`empresa_id=eq.${E}`),
      respond: (url) => {
        pedidos.push(url);
        if (url.includes("/rest/v1/empleados")) return { status: 200, body: [{ id: "x", legajo: 7, nombre: "Ana", password: "$2b$10$hash", pin_hash: "p" }] };
        if (url.includes("/rest/v1/fichadas")) return { status: 200, body: [{ id: "f", legajo: 7, fecha: "2026-10-01", ingreso: "08:00:00" }] };
        return { status: 200, body: [] };
      },
    },
  ]);
  const res = await exportar(await conToken("http://localhost/api/cuenta/exportar"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/zip");
  assert.match(res.headers.get("Content-Disposition"), /gypi-acme-\d{4}-\d{2}-\d{2}\.zip/);
  const archivos = unzipSync(new Uint8Array(await res.arrayBuffer()));
  assert.ok(archivos["empleados.csv"] && archivos["fichadas.csv"] && archivos["empresa.csv"] && archivos["LEEME.txt"]);
  const empleados = strFromU8(archivos["empleados.csv"]);
  assert.ok(empleados.includes("Ana") && !empleados.includes("$2b$") && !empleados.includes("pin_hash"));
  assert.ok(!strFromU8(archivos["empresa.csv"]).includes("secreto"));
  const leeme = strFromU8(archivos["LEEME.txt"]);
  assert.match(leeme, /fichadas\.csv: 1 filas/);
  assert.match(leeme, /No se pudieron exportar: geo_registros/);
  assert.ok(pedidos.every((u) => u.includes(`empresa_id=eq.${E}`)), "todo filtrado por la empresa");
});

// ── lib/bajaCuenta ──

test("confirmacionValida / fechaBorrado / puedeReactivar", () => {
  assert.ok(baja.confirmacionValida("Acme  SA", "  acme sa "));
  assert.ok(!baja.confirmacionValida("Acme SA", "Acme"));
  assert.ok(!baja.confirmacionValida("", ""));
  assert.equal(baja.fechaBorrado("2026-10-01T10:00:00.000Z"), "2026-10-31T10:00:00.000Z");
  const emp = { baja_solicitada_en: "2026-10-01T10:00:00+00:00" };
  const ahora = Date.parse("2026-10-20T00:00:00Z");
  assert.ok(baja.puedeReactivar(emp, "2026-10-01T10:00:00.000Z", ahora), "mismo instante aunque cambie el formato");
  assert.ok(!baja.puedeReactivar(emp, "2026-09-01T10:00:00.000Z", ahora), "link de una baja anterior");
  assert.ok(!baja.puedeReactivar(emp, "2026-10-01T10:00:00.000Z", Date.parse("2026-11-02T00:00:00Z")), "pasaron los 30 días");
  assert.ok(!baja.puedeReactivar({ baja_solicitada_en: null }, "2026-10-01T10:00:00.000Z", ahora));
});

// ── /api/cuenta/baja ──

function mockBaja({ mpFalla = false } = {}) {
  const r = { empresaPatch: null, sesionesPatch: null, mpCancelado: null, emails: [], audit: [] };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/audit_log"), respond: (url, opts) => { r.audit.push(JSON.parse(opts.body)); return { status: 201, body: [] }; } },
    { match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.") && opts?.method === "PATCH", respond: (url, opts) => { r.empresaPatch = JSON.parse(opts.body); return { status: 204, body: null }; } },
    { match: (url) => url.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ id: E, nombre: "Acme SA", nombre_corto: "Acme", slug: "acme", admin_email: "duena@acme.com" }] }) },
    { match: (url) => url.includes("/rest/v1/suscripciones?empresa_id="), respond: () => ({ status: 200, body: [{ id: "s1", gateway_subscription_id: "pre_1" }] }) },
    { match: (url, opts) => url.includes("/rest/v1/suscripciones?id=eq.s1") && opts?.method === "PATCH", respond: () => ({ status: 204, body: null }) },
    { match: (url, opts) => url.includes("/rest/v1/sesiones?empresa_id=") && opts?.method === "PATCH", respond: (url, opts) => { r.sesionesPatch = { url, body: JSON.parse(opts.body) }; return { status: 204, body: null }; } },
    {
      match: (url) => url.includes("api.mercadopago.com/preapproval/pre_1"),
      respond: (url, opts) => { r.mpCancelado = JSON.parse(opts.body); return mpFalla ? { status: 500, body: { message: "MP caído" } } : { status: 200, body: { id: "pre_1", status: "cancelled" } }; },
    },
    { match: (url) => url.includes("api.resend.com"), respond: (url, opts) => { r.emails.push(JSON.parse(opts.body)); return { status: 200, body: { id: "em" } }; } },
  ]);
  return r;
}

const pedirBaja = async (confirmacion, rol) => darDeBaja(await conToken("http://localhost/api/cuenta/baja", { method: "POST", body: JSON.stringify({ confirmacion }) }, rol));

test("baja — solo el dueño y con el nombre exacto de la empresa", async () => {
  let r = mockBaja();
  assert.equal((await pedirBaja("Acme SA", "administrativo")).status, 403);
  const mal = await pedirBaja("Acme");
  assert.equal(mal.status, 400);
  assert.match((await mal.json()).error, /Acme SA/);
  assert.equal(r.empresaPatch, null);
  assert.equal(r.mpCancelado, null);
});

test("baja — cancela Mercado Pago, desactiva la empresa, cierra sesiones y manda el link para recuperarla", async () => {
  const r = mockBaja();
  const antes = Date.now();
  const res = await pedirBaja("acme sa");
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(r.mpCancelado, { status: "cancelled" });
  assert.equal(r.empresaPatch.activa, false);
  const t = Date.parse(r.empresaPatch.baja_solicitada_en);
  assert.ok(t >= antes && t <= Date.now());
  assert.equal(Date.parse(json.borrado_el) - t, 30 * DIA);
  assert.match(r.sesionesPatch.url, /revocada=eq\.false/);
  assert.deepEqual(r.sesionesPatch.body, { revocada: true });
  assert.equal(r.emails.length, 1);
  assert.deepEqual([].concat(r.emails[0].to), ["duena@acme.com"]);
  const link = /href="([^"]*\/reactivar\?t=[^"]+)"/.exec(r.emails[0].html)?.[1];
  assert.ok(link, "el email trae el link para recuperar la cuenta");
  await waitFor(() => assert.ok(r.audit.some((a) => a.accion === "baja_empresa")));
});

test("baja — si Mercado Pago falla no se da de baja nada", async () => {
  const r = mockBaja({ mpFalla: true });
  const res = await pedirBaja("Acme SA");
  assert.equal(res.status, 502);
  assert.equal(r.empresaPatch, null);
  assert.equal(r.sesionesPatch, null);
});

// ── /api/cuenta/reactivar ──

function mockReactivar(empresa) {
  const r = { patch: null };
  global.fetch = createFetchMock([
    { match: (url) => url.includes("rpc_login_attempt"), respond: () => ({ status: 200, body: 1 }) },
    { match: (url) => url.includes("/rest/v1/audit_log"), respond: () => ({ status: 201, body: [] }) },
    { match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.") && opts?.method === "PATCH", respond: (url, opts) => { r.patch = JSON.parse(opts.body); return { status: 204, body: null }; } },
    { match: (url) => url.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: empresa ? [empresa] : [] }) },
  ]);
  return r;
}
const pedirReactivar = (tk) => reactivar(new Request("http://localhost/api/cuenta/reactivar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tk }) }));

test("reactivar — con el link de la baja vigente vuelve a estar activa", async () => {
  const bajaEn = new Date(Date.now() - 5 * DIA).toISOString();
  const r = mockReactivar({ id: E, slug: "acme", activa: false, baja_solicitada_en: bajaEn });
  const res = await pedirReactivar(await signReactivarToken({ empresaId: E, baja: bajaEn }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).slug, "acme");
  assert.deepEqual(r.patch, { activa: true, baja_solicitada_en: null });
});

test("reactivar — link de otra baja, inválido o de empresa ya borrada no sirve", async () => {
  const bajaEn = new Date(Date.now() - 5 * DIA).toISOString();
  let r = mockReactivar({ id: E, slug: "acme", activa: false, baja_solicitada_en: bajaEn });
  const viejo = await signReactivarToken({ empresaId: E, baja: new Date(Date.now() - 40 * DIA).toISOString() });
  assert.equal((await pedirReactivar(viejo)).status, 400);
  assert.equal(r.patch, null);
  assert.equal((await pedirReactivar("eyJ.cualquiera.cosa")).status, 400);
  const acceso = await token();
  assert.equal((await pedirReactivar(acceso)).status, 400, "un token de sesión no sirve como link");
  r = mockReactivar(null);
  assert.equal((await pedirReactivar(await signReactivarToken({ empresaId: E, baja: bajaEn }))).status, 410);
});

// ── Borrado definitivo ──

function mockPurga({ empresa, storage = {}, rpcFalla = false }) {
  const r = { borrados: {}, rpc: null };
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/cron_ejecuciones") || url.includes("/rest/v1/audit_log"), respond: () => ({ status: 201, body: [] }) },
    { match: (url) => url.includes("/rest/v1/empresa?activa=eq.false"), respond: () => ({ status: 200, body: empresa ? [empresa] : [] }) },
    { match: (url) => url.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: empresa ? [empresa] : [] }) },
    {
      match: (url) => url.includes("/storage/v1/object/list/"),
      respond: (url, opts) => {
        const bucket = url.split("/object/list/")[1];
        const { prefix } = JSON.parse(opts.body);
        return { status: 200, body: storage[`${bucket}:${prefix}`] || [] };
      },
    },
    {
      match: (url, opts) => url.includes("/storage/v1/object/") && opts?.method === "DELETE",
      respond: (url, opts) => { const b = url.split("/object/")[1]; r.borrados[b] = (r.borrados[b] || []).concat(JSON.parse(opts.body).prefixes); return { status: 200, body: [] }; },
    },
    { match: (url) => url.includes("/rpc/purgar_empresa"), respond: (url, opts) => { r.rpc = JSON.parse(opts.body); return rpcFalla ? { status: 400, body: { message: "no" } } : { status: 200, body: 42 }; } },
  ]);
  return r;
}

test("purgarEmpresa — no toca una empresa activa ni una baja reciente", async () => {
  const r = mockPurga({ empresa: { id: E, activa: false, baja_solicitada_en: new Date(Date.now() - 10 * DIA).toISOString() } });
  await assert.rejects(baja.purgarEmpresa(E), /no tiene una baja vencida/);
  mockPurga({ empresa: { id: E, activa: true, baja_solicitada_en: new Date(Date.now() - 40 * DIA).toISOString() } });
  await assert.rejects(baja.purgarEmpresa(E));
  assert.equal(r.rpc, null);
});

test("cron purgar-empresas — borra archivos (también en subcarpetas) y después las filas", async () => {
  const r = mockPurga({
    empresa: { id: E, activa: false, baja_solicitada_en: new Date(Date.now() - 31 * DIA).toISOString() },
    storage: {
      [`logos:${E}`]: [{ name: "logo-1.png", id: "a" }],
      [`documentos-empleado:${E}`]: [{ name: "emp-1", id: null }],
      [`documentos-empleado:${E}/emp-1`]: [{ name: "dni.pdf", id: "b" }, { name: "alta.pdf", id: "c" }],
    },
  });
  assert.equal((await purgarCron(new Request("http://localhost/api/cron/purgar-empresas"))).status, 401);
  const res = await purgarCron(new Request("http://localhost/api/cron/purgar-empresas", { headers: { Authorization: "Bearer test-cron-secret" } }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).purgadas, 1);
  assert.deepEqual(r.borrados["logos"], [`${E}/logo-1.png`]);
  assert.deepEqual(r.borrados["documentos-empleado"].sort(), [`${E}/emp-1/alta.pdf`, `${E}/emp-1/dni.pdf`]);
  assert.deepEqual(r.rpc, { p_empresa: E });
});

test("cron purgar-empresas — si falla el borrado queda en error para reintentar", async () => {
  mockPurga({ empresa: { id: E, activa: false, baja_solicitada_en: new Date(Date.now() - 31 * DIA).toISOString() }, rpcFalla: true });
  const res = await purgarCron(new Request("http://localhost/api/cron/purgar-empresas", { headers: { Authorization: "Bearer test-cron-secret" } }));
  assert.equal(res.status, 500);
});

// ── Login ──

test("login — una empresa dada de baja no entra (y no se crea sesión)", async () => {
  const bcrypt = (await import("bcryptjs")).default;
  const hash = await bcrypt.hash("Segura123", 4);
  let sesionCreada = false;
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rpc/rpc_login_attempt"), respond: () => ({ status: 200, body: 0 }) },
    { match: (url) => url.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ id: "emp-1", empresa_id: E, legajo: 7, rol: "gerencial", nombre: "Ana", password: hash, activo: true }] }) },
    { match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "POST", respond: () => { sesionCreada = true; return { status: 201, body: [{}] }; } },
    { match: (url) => url.includes("/rest/v1/empresa"), respond: () => ({ status: 200, body: [{ id: E, nombre: "Acme", slug: "acme", activa: false }] }) },
  ]);
  const res = await login(new Request("http://localhost/api/login-empresa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legajo: "7", password: "Segura123", empresa_id: E }) }));
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /dada de baja/);
  assert.equal(sesionCreada, false);
});

// ── Pantalla ──

test("CuentaDatos — solo el dueño la ve; la baja pide el nombre y al final ofrece salir", async () => {
  render(<CuentaDatos usuario={{ rol: "administrativo" }} empresa={{ nombre: "Acme SA" }} />);
  assert.equal(screen.queryByText(/Dar de baja/), null);
  cleanup();

  const pedidos = [];
  const fetcher = async (url, opts) => {
    pedidos.push({ url, body: opts?.body });
    return new Response(JSON.stringify({ ok: true, borrado_el: "2026-11-06T12:00:00.000Z" }), { status: 200 });
  };
  let salio = false;
  render(<CuentaDatos usuario={{ rol: "gerencial" }} empresa={{ nombre: "Acme SA" }} fetcher={fetcher} onLogout={() => { salio = true; }} />);
  fireEvent.click(screen.getByText("Dar de baja la cuenta"));
  assert.ok(screen.getByText(/Te recomendamos descargar los datos antes/));
  assert.equal(screen.getByText("Sí, dar de baja").closest("button").disabled, true);
  fireEvent.change(screen.getByLabelText(/escribí el nombre de la empresa/), { target: { value: "Acme SA" } });
  fireEvent.click(screen.getByText("Sí, dar de baja"));
  assert.ok(await screen.findByText(/Los datos se borran el 6 de noviembre de 2026/));
  assert.deepEqual(pedidos.map((p) => p.url), ["/api/cuenta/baja"]);
  assert.deepEqual(JSON.parse(pedidos[0].body), { confirmacion: "Acme SA" });
  fireEvent.click(screen.getByText("Salir"));
  assert.equal(salio, true);
});

test("CuentaDatos — descargar baja el zip y si falla lo dice", async () => {
  let clicks = 0;
  global.URL.createObjectURL = () => "blob:x";
  global.URL.revokeObjectURL = () => {};
  const original = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () { clicks++; assert.equal(this.download, "gypi-acme.zip"); };
  try {
    const ok = async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { "Content-Disposition": 'attachment; filename="gypi-acme.zip"' } });
    render(<CuentaDatos usuario={{ rol: "gerencial" }} empresa={{ nombre: "Acme" }} fetcher={ok} />);
    fireEvent.click(screen.getByText(/Descargar todos los datos/));
    assert.ok(await screen.findByText(/revisá tus descargas/));
    assert.equal(clicks, 1);
    cleanup();
    const falla = async () => new Response(JSON.stringify({ error: "Probá en 15 minutos." }), { status: 429 });
    render(<CuentaDatos usuario={{ rol: "gerencial" }} empresa={{ nombre: "Acme" }} fetcher={falla} />);
    fireEvent.click(screen.getByText(/Descargar todos los datos/));
    assert.ok(await screen.findByText("Probá en 15 minutos."));
  } finally {
    window.HTMLAnchorElement.prototype.click = original;
  }
});
