// tests/planificacion.test.jsx — Planificación de la producción, parte 38
// (migración 137; diseño en notes/diseno-planificacion-produccion.md):
// parámetros de la planta y prioridad manual de las OT, que gerencia ordena
// arrastrándolas en una lista.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import {
  normalizarParametros, leerNumero, errorParametro, PARAMETROS, parametrosFaltantes,
  divisionPlan, etapasPlanDe, otsPlanificables, ordenarPorPrioridad, moverOt, quitarPrioridad, cambiosPrioridad,
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

function mockData({ proyectos = [], cfg = [] } = {}) {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    pedidos.push(body);
    const path = body.path || "";
    if (body.method === "GET" && path.startsWith("proyectos")) return new Response(JSON.stringify({ data: path.includes("offset=0") ? proyectos : [] }), { status: 200 });
    if (body.method === "GET" && path.startsWith("config_sistema")) return new Response(JSON.stringify({ data: cfg }), { status: 200 });
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
  min_placa: 10, min_metro_canto: 1, min_mecanizado_placa: 15, min_armado_gabinete: 60, eficiencia: 80,
  pct_mecanizado: 50, gabinetes_por_placa: 0.5, etapas: { corte: 1, canteado: 2, mecanizado: 3, armado: 4 },
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

test("📊 Carga — tildadas las del período; dice si entra, las horas extra y el cuello de botella", async () => {
  mockCarga({
    proyectos: [
      OT(1, "M-7473", { ...OT_A, division: "Muebles", estado: "activo", fecha_objetivo: "2020-01-04", semana_objetivo: 1 }),
      OT(2, "M-9000", { division: "Muebles", fecha_objetivo: "2099-12-31", placas: 1 }),
    ],
    // Un solo operario 2 h el lunes: no alcanza
    empleados: [{ id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "10:00" } } }],
    cfg: [{ valor: { ...PARAMS } }],
  });
  pantalla();
  const carga = await screen.findByRole("region", { name: "Carga de la planta" });
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  assert.equal(screen.getByLabelText("Planificar OT M-9000").checked, false);
  assert.match(carga.textContent, /❌ No entra con el horario normal/);
  assert.match(carga.textContent, /⏱ Horas extra: 9,9 h/);
  assert.match(carga.textContent, /Cuello de botella: Gente/);
  assert.match(carga.textContent, /Seccionadora: faltan 0,5 h de máquina/);
  fireEvent.click(screen.getByLabelText("Planificar OT M-7473"));
  assert.match(carga.textContent, /Elegí las OT que querés planificar/);
  fireEvent.click(screen.getByLabelText("Período siguiente"));
  assert.match(carga.textContent, /Semana del/);
});

test("📊 Carga — sin parámetros avisa qué falta cargar", async () => {
  mockCarga({ proyectos: [], empleados: [], cfg: [] });
  pantalla();
  assert.ok(await screen.findByText("Faltan parámetros"));
  fireEvent.click(screen.getByText("Cargar parámetros"));
  assert.ok(await screen.findByRole("region", { name: "Parámetros de la planificación" }));
});
