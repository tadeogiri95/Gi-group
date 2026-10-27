// tests/gantt-ot.test.jsx — Gantt de OT por la SEMANA del Plan de trabajo
// (migración 135; diseño en notes/diseno-gantt-ot.md). Pedido de Tadeo
// (26/10): solo OT sin terminar y con semana; que la forma de contar la
// semana sea configurable por empresa.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { rangoSemana, numeroSemana, inicioDeSemana, semanaPlanilla, fechaObjetivo, textoObjetivo, normalizarModo } from "../app/lib/semanaObjetivo.js";
import { filasGantt, escalaGantt, primerEscaneoPorOt } from "../app/lib/gantt.js";
import { parseCsvProyectos } from "../app/lib/csvProyectos.js";

const { default: GanttOt } = await import("../app/components/GanttOt.jsx");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const CSV_URL = "https://files.example.com/plan.csv";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

test("semana del año como NUM.DE.SEMANA de Google: la planilla dice SEMANA 44 el domingo 25/10/2026", () => {
  assert.deepEqual(rangoSemana(44, 2026, "semana_domingo"), { inicio: "2026-10-25", fin: "2026-10-31" });
  assert.equal(numeroSemana("2026-10-25", 2026, "semana_domingo"), 44);
  assert.equal(numeroSemana("2026-10-24", 2026, "semana_domingo"), 43);
  // Pasado diciembre sigue contando: 61 = fines de febrero de 2027
  assert.deepEqual(rangoSemana(61, 2026, "semana_domingo"), { inicio: "2027-02-21", fin: "2027-02-27" });
  // ISO (de lunes a domingo)
  assert.deepEqual(rangoSemana(44, 2026, "semana_lunes"), { inicio: "2026-10-26", fin: "2026-11-01" });
  assert.equal(inicioDeSemana("2026-10-28", "semana_domingo"), "2026-10-25");
  assert.equal(inicioDeSemana("2026-10-28", "semana_lunes"), "2026-10-26");
});

test("semanaPlanilla — vacío, 0 o texto es sin semana", () => {
  assert.equal(semanaPlanilla("44"), 44);
  assert.equal(semanaPlanilla(" 61 "), 61);
  assert.equal(semanaPlanilla("0"), null);
  assert.equal(semanaPlanilla(""), null);
  assert.equal(semanaPlanilla("a confirmar"), null);
  assert.equal(semanaPlanilla("4,5"), null);
});

test("fechaObjetivo — último día de la semana, del año que queda más cerca de hoy", () => {
  const hoy = "2026-10-26";
  assert.equal(fechaObjetivo({ semana_objetivo: 44 }, { hoy }), "2026-10-31");
  assert.equal(fechaObjetivo({ semana_objetivo: 61 }, { hoy }), "2027-02-27");
  assert.equal(fechaObjetivo({ semana_objetivo: 35 }, { hoy }), "2026-08-29");
  // En enero, la semana 49 es la de diciembre pasado
  assert.equal(fechaObjetivo({ semana_objetivo: 49 }, { hoy: "2027-01-10" }), "2026-12-05");
  // Si ya tenía la fecha de esa misma semana, no cambia de año sola
  assert.equal(fechaObjetivo({ semana_objetivo: 2 }, { hoy, previa: "2026-01-10" }), "2026-01-10");
  assert.equal(fechaObjetivo({ semana_objetivo: 3 }, { hoy, previa: "2026-01-10" }), "2026-01-17");
  // Sin semana no hay fecha, aunque tenga entrega
  assert.equal(fechaObjetivo({ semana_objetivo: null, fecha_entrega: "2026-10-01" }, { hoy }), null);
  // La empresa que eligió "Fecha de entrega"
  assert.equal(fechaObjetivo({ semana_objetivo: 44, fecha_entrega: "2026-11-15" }, { hoy, modo: "entrega" }), "2026-11-15");
  assert.equal(normalizarModo("cualquiera"), "semana_domingo");
  assert.equal(textoObjetivo({ semana_objetivo: 44, fecha_objetivo: "2026-10-31" }), "S44 (31/10)");
  assert.equal(textoObjetivo({ semana_objetivo: 44, fecha_objetivo: "2026-11-15" }, "entrega"), "entrega 15/11/2026");
});

test("planilla — guarda la SEMANA, la más tardía de los renglones de la OT", () => {
  const { filas } = parseCsvProyectos([
    "OT,DIVISIÓN,CLIENTE ,OBRA,DESCRIPCION,ENTREGA,SEMANA ,TERMINADO",
    "M-7100,MUEBLES,BCG,HOTEL,P1,Fines de octubre,44,NO",
    "M-7100,MUEBLES,BCG,HOTEL,P3,,47,NO",
    "M-7200,MUEBLES,ANA,CASA,P1,,0,NO",
    "M-7300,MUEBLES,LUIS,CASA,P1,,,NO",
  ].join("\n"));
  const ot = (n) => filas.find((f) => f.ot === n);
  assert.equal(ot("M-7100").semana_objetivo, 47);
  assert.equal(ot("M-7200").semana_objetivo, null);
  assert.equal(ot("M-7300").semana_objetivo, null);
});

test("sync — sube la semana y su fecha objetivo según cómo cuenta la empresa", async () => {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("clave=eq.ot_fecha_objetivo") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ valor: { modo: "semana_lunes" } }] }) },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ valor: { url: CSV_URL } }] }) },
    { match: (u) => u === CSV_URL, respond: () => ({ status: 200, body: "OT,CLIENTE,SEMANA,TERMINADO\nM-1,Ana,44,NO\nM-2,Luis,,NO\n" }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?"), respond: (u, o) => { pedidos.push({ method: o.method, body: JSON.parse(o.body) }); return { status: 200, body: null }; } },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
  ]);
  const { signAccessToken } = await import("../app/lib/jwt.ts");
  const { POST } = await import("../app/api/proyectos/sync-csv/route.js");
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  const res = await POST(new Request("http://localhost/api/proyectos/sync-csv", { method: "POST", headers: { Authorization: `Bearer ${token}` } }));
  assert.equal((await res.json()).procesados, 2);
  const subidas = pedidos.filter((p) => p.method === "POST").flatMap((p) => p.body);
  const m1 = subidas.find((r) => r.ot === "M-1");
  assert.equal(m1.semana_objetivo, 44);
  // ISO: la semana 44 termina un domingo
  assert.equal(new Date(`${m1.fecha_objetivo}T00:00:00Z`).getUTCDay(), 0);
  const m2 = subidas.find((r) => r.ot === "M-2");
  assert.equal(m2.semana_objetivo, null);
  assert.equal(m2.fecha_objetivo, null);
});

const fila = (p, cerradas = 0, total = 2) => ({ proyecto: p, cerradas, celdas: Array(total).fill({}) });

test("filasGantt — solo sin terminar y con semana; la barra arranca con la liberación o el primer escaneo", () => {
  const hoy = "2026-10-26";
  const filas = [
    fila({ id: 1, ot: "7100", semana_objetivo: 42, fecha_objetivo: "2026-10-17", liberada_at: "2026-09-01T12:00:00Z" }, 1, 2),
    fila({ id: 2, ot: "7200", semana_objetivo: 44, fecha_objetivo: "2026-10-31" }),
    fila({ id: 3, ot: "7300", semana_objetivo: 47, fecha_objetivo: "2026-11-21" }),
    fila({ id: 4, ot: "7400", semana_objetivo: 47, fecha_objetivo: "2026-11-21", terminado_planilla: true }),
    fila({ id: 5, ot: "7500", fecha_objetivo: null, fecha_entrega: "2026-10-01" }),
  ];
  const primerEscaneo = primerEscaneoPorOt([{ ot: "7300", primer_paso: "2026-10-20T10:00:00Z" }, { ot: "7300", primer_paso: "2026-10-22T10:00:00Z" }]);
  const r = filasGantt(filas, { primerEscaneo, hoy });
  assert.deepEqual(r.map((x) => [x.proyecto.ot, x.estado, x.inicio, x.fin, x.porcentaje]), [
    ["7100", "atrasada", "2026-09-01", "2026-10-17", 50],
    ["7200", "esta_semana", "2026-10-25", "2026-10-31", 0],
    ["7300", "a_tiempo", "2026-10-20", "2026-11-21", 0],
  ]);
  const { semanas } = escalaGantt(r, { hoy });
  assert.equal(semanas[0].numero, 36, "arranca en la semana de la liberación más vieja");
  assert.equal(semanas.at(-1).numero, 47);
  assert.equal(semanas.find((s) => s.actual).numero, 44);
});

// Desde el 27/10 el Gantt muestra el plan de producción confirmado (138): solo
// OT planificadas, una línea por proceso y los atrasados marcados adentro.
const { hoyArg } = await import("../app/lib/dates.js");
const hoyReal = hoyArg(); // el Gantt cuenta los días con la hora de Argentina
const dia = (n) => new Date(Date.parse(`${hoyReal}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const PLANES = [{
  id: 1, tipo: "semana", desde: dia(-20), hasta: dia(20), items: [
    { ot: "7100", etapa: "corte", fecha: dia(-10), horas: 6, orden: 0 },
    { ot: "7100", etapa: "corte", fecha: dia(-9), horas: 6, orden: 0 },
    { ot: "7100", etapa: "armado", fecha: dia(5), horas: 6, orden: 0 },
    { ot: "7200", etapa: "canteado", fecha: dia(-3), horas: 4, orden: 1 },
    { ot: "7200", etapa: "mecanizado", fecha: dia(2), horas: 4, orden: 1 },
  ],
}];
const ETAPAS_M = [{ codigo: 1, nombre: "Corte" }, { codigo: 2, nombre: "Canteado" }, { codigo: 3, nombre: "Mecanizado CNC" }, { codigo: 4, nombre: "Armado" }];
const DIV_M = [{ id: "M", label: "Muebles", ruta_etapas: [1, 2, 3, 4] }];

test("📅 Gantt — solo OT planificadas, los procesos de cada OT y los atrasados marcados", () => {
  const vistos = [];
  const proyectos = [
    { id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" },
    { id: 2, ot: "7200", cliente: "Ana", division: "M", estado: "activo" },
    { id: 3, ot: "7300", cliente: "Sin plan", division: "M", semana_objetivo: 44, fecha_objetivo: dia(3), estado: "activo" },
  ];
  // 7200: Canteado completo por escaneo (todas las piezas pasaron)
  const piezas = [{ ot: "7200", etapa: 2, total: 10, pasaron: 10 }];
  const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={PLANES} cfgValor={null}
    avanceHoras={{ avance: [], horas: new Set(), piezas }} onVerDetalle={(p) => vistos.push(p.ot)} />);
  assert.ok(screen.getByText("Muebles · 2"));
  assert.equal(screen.queryByText("7300"), null, "sin plan no aparece");
  assert.ok(screen.getByText("⚠ Atrasados 1"));
  const lista = screen.getByRole("region", { name: "Procesos atrasados" });
  assert.match(lista.textContent, /7100 · Corte: tenía que terminar el .* \(9 días de atraso\) · 0% hecho/);
  assert.equal(container.querySelector('[data-proceso="corte"]').getAttribute("data-estado"), "atrasado");
  assert.equal(container.querySelector('[data-proceso="canteado"]').getAttribute("data-estado"), "completo");
  assert.equal(container.querySelectorAll('[data-proceso="armado"][data-estado="pendiente"]').length, 1);
  fireEvent.click(screen.getByRole("button", { name: /^OT 7100: 18 h en total; Corte del .*atrasado 9 días; Armado/ }));
  assert.deepEqual(vistos, ["7100"]);
});

test("📅 Gantt — por días con la semana arriba, fila de fechas fija y pantalla completa", () => {
  const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" }];
  const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={PLANES} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  // Arranca por días: la cabecera trae "S44 · 25/10" y los números de cada día
  assert.equal(screen.getByRole("button", { name: "Días" }).getAttribute("aria-pressed"), "true");
  assert.ok(container.querySelector("svg text")?.textContent.includes("·"), "la semana va arriba de los días");
  assert.ok(container.querySelector(".sticky.top-0"), "la fila de las fechas queda fija al bajar");
  assert.ok(container.querySelector(".max-h-\\[70vh\\].overflow-auto"), "el Gantt tiene scroll propio");
  fireEvent.click(screen.getByRole("button", { name: "Semanas" }));
  assert.ok(!container.querySelector("svg text")?.textContent.includes("·"));
  fireEvent.click(screen.getByRole("button", { name: "⛶ Pantalla completa" }));
  assert.ok(screen.getByRole("dialog", { name: "Gantt de OT en pantalla completa" }));
  fireEvent.click(screen.getByRole("button", { name: "✕ Salir" }));
  assert.equal(screen.queryByRole("dialog"), null);
});

test("la app instalada se puede girar (el Gantt se ve mejor apaisado)", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.orientation, "any");
});

test("📅 Gantt — sin plan confirmado explica cómo armarlo", () => {
  render(<GanttOt proyectos={[{ id: 1, ot: "7100", estado: "activo", fecha_objetivo: dia(3) }]} planes={[]} avanceHoras={null} />);
  assert.ok(screen.getByText("No hay OT planificadas"));
  assert.ok(screen.getByText(/Confirmar plan/));
});

test("Proyectos → OT tiene el chip 📅 Gantt y la opción de cómo contar la semana", () => {
  const src = readFileSync(new URL("../app/proyectos_screen.jsx", import.meta.url), "utf8");
  assert.match(src, /📅 Gantt/);
  assert.match(src, /MODOS_FECHA_OBJETIVO/);
  const sql = readFileSync(new URL("../supabase/migrations/135_ot_semana_objetivo.sql", import.meta.url), "utf8");
  assert.match(sql, /semana_objetivo smallint/);
  assert.match(sql, /fecha_objetivo date/);
  assert.match(sql, /do \$mig\$/);
});

test("itemsVigentes y otAtrasadasPlan — la semana le gana al mes; atrasada la OT con un proceso vencido", async () => {
  const { itemsVigentes, procesosPlan, otAtrasadasPlan } = await import("../app/lib/ganttPlan.js");
  const planes = [
    { id: 1, desde: "2026-10-01", hasta: "2026-10-31", items: [{ ot: "A", etapa: "corte", fecha: "2026-10-05" }, { ot: "A", etapa: "armado", fecha: "2026-10-27" }] },
    { id: 2, desde: "2026-10-25", hasta: "2026-10-31", items: [{ ot: "A", etapa: "armado", fecha: "2026-10-29" }] },
  ];
  const items = itemsVigentes(planes);
  assert.deepEqual(items.map((i) => i.fecha).sort(), ["2026-10-05", "2026-10-29"], "el 27 lo pisa la semana confirmada");
  const procesos = procesosPlan(items, { etapasCodigo: { corte: 1, armado: 4 }, avance: [{ ot: "A", etapa: 4, estado: "terminada" }], hoy: "2026-10-30" });
  const a = procesos.get("A");
  assert.deepEqual(a.procesos.map((p) => [p.etapa, p.completo, p.diasAtraso]), [["corte", false, 25], ["armado", true, 0]]);
  const filas = [{ proyecto: { ot: "A" }, cerradas: 1, celdas: [{}, {}] }, { proyecto: { ot: "B" }, cerradas: 0, celdas: [{}] }];
  const r = otAtrasadasPlan(filas, procesos);
  assert.deepEqual(r.map((x) => [x.fila.proyecto.ot, x.dias, x.porcentaje]), [["A", 25, 50]]);
  // Terminada en la planilla: nada atrasado
  assert.equal(procesosPlan(items, { terminadas: new Set(["A"]), hoy: "2026-10-30" }).get("A").atrasados.length, 0);
});

// 27/10: cada proceso con su color fijo (azul, naranja, violeta, marrón claro)
// y amarillo cuando queda poco margen; los procesos van uno detrás del otro.
test("procesosPlan — poco margen: va atrasado contra el plan, último día, o el anterior viene atrasado o justo", async () => {
  const { procesosPlan } = await import("../app/lib/ganttPlan.js");
  const hoy = "2026-10-28";
  const items = [
    // A: Corte del 26 al 29, 4 h por día; hasta ayer tenía que ir 50%
    ...["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"].map((fecha) => ({ ot: "A", etapa: "corte", fecha, horas: 4 })),
    // Canteado arranca el 30: el Corte justo lo deja sin días libres
    { ot: "A", etapa: "canteado", fecha: "2026-10-30", horas: 4 },
    { ot: "A", etapa: "armado", fecha: "2026-11-20", horas: 4 },
    // B: Corte atrasado 3 días; Canteado arranca en 2 días (sin margen), Armado lejos
    { ot: "B", etapa: "corte", fecha: "2026-10-25", horas: 4 },
    { ot: "B", etapa: "canteado", fecha: "2026-10-30", horas: 4 },
    { ot: "B", etapa: "armado", fecha: "2026-11-20", horas: 4 },
    // C: hoy es el último día de Mecanizado
    { ot: "C", etapa: "mecanizado", fecha: "2026-10-28", horas: 4 },
  ];
  const piezas = [{ ot: "A", etapa: 1, total: 10, pasaron: 3 }];
  const r = procesosPlan(items, { etapasCodigo: { corte: 1, canteado: 2, mecanizado: 3, armado: 4 }, piezas, hoy });
  const estado = (ot) => r.get(ot).procesos.map((p) => [p.etapa, p.atrasado ? "atrasado" : p.margen ? "margen" : "ok"]);
  assert.deepEqual(estado("A"), [["corte", "margen"], ["canteado", "margen"], ["armado", "ok"]]);
  assert.match(r.get("A").procesos[0].motivoMargen, /va 30% y el plan tenía 50% hasta ayer/);
  assert.match(r.get("A").procesos[1].motivoMargen, /Corte viene justo/);
  assert.deepEqual(estado("B"), [["corte", "atrasado"], ["canteado", "margen"], ["armado", "ok"]]);
  assert.match(r.get("B").procesos[1].motivoMargen, /Corte viene 3 días atrasado/);
  assert.deepEqual(estado("C"), [["mecanizado", "margen"]]);
  assert.equal(r.get("C").pocoMargen.length, 1);
  // Con el Corte de A al día (5 de 10 piezas = 50%) ya no hay aviso
  const alDia = procesosPlan(items, { etapasCodigo: { corte: 1, canteado: 2, mecanizado: 3, armado: 4 }, piezas: [{ ot: "A", etapa: 1, total: 10, pasaron: 5 }], hoy });
  assert.equal(alDia.get("A").pocoMargen.length, 0);
});

test("📅 Gantt — colores fijos por proceso y amarillo con la lista de poco margen", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const t of ["proc-corte: #2563EB", "proc-canteado: #F97316", "proc-mecanizado: #7C3AED", "proc-armado: #B08968", "proc-margen: #FACC15"]) assert.ok(css.includes(`--color-${t}`), t);
  const planes = [{ id: 1, tipo: "semana", desde: dia(-5), hasta: dia(10), items: [
    { ot: "7100", etapa: "corte", fecha: dia(-3), horas: 4 },
    { ot: "7100", etapa: "corte", fecha: dia(1), horas: 4 },
    { ot: "7100", etapa: "canteado", fecha: dia(2), horas: 4 },
    { ot: "7100", etapa: "mecanizado", fecha: dia(6), horas: 4 },
    { ot: "7100", etapa: "armado", fecha: dia(9), horas: 4 },
  ] }];
  const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" }];
  const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={planes} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  const barra = (id) => container.querySelector(`[data-proceso="${id}"]`);
  assert.equal(barra("corte").getAttribute("data-estado"), "margen");
  assert.match(barra("corte").getAttribute("class"), /fill-proc-margen/);
  assert.equal(barra("canteado").getAttribute("data-estado"), "margen", "va después de un Corte justo y arranca enseguida");
  assert.equal(barra("mecanizado").getAttribute("data-estado"), "pendiente");
  assert.match(barra("mecanizado").getAttribute("class"), /fill-proc-mecanizado/);
  assert.match(barra("armado").getAttribute("class"), /fill-proc-armado/);
  const leyenda = screen.getByLabelText("Colores del Gantt");
  assert.match(leyenda.textContent, /🟡 Poco margen 2/);
  assert.ok(leyenda.querySelector(".bg-proc-corte") && leyenda.querySelector(".bg-proc-canteado"));
  const lista = screen.getByRole("region", { name: "Procesos con poco margen" });
  assert.match(lista.textContent, /7100 · Corte .*va 0% y el plan tenía 50% hasta ayer/);
  assert.ok(screen.getByText("🟡 7100"));
});

// 27/10: los procesos van en secuencia en una sola línea por OT; el día en que
// uno termina y arranca el siguiente se reparte según las horas.
test("📅 Gantt — una sola línea por OT con los procesos en secuencia y las horas totales", async () => {
  const { procesosPlan } = await import("../app/lib/ganttPlan.js");
  const items = [
    { ot: "A", etapa: "corte", fecha: "2026-10-26", horas: 8 },
    { ot: "A", etapa: "corte", fecha: "2026-10-27", horas: 2 },
    { ot: "A", etapa: "canteado", fecha: "2026-10-27", horas: 6 },
    { ot: "A", etapa: "armado", fecha: "2026-10-28", horas: 4 },
  ];
  const a = procesosPlan(items, { hoy: "2026-10-20" }).get("A");
  assert.equal(a.horas, 20, "la OT dura la suma de sus procesos");
  assert.deepEqual(a.procesos.map((p) => [p.etapa, p.ini, p.fin]), [["corte", 0, 0.25], ["canteado", 0.25, 1], ["armado", 0, 1]]);

  const planes = [{ id: 1, tipo: "semana", desde: dia(1), hasta: dia(10), items: [
    { ot: "7100", etapa: "corte", fecha: dia(2), horas: 8 },
    { ot: "7100", etapa: "corte", fecha: dia(3), horas: 2 },
    { ot: "7100", etapa: "canteado", fecha: dia(3), horas: 6 },
    { ot: "7100", etapa: "mecanizado", fecha: dia(4), horas: 3 },
    { ot: "7100", etapa: "armado", fecha: dia(5), horas: 5 },
  ] }];
  const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" }];
  const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={planes} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  const barras = ["corte", "canteado", "mecanizado", "armado"].map((id) => container.querySelector(`[data-proceso="${id}"]`));
  assert.equal(new Set(barras.map((b) => b.getAttribute("y"))).size, 1, "todas en la misma línea");
  for (let i = 1; i < barras.length; i++) {
    const finAnterior = Number(barras[i - 1].getAttribute("x")) + Number(barras[i - 1].getAttribute("width"));
    assert.ok(Number(barras[i].getAttribute("x")) >= finAnterior - 0.01, "cada proceso arranca cuando termina el anterior");
  }
  assert.ok([...container.querySelectorAll("svg text")].some((t) => t.textContent === "24 h"), "horas totales de la OT al final");
  assert.match(screen.getByRole("button", { name: /^OT 7100: 24 h en total; Corte/ }).getAttribute("aria-label"), /Armado/);
});
