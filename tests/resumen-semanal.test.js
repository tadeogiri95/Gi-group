// tests/resumen-semanal.test.js — Resumen semanal por email para el dueño (D10, ítem 31).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.CRON_SECRET = "test-cron-secret";
process.env.RESEND_API_KEY = "re_test_dummy_key";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

const { armarResumen, semanaAnterior, resumenVacio, fechasDe } = await import("../app/lib/resumenSemanal.js");
const { hoyEn } = await import("../app/lib/resumenSemanalServidor.js");
const { htmlResumenSemanal } = await import("../app/lib/email.js");
const { GET } = await import("../app/api/cron/resumen-semanal/route.js");
const { CRONS_ESPERADOS } = await import("../app/lib/cronMonitor.js");

const L_V = { lun: { in: "08:00", out: "17:00" }, mar: { in: "08:00", out: "17:00" }, mie: { in: "08:00", out: "17:00" }, jue: { in: "08:00", out: "17:00" }, vie: { in: "08:00", out: "17:00" }, sab: null, dom: null };

test("semanaAnterior — lunes a domingo de la semana pasada, sea el día que sea", () => {
  assert.deepEqual(semanaAnterior("2026-10-05"), { desde: "2026-09-28", hasta: "2026-10-04" }, "un lunes");
  assert.deepEqual(semanaAnterior("2026-10-07"), { desde: "2026-09-28", hasta: "2026-10-04" }, "un miércoles");
  assert.deepEqual(semanaAnterior("2026-10-11"), { desde: "2026-09-28", hasta: "2026-10-04" }, "un domingo");
  assert.deepEqual(semanaAnterior("2027-01-04"), { desde: "2026-12-28", hasta: "2027-01-03" }, "cruza el año");
  assert.equal(fechasDe("2026-09-28", "2026-10-04").length, 7);
});

test("hoyEn — usa la zona horaria de la empresa", () => {
  const ahora = new Date("2026-10-05T02:00:00Z"); // domingo 23:00 en Argentina
  assert.equal(hoyEn("America/Argentina/Buenos_Aires", ahora), "2026-10-04");
  assert.equal(hoyEn("Europe/Madrid", ahora), "2026-10-05");
  assert.equal(hoyEn("Zona/Inventada", ahora), "2026-10-04", "zona inválida → Argentina");
});

const SEMANA = { desde: "2026-09-28", hasta: "2026-10-04" };

test("armarResumen — horas por OT, tiempo muerto por causa y faltas sin aviso", () => {
  const r = armarResumen({
    ...SEMANA,
    actividades: [
      { legajo: "1", codigo_proyecto: "1001", etapa: 2, duracion_min: 240 },
      { legajo: "2", codigo_proyecto: "1001", etapa: 3, duracion_min: 120 },
      { legajo: "1", codigo_proyecto: "1002", etapa: 1, hora_inicio: "2026-09-29T11:00:00Z", hora_fin: "2026-09-29T12:30:00Z" },
      { legajo: "1", etapa: 0, causa: "M", duracion_min: 60 },
      { legajo: "2", etapa: 0, causa: "H", duracion_min: 30 },
      { legajo: "2", etapa: 0, causa: "M", duracion_min: 30 },
      { legajo: "2", codigo_proyecto: "1003", etapa: 1, hora_inicio: "2026-09-29T11:00:00Z", hora_fin: null }, // abierta: no suma
    ],
    fichadas: [
      ...["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map((fecha) => ({ legajo: 1, fecha, horas_trabajadas: 9, llegada_tarde: fecha === "2026-09-29" })),
      { legajo: 2, fecha: "2026-09-28", horas_trabajadas: 8.5 },
    ],
    solicitudes: [{ legajo: 2, fecha: "2026-09-29", fecha_hasta: "2026-09-30", tipo: "vacaciones" }],
    empleados: [
      { legajo: 1, nombre: "Ana", diagrama: L_V },
      { legajo: 2, nombre: "Luis", diagrama: L_V },
      { legajo: 3, nombre: "Sin horario", diagrama: null },
      { legajo: 4, nombre: "Nuevo", diagrama: L_V, created_at: "2026-10-02T10:00:00Z" },
    ],
    proyectos: [{ ot: "1001", cliente: "Acme", proyecto: "Portón" }],
  });
  assert.equal(r.horasFichadas, 53.5);
  assert.equal(r.tardanzas, 1);
  assert.deepEqual(r.ots, [
    { ot: "1001", detalle: "Acme · Portón", horas: 6 },
    { ot: "1002", detalle: "", horas: 1.5 },
  ]);
  assert.equal(r.horasEnOTs, 7.5);
  assert.equal(r.tiempoMuerto.horas, 2);
  assert.equal(r.tiempoMuerto.porcentaje, 21, "2 h de 9,5 h cargadas");
  assert.deepEqual(r.tiempoMuerto.causas, [{ causa: "Falta material", horas: 1.5 }, { causa: "Falta herramienta", horas: 0.5 }]);
  // Luis: lun fichó, mar-mié vacaciones, jue-vie faltó. El nuevo entró el viernes y faltó ese día. Sin horario no cuenta.
  assert.deepEqual(r.faltasSinAviso, [{ legajo: 2, nombre: "Luis", dias: 2 }, { legajo: 4, nombre: "Nuevo", dias: 1 }]);
  assert.equal(r.diasJustificados, 2);
  assert.equal(resumenVacio(r), false);
});

test("armarResumen — más de 8 OT se resumen; semana sin datos es vacía", () => {
  const actividades = Array.from({ length: 11 }, (_, i) => ({ codigo_proyecto: `OT${i}`, etapa: 1, duracion_min: 60 + i }));
  const r = armarResumen({ ...SEMANA, actividades });
  assert.equal(r.ots.length, 8);
  assert.equal(r.otrasOTs, 3);
  assert.equal(r.ots[0].ot, "OT10", "de mayor a menor");
  assert.equal(resumenVacio(armarResumen({ ...SEMANA })), true);
});

test("htmlResumenSemanal — escapa nombres y muestra cada sección", () => {
  const r = armarResumen({
    ...SEMANA,
    actividades: [{ codigo_proyecto: "<b>9</b>", etapa: 1, duracion_min: 60 }],
    empleados: [{ legajo: 9, nombre: "<script>x</script>", diagrama: L_V }],
  });
  const html = htmlResumenSemanal({ empresa: "Acme & Cía", slug: "acme", resumen: r });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Acme &amp; Cía"));
  assert.ok(html.includes("del 28/9 al 4/10"));
  assert.ok(html.includes("Sin tiempo muerto registrado."));
  assert.ok(html.includes("https://gypi.app/acme") || html.includes("/acme"));
});

// ── Cron ──

function cronReq(auth = "Bearer test-cron-secret") {
  return new Request("http://localhost/api/cron/resumen-semanal", { headers: auth ? { Authorization: auth } : {} });
}

function mockCron({ empresas, emails, columnaFalta = false, resendFalla = false }) {
  const pedidosEmpresa = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/cron_ejecuciones"), respond: () => ({ status: 201, body: [] }) },
    {
      match: (url) => url.includes("/rest/v1/empresa?activa=eq.true"),
      respond: (url) => {
        pedidosEmpresa.push(decodeURIComponent(url));
        if (columnaFalta && url.includes("resumen_semanal")) return { status: 400, body: { message: "column empresa.resumen_semanal does not exist" } };
        return { status: 200, body: empresas };
      },
    },
    { match: (url) => url.includes("/rest/v1/registro_actividades"), respond: (url) => ({ status: 200, body: url.includes("empresa_id=eq.e1") ? [{ codigo_proyecto: "1001", etapa: 1, duracion_min: 120 }] : [] }) },
    { match: (url) => url.includes("/rest/v1/fichadas"), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("/rest/v1/solicitudes"), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (url) => url.includes("api.resend.com"),
      respond: (url, opts) => {
        emails.push(JSON.parse(opts.body));
        return resendFalla ? { status: 500, body: { name: "application_error", message: "boom" } } : { status: 200, body: { id: "em_1" } };
      },
    },
  ]);
  return pedidosEmpresa;
}

const E1 = { id: "e1", nombre: "Acme SA", nombre_corto: "Acme", slug: "acme", admin_email: "duena@acme.com", timezone: "America/Argentina/Buenos_Aires" };
const E2 = { id: "e2", nombre: "Quieta", slug: "quieta", admin_email: "q@q.com" };

test("cron/resumen-semanal — sin el secreto devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  assert.equal((await GET(cronReq(null))).status, 401);
  assert.equal((await GET(cronReq("Bearer otro"))).status, 401);
});

test("cron/resumen-semanal — manda a las empresas con actividad y saltea las vacías", async () => {
  const emails = [];
  const pedidos = mockCron({ empresas: [E1, E2], emails });
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual({ enviados: json.enviados, vacios: json.vacios, errores: json.errores }, { enviados: 1, vacios: 1, errores: 0 });
  assert.equal(emails.length, 1);
  assert.deepEqual([].concat(emails[0].to), ["duena@acme.com"]);
  assert.match(emails[0].subject, /Acme/);
  assert.ok(emails[0].html.includes("OT 1001"));
  assert.ok(pedidos[0].includes("plan_activo=neq.free"), "solo planes vigentes");
  assert.ok(pedidos[0].includes("resumen_semanal=not.is.false"), "respeta a quien lo apagó");
});

test("cron/resumen-semanal — sin la migración 077 sigue mandando a todas", async () => {
  const emails = [];
  const pedidos = mockCron({ empresas: [E1], emails, columnaFalta: true });
  const json = await (await GET(cronReq())).json();
  assert.equal(json.enviados, 1);
  assert.ok(!pedidos.at(-1).includes("resumen_semanal"));
});

test("cron/resumen-semanal — si Resend falla con todas, el cron queda en error", async () => {
  const emails = [];
  mockCron({ empresas: [E1], emails, resendFalla: true });
  await assert.rejects(GET(cronReq()), /fallaron/);
});

test("cronMonitor — el resumen semanal se vigila con ventana de 8 días", () => {
  assert.equal(CRONS_ESPERADOS["resumen-semanal"], 8 * 24 * 60 * 60 * 1000);
});

// ── /api/empresa ──

test("/api/empresa — PATCH acepta resumen_semanal; GET sin la columna 077 conserva las otras nuevas", async () => {
  const { signAccessToken } = await import("../app/lib/jwt.ts");
  const empresaRoute = await import("../app/api/empresa/route.js");
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: "11111111-1111-1111-1111-111111111111", legajo: 1, rol: "gerencial" });
  let cambios = null;
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.") && opts?.method === "PATCH", respond: (url, opts) => { cambios = JSON.parse(opts.body); return { status: 200, body: [cambios] }; } },
    {
      match: (url) => url.includes("/rest/v1/empresa?id=eq.") && url.includes("select=id,nombre"),
      respond: (url) => {
        pedidos.push(url);
        return url.includes("resumen_semanal")
          ? { status: 400, body: { message: "column empresa.resumen_semanal does not exist" } }
          : { status: 200, body: [{ id: "e", nombre: "Gi", escaner_ot: true }] };
      },
    },
  ]);
  const patch = await empresaRoute.PATCH(new Request("http://localhost/api/empresa", {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ resumen_semanal: false }),
  }));
  assert.equal(patch.status, 200);
  assert.equal(cambios.resumen_semanal, false);

  const res = await empresaRoute.GET(new Request("http://localhost/api/empresa", { headers: { Authorization: `Bearer ${token}` } }));
  assert.equal((await res.json()).escaner_ot, true);
  assert.equal(pedidos.length, 2, "un solo reintento, sacando solo la columna que falta");
  assert.ok(pedidos[1].includes("escaner_ot") && pedidos[1].includes("tipos_solicitud"));
});
