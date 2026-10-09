// tests/onboarding-alta.test.jsx — Alta self-service (ítem 24, F4-14, D17):
// pasos de planta, horario tipo y OT del asistente, y checklist de activación.
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

const lib = await import("../app/lib/onboarding.js");
const { default: OnboardingWizard } = await import("../app/onboarding_wizard.jsx");
const { default: ChecklistActivacion, estadoActivacion } = await import("../app/components/ChecklistActivacion.jsx");
const { setToken } = await import("../app/lib/supabase.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST: importarCsv } = await import("../app/api/empleados/import-csv/route.js");

afterEach(() => { cleanup(); localStorage.clear(); });

const DIA = 86400000;

// ── lib/onboarding ──

test("diagramaDesde — arma el diagrama de la semana y rechaza horarios inválidos", () => {
  const d = lib.diagramaDesde({ dias: ["lun", "mie"], entrada: "07:00", salida: "15:30" });
  assert.deepEqual(d.lun, { in: "07:00", out: "15:30" });
  assert.equal(d.mar, null);
  assert.deepEqual(d.mie, { in: "07:00", out: "15:30" });
  assert.equal(lib.diagramaDesde({ dias: [], entrada: "07:00", salida: "15:00" }), null, "sin días");
  assert.equal(lib.diagramaDesde({ dias: ["lun"], entrada: "7", salida: "15:00" }), null, "hora mal escrita");
  assert.equal(lib.diagramaDesde({ dias: ["lun"], entrada: "08:00", salida: "08:00" }), null, "entrada igual a salida");
});

test("validarDiagrama / horasSemanales — limpia lo que llega y cuenta el turno noche", () => {
  assert.equal(lib.validarDiagrama({ lun: { in: "25:00", out: "10:00" } }), null);
  assert.equal(lib.validarDiagrama({ lun: null }), null, "al menos un día");
  assert.equal(lib.validarDiagrama("lun"), null);
  const limpio = lib.validarDiagrama({ lun: { in: "22:00", out: "06:00", extra: "x" }, feriado: 1 });
  assert.deepEqual(limpio.lun, { in: "22:00", out: "06:00" });
  assert.equal("feriado" in limpio, false);
  assert.equal(lib.horasSemanales(limpio), 8, "22 a 6 son 8 horas");
  assert.equal(lib.horasSemanales(lib.diagramaDesde(lib.horarioTipoDefault())), 45);
});

test("textoHorario — días seguidos como rango", () => {
  assert.equal(lib.textoHorario(lib.horarioTipoDefault()), "Lun a Vie · 08:00 a 17:00");
  assert.equal(lib.textoHorario({ dias: ["sab", "lun"], entrada: "09:00", salida: "13:00" }), "Lun, Sáb · 09:00 a 13:00");
});

test("mostrarChecklist — solo los primeros 14 días, sin cerrar y con algo pendiente", () => {
  const ahora = Date.parse("2026-10-07T12:00:00Z");
  const pend = [{ hecho: true }, { hecho: false }];
  assert.equal(lib.mostrarChecklist({ creadaEl: "2026-10-01T00:00:00Z", pasos: pend, ahora }), true);
  assert.equal(lib.mostrarChecklist({ creadaEl: "2026-09-01T00:00:00Z", pasos: pend, ahora }), false, "pasaron los 14 días");
  assert.equal(lib.mostrarChecklist({ creadaEl: "2026-10-01T00:00:00Z", pasos: pend, ahora, cerrado: true }), false);
  assert.equal(lib.mostrarChecklist({ creadaEl: "2026-10-01T00:00:00Z", pasos: [{ hecho: true }], ahora }), false, "todo hecho");
  assert.equal(lib.mostrarChecklist({ creadaEl: null, pasos: pend, ahora }), false);
  assert.equal(lib.diasRestantes("2026-10-01T12:00:00Z", ahora), 8);
});

// ── import-csv con horario tipo ──

async function tokenGerente() {
  return (await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: "11111111-1111-1111-1111-111111111111", legajo: 1, rol: "gerencial" })).token;
}

function mockImport(capturado) {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/empleados?empresa_id=eq.") && url.includes("select=legajo"), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("/rest/v1/empresa?id=eq.") && url.includes("plan_activo,slug"), respond: () => ({ status: 200, body: [{ plan_activo: "pro", slug: "acme" }] }) },
    {
      match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "POST",
      respond: (url, opts) => { capturado.filas = JSON.parse(opts.body); return { status: 201, body: capturado.filas }; },
    },
  ]);
}

async function pedirImport(body) {
  return importarCsv(new Request("http://localhost/api/empleados/import-csv", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenGerente()}` },
    body: JSON.stringify(body),
  }));
}

test("import-csv — con horario tipo, todos los importados quedan con ese diagrama y sus horas", async () => {
  const capturado = {};
  mockImport(capturado);
  const diagrama = lib.diagramaDesde(lib.horarioTipoDefault());
  const res = await pedirImport({ csv: "legajo,nombre\n10,Ana Gómez\n11,Luis Díaz", diagrama });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.created, 2);
  assert.equal(json.activaciones.length, 2, "devuelve los códigos para imprimir los QR");
  assert.ok(json.activaciones[0].link.includes("acme"));
  assert.deepEqual(capturado.filas[0].diagrama, diagrama);
  assert.equal(capturado.filas[1].horas_semanales, 45);
});

test("import-csv — horario inválido se rechaza; sin horario no se toca el diagrama", async () => {
  const capturado = {};
  mockImport(capturado);
  const malo = await pedirImport({ csv: "legajo,nombre\n10,Ana Gómez", diagrama: { lun: { in: "8", out: "17:00" } } });
  assert.equal(malo.status, 400);
  assert.equal(capturado.filas, undefined);

  await pedirImport({ csv: "legajo,nombre\n10,Ana Gómez" });
  assert.equal("diagrama" in capturado.filas[0], false);
});

// ── Asistente ──

test("Asistente — planta, horario, equipo y OT se guardan, y al final ofrece imprimir los QR", async () => {
  setToken("fake-token-de-test");
  const posts = [];
  let importBody = null;
  global.fetch = createFetchMock([
    {
      match: (url, opts) => url.includes("/api/geocode"),
      respond: () => ({ status: 200, body: [{ lat: -31.4201, lng: -64.1888, label: "Av. Colón 100, Córdoba" }] }),
    },
    {
      match: (url, opts) => url.includes("/api/data"),
      respond: (url, opts) => { posts.push(JSON.parse(opts.body)); return { status: 200, body: { ok: true, data: [{}] } }; },
    },
    {
      match: (url) => url.includes("/api/empleados/import-csv"),
      respond: (url, opts) => {
        importBody = JSON.parse(opts.body);
        return { status: 200, body: { ok: true, created: 1, errors: [], activaciones: [{ legajo: 7, nombre: "Ana Gómez", codigo: "ABCD-1234", link: "https://gypi.app/acme/activar?c=x" }] } };
      },
    },
  ]);

  let completado = null;
  render(<OnboardingWizard empresa={{ id: "emp-1" }} usuario={{ empresa_id: "emp-1" }} onComplete={(e) => { completado = e; }} />);

  // 1 · Empresa
  fireEvent.change(screen.getByPlaceholderText("Nombre de la empresa"), { target: { value: "Acme" } });
  fireEvent.click(screen.getByText("Siguiente →"));
  // 2 · Planta: busca la dirección y la elige
  fireEvent.change(screen.getByLabelText("Dirección"), { target: { value: "Av. Colón 100, Córdoba" } });
  fireEvent.click(screen.getByText("Buscar"));
  fireEvent.click(await screen.findByText("Av. Colón 100, Córdoba"));
  fireEvent.change(screen.getByLabelText(/Se puede fichar a menos de/), { target: { value: "300" } });
  fireEvent.click(screen.getByText("Siguiente →"));
  // 3 · Horario: agrega el sábado y cambia la entrada
  fireEvent.click(screen.getByRole("button", { name: "Sáb" }));
  fireEvent.change(screen.getByLabelText("Entrada"), { target: { value: "07:00" } });
  fireEvent.click(screen.getByText("Siguiente →"));
  // 4 · Equipo
  fireEvent.click(screen.getByText("+ Agregar"));
  fireEvent.change(screen.getByPlaceholderText("Nombre completo"), { target: { value: "Ana Gómez" } });
  fireEvent.change(screen.getByPlaceholderText("Legajo"), { target: { value: "7" } });
  fireEvent.click(screen.getByText("Siguiente →"));
  // 5 · OT
  fireEvent.change(screen.getByLabelText("Número de OT"), { target: { value: "1001" } });
  fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "Constructora Sur" } });
  fireEvent.click(screen.getByText("Siguiente →"));
  // 6 · Resumen
  assert.ok(screen.getByText("Lun a Sáb · 07:00 a 17:00"));
  fireEvent.click(screen.getByText("🚀 Empezar a usar Gypi"));

  // Cierre con los códigos del equipo
  assert.ok(await screen.findByText("Tu equipo ya está cargado"));
  assert.ok(screen.getByText("ABCD-1234"));
  assert.ok(screen.getByText("🖨️ Imprimir tarjetas con QR"));
  assert.equal(completado, null, "no entra hasta que el dueño toca Entrar");

  const zona = posts.find((p) => p.path === "geo_zonas");
  assert.deepEqual(zona.body, { nombre: "Planta", lat: -31.4201, lng: -64.1888, radio: 300 });
  const proyecto = posts.find((p) => p.path === "proyectos");
  assert.equal(proyecto.body.ot, "1001");
  assert.equal(proyecto.body.cliente, "Constructora Sur");
  assert.deepEqual(importBody.diagrama.sab, { in: "07:00", out: "17:00" });
  assert.equal(importBody.diagrama.dom, null);

  fireEvent.click(screen.getByText("Entrar a Gypi →"));
  assert.equal(completado.nombre, "Acme");
  assert.equal(completado.onboarding_completado, true);
});

test("Asistente — sin días elegidos no deja avanzar; desmarcando 'mismo horario' sí, y no manda diagrama", async () => {
  setToken("fake-token-de-test");
  let importBody = null;
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/api/data"), respond: () => ({ status: 200, body: { ok: true, data: [{}] } }) },
    { match: (url) => url.includes("/api/empleados/import-csv"), respond: (url, opts) => { importBody = JSON.parse(opts.body); return { status: 200, body: { ok: true, created: 1, errors: [], activaciones: [] } }; } },
  ]);
  let completado = false;
  render(<OnboardingWizard empresa={{ id: "emp-1" }} usuario={{ empresa_id: "emp-1" }} onComplete={() => { completado = true; }} />);
  fireEvent.change(screen.getByPlaceholderText("Nombre de la empresa"), { target: { value: "Acme" } });
  fireEvent.click(screen.getByText("Siguiente →"));
  fireEvent.click(screen.getByText("Saltar →"));
  for (const d of ["Lun", "Mar", "Mié", "Jue", "Vie"]) fireEvent.click(screen.getByRole("button", { name: d }));
  assert.equal(screen.getByText("Siguiente →").closest("button").disabled, true);
  fireEvent.click(screen.getByLabelText("Todos trabajan con el mismo horario"));
  fireEvent.click(screen.getByText("Siguiente →"));
  fireEvent.click(screen.getByText("+ Agregar"));
  fireEvent.change(screen.getByPlaceholderText("Nombre completo"), { target: { value: "Ana Gómez" } });
  fireEvent.click(screen.getByText("Siguiente →"));
  fireEvent.click(screen.getByText("Saltar →"));
  fireEvent.click(screen.getByText("🚀 Empezar a usar Gypi"));
  await waitFor(() => assert.equal(completado, true));
  assert.equal("diagrama" in importBody, false);
});

// ── Checklist ──

const RECIENTE = { id: "e1", created_at: new Date(Date.now() - 3 * DIA).toISOString() };

test("Checklist — muestra lo que falta, lleva a la pantalla y se puede ocultar", async () => {
  const destinos = [];
  const cargar = async () => ({ ubicacion: true, equipo: true, horario: false, equipoActivo: false, ot: false, fichada: false, tarea: false });
  render(<ChecklistActivacion empresa={RECIENTE} goto={(s) => destinos.push(s)} cargar={cargar} />);
  assert.ok(await screen.findByText("Primeros pasos · 2 de 7"));
  assert.ok(screen.getByText(/Te quedan 11 días/));
  fireEvent.click(screen.getAllByText("Ir")[0]);
  assert.deepEqual(destinos, ["config:horarios"], "el primer pendiente es el horario y abre esa sección");
  fireEvent.click(screen.getByLabelText("Ocultar primeros pasos"));
  assert.equal(screen.queryByText(/Primeros pasos/), null);
  cleanup();
  render(<ChecklistActivacion empresa={RECIENTE} cargar={cargar} />);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(screen.queryByText(/Primeros pasos/), null, "queda oculto en este dispositivo");
});

test("Checklist — no aparece pasados los 14 días ni con todo hecho", async () => {
  let consultas = 0;
  const viejo = { id: "e2", created_at: new Date(Date.now() - 20 * DIA).toISOString() };
  render(<ChecklistActivacion empresa={viejo} cargar={async () => { consultas++; return {}; }} />);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(screen.queryByText(/Primeros pasos/), null);
  assert.equal(consultas, 0, "ni siquiera consulta");
  cleanup();
  const todo = { ubicacion: true, equipo: true, horario: true, equipoActivo: true, ot: true, fichada: true, tarea: true };
  render(<ChecklistActivacion empresa={{ ...RECIENTE, id: "e3" }} cargar={async () => todo} />);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(screen.queryByText(/Primeros pasos/), null);
});

test("estadoActivacion — una consulta por paso; si una falla, ese paso queda pendiente", async () => {
  const pedidos = [];
  const hay = await estadoActivacion(async (path) => {
    pedidos.push(path);
    if (path.startsWith("fichadas")) throw new Error("caído");
    return path.startsWith("geo_zonas") || path.includes("diagrama") ? [{ id: 1 }] : [];
  });
  assert.equal(pedidos.length, 7);
  assert.ok(pedidos.every((p) => p.includes("limit=1")));
  assert.deepEqual(hay, { ubicacion: true, equipo: false, horario: true, equipoActivo: false, ot: false, fichada: false, tarea: false });
});
