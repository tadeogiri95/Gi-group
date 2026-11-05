// tests/gantt-instalacion.test.jsx — 🔧 Gantt de instalación (parte 43;
// app/lib/planInstalacion.js, app/components/GanttInstalacion.jsx): cada OT
// entra el día hábil siguiente al fin de producción, las OT de una obra van
// juntas, de a medio día, con la grilla de cada instalador.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { normalizarParametros } from "../app/lib/planificacion.js";
import { trabajosInstalacion, planInstalacion, diaHabilSiguiente, trabajaElDia, claveObra, diasDeObra, ordenarTrabajos } from "../app/lib/planInstalacion.js";

const { default: GanttInstalacion } = await import("../app/components/GanttInstalacion.jsx");

const sinRed = async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
global.fetch = sinRed;
afterEach(() => { cleanup(); global.fetch = sinRed; });

const params = normalizarParametros({ instalacion: { gab_por_dia: { global: 3 } } });
const LV = { lun: { in: "08:00", out: "16:00" }, mar: { in: "08:00", out: "16:00" }, mie: { in: "08:00", out: "16:00" }, jue: { in: "08:00", out: "16:00" }, vie: { in: "08:00", out: "16:00" } };
const hoy = "2026-11-03"; // martes

test("diaHabilSiguiente — salta fines de semana y feriados", () => {
  assert.equal(diaHabilSiguiente("2026-11-06"), "2026-11-09"); // viernes → lunes
  assert.equal(diaHabilSiguiente("2026-11-03"), "2026-11-04");
  assert.equal(diaHabilSiguiente("2026-11-06", new Set(["2026-11-09"])), "2026-11-10");
});

test("trabajaElDia — la grilla del instalador; sábado si lo tiene cargado; sin grilla, lunes a viernes", () => {
  assert.equal(trabajaElDia({ diagrama: LV }, "2026-11-07"), false);
  assert.equal(trabajaElDia({ diagrama: { ...LV, sab: { in: "08:00", out: "12:00" } } }, "2026-11-07"), true);
  assert.equal(trabajaElDia({}, "2026-11-09"), true);
  assert.equal(trabajaElDia({ diagrama: LV }, "2026-11-09", new Set(["2026-11-09"])), false);
});

test("trabajosInstalacion — entra con fin de producción + 1 día hábil; una obra con varias OT suma gente", () => {
  const proyectos = [
    { ot: "1", cliente: "A", obra: "Maipú", total_modulos: 12, fecha_objetivo: "2026-11-15" },
    { ot: "2", cliente: "A", obra: "MAIPU", total_modulos: 6, fecha_objetivo: "2026-11-15" },
    { ot: "3", cliente: "B", obra: "", total_modulos: 3 },
    { ot: "4", cliente: "C", obra: "x", total_modulos: 3 }, // sin plan de producción
    { ot: "5", cliente: "D", obra: "y" }, // en el plan, sin gabinetes
    { ot: "6", cliente: "E", obra: "z", total_modulos: 3 }, // instalada
    { ot: "7", cliente: "F", obra: "w", total_modulos: 3 }, // en pausa
  ];
  const fin = new Map([["1", { fin: "2026-11-06" }], ["2", { fin: "2026-11-04" }], ["5", { fin: "2026-11-04" }], ["6", { fin: "2026-11-04" }], ["7", { fin: "2026-11-04" }]]);
  const r = trabajosInstalacion({ proyectos, finProduccion: fin, producidas: new Set(["3"]), instaladas: new Set(["6"]), pausadas: new Set(["7"]), params, inst: params.instalacion, hoy, maxPersonas: 3 });
  assert.deepEqual(r.sinProduccion.map((p) => p.ot), ["4"]);
  assert.deepEqual(r.sinDato.map((x) => x.proyecto.ot), ["5"]);
  const maipu = r.trabajos.find((t) => t.clave === claveObra(proyectos[0]));
  assert.deepEqual(maipu.ots.map((t) => t.ot), ["1", "2"]);
  assert.equal(maipu.desde, "2026-11-09"); // la última OT de la obra sale el viernes 6
  assert.equal(maipu.diasPersona, 6); // 12/3 + 6/3
  assert.equal(maipu.personas, 3); // 2 + 2, pero hay 3 instaladores
  assert.equal(maipu.dias, 2);
  const sola = r.trabajos.find((t) => t.clave === "ot:3");
  assert.equal(sola.desde, hoy); // ya producida
  assert.equal(sola.dias, 0.5);
});

test("trabajosInstalacion — en obra: arranca hoy con lo que falta según el último reporte", () => {
  const proyectos = [{ ot: "1", cliente: "A", obra: "o", total_modulos: 12 }];
  const r = trabajosInstalacion({ proyectos, finProduccion: new Map([["1", { fin: "2026-11-20" }]]), params, inst: params.instalacion, hoy, avance: new Map([["1", 50]]) });
  assert.equal(r.trabajos[0].desde, hoy);
  assert.equal(r.trabajos[0].enCurso, true);
  assert.equal(r.trabajos[0].diasPersona, 2);
  assert.equal(r.trabajos[0].dias, 1);
});

test("ordenarTrabajos — en obra, prioridad, entrega", () => {
  const t = (clave, extra) => ({ clave, ots: [{ ot: clave }], enCurso: false, prioridad: null, entrega: null, desde: hoy, ...extra });
  const orden = ordenarTrabajos([t("a", { entrega: "2026-11-20" }), t("b", { prioridad: 1, entrega: "2026-12-01" }), t("c", { enCurso: true }), t("d", { entrega: "2026-11-10" })]);
  assert.deepEqual(orden.map((x) => x.clave), ["c", "b", "d", "a"]);
});

test("planInstalacion — de a medio día; un dúo hace dos trabajos cortos el mismo día; tarde contra la entrega", () => {
  const gente = [{ id: "a", nombre: "Ana", diagrama: LV }, { id: "b", nombre: "Beto", diagrama: LV }];
  const trabajos = [
    { clave: "x", ots: [{ ot: "1" }], personas: 2, dias: 0.5, medios: 1, desde: hoy, entrega: "2026-11-08", enCurso: false },
    { clave: "y", ots: [{ ot: "2" }], personas: 2, dias: 0.5, medios: 1, desde: hoy, entrega: "2026-11-08", enCurso: false },
    { clave: "z", ots: [{ ot: "3" }], personas: 2, dias: 4, medios: 8, desde: "2026-11-05", entrega: "2026-11-08", enCurso: false },
  ];
  const plan = planInstalacion(trabajos, gente, { hoy });
  assert.deepEqual([plan[0].inicio, plan[0].inicioMedio], [hoy, 0]);
  assert.deepEqual([plan[1].inicio, plan[1].inicioMedio], [hoy, 1]);
  assert.deepEqual(plan[0].equipo.sort(), ["a", "b"]);
  // jueves 5 → sigue el lunes 9 y martes 10 (salta el fin de semana)
  assert.equal(plan[2].inicio, "2026-11-05");
  assert.equal(plan[2].fin, "2026-11-10");
  assert.equal(plan[2].tarde, true);
  assert.equal(plan[2].diasTarde, 2);
  assert.equal(plan[2].esperaProduccion, true);
  assert.deepEqual(diasDeObra(plan[2].tramos).map((d) => d.fecha), ["2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"]);
});

test("planInstalacion — dos obras en paralelo con 4 instaladores", () => {
  const gente = ["a", "b", "c", "d"].map((id) => ({ id, diagrama: LV }));
  const t = (clave) => ({ clave, ots: [{ ot: clave }], personas: 2, dias: 1, medios: 2, desde: hoy, entrega: null, enCurso: false });
  const plan = planInstalacion([t("x"), t("y")], gente, { hoy });
  assert.equal(plan[0].inicio, hoy);
  assert.equal(plan[1].inicio, hoy);
  assert.equal(new Set([...plan[0].equipo, ...plan[1].equipo]).size, 4);
});

test("GanttInstalacion — dibuja cada obra con su gente y lista las OT sin días", async () => {
  global.fetch = async (url, opts) => {
    const u = `${url} ${opts?.body || ""}`;
    if (u.includes("empleados")) return Response.json({ data: [{ id: "a", nombre: "Ana", diagrama: LV }, { id: "b", nombre: "Beto", diagrama: LV }] });
    return Response.json({ data: [] });
  };
  const proyectos = [
    { id: 1, ot: "7961", cliente: "Riofrío", obra: "Maipú", division: "Muebles", total_modulos: 6, fecha_objetivo: "2099-01-10" },
    { id: 2, ot: "7962", cliente: "Otro", obra: "Centro", division: "Muebles" },
  ];
  const { hoyArg } = await import("../app/lib/dates.js");
  const fin = new Date(Date.parse(`${hoyArg()}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);
  const vivo = { renglones: [
    { ot: "7961", fin, procesos: [{ completo: false }] },
    { ot: "7962", fin, procesos: [{ completo: false }] },
  ], cfgValor: { instalacion: { gab_por_dia: { global: 3 } } }, modulos: new Map() };
  const vistos = [];
  render(<GanttInstalacion vivo={vivo} proyectos={proyectos} divisiones={[{ id: "muebles", label: "Muebles" }]} onVerDetalle={(p) => vistos.push(p.ot)} />);
  const obra = await screen.findByRole("button", { name: /OT 7961, Riofrío · Maipú: del .* 1 día con 2 instaladores, espera que termine producción/ });
  fireEvent.click(obra);
  assert.deepEqual(vistos, ["7961"]);
  assert.ok(screen.getByText(/Sin días de instalación · 1/));
  assert.equal(screen.queryByText(/No hay instaladores marcados/), null);
  assert.match(obra.textContent, /Ana, Beto/);
  fireEvent.click(screen.getByRole("button", { name: "OT 7962 · Otro · Centro" }));
  assert.deepEqual(vistos, ["7961", "7962"]);
});

test("GanttInstalacion — después de confirmar no vuelve a ofrecer el botón mientras el plan no cambie", async () => {
  let confirmado = null;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("/api/plan-instalacion") && opts?.method === "POST") {
      confirmado = JSON.parse(opts.body).items;
      return Response.json({ ok: true });
    }
    if (u.includes("/api/plan-instalacion")) {
      return Response.json({ ok: true, planes: confirmado ? [{ id: 1, division_id: "muebles", confirmado_at: "2026-11-05T10:00:00Z", confirmado_nombre: "Tadeo", items: confirmado }] : [] });
    }
    if (u.includes("empleados")) return Response.json({ data: [{ id: "a", nombre: "Ana", diagrama: LV }, { id: "b", nombre: "Beto", diagrama: LV }] });
    return Response.json({ data: [] });
  };
  const proyectos = [{ id: 1, ot: "7961", cliente: "Riofrío", obra: "Maipú", division: "Muebles", total_modulos: 6, fecha_objetivo: "2099-01-10" }];
  const { hoyArg } = await import("../app/lib/dates.js");
  const fin = new Date(Date.parse(`${hoyArg()}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);
  const vivo = { renglones: [{ ot: "7961", fin, procesos: [{ completo: false }] }], cfgValor: { instalacion: { gab_por_dia: { global: 3 } } }, modulos: new Map() };
  render(<GanttInstalacion vivo={vivo} proyectos={proyectos} divisiones={[{ id: "muebles", label: "Muebles" }]} puedeConfirmar />);
  fireEvent.click(await screen.findByRole("button", { name: /Confirmar plan de instalación/ }));
  await waitFor(() => assert.ok(screen.getByText(/✅ Plan confirmado el .* por Tadeo/)));
  assert.equal(screen.queryByRole("button", { name: /Confirmar/ }), null);
  assert.ok(screen.getByRole("button", { name: /Cambiar orden/ }));
});

test("seguidos — junta los medios días pegados en una barra", async () => {
  const { seguidos } = await import("../app/components/GanttInstalacion.jsx");
  const r = seguidos([{ fecha: "2026-11-05", medio: 1 }, { fecha: "2026-11-06", medio: 0 }, { fecha: "2026-11-06", medio: 1 }, { fecha: "2026-11-09", medio: 0 }]);
  assert.deepEqual(r.map(([a, b]) => [a.fecha, a.medio, b.fecha, b.medio]), [["2026-11-05", 1, "2026-11-06", 1], ["2026-11-09", 0, "2026-11-09", 0]]);
});

test("GanttOt — selector Producción / Instalación", async () => {
  const { default: GanttOt } = await import("../app/components/GanttOt.jsx");
  render(<GanttOt proyectos={[]} planes={[]} cfgValor={null} />);
  fireEvent.click(screen.getByRole("button", { name: "🔧 Instalación" }));
  await waitFor(() => assert.ok(screen.getByText("No hay OT para instalar")));
});
