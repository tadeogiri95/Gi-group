// tests/menu-modulos.test.jsx — Núcleo modular, parte 2 (ítem 36): la app
// muestra solo lo que la empresa tiene; lo que falta aparece con candado.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

const { tieneModulo, comoSumarModulo, modulosEfectivos } = await import("../app/lib/modulos.js");
const { getItems } = await import("../app/components/nav/BottomNav.jsx");
const { default: ModuloBloqueado } = await import("../app/components/ModuloBloqueado.jsx");
const { default: ActividadScreen } = await import("../app/actividad_screen.jsx");
const { default: DashboardGerencia } = await import("../app/dashboard_gerencia.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { invalidarCachePlan } = await import("../app/lib/planEnforcement.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const { GET: empresaGET } = await import("../app/api/empresa/route.js");

afterEach(() => cleanup());

const ASISTENCIA = modulosEfectivos({ plan: "asistencia_15" });
const PLANTA = modulosEfectivos({ plan: "planta_15" });

test("tieneModulo — sin la lista (demo, versión vieja) muestra todo; con la lista, solo lo que hay", () => {
  assert.equal(tieneModulo({}, "proyectos"), true);
  assert.equal(tieneModulo(null, "proyectos"), true);
  assert.equal(tieneModulo({ modulos: ASISTENCIA }, "proyectos"), false);
  assert.equal(tieneModulo({ modulos: PLANTA }, "proyectos"), true);
  assert.equal(comoSumarModulo("asistencia_40", "proyectos").upgrade_a, "planta_40");
  assert.equal(comoSumarModulo("planta_15", "obra").upgrade_a, "campo");
});

test("barra de abajo del operario — sin tareas no aparece Actividad; con solo campo, sí", () => {
  const ids = (modulos) => getItems("operativo", 0, modulos).map((i) => i.id);
  assert.deepEqual(ids(undefined), ["home", "actividad", "chat", "mis-sols"]);
  assert.deepEqual(ids(ASISTENCIA), ["home", "chat", "mis-sols"]);
  assert.deepEqual(ids([...ASISTENCIA, "obra"]), ["home", "actividad", "chat", "mis-sols"]);
  assert.deepEqual(ids(["fichaje"]), ["home", "mis-sols"]);
  // La de gestión no cambia (sus secciones se marcan con candado adentro)
  assert.deepEqual(getItems("gerencial", 0, ["fichaje"]).map((i) => i.id), ["home", "solicitudes", "equipo", "config"]);
});

test("ModuloBloqueado — el dueño va a Facturación; el resto ve a quién pedírselo", () => {
  let abrio = 0;
  render(<ModuloBloqueado modulo="proyectos" empresa={{ plan_activo: "asistencia_15" }} rol="gerencial" onVerPlanes={() => abrio++} />);
  assert.ok(screen.getByText("Órdenes de trabajo"));
  assert.ok(screen.getByText(/parte del plan Planta/));
  fireEvent.click(screen.getByText("Sumalo desde Facturación"));
  assert.equal(abrio, 1);
  cleanup();
  render(<ModuloBloqueado modulo="obra" empresa={{ plan_activo: "planta_15" }} rol="administrativo" onVerPlanes={() => {}} />);
  assert.ok(screen.getByText(/add-on Trabajo en campo/));
  assert.ok(screen.getByText(/Pedíselo al dueño/));
  assert.equal(screen.queryByText("Sumalo desde Facturación"), null);
});

const ACT = (empresa) => (
  <ActividadScreen
    tareaActiva={null} historial={[]} etapas={[]} proyectos={[]} loading={false}
    usuario={{ id: "emp-1" }} empresa={empresa} fichadaHoy={{ ingreso: "08:00:00" }}
    iniciarTarea={async () => {}} finalizarTarea={async () => {}} cambiarTarea={async () => {}}
  />
);

test("Actividad del operario — el reporte de obra solo con Trabajo en campo; sin tareas va directo al reporte", () => {
  global.fetch = async () => Response.json({ ok: true, data: [] });
  render(ACT({ modulos: PLANTA }));
  assert.ok(screen.getByText(/Iniciar tarea/));
  assert.equal(screen.queryByText(/Reporte de Instalación/), null);
  cleanup();
  render(ACT({ modulos: [...PLANTA, "obra"] }));
  assert.ok(screen.getByText(/Reporte de Instalación/));
  cleanup();
  render(ACT({ modulos: [...ASISTENCIA, "obra"] }));
  assert.equal(screen.queryByText(/Iniciar tarea/), null);
});

test("tablero de gestión — Trabajo en campo y el detalle por operario según módulos", async () => {
  global.fetch = async () => Response.json({ ok: true, data: [] });
  const ctx = { empleados: [], fichadas: [], solicitudes: [], notificaciones: [] };
  const tablero = (modulos) => render(
    <AuthContext.Provider value={{ divisiones: [], usuario: { rol: "gerencial" } }}>
      <DashboardGerencia goto={() => {}} ctx={ctx} reload={() => {}} logout={() => {}} empresa={{ id: "e-1", nombre: "Acme", modulos }} />
    </AuthContext.Provider>
  );
  tablero(PLANTA);
  assert.ok(await screen.findByText("En planta"));
  assert.equal(screen.queryByText("Trabajo en campo"), null);
  fireEvent.click(screen.getByText("En planta"));
  assert.ok(screen.getByText(/Ver detalle por operario/));
  cleanup();
  tablero(ASISTENCIA);
  fireEvent.click(await screen.findByText("En planta"));
  assert.equal(screen.queryByText(/Ver detalle por operario/), null);
  cleanup();
  tablero([...PLANTA, "obra"]);
  assert.ok(await screen.findByText("Trabajo en campo"));
});

test("/api/empresa — con sesión manda los módulos de la empresa para armar el menú", async () => {
  const E = "11111111-1111-1111-1111-111111111111";
  invalidarCachePlan(E);
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: E, legajo: 7, rol: "operativo" });
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("select=addons"), respond: () => ({ status: 200, body: [{ addons: ["campo"] }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [{ modulo: "chat", activo: false, config: {} }] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ id: E, nombre: "Acme", plan_activo: "asistencia_15" }] }) },
  ]);
  const res = await empresaGET(new Request("http://localhost/api/empresa", { headers: { Authorization: `Bearer ${token}` } }));
  const json = await res.json();
  assert.equal(json.id, E);
  assert.deepEqual(json.modulos, ["fichaje", "reportes", "calendario", "obra"]);
});

test("Gestión — Proyectos, Calendario, Reportes y Reglas IA con candado si faltan sus módulos", async () => {
  const { seccionBloqueada } = await import("../app/lib/modulos.js");
  const asistencia = { modulos: ASISTENCIA };
  assert.equal(seccionBloqueada("proyectos", asistencia), true);
  assert.equal(seccionBloqueada("calendario", asistencia), false);
  assert.equal(seccionBloqueada("horarios", asistencia), false, "Horarios es de todos");
  assert.equal(seccionBloqueada("asistencia", { modulos: ["fichaje"] }), true);
  assert.equal(seccionBloqueada("reglas", { modulos: ["fichaje", "reportes"] }), true);
  assert.equal(seccionBloqueada("proyectos", {}), false, "sin lista de módulos no se bloquea nada");
  // La pantalla de Gestión usa esto para el candado y el aviso
  const { readFileSync } = await import("node:fs");
  const config = readFileSync(new URL("../app/components/screens/ConfigScreen.jsx", import.meta.url), "utf8");
  assert.match(config, /seccionBloqueada\(id, empresa\)/);
  assert.match(config, /<ModuloBloqueado modulo=\{moduloDe\(subtab\)\}/);
});
