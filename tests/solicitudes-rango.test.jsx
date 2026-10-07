// tests/solicitudes-rango.test.jsx — Solicitudes con rango de fechas y tipos por
// empresa (F4-12, F1-21, H9, ítem 23).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { tiposDeEmpresa, nombreSolicitud, diasEntre, diasEnPeriodo, rangoTexto } = await import("../app/lib/tiposSolicitud.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST: data } = await import("../app/api/data/route.js");
const { GET: liquidacion } = await import("../app/api/reportes/liquidacion/route.js");
const { PATCH: patchEmpresa } = await import("../app/api/empresa/route.js");
const { default: NuevaSolicitud } = await import("../app/components/NuevaSolicitud.jsx");

afterEach(() => cleanup());

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const token = async (rol, empresaId = EMPRESA_ID) => (await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId, legajo: 7, rol })).token;

// ── lib/tiposSolicitud ──

test("tiposDeEmpresa — sin configurar ofrece los de siempre; con configuración, los de la empresa", () => {
  assert.deepEqual(tiposDeEmpresa(null).map((t) => t.clave), ["permiso", "vacaciones", "ausencia", "justificacion", "cambio_horario", "otro"]);
  const propios = tiposDeEmpresa([
    { nombre: "Vacaciones", base: "vacaciones" },
    { nombre: "Examen", base: "permiso", multiDia: false },
    { nombre: "Examen", base: "permiso" },          // repetido: se ignora
    { nombre: "Raro", base: "no_existe" },           // base inválida: se ignora
    { nombre: "  ", base: "otro" },                  // sin nombre: se ignora
  ]);
  assert.deepEqual(propios, [
    { clave: "vacaciones", nombre: "Vacaciones", base: "vacaciones", multiDia: true },
    { clave: "examen", nombre: "Examen", base: "permiso", multiDia: false },
  ]);
  assert.equal(tiposDeEmpresa([]).length, 6, "lista vacía = los de siempre");
});

test("fechas — días del rango, días dentro del período y texto", () => {
  assert.equal(diasEntre("2026-10-03", "2026-10-10"), 8);
  assert.equal(diasEntre("2026-10-03", null), 1);
  assert.equal(diasEntre("2026-10-10", "2026-10-03"), 0);
  assert.equal(diasEnPeriodo({ fecha: "2026-09-28", fecha_hasta: "2026-10-03" }, "2026-10-01", "2026-10-31"), 3);
  assert.equal(diasEnPeriodo({ fecha: "2026-10-05", fecha_hasta: null }, "2026-10-01", "2026-10-31"), 1);
  assert.equal(rangoTexto({ fecha: "2026-10-03", fecha_hasta: "2026-10-10" }), "3/10 al 10/10");
  assert.equal(nombreSolicitud({ tipo: "permiso", etiqueta: "Examen" }), "Examen");
  assert.equal(nombreSolicitud({ tipo: "vacaciones" }), "Vacaciones");
});

// ── /api/data: validación del rango ──

function capturarSolicitudes() {
  const llamadas = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/empresa?id=eq.") && url.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "pro" }] }) },
    { match: (url) => url.includes("/rest/v1/solicitudes"), respond: (url, opts) => { llamadas.push(JSON.parse(opts.body)); return { status: 201, body: [{ id: 1 }] }; } },
  ]);
  return llamadas;
}

async function postSolicitud(body) {
  return data(new Request("http://localhost/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token("operativo")}` },
    body: JSON.stringify({ method: "POST", path: "solicitudes", body }),
  }));
}

const BASE = { legajo: 7, nombre_empleado: "Ana", tipo: "vacaciones", motivo: "Vacaciones" };

test("/api/data — guarda vacaciones de varios días con su etiqueta", async () => {
  const llamadas = capturarSolicitudes();
  const res = await postSolicitud({ ...BASE, fecha: "2026-10-03", fecha_hasta: "2026-10-10", etiqueta: "Vacaciones de invierno" });
  assert.equal(res.status, 200);
  assert.equal(llamadas[0].fecha_hasta, "2026-10-10");
  assert.equal(llamadas[0].etiqueta, "Vacaciones de invierno");
});

test("/api/data — rechaza un rango al revés, de más de 90 días o mal escrito", async () => {
  capturarSolicitudes();
  assert.equal((await postSolicitud({ ...BASE, fecha: "2026-10-10", fecha_hasta: "2026-10-03" })).status, 400);
  assert.equal((await postSolicitud({ ...BASE, fecha: "2026-01-01", fecha_hasta: "2026-12-31" })).status, 400);
  assert.equal((await postSolicitud({ ...BASE, fecha: "2026-10-03", fecha_hasta: "10/10/2026" })).status, 400);
});

// ── Liquidación: cuenta los días del rango dentro del período ──

test("liquidación — vacaciones de varios días suman todos sus días dentro del mes", async () => {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: null }] }) },
    { match: (url) => url.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ legajo: 7, nombre: "Ana" }] }) },
    { match: (url) => url.includes("/rest/v1/fichadas"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (url) => url.includes("/rest/v1/solicitudes"),
      respond: (url) => {
        pedidos.push(decodeURIComponent(url));
        return { status: 200, body: [{ legajo: 7, fecha: "2026-09-28", fecha_hasta: "2026-10-03" }, { legajo: 7, fecha: "2026-10-20", fecha_hasta: null }] };
      },
    },
  ]);
  // empresa propia del test: getPlanEmpresa cachea el plan por empresa
  const res = await liquidacion(new Request("http://localhost/api/reportes/liquidacion?desde=2026-10-01&hasta=2026-10-31", {
    headers: { Authorization: `Bearer ${await token("gerencial", "44444444-4444-4444-4444-444444444444")}` },
  }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.empleados[0].dias_ausencia, 4, "3 días de las vacaciones dentro de octubre + 1 día suelto");
  assert.match(pedidos[0], /fecha=lte\.2026-10-31/);
  assert.match(pedidos[0], /fecha_hasta\.gte\.2026-10-01/);
});

// ── Configurar los tipos (gestión) ──

async function patch(body) {
  return patchEmpresa(new Request("http://localhost/api/empresa", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token("gerencial")}` },
    body: JSON.stringify(body),
  }));
}

test("PATCH /api/empresa — guarda los tipos de la empresa y rechaza una base inválida", async () => {
  let cambios = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.") && opts?.method === "PATCH", respond: (url, opts) => { cambios = JSON.parse(opts.body); return { status: 200, body: [cambios] }; } },
  ]);
  const ok = await patch({ tipos_solicitud: [{ nombre: "Examen", base: "permiso", multiDia: false }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(cambios.tipos_solicitud, [{ nombre: "Examen", base: "permiso", multiDia: false }]);
  assert.equal((await patch({ tipos_solicitud: [{ nombre: "X", base: "aprobado" }] })).status, 400);
  assert.equal((await patch({ tipos_solicitud: null })).status, 200, "null = volver a los de siempre");
});

// ── Formulario del operario ──

function servidorFormulario() {
  const cuerpos = [];
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    cuerpos.push({ url: String(url), body });
    return new Response(JSON.stringify({ data: [{ id: 1 }], ok: true }), { status: 200 });
  };
  return cuerpos;
}

const USUARIO = { id: EMPLEADO_ID, legajo: 7, nombre: "Ana Gómez", apodo: "Ana", empresa_id: EMPRESA_ID };

test("Nueva solicitud — vacaciones con rango: manda el primer y el último día", async () => {
  const cuerpos = servidorFormulario();
  let enviada = false;
  render(<NuevaSolicitud usuario={USUARIO} empresa={{}} onEnviada={() => { enviada = true; }} onCerrar={() => {}} />);
  fireEvent.change(screen.getByLabelText("¿Qué necesitás?"), { target: { value: "vacaciones" } });
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-03" } });
  fireEvent.change(screen.getByLabelText("Hasta (opcional)"), { target: { value: "2026-10-10" } });
  assert.ok(screen.getByText("8 días"));
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
  await waitFor(() => assert.ok(enviada));
  const sol = cuerpos.find((c) => c.body?.path === "solicitudes").body.body;
  assert.equal(sol.tipo, "vacaciones");
  assert.equal(sol.fecha, "2026-10-03");
  assert.equal(sol.fecha_hasta, "2026-10-10");
  assert.equal(sol.etiqueta, null, "nombre estándar: sin etiqueta");
  assert.ok(cuerpos.some((c) => c.body?.path === "notificaciones"), "avisa a gerencia");
});

test("Nueva solicitud — tipos de la empresa: un tipo propio de un día guarda su nombre y no pide 'Hasta'", async () => {
  const cuerpos = servidorFormulario();
  render(<NuevaSolicitud usuario={USUARIO} empresa={{ tipos_solicitud: [{ nombre: "Examen", base: "permiso", multiDia: false }] }} onEnviada={() => {}} onCerrar={() => {}} />);
  assert.equal(screen.queryByLabelText("Hasta (opcional)"), null);
  fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-10-15" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
  await waitFor(() => assert.ok(cuerpos.some((c) => c.body?.path === "solicitudes")));
  const sol = cuerpos.find((c) => c.body?.path === "solicitudes").body.body;
  assert.equal(sol.tipo, "permiso");
  assert.equal(sol.etiqueta, "Examen");
  assert.equal(sol.fecha_hasta, null);
});

test("Nueva solicitud — avisa si el rango está al revés y no envía", () => {
  const cuerpos = servidorFormulario();
  render(<NuevaSolicitud usuario={USUARIO} empresa={{}} onEnviada={() => {}} onCerrar={() => {}} />);
  fireEvent.change(screen.getByLabelText("¿Qué necesitás?"), { target: { value: "vacaciones" } });
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-10" } });
  fireEvent.change(screen.getByLabelText("Hasta (opcional)"), { target: { value: "2026-10-03" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
  assert.match(screen.getByRole("alert").textContent, /anterior/);
  assert.equal(cuerpos.length, 0);
});
