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
  divisionPlan, etapasPlanDe, otsPlanificables, ordenarPorPrioridad, buscarOts, tildarTodas, tildadasPrimero, moverOt, quitarPrioridad, cambiosPrioridad,
} from "../app/lib/planificacion.js";
import { opcionesBoton } from "../app/lib/menuGestion.js";

const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { default: PlanificacionScreen } = await import("../app/components/PlanificacionScreen.jsx");

afterEach(() => { cleanup(); localStorage.clear(); });

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

// 29/10 (Tadeo): la prioridad está dentro de 📊 Carga (paso ②) y solo con las OT tildadas
test("📌 Prioridad — en Carga, solo las tildadas, ordenadas, y ▲ guarda la prioridad nueva", async () => {
  const pedidos = mockData({ proyectos: [
    OT(1, "M-7100", { fecha_objetivo: "2026-10-31", semana_objetivo: 44, placas: 21.8 }),
    OT(2, "M-7200", { fecha_objetivo: "2026-11-07", semana_objetivo: 45 }),
    OT(3, "H-800", { division: "HERRERÍA" }),
    OT(4, "M-7300", { fecha_objetivo: "2026-11-14", semana_objetivo: 46 }),
  ] });
  pantalla();
  assert.equal(screen.queryByText("📌 Prioridad"), null, "ya no es una pestaña aparte");
  const lista = await screen.findByRole("region", { name: "Prioridad de las OT" });
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7300").checked, true));
  fireEvent.click(screen.getByLabelText("Planificar OT M-7300"));
  const filas = within(lista).getAllByRole("listitem");
  assert.deepEqual(filas.map((f) => f.getAttribute("aria-label")), ["OT M-7100", "OT M-7200"], "la destildada no está");
  assert.match(filas[0].textContent, /S44 \(31\/10\)/);
  assert.match(filas[0].textContent, /Placas 18 21,8/);
  fireEvent.click(screen.getByLabelText("Subir OT M-7200"));
  await screen.findByText("✅ Prioridad guardada");
  const patch = pedidos.filter((p) => p.method === "PATCH");
  assert.deepEqual(patch.map((p) => [p.path, p.body]), [["proyectos?id=eq.2", { prioridad: 1 }]]);
  assert.deepEqual(within(lista).getAllByRole("listitem").map((f) => f.getAttribute("aria-label")), ["OT M-7200", "OT M-7100"]);
  assert.ok(screen.getByLabelText("Quitar prioridad de la OT M-7200"));
});

test("📌 Prioridad — también se ordena escribiendo el número de cada OT", async () => {
  const pedidos = mockData({ proyectos: [
    OT(1, "M-7100", { fecha_objetivo: "2026-10-31", semana_objetivo: 44 }),
    OT(2, "M-7200", { fecha_objetivo: "2026-11-07", semana_objetivo: 45 }),
    OT(4, "M-7300", { fecha_objetivo: "2026-11-14", semana_objetivo: 46 }),
  ] });
  pantalla();
  const lista = await screen.findByRole("region", { name: "Prioridad de las OT" });
  await waitFor(() => assert.equal(within(lista).getAllByRole("listitem").length, 3));
  const orden = () => within(lista).getAllByRole("listitem").map((f) => f.getAttribute("aria-label").replace("OT ", ""));
  // La M-7300 pasa a ser la 1
  const n = screen.getByLabelText("Prioridad de la OT M-7300");
  fireEvent.change(n, { target: { value: "1" } });
  fireEvent.blur(n);
  await screen.findByText("✅ Prioridad guardada");
  assert.deepEqual(orden(), ["M-7300", "M-7100", "M-7200"]);
  assert.equal(screen.getByLabelText("Prioridad de la OT M-7300").value, "1");
  assert.deepEqual(pedidos.filter((p) => p.method === "PATCH").map((p) => [p.path, p.body]), [["proyectos?id=eq.4", { prioridad: 1 }]]);
  // Un número más grande que la lista la manda al último lugar con número; Enter confirma
  const otra = screen.getByLabelText("Prioridad de la OT M-7100");
  fireEvent.change(otra, { target: { value: "9" } });
  fireEvent.keyDown(otra, { key: "Enter" });
  fireEvent.blur(otra);
  await waitFor(() => assert.deepEqual(orden(), ["M-7300", "M-7200", "M-7100"]));
  assert.equal(screen.getByLabelText("Prioridad de la OT M-7100").value, "3");
  // Vacía: se le quita la prioridad
  const sacar = screen.getByLabelText("Prioridad de la OT M-7300");
  fireEvent.change(sacar, { target: { value: "" } });
  fireEvent.blur(sacar);
  await waitFor(() => assert.equal(screen.getByLabelText("Prioridad de la OT M-7300").value, ""));
  // Un valor que no sirve vuelve al que tenía
  const mal = screen.getByLabelText("Prioridad de la OT M-7200");
  const antes = mal.value;
  fireEvent.change(mal, { target: { value: "0" } });
  fireEvent.blur(mal);
  assert.equal(screen.getByLabelText("Prioridad de la OT M-7200").value, antes);
});

test("📌 Prioridad — cada tildada muestra su lugar entre las tildadas y al cambiar se guarda así", async () => {
  const pedidos = mockData({ proyectos: [
    OT(1, "M-7100", { fecha_objetivo: "2026-10-31", semana_objetivo: 44, prioridad: 4 }),
    OT(2, "M-7200", { fecha_objetivo: "2026-11-07", semana_objetivo: 45, prioridad: 9 }),
    OT(3, "M-7300", { prioridad: 1 }), // sin semana: no viene tildada
  ] });
  pantalla();
  const lista = await screen.findByRole("region", { name: "Prioridad de las OT" });
  await waitFor(() => assert.equal(within(lista).getAllByRole("listitem").length, 2));
  assert.equal(screen.getByLabelText("Prioridad de la OT M-7100").value, "1", "la 4 es la primera de las tildadas");
  assert.equal(screen.getByLabelText("Prioridad de la OT M-7200").value, "2");
  fireEvent.click(screen.getByLabelText("Bajar OT M-7100"));
  await screen.findByText("✅ Prioridad guardada");
  assert.deepEqual(pedidos.filter((p) => p.method === "PATCH").map((p) => [p.path, p.body]).sort(),
    [["proyectos?id=eq.1", { prioridad: 2 }], ["proyectos?id=eq.2", { prioridad: 1 }]]);
});

test("📌 Prioridad — sin la migración 137 avisa qué falta y no deja ordenar", async () => {
  mockData({ proyectos: [{ id: 1, ot: "M-1", division: "Muebles", estado: "activo" }, { id: 2, ot: "M-2", division: "Muebles", estado: "activo" }] });
  pantalla();
  assert.ok(await screen.findByText(/Tildá en ① las OT/), "sin tildadas no hay nada que ordenar");
  fireEvent.click(screen.getByLabelText("Planificar OT M-1"));
  fireEvent.click(screen.getByLabelText("Planificar OT M-2"));
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
const { periodo, diasDelPeriodo, operariosDePlanta, capacidadPlanta, horasOt, cargaPeriodo, pendienteEtapa, preseleccion, modulosPorOt, fmtH, conHorasExtra } = await import("../app/lib/cargaPlanta.js");

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
  assert.match(plan.textContent, /🔴 Terminan después de su semanaM-7473: su semana terminó el 4\/1\/2020; termina el/);
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
    // Con 1 operario de 2 h por día no llega al sábado 31/10 sin horas extra
    proyectos: [OT(1, "M-7473", { ...OT_A, division: "Muebles", estado: "activo", fecha_objetivo: "2026-10-31", semana_objetivo: 44 })],
    empleados: [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "10:00" }, mar: { in: "08:00", out: "10:00" }, mie: { in: "08:00", out: "10:00" }, jue: { in: "08:00", out: "10:00" }, vie: { in: "08:00", out: "10:00" } } }],
    cfg: [{ valor: { ...PARAMS, personas_canteadora: 1, maquinas_cnc: 1 } }], // 1 operario: canteadora con 1 persona y 1 CNC
  });
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  const resumen = () => screen.getByLabelText("Resumen del plan");
  // Por defecto, según capacidad; las fechas objetivo hay que elegirlas
  assert.equal(within(resumen()).queryByLabelText("Horas extra por semana"), null);
  fireEvent.click(screen.getByText("📅 Según fechas objetivo (SEMANA)"));
  assert.match(within(resumen()).getByLabelText("Horas extra por semana").textContent, /Semana del 25\/10\/2026: .* h \(sáb\.? 31\/10\/2026\)/);
  // El paso ③ suma a las horas de la planta el sábado de horas extra (Tadeo, 29/10)
  assert.match(screen.getByLabelText("Carga de la planta").textContent, /Las horas de la planta incluyen .* h de horas extra \(1 día\)/);
  const horasPlanta = () => screen.getByText("Horas de la planta").parentElement.textContent;
  const conExtra = horasPlanta();
  fireEvent.click(screen.getByText("🏭 Según capacidad de la planta"));
  assert.notEqual(horasPlanta(), conExtra, "sin horas extra, la planta tiene menos horas");
  assert.doesNotMatch(screen.getByLabelText("Carga de la planta").textContent, /incluyen .* de horas extra/);
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
  assert.deepEqual(tildadasPrimero(ots, new Set([3, 1])).map((p) => p.id), [1, 3, 2], "tildadas arriba, cada grupo en su orden");
  assert.deepEqual(tildadasPrimero(ots, new Set()).map((p) => p.id), [1, 2, 3]);
});

test("📊 Carga — las OT tildadas se ven primero en la lista", async () => {
  mockCarga({
    proyectos: [
      OT(5, "M-7000", { cliente: "CEVT", division: "Muebles", placas: 1 }),
      OT(1, "M-7473", { ...OT_A, cliente: "Riofrío", division: "Muebles", estado: "activo", fecha_objetivo: "2020-01-04", semana_objetivo: 1 }),
      OT(3, "M-9100", { cliente: "CEVT", division: "Muebles", placas: 1 }),
    ],
    empleados: [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "10:00" } } }],
    cfg: [{ valor: { ...PARAMS } }],
  });
  pantalla();
  const orden = () => within(screen.getByRole("list", { name: "OT para planificar" })).getAllByRole("checkbox", { name: /^Planificar OT / })
    .map((c) => c.getAttribute("aria-label").replace("Planificar OT ", ""));
  const tildada = (ot) => screen.getByLabelText(`Planificar OT ${ot}`).checked;
  await waitFor(() => assert.equal(tildada("M-7473"), true));
  if (tildada("M-7000")) fireEvent.click(screen.getByLabelText("Planificar OT M-7000"));
  assert.deepEqual(orden(), ["M-7473", "M-7000", "M-9100"], "sin tildar, cada una en su orden");
  fireEvent.click(screen.getByLabelText("Planificar OT M-9100"));
  assert.deepEqual(orden(), ["M-7473", "M-9100", "M-7000"], "la recién tildada sube con las tildadas");
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

// ─── Parte 40: plan automático, con el mismo cálculo que el Gantt (29/10) ───
const { pendientesPorOt, planHorizonte } = await import("../app/lib/planAutomatico.js");
const { diasDesde } = await import("../app/lib/cargaPlanta.js");

// Semana del 25/10 (domingo) al 31/10 (sábado); 1 operario 8 h de lunes a viernes, eficiencia 100 %
const P100 = normalizarParametros({ ...PARAMS, eficiencia: 100 });
const UNO = [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "16:00" }, mar: { in: "08:00", out: "16:00" }, mie: { in: "08:00", out: "16:00" }, jue: { in: "08:00", out: "16:00" }, vie: { in: "08:00", out: "16:00" } } }];
const trabajo = (id, ot, horas) => ({ id, ot, etapas: Object.fromEntries(["corte", "canteado", "mecanizado", "armado"].map((e) => [e, { gente: horas[e] || 0, maquina: horas[e] || 0 }])) });
const LUNES = capacidadPlanta(UNO, diasDesde("2026-10-26", 60)).porDia;
const enDia = (plan, fecha) => plan.segmentos.filter((s) => s.fecha === fecha).map((s) => [s.ot, s.etapa, Math.round(s.gente * 100) / 100]);

test("un solo cálculo — por cada máquina una OT a la vez y en cada OT las etapas en orden", () => {
  const plan = planHorizonte({ trabajos: [trabajo(1, "A", { corte: 6, armado: 4 }), trabajo(2, "B", { corte: 4 })], dias: LUNES, params: P100, base: "capacidad" });
  assert.deepEqual(plan.pendientes, []);
  assert.deepEqual(plan.diasExtra, []);
  // Lunes: A corta 6 h y después arma; B corta cuando se libera la seccionadora (en paralelo con el armado de A)
  assert.deepEqual(enDia(plan, "2026-10-26"), [["A", "corte", 6], ["A", "armado", 2], ["B", "corte", 2]]);
  assert.deepEqual(enDia(plan, "2026-10-27"), [["A", "armado", 2], ["B", "corte", 2]]);
  assert.equal(plan.finPorOt.get(1), "2026-10-27");
  assert.equal(plan.finPorOt.get(2), "2026-10-27");
});

test("un solo cálculo — la canteadora con 2 personas tarda la mitad y gasta el doble de gente; eficiencia en horas de reloj", () => {
  const plan = planHorizonte({ trabajos: [{ id: 1, ot: "A", etapas: { canteado: { gente: 12, maquina: 6 } } }], dias: LUNES, params: P100, base: "capacidad" });
  const cant = plan.segmentos.filter((s) => s.etapa === "canteado");
  assert.deepEqual(cant.map((s) => [s.fecha, s.gente, s.maquina]), [["2026-10-26", 12, 6]], "6 h de canteadora × 2 personas, en un día");
  const p50 = normalizarParametros({ ...PARAMS, eficiencia: 50 });
  // 3 h efectivas = 6 h de reloj
  const ef = planHorizonte({ trabajos: [trabajo(1, "A", { armado: 3 })], dias: LUNES, params: p50, base: "capacidad" });
  assert.equal(ef.segmentos[0].gente, 6);
  assert.deepEqual(pendientesPorOt([{ id: 2, ot: "B", etapa: "corte", gente: 6 }]), [{ id: 2, ot: "B", horas: 6, etapas: ["corte"] }]);
});

// 29/10 (Tadeo): "usa un solo cálculo" — lo que se confirma en Planificación es lo que dibuja el Gantt de Proyectos
test("un solo cálculo — el Gantt de Proyectos arma con el plan guardado las mismas fechas que el plan", async () => {
  const { procesosPlan } = await import("../app/lib/ganttPlan.js");
  const { cuerpoPlan } = await import("../app/lib/planGuardado.js");
  const params = normalizarParametros({ ...PARAMS, eficiencia: 80 });
  const personal = { armadores: 2, maxPorOt: 2, ayudantes: { corte: 1 } };
  const trabajos = [
    trabajo(1, "A", { corte: 5, canteado: 7, mecanizado: 3, armado: 9 }),
    trabajo(2, "B", { corte: 3, canteado: 2, armado: 12 }),
    trabajo(3, "C", { corte: 8, mecanizado: 6, armado: 4 }),
  ];
  const plan = planHorizonte({ trabajos, dias: LUNES, params, base: "capacidad", personal });
  const ots = trabajos.map((t) => ({ id: t.id, ot: t.ot }));
  const cuerpo = cuerpoPlan({ per: { tipo: "horizonte", desde: plan.desde, hasta: plan.hasta }, plan, division: null, ots, estado: "confirmado" });
  const procesos = procesosPlan(cuerpo.items, { hoy: "2026-10-26", params, personal });
  for (const t of trabajos) {
    for (const e of ["corte", "canteado", "mecanizado", "armado"]) {
      const segs = plan.segmentos.filter((s) => s.id === t.id && s.etapa === e).map((s) => s.fecha).sort();
      const q = procesos.get(t.ot).procesos.find((x) => x.etapa === e);
      if (!segs.length) { assert.equal(q, undefined); continue; }
      assert.deepEqual([q.desde, q.hasta], [segs[0], segs.at(-1)], `${t.ot} ${e}: el Gantt dibuja los mismos días que el plan`);
    }
  }
  // Con horas extra (según fechas objetivo) también: el Gantt usa los días extra del plan
  const apurado = [{ ...trabajo(1, "A", { armado: 44 }), objetivo: "2026-10-31" }];
  const conExtra = planHorizonte({ trabajos: apurado, dias: LUNES, params: P100, base: "objetivo", modo: "semana_domingo" });
  assert.deepEqual(conExtra.diasExtra.map((d) => d.fecha), ["2026-10-31"]);
  const c2 = cuerpoPlan({ per: { tipo: "horizonte", desde: conExtra.desde, hasta: conExtra.hasta }, plan: conExtra, division: null, ots: [{ id: 1, ot: "A" }], estado: "confirmado" });
  const g2 = procesosPlan(c2.items, { hoy: "2026-10-26", params: P100, diasExtra: new Set(c2.dias_extra.map((d) => d.fecha)) });
  assert.equal(g2.get("A").fin, "2026-10-31", "termina el sábado de horas extra, igual que el plan");
});

// ─── Plan sin límite de semanas (Tadeo, 27/10; migración 143) ───
const { trabajoDelPeriodo } = await import("../app/lib/planAutomatico.js");
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

test("personalGantt — sin puestos, los que pasan de las máquinas a Armado no son más que los operarios", async () => {
  const { personalGantt } = await import("../app/lib/ganttPlan.js");
  const op = (id) => ({ id, rol: "operativo", division: "Muebles", activo: true, diagrama: { lun: LV } });
  const uno = personalGantt([op(1)], DIVISIONES, PARAMS);
  assert.deepEqual(uno.ayudantes, { corte: 1, canteado: 0, mecanizado: 0 }, "con 1 operario no arman 4");
  assert.equal(uno.armadores, 0);
  const ocho = personalGantt([1, 2, 3, 4, 5, 6, 7, 8].map(op), DIVISIONES, PARAMS);
  assert.deepEqual(ocho.ayudantes, { corte: 1, canteado: 2, mecanizado: 2 });
  assert.equal(ocho.armadores, 3);
});

// 29/10 (Tadeo): el Gantt de Planificación no hace falta; el plan se ve en el Gantt de Proyectos
test("📊 Carga — sin Gantt propio: el plan dice cuándo termina cada OT y los días de horas extra", async () => {
  lunes26();
  mockCarga({
    proyectos: [OT(1, "M-7473", { ...OT_A, division: "Muebles", estado: "activo", fecha_objetivo: "2026-10-31" })],
    empleados: [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "10:00" }, mar: { in: "08:00", out: "10:00" }, mie: { in: "08:00", out: "10:00" }, jue: { in: "08:00", out: "10:00" }, vie: { in: "08:00", out: "10:00" } } }],
    cfg: [{ valor: { ...PARAMS, personas_canteadora: 1, maquinas_cnc: 1 } }],
  });
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  const plan = await screen.findByLabelText("Plan automático");
  assert.equal(within(plan).queryByLabelText("Gantt de planificación"), null, "el Gantt está en Proyectos");
  assert.equal(screen.queryByText("Ver el plan de las OT tildadas"), null, "el plan se ve directo");
  assert.match(plan.textContent, /mismo cálculo del Gantt de Proyectos/);
  fireEvent.click(screen.getByText("📅 Según fechas objetivo (SEMANA)"));
  assert.match(within(plan).getByLabelText("Fin de cada OT").textContent, /M-7473 termina el 31\/10\/2026/);
  assert.match(within(plan).getByLabelText("Horas extra por semana").textContent, /sáb\.? 31\/10/);
  fireEvent.click(screen.getByText("🏭 Según capacidad de la planta"));
  assert.match(within(plan).getByLabelText("Fin de cada OT").textContent, /M-7473 termina el \d+\/11\/2026 · después de su semana/);
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

test("📊 Carga — avisa cuántas OT tildadas no tienen precio y cuántas no tienen placas, fondos ni canto", async () => {
  mockConPrecios([{ ot: "M-7473", precio: 2500000 }]);
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-9000").checked, true));
  const avisos = await screen.findByLabelText("Avisos de la planificación");
  await waitFor(() => assert.ok(avisos.querySelector('[data-aviso="precio"]')));
  const tiempos = avisos.querySelector('[data-aviso="tiempos"]');
  assert.match(tiempos.textContent, /1 OT tildada no tiene placas, fondos ni canto/);
  fireEvent.click(within(tiempos).getByText("Ver cuáles ▼"));
  assert.match(tiempos.textContent, /M-9000 · Cliente 2/);
  assert.match(avisos.querySelector('[data-aviso="precio"]').textContent, /1 OT tildada no tiene PRECIO/);
  assert.match(screen.getByLabelText("Planificar OT M-9000").closest("li").textContent, /sin precio/);
  // Destildada, ya no avisa
  fireEvent.click(screen.getByLabelText("Planificar OT M-9000"));
  assert.equal(screen.queryByLabelText("Avisos de la planificación"), null);
});

test("📊 Carga — el supervisor de división ve el aviso de datos pero no el de precio", async () => {
  mockConPrecios([]);
  render(
    <AuthContext.Provider value={{ divisiones: DIVISIONES, etapas: ETAPAS, usuario: { rol: "administrativo", solo_su_division: true } }}>
      <PlanificacionScreen empresaId="emp-1" />
    </AuthContext.Provider>
  );
  const avisos = await screen.findByLabelText("Avisos de la planificación");
  assert.ok(avisos.querySelector('[data-aviso="tiempos"]'));
  assert.equal(avisos.querySelector('[data-aviso="precio"]'), null);
  assert.doesNotMatch(screen.getByLabelText("Planificar OT M-7473").closest("li").textContent, /sin precio/);
});

// ─── Arreglos de Planificación (Tadeo, 27/10) ───
const { ordenEficiente } = await import("../app/lib/planAutomatico.js");

test("ordenEficiente — pone primero la que tiene que llegar a su semana", () => {
  const a = trabajo(1, "A", { armado: 40 });
  const b = conObjetivo(trabajo(2, "B", { armado: 8 }), "2026-10-27");
  const c = conObjetivo(trabajo(3, "C", { armado: 8 }), "2026-11-20");
  const orden = ordenEficiente({ trabajos: [a, c, b], dias: ANIO, params: P100 });
  assert.deepEqual(orden.map((t) => t.ot), ["B", "C", "A"]);
  const plan = planHorizonte({ trabajos: orden, dias: ANIO, params: P100, base: "capacidad" });
  assert.deepEqual(plan.tarde, []);
  // En el orden de prioridad, B no llega
  assert.equal(planHorizonte({ trabajos: [a, c, b], dias: ANIO, params: P100, base: "capacidad" }).tarde[0].ot, "B");
});

test("selectores — el orden elegido llega igual al plan guardado y al Gantt (las 4 combinaciones)", async () => {
  const { cuerpoPlan } = await import("../app/lib/planGuardado.js");
  const { procesosPlan } = await import("../app/lib/ganttPlan.js");
  const a = trabajo(1, "A", { corte: 30, armado: 10 });
  const b = conObjetivo(trabajo(2, "B", { corte: 6, armado: 4 }), "2026-10-30");
  const c = conObjetivo(trabajo(3, "C", { corte: 6, armado: 4 }), "2026-11-13");
  const enMiOrden = [a, c, b];
  for (const forma of ["prioridad", "eficiente"]) {
    const trabajos = forma === "eficiente" ? ordenEficiente({ trabajos: enMiOrden, dias: ANIO, params: P100 }) : enMiOrden;
    for (const base of ["capacidad", "objetivo"]) {
      const plan = planHorizonte({ trabajos, dias: ANIO, params: P100, base });
      const cuerpo = cuerpoPlan({ per: { tipo: "horizonte", desde: plan.desde, hasta: plan.hasta }, plan, division: null, ots: trabajos, estado: "confirmado" });
      const gantt = procesosPlan(cuerpo.items, { etapasCodigo: {}, hoy: "2026-10-26", params: P100 });
      const ordenCorte = [...gantt.values()].sort((x, y) => x.procesos.find((q) => q.etapa === "corte").t0 - y.procesos.find((q) => q.etapa === "corte").t0).map((r) => r.ot);
      assert.deepEqual(ordenCorte, trabajos.map((t) => t.ot), `${forma} + ${base}: el Gantt corta en el mismo orden que el plan`);
      // En mi orden, B (entrega el viernes) queda detrás de 50 h: ni con el sábado llega, y se avisa
      if (forma === "prioridad") assert.deepEqual(plan.tarde.map((t) => t.ot), ["B"], `${forma} + ${base}`);
      else assert.deepEqual(plan.tarde, [], `${forma} + ${base}: en el orden más eficiente todas llegan`);
    }
  }
  // Mi orden respeta lo que puse (A primero aunque B tenga que entregar antes); el más eficiente pone B y C antes
  assert.deepEqual(ordenEficiente({ trabajos: enMiOrden, dias: ANIO, params: P100 }).map((t) => t.ot), ["B", "C", "A"]);
  assert.equal(planHorizonte({ trabajos: enMiOrden, dias: ANIO, params: P100, base: "capacidad" }).tarde[0].ot, "B", "en mi orden y con capacidad, B no llega y se avisa");
});

function mockDosOt({ guardado = null } = {}) {
  mockCarga({
    proyectos: [
      OT(1, "M-7473", { ...OT_A, division: "Muebles", estado: "activo", fecha_objetivo: "2099-01-03", semana_objetivo: 1 }),
      OT(2, "M-9000", { ...OT_A, id: 2, ot: "M-9000", division: "Muebles", estado: "activo", fecha_objetivo: "2099-01-03", semana_objetivo: 1 }),
    ],
    empleados: [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: LV, mar: LV, mie: LV, jue: LV, vie: LV } }],
    cfg: [{ valor: { ...PARAMS } }],
  });
  const base = global.fetch;
  global.fetch = async (url, opts) => (String(url).startsWith("/api/planificacion")
    ? new Response(JSON.stringify({ ok: true, plan: guardado }), { status: 200 })
    : base(url, opts));
}

test("📊 Carga — lo tildado y el switch se recuerdan al volver; por defecto, según capacidad", async () => {
  mockDosOt();
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-9000").checked, true));
  assert.match(screen.getByLabelText("Plan automático").textContent, /Solo el horario normal/, "por defecto, según capacidad");
  fireEvent.click(screen.getByLabelText("Planificar OT M-9000"));
  fireEvent.click(screen.getByText("📅 Según fechas objetivo (SEMANA)"));
  // Se va (por ejemplo al Gantt) y vuelve
  cleanup();
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  assert.equal(screen.getByLabelText("Planificar OT M-9000").checked, false, "no se vuelve a tildar sola");
  assert.match(screen.getByLabelText("Plan automático").textContent, /Cada OT tiene que terminar en su semana/, "queda según fechas objetivo");
  assert.match(within(screen.getByLabelText("Plan automático")).getByLabelText("Fin de cada OT").textContent, /^M-7473 termina/);
  assert.doesNotMatch(within(screen.getByLabelText("Plan automático")).getByLabelText("Fin de cada OT").textContent, /M-9000/, "solo las tildadas");
  cleanup();
  localStorage.clear();
  mockDosOt();
  pantalla();
  await screen.findByLabelText("Plan automático");
  assert.match(screen.getByLabelText("Plan automático").textContent, /Solo el horario normal/, "sin nada guardado: según capacidad");
});

test("📊 Carga — sin nada en este navegador, vienen tildadas las OT del plan guardado", async () => {
  mockDosOt({ guardado: { id: 3, tipo: "horizonte", estado: "confirmado", items: [{ ot: "M-9000", etapa: "corte", fecha: "2026-10-27", horas: 2, orden: 0 }], pendientes: [] } });
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-9000").checked, true));
  assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, false);
});

// 29/10 (Tadeo): un solo criterio. ⚡ ya no es otro orden: pone los números de prioridad
test("📊 Carga — 🧹 borrar prioridades saca el número de todas las OT, con un ¿seguro? antes", async () => {
  mockDosOt();
  const patches = [];
  const base = global.fetch;
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    if (body.method === "PATCH") patches.push([body.path, body.body]);
    return base(url, opts);
  };
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-9000").checked, true));
  const borrar = screen.getByRole("button", { name: "🧹 Borrar prioridades" });
  assert.equal(borrar.disabled, true, "sin números no hay nada que borrar");
  fireEvent.click(screen.getByRole("button", { name: "⚡ Ordenar de la forma más eficiente" }));
  await screen.findByText("✅ Prioridad guardada");
  patches.length = 0;
  fireEvent.click(borrar);
  assert.match(await screen.findByText(/Se borra el número de prioridad de las 2 OT/).then((n) => n.textContent), /¿Seguro\?/);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  assert.deepEqual(patches, [], "al cancelar no se toca nada");
  fireEvent.click(borrar);
  fireEvent.click(await screen.findByRole("button", { name: "Borrar" }));
  await waitFor(() => assert.equal(patches.length, 2));
  assert.deepEqual(patches.sort(), [["proyectos?id=eq.1", { prioridad: null }], ["proyectos?id=eq.2", { prioridad: null }]]);
  assert.equal(screen.getByLabelText("Prioridad de la OT M-7473").value, "");
  assert.equal(screen.getByLabelText("Prioridad de la OT M-9000").value, "");
});

test("conHorasExtra — cada día extra rinde como el día más largo de la grilla", () => {
  const cap = { gente: 10, maquina: 5, personas: 1 };
  const dias = [{ gente: 2, maquina: 2 }, { gente: 8, maquina: 9 }, { gente: 0, maquina: 0 }];
  assert.deepEqual(conHorasExtra(cap, 0, dias), { ...cap, horasExtra: 0, diasExtra: 0 });
  assert.deepEqual(conHorasExtra(cap, 2, dias), { gente: 26, maquina: 23, personas: 1, horasExtra: 16, diasExtra: 2 });
});

test("📊 Carga — ⚡ ordenar de la forma más eficiente pone los números de prioridad", async () => {
  mockDosOt();
  const patches = [];
  const base = global.fetch;
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    if (body.method === "PATCH") patches.push([body.path, body.body]);
    return base(url, opts);
  };
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-9000").checked, true));
  assert.equal(screen.queryByText("⚡ La forma más eficiente"), null, "ya no hay dos formas de ordenar");
  assert.match(screen.getByLabelText("Plan automático").textContent, /en el orden del paso ②/);
  fireEvent.click(screen.getByRole("button", { name: "⚡ Ordenar de la forma más eficiente" }));
  await screen.findByText("✅ Prioridad guardada");
  assert.deepEqual(patches.sort(), [["proyectos?id=eq.1", { prioridad: 1 }], ["proyectos?id=eq.2", { prioridad: 2 }]]);
  assert.equal(screen.getByLabelText("Prioridad de la OT M-7473").value, "1");
  assert.equal(screen.getByLabelText("Prioridad de la OT M-9000").value, "2");
});
