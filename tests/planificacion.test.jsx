// tests/planificacion.test.jsx — Planificación de la producción, parte 38
// (migración 137; diseño en notes/diseno-planificacion-produccion.md):
// parámetros de la planta y prioridad manual de las OT, que gerencia ordena
// arrastrándolas en una lista.
import "./helpers/domSetup.js";
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import {
  normalizarParametros, leerNumero, errorParametro, PARAMETROS, parametrosFaltantes,
  divisionPlan, etapasPlanDe, otsPlanificables, ordenarPorPrioridad, buscarOts, tildarTodas, moverOt, quitarPrioridad, cambiosPrioridad,
} from "../app/lib/planificacion.js";
import { opcionesBoton } from "../app/lib/menuGestion.js";

const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { default: PlanificacionScreen } = await import("../app/components/PlanificacionScreen.jsx");

afterEach(() => cleanup());

const DIVISIONES = [
  { id: "d-m", clave: "MUE", label: "Muebles", ruta_etapas: [1, 2, 3, 4, 5] },
  { id: "d-h", clave: "HER", label: "Herrería" },
];
const ETAPAS = [
  { codigo: 0, nombre: "Parado" },
  { codigo: 1, nombre: "Corte / Seccionado", icon: "✂️" },
  { codigo: 2, nombre: "Canteado" },
  { codigo: 3, nombre: "Mecanizado CNC" },
  { codigo: 4, nombre: "Armado y embalaje" },
  { codigo: 5, nombre: "Pintura" },
];
const OT = (id, ot, extra = {}) => ({ id, ot, cliente: `Cliente ${id}`, division: "MUEBLES ", estado: "activo", prioridad: null, ...extra });

test("leerNumero y errorParametro — coma decimal, rangos y enteros", () => {
  assert.equal(leerNumero("0,5"), 0.5);
  assert.equal(leerNumero("1.200"), 1200);
  assert.equal(leerNumero("abc"), null);
  assert.equal(leerNumero(""), null);
  const eficiencia = PARAMETROS.find((p) => p.id === "eficiencia");
  assert.equal(errorParametro(eficiencia, 85), null);
  assert.equal(errorParametro(eficiencia, 120), "Entre 1 y 100");
  assert.equal(errorParametro(PARAMETROS.find((p) => p.id === "maquinas_cnc"), 1.5), "Sin decimales");
});

test("normalizarParametros — vienen 1 seccionadora, 2 CNC y canteadora con 2 personas que tarda la mitad", () => {
  const p = normalizarParametros(null);
  assert.equal(p.maquinas_corte, 1);
  assert.equal(p.maquinas_cnc, 2);
  assert.equal(p.personas_canteadora, 2);
  assert.equal(p.pct_tiempo_canteadora_2, 50);
  assert.equal(p.min_placa, null);
  assert.equal(p.eficiencia, null);
  // Lo inválido queda vacío
  assert.equal(normalizarParametros({ eficiencia: 300, min_placa: 12 }).eficiencia, null);
  assert.equal(normalizarParametros({ eficiencia: 300, min_placa: 12 }).min_placa, 12);
  assert.ok(parametrosFaltantes(p).includes("Factor de eficiencia"));
});

test("divisionPlan y etapasPlanDe — reconoce Muebles y une las etapas por nombre", () => {
  assert.equal(divisionPlan(DIVISIONES, null).id, "d-m");
  assert.equal(divisionPlan(DIVISIONES, "d-h").id, "d-h");
  assert.deepEqual(etapasPlanDe(ETAPAS, DIVISIONES[0]), { corte: 1, canteado: 2, mecanizado: 3, armado: 4 });
  // Lo elegido a mano gana
  assert.equal(etapasPlanDe(ETAPAS, DIVISIONES[0], { armado: 5 }).armado, 5);
});

test("otsPlanificables y orden — solo abiertas de Muebles; primero la prioridad manual, después la semana", () => {
  const ots = [
    OT(1, "M-7100", { fecha_objetivo: "2026-11-07" }),
    OT(2, "M-7200", { fecha_objetivo: "2026-10-31" }),
    OT(3, "M-7300", { prioridad: 1, fecha_objetivo: "2026-12-05" }),
    OT(4, "M-7400"),
    OT(5, "H-800", { division: "HERRERÍA" }),
    OT(6, "M-7500", { terminado_planilla: true }),
    OT(7, "M-7600", { estado: "cerrado" }),
  ];
  const lista = ordenarPorPrioridad(otsPlanificables(ots, DIVISIONES, DIVISIONES[0]));
  assert.deepEqual(lista.map((p) => p.ot), ["M-7300", "M-7200", "M-7100", "M-7400"]);
});

test("moverOt — quedan ordenadas a mano hasta donde cayó; las de abajo siguen por semana", () => {
  const lista = [OT(1, "A"), OT(2, "B"), OT(3, "C"), OT(4, "D")];
  // C pasa arriba de todo: solo C queda con prioridad
  const una = moverOt(lista, 2, 0);
  assert.deepEqual(una.map((p) => [p.ot, p.prioridad]), [["C", 1], ["A", null], ["B", null], ["D", null]]);
  // D va al segundo lugar: C 1, D 2
  const dos = moverOt(una, 3, 1);
  assert.deepEqual(dos.map((p) => [p.ot, p.prioridad]), [["C", 1], ["D", 2], ["A", null], ["B", null]]);
  // B sube al tercer lugar: quedan 3 ordenadas (C, D, B) y A sigue por semana
  const tres = moverOt(dos, 3, 2);
  assert.deepEqual(tres.map((p) => [p.ot, p.prioridad]), [["C", 1], ["D", 2], ["B", 3], ["A", null]]);
  assert.deepEqual(cambiosPrioridad(dos, tres), [{ id: 2, prioridad: 3 }]);
  // Quitar la prioridad de D: C 1, B 2 y D vuelve con las de semana
  const sinD = quitarPrioridad(tres, 4);
  assert.deepEqual(sinD.map((p) => [p.ot, p.prioridad]), [["C", 1], ["B", 2], ["A", null], ["D", null]]);
});

test("menú — Planificación está en Proyectos solo para gerencia", () => {
  const empresa = { modulos: ["proyectos", "actividad"], plan: "pro" };
  assert.ok(opcionesBoton("proyectos", empresa, { rol: "gerencial" }).some((o) => o.id === "planificacion"));
  assert.ok(!opcionesBoton("proyectos", empresa, { rol: "administrativo" }).some((o) => o.id === "planificacion"));
  assert.ok(!opcionesBoton("proyectos", empresa).some((o) => o.id === "planificacion"));
});

function mockData({ proyectos = [], cfg = [], empleados = [] } = {}) {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    pedidos.push(body);
    const path = body.path || "";
    if (body.method === "GET" && path.startsWith("proyectos")) return new Response(JSON.stringify({ data: path.includes("offset=0") ? proyectos : [] }), { status: 200 });
    if (body.method === "GET" && path.startsWith("config_sistema")) return new Response(JSON.stringify({ data: cfg }), { status: 200 });
    if (body.method === "GET" && path.startsWith("empleados")) return new Response(JSON.stringify({ data: path.includes("offset=0") ? empleados : [] }), { status: 200 });
    return new Response(JSON.stringify({ data: null }), { status: 200 });
  };
  return pedidos;
}

const pantalla = () => render(
  <AuthContext.Provider value={{ divisiones: DIVISIONES, etapas: ETAPAS, usuario: { rol: "gerencial" } }}>
    <PlanificacionScreen empresaId="emp-1" />
  </AuthContext.Provider>
);

test("📌 Prioridad — lista ordenada y ▲ guarda la prioridad nueva", async () => {
  const pedidos = mockData({ proyectos: [
    OT(1, "M-7100", { fecha_objetivo: "2026-10-31", semana_objetivo: 44, placas: 21.8 }),
    OT(2, "M-7200", { fecha_objetivo: "2026-11-07", semana_objetivo: 45 }),
    OT(3, "H-800", { division: "HERRERÍA" }),
  ] });
  pantalla();
  fireEvent.click(await screen.findByText("📌 Prioridad"));
  const lista = await screen.findByRole("region", { name: "Prioridad de las OT" });
  const filas = within(lista).getAllByRole("listitem");
  assert.deepEqual(filas.map((f) => f.getAttribute("aria-label")), ["OT M-7100", "OT M-7200"]);
  assert.match(filas[0].textContent, /S44 \(31\/10\)/);
  assert.match(filas[0].textContent, /Placas 18 21,8/);
  fireEvent.click(screen.getByLabelText("Subir OT M-7200"));
  await screen.findByText("✅ Prioridad guardada");
  const patch = pedidos.filter((p) => p.method === "PATCH");
  assert.deepEqual(patch.map((p) => [p.path, p.body]), [["proyectos?id=eq.2", { prioridad: 1 }]]);
  assert.deepEqual(within(lista).getAllByRole("listitem").map((f) => f.getAttribute("aria-label")), ["OT M-7200", "OT M-7100"]);
  assert.ok(screen.getByLabelText("Quitar prioridad de la OT M-7200"));
});

test("📌 Prioridad — sin la migración 137 avisa qué falta y no deja ordenar", async () => {
  mockData({ proyectos: [{ id: 1, ot: "M-1", division: "Muebles", estado: "activo" }, { id: 2, ot: "M-2", division: "Muebles", estado: "activo" }] });
  pantalla();
  fireEvent.click(await screen.findByText("📌 Prioridad"));
  assert.ok(await screen.findByText(/falta correr la migración 137/));
  assert.equal(screen.getByLabelText("Bajar OT M-1").disabled, true);
});

test("⚙ Parámetros — valida, une las etapas y guarda en config_sistema", async () => {
  const pedidos = mockData({ cfg: [] });
  pantalla();
  fireEvent.click(await screen.findByText("⚙ Parámetros"));
  const form = await screen.findByRole("region", { name: "Parámetros de la planificación" });
  assert.equal(within(form).getByLabelText(/^CNC/).value, "2");
  assert.equal(within(form).getByLabelText("Corte es la etapa…").value, "1");
  assert.equal(within(form).getByLabelText("Armado es la etapa…").value, "4");
  fireEvent.change(within(form).getByLabelText(/^Factor de eficiencia/), { target: { value: "150" } });
  assert.ok(within(form).getByText("Entre 1 y 100"));
  assert.equal(screen.getByText("Guardar parámetros").disabled, true);
  fireEvent.change(within(form).getByLabelText(/^Factor de eficiencia/), { target: { value: "85" } });
  fireEvent.change(within(form).getByLabelText(/^Tiempo de corte por placa/), { target: { value: "12,5" } });
  fireEvent.click(screen.getByText("Guardar parámetros"));
  await screen.findByText("✅ Parámetros guardados");
  const post = pedidos.find((p) => p.method === "POST");
  assert.equal(post.path, "config_sistema");
  assert.equal(post.body.clave, "planificacion");
  assert.equal(post.body.valor.eficiencia, 85);
  assert.equal(post.body.valor.min_placa, 12.5);
  assert.equal(post.body.valor.maquinas_cnc, 2);
  assert.equal(post.body.valor.division_id, "d-m");
  assert.deepEqual(post.body.valor.etapas, { corte: 1, canteado: 2, mecanizado: 3, armado: 4 });
});

test("⚙ Parámetros — si ya estaban guardados los actualiza", async () => {
  const pedidos = mockData({ cfg: [{ clave: "planificacion", valor: { eficiencia: 80, min_placa: 10 } }] });
  pantalla();
  fireEvent.click(await screen.findByText("⚙ Parámetros"));
  const form = await screen.findByRole("region", { name: "Parámetros de la planificación" });
  assert.equal(within(form).getByLabelText(/^Factor de eficiencia/).value, "80");
  fireEvent.click(screen.getByText("Guardar parámetros"));
  await waitFor(() => assert.ok(pedidos.some((p) => p.method === "PATCH" && p.path === "config_sistema?clave=eq.planificacion")));
});

// ─── Parte 39: carga y capacidad ────────────────────────────────────────────
const { periodo, diasDelPeriodo, operariosDePlanta, capacidadPlanta, horasOt, cargaPeriodo, pendienteEtapa, preseleccion, modulosPorOt, fmtH } = await import("../app/lib/cargaPlanta.js");

const PARAMS = normalizarParametros({
  min_placa: 10, min_metro_canto: 1, min_mecanizado: 15, min_armado_gabinete: 60, eficiencia: 80,
  modo_mecanizado: "porcentaje", pct_mecanizado: 50, por_tipo: { global: { mec: 1, gab: 0.5 } }, etapas: { corte: 1, canteado: 2, mecanizado: 3, armado: 4 },
});
const LV = { in: "08:00", out: "17:00" };
const HORARIO = { lun: LV, mar: LV, mie: LV, jue: LV, vie: LV, sab: null, dom: null };
const EMPLEADOS = [
  { id: "e1", rol: "operativo", division: "Muebles", diagrama: HORARIO },
  { id: "e2", rol: "operativo", division: "MUE", diagrama: HORARIO },
  { id: "e3", rol: "operativo", division: "Muebles", diagrama: HORARIO, es_instalador: true },
  { id: "e4", rol: "operativo", division: "Herrería", diagrama: HORARIO },
  { id: "e5", rol: "gerencial", division: "Muebles", diagrama: HORARIO },
  { id: "e6", rol: "operativo", division: "Muebles", diagrama: HORARIO, activo: false },
];
const OT_A = { id: 1, ot: "M-7473", placas: 10, fondos: 2, metros_canto: 120, placas_mecanizadas: null, total_modulos: 4 };

test("periodo — semana de domingo o de lunes, y mes corrido", () => {
  assert.deepEqual(periodo("semana", "2026-10-28"), { tipo: "semana", desde: "2026-10-25", hasta: "2026-10-31" });
  assert.deepEqual(periodo("semana", "2026-10-28", 0, "semana_lunes"), { tipo: "semana", desde: "2026-10-26", hasta: "2026-11-01" });
  assert.deepEqual(periodo("semana", "2026-10-28", 1), { tipo: "semana", desde: "2026-11-01", hasta: "2026-11-07" });
  assert.deepEqual(periodo("mes", "2026-12-15", 1), { tipo: "mes", desde: "2027-01-01", hasta: "2027-01-31" });
  assert.equal(diasDelPeriodo("2026-10-25", "2026-10-31").length, 7);
});

test("capacidad — horario de los operarios de Muebles que no instalan; la planta abierta limita a las máquinas", () => {
  const ops = operariosDePlanta(EMPLEADOS, DIVISIONES, DIVISIONES[0]);
  assert.deepEqual(ops.map((e) => e.id), ["e1", "e2"]);
  const cap = capacidadPlanta(ops, diasDelPeriodo("2026-10-25", "2026-10-31"));
  assert.equal(cap.gente, 90);   // 2 personas × 5 días × 9 h
  assert.equal(cap.maquina, 45); // 5 días × 9 h abiertos
  // Turno que cruza la medianoche
  const noche = capacidadPlanta([{ diagrama: { lun: { in: "22:00", out: "06:00" } } }], ["2026-10-26"]);
  assert.equal(noche.gente, 8);
});

test("horasOt — placas + fondos, cantos con 2 personas, % mecanizado y módulos de la OT", () => {
  const h = horasOt(OT_A, PARAMS);
  assert.equal(h.placas, 12);
  assert.equal(h.etapas.corte.gente, 2);          // 12 × 10 min
  assert.equal(h.etapas.canteado.maquina, 1);     // 120 m × 1 min × 50 %
  assert.equal(h.etapas.canteado.gente, 2);       // ocupa a las 2 personas
  assert.equal(h.etapas.mecanizado.gente, 1.5);   // 50 % de 12 = 6 × 15 min
  assert.equal(h.etapas.armado.gente, 4);         // 4 módulos × 60 min
  assert.equal(h.origenGabinetes, "modulos");
  assert.equal(h.total, 9.5);
  // Sin módulos: las etiquetas de módulo, y si no, placas × gabinetes por placa
  assert.equal(horasOt({ ...OT_A, total_modulos: null }, PARAMS, { modulosEtiquetas: 3 }).gabinetes, 3);
  assert.equal(horasOt({ ...OT_A, total_modulos: null }, PARAMS).gabinetes, 6);
  // MECANIZADOS de la planilla gana al %
  assert.equal(horasOt({ ...OT_A, placas_mecanizadas: 2 }, PARAMS).etapas.mecanizado.gente, 0.5);
  assert.equal(horasOt({ id: 2, ot: "M-1" }, PARAMS).sinDatos, true);
});

test("horasOt — solo lo que falta: etapa terminada no suma y la escaneada suma lo que queda", () => {
  const avance = [{ ot: "M-7473", etapa: 1, estado: "terminada" }];
  const piezas = [{ ot: "M-7473", etapa: 2, total: 10, pasaron: 5 }];
  assert.equal(pendienteEtapa({ ot: "M-7473", codigo: 1, avance }), 0);
  const h = horasOt(OT_A, PARAMS, { avance, piezas });
  assert.equal(h.etapas.corte.gente, 0);
  assert.equal(h.etapas.canteado.gente, 1);
  assert.equal(h.total, 6.5);
});

test("cargaPeriodo — entra; y si no entra, horas extra, cuello de botella y máquina que falta", () => {
  const ops = operariosDePlanta(EMPLEADOS, DIVISIONES, DIVISIONES[0]);
  const cap = capacidadPlanta(ops, diasDelPeriodo("2026-10-25", "2026-10-31"));
  const ok = cargaPeriodo({ ots: [horasOt(OT_A, PARAMS)], params: PARAMS, capacidad: cap });
  assert.equal(ok.viable, true);
  assert.equal(ok.necesarias, 9.5 / 0.8);
  assert.equal(ok.extra, 0);
  // 1 operario, 1 día de 2 h
  const chica = capacidadPlanta([{ diagrama: { lun: { in: "08:00", out: "10:00" } } }], ["2026-10-26"]);
  const no = cargaPeriodo({ ots: [horasOt(OT_A, PARAMS)], params: PARAMS, capacidad: chica });
  assert.equal(no.viable, false);
  assert.equal(no.extra, 9.5 / 0.8 - 2);
  assert.equal(no.cuello.id, "gente");
  const sec = no.maquinas.find((m) => m.id === "corte");
  assert.equal(sec.extra, 0.5);                    // 2,5 h de seccionadora y 2 h abiertas
  assert.equal(no.maquinas.find((m) => m.id === "mecanizado").extra, 0); // 2 CNC
});

test("preseleccion, modulosPorOt y fmtH", () => {
  const ots = [{ id: 1, fecha_objetivo: "2026-10-31" }, { id: 2, fecha_objetivo: "2026-10-10" }, { id: 3, fecha_objetivo: "2026-11-07" }, { id: 4 }];
  assert.deepEqual([...preseleccion(ots, "2026-10-31")], [1, 2]);
  assert.equal(modulosPorOt([{ ot: "7", modulo: "M.izq" }, { ot: "7", modulo: "m.izq" }, { ot: "7", modulo: "BAST" }, { ot: "8", modulo: "" }]).get("7"), 2);
  assert.equal(fmtH(12.46), "12,5 h");
});

function mockCarga({ proyectos, empleados, cfg }) {
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    const path = body.path || "";
    const lista = (data) => new Response(JSON.stringify({ data: path.includes("offset=0") || !path.includes("offset=") ? data : [] }), { status: 200 });
    if (path.startsWith("proyectos")) return lista(proyectos);
    if (path.startsWith("empleados")) return lista(empleados);
    if (path.startsWith("config_sistema") && path.includes("clave=eq.planificacion")) return lista(cfg);
    return lista([]);
  };
}

// Hoy fijo: lunes 26/10/2026 a las 12 (Argentina). Solo se finge la fecha.
function lunes26() {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-26T15:00:00Z") });
}
afterEach(() => mock.timers.reset());

test("📊 Carga — vienen tildadas las OT con semana; la semana elegida muestra su parte del plan", async () => {
  lunes26();
  mockCarga({
    proyectos: [
      OT(1, "M-7473", { ...OT_A, division: "Muebles", estado: "activo", fecha_objetivo: "2020-01-04", semana_objetivo: 1 }),
      OT(2, "M-9000", { division: "Muebles", placas: 1 }),
    ],
    // Un solo operario 2 h los lunes: la OT tarda varias semanas
    empleados: [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "10:00" } } }],
    cfg: [{ valor: { ...PARAMS } }],
  });
  pantalla();
  const carga = await screen.findByRole("region", { name: "Carga de la planta" });
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  assert.equal(screen.getByLabelText("Planificar OT M-9000").checked, false, "sin semana no viene tildada");
  // La semana muestra solo lo que el plan pone en ella: las 2 h del lunes
  assert.match(carga.textContent, /Lo que el plan pone del 26\/10\/2026 al 31\/10\/2026/);
  assert.match(carga.textContent, /✅ Entra en el período/);
  assert.match(within(carga).getByLabelText("Horas de gente").textContent, /Necesita2 hDisponible2 h/);
  assert.ok(within(within(carga).getByLabelText("Horas de máquina")).getByText("Seccionadora"));
  // El plan sigue semanas hacia adelante y marca la OT atrasada
  const plan = within(carga).getByLabelText("Resumen del plan");
  assert.match(plan.textContent, /El plan va del 26\/10\/2026 al/);
  assert.match(plan.textContent, /🔴 No llegan a su semanaM-7473: su semana terminó el 4\/1\/2020; termina el/);
  // Cambiar de semana no destilda: muestra la parte del plan de esa semana
  fireEvent.click(screen.getByLabelText("Período siguiente"));
  assert.match(carga.textContent, /Lo que el plan pone del 1\/11\/2026 al 7\/11\/2026/);
  assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true);
  fireEvent.click(screen.getByLabelText("Período anterior"));
  fireEvent.click(screen.getByLabelText("Período anterior"));
  assert.match(carga.textContent, /Ese período ya pasó/);
  fireEvent.click(screen.getByLabelText("Planificar OT M-7473"));
  assert.match(carga.textContent, /Elegí las OT que querés planificar/);
});

test("📊 Carga — switch: según fechas objetivo pide horas extra por semana; según capacidad da la fecha estimada", async () => {
  lunes26();
  mockCarga({
    // 11,9 h de reloj que tienen que estar el sábado 31/10
    proyectos: [OT(1, "M-7473", { ...OT_A, division: "Muebles", estado: "activo", fecha_objetivo: "2026-10-31", semana_objetivo: 44 })],
    empleados: [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "10:00" }, mar: { in: "08:00", out: "10:00" }, mie: { in: "08:00", out: "10:00" }, jue: { in: "08:00", out: "10:00" }, vie: { in: "08:00", out: "10:00" } } }],
    cfg: [{ valor: { ...PARAMS } }],
  });
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  const resumen = () => screen.getByLabelText("Resumen del plan");
  assert.match(within(resumen()).getByLabelText("Horas extra por semana").textContent, /Semana del 25\/10\/2026: .* h \(sáb\.? 31\/10\/2026\)/);
  assert.match(screen.getByLabelText("Carga de la planta").textContent, /❌ No entra con el horario normal/);
  fireEvent.click(screen.getByText("🏭 Según capacidad de la planta"));
  assert.equal(within(resumen()).queryByLabelText("Horas extra por semana"), null);
  assert.match(resumen().textContent, /🔴 Terminan después de su semanaM-7473: semana hasta el 31\/10\/2026; termina el \d+\/11\/2026/);
  assert.match(screen.getByLabelText("Carga de la planta").textContent, /✅ Entra en el período/);
});

test("buscarOts y tildarTodas — busca sin tildes por número, cliente o proyecto; tilda o destilda solo las de la lista", () => {
  const ots = [OT(1, "M-7473", { cliente: "Riofrío" }), OT(2, "M-7858", { cliente: "CEVT", proyecto: "Oficinas Córdoba" }), OT(3, "M-9000")];
  assert.deepEqual(buscarOts(ots, "  ").map((p) => p.id), [1, 2, 3]);
  assert.deepEqual(buscarOts(ots, "riofrio").map((p) => p.id), [1]);
  assert.deepEqual(buscarOts(ots, "cordoba cevt").map((p) => p.id), [2]);
  assert.deepEqual(buscarOts(ots, "78").map((p) => p.id), [2]);
  // Con una tildada fuera de la lista: tildar todas suma las de la lista y no toca la otra
  const una = tildarTodas(new Set([3]), ots.slice(0, 2));
  assert.deepEqual([...una].sort(), [1, 2, 3]);
  assert.deepEqual([...tildarTodas(una, ots.slice(0, 2))], [3], "si ya estaban todas, las destilda");
});

test("📊 Carga — buscador de OT y botón para tildar o destildar todas", async () => {
  mockCarga({
    proyectos: [
      OT(1, "M-7473", { ...OT_A, cliente: "Riofrío", division: "Muebles", estado: "activo", fecha_objetivo: "2020-01-04", semana_objetivo: 1 }),
      OT(2, "M-9000", { cliente: "CEVT", division: "Muebles", placas: 1 }),
      OT(3, "M-9100", { cliente: "CEVT", division: "Muebles", placas: 1 }),
    ],
    empleados: [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "10:00" } } }],
    cfg: [{ valor: { ...PARAMS } }],
  });
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  assert.match(screen.getByText(/OT tildadas? de 3/).textContent, /1 OT tildada de 3/);
  fireEvent.change(screen.getByLabelText("Buscar OT"), { target: { value: "cevt" } });
  assert.equal(screen.queryByLabelText("Planificar OT M-7473"), null, "la que no coincide no se ve");
  assert.match(screen.getByText(/coinciden con la búsqueda/).textContent, /2 coinciden/);
  fireEvent.click(screen.getByText("Tildar todas"));
  assert.equal(screen.getByLabelText("Planificar OT M-9000").checked, true);
  assert.equal(screen.getByLabelText("Planificar OT M-9100").checked, true);
  assert.match(screen.getByText(/OT tildadas de 3/).textContent, /3 OT tildadas de 3/);
  fireEvent.click(screen.getByText("Destildar todas"));
  assert.equal(screen.getByLabelText("Planificar OT M-9000").checked, false);
  // Sin búsqueda: la M-7473 siguió tildada
  fireEvent.change(screen.getByLabelText("Buscar OT"), { target: { value: "" } });
  assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true);
  fireEvent.click(screen.getByText("Tildar todas"));
  fireEvent.click(screen.getByText("Destildar todas"));
  assert.ok(["M-7473", "M-9000", "M-9100"].every((ot) => !screen.getByLabelText(`Planificar OT ${ot}`).checked));
  fireEvent.change(screen.getByLabelText("Buscar OT"), { target: { value: "zzz" } });
  assert.ok(screen.getByText("Ninguna OT coincide con “zzz”."));
});

test("📊 Carga — sin parámetros avisa qué falta cargar", async () => {
  mockCarga({ proyectos: [], empleados: [], cfg: [] });
  pantalla();
  assert.ok(await screen.findByText("Faltan parámetros"));
  fireEvent.click(screen.getByText("Cargar parámetros"));
  assert.ok(await screen.findByRole("region", { name: "Parámetros de la planificación" }));
});

// ─── Parte 40: orden automático y Gantt ─────────────────────────────────────
const { planAutomatico, celdasGantt, pendientesPorOt } = await import("../app/lib/planAutomatico.js");

// Semana del 25/10 (domingo) al 31/10 (sábado); 1 operario 8 h de lunes a viernes, eficiencia 100 %
const P100 = normalizarParametros({ ...PARAMS, eficiencia: 100 });
const UNO = [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "16:00" }, mar: { in: "08:00", out: "16:00" }, mie: { in: "08:00", out: "16:00" }, jue: { in: "08:00", out: "16:00" }, vie: { in: "08:00", out: "16:00" } } }];
const SEMANA = diasDelPeriodo("2026-10-25", "2026-10-31");
const trabajo = (id, ot, horas) => ({ id, ot, etapas: Object.fromEntries(["corte", "canteado", "mecanizado", "armado"].map((e) => [e, { gente: horas[e] || 0, maquina: horas[e] || 0 }])) });

test("planAutomatico — etapas en orden, la de más prioridad primero, sin horas extra si entra", () => {
  const cap = capacidadPlanta(UNO, SEMANA);
  const plan = planAutomatico({ trabajos: [trabajo(1, "A", { corte: 6, armado: 4 }), trabajo(2, "B", { corte: 4 })], capacidad: cap, params: P100 });
  assert.deepEqual(plan.pendientes, []);
  assert.deepEqual(plan.diasExtra, []);
  // Lunes: A corte 6 h y empieza su armado (2 h). Martes: termina A (2 h) y B corta 4 h
  const lun = plan.segmentos.filter((s) => s.fecha === "2026-10-26").map((s) => [s.ot, s.etapa, s.gente]);
  assert.deepEqual(lun, [["A", "corte", 6], ["A", "armado", 2]]);
  const mar = plan.segmentos.filter((s) => s.fecha === "2026-10-27").map((s) => [s.ot, s.etapa, s.gente]);
  assert.deepEqual(mar, [["A", "armado", 2], ["B", "corte", 4]]);
  assert.equal(plan.finPorOt.get(1), "2026-10-27");
  assert.equal(plan.porDia.find((d) => d.fecha === "2026-10-26").usadas, 8);
});

test("planAutomatico — la máquina limita aunque sobre gente; con 2 personas la canteadora gasta el doble de gente", () => {
  const dos = [UNO[0], { ...UNO[0], id: "e2" }];
  const cap = capacidadPlanta(dos, ["2026-10-26"]); // 16 h de gente, 8 h abierta
  const plan = planAutomatico({ trabajos: [{ id: 1, ot: "A", etapas: { canteado: { gente: 12, maquina: 6 } } }, trabajo(2, "B", { corte: 10 })], capacidad: cap, params: P100 });
  const seg = (ot, e) => plan.segmentos.filter((s) => s.ot === ot && s.etapa === e).reduce((t, s) => t + s.gente, 0);
  assert.equal(seg("A", "canteado"), 12); // 6 h de canteadora × 2 personas
  assert.equal(seg("B", "corte"), 4);     // la gente que queda
  assert.deepEqual(pendientesPorOt(plan.pendientes), [{ id: 2, ot: "B", horas: 6, etapas: ["corte"] }]);
});

test("planAutomatico — si no entra, propone el sábado primero y después el domingo; lo que sobra pasa al período siguiente", () => {
  const cap = capacidadPlanta(UNO, SEMANA); // 40 h
  const plan = planAutomatico({ trabajos: [trabajo(1, "A", { armado: 44 })], capacidad: cap, params: P100 });
  assert.deepEqual(plan.diasExtra, [{ fecha: "2026-10-31", horas: 4 }]);
  assert.deepEqual(plan.pendientes, []);
  assert.equal(plan.porDia.find((d) => d.fecha === "2026-10-31").extra, true);
  const mucho = planAutomatico({ trabajos: [trabajo(1, "A", { armado: 60 })], capacidad: cap, params: P100 });
  assert.deepEqual(mucho.diasExtra.map((d) => d.fecha), ["2026-10-25", "2026-10-31"]);
  assert.deepEqual(pendientesPorOt(mucho.pendientes).map((o) => [o.ot, o.horas]), [["A", 4]]);
  // Las etapas que siguen a una que no entró también pasan
  const corte = planAutomatico({ trabajos: [trabajo(1, "A", { corte: 60, armado: 2 })], capacidad: cap, params: P100 });
  assert.deepEqual(pendientesPorOt(corte.pendientes)[0].etapas, ["corte", "armado"]);
});

test("planAutomatico — horas de reloj con la eficiencia", () => {
  const cap = capacidadPlanta(UNO, ["2026-10-26"]);
  const p50 = normalizarParametros({ ...PARAMS, eficiencia: 50 });
  // 3 h efectivas = 6 h de reloj; el día rinde 4 h efectivas
  const plan = planAutomatico({ trabajos: [trabajo(1, "A", { armado: 3 })], capacidad: cap, params: p50 });
  assert.equal(plan.segmentos[0].gente, 6);
  assert.equal(celdasGantt(plan.segmentos).get(1).get("2026-10-26").armado, 6);
});

// ─── Plan sin límite de semanas (Tadeo, 27/10; migración 143) ───
const { planHorizonte, trabajoDelPeriodo } = await import("../app/lib/planAutomatico.js");
const { diasDesde } = await import("../app/lib/cargaPlanta.js");
// Desde el lunes 26/10, 1 operario 8 h de lunes a viernes
const ANIO = capacidadPlanta(UNO, diasDesde("2026-10-26", 366)).porDia;
const conObjetivo = (t, objetivo) => ({ ...t, objetivo });

test("planHorizonte — según capacidad: sigue hasta que termina y marca la que pasa su semana", () => {
  const plan = planHorizonte({ trabajos: [conObjetivo(trabajo(1, "A", { armado: 44 }), "2026-10-31")], dias: ANIO, params: P100, base: "capacidad" });
  assert.equal(plan.desde, "2026-10-26");
  assert.equal(plan.hasta, "2026-11-02");
  assert.equal(plan.porDia.at(-1).fecha, "2026-11-02", "el Gantt llega hasta el último día con trabajo");
  assert.deepEqual(plan.diasExtra, []);
  assert.deepEqual(plan.tarde, [{ id: 1, ot: "A", objetivo: "2026-10-31", fin: "2026-11-02", motivo: "tarde" }]);
  // Más de 2 meses: no corta en 62 días
  const largo = planHorizonte({ trabajos: [trabajo(1, "A", { armado: 8 * 5 * 12 })], dias: ANIO, params: P100, base: "capacidad" });
  assert.equal(largo.pendientes.length, 0);
  assert.equal(largo.hasta, "2027-01-15");
  assert.deepEqual(largo.tarde, []);
});

test("planHorizonte — según fechas objetivo: horas extra antes de la semana (sábado, después domingo) y por semana", () => {
  const plan = planHorizonte({ trabajos: [conObjetivo(trabajo(1, "A", { armado: 44 }), "2026-10-31")], dias: ANIO, params: P100, base: "objetivo", modo: "semana_domingo" });
  assert.deepEqual(plan.diasExtra, [{ fecha: "2026-10-31", horas: 4 }]);
  assert.deepEqual(plan.extraPorSemana, [{ desde: "2026-10-25", horas: 4 }]);
  assert.deepEqual(plan.tarde, []);
  assert.equal(plan.finPorOt.get(1), "2026-10-31");
  // Para el domingo 8/11: 80 h normales + 12 h → los dos sábados antes que cualquier domingo
  const dos = planHorizonte({ trabajos: [conObjetivo(trabajo(1, "A", { armado: 92 }), "2026-11-08")], dias: ANIO, params: P100, base: "objetivo", modo: "semana_domingo" });
  assert.deepEqual(dos.diasExtra.map((d) => d.fecha), ["2026-10-31", "2026-11-07"]);
  assert.deepEqual(dos.tarde, []);
  // La que no llega ni con sábados y domingos queda marcada, sin horas extra que no sirven
  const mucho = planHorizonte({ trabajos: [conObjetivo(trabajo(1, "A", { armado: 70 }), "2026-10-31")], dias: ANIO, params: P100, base: "objetivo" });
  assert.deepEqual(mucho.diasExtra, []);
  assert.equal(mucho.tarde[0].motivo, "no_llega");
  // La semana ya pasada: atrasada, sin horas extra
  const vieja = planHorizonte({ trabajos: [conObjetivo(trabajo(1, "A", { armado: 4 }), "2026-10-03")], dias: ANIO, params: P100, base: "objetivo" });
  assert.deepEqual(vieja.diasExtra, []);
  assert.deepEqual(vieja.tarde, [{ id: 1, ot: "A", objetivo: "2026-10-03", fin: "2026-10-26", motivo: "atrasada" }]);
});

test("planHorizonte — la de más prioridad sin semana va primero; la siguiente con semana pide las horas extra", () => {
  const plan = planHorizonte({
    trabajos: [trabajo(1, "A", { armado: 40 }), conObjetivo(trabajo(2, "B", { armado: 8 }), "2026-10-31")],
    dias: ANIO, params: P100, base: "objetivo", modo: "semana_domingo",
  });
  assert.deepEqual(plan.diasExtra, [{ fecha: "2026-10-31", horas: 8 }]);
  assert.equal(plan.finPorOt.get(1), "2026-10-30");
  assert.equal(plan.finPorOt.get(2), "2026-10-31");
  // Sin gente cargada no entra nada
  const sinGente = planHorizonte({ trabajos: [trabajo(1, "A", { armado: 4 })], dias: capacidadPlanta([], diasDesde("2026-10-26", 30)).porDia, params: P100 });
  assert.deepEqual(sinGente.tarde.map((t) => t.motivo), ["sin_capacidad"]);
});

test("trabajoDelPeriodo y preseleccion sin fecha — la parte del plan de la semana elegida; tildadas todas las que tienen semana", () => {
  const plan = planHorizonte({ trabajos: [{ id: 1, ot: "A", etapas: { canteado: { gente: 12, maquina: 6 }, armado: { gente: 10, maquina: 10 } } }], dias: ANIO, params: P100, base: "capacidad" });
  const semana = trabajoDelPeriodo(plan.segmentos, "2026-10-25", "2026-10-31", 100);
  assert.equal(semana.etapas.canteado.gente, 12);
  assert.equal(semana.etapas.canteado.maquina, 6, "la canteadora con 2 personas: la mitad de horas de máquina");
  assert.equal(semana.etapas.armado.gente, 10);
  assert.equal(trabajoDelPeriodo(plan.segmentos, "2026-11-01", "2026-11-07").etapas.armado.gente, 0);
  assert.deepEqual([...preseleccion([{ id: 1, fecha_objetivo: "2020-01-04" }, { id: 2, fecha_objetivo: "2099-12-31" }, { id: 3 }])], [1, 2]);
});

test("📊 Carga — Ordenar automáticamente muestra el Gantt de todas las semanas, los días de horas extra y la semana de cada OT", async () => {
  lunes26();
  mockCarga({
    proyectos: [OT(1, "M-7473", { ...OT_A, division: "Muebles", estado: "activo", fecha_objetivo: "2026-10-31" })],
    empleados: [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "10:00" }, mar: { in: "08:00", out: "10:00" }, mie: { in: "08:00", out: "10:00" }, jue: { in: "08:00", out: "10:00" }, vie: { in: "08:00", out: "10:00" } } }],
    cfg: [{ valor: { ...PARAMS } }],
  });
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  fireEvent.click(screen.getByText("Ordenar automáticamente"));
  const plan = await screen.findByLabelText("Plan automático");
  const gantt = within(plan).getByLabelText("Gantt de planificación");
  assert.ok(within(plan).getAllByLabelText(/^OT M-7473, /).length > 0);
  // En cada día las etapas van una al lado de la otra (en secuencia), no apiladas
  const dia1 = within(plan).getAllByLabelText(/^OT M-7473, /)[0];
  const ys = [...dia1.querySelectorAll("rect[data-etapa]")].map((r) => r.getAttribute("y"));
  assert.ok(ys.length > 0 && ys.every((y) => y === "0"));
  assert.ok(within(plan).getAllByLabelText(/^Horas extra el 31\/10/).length > 0);
  assert.equal(gantt.querySelectorAll('td[data-objetivo="si"]').length, 1, "línea roja en el fin de su semana");
  assert.match(within(plan).getByLabelText("Fin de cada OT").textContent, /M-7473 termina el 31\/10\/2026/);
  // Según capacidad: el Gantt sigue a la semana siguiente
  fireEvent.click(screen.getByText("🏭 Según capacidad de la planta"));
  assert.ok(within(plan).getAllByLabelText(/^OT M-7473, \d+\/11/).length > 0);
  assert.equal(within(plan).queryAllByLabelText(/^Horas extra el /).length, 0);
  fireEvent.click(within(plan).getByText("Ocultar"));
  assert.ok(screen.getByText("Ordenar automáticamente"));
});

// ─── Operarios por puesto y armadores (Tadeo, 27/10) ────────────────────────
const { personalPlanta, PUESTOS_PLANTA } = await import("../app/lib/cargaPlanta.js");
const OP = (id, puesto_planta, extra = {}) => ({ id, nombre: `Op ${id}`, rol: "operativo", division: "MUEBLES", activo: true, puesto_planta, ...extra });

test("personalPlanta — puestos contra lo que piden las máquinas; Otra línea no se planifica", () => {
  assert.deepEqual(PUESTOS_PLANTA.map((p) => p.id), ["corte", "canteado", "mecanizado", "armado", "otra_linea"]);
  assert.equal(normalizarParametros(null).max_armadores_ot, 4, "hasta 4 armadores por OT por defecto");
  const params = normalizarParametros(null); // 1 seccionadora, canteadora con 2, 2 CNC
  // Nadie con puesto: todos hacen de todo y arman los que sobran de las máquinas
  const todos = personalPlanta([1, 2, 3, 4, 5, 6, 7, 8].map((i) => OP(i, null)), params);
  assert.equal(todos.categorizados, false);
  assert.equal(todos.enMaquinas, 5);
  assert.equal(todos.armadores, 3);
  assert.deepEqual(todos.avisos, []);
  // Con puesto: falta uno en la CNC y los que no tienen puesto arman
  const conPuesto = personalPlanta([OP(1, "corte"), OP(2, "canteado"), OP(3, "canteado"), OP(4, "mecanizado"), OP(5, "armado"), OP(6, null)], params);
  assert.deepEqual(conPuesto.porPuesto, { corte: 1, canteado: 2, mecanizado: 1, armado: 1 });
  assert.equal(conPuesto.armadores, 2);
  assert.deepEqual(conPuesto.avisos, ["Mecanizado (CNC): hacen falta 2 y hay 1"]);
  // Máquinas + armadores no pueden superar a los operarios de la grilla
  const pocos = personalPlanta([OP(1, "armado"), OP(2, "armado"), OP(3, "corte")], params);
  assert.ok(pocos.avisos.some((a) => /Las máquinas \(5\) más los armadores \(2\) suman más que los 3 operarios/.test(a)));
  assert.ok(personalPlanta([OP(1, null)], params).avisos.includes("No queda nadie para Armado"));
  // Los de Otra línea (Puertas) quedan afuera de la planta que se planifica
  assert.deepEqual(operariosDePlanta([OP(1, "corte"), OP(2, "otra_linea")], DIVISIONES, DIVISIONES[0]).map((e) => e.id), [1]);
});

test("⚙ Parámetros — máximo de armadores por OT y operarios por puesto con avisos", async () => {
  const pedidos = mockData({ empleados: [
    OP(1, "corte"), OP(2, "canteado"), OP(3, "mecanizado"), OP(4, "armado"), OP(5, null),
    OP(6, "otra_linea"), OP(7, "armado", { division: "HERRERÍA" }),
  ] });
  pantalla();
  fireEvent.click(await screen.findByText("⚙ Parámetros"));
  const form = await screen.findByRole("region", { name: "Parámetros de la planificación" });
  assert.equal(within(form).getByLabelText(/^Máximo de armadores por OT/).value, "4");
  const resumen = await within(form).findByLabelText("Operarios por puesto");
  assert.match(resumen.textContent, /Operarios de la grilla de horarios \(5\)/);
  const fila = (nombre) => within(resumen).getByText(nombre).closest("tr").textContent;
  assert.match(fila("Canteado"), /Canteado12/);
  assert.match(fila("Armado"), /Armado2/, "el de armado y el que no tiene puesto");
  assert.match(fila("Otra línea (no se planifica)"), /1/);
  assert.ok(within(resumen).getByText("⚠ Canteado: hacen falta 2 y hay 1"));
  assert.ok(within(resumen).getByText("⚠ Mecanizado (CNC): hacen falta 2 y hay 1"));
  // Con la canteadora de 1 persona y 1 CNC ya no falta nadie
  fireEvent.change(within(form).getByLabelText(/^Personas en la canteadora/), { target: { value: "1" } });
  fireEvent.change(within(form).getByLabelText(/^CNC/), { target: { value: "1" } });
  assert.equal(within(resumen).queryByRole("alert"), null);
  fireEvent.change(within(form).getByLabelText(/^Máximo de armadores por OT/), { target: { value: "3" } });
  fireEvent.click(screen.getByText("Guardar parámetros"));
  await screen.findByText("✅ Parámetros guardados");
  assert.equal(pedidos.find((p) => p.method === "POST").body.valor.max_armadores_ot, 3);
});

test("migración 140 — puesto en la planta de cada operario", () => {
  const sql = readFileSync(new URL("../supabase/migrations/140_empleados_puesto_planta.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists puesto_planta text/i);
  for (const p of ["corte", "canteado", "mecanizado", "armado", "otra_linea"]) assert.ok(sql.includes(`'${p}'`), p);
});

test("ficha del operario — elige el puesto y lo manda al guardar", () => {
  const ficha = readFileSync(new URL("../app/gestion_personal_screen.jsx", import.meta.url), "utf8");
  assert.match(ficha, /id="emp-puesto-planta"/);
  assert.match(ficha, /PUESTOS_PLANTA\.map/);
  assert.match(ficha, /puesto_planta: form\.puesto_planta \|\| null/);
});

// ─── Checkeo manual de OT (Tadeo, 27/10; migración 141) ─────────────────────
const { normalizarAvanceManual, etapasDeOt, piezasConManual, tieneEscaneo } = await import("../app/lib/avanceManual.js");
const { default: AvanceManualOt } = await import("../app/components/AvanceManualOt.jsx");
const { validarPatch } = await import("../app/lib/dataPolicy.js");
const { leerAvanceYHoras } = await import("../app/lib/otEnCursoDatos.js");

test("piezasConManual — manda el escaneo; el % manual cuenta solo en los procesos sin escaneo", () => {
  assert.deepEqual(normalizarAvanceManual({ activo: true, etapas: { 1: 120, 2: "40", x: 5, 0: 10 } }).etapas, { 1: 100, 2: 40 });
  assert.deepEqual(normalizarAvanceManual(null), { activo: false, etapas: {}, por: null, at: null });
  const escaneo = [{ ot: "7100", etapa: 1, total: 40, pasaron: 10 }, { ot: "7100", etapa: 2, total: 40, pasaron: 0 }];
  const proyectos = [
    { ot: "7100", avance_manual: { activo: true, etapas: { 1: 100, 2: 50, 4: 25 } } },
    { ot: "7200", avance_manual: { activo: true, etapas: { 1: 30 } } },
    { ot: "7300", avance_manual: { activo: false, etapas: { 1: 90 } } },
  ];
  const filas = piezasConManual(escaneo, proyectos);
  const de = (ot, etapa) => filas.filter((f) => f.ot === ot && f.etapa === etapa).map((f) => [f.total, f.pasaron, !!f.manual]);
  assert.deepEqual(de("7100", 1), [[40, 10, false]], "Corte tiene escaneo: no cambia aunque diga 100% a mano");
  assert.deepEqual(de("7100", 2), [[40, 20, true]], "Canteado sin escaneo: 50% con el total de piezas de la OT");
  assert.deepEqual(de("7100", 4), [[40, 10, true]]);
  assert.deepEqual(de("7200", 1), [[100, 30, true]], "OT sin piezas: sobre 100");
  assert.deepEqual(de("7300", 1), [], "apagado no cuenta");
  assert.equal(piezasConManual(escaneo, []), escaneo);
  assert.ok(tieneEscaneo(escaneo, "7100", 1));
  assert.ok(!tieneEscaneo(filas, "7100", 2));
  // La carga de la planta toma lo que falta: Canteado 50% → falta la mitad
  assert.equal(pendienteEtapa({ ot: "7100", codigo: 2, piezas: filas }), 0.5);
  assert.equal(pendienteEtapa({ ot: "7200", codigo: 1, piezas: filas }), 0.7);
  // Procesos de la OT: la ruta de su división
  assert.deepEqual(etapasDeOt({ division: "MUEBLES" }, ETAPAS, DIVISIONES).map((e) => e.codigo), [1, 2, 3, 4, 5]);
  assert.deepEqual(etapasDeOt({ division: "Herrería" }, ETAPAS, DIVISIONES).map((e) => e.codigo), [1, 2, 3, 4, 5], "sin ruta, todas las productivas");
});

test("avance_manual — solo se guarda con la forma correcta; migración 141", () => {
  assert.equal(validarPatch("proyectos", { avance_manual: { activo: true, etapas: { 1: 40 }, por: "Tadeo" } }, { rol: "gerencial" }), null);
  assert.equal(validarPatch("proyectos", { avance_manual: null }, { rol: "gerencial" }), null);
  for (const mal of [{ activo: true, etapas: { 1: 140 } }, { activo: "si", etapas: {} }, { activo: true, etapas: { corte: 10 } }, { activo: true }, []]) {
    assert.equal(validarPatch("proyectos", { avance_manual: mal }, { rol: "gerencial" })?.status, 400, JSON.stringify(mal));
  }
  const esquemas = readFileSync(new URL("../app/lib/schemas.ts", import.meta.url), "utf8");
  assert.match(esquemas, /"tipo_proyecto", "avance_manual"\]/);
  const sql = readFileSync(new URL("../supabase/migrations/141_proyectos_avance_manual.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists avance_manual jsonb/i);
});

test("leerAvanceYHoras — suma el checkeo manual y deja aparte el escaneo", async () => {
  global.fetch = async (url, opts) => {
    const path = JSON.parse(opts.body).path || "";
    const lista = (data) => new Response(JSON.stringify({ data: path.includes("offset=0") ? data : [] }), { status: 200 });
    if (path.startsWith("v_avance_piezas")) return lista([{ ot: "7100", etapa: 1, total: 10, pasaron: 5 }]);
    if (path.startsWith("proyectos") && path.includes("avance_manual=not.is.null")) return lista([{ ot: "7100", avance_manual: { activo: true, etapas: { 2: 60 } } }]);
    return lista([]);
  };
  const d = await leerAvanceYHoras("emp-1");
  assert.equal(d.piezasEscaneo.length, 1);
  assert.deepEqual(d.piezas.map((f) => [f.etapa, f.pasaron]), [[1, 5], [2, 6]]);
  assert.ok(d.horas.has("7100|2"), "con avance manual el proceso ya empezó");
});

const conSesion = (rol, ui) => render(<AuthContext.Provider value={{ usuario: { rol, nombre: "Tadeo" } }}>{ui}</AuthContext.Provider>);

test("✍ Checkeo manual — se activa, carga el % de los procesos sin escaneo y guarda en la OT", async () => {
  const pedidos = mockData();
  const guardados = [];
  const proyecto = { id: 7, ot: "7100", division: "MUEBLES" };
  conSesion("gerencial", <AvanceManualOt proyecto={proyecto} etapas={ETAPAS} divisiones={DIVISIONES}
    piezas={[{ ot: "7100", etapa: 1, total: 40, pasaron: 30 }]} onGuardado={(v) => guardados.push(v)} />);
  const sec = screen.getByRole("region", { name: "Checkeo manual de la OT 7100" });
  assert.equal(within(sec).queryByLabelText(/^Avance de Canteado/), null, "apagado no muestra los procesos");
  fireEvent.click(within(sec).getByLabelText("Usar checkeo manual en esta OT"));
  assert.match(within(sec).getByText(/75% por escaneo/).textContent, /manda el escaneo/, "Corte tiene escaneo");
  assert.equal(within(sec).queryByLabelText(/^Avance de Corte/), null);
  fireEvent.change(within(sec).getByLabelText("Avance de Canteado en la OT 7100, en %"), { target: { value: "150" } });
  assert.ok(within(sec).getByText("Entre 0 y 100"));
  assert.equal(within(sec).getByText("Guardar avance").disabled, true);
  fireEvent.change(within(sec).getByLabelText("Avance de Canteado en la OT 7100, en %"), { target: { value: "60" } });
  fireEvent.change(within(sec).getByLabelText("Avance de Mecanizado CNC en la OT 7100, en %"), { target: { value: "12,4" } });
  fireEvent.click(within(sec).getByText("Guardar avance"));
  await within(sec).findByText("✅ Avance guardado");
  const patch = pedidos.find((p) => p.method === "PATCH");
  assert.equal(patch.path, "proyectos?id=eq.7");
  assert.deepEqual(patch.body.avance_manual.etapas, { 2: 60, 3: 12 });
  assert.equal(patch.body.avance_manual.activo, true);
  assert.equal(patch.body.avance_manual.por, "Tadeo");
  assert.equal(guardados.length, 1);
});

test("✍ Checkeo manual — sin la migración 141 avisa; quien no es gestión solo lo ve", async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: 'column "avance_manual" of relation "proyectos" does not exist' }), { status: 400 });
  conSesion("gerencial", <AvanceManualOt proyecto={{ id: 7, ot: "7100", division: "MUEBLES" }} etapas={ETAPAS} divisiones={DIVISIONES} />);
  fireEvent.click(screen.getByLabelText("Usar checkeo manual en esta OT"));
  fireEvent.click(screen.getByText("Guardar avance"));
  assert.ok(await screen.findByText("Para el checkeo manual falta correr la migración 141 en Supabase."));
  cleanup();
  const activo = { id: 8, ot: "7200", division: "MUEBLES", avance_manual: { activo: true, etapas: { 1: 80 }, por: "Tadeo", at: "2026-10-27T10:00:00Z" } };
  conSesion("supervisor", <AvanceManualOt proyecto={activo} etapas={ETAPAS} divisiones={DIVISIONES} />);
  const sec = screen.getByRole("region", { name: "Checkeo manual de la OT 7200" });
  assert.equal(within(sec).queryByLabelText("Usar checkeo manual en esta OT"), null);
  assert.equal(within(sec).queryByText("Guardar avance"), null);
  assert.match(sec.textContent, /80%/);
  assert.match(sec.textContent, /Cargado por Tadeo el 27\/10\/2026/);
  cleanup();
  conSesion("supervisor", <AvanceManualOt proyecto={{ id: 9, ot: "7300", division: "MUEBLES" }} etapas={ETAPAS} divisiones={DIVISIONES} />);
  assert.equal(screen.queryByRole("region", { name: /Checkeo manual/ }), null, "apagado y sin poder editar no se muestra");
});

test("📊 Carga — el checkeo manual baja las horas que faltan de la OT y no destilda las OT", async () => {
  mockCarga({
    proyectos: [
      OT(1, "M-7473", { ...OT_A, division: "Muebles", estado: "activo", fecha_objetivo: "2020-01-04", semana_objetivo: 1 }),
      OT(2, "M-9000", { division: "Muebles", placas: 1 }),
    ],
    empleados: [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "10:00" } } }],
    cfg: [{ valor: { ...PARAMS } }],
  });
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  fireEvent.click(screen.getByLabelText("Planificar OT M-9000"));
  const fila = screen.getByLabelText("Planificar OT M-7473").closest("li");
  const antes = fila.querySelector("label > div.text-right > div").textContent;
  fireEvent.click(within(fila).getByRole("button", { name: /✍ Checkeo manual/ }));
  fireEvent.click(within(fila).getByLabelText("Usar checkeo manual en esta OT"));
  for (const e of ["Corte / Seccionado", "Canteado", "Mecanizado CNC", "Armado y embalaje"]) {
    fireEvent.change(within(fila).getByLabelText(`Avance de ${e} en la OT M-7473, en %`), { target: { value: "100" } });
  }
  fireEvent.click(within(fila).getByText("Guardar avance"));
  await within(fila).findByText("✅ Avance guardado");
  assert.match(within(fila).getByRole("button", { name: /✍ Checkeo manual/ }).textContent, /\(activo\)/);
  await waitFor(() => assert.notEqual(fila.querySelector("label > div.text-right > div").textContent, antes));
  assert.equal(fila.querySelector("label > div.text-right > div").textContent, "0 h", "todo hecho: no falta nada");
  assert.equal(screen.getByLabelText("Planificar OT M-9000").checked, true, "lo tildado a mano queda");
});

// ─── Valorización con el PRECIO del Plan de trabajo (Tadeo, 27/10; migración 142) ───
const { puedeVerPrecios, valorizarPlan, nombreMes } = await import("../app/lib/valorizacion.js");
const { autorizar, TABLAS_SIN_SUPERVISOR } = await import("../app/lib/dataPolicy.js");

test("valorizarPlan — reparte el precio según las horas de cada semana y mes", () => {
  // OT de 10 h en total: 3 h ya hechas, 4 h el viernes 30/10, 2 h el lunes 2/11 y 1 h pasa al período siguiente
  const v = valorizarPlan({
    ots: [{ id: 1, ot: "A", completo: 10 }, { id: 2, ot: "B", completo: 0 }, { id: 3, ot: "C", completo: 5 }],
    segmentos: [{ id: 1, fecha: "2026-10-30", gente: 4 }, { id: 1, fecha: "2026-11-02", gente: 2 }, { id: 3, fecha: "2026-11-02", gente: 5 }],
    pendientes: [{ id: 1, gente: 1 }],
    precios: new Map([["A", 1000], ["B", 500]]), eficiencia: 100, modo: "semana_domingo",
  });
  assert.equal(v.total, 1500);
  assert.equal(v.conPrecio, 2);
  assert.equal(v.sinPrecio, 1, "C no tiene precio");
  assert.deepEqual(v.porSemana, [{ desde: "2026-10-25", valor: 400 }, { desde: "2026-11-01", valor: 200 }]);
  assert.deepEqual(v.porMes, [{ mes: "2026-10", valor: 400 }, { mes: "2026-11", valor: 200 }]);
  assert.equal(v.enPlan, 600);
  assert.equal(v.pasa, 100);
  assert.equal(v.hecho, 300);
  assert.equal(v.sinHoras, 500, "B no tiene horas para repartir");
  // Con eficiencia: las horas del plan son de reloj
  const ef = valorizarPlan({ ots: [{ id: 1, ot: "A", completo: 8 }], segmentos: [{ id: 1, fecha: "2026-10-30", gente: 10 }], precios: new Map([["A", 800]]), eficiencia: 80 });
  assert.equal(ef.enPlan, 800);
  assert.equal(nombreMes("2026-11"), "Noviembre 2026");
});

test("precios — solo Dueño y Administración; el supervisor de división no", () => {
  assert.equal(puedeVerPrecios({ rol: "gerencial" }), true);
  assert.equal(puedeVerPrecios({ rol: "administrativo" }), true);
  assert.equal(puedeVerPrecios({ rol: "administrativo", solo_su_division: true }), false);
  assert.equal(puedeVerPrecios({ rol: "operativo" }), false);
  assert.equal(autorizar("precios_ot", "GET", { rol: "operativo" }).ok, false);
  assert.equal(autorizar("precios_ot", "GET", { rol: "administrativo" }).ok, true);
  assert.equal(autorizar("precios_ot", "POST", { rol: "gerencial" }).ok, false, "lo escribe solo la sincronización");
  assert.ok(TABLAS_SIN_SUPERVISOR.has("precios_ot"));
  const route = readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8");
  assert.match(route, /alcance && TABLAS_SIN_SUPERVISOR\.has\(pathCheck\.tabla\)/);
  assert.match(route, /TABLAS_SOLO_LECTURA = \[[^\]]*"precios_ot"/);
  const sql = readFileSync(new URL("../supabase/migrations/142_precios_ot.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.precios_ot/);
  assert.match(sql, /->>'rol'\) in \('gerencial', 'administrativo'\)/);
  assert.match(sql, /grant select on public\.precios_ot to authenticated;/);
});

function mockConPrecios(precios) {
  const pedidos = [];
  mockCarga({
    proyectos: [
      OT(1, "M-7473", { ...OT_A, division: "Muebles", estado: "activo", fecha_objetivo: "2020-01-04", semana_objetivo: 1 }),
      OT(2, "M-9000", { division: "Muebles", fecha_objetivo: "2020-01-04", semana_objetivo: 1 }),
    ],
    empleados: [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: LV, mar: LV, mie: LV, jue: LV, vie: LV } }],
    cfg: [{ valor: { ...PARAMS } }],
  });
  const base = global.fetch;
  global.fetch = async (url, opts) => {
    const path = JSON.parse(opts.body).path || "";
    pedidos.push(path);
    if (path.startsWith("precios_ot")) return new Response(JSON.stringify({ data: path.includes("offset=0") ? precios : [] }), { status: 200 });
    return base(url, opts);
  };
  return pedidos;
}

test("📊 Carga — 💲 precio de cada OT y valorización por semana y mes", async () => {
  lunes26();
  mockConPrecios([{ ot: "M-7473", precio: 2500000 }, { ot: "M-9000", precio: 1000000 }]);
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  const fila = screen.getByLabelText("Planificar OT M-7473").closest("li");
  await waitFor(() => assert.match(fila.textContent, /\$ 2\.500\.000/));
  const valor = screen.getByLabelText("Valorización");
  assert.match(valor.textContent, /OT tildadas con precio: 2\$ 3\.500\.000/);
  fireEvent.click(screen.getByLabelText("Planificar OT M-9000"));
  assert.match(valor.textContent, /\$ 2\.500\.000/);
  // Con Semana: la semana que se ve, cada semana del plan y el total
  const semanas = within(valor).getByLabelText("Valorización por semana");
  assert.match(semanas.textContent, /Semana del 25\/10\/2026/);
  assert.match(semanas.textContent, /Total del plan\$ 2\.500\.000$/);
  assert.equal(semanas.querySelector('tr[aria-current="true"]').textContent.startsWith("Semana del 25/10/2026"), true);
  assert.match(within(valor).getByLabelText("Valor del período").textContent, /^Semana del 25\/10\/2026 al 31\/10\/2026\$/);
  assert.match(within(valor).getByLabelText("Total del plan").textContent, /\$ 2\.500\.000/);
  assert.equal(within(valor).queryByLabelText("Valorización por mes"), null);
  // ▶ cambia la semana que se ve; una semana sin trabajo vale 0
  fireEvent.click(screen.getByLabelText("Período siguiente"));
  assert.match(within(valor).getByLabelText("Valor del período").textContent, /^Semana del 1\/11\/2026/);
  // Con Mes: por mes
  fireEvent.click(screen.getByText("Mes"));
  const meses = within(valor).getByLabelText("Valorización por mes");
  assert.match(meses.querySelector('tr[aria-current="true"]').textContent, /^Octubre 2026/);
  assert.match(within(valor).getByLabelText("Valor del período").textContent, /^Octubre 2026/);
  assert.equal(within(valor).queryByLabelText("Valorización por semana"), null);
});

test("📊 Carga — el supervisor de división no ve precios ni los pide", async () => {
  const pedidos = mockConPrecios([{ ot: "M-7473", precio: 2500000 }]);
  render(
    <AuthContext.Provider value={{ divisiones: DIVISIONES, etapas: ETAPAS, usuario: { rol: "administrativo", solo_su_division: true } }}>
      <PlanificacionScreen empresaId="emp-1" />
    </AuthContext.Provider>
  );
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  assert.equal(screen.queryByLabelText("Valorización"), null);
  assert.doesNotMatch(screen.getByLabelText("Planificar OT M-7473").closest("li").textContent, /\$/);
  assert.ok(!pedidos.some((p) => p.startsWith("precios_ot")));
});
