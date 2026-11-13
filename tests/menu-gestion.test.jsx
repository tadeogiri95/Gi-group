// tests/menu-gestion.test.jsx — Menú de gestión (reforma UX R5 y menú nuevo,
// parte 32): Inicio · Proyectos · Inventario · Mantenimiento · Más; "Más" es
// una lista de dos niveles como máximo, cada cosa en un solo lugar y según el rol.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { seccionesMas, conBoton, opcionesBoton, esSupervisor, comoDueno, partirDestino, GRUPOS } = await import("../app/lib/menuGestion.js");
const { getItems } = await import("../app/components/nav/BottomNav.jsx");
const { modulosEfectivos } = await import("../app/lib/modulos.js");
const { pasosActivacion } = await import("../app/lib/onboarding.js");
const { default: BotonGestionScreen } = await import("../app/components/screens/BotonGestionScreen.jsx");
const { default: ConfigScreen } = await import("../app/components/screens/ConfigScreen.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");

afterEach(() => cleanup());

const PLANTA = { modulos: modulosEfectivos({ plan: "planta_15" }), plan_activo: "planta_15" };
const ASISTENCIA = { modulos: modulosEfectivos({ plan: "asistencia_15" }), plan_activo: "asistencia_15" };
const DUENO = { rol: "gerencial" };
const ADMIN = { rol: "administrativo" };
const SUPERVISOR = { rol: "administrativo", solo_su_division: true };
const ids = (opciones) => seccionesMas(opciones).map((s) => s.id);

test("barra de gestión — Inicio · Producción · Materiales · Mantenimiento · Finanzas · Más; cada botón con sus módulos", () => {
  const labels = (modulos) => getItems("gerencial", 0, modulos).map((i) => i.label);
  assert.deepEqual(labels(PLANTA.modulos), ["Inicio", "Producción", "Materiales", "Mantenimiento", "Finanzas", "Más"]);
  // Finanzas es solo del Dueño: la oficina y el Supervisor no la ven en la barra
  assert.deepEqual(getItems("administrativo", 0, PLANTA.modulos).map((i) => i.label), ["Inicio", "Producción", "Materiales", "Mantenimiento", "Más"]);
  assert.deepEqual(labels(ASISTENCIA.modulos), ["Inicio", "Más"]);
  assert.equal(conBoton("proyectos", PLANTA), true);
  assert.equal(conBoton("proyectos", ASISTENCIA), false);
  // Lo apagado en Más → Módulos saca el botón entero si no le queda nada
  const sinInventario = PLANTA.modulos.filter((m) => m !== "stock" && m !== "compras");
  assert.deepEqual(labels(sinInventario), ["Inicio", "Producción", "Mantenimiento", "Finanzas", "Más"]);
  assert.deepEqual(labels(PLANTA.modulos.filter((m) => m !== "flota")), ["Inicio", "Producción", "Materiales", "Mantenimiento", "Finanzas", "Más"], "queda Maquinaria");
  assert.deepEqual(labels(PLANTA.modulos.filter((m) => m !== "flota" && m !== "maquinaria")), ["Inicio", "Producción", "Materiales", "Finanzas", "Más"]);
  assert.deepEqual(labels(PLANTA.modulos.filter((m) => m !== "finanzas")), ["Inicio", "Producción", "Materiales", "Mantenimiento", "Más"], "Finanzas apagada");
  // Los permisos pendientes se ven sobre "Más"
  assert.equal(getItems("gerencial", 3, PLANTA.modulos).find((i) => i.id === "config").badge, 3);
});

test("botones — Proyectos: OT y Reportes; Inventario: Stock y Compras; Mantenimiento: Flota vehicular", () => {
  const labels = (boton, empresa = PLANTA) => opcionesBoton(boton, empresa).map((o) => o.label);
  assert.deepEqual(labels("proyectos"), ["OT", "Reportes", "Instalaciones"]);
  assert.deepEqual(labels("inventario"), ["Stock", "Compras"]);
  assert.deepEqual(labels("mantenimiento"), ["Flota vehicular", "Maquinaria"]);
  // Los enlaces viejos a Planta van al botón nuevo
  assert.deepEqual(partirDestino("planta:compras"), { pantalla: "inventario", seccion: "compras" });
  assert.deepEqual(partirDestino("planta:flota"), { pantalla: "mantenimiento", seccion: "flota" });
  assert.deepEqual(partirDestino("planta"), { pantalla: "proyectos", seccion: null });
});

test("Más — agrupado por tema: Personas, Cómo trabaja la planta, Empresa y Tu cuenta (auditoría 01/11)", () => {
  const todo = ids({ empresa: PLANTA, usuario: DUENO });
  assert.deepEqual(todo, ["equipo", "permisos", "asistencia", "produccion", "planificacion", "planillas", "admin", "ubicaciones", "reglas", "modulos", "facturacion", "privacidad"]);
  for (const id of ["personal", "horarios", "calendario", "reportes", "documentacion"]) assert.ok(!todo.includes(id), id);
  const grupo = (id) => seccionesMas({ empresa: PLANTA, usuario: DUENO }).find((s) => s.id === id).grupo;
  assert.deepEqual(["produccion", "planificacion", "planillas"].map(grupo), ["planta", "planta", "planta"], "toda la configuración de la planta junta");
  assert.deepEqual(GRUPOS.map((g) => g.titulo), ["Personas", "Cómo trabaja la planta", "Empresa", "Tu cuenta"]);
  // Planificación solo el dueño; sin OT no hay planificación ni planillas
  assert.ok(!ids({ empresa: PLANTA, usuario: ADMIN }).includes("planificacion"));
  assert.ok(ids({ empresa: PLANTA, usuario: ADMIN }).includes("planillas"));
  const sinOt = ids({ empresa: ASISTENCIA, usuario: DUENO });
  assert.ok(!sinOt.includes("planificacion") && !sinOt.includes("planillas"));
});

test("Más → Producción y Datos y apariencia reparten las 12 pestañas de Empresa", async () => {
  const src = readFileSync(new URL("../app/admin_empresa_screen.js", import.meta.url), "utf8");
  for (const k of ["general", "apariencia", "logo"]) assert.match(src, new RegExp(`key: "${k}", label: "[^"]+", grupo: "empresa"`));
  for (const k of ["divisiones", "etapas", "rutas", "paradas", "liberacion", "carga", "instalacion", "defectos", "costo"]) assert.match(src, new RegExp(`key: "${k}", label: "[^"]+", grupo: "produccion"`));
  const cfg = readFileSync(new URL("../app/components/screens/ConfigScreen.jsx", import.meta.url), "utf8");
  assert.match(cfg, /id === "admin" +&& <AdminEmpresaScreen grupo="empresa"/);
  assert.match(cfg, /id === "produccion" +&& <AdminEmpresaScreen grupo="produccion"/);
  assert.match(cfg, /id === "planillas" +&& <PlanillasConectadas/);
  assert.match(cfg, /id === "planificacion" +&& <ParametrosPlanificacion/);
});

test("Planillas conectadas — los links salieron de OT y de Stock; desde ahí se llega con un botón", () => {
  const ot = readFileSync(new URL("../app/proyectos_screen.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(ot, /Guardar links|ConexionScript/);
  assert.match(ot, /onPlanillas/);
  const stock = readFileSync(new URL("../app/components/StockScreen.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(stock, /stock-inv|Guardar y sincronizar/);
  const mov = readFileSync(new URL("../app/components/MovimientosStock.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(mov, /<PlanillaMrpConexion/);
  const boton = readFileSync(new URL("../app/components/screens/BotonGestionScreen.jsx", import.meta.url), "utf8");
  assert.match(boton, /onIr\("config:planillas"\)/);
  assert.doesNotMatch(boton, /esSupervisor/, "el supervisor también configura planillas (05/11)");
  assert.deepEqual(partirDestino("config:planillas"), { pantalla: "config", seccion: "planillas" });
});

test("Más — Permisos y Equipo abren su pantalla; Permisos muestra los pendientes", () => {
  const ir = [];
  render(
    <AuthContext.Provider value={{ logout: async () => {}, usuario: DUENO, empresa: PLANTA }}>
      <ConfigScreen usuario={DUENO} empresa={PLANTA} onSeccion={() => {}} onIr={(p) => ir.push(p)} pendientes={2} />
    </AuthContext.Provider>
  );
  fireEvent.click(screen.getByRole("button", { name: /Permisos \(2 pendientes\)/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Equipo y horarios/ }));
  assert.deepEqual(ir, ["solicitudes", "equipo"]);
  const home = readFileSync(new URL("../app/[slug]/HomeContent.jsx", import.meta.url), "utf8");
  assert.match(home, /uIsGer && DESDE_MAS\.has\(screen\) \? "config" : screen/, "en Permisos y Equipo la barra marca Más");
  assert.match(home, /← Más/);
});

test("Más — sin Proyectos, las OT aparecen acá (con candado si no están en el plan)", () => {
  const secciones = seccionesMas({ empresa: ASISTENCIA, usuario: DUENO });
  const ot = secciones.find((s) => s.id === "proyectos");
  assert.ok(ot);
  assert.equal(ot.bloqueado, true);
});

test("Más — el supervisor ve lo mismo que el dueño menos facturación y Finanzas; administración, sin planificación", () => {
  assert.ok(!ids({ empresa: PLANTA, usuario: ADMIN }).includes("facturacion"));
  assert.ok(ids({ empresa: PLANTA, usuario: ADMIN }).includes("admin"));
  assert.ok(!ids({ empresa: PLANTA, usuario: ADMIN }).includes("planificacion"));
  const sup = ids({ empresa: PLANTA, usuario: SUPERVISOR });
  const dueno = ids({ empresa: PLANTA, usuario: DUENO });
  // Finanzas (171) es solo del Dueño: el Supervisor no entra (09/11)
  assert.deepEqual(sup, dueno.filter((id) => id !== "facturacion" && id !== "finanzas"));
  for (const id of ["admin", "produccion", "planillas", "modulos", "planificacion"]) assert.ok(sup.includes(id), id);
  assert.equal(esSupervisor(SUPERVISOR), true);
  assert.equal(esSupervisor(ADMIN), false);
  assert.equal(comoDueno(SUPERVISOR), true);
  assert.equal(comoDueno(ADMIN), false);
  assert.equal(comoDueno(DUENO), true);
  const pestanas = (u) => opcionesBoton("proyectos", PLANTA, u).map((o) => o.id);
  assert.ok(pestanas(SUPERVISOR).includes("planificacion"));
  assert.ok(!pestanas(ADMIN).includes("planificacion"));
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
  assert.equal(ir.ot, "proyectos:ot");
  assert.deepEqual(partirDestino("config:ubicaciones"), { pantalla: "config", seccion: "ubicaciones" });
  assert.deepEqual(partirDestino("equipo"), { pantalla: "equipo", seccion: null });
  const home = readFileSync(new URL("../app/[slug]/HomeContent.jsx", import.meta.url), "utf8");
  assert.match(home, /<DashboardGerencia goto=\{irA\}/);
  assert.match(home, /seccion=\{seccionMas\}/);
});

test("U-16 — Reportes muestra Producción (solo con el registro de tareas) y Obra con su módulo; la liquidación también al supervisor", () => {
  const src = readFileSync(new URL("../app/reportes_screen.jsx", import.meta.url), "utf8");
  assert.match(src, /ver\("produccion"\) && conRegistroTareas\(empresa\) && <Chip active=\{tab === "produccion"\}/);
  assert.match(src, /ver\("produccion"\) && tieneModulo\(empresa, "obra"\) && <Chip active=\{tab === "obra"\}/);
  assert.match(src, /ver\("personal"\) && <Chip active=\{tab === "liquidacion"\}/);
});

test("Proyectos — sin el registro de tareas no hay 'En vivo'; lo que no está en el plan, con candado; abre en lo que tiene", async () => {
  global.fetch = async () => Response.json([]);
  render(
    <AuthContext.Provider value={{ divisiones: [], usuario: DUENO, empresa: {} }}>
      <BotonGestionScreen boton="proyectos" empresa={{ modulos: ["fichaje", "actividad"], plan_activo: "asistencia_15" }} usuario={DUENO} onVerPlanes={() => {}} />
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

test("Reportes — Equipo muestra los del personal y Proyectos los de producción", async () => {
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
  const menu = readFileSync(new URL("../app/lib/menuGestion.js", import.meta.url), "utf8");
  assert.match(menu, /\{ id: "reportes", label: "Reportes", modulo: "actividad" \}/);
  const pantalla = readFileSync(new URL("../app/components/screens/BotonGestionScreen.jsx", import.meta.url), "utf8");
  assert.match(pantalla, /<ReportesScreen grupo="produccion" \/>/);
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

test("Módulos — lo que la empresa apagó no aparece (ni con candado); lo no contratado sí, con candado", async () => {
  const apagada = { ...PLANTA, modulos: (PLANTA.modulos || []).filter((m) => !["flota", "maquinaria", "calendario"].includes(m)), modulos_apagados: ["flota", "maquinaria", "calendario"] };
  assert.ok(!opcionesBoton("mantenimiento", apagada).some((o) => o.id === "flota"));
  assert.ok(opcionesBoton("mantenimiento", PLANTA).some((o) => o.id === "flota"));
  assert.equal(conBoton("mantenimiento", apagada), false);
  assert.ok(ids({ empresa: PLANTA, usuario: DUENO }).includes("modulos"));
  assert.ok(ids({ empresa: PLANTA, usuario: SUPERVISOR }).includes("modulos"));
});
