// tests/diseno-tecnica-confirmar.test.jsx — Gantt 📐 Diseño y Técnica, parte 50:
// ordenar, elegir arquitecta y confirmar el plan (migración 161) y 📐 Mis
// planillas de cada arquitecta (/api/diseno-tecnica).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { normalizarDisenoTecnica } from "../app/lib/planificacion.js";
import { planDisenoTecnica, planDeEmpresa, conCambio, cuerposConfirmar, hayConfirmado, misPlanillas, renglonCorto, entregasComprometidas } from "../app/lib/planDisenoTecnica.js";
import { validarPatch } from "../app/lib/dataPolicy.js";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

const { default: GanttDisenoTecnica, AVISO_MIGRACION_161 } = await import("../app/components/GanttDisenoTecnica.jsx");
const { default: MisPlanillas, detalleMisPlanillas, textoPlanilla } = await import("../app/components/MisPlanillas.jsx");

const sinRed = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
global.fetch = sinRed;
afterEach(() => { cleanup(); global.fetch = sinRed; });

const LUNES = "2026-11-09";
const PERSONAL = [{ id: 11, nombre: "Georgina Rossi" }, { id: 12, nombre: "María José Torres" }, { id: 13, nombre: "Sofía Scarafiocca" }];
const VALOR_DT = { dias_diseno: 2, horas_dia: 9, horas: { cocina: { B: 9 } }, arquitectas: [{ id: "11", pct_tecnica: 0 }, { id: "12", pct_tecnica: 100 }, { id: "13", pct_tecnica: 85 }] };
const DT = normalizarDisenoTecnica(VALOR_DT);
const falta = { e: "falta" };
const hecho = (q) => ({ e: "hecho", q });
const TODO_FALTA = { dis: falta, skp: falta, info: falta, relev: falta, np: falta, nf: falta, excel: falta, pdf: falta };
const SOLO_TECNICA = { dis: hecho("GR"), np: hecho("GR"), nf: falta, excel: falta, pdf: falta };
const OT = (ot, extra = {}) => ({ id: ot, ot, descripcion: "COCINA", clase_auto: "B", estado: "activo", etapas_diseno: TODO_FALTA, ...extra });

test("plan — el orden confirmado manda sobre la prioridad; las sin orden van después", () => {
  const proyectos = [OT("M-1", { prioridad: 1 }), OT("M-2", { prioridad: 2, orden_tecnica: 2 }), OT("M-3", { prioridad: 3, orden_tecnica: 1 })];
  const { renglones } = planDisenoTecnica({ proyectos, dt: DT, personal: PERSONAL, hoy: LUNES });
  assert.deepEqual(renglones.map((r) => r.ot), ["M-3", "M-2", "M-1"]);
});

test("plan — la arquitecta elegida hace la planilla; las iniciales del Plan mandan sobre la elegida", () => {
  const proyectos = [
    OT("M-1", { etapas_diseno: SOLO_TECNICA, arquitecta_tecnica: "13" }),
    OT("M-2", { etapas_diseno: { ...SOLO_TECNICA, nf: hecho("MJT") }, arquitecta_tecnica: "13" }),
    OT("M-3", { etapas_diseno: SOLO_TECNICA, arquitecta_tecnica: "11" }), // GR no hace Técnica: automática
  ];
  const { renglones } = planDisenoTecnica({ proyectos, dt: DT, personal: PERSONAL, hoy: LUNES });
  const [m1, m2, m3] = renglones;
  assert.equal(m1.arquitecta, "Sofía Scarafiocca");
  assert.equal(m1.arquitectaPlan, false);
  assert.equal(m2.arquitecta, "María José Torres");
  assert.equal(m2.arquitectaPlan, true);
  assert.equal(m3.arquitecta, "María José Torres");
});

test("plan — cuánto se corrió la Técnica desde lo confirmado, en días hábiles", () => {
  const proyectos = [
    OT("M-1", { etapas_diseno: SOLO_TECNICA, tecnica_fin_confirmado: "2026-11-05" }), // termina lunes 09: jueves→ viernes 06 y lunes 09 = 2
    OT("M-2", { etapas_diseno: SOLO_TECNICA, tecnica_fin_confirmado: "2026-11-20" }),
  ];
  const { renglones } = planDisenoTecnica({ proyectos, dt: DT, personal: PERSONAL, hoy: LUNES });
  assert.equal(renglones[0].tecnica.fin, LUNES);
  assert.equal(renglones[0].corrido, 2);
  assert.equal(renglones[1].corrido, 0, "adelantada no cuenta");
  assert.equal(hayConfirmado(renglones), true);
  assert.equal(hayConfirmado([{ proyecto: OT("M-9") }]), false);
});

test("conCambio y cuerposConfirmar — vista previa y lo que se guarda en cada OT", () => {
  const proyectos = [OT("M-1", { etapas_diseno: SOLO_TECNICA }), OT("M-2", { etapas_diseno: SOLO_TECNICA, arquitecta_tecnica: "12" }), OT("M-3")];
  const cambiados = conCambio(proyectos, { orden: ["M-2", "M-1"], arquitectas: { "M-1": "13", "M-2": null } });
  assert.equal(cambiados[0].orden_tecnica, 2);
  assert.equal(cambiados[0].arquitecta_tecnica, "13");
  assert.equal(cambiados[1].orden_tecnica, 1);
  assert.equal(cambiados[1].arquitecta_tecnica, null);
  assert.equal(cambiados[2], proyectos[2], "sin cambio queda igual");
  assert.equal(conCambio(proyectos, null), proyectos);
  const { renglones } = planDisenoTecnica({ proyectos: cambiados, dt: DT, personal: PERSONAL, hoy: LUNES });
  const cuerpos = cuerposConfirmar(renglones);
  assert.deepEqual(cuerpos.map((c) => [c.ot, c.cuerpo.orden_tecnica, c.cuerpo.arquitecta_tecnica]), [["M-2", 1, null], ["M-1", 2, "13"], ["M-3", 3, null]]);
  assert.equal(cuerpos[1].cuerpo.tecnica_fin_confirmado, renglones[1].tecnica.fin);
  assert.equal(cuerpos[0].id, "M-2");
});

test("misPlanillas — las planillas de la arquitecta en orden y lo que tiene en Diseño", () => {
  const proyectos = [
    OT("M-1", { etapas_diseno: SOLO_TECNICA, arquitecta_tecnica: "12", cliente: "Juan", obra: "Torre" }),
    OT("M-2", { etapas_diseno: { ...TODO_FALTA, dis: hecho("GR") } }),
    OT("M-3", { etapas_diseno: SOLO_TECNICA, arquitecta_tecnica: "13" }),
  ];
  const plan = planDeEmpresa({ proyectos, cfgValor: { diseno_tecnica: VALOR_DT }, personal: PERSONAL, hoy: LUNES });
  const mjt = misPlanillas(plan, 12);
  assert.equal(mjt.es, true);
  assert.equal(mjt.nombre, "María José Torres");
  assert.ok(mjt.tecnica.map((r) => r.ot).includes("M-1"));
  assert.ok(!mjt.tecnica.map((r) => r.ot).includes("M-3"));
  const gr = misPlanillas(plan, "11");
  assert.deepEqual(gr.diseno.map((r) => r.ot), ["M-2"]);
  assert.deepEqual(gr.tecnica, []);
  assert.equal(misPlanillas(plan, "99").es, false);
  const corto = renglonCorto(mjt.tecnica[0]);
  assert.equal(corto.ot, "M-1");
  assert.equal(corto.cliente, "Juan");
  assert.equal(corto.tecnica.horas, 9);
  assert.equal(corto.etapas_diseno, undefined, "no manda la fila entera de la OT");
});

test("dataPolicy — valida orden, arquitecta y fecha confirmada (161)", () => {
  assert.equal(validarPatch("proyectos", { orden_tecnica: 3, arquitecta_tecnica: "12", tecnica_fin_confirmado: "2026-11-20" }, {}), null);
  assert.equal(validarPatch("proyectos", { orden_tecnica: null, arquitecta_tecnica: null, tecnica_fin_confirmado: null }, {}), null);
  assert.equal(validarPatch("proyectos", { orden_tecnica: 0 }, {})?.status, 400);
  assert.equal(validarPatch("proyectos", { orden_tecnica: 1.5 }, {})?.status, 400);
  assert.equal(validarPatch("proyectos", { arquitecta_tecnica: "" }, {})?.status, 400);
  assert.equal(validarPatch("proyectos", { tecnica_fin_confirmado: "20/11/2026" }, {})?.status, 400);
  const m = MIGRACIONES.find((x) => x.n === 161);
  assert.deepEqual(m.tablas.proyectos, ["orden_tecnica", "arquitecta_tecnica", "tecnica_fin_confirmado"]);
  const sql = readFileSync(new URL("../supabase/migrations/161_diseno_tecnica_confirmado.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /add column if not exists tecnica_fin_confirmado date/);
});

/** Plan como el que arma usePlanDisenoTecnica, con rehacer para la vista previa. */
const calculoDe = (proyectos) => {
  const armar = (lista) => planDeEmpresa({ proyectos: lista, cfgValor: { diseno_tecnica: VALOR_DT }, personal: PERSONAL, hoy: LUNES });
  return { ...armar(proyectos), rehacer: (cambio) => armar(conCambio(proyectos, cambio)) };
};

test("Gantt 📐 — gerencia ordena, ve la vista previa, elige arquitecta y confirma", async () => {
  const llamadas = [];
  global.fetch = async (url, opts = {}) => {
    const b = JSON.parse(opts.body || "{}");
    if (b.method === "PATCH") llamadas.push(b);
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  const proyectos = [OT("M-1", { etapas_diseno: SOLO_TECNICA, prioridad: 1 }), OT("M-2", { etapas_diseno: SOLO_TECNICA, prioridad: 2 })];
  let refrescos = 0;
  render(<GanttDisenoTecnica calculo={calculoDe(proyectos)} puedeReordenar onRefrescar={async () => { refrescos++; }} />);
  assert.match(screen.getByLabelText("Ordenar y confirmar el plan de Diseño y Técnica").textContent, /Todavía no confirmaste un plan/);
  fireEvent.click(screen.getByRole("button", { name: "✏ Ordenar y asignar" }));
  const lista = screen.getByLabelText("Orden de las planillas");
  assert.deepEqual([...lista.querySelectorAll("[data-orden-ot]")].map((li) => li.getAttribute("data-orden-ot")), ["M-1", "M-2"]);
  fireEvent.click(screen.getByRole("button", { name: "Bajar la OT M-1" }));
  assert.match(screen.getByLabelText("Ordenar y confirmar el plan de Diseño y Técnica").textContent, /Vista previa/);
  assert.deepEqual([...screen.getByLabelText("Orden de las planillas").querySelectorAll("[data-orden-ot]")].map((li) => li.getAttribute("data-orden-ot")), ["M-2", "M-1"]);
  // M-1 a Sofía
  fireEvent.change(screen.getByLabelText("Arquitecta de la OT M-1"), { target: { value: "13" } });
  assert.match(screen.getByRole("button", { name: /^OT M-1, / }).getAttribute("aria-label"), /Sofía Scarafiocca/);
  fireEvent.click(screen.getByRole("button", { name: "✅ Confirmar plan" }));
  await waitFor(() => assert.match(screen.getByRole("status").textContent, /Plan confirmado: 2 OT/));
  assert.equal(refrescos, 1);
  const porId = Object.fromEntries(llamadas.map((l) => [l.path, l.body]));
  assert.equal(porId["proyectos?id=eq.M-2"].orden_tecnica, 1);
  assert.equal(porId["proyectos?id=eq.M-1"].orden_tecnica, 2);
  assert.equal(porId["proyectos?id=eq.M-1"].arquitecta_tecnica, "13");
  assert.match(porId["proyectos?id=eq.M-1"].tecnica_fin_confirmado, /^2026-11-\d\d$/);
});

test("Gantt 📐 — sin la 161 avisa; sin permiso no se puede ordenar; muestra lo que se corrió", async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: "column proyectos.orden_tecnica does not exist" }), { status: 400 });
  const proyectos = [OT("M-1", { etapas_diseno: SOLO_TECNICA, tecnica_fin_confirmado: "2026-11-05", orden_tecnica: 1 })];
  render(<GanttDisenoTecnica calculo={calculoDe(proyectos)} puedeReordenar />);
  assert.match(screen.getByLabelText("Ordenar y confirmar el plan de Diseño y Técnica").textContent, /1 planilla se corrió/);
  assert.match(screen.getByRole("button", { name: /^OT M-1, / }).getAttribute("aria-label"), /se corrió 2 días hábiles desde el plan confirmado/);
  fireEvent.click(screen.getByRole("button", { name: "✅ Confirmar plan" }));
  await waitFor(() => assert.equal(screen.getByRole("status").textContent, AVISO_MIGRACION_161));
  cleanup();
  render(<GanttDisenoTecnica calculo={calculoDe(proyectos)} />);
  assert.equal(screen.queryByRole("button", { name: "✅ Confirmar plan" }), null);
});

const DATOS = {
  es: true, nombre: "María José Torres", pctTecnica: 100, horasDia: 9,
  tecnica: [
    { ot: "M-1", clase: "B", tipo: "cocina", cliente: "Juan", obra: "Torre", descripcion: "COCINA", tecnica: { inicio: "2026-11-09", fin: "2026-11-10", horas: 12, pct: 33 }, corrido: 0 },
    { ot: "M-2", clase: "A", tipo: "cocina", cliente: "Ana", descripcion: "COCINA", tecnica: { inicio: "2026-11-11", fin: "2026-11-13", horas: 20, pct: 0 }, corrido: 2 },
  ],
  diseno: [],
};

test("📐 Mis planillas — en orden, la de ahora destacada y lo que se corrió", () => {
  assert.equal(detalleMisPlanillas(DATOS), "2 planillas · ahora la OT M-1, hasta el 10/11/2026");
  assert.equal(detalleMisPlanillas({ ...DATOS, tecnica: [] }), "Sin planillas por ahora");
  assert.match(textoPlanilla(DATOS.tecnica[1]), /faltan 20 h · ↪ se corrió 2 días hábiles desde lo confirmado$/);
  render(<MisPlanillas datos={DATOS} onClose={() => {}} />);
  const items = document.querySelectorAll("[data-planilla]");
  assert.deepEqual([...items].map((li) => li.getAttribute("data-planilla")), ["M-1", "M-2"]);
  assert.match(items[0].textContent, /▶ Ahora/);
  assert.match(items[0].textContent, /lleva 33 %/);
  assert.match(screen.getByText(/Planillas técnicas · 2/).textContent, /2/);
});

test("📐 Mis planillas — en el Inicio del operario y en el Panel; la ruta solo devuelve lo suyo", () => {
  const home = readFileSync(new URL("../app/components/screens/HomeEmp.jsx", import.meta.url), "utf8");
  assert.match(home, /useMisPlanillas\(conProyectos\)/);
  assert.match(home, /titulo="Mis planillas"/);
  const panel = readFileSync(new URL("../app/dashboard_gerencia.jsx", import.meta.url), "utf8");
  assert.match(panel, /<TarjetaMisPlanillas \/>/);
  const ruta = readFileSync(new URL("../app/api/diseno-tecnica/route.js", import.meta.url), "utf8");
  assert.match(ruta, /misPlanillas\(plan, sesion\.empleado_id\)/);
  assert.match(ruta, /\{ sesion \}/);
  assert.match(ruta, /renglonCorto/);
});

// ─── 05/11: pantalla completa y arrastrar en el Gantt sin comprometer entregas ───

const SOLO_MJT = { ...VALOR_DT, arquitectas: [{ id: "12", pct_tecnica: 100 }] };
const calculoMjt = (proyectos) => {
  const armar = (lista) => planDeEmpresa({ proyectos: lista, cfgValor: { diseno_tecnica: SOLO_MJT }, personal: PERSONAL, hoy: LUNES });
  return { ...armar(proyectos), rehacer: (cambio) => armar(conCambio(proyectos, cambio)) };
};
// M-1 tiene que entrar a Producción el martes 10 (límite de Técnica lunes 09); M-2 tiene tiempo
const VIVO = { renglones: [
  { ot: "M-1", inicio: "2026-11-11", fin: "2026-11-11", objetivo: "2026-11-10" },
  { ot: "M-2", inicio: "2026-11-20", fin: "2026-11-20", objetivo: "2026-12-30" },
  { ot: "M-3", inicio: "2026-11-20", fin: "2026-11-20", objetivo: "2026-12-30" },
] };
const TRES = () => [OT("M-1", { etapas_diseno: SOLO_TECNICA, prioridad: 1 }), OT("M-2", { etapas_diseno: SOLO_TECNICA, prioridad: 2 }), OT("M-3", { etapas_diseno: SOLO_TECNICA, prioridad: 3 })];

test("entregasComprometidas — la OT que pasaría su fecha límite; sin plan de Producción no bloquea", () => {
  const c = calculoMjt(TRES());
  assert.deepEqual(c.renglones.map((r) => r.tecnica.fin), ["2026-11-09", "2026-11-10", "2026-11-11"]);
  const peor = c.rehacer({ orden: ["M-2", "M-1", "M-3"], arquitectas: {} });
  const malas = entregasComprometidas(c, peor, VIVO);
  assert.deepEqual(malas.map((m) => [m.ot, m.diasTarde, m.limite]), [["M-1", 1, "2026-11-09"]]);
  assert.deepEqual(entregasComprometidas(c, c.rehacer({ orden: ["M-1", "M-3", "M-2"], arquitectas: {} }), VIVO), []);
  assert.deepEqual(entregasComprometidas(c, peor, null), []);
  // Si ya venía tarde, solo cuenta si queda peor
  assert.deepEqual(entregasComprometidas(peor, peor, VIVO), []);
});

test("Gantt 📐 — no deja mover una OT si otra no llega a su entrega; arrastrando desde ⠿ sí reordena", async () => {
  render(<GanttDisenoTecnica calculo={calculoMjt(TRES())} vivo={VIVO} puedeReordenar />);
  const orden = () => [...document.querySelectorAll("g[data-orden-ot]")].map((g) => g.getAttribute("data-orden-ot"));
  assert.deepEqual(orden(), ["M-1", "M-2", "M-3"]);
  // Arrastrar M-1 debajo de M-2: M-1 pasaría su fecha límite
  const soltarSobre = (desde, hasta) => {
    const destino = document.querySelector(`g[data-orden-ot="${hasta}"]`);
    document.elementFromPoint = () => destino;
    fireEvent.pointerDown(document.querySelector(`[data-arrastrar="${desde}"]`), { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(destino, { pointerId: 1, clientX: 5, clientY: 60 });
    fireEvent.pointerUp(destino, { pointerId: 1 });
  };
  soltarSobre("M-1", "M-2");
  assert.match(screen.getByRole("status").textContent, /⛔ No se puede mover la OT M-1 ahí: la OT M-1 · COCINA terminaría la Técnica 1 día hábil después de su fecha límite \(9\/11\/2026\)/);
  assert.deepEqual(orden(), ["M-1", "M-2", "M-3"], "no cambió");
  // M-3 antes que M-2 no compromete nada: queda la vista previa
  soltarSobre("M-3", "M-2");
  assert.deepEqual(orden(), ["M-1", "M-3", "M-2"]);
  assert.match(screen.getByLabelText("Ordenar y confirmar el plan de Diseño y Técnica").textContent, /Vista previa/);
  delete document.elementFromPoint;
});

test("Gantt 📐 — ⛶ Pantalla completa abre y ✕ Salir cierra; sin permiso no hay ⠿", () => {
  render(<GanttDisenoTecnica calculo={calculoMjt(TRES())} />);
  assert.equal(document.querySelector("[data-arrastrar]"), null);
  fireEvent.click(screen.getByRole("button", { name: "⛶ Pantalla completa" }));
  assert.ok(screen.getByRole("dialog", { name: "Gantt de Diseño y Técnica" }));
  // En el celular los colores y la carga tapaban el Gantt: quedan en ☰ Opciones (05/11)
  assert.equal(screen.queryByLabelText("Colores del Gantt de Diseño y Técnica"), null);
  fireEvent.click(screen.getByRole("button", { name: "☰ Opciones" }));
  assert.ok(screen.getByLabelText("Colores del Gantt de Diseño y Técnica"));
  fireEvent.click(screen.getByRole("button", { name: "✕ Salir" }));
  assert.equal(screen.queryByRole("dialog"), null);
  const ganttOt = readFileSync(new URL("../app/components/GanttOt.jsx", import.meta.url), "utf8");
  assert.match(ganttOt, /from "\.\.\/lib\/pantallaCompleta"/);
});
