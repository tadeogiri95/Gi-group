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
