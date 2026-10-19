// tests/reporte-diario.test.jsx — Seguimiento de OT por escaneo, parte 26:
// reporte del día de producción e instalación (Reportes → Del día y email al
// dueño a las 23 h).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.CRON_SECRET = "test-cron-secret";
process.env.RESEND_API_KEY = "re_test_dummy_key";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

before(() => {});
afterEach(() => cleanup());

const { armarReporteDiario, reporteVacio, limitesDia, fechaDelReporte } = await import("../app/lib/reporteDiario.js");
const { htmlReporteDiario } = await import("../app/lib/email.js");
const cron = await import("../app/api/cron/reporte-diario/route.js");
const api = await import("../app/api/reportes/dia/route.js");
const { CRONS_ESPERADOS } = await import("../app/lib/cronMonitor.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const { default: ReporteDiaTab } = await import("../app/components/ReporteDiaTab.jsx");
const { hoyArg } = await import("../app/lib/dates.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const FECHA = "2026-10-15";
const ETAPAS = [{ codigo: 1, nombre: "Corte", orden: 1 }, { codigo: 2, nombre: "Canteado", orden: 2 }];
const PROYECTOS = [
  { ot: "7495", cliente: "Siciliano", fecha_entrega: "2026-10-30", estado: "abierto" },
  { ot: "7858", cliente: "CEVT", fecha_entrega: "2026-10-10", estado: "abierto" },
  { ot: "7000", cliente: "Vieja", fecha_entrega: "2026-09-01", estado: "cerrado" },
];
const en = (fecha, hora) => new Date(`${fecha}T${hora}:00-03:00`).toISOString();

// ─── Cuentas ───

test("limitesDia — el día va de 0 a 24 h de Argentina", () => {
  assert.deepEqual(limitesDia(FECHA), { inicio: "2026-10-15T03:00:00.000Z", fin: "2026-10-16T03:00:00.000Z" });
});

test("fechaDelReporte — el cron de las 23 h reporta ese mismo día aunque Vercel lo demore", () => {
  assert.equal(fechaDelReporte(new Date("2026-10-16T02:00:00Z")), "2026-10-15");
  assert.equal(fechaDelReporte(new Date("2026-10-16T03:40:00Z")), "2026-10-15");
});

test("armarReporteDiario — piezas del día por OT y etapa, con el % al empezar y al terminar", () => {
  const r = armarReporteDiario({
    fecha: FECHA,
    proyectos: PROYECTOS,
    etapas: ETAPAS,
    // Hoy en la base: Corte 10 de 10, Canteado 5 de 10
    avancePiezas: [{ ot: "7495", etapa: 1, total: 10, pasaron: 10 }, { ot: "7495", etapa: 2, total: 10, pasaron: 5 }],
    pasos: [
      ...Array.from({ length: 4 }, () => ({ ot: "7495", etapa: 1, created_at: en(FECHA, "10:00") })),
      ...Array.from({ length: 3 }, () => ({ ot: "7495", etapa: 2, created_at: en(FECHA, "16:30") })),
      { ot: "7495", etapa: 2, created_at: en("2026-10-16", "08:00") }, // del día siguiente: no cuenta
    ],
  });
  assert.equal(r.piezasHoy, 7);
  const o = r.produccion[0];
  // Al empezar: Corte 6 + Canteado 1 = 7 de 20 → 35%. Al terminar: 10 + 4 = 14 de 20 → 70%
  assert.deepEqual([o.ot, o.antes, o.despues, o.piezasHoy], ["7495", 35, 70, 7]);
  assert.deepEqual(o.etapas.map((e) => [e.nombre, e.hoy, e.pasaron, e.total]), [["Corte", 4, 10, 10], ["Canteado", 3, 4, 10]]);
  assert.deepEqual(r.atrasadas.map((a) => [a.ot, a.dias]), [["7858", 5]], "la cerrada no cuenta");
});

test("armarReporteDiario — OT que llegó al 100%, etapas marcadas y firmadas, instalación", () => {
  const r = armarReporteDiario({
    fecha: FECHA,
    proyectos: PROYECTOS,
    etapas: ETAPAS,
    avancePiezas: [{ ot: "7858", etapa: 1, total: 2, pasaron: 2 }],
    pasos: [{ ot: "7858", etapa: 1, created_at: en(FECHA, "09:00") }],
    avanceEtapas: [
      { ot: "7858", etapa: 1, estado: "aprobada", terminada_at: en(FECHA, "09:05"), aprobada_at: en(FECHA, "11:00") },
      { ot: "7495", etapa: 2, estado: "terminada", terminada_at: en("2026-10-14", "09:00") },
    ],
    instalacion: [{ ot: "7495", empleado: "Juan", modulos: ["M1", "M2"], avance: 48.5, pendientes: [{ descripcion: "Tiras de ajuste" }] }],
  });
  assert.deepEqual(r.completadas, [{ ot: "7858", cliente: "CEVT" }]);
  assert.equal(r.atrasadas.length, 0, "la atrasada terminó su producción");
  assert.deepEqual(r.etapasCerradas.map((x) => [x.ot, x.nombre, x.que]), [["7858", "Corte", "terminada"], ["7858", "Corte", "firmada"]]);
  assert.deepEqual(r.instalaciones[0], { ot: "7495", cliente: "Siciliano", quien: "Juan", modulos: 2, avance: 48.5, comentario: null, pendientes: ["Tiras de ajuste"] });
  assert.equal(reporteVacio(r), false);
});

test("reporteVacio — sin escaneos, etapas ni instalación no se avisa (aunque haya atrasadas)", () => {
  const r = armarReporteDiario({ fecha: FECHA, proyectos: PROYECTOS, etapas: ETAPAS });
  assert.equal(r.atrasadas.length, 1);
  assert.equal(reporteVacio(r), true);
});

test("htmlReporteDiario — escapa los textos y muestra antes → después", () => {
  const r = armarReporteDiario({
    fecha: FECHA,
    proyectos: [{ ot: "1", cliente: "<b>X</b>" }],
    avancePiezas: [{ ot: "1", etapa: 1, total: 4, pasaron: 2 }],
    pasos: [{ ot: "1", etapa: 1, created_at: en(FECHA, "10:00") }],
    etapas: ETAPAS,
  });
  const html = htmlReporteDiario({ empresa: "Acme", slug: "acme", reporte: r });
  assert.ok(html.includes("25% → 50%"));
  assert.ok(html.includes("&lt;b&gt;X&lt;/b&gt;"));
  assert.ok(!html.includes("<b>X</b>"));
});

// ─── Cron ───

function mockBase({ emails = [], resendFalla = false, pasosHoy = true, empresas }) {
  const fecha = fechaDelReporte();
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/cron_ejecuciones"), respond: () => ({ status: 201, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empresa?activa=eq.true"), respond: () => ({ status: 200, body: empresas }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq.") && u.includes("plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "planta", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq.") && u.includes("addons"), respond: () => ({ status: 200, body: [{ addons: [] }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: (u) => ({ status: 200, body: u.includes("offset=0") ? PROYECTOS : [] }) },
    { match: (u) => u.includes("/rest/v1/etapas"), respond: (u) => ({ status: 200, body: u.includes("offset=0") ? ETAPAS : [] }) },
    { match: (u) => u.includes("/rest/v1/v_avance_piezas"), respond: (u) => ({ status: 200, body: u.includes("offset=0") && u.includes("e1") ? [{ ot: "7495", etapa: 1, total: 10, pasaron: 2 }] : [] }) },
    { match: (u) => u.includes("/rest/v1/pasos_pieza"), respond: (u) => ({ status: 200, body: pasosHoy && u.includes("offset=0") && u.includes("e1") ? [{ ot: "7495", etapa: 1, created_at: en(fecha, "10:00") }, { ot: "7495", etapa: 1, created_at: en(fecha, "11:00") }] : [] }) },
    {
      match: (u) => u.includes("api.resend.com"),
      respond: (u, o) => {
        emails.push(JSON.parse(o.body));
        return resendFalla ? { status: 500, body: { name: "application_error", message: "boom" } } : { status: 200, body: { id: "em_1" } };
      },
    },
    { match: (u) => u.includes("/rest/v1/"), respond: () => ({ status: 200, body: [] }) },
  ]);
}
const cronReq = (auth = "Bearer test-cron-secret") => new Request("http://localhost/api/cron/reporte-diario", { headers: auth ? { Authorization: auth } : {} });
const E1 = { id: "e1", nombre: "Acme SA", nombre_corto: "Acme", slug: "acme", admin_email: "duena@acme.com" };
const E2 = { id: "e2", nombre: "Quieta", slug: "quieta", admin_email: "q@q.com" };

test("cron/reporte-diario — sin el secreto devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  assert.equal((await cron.GET(cronReq(null))).status, 401);
});

test("cron/reporte-diario — manda a las empresas con movimiento y saltea las quietas", async () => {
  const emails = [];
  mockBase({ emails, empresas: [E1, E2] });
  const json = await (await cron.GET(cronReq())).json();
  assert.deepEqual({ enviados: json.enviados, vacios: json.vacios, errores: json.errores }, { enviados: 1, vacios: 1, errores: 0 });
  assert.equal(json.fecha, fechaDelReporte());
  assert.deepEqual([].concat(emails[0].to), ["duena@acme.com"]);
  assert.match(emails[0].subject, /Acme: 2 piezas escaneadas/);
  assert.ok(emails[0].html.includes("OT 7495"));
});

test("cron/reporte-diario — si Resend falla con todas, el cron queda en error", async () => {
  mockBase({ resendFalla: true, empresas: [{ ...E1, id: "e1" }] });
  await assert.rejects(cron.GET(cronReq()), /fallaron/);
});

test("cron/reporte-diario — está en vercel.json y en el monitoreo de crons", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/cron/reporte-diario" && c.schedule === "0 2 * * *"));
  assert.ok(CRONS_ESPERADOS["reporte-diario"]);
});

// ─── /api/reportes/dia ───

async function apiReq(rol, fecha) {
  const { token } = await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol });
  return new Request(`http://localhost/api/reportes/dia${fecha ? `?fecha=${fecha}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
}

test("/api/reportes/dia — solo gerencial y administrativo, y no días futuros", async () => {
  mockBase({ empresas: [] });
  assert.equal((await api.GET(await apiReq("operativo"))).status, 403);
  assert.equal((await api.GET(await apiReq("gerencial", "2099-01-01"))).status, 400);
  assert.equal((await api.GET(await apiReq("gerencial", "15/10/2026"))).status, 400);
  const res = await api.GET(await apiReq("gerencial", FECHA));
  assert.equal(res.status, 200);
  const { reporte } = await res.json();
  assert.equal(reporte.fecha, FECHA);
});

// ─── Pantalla ───

test("Reportes → Del día — muestra el reporte y cambia de día", async () => {
  const pedidos = [];
  global.fetch = async (url) => {
    pedidos.push(String(url));
    const fecha = new URL(String(url), "http://x").searchParams.get("fecha");
    const reporte = armarReporteDiario({
      fecha,
      proyectos: PROYECTOS,
      etapas: ETAPAS,
      avancePiezas: [{ ot: "7495", etapa: 1, total: 10, pasaron: 3 }],
      pasos: [{ ot: "7495", etapa: 1, created_at: en(fecha, "10:00") }],
      instalacion: [{ ot: "7495", empleado: "Juan", modulos: ["M1"], avance: 25, pendientes: [{ descripcion: "Tiras" }] }],
    });
    return new Response(JSON.stringify({ ok: true, reporte }), { status: 200 });
  };
  render(<ReporteDiaTab />);
  assert.ok(await screen.findByText("Hoy"));
  await waitFor(() => assert.ok(screen.getByLabelText("De 20% a 30%")));
  assert.ok(screen.getByText(/Corte: 1 pieza \(3 de 10\)/));
  assert.ok(screen.getByText(/Juan · 1 módulo colocado/));
  assert.ok(screen.getByText("Pendientes: Tiras"));
  assert.equal(screen.getByLabelText("Día siguiente").disabled, true, "no hay días futuros");
  fireEvent.click(screen.getByLabelText("Día anterior"));
  await waitFor(() => assert.equal(pedidos.length, 2));
  assert.ok(!pedidos[1].includes(`fecha=${hoyArg()}`));
});
