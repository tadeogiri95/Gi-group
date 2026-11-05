// tests/diseno-tecnica.test.jsx — Diseño y Técnica, parte 46 (migración 158;
// app/lib/complejidad.js): etapas DIS…PDF del Plan de trabajo, clase A/B/C de
// cada OT dentro de su tipo de proyecto con cantidades totales, y la clase a mano.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import {
  estadoCelda, juntarEtapas, avanceArea, columnasEtapas, categoriaArticulo, totalesNecesidades,
  cantidadesOt, clasesAutomaticas, claseDeOt, cambiosClase, MIN_OT_POR_TIPO,
} from "../app/lib/complejidad.js";
import { parseCsvProyectos } from "../app/lib/csvProyectos.js";
import { filasTablaOt, COLUMNAS_OT } from "../app/lib/otTabla.js";
import { validarPatch } from "../app/lib/dataPolicy.js";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";
import { recalcularClases } from "../app/lib/syncComplejidad.js";

const { default: DisenoTecnicaOt, textoCantidades } = await import("../app/components/DisenoTecnicaOt.jsx");

const sinRed = async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
global.fetch = sinRed;
afterEach(() => { cleanup(); global.fetch = sinRed; });
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); });

test("estadoCelda — vacía = falta, N/A = no aplica, otra cosa = hecha con las iniciales", () => {
  assert.deepEqual(estadoCelda(""), { e: "falta" });
  assert.deepEqual(estadoCelda("  "), { e: "falta" });
  assert.deepEqual(estadoCelda(null), { e: "falta" });
  assert.deepEqual(estadoCelda("N/A"), { e: "na" });
  assert.deepEqual(estadoCelda("n / a"), { e: "na" });
  assert.deepEqual(estadoCelda("MJT"), { e: "hecho", q: "MJT" });
  assert.deepEqual(estadoCelda("RP/GR"), { e: "hecho", q: "RP/GR" });
  assert.deepEqual(estadoCelda("SI"), { e: "hecho" });
});

test("juntarEtapas — OT con varios renglones: falta si falta en uno, N/A solo si todos", () => {
  const a = { dis: { e: "hecho", q: "GR" }, relev: { e: "na" }, excel: { e: "hecho", q: "MJT" } };
  const b = { dis: { e: "hecho", q: "GR" }, relev: { e: "na" }, excel: { e: "falta" } };
  assert.deepEqual(juntarEtapas(a, b), { dis: { e: "hecho", q: "GR" }, relev: { e: "na" }, excel: { e: "falta" } });
  assert.deepEqual(juntarEtapas({ relev: { e: "na" } }, { relev: { e: "hecho", q: "EG" } }), { relev: { e: "hecho", q: "EG" } });
  assert.equal(juntarEtapas(null, b), b);
});

test("avanceArea — % sobre las etapas que aplican y quién las hizo", () => {
  const etapas = {
    dis: { e: "hecho", q: "GR" }, skp: { e: "hecho", q: "GR" }, info: { e: "na" }, relev: { e: "falta" }, np: { e: "na" },
    nf: { e: "hecho", q: "MJT" }, excel: { e: "hecho", q: "SLS" }, pdf: { e: "na" },
  };
  assert.deepEqual(avanceArea(etapas, "diseno"), { pct: 67, terminada: false, hechas: 2, aplican: 3, quienes: ["GR"] });
  assert.deepEqual(avanceArea(etapas, "tecnica"), { pct: 100, terminada: true, hechas: 2, aplican: 2, quienes: ["MJT", "SLS"] });
  assert.equal(avanceArea(null, "diseno"), null);
});

test("Plan de trabajo — lee DIS, SKP, INFO PROY, RELEV, N.P, N.F, EXCEL y PDF (no PERF/ESPEJO/VIDRIO)", () => {
  const titulos = ["OT", "DIVISIÓN", "PROYECTO / OBRA", "CLIENTE ", "OBRA", "DESCRIPCION", "CANT", "PPTO", "ENTREGA", "SEMANA ", "TERMINADO",
    "DIS", "SKP", "INFO PROY", "RELEV", "N.P", "N.F", "EXCEL", "PERF/ESPEJO/VIDRIO", "PDF", "CORTE"];
  assert.deepEqual(columnasEtapas(titulos.map((t) => t.toLowerCase())).map((e) => e.id), ["dis", "skp", "info", "relev", "np", "nf", "excel", "pdf"]);
  const csv = [
    ",N° SIGUIENTE,7989",
    ",,M",
    titulos.join(","),
    "M-7900,MUEBLES ,7900,BCG,AMANCAY,COCINA,1,,,45,,GR,GR,N/A,RP/GR,GR,MJT,MJT,N/A,MJT,",
    "M-7901,MUEBLES ,7901,BCG,AMANCAY,PLACARD P1,1,,,45,,GR,,N/A,,,,,,,",
    "M-7901,MUEBLES ,7901,BCG,AMANCAY,PLACARD P2,1,,,45,,GR,GR,N/A,GR,,,,,,",
  ].join("\n");
  const { filas } = parseCsvProyectos(csv);
  const a = filas.find((f) => f.ot === "M-7900").etapas_diseno;
  assert.deepEqual(a.dis, { e: "hecho", q: "GR" });
  assert.deepEqual(a.info, { e: "na" });
  assert.deepEqual(a.relev, { e: "hecho", q: "RP/GR" });
  assert.deepEqual(a.excel, { e: "hecho", q: "MJT" });
  assert.deepEqual(a.pdf, { e: "hecho", q: "MJT" });
  assert.equal(Object.keys(a).length, 8);
  const b = filas.find((f) => f.ot === "M-7901").etapas_diseno;
  assert.deepEqual(b.skp, { e: "falta" }, "falta en el primer renglón");
  assert.deepEqual(b.dis, { e: "hecho", q: "GR" });
  assert.deepEqual(b.excel, { e: "falta" });
  // Una planilla sin esas columnas no trae la clave (no pisa lo que había)
  const sin = parseCsvProyectos("OT,CLIENTE\nM-1,X").filas[0];
  assert.equal("etapas_diseno" in sin, false);
});

test("categoriaArticulo — canto, placa o componente por el nombre del artículo", () => {
  assert.equal(categoriaArticulo("CANTO ABS 22/045 LISO SIN COLA-Rehau-BLANCO-1 MT"), "canto");
  assert.equal(categoriaArticulo("MELAMINA SOBRE MDF 18MM-Faplac-GRIS CALIZA-4,7M2"), "placa");
  assert.equal(categoriaArticulo("FIBROPLUS 3MM-Masisa-BLANCO-4,7M2"), "placa");
  assert.equal(categoriaArticulo("ENCHAPADO 19 MM SOBRE MDF KIRI - -MT2-9.1.323"), "placa");
  assert.equal(categoriaArticulo("BISAGRA 35 CODO 0 CIERRE SUAVE-S/Marca-S/COLOR-1 PZ"), "componente");
  assert.equal(categoriaArticulo("PERFIL MOA MANIJA OCULTA ALACENA-Grupo Euro-ANODIZADO NATURAL-3MT"), "componente");
  assert.equal(categoriaArticulo("LED CALIDO-S/Marca-S/COLOR-5 MT"), "componente");
});

test("totalesNecesidades y cantidadesOt — suma cantidades totales; sin necesidades usa las placas del Plan", () => {
  const t = totalesNecesidades([
    { ot: "M-1", nombre: "BISAGRA 35-1 PZ", cantidad: 40 },
    { ot: "M-1", nombre: "MANIJA CLASS 70MM-1 PZ", cantidad: 20 },
    { ot: "M-1", nombre: "MELAMINA SOBRE MDF 18MM-4,7M2", cantidad: 5.5 },
    { ot: "M-1", nombre: "CANTO ABS 22/045-1 MT", cantidad: 72 },
    { ot: "M-1", nombre: "CANTO ABS 22/2-1 MT", cantidad: 66 },
    { ot: "M-1", nombre: "PATA", cantidad: -3 },
  ]);
  assert.deepEqual(t.get("M-1"), { componentes: 60, placas: 5.5, canto: 138 });
  assert.deepEqual(cantidadesOt({ ot: "M-1" }, t), { componentes: 60, placas: 5.5, canto: 138, origen: "necesidades" });
  assert.deepEqual(cantidadesOt({ ot: "M-2", placas: 4, fondos: 1, metros_canto: 50 }, t), { componentes: null, placas: 5, canto: 50, origen: "plan" });
  assert.equal(cantidadesOt({ ot: "M-3" }, t), null);
});

// 20 cocinas de tamaño creciente + 3 vanitory (tipo con pocas OT)
const cocinas = Array.from({ length: 20 }, (_, i) => ({ ot: `M-${100 + i}`, descripcion: "COCINA", n: i + 1 }));
const vanitorys = [1, 10, 30].map((n, i) => ({ ot: `M-${200 + i}`, descripcion: "VANITORY SUITE", n }));
const necesidadesDe = (lista) => lista.flatMap((p) => [
  { ot: p.ot, nombre: "BISAGRA-1 PZ", cantidad: p.n * 10 },
  { ot: p.ot, nombre: "MELAMINA 18MM-4,7M2", cantidad: p.n },
  { ot: p.ot, nombre: "CANTO 22/045-1 MT", cantidad: p.n * 15 },
]);

test("clasesAutomaticas — dentro de cada tipo: 20 % A, 50 % B, 30 % C", () => {
  const clases = clasesAutomaticas(cocinas, necesidadesDe(cocinas));
  const de = (ot) => clases.get(ot).clase;
  const cuenta = { A: 0, B: 0, C: 0 };
  for (const p of cocinas) cuenta[de(p.ot)]++;
  assert.deepEqual(cuenta, { A: 4, B: 10, C: 6 });
  assert.equal(de("M-119"), "A", "la más grande");
  assert.equal(de("M-100"), "C", "la más chica");
  assert.equal(clases.get("M-119").tipo, "cocina");
  assert.ok(clases.get("M-119").puntaje > clases.get("M-100").puntaje);
});

test("clasesAutomaticas — un tipo con pocas OT usa los cortes de todas; sin datos no tiene clase", () => {
  const proyectos = [...cocinas, ...vanitorys, { ot: "M-999", descripcion: "COCINA" }];
  assert.ok(vanitorys.length < MIN_OT_POR_TIPO);
  const clases = clasesAutomaticas(proyectos, necesidadesDe([...cocinas, ...vanitorys]));
  assert.equal(clases.get("M-200").clase, "C", "vanitory chico");
  assert.equal(clases.get("M-202").clase, "A", "vanitory más grande que todas las cocinas");
  assert.equal(clases.has("M-999"), false);
  // OT solo con el Plan: el puntaje sale de placas y canto
  const conPlan = clasesAutomaticas([...cocinas, { ot: "M-500", descripcion: "COCINA", placas: 30, metros_canto: 500 }], necesidadesDe(cocinas));
  assert.equal(conPlan.get("M-500").clase, "A");
  assert.equal(conPlan.get("M-500").cantidades.origen, "plan");
});

test("claseDeOt — la elegida a mano manda; sin datos queda en B", () => {
  assert.deepEqual(claseDeOt({ clase_auto: "C", clase_complejidad: "A" }), { clase: "A", manual: true, sinDatos: false });
  assert.deepEqual(claseDeOt({ clase_auto: "C" }), { clase: "C", manual: false, sinDatos: false });
  assert.deepEqual(claseDeOt({}), { clase: "B", manual: false, sinDatos: true });
  assert.deepEqual(claseDeOt({ clase_complejidad: "Z" }), { clase: "B", manual: false, sinDatos: true });
});

test("cambiosClase — solo las OT cuya clase cambió, agrupadas por clase", () => {
  const clases = new Map([["M-1", { clase: "A" }], ["M-2", { clase: "B" }], ["M-3", { clase: "A" }]]);
  const g = cambiosClase([{ ot: "M-1", clase_auto: "A" }, { ot: "M-2", clase_auto: "C" }, { ot: "M-3" }, { ot: "M-4", clase_auto: "B" }], clases);
  assert.deepEqual([...g.entries()].sort(), [["", ["M-4"]], ["A", ["M-3"]], ["B", ["M-2"]]]);
});

test("recalcularClases — lee OT y necesidades y escribe solo lo que cambió", async () => {
  const llamadas = [];
  const fetcher = async (path, opts) => {
    llamadas.push({ path, opts });
    if (path.startsWith("proyectos?") && !opts.method) return cocinas.map((p) => ({ ot: p.ot, descripcion: p.descripcion, clase_auto: p.ot === "M-119" ? "A" : null }));
    if (path.startsWith("necesidades_stock?")) return necesidadesDe(cocinas);
    return null;
  };
  const r = await recalcularClases("emp1", fetcher);
  assert.equal(r.cambiadas, 19, "M-119 ya era A");
  const patches = llamadas.filter((l) => l.opts.method === "PATCH");
  assert.equal(patches.length, 3);
  assert.ok(patches.every((p) => p.path.startsWith("proyectos?empresa_id=eq.emp1&ot=in.(")));
  assert.deepEqual(patches.map((p) => JSON.parse(p.opts.body).clase_auto).sort(), ["A", "B", "C"]);
  // Sin la migración 158 no hace nada ni corta la sincronización
  const sin = await recalcularClases("emp1", async () => { throw new Error("column proyectos.clase_auto does not exist"); });
  assert.ok(sin.omitido);
});

test("Lista de OT — columna Clase, ordenable y filtrable", () => {
  assert.ok(COLUMNAS_OT.some((c) => c.id === "clase"));
  const filas = [
    { p: { ot: "1", clase_auto: "C" } },
    { p: { ot: "2", clase_auto: "A" } },
    { p: { ot: "3", clase_complejidad: "B", clase_auto: "A" } },
  ];
  assert.deepEqual(filasTablaOt(filas, { orden: { col: "clase", dir: "asc" } }).map((f) => f.p.ot), ["2", "3", "1"]);
  assert.deepEqual(filasTablaOt(filas, { filtros: { clase: "A" } }).map((f) => f.p.ot), ["2"]);
});

test("PATCH de proyectos — clase a mano solo A, B, C o vacía", () => {
  assert.equal(validarPatch("proyectos", { clase_complejidad: "A" }, { rol: "gerencial" }), null);
  assert.equal(validarPatch("proyectos", { clase_complejidad: null }, { rol: "gerencial" }), null);
  assert.equal(validarPatch("proyectos", { clase_complejidad: "D" }, { rol: "gerencial" })?.status, 400);
});

test("Migración 158 — columnas, chequeos y registro en el chequeo de la base", () => {
  const sql = readFileSync(new URL("../supabase/migrations/158_diseno_tecnica_clase.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /add column if not exists etapas_diseno jsonb/);
  assert.match(sql, /add column if not exists clase_auto text/);
  assert.match(sql, /add column if not exists clase_complejidad text/);
  assert.match(sql, /clase_complejidad in \('A', 'B', 'C'\)/);
  const m = MIGRACIONES.find((x) => x.n === 158);
  assert.deepEqual(m.tablas, { proyectos: ["etapas_diseno", "clase_auto", "clase_complejidad"] });
});

test("textoCantidades — dice de dónde salen las cantidades", () => {
  assert.equal(textoCantidades({ componentes: 60, placas: 5.5, canto: 138, origen: "necesidades" }), "60 componentes, 5,5 placas y 138 m de canto (necesidades del MRP).");
  assert.equal(textoCantidades({ componentes: null, placas: 5, canto: 50, origen: "plan" }), "5 placas y 50 m de canto (placas y cantos preliminares del Plan).");
  assert.match(textoCantidades(null), /Todavía no tiene/);
});

test("Detalle OT — 📐 Diseño y Técnica: etapas, clase y elegirla a mano", async () => {
  const patches = [];
  global.fetch = async (url, opts = {}) => {
    const { method, path, body } = JSON.parse(opts.body || "{}");
    if (method === "PATCH") { patches.push({ path, body }); return new Response(JSON.stringify({ data: [] }), { status: 200 }); }
    if (String(path).startsWith("necesidades_stock")) {
      return new Response(JSON.stringify({ data: [{ ot: "M-7900", nombre: "BISAGRA-1 PZ", cantidad: 40 }, { ot: "M-7900", nombre: "MELAMINA 18MM-4,7M2", cantidad: 6 }, { ot: "M-7900", nombre: "CANTO 22-1 MT", cantidad: 90 }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  const proyecto = {
    id: 5, ot: "M-7900", descripcion: "COCINA", clase_auto: "B",
    etapas_diseno: { dis: { e: "hecho", q: "GR" }, relev: { e: "na" }, np: { e: "falta" }, nf: { e: "hecho", q: "MJT" }, excel: { e: "hecho", q: "MJT" }, pdf: { e: "falta" } },
  };
  let guardado = null;
  render(<DisenoTecnicaOt proyecto={proyecto} empresaId="e1" puedeEditar onGuardado={(v) => { guardado = v; }} />);
  await esperar();
  const region = screen.getByRole("region", { name: "Diseño y Técnica" });
  assert.match(region.textContent, /Clase B/);
  assert.match(region.textContent, /comparada con las demás OT de Cocina/);
  assert.match(region.textContent, /40 componentes, 6 placas y 90 m de canto/);
  assert.match(region.textContent, /Diseño · GR50%/);
  assert.match(region.textContent, /Técnica · MJT67%/);
  assert.match(region.textContent, /Relevamiento \(no aplica\)/);
  assert.match(region.textContent, /PDF: falta/);
  fireEvent.click(screen.getByRole("button", { name: "A" }));
  await esperar();
  assert.deepEqual(patches[0], { path: "proyectos?id=eq.5", body: { clase_complejidad: "A" } });
  assert.deepEqual(guardado, { id: 5, clase_complejidad: "A" });
  assert.match(region.textContent, /Clase A/);
  assert.match(region.textContent, /Clase elegida a mano/);
  fireEvent.click(screen.getByRole("button", { name: "↺ Automática" }));
  await esperar();
  assert.deepEqual(patches[1].body, { clase_complejidad: null });
});

test("Detalle OT — sin permiso no se puede cambiar la clase; sin etapas avisa de dónde salen", async () => {
  render(<DisenoTecnicaOt proyecto={{ id: 1, ot: "M-1", descripcion: "PLACARD" }} empresaId="e1" />);
  await esperar();
  const region = screen.getByRole("region", { name: "Diseño y Técnica" });
  assert.match(region.textContent, /Clase B/);
  assert.match(region.textContent, /Sin datos todavía/);
  assert.match(region.textContent, /columnas DIS a PDF del Plan de trabajo/);
  assert.equal(screen.queryByRole("group", { name: "Elegir la clase" }), null);
});
