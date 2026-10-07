// tests/offline.test.jsx — Fichar y cargar tareas sin conexión (F4-05, ítem 21):
// cola en el celular, idempotencia en el servidor y hora real de lo hecho.
import "./helpers/domSetup.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, renderHook, act, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

const { validarMomento, horaLocal, MAX_ATRASO_OFFLINE_H } = await import("../app/lib/offline.js");
const cola = await import("../app/lib/colaOffline.js");
const { ficharServer } = await import("../app/lib/fichar.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST: fichar } = await import("../app/api/fichar/route.js");
const { POST: actividad } = await import("../app/api/actividad/route.js");
const { _resetBuckets } = await import("../app/lib/rateLimitMemory.js");
const { useActividad } = await import("../app/hooks/useActividad.js");
const { default: BotonFichar } = await import("../app/components/BotonFichar.jsx");
const { default: EstadoConexion } = await import("../app/components/EstadoConexion.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const OP = "33333333-3333-4333-8333-333333333333";

function enLinea(si) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => si });
}
beforeEach(() => { localStorage.clear(); enLinea(true); _resetBuckets?.(); });
afterEach(() => cleanup());

// ── Reglas ──

test("validarMomento — acepta lo de las últimas horas y rechaza futuro o demasiado viejo", () => {
  const ahora = Date.parse("2026-10-07T15:00:00Z");
  assert.equal(validarMomento("2026-10-07T11:00:00Z", ahora).ok, true);
  assert.equal(validarMomento("2026-10-07T15:01:00Z", ahora).ok, true, "reloj apenas adelantado");
  assert.equal(validarMomento("2026-10-07T15:10:00Z", ahora).tipo, "momento_futuro");
  assert.equal(validarMomento(new Date(ahora - (MAX_ATRASO_OFFLINE_H + 1) * 3600000).toISOString(), ahora).tipo, "offline_vencido");
  assert.equal(validarMomento("cualquier cosa", ahora).tipo, "momento_invalido");
});

test("horaLocal — fecha, hora y día en la zona de la empresa", () => {
  assert.deepEqual(horaLocal("America/Argentina/Buenos_Aires", new Date("2026-10-05T02:30:00Z")), { fecha: "2026-10-04", hora: "23:30", diaKey: "dom" });
  assert.deepEqual(horaLocal("America/Argentina/Buenos_Aires", new Date("2026-10-07T03:05:00Z")), { fecha: "2026-10-07", hora: "00:05", diaKey: "mie" });
});

// ── Cola del celular ──

const sinRed = async () => { throw new TypeError("Failed to fetch"); };

test("enviarOEncolar — con señal manda directo con op_id; sin señal guarda con la hora en que se hizo", async () => {
  const enviados = [];
  const r1 = await cola.enviarOEncolar({ empleadoId: "a", tipo: "fichar", url: "/api/fichar", body: { accion: "ingreso" }, enviar: async (op) => { enviados.push(op); return { status: 200, data: { ok: true } }; } });
  assert.equal(r1.encolado, false);
  assert.match(enviados[0].body.op_id, /^[0-9a-f-]{36}$/);
  assert.equal(enviados[0].body.momento, undefined, "con señal vale la hora del servidor");

  const r2 = await cola.enviarOEncolar({ empleadoId: "a", tipo: "fichar", url: "/api/fichar", body: { accion: "egreso" }, enviar: sinRed, paraCola: (b) => ({ ...b, forzar_cierre_tarea: true }) });
  assert.equal(r2.encolado, true);
  const [op] = cola.pendientes("a");
  assert.equal(op.body.momento, op.creado_en);
  assert.equal(op.body.forzar_cierre_tarea, true);
  assert.equal(cola.pendientes("otro").length, 0, "la cola es de cada empleado");
});

test("enviarOEncolar — si ya hay algo esperando, lo nuevo va a la cola para respetar el orden", async () => {
  enLinea(false);
  await cola.enviarOEncolar({ empleadoId: "a", tipo: "actividad", url: "/api/actividad", body: { accion: "iniciar", etapa: 1, codigo_proyecto: "1" }, enviar: sinRed });
  enLinea(true);
  const orden = [];
  const enviar = async (op) => { orden.push(op.body.accion); return { status: 200, data: { ok: true } }; };
  const r = await cola.enviarOEncolar({ empleadoId: "a", tipo: "actividad", url: "/api/actividad", body: { accion: "finalizar" }, enviar });
  assert.equal(r.encolado, true);
  await waitFor(() => assert.deepEqual(orden, ["iniciar", "finalizar"]));
  assert.equal(cola.pendientes("a").length, 0);
});

test("sincronizar — manda en orden, corta sin red, y lo rechazado queda para avisar", async () => {
  enLinea(false);
  for (const accion of ["ingreso", "egreso"]) await cola.enviarOEncolar({ empleadoId: "a", tipo: "fichar", url: "/api/fichar", body: { accion }, enviar: sinRed });
  await cola.enviarOEncolar({ empleadoId: "b", tipo: "fichar", url: "/api/fichar", body: { accion: "ingreso" }, enviar: sinRed });
  enLinea(true);

  // Sin red: no se pierde nada
  let r = await cola.sincronizar("a", sinRed);
  assert.deepEqual(r, { enviadas: 0, rechazadas: 0, quedan: 2 });
  // Servidor caído: tampoco
  r = await cola.sincronizar("a", async () => ({ status: 503, data: {} }));
  assert.equal(r.quedan, 2);

  const vistos = [];
  r = await cola.sincronizar("a", async (op) => {
    vistos.push(op.body.accion);
    return op.body.accion === "ingreso"
      ? { status: 200, data: { ok: false, tipo: "ya_fichado" } } // ya estaba: cuenta como hecho
      : { status: 200, data: { ok: false, tipo: "offline_vencido", error: "Pasaron más de 12 horas" } };
  });
  assert.deepEqual(vistos, ["ingreso", "egreso"]);
  assert.deepEqual(r, { enviadas: 1, rechazadas: 1, quedan: 0 });
  assert.equal(cola.fallidas("a")[0].error, "Pasaron más de 12 horas");
  assert.equal(cola.pendientes("b").length, 1, "lo de otro empleado no se manda con esta sesión");
  cola.descartarFallida(cola.fallidas("a")[0].op_id);
  assert.equal(cola.fallidas("a").length, 0);
});

test("fichadaConPendientes — suma lo fichado sin enviar", () => {
  const ingreso = { tipo: "fichar", creado_en: "2026-10-07T11:02:00Z", body: { accion: "ingreso" } };
  const egreso = { tipo: "fichar", creado_en: "2026-10-07T20:00:00Z", body: { accion: "egreso" } };
  assert.equal(cola.fichadaConPendientes(null, [ingreso], "2026-10-07").ingreso, "08:02:00");
  const cerrada = cola.fichadaConPendientes(null, [ingreso, egreso], "2026-10-07");
  assert.equal(cerrada.egreso, "17:00:00");
  assert.equal(cola.fichadaConPendientes({ ingreso: "07:55:00" }, [ingreso], "2026-10-07").ingreso, "07:55:00", "lo del servidor manda");
});

test("ficharServer — sin señal devuelve 'guardado' con la hora y la salida cierra la tarea", async () => {
  global.fetch = sinRed;
  const r = await ficharServer("egreso", { geo_lat: -31.4, geo_lng: -64.2, empleadoId: "a" });
  assert.equal(r.encolado, true);
  assert.match(r.hora, /^\d{2}:\d{2}$/);
  const [op] = cola.pendientes("a");
  assert.equal(op.url, "/api/fichar");
  assert.deepEqual({ accion: op.body.accion, geo_lat: op.body.geo_lat, forzar: op.body.forzar_cierre_tarea }, { accion: "egreso", geo_lat: -31.4, forzar: true });
  assert.equal(op.body.empleadoId, undefined, "el id del empleado no viaja en el body");
  // Sin empleadoId (chat) sigue como antes: error de conexión
  await assert.rejects(ficharServer("ingreso", {}), (e) => e.tipo === "sin_conexion");
});

// ── /api/fichar ──

async function tk() {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol: "operativo" })).token;
}
const pedirFichar = async (body) => fichar(new Request("http://localhost/api/fichar", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tk()}` }, body: JSON.stringify(body) }));

function mockFichar({ yaProcesada = null } = {}) {
  const r = { fichada: null, guardada: null, consultasFichadas: 0 };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/operaciones_offline?op_id="), respond: () => ({ status: 200, body: yaProcesada ? [{ resultado: yaProcesada }] : [] }) },
    { match: (url, o) => url.includes("/rest/v1/operaciones_offline") && o?.method === "POST", respond: (url, o) => { r.guardada = JSON.parse(o.body); return { status: 201, body: [r.guardada] }; } },
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=timezone"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro" }] }) },
    { match: (url) => url.includes("select=reglas_asistencia"), respond: () => ({ status: 200, body: [{ reglas_asistencia: null }] }) },
    { match: (url) => url.includes("/rest/v1/geo_zonas"), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("/rest/v1/fichadas") && url.includes("select=id,ingreso"), respond: () => { r.consultasFichadas++; return { status: 200, body: [] }; } },
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=diagrama"), respond: () => ({ status: 200, body: [{ diagrama: null }] }) },
    { match: (url, o) => url.includes("/rest/v1/fichadas") && o?.method === "POST", respond: (url, o) => { r.fichada = JSON.parse(o.body); return { status: 201, body: [r.fichada] }; } },
    { match: (url) => url.includes("/rest/v1/fichadas"), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("/rest/v1/audit_log") || url.includes("/rest/v1/metricas") || url.includes("/realtime/"), respond: () => ({ status: 201, body: [] }) },
  ]);
  return r;
}

test("/api/fichar — lo fichado sin señal queda con la hora en que se hizo, marcado, y se guarda el op_id", async () => {
  const r = mockFichar();
  const momento = new Date(Date.now() - 2 * 3600000);
  const res = await pedirFichar({ accion: "ingreso", op_id: OP, momento: momento.toISOString() });
  const json = await res.json();
  assert.equal(json.ok, true);
  const esperado = horaLocal("America/Argentina/Buenos_Aires", momento);
  assert.equal(r.fichada.ingreso, esperado.hora);
  assert.equal(r.fichada.fecha, esperado.fecha);
  assert.match(r.fichada.notas, /sin conexión/);
  await waitFor(() => assert.equal(r.guardada?.op_id, OP));
  assert.equal(r.guardada.tipo, "fichar");
});

test("/api/fichar — el mismo op_id dos veces no ficha de nuevo", async () => {
  const r = mockFichar({ yaProcesada: { ok: true, hora: "08:02" } });
  const json = await (await pedirFichar({ accion: "ingreso", op_id: OP, momento: new Date().toISOString() })).json();
  assert.deepEqual(json, { ok: true, hora: "08:02", duplicado: true });
  assert.equal(r.fichada, null);
  assert.equal(r.consultasFichadas, 0);
});

test("/api/fichar — algo de hace más de 12 h no se acepta, y un op_id raro no se usa en la consulta", async () => {
  const r = mockFichar();
  const viejo = await (await pedirFichar({ accion: "ingreso", op_id: OP, momento: new Date(Date.now() - 13 * 3600000).toISOString() })).json();
  assert.equal(viejo.tipo, "offline_vencido");
  assert.equal(r.fichada, null);
  assert.equal(r.guardada, null, "lo rechazado no se guarda: se puede corregir");
  const raro = await pedirFichar({ accion: "ingreso", op_id: "x&empresa_id=eq.otra" });
  assert.equal(raro.status, 400);
});

// ── /api/actividad ──

const pedirActividad = async (body) => actividad(new Request("http://localhost/api/actividad", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tk()}` }, body: JSON.stringify(body) }));

function mockActividad({ abiertas = [] } = {}) {
  const r = { cierres: [], nueva: null };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/operaciones_offline?op_id="), respond: () => ({ status: 200, body: [] }) },
    { match: (url, o) => url.includes("/rest/v1/operaciones_offline") && o?.method === "POST", respond: () => ({ status: 201, body: [{}] }) },
    { match: (url, o) => url.includes("/rest/v1/registro_actividades?id=eq.") && o?.method === "PATCH", respond: (url, o) => { r.cierres.push({ url, ...JSON.parse(o.body) }); return { status: 200, body: [{}] }; } },
    { match: (url, o) => url.includes("/rest/v1/registro_actividades") && o?.method === "POST", respond: (url, o) => { r.nueva = JSON.parse(o.body); return { status: 201, body: [{ id: 99, ...r.nueva }] }; } },
    { match: (url) => url.includes("/rest/v1/registro_actividades"), respond: () => ({ status: 200, body: abiertas }) },
    { match: (url) => url.includes("/rest/v1/empleados?id=eq.") && url.includes("select=division"), respond: () => ({ status: 200, body: [{ division: "produccion", legajo: 7 }] }) },
    { match: (url) => url.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro" }] }) },
    { match: (url) => url.includes("/realtime/"), respond: () => ({ status: 200, body: {} }) },
  ]);
  return r;
}

test("/api/actividad — iniciar cierra lo abierto y abre la nueva a la hora en que se hizo", async () => {
  const inicioAnterior = new Date(Date.now() - 3 * 3600000).toISOString();
  const r = mockActividad({ abiertas: [{ id: 5, hora_inicio: inicioAnterior }] });
  const momento = new Date(Date.now() - 3600000).toISOString();
  const json = await (await pedirActividad({ accion: "iniciar", etapa: 2, codigo_proyecto: "1001", op_id: OP, momento })).json();
  assert.equal(json.ok, true);
  assert.equal(r.cierres.length, 1);
  assert.equal(Date.parse(r.cierres[0].hora_fin), Date.parse(momento));
  assert.equal(r.cierres[0].duracion_min, 120);
  assert.equal(Date.parse(r.nueva.hora_inicio), Date.parse(momento));
  assert.deepEqual({ etapa: r.nueva.etapa, ot: r.nueva.codigo_proyecto, division: r.nueva.division, empresa: r.nueva.empresa_id, empleado: r.nueva.empleado_id }, { etapa: 2, ot: "1001", division: "produccion", empresa: E, empleado: EMP });
});

test("/api/actividad — algo viejo no pisa una tarea empezada después; validaciones", async () => {
  const r = mockActividad({ abiertas: [{ id: 5, hora_inicio: new Date(Date.now() - 600000).toISOString() }] });
  const json = await (await pedirActividad({ accion: "finalizar", momento: new Date(Date.now() - 3600000).toISOString() })).json();
  assert.equal(json.tipo, "desfasada");
  assert.equal(r.cierres.length, 0);
  assert.equal((await pedirActividad({ accion: "iniciar", etapa: 2 })).status, 400, "falta la OT");
  assert.equal((await pedirActividad({ accion: "iniciar", etapa: 0 })).status, 400, "espera sin causa");
  assert.equal((await pedirActividad({ accion: "iniciar", etapa: 2, codigo_proyecto: "1", empleado_id: "otro" })).status, 400, "no se puede elegir otro empleado");
});

test("/api/actividad — finalizar cierra la tarea abierta con observaciones", async () => {
  const r = mockActividad({ abiertas: [{ id: 5, hora_inicio: new Date(Date.now() - 1800000).toISOString() }] });
  const json = await (await pedirActividad({ accion: "finalizar", observaciones: "Terminado" })).json();
  assert.deepEqual(json, { ok: true, cerradas: 1 });
  assert.equal(r.cierres[0].observaciones, "Terminado");
  assert.match(r.cierres[0].url, /hora_fin=is\.null/);
  assert.equal(r.nueva, null);
});

// ── En el celular ──

test("useActividad — sin señal, la tarea se ve iniciada y queda en la cola", async () => {
  let bloqueado = true;
  global.fetch = async (url) => {
    if (bloqueado) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 });
  };
  const empleado = { id: "emp-x", empresa_id: E, legajo: 7, division: "produccion" };
  const { result } = renderHook(() => useActividad(empleado));
  await waitFor(() => assert.equal(result.current.loading, false));
  enLinea(false);
  await act(async () => { await result.current.iniciarTarea({ etapa: 1, codigo_proyecto: "1001", tipo: "N" }); });
  assert.equal(result.current.tareaActiva.codigo_proyecto, "1001");
  assert.equal(result.current.tareaActiva.sinEnviar, true);
  await act(async () => { await result.current.finalizarTarea(); });
  assert.equal(result.current.tareaActiva, null);
  assert.equal(result.current.historial[0].sinEnviar, true);
  const ops = cola.pendientes("emp-x");
  assert.deepEqual(ops.map((o) => o.body.accion), ["iniciar", "finalizar"]);
  assert.ok(ops.every((o) => o.url === "/api/actividad" && o.body.momento));
});

test("BotonFichar + EstadoConexion — sin señal avisa que quedó guardado y lo muestra pendiente", async () => {
  enLinea(false);
  global.fetch = sinRed;
  const usuario = { id: "emp-y", legajo: 7, apodo: "Ana", empresa_id: E };
  render(<BotonFichar usuario={usuario} fichadaHoy={null} />);
  fireEvent.click(screen.getByRole("button", { name: /Fichar ingreso/i }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
  assert.ok(await screen.findByText(/Sin señal: guardamos tu entrada de las \d{2}:\d{2}/));
  cleanup();
  const estado = { pendientes: cola.pendientes("emp-y"), fallidas: [], enLinea: false, sincronizando: false, enviarAhora: () => {}, descartarFallida: () => {} };
  render(<EstadoConexion cola={estado} />);
  assert.ok(screen.getByText(/Sin conexión · 1 sin enviar/));
  assert.ok(screen.getByText(/Entrada \d{2}:\d{2}/));
});
