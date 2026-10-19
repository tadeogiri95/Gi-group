// tests/menu-gestion.test.jsx — Reforma UX R5: menú nuevo de gestión.
// Inicio · Pedidos · Planta · Equipo · Más; "Más" es una lista de dos niveles
// como máximo, cada cosa en un solo lugar y según el rol.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { seccionesMas, conPlanta, esSupervisor, partirDestino } = await import("../app/lib/menuGestion.js");
const { getItems } = await import("../app/components/nav/BottomNav.jsx");
const { modulosEfectivos } = await import("../app/lib/modulos.js");
const { pasosActivacion } = await import("../app/lib/onboarding.js");
const { default: PlantaScreen } = await import("../app/components/screens/PlantaScreen.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");

afterEach(() => cleanup());

const PLANTA = { modulos: modulosEfectivos({ plan: "planta_15" }), plan_activo: "planta_15" };
const ASISTENCIA = { modulos: modulosEfectivos({ plan: "asistencia_15" }), plan_activo: "asistencia_15" };
const DUENO = { rol: "gerencial" };
const ADMIN = { rol: "administrativo" };
const SUPERVISOR = { rol: "administrativo", solo_su_division: true };
const ids = (opciones) => seccionesMas(opciones).map((s) => s.id);

test("barra de gestión — Planta solo si hay Tareas u OT; 'Más' reemplaza a 'Gestión'", () => {
  const labels = (modulos) => getItems("gerencial", 0, modulos).map((i) => i.label);
  assert.deepEqual(labels(PLANTA.modulos), ["Inicio", "Permisos", "Planta", "Equipo", "Más"]);
  assert.deepEqual(labels(ASISTENCIA.modulos), ["Inicio", "Permisos", "Equipo", "Más"]);
  assert.equal(conPlanta(PLANTA), true);
  assert.equal(conPlanta(ASISTENCIA), false);
});

test("Más — solo ajustes: lo del personal está en Equipo y lo de producción en Planta", () => {
  const todo = ids({ empresa: PLANTA, usuario: DUENO });
  assert.deepEqual(todo, ["ubicaciones", "asistencia", "reglas", "admin", "facturacion", "privacidad"]);
  for (const id of ["personal", "horarios", "calendario", "reportes", "documentacion"]) assert.ok(!todo.includes(id), id);
});

test("Más — sin Planta, las OT aparecen acá (con candado si no están en el plan)", () => {
  const secciones = seccionesMas({ empresa: ASISTENCIA, usuario: DUENO });
  const ot = secciones.find((s) => s.id === "proyectos");
  assert.ok(ot);
  assert.equal(ot.bloqueado, true);
});

test("Más — administración no ve facturación; el supervisor tampoco ve Empresa", () => {
  assert.ok(!ids({ empresa: PLANTA, usuario: ADMIN }).includes("facturacion"));
  assert.ok(ids({ empresa: PLANTA, usuario: ADMIN }).includes("admin"));
  const sup = ids({ empresa: PLANTA, usuario: SUPERVISOR });
  assert.ok(!sup.includes("admin") && !sup.includes("facturacion"));
  assert.equal(esSupervisor(SUPERVISOR), true);
  assert.equal(esSupervisor(ADMIN), false);
});

test("U-03 — las reglas de asistencia no quedan bloqueadas sin el Asistente", () => {
  const sinChat = { modulos: ["fichaje", "reportes", "calendario"] };
  const secciones = seccionesMas({ empresa: sinChat, usuario: DUENO });
  assert.equal(secciones.find((s) => s.id === "asistencia").bloqueado, false);
  assert.equal(secciones.find((s) => s.id === "reglas").bloqueado, true);
  const reglas = readFileSync(new URL("../app/components/screens/ReglasScreen.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(reglas, /ReglasAsistencia|TiposSolicitudConfig/);
  assert.match(reglas, /title: "¿Borrar la regla\?"/, "borrar una regla pide confirmación (U-20)");
});

test("U-12 — los primeros pasos abren la sección justa", () => {
  const ir = Object.fromEntries(pasosActivacion().map((p) => [p.id, p.ir]));
  assert.equal(ir.ubicacion, "config:ubicaciones");
  assert.equal(ir.horario, "equipo:horarios");
  assert.equal(ir.ot, "config:proyectos");
  assert.deepEqual(partirDestino("config:ubicaciones"), { pantalla: "config", seccion: "ubicaciones" });
  assert.deepEqual(partirDestino("equipo"), { pantalla: "equipo", seccion: null });
  const home = readFileSync(new URL("../app/[slug]/HomeContent.jsx", import.meta.url), "utf8");
  assert.match(home, /<DashboardGerencia goto=\{irA\}/);
  assert.match(home, /seccion=\{seccionMas\}/);
});

test("U-16 — Reportes muestra Producción (solo con el registro de tareas) y Obra con su módulo; la liquidación no al supervisor", () => {
  const src = readFileSync(new URL("../app/reportes_screen.jsx", import.meta.url), "utf8");
  assert.match(src, /ver\("produccion"\) && conRegistroTareas\(empresa\) && <Chip active=\{tab === "produccion"\}/);
  assert.match(src, /ver\("produccion"\) && tieneModulo\(empresa, "obra"\) && <Chip active=\{tab === "obra"\}/);
  assert.match(src, /ver\("personal"\) && !esSupervisor\(usuario\) && <Chip active=\{tab === "liquidacion"\}/);
});

test("Planta — sin el registro de tareas no hay 'En vivo'; lo que no está en el plan, con candado; abre en lo que tiene", async () => {
  global.fetch = async () => Response.json([]);
  render(
    <AuthContext.Provider value={{ divisiones: [], usuario: DUENO, empresa: {} }}>
      <PlantaScreen empresa={{ modulos: ["fichaje", "actividad"], plan_activo: "asistencia_15" }} usuario={DUENO} onVerPlanes={() => {}} />
    </AuthContext.Provider>
  );
  assert.equal(screen.queryByRole("tab", { name: /En vivo/ }), null);
  assert.ok(screen.getByRole("tab", { name: "OT 🔒" }));
  // Abre en lo primero que sí tiene: los reportes de producción
  assert.equal(screen.getByRole("tab", { name: "Reportes" }).getAttribute("aria-selected"), "true");
});

test("Equipo — Personas, Horarios, Calendario, Reportes y Documentos; abre en la pestaña pedida", async () => {
  const { default: EquipoScreen } = await import("../app/components/screens/EquipoScreen.jsx");
  render(<EquipoScreen empresa={{ modulos: ["fichaje"], plan_activo: "asistencia_15" }} usuario={DUENO} seccion="calendario" onVerPlanes={() => {}} />);
  const pestanas = screen.getAllByRole("tab").map((t) => t.textContent);
  assert.deepEqual(pestanas, ["Personas", "Horarios", "Calendario 🔒", "Reportes 🔒", "Documentos"]);
  assert.equal(screen.getByRole("tab", { name: "Calendario 🔒" }).getAttribute("aria-selected"), "true");
  const home = readFileSync(new URL("../app/[slug]/HomeContent.jsx", import.meta.url), "utf8");
  assert.match(home, /<EquipoScreen key=\{seccionMas \|\| "equipo"\} empresa=\{empresa\} usuario=\{u\} seccion=\{seccionMas\}/);
});

test("Reportes — Equipo muestra los del personal y Planta los de producción", async () => {
  const { default: ReportesScreen } = await import("../app/reportes_screen.jsx");
  global.fetch = async () => Response.json({ ok: true, data: [] });
  const empresa = { modulos: ["fichaje", "actividad", "reportes", "obra"] };
  const chips = () => screen.getAllByRole("button").map((b) => b.textContent).filter((t) => /^(📊|🗓️|⚙️|📈|⏱️|🏗️|📥|💰) /u.test(t));
  const conAuth = (grupo) => <AuthContext.Provider value={{ divisiones: [], usuario: { ...DUENO, empresa_id: "x" }, empresa }}><ReportesScreen grupo={grupo} /></AuthContext.Provider>;
  render(conAuth("personal"));
  assert.deepEqual(chips(), ["📊 Asistencia", "📥 Descargar", "💰 Liquidación"]);
  cleanup();
  render(conAuth("produccion"));
  assert.deepEqual(chips(), ["🗓️ Del día", "📈 Indicadores", "⏱️ Lead time", "🏗️ Obra"]);
  const planta = readFileSync(new URL("../app/components/screens/PlantaScreen.jsx", import.meta.url), "utf8");
  assert.match(planta, /\{ id: "reportes", label: "Reportes", modulo: "actividad" \}/);
  assert.match(planta, /<ReportesScreen grupo="produccion" \/>/);
});

// ─── Cerrar sesión (desde R9 el tablero no tiene el botón arriba) ───────────

test("Más — al final está 'Cerrar sesión' con quién entró, y también en 'Mi cuenta y privacidad'", async () => {
  const { default: CerrarSesion } = await import("../app/components/CerrarSesion.jsx");
  let salio = 0;
  const usuario = { rol: "administrativo", solo_su_division: true, apodo: "Carla" };
  render(
    <AuthContext.Provider value={{ logout: async () => { salio++; }, usuario }}>
      <CerrarSesion usuario={usuario} />
    </AuthContext.Provider>
  );
  assert.ok(screen.getByText("Carla"));
  assert.ok(screen.getByText(/Supervisor/));
  const boton = screen.getByRole("button", { name: /Cerrar sesión/ });
  assert.equal(boton.style.minHeight, "48px");
  fireEvent.click(boton);
  assert.equal(salio, 1);

  // Está en los dos lugares: al final de la lista de "Más" y en la sección de la cuenta
  const config = readFileSync(new URL("../app/components/screens/ConfigScreen.jsx", import.meta.url), "utf8");
  assert.equal((config.match(/<CerrarSesion usuario=\{usuario\} \/>/g) || []).length, 2);
  assert.match(config, /<CerrarSesion usuario=\{usuario\} \/>\s*<\/nav>/, "al final de la lista de Más");
});
