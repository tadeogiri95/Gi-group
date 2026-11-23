// tests/tablero-etapas.test.jsx — Tablero de etapas tipo Trello en Producción →
// OT → 🗂️ Etapas (Tadeo, 22/11; app/lib/tableroEtapas.js): cada OT en su
// etapa con las horas de jornada que lleva, naranja si avanza sin terminar la
// anterior, violeta si no está en el Gantt, y el registro de cada etapa.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { horasTrabajo, leadTimeProcesos } from "../app/lib/leadTimeHoras.js";
import { tableroEtapas, instalacionPorOt, pctPorProceso, otsDelPlan, COLUMNAS_TABLERO } from "../app/lib/tableroEtapas.js";

afterEach(() => cleanup());

const { default: TableroEtapas } = await import("../app/components/TableroEtapas.jsx");

// El lunes 26/10/2026; sin grilla, la planta trabaja de lunes a viernes de 8 a 16
const arg = (dia, hora) => new Date(Date.parse(`2026-${dia}T${hora}:00-03:00`)).toISOString();
const AHORA = new Date(arg("10-28", "16:00"));
const ETAPAS_CODIGO = { corte: 1, canteado: 2, mecanizado: 3, armado: 4 };
const hecho = (ot, etapa, ini, fin) => ({ ot, etapa, total: 10, pasaron: 10, primer_paso: ini, ultimo_paso: fin });

const PIEZAS = [
  // 7100: Corte terminado; Canteado a la mitad y Mecanizado ya empezó
  hecho("7100", 1, arg("10-26", "10:00"), arg("10-26", "14:30")),
  { ot: "7100", etapa: 2, total: 10, pasaron: 5, primer_paso: arg("10-27", "08:00"), ultimo_paso: arg("10-27", "11:00") },
  { ot: "7100", etapa: 3, total: 10, pasaron: 2, primer_paso: arg("10-27", "12:00"), ultimo_paso: arg("10-27", "13:00") },
  // 7200: Corte desde hoy a las 8, sin estar en el plan
  { ot: "7200", etapa: 1, total: 10, pasaron: 3, primer_paso: arg("10-28", "08:00"), ultimo_paso: arg("10-28", "09:00") },
  // 7300: toda la producción hecha, sin cargar
  hecho("7300", 1, arg("10-26", "08:00"), arg("10-26", "10:00")), hecho("7300", 2, arg("10-26", "10:00"), arg("10-26", "12:00")),
  hecho("7300", 3, arg("10-26", "12:00"), arg("10-26", "14:00")), hecho("7300", 4, arg("10-26", "14:00"), arg("10-27", "10:00")),
  // 7400: terminó Corte y no empezó Canteado
  hecho("7400", 1, arg("10-27", "08:00"), arg("10-27", "10:00")),
  // 7500: producción hecha, cargada e instalada con acta
  hecho("7500", 1, arg("10-26", "08:00"), arg("10-26", "09:00")), hecho("7500", 2, arg("10-26", "09:00"), arg("10-26", "10:00")),
  hecho("7500", 3, arg("10-26", "10:00"), arg("10-26", "11:00")), hecho("7500", 4, arg("10-26", "11:00"), arg("10-26", "16:00")),
  // 7600: producción hecha y en instalación
  hecho("7600", 1, arg("10-26", "08:00"), arg("10-26", "09:00")), hecho("7600", 2, arg("10-26", "09:00"), arg("10-26", "10:00")),
  hecho("7600", 3, arg("10-26", "10:00"), arg("10-26", "11:00")), hecho("7600", 4, arg("10-26", "11:00"), arg("10-27", "16:00")),
];
const INSTALACION = {
  cargas: [{ ot: "7500", firma_carga_at: arg("10-27", "08:00") }],
  bultos: [{ ot: "7600", cargado_at: arg("10-28", "10:00") }],
  reportes: [{ ot: "7600", avance: 20, created_at: arg("10-28", "12:00") }, { ot: "7600", avance: 40, created_at: arg("10-28", "15:00") }],
  actas: [{ ot: "7500", firmada_at: arg("10-27", "12:00") }],
};
const PROYECTOS = ["7100", "7200", "7300", "7400", "7500", "7600", "7700"].map((ot) => ({ ot, cliente: `Cliente ${ot}`, estado: "activo" }));

function armar(extra = {}) {
  const ahora = extra.ahora || AHORA;
  const lead = leadTimeProcesos({ etapasCodigo: ETAPAS_CODIGO, piezas: PIEZAS, pausas: extra.pausas || [], ahora });
  return tableroEtapas({
    proyectos: PROYECTOS, lead, pct: pctPorProceso(PIEZAS), instalacion: instalacionPorOt(INSTALACION),
    etapasCodigo: ETAPAS_CODIGO, planProduccion: new Set(["7100", "7400"]), planInstalacion: null, ahora: AHORA, ...extra,
  });
}
const columna = (t, id) => t.columnas.find((c) => c.id === id).tarjetas;

test("horasTrabajo — los feriados no cuentan", () => {
  assert.equal(horasTrabajo(arg("10-26", "10:00"), arg("10-28", "12:00")), 18);
  assert.equal(horasTrabajo(arg("10-26", "10:00"), arg("10-28", "12:00"), undefined, new Set(["2026-10-27"])), 10, "6 h el lunes + 4 h el miércoles");
});

test("columnas — los 4 procesos, Instalación y Terminadas", () => {
  assert.deepEqual(COLUMNAS_TABLERO.map((c) => c.nombre), ["Corte", "Canteado", "Mecanizado", "Armado", "Instalación", "Terminadas"]);
});

test("tableroEtapas — cada OT en su etapa con las horas de jornada que lleva", () => {
  const t = armar();
  const ots = Object.fromEntries(t.columnas.map((c) => [c.id, c.tarjetas.map((x) => x.ot)]));
  assert.deepEqual(ots, { corte: ["7200"], canteado: ["7400"], mecanizado: ["7100"], armado: [], instalacion: ["7600", "7300"], terminadas: ["7500"] });
  assert.ok(!t.porOt.has("7700"), "sin ningún avance no entra al tablero");

  const [c7200] = columna(t, "corte");
  assert.equal(c7200.lleva, 8, "de las 8 a las 16 de hoy");
  assert.equal(c7200.pct, 30);
  assert.equal(c7200.fueraDelGantt, true, "no está en el plan confirmado");

  const [m7100] = columna(t, "mecanizado");
  assert.deepEqual(m7100.atrasados, [{ etapa: "canteado", nombre: "Canteado", pct: 50 }], "avanza en Mecanizado sin terminar Canteado");
  assert.equal(m7100.fueraDelGantt, false);
  assert.equal(m7100.lleva, 12, "4 h el martes + 8 h el miércoles");

  const [e7400] = columna(t, "canteado");
  assert.equal(e7400.estado, "esperando");
  assert.equal(e7400.lleva, 14, "desde que terminó Corte: 6 + 8");
  assert.equal(e7400.fueraDelGantt, false, "esperando no se marca fuera del Gantt");

  const [i7600, i7300] = columna(t, "instalacion");
  assert.deepEqual([i7600.estado, i7600.pct, i7600.lleva], ["en_curso", 40, 6], "desde el primer bulto cargado");
  assert.deepEqual([i7300.estado, i7300.lleva], ["esperando", 14], "producción hecha, esperando la carga");
});

test("tableroEtapas — registro de cada etapa y duración de la OT", () => {
  const t = armar();
  const [o] = columna(t, "terminadas");
  assert.deepEqual(o.procesos.map((q) => [q.nombre, q.horas]), [["Corte", 1], ["Canteado", 1], ["Mecanizado", 1], ["Armado", 5]]);
  assert.equal(o.produccion, 8, "del primer escaneo de Corte a la última pieza de Armado");
  assert.equal(o.instalacion.horas, 4, "de la firma de la carga al acta");
  assert.equal(o.horas, 12, "del primer avance al acta");
  const prom = Object.fromEntries(t.columnas.find((c) => c.id === "terminadas").promedios.map((x) => [x.etapa, x.promedio]));
  assert.equal(prom.armado, 5);
  assert.equal(prom.ot, 12);
  // Tiempo en pausa no cuenta
  const conPausa = armar({ pausas: [{ ot: "7200", desde: arg("10-28", "12:00"), hasta: null }] });
  const [c] = columna(conPausa, "corte");
  assert.equal(c.lleva, 4);
  assert.equal(c.enPausa, true);
});

test("tableroEtapas — cerrada sin acta: Terminadas solo si terminó la producción; las viejas no se ven", () => {
  const proyectos = PROYECTOS.map((p) => (p.ot === "7300" || p.ot === "7200" ? { ...p, estado: "cerrado" } : p));
  const t = armar({ proyectos });
  assert.deepEqual(columna(t, "terminadas").map((x) => x.ot), ["7500", "7300"], "la más reciente arriba");
  assert.ok(!t.columnas.some((c) => c.tarjetas.some((x) => x.ot === "7200")));
  const despues = armar({ ahora: new Date(arg("12-20", "10:00")) });
  assert.deepEqual(columna(despues, "terminadas"), [], "más de 30 días");
});

test("tableroEtapas — con ruta de división, la OT solo espera en las etapas por las que pasa", () => {
  const divisiones = [{ id: "M", label: "Muebles", ruta_etapas: [1, 2, 4] }];
  const proyectos = PROYECTOS.map((p) => (p.ot === "7300" ? { ...p, division: "M" } : p));
  const piezas = PIEZAS.filter((f) => !(f.ot === "7300" && f.etapa === 3));
  const lead = leadTimeProcesos({ etapasCodigo: ETAPAS_CODIGO, piezas, ahora: AHORA });
  const t = tableroEtapas({ proyectos, lead, pct: pctPorProceso(piezas), etapasCodigo: ETAPAS_CODIGO, divisiones, ahora: AHORA });
  const o = t.porOt.get("7300");
  assert.deepEqual(o.procesos.map((q) => q.nombre), ["Corte", "Canteado", "Armado"]);
  assert.equal(o.columna, "instalacion", "sin Mecanizado en la ruta, la producción está completa");
});

test("instalacionPorOt y otsDelPlan", () => {
  const m = instalacionPorOt(INSTALACION);
  assert.deepEqual(m.get("7600"), { inicio: arg("10-28", "10:00"), fin: null, pct: 40 });
  assert.deepEqual(m.get("7500"), { inicio: arg("10-27", "08:00"), fin: arg("10-27", "12:00"), pct: 100 });
  assert.deepEqual([...otsDelPlan([{ ot: "1" }, { ots: ["2", "3"] }, { ot: 4 }])], ["1", "2", "3", "4"]);
});

test("pantalla — columnas con tarjetas, colores y registro al tocar", async () => {
  const datos = {
    v_avance_piezas: PIEZAS.filter((f) => ["7100", "7200"].includes(f.ot)),
    etapas: [{ codigo: 1, nombre: "Corte" }, { codigo: 2, nombre: "Canteado" }, { codigo: 3, nombre: "Mecanizado CNC" }, { codigo: 4, nombre: "Armado" }],
  };
  global.fetch = async (url, opts) => {
    if (String(url).includes("/api/planificacion")) return Response.json({ ok: true, planes: [{ id: 1, confirmado_at: "2026-10-20", items: [{ ot: "7100", etapa: "corte" }] }] });
    if (String(url).includes("/api/plan-instalacion")) return Response.json({ ok: true, planes: [] });
    const path = opts?.body ? JSON.parse(opts.body).path || "" : "";
    const filas = datos[path.split("?")[0]] || [];
    return Response.json({ data: path.includes("offset=0") ? filas : [] });
  };
  const etapas = datos.etapas.map((e) => ({ ...e, activa: true }));
  let detalle = null;
  render(<TableroEtapas proyectos={PROYECTOS.slice(0, 2)} empresaId="e1" etapas={etapas} divisiones={[]} onVerDetalle={(p) => { detalle = p; }} />);
  const meca = await screen.findByRole("listitem", { name: "Mecanizado" });
  const tarjeta = within(meca).getByRole("button", { name: /OT 7100/ });
  assert.equal(tarjeta.dataset.paralelo, "si");
  assert.match(tarjeta.className, /border-orange-500/);
  assert.match(tarjeta.textContent, /Canteado sin terminar: 50 %/);
  const corte = screen.getByRole("listitem", { name: "Corte" });
  const fuera = within(corte).getByRole("button", { name: /OT 7200/ });
  assert.equal(fuera.dataset.fueraGantt, "si");
  assert.match(fuera.textContent, /Fuera del Gantt/);
  fireEvent.click(tarjeta);
  const tabla = await screen.findByRole("table", { name: "Registro de etapas" });
  assert.match(tabla.textContent, /Corte.*4,5 h/s);
  assert.match(tabla.textContent, /OT completa/);
  fireEvent.click(screen.getByRole("button", { name: "Ver el detalle de la OT" }));
  assert.equal(detalle?.ot, "7100");
});

test("Producción → OT tiene 🗂️ Trello al lado del Gantt; Reportes ya no tiene Del día, Indicadores, Lead time ni Obra", () => {
  const ot = readFileSync(new URL("../app/proyectos_screen.jsx", import.meta.url), "utf8");
  assert.match(ot, /<Chip active=\{vista === "etapas"\} onClick=\{\(\) => setVista\("etapas"\)\}>🗂️ Trello<\/Chip>\s*<Chip active=\{vista === "gantt"\}/);
  assert.match(ot, /<ReportesObra empresaId=\{empresaId\} \/>/);
  const rep = readFileSync(new URL("../app/reportes_screen.jsx", import.meta.url), "utf8");
  for (const fuera of ["🗓️ Del día", "📈 Indicadores", "⏱️ Lead time", "🏗️ Obra"]) assert.ok(!rep.includes(fuera), fuera);
});

test("pantalla — el texto no sobresale de la tarjeta y la fila de columnas muestra la barra para deslizar (23/11)", () => {
  const src = readFileSync(new URL("../app/components/TableroEtapas.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /className="fila-desliza/, "fila-desliza esconde la barra y pone white-space: nowrap a las columnas");
  assert.match(src, /w-full min-w-0 overflow-hidden whitespace-normal break-words text-left/);
  assert.match(src, /md:flex-1 md:w-auto md:min-w-\[170px\]/);
});
