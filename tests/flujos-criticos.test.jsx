// tests/flujos-criticos.test.jsx — Flujos críticos sin test hasta ahora (F1-16, ítem 35):
// fichar desde el chat, tablero de gerencia y tareas del operario.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const { default: ChatScreen } = await import("../app/components/screens/ChatScreen.jsx");
const { default: DashboardGerencia } = await import("../app/dashboard_gerencia.jsx");
const { default: ActividadScreen } = await import("../app/actividad_screen.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { ahoraArg } = await import("../app/lib/dates.js");

afterEach(() => cleanup());

Object.defineProperty(global.navigator, "geolocation", {
  configurable: true,
  value: { getCurrentPosition: (ok) => ok({ coords: { latitude: -31.42, longitude: -64.18, accuracy: 15 } }) },
});

// Servidor simulado: /api/fichar responde según `fichar`; /api/data devuelve vacío
function servidor({ fichar = () => ({ ok: true, hora: "08:01" }) } = {}) {
  const llamadas = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    const body = opts?.body ? JSON.parse(opts.body) : null;
    llamadas.push({ url: u, body });
    if (u.includes("/api/fichar")) return Response.json(fichar(body));
    if (u.includes("/api/data")) return Response.json({ ok: true, data: [], nextCursor: null });
    return Response.json({ ok: true });
  };
  return llamadas;
}

const OPERARIO = { id: "emp-1", legajo: 7, apodo: "Ana", nombre: "Ana Gómez", empresa_id: "e-1", rol: "operativo" };

// ── Chat ──

test("chat — 'Ya llegué' ficha la entrada con la ubicación y saluda", async () => {
  const llamadas = servidor();
  let recargas = 0;
  render(<ChatScreen usuario={OPERARIO} ctx={{}} reload={() => recargas++} onBack={() => {}} />);
  fireEvent.click(screen.getAllByText("Ya llegué")[0]);
  assert.ok(await screen.findByText(/Fichado! Buen día, Ana/));
  const f = llamadas.find((l) => l.url.includes("/api/fichar"));
  assert.equal(f.body.accion, "ingreso");
  assert.equal(f.body.geo_lat, -31.42);
  assert.equal(f.body.geo_precision, 15);
  assert.ok(recargas >= 1, "recarga los datos del inicio");
});

test("chat — si el servidor bloquea por tardanza, ofrece pedir permiso", async () => {
  servidor({ fichar: () => ({ ok: false, tipo: "bloqueado_tardanza", error: "Llegaste 40 min tarde" }) });
  render(<ChatScreen usuario={OPERARIO} ctx={{}} reload={() => {}} onBack={() => {}} />);
  fireEvent.click(screen.getAllByText("Ya llegué")[0]);
  assert.ok(await screen.findByText(/Llegaste 40 min tarde/));
  assert.ok(screen.getByText("✅ Sí, solicitar permiso"));
});

// ── Tablero de gerencia ──

test("tablero — presentes, ausentes y cumplimiento de hoy con los programados", async () => {
  servidor();
  const dia = ahoraArg().diaKey;
  const turno = { [dia]: { in: "08:00", out: "17:00" } };
  const ctx = {
    empleados: [
      { id: "1", legajo: 1, nombre: "Ana", rol: "operativo", activo: true, diagrama: turno, division: "produccion" },
      { id: "2", legajo: 2, nombre: "Luis", rol: "operativo", activo: true, diagrama: turno, division: "produccion" },
      { id: "3", legajo: 3, nombre: "Eva", rol: "operativo", activo: true, diagrama: turno, division: "produccion" },
      { id: "4", legajo: 4, nombre: "Franco", rol: "operativo", activo: true, diagrama: {}, division: "produccion" },
    ],
    // Ana y Luis ficharon; Franco trabaja fuera de su horario (no cuenta para el cumplimiento)
    fichadasHoy: [
      { legajo: 1, nombre: "Ana", ingreso: "08:00:00", division: "produccion" },
      { legajo: 2, nombre: "Luis", ingreso: "08:10:00", llegada_tarde: true, minutos_tarde: 10, division: "produccion" },
      { legajo: 4, nombre: "Franco", ingreso: "09:00:00", division: "produccion" },
    ],
    solicitudes: [], notificaciones: [],
  };
  render(
    <AuthContext.Provider value={{ divisiones: [], usuario: { rol: "gerencial" } }}>
      <DashboardGerencia goto={() => {}} ctx={ctx} reload={() => {}} logout={() => {}} empresa={{ id: "e-1", nombre: "Acme" }} />
    </AuthContext.Provider>
  );
  assert.ok(await screen.findByText("1 ausente hoy"));
  assert.ok(screen.getByText("3/3 hoy"), "3 presentes de 3 programados");
  assert.ok(screen.getByText("67%"), "cumplimiento: 2 de los 3 programados (Franco no infla el número)");
});

// ── Tareas del operario ──

const ETAPAS = [{ codigo: 1, nombre: "Corte", icon: "✂️", color: "#F00" }, { codigo: 2, nombre: "Armado", icon: "🔧", color: "#0F0" }];
const PROYECTOS = [{ ot: "1001", cliente: "Acme", proyecto: "Portón" }];

function pantalla(props = {}) {
  const llamadas = { iniciar: [], finalizar: 0 };
  render(
    <ActividadScreen
      tareaActiva={null} historial={[]} etapas={ETAPAS} proyectos={PROYECTOS} loading={false}
      usuario={{ id: "emp-1" }} empresa={{}} fichadaHoy={{ ingreso: "08:00:00" }}
      iniciarTarea={async (t) => { llamadas.iniciar.push(t); }}
      finalizarTarea={async () => { llamadas.finalizar++; }}
      cambiarTarea={async () => {}}
      {...props}
    />
  );
  return llamadas;
}

test("tareas — sin fichar la entrada no deja empezar", async () => {
  const llamadas = pantalla({ fichadaHoy: null });
  fireEvent.click(await screen.findByText(/Iniciar tarea/i));
  assert.ok(screen.getByText(/Debés fichar tu ingreso/));
  assert.equal(llamadas.iniciar.length, 0);
});

test("tareas — elegir etapa y OT inicia la tarea con esos datos", async () => {
  const llamadas = pantalla();
  fireEvent.click(await screen.findByText(/Iniciar tarea/i));
  fireEvent.click(screen.getByText("Armado"));
  fireEvent.click(screen.getByText("Acme"));
  fireEvent.click(screen.getByText("Siguiente →"));
  fireEvent.click(screen.getByText("▶ Iniciar"));
  await waitFor(() => assert.equal(llamadas.iniciar.length, 1));
  assert.deepEqual({ etapa: llamadas.iniciar[0].etapa, ot: String(llamadas.iniciar[0].codigo_proyecto) }, { etapa: 2, ot: "1001" });
});

test("tareas — con una tarea en curso, 'Finalizar jornada' la cierra", async () => {
  const llamadas = pantalla({ tareaActiva: { id: 9, etapa: 1, codigo_proyecto: "1001", hora_inicio: new Date(Date.now() - 600000).toISOString(), tipo: "N" } });
  fireEvent.click(await screen.findByText(/Finalizar jornada/));
  await waitFor(() => assert.equal(llamadas.finalizar, 1));
});
