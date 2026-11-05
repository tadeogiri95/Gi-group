// tests/gantt-diseno-tecnica.test.jsx — Gantt 📐 Diseño y Técnica, parte 48
// (app/lib/planDisenoTecnica.js, app/components/GanttDisenoTecnica.jsx).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { normalizarDisenoTecnica } from "../app/lib/planificacion.js";
import { planDisenoTecnica, sonSusIniciales, inicialesDe, barrasSeguidas, ordenDiseno, finDelPlan } from "../app/lib/planDisenoTecnica.js";

const { default: GanttDisenoTecnica, textoRenglon } = await import("../app/components/GanttDisenoTecnica.jsx");

const sinRed = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
global.fetch = sinRed;
afterEach(() => { cleanup(); global.fetch = sinRed; });

const LUNES = "2026-11-09";
const PERSONAL = [{ id: 11, nombre: "Georgina Rossi" }, { id: 12, nombre: "María José Torres" }, { id: 13, nombre: "Sofía Scarafiocca" }];
const DT = normalizarDisenoTecnica({
  dias_diseno: 2, horas_dia: 9,
  horas: { cocina: { B: 9 } },
  arquitectas: [{ id: "11", pct_tecnica: 0 }, { id: "12", pct_tecnica: 100 }, { id: "13", pct_tecnica: 85 }],
});
const falta = { e: "falta" };
const hecho = (q) => ({ e: "hecho", q });
const TODO_FALTA = { dis: falta, skp: falta, info: falta, relev: falta, np: falta, nf: falta, excel: falta, pdf: falta };
const OT = (ot, extra = {}) => ({ id: ot, ot, descripcion: "COCINA", clase_auto: "B", estado: "activo", etapas_diseno: TODO_FALTA, ...extra });

test("iniciales — iguales o con la misma primera y última letra", () => {
  assert.equal(inicialesDe("María José Torres"), "MJT");
  assert.equal(sonSusIniciales("MJT", "María José Torres"), true);
  assert.equal(sonSusIniciales("SLS", "Sofía Scarafiocca"), true);
  assert.equal(sonSusIniciales("gr", "Georgina Rossi"), true);
  assert.equal(sonSusIniciales("GR", "Sofía Scarafiocca"), false);
  assert.equal(sonSusIniciales("S", "Sofía Scarafiocca"), false);
});

test("plan — Diseño en paralelo, Técnica de a una planilla por arquitecta y la que termina antes", () => {
  const proyectos = [
    OT("M-2", { prioridad: 2 }),
    OT("M-3", { prioridad: 3 }),
    // Diseño hecho y EXCEL hecho por MJT: sigue con ella, falta 2/3 de las 9 h = 6 h
    OT("M-1", { prioridad: 1, etapas_diseno: { dis: hecho("GR"), np: hecho("GR"), nf: falta, excel: hecho("MJT"), pdf: falta } }),
  ];
  const { renglones, arquitectas } = planDisenoTecnica({ proyectos, dt: DT, personal: PERSONAL, hoy: LUNES });
  assert.deepEqual(renglones.map((r) => r.ot), ["M-1", "M-2", "M-3"], "por prioridad de Producción");
  const [m1, m2, m3] = renglones;
  assert.equal(m1.diseno, null);
  assert.equal(m1.arquitecta, "María José Torres");
  assert.equal(m1.tecnica.horas, 6);
  assert.deepEqual(m1.tecnica.tramos.map((z) => [z.fecha, Number(z.hasta.toFixed(3))]), [["2026-11-09", 0.667]]);
  // Diseño de 2 días (lunes y martes) en las dos OT a la vez
  assert.equal(m2.diseno.inicio, "2026-11-09");
  assert.equal(m2.diseno.fin, "2026-11-10");
  assert.equal(m3.diseno.fin, "2026-11-10");
  // Técnica arranca el miércoles: MJT (9 h por día) la termina ese día
  assert.equal(m2.arquitecta, "María José Torres");
  assert.equal(m2.tecnica.inicio, "2026-11-11");
  assert.equal(m2.tecnica.fin, "2026-11-11");
  // MJT ocupada: SLS (85 % = 7,65 h por día) la termina el jueves temprano, antes que MJT
  assert.equal(m3.arquitecta, "Sofía Scarafiocca");
  assert.equal(m3.tecnica.inicio, "2026-11-11");
  assert.equal(m3.tecnica.fin, "2026-11-12");
  assert.equal(arquitectas.length, 3);
  assert.equal(finDelPlan(renglones, LUNES), "2026-11-12");
  assert.match(textoRenglon(m3), /^OT M-3, clase B, Diseño del .+ \(2 días hábiles\), Técnica del .+ \(9 h, Sofía Scarafiocca\)$/);
});

test("plan — saltea fines de semana y feriados; afuera las terminadas, en pausa y sin columnas", () => {
  const dt = normalizarDisenoTecnica({ ...DT, dias_diseno: 3 });
  const proyectos = [
    OT("M-1"), // Diseño jueves, viernes y (feriado el lunes) martes
    OT("M-2", { etapas_diseno: { dis: hecho("GR"), nf: hecho("MJT"), excel: hecho("MJT"), pdf: hecho("MJT") } }),
    OT("M-3", { etapas_diseno: null }),
    OT("M-4"),
    OT("M-5", { descripcion: "PLACARD", etapas_diseno: { dis: hecho("GR"), nf: falta } }),
  ];
  const r = planDisenoTecnica({ proyectos, dt, personal: PERSONAL, hoy: "2026-11-12", feriados: new Set(["2026-11-16"]), pausadas: new Set(["M-4"]) });
  assert.deepEqual(r.renglones.map((x) => x.ot), ["M-1", "M-5"]);
  assert.deepEqual(r.renglones[0].diseno.tramos.map((z) => z.fecha), ["2026-11-12", "2026-11-13", "2026-11-17"]);
  assert.equal(r.terminadas, 1);
  assert.equal(r.sinEtapas, 1);
  assert.deepEqual(r.sinDato.map((x) => x.ot), ["M-5"], "Placard B no tiene horas cargadas");
  assert.equal(r.renglones[1].faltanHoras, true);
  assert.match(textoRenglon(r.renglones[1]), /faltan las horas de Técnica/);
});

test("plan — sin arquitectas de Técnica la OT queda marcada", () => {
  const dt = normalizarDisenoTecnica({ ...DT, arquitectas: [{ id: "11", pct_tecnica: 0 }] });
  const r = planDisenoTecnica({ proyectos: [OT("M-1")], dt, personal: PERSONAL, hoy: LUNES });
  assert.equal(r.renglones[0].sinArquitecta, true);
  assert.match(textoRenglon(r.renglones[0]), /Técnica sin arquitecta/);
});

test("barrasSeguidas y ordenDiseno", () => {
  const b = barrasSeguidas([
    { fecha: "2026-11-09", desde: 0.5, hasta: 1 }, { fecha: "2026-11-10", desde: 0, hasta: 1 },
    { fecha: "2026-11-11", desde: 0, hasta: 0.3 }, { fecha: "2026-11-13", desde: 0, hasta: 1 },
  ]);
  assert.equal(b.length, 2);
  assert.equal(b[0].hasta.fecha, "2026-11-11");
  const orden = ordenDiseno([{ ot: "M-9", fecha_objetivo: "2026-12-01" }, { ot: "M-2" }, { ot: "M-5", prioridad: 1 }, { ot: "M-10", fecha_objetivo: "2026-12-01" }]);
  assert.deepEqual(orden.map((p) => p.ot), ["M-5", "M-9", "M-10", "M-2"]);
});

test("Gantt — un renglón por OT con sus barras y la carga de cada arquitecta", async () => {
  global.fetch = async (url, opts = {}) => {
    const { path } = JSON.parse(opts.body || "{}");
    if (String(path).startsWith("config_sistema")) return new Response(JSON.stringify({ data: [{ valor: { diseno_tecnica: { dias_diseno: 2, horas: { cocina: { B: 9 } }, arquitectas: [{ id: "12", pct_tecnica: 100 }] } } }] }), { status: 200 });
    if (String(path).startsWith("empleados")) return new Response(JSON.stringify({ data: String(path).includes("offset=0") ? PERSONAL : [] }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  const vistos = [];
  render(<GanttDisenoTecnica proyectos={[OT("M-7900"), OT("M-7901", { descripcion: "PLACARD" }), OT("M-7902", { estado: "cerrado" })]} onVerDetalle={(p) => vistos.push(p.ot)} />);
  const fila = await screen.findByRole("button", { name: /^OT M-7900, clase B, Diseño del/ });
  assert.match(fila.getAttribute("aria-label"), /Técnica del .+ \(9 h, María José Torres\)/);
  assert.ok(fila.querySelector('[data-barra="diseno-M-7900"]'));
  assert.ok(fila.querySelector('[data-barra="tecnica-M-7900"]'));
  assert.ok(screen.getByRole("button", { name: /^OT M-7901, clase B, Diseño del .+, ⚠ faltan las horas de Técnica$/ }));
  assert.equal(screen.queryByRole("button", { name: /^OT M-7902/ }), null, "las cerradas no entran");
  assert.match(screen.getByLabelText("Carga de las arquitectas").textContent, /María José Torres · 100 % Técnica · 1 OT · ocupada hasta el/);
  assert.match(screen.getByText(/Sin horas de Técnica · 1/).textContent, /1/);
  fireEvent.click(fila);
  await waitFor(() => assert.deepEqual(vistos, ["M-7900"]));
});

test("Gantt — sin arquitectas avisa dónde elegirlas; GanttOt tiene el selector 📐", async () => {
  render(<GanttDisenoTecnica proyectos={[OT("M-1")]} />);
  assert.ok(await screen.findByText(/Todavía no hay arquitectas de Técnica/));
  const src = readFileSync(new URL("../app/components/GanttOt.jsx", import.meta.url), "utf8");
  assert.match(src, /📐 Diseño y Técnica<\/Chip>/);
  assert.match(src, /tipo === "diseno" && \(\s*<GanttDisenoTecnica/);
});
