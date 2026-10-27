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
// OT planificadas, 4 renglones por OT (uno por proceso), en secuencia y con una
// sola OT a la vez por proceso, 8 horas por día; atrasados marcados adentro.
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


test("📅 Gantt — solo OT planificadas, 4 renglones por OT y los atrasados marcados", () => {
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
  const ot = container.querySelector('[data-ot="7100"]');
  assert.equal(ot.querySelectorAll("svg").length, 4, "un renglón por proceso");
  assert.deepEqual([...ot.querySelectorAll(".h-\\[34px\\]")].map((d) => d.textContent), ["Corte", "Canteado", "Mecanizado", "Armado"]);
  assert.match(screen.getByText("⚠ Atrasados 1").textContent, /1/);
  const lista = screen.getByRole("region", { name: "Procesos atrasados" });
  assert.match(lista.textContent, /7100 · Corte: tenía que terminar el .* \(\d+ días? de atraso\) · 0% hecho/);
  const corte = ot.querySelector('[data-proceso="corte"]');
  assert.equal(corte.getAttribute("data-estado"), "atrasado");
  assert.match(corte.getAttribute("class"), /fill-proc-corte stroke-gypi-red/, "contorno rojo y el color del proceso igual");
  assert.equal(container.querySelector('[data-ot="7200"] [data-proceso="canteado"]').getAttribute("data-estado"), "completo");
  assert.equal(ot.querySelector('[data-proceso="armado"]').getAttribute("data-estado"), "pendiente", "no arranca antes del día que le dio el plan");
  fireEvent.click(screen.getByRole("button", { name: /^OT 7100: 18 h en total; Corte 12 h, del .*atrasado \d+ días?; Armado 6 h/ }));
  assert.deepEqual(vistos, ["7100"]);
});

test("📅 Gantt — por días, semanas o mes, fila de fechas fija y pantalla completa", () => {
  const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" }];
  const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={PLANES} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  // Arranca por días: la cabecera trae "S44 · 25/10" y los números de cada día
  assert.equal(screen.getByRole("button", { name: "Días" }).getAttribute("aria-pressed"), "true");
  assert.ok(container.querySelector("svg text")?.textContent.includes("·"), "la semana va arriba de los días");
  assert.ok(container.querySelector(".sticky.top-0"), "la fila de las fechas queda fija al bajar");
  assert.ok(container.querySelector(".max-h-\\[75vh\\].overflow-auto"), "el Gantt tiene scroll propio");
  fireEvent.click(screen.getByRole("button", { name: "Semanas" }));
  assert.ok(!container.querySelector("svg text")?.textContent.includes("·"));
  fireEvent.click(screen.getByRole("button", { name: "Mes" }));
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  assert.ok([...container.querySelectorAll("svg text")].some((t) => meses.some((m) => t.textContent.startsWith(m))), "por mes, el nombre del mes arriba");
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
    { id: 1, desde: "2026-10-01", hasta: "2026-10-31", items: [{ ot: "A", etapa: "corte", fecha: "2026-10-05", horas: 8 }, { ot: "A", etapa: "armado", fecha: "2026-10-27", horas: 8 }] },
    { id: 2, desde: "2026-10-25", hasta: "2026-10-31", items: [{ ot: "A", etapa: "armado", fecha: "2026-10-29", horas: 8 }] },
  ];
  const items = itemsVigentes(planes);
  assert.deepEqual(items.map((i) => i.fecha).sort(), ["2026-10-05", "2026-10-29"], "el 27 lo pisa la semana confirmada");
  const procesos = procesosPlan(items, { etapasCodigo: { corte: 1, armado: 4 }, avance: [{ ot: "A", etapa: 4, estado: "terminada" }], hoy: "2026-10-30" });
  const a = procesos.get("A");
  assert.deepEqual(a.procesos.map((p) => [p.etapa, p.hasta, p.completo, p.diasAtraso]), [["corte", "2026-10-05", false, 25], ["armado", "2026-10-29", true, 0]]);
  const filas = [{ proyecto: { ot: "A" }, cerradas: 1, celdas: [{}, {}] }, { proyecto: { ot: "B" }, cerradas: 0, celdas: [{}] }];
  const r = otAtrasadasPlan(filas, procesos);
  assert.deepEqual(r.map((x) => [x.fila.proyecto.ot, x.dias, x.porcentaje]), [["A", 25, 50]]);
  // Terminada en la planilla: nada atrasado
  assert.equal(procesosPlan(items, { terminadas: new Set(["A"]), hoy: "2026-10-30" }).get("A").atrasados.length, 0);
});

// 27/10 (Tadeo): en cada OT un proceso arranca cuando termina el anterior; por
// cada proceso pasa una OT a la vez; 8 horas productivas por día.
test("procesosPlan — secuencia en la OT, una OT a la vez por proceso y las horas de la grilla", async () => {
  const { procesosPlan, horasSemanaDeGrilla } = await import("../app/lib/ganttPlan.js");
  const lun = "2026-10-26";
  const items = [
    { ot: "A", etapa: "corte", fecha: lun, horas: 4, orden: 0 },
    { ot: "A", etapa: "canteado", fecha: lun, horas: 4, orden: 0 },
    { ot: "A", etapa: "armado", fecha: lun, horas: 8, orden: 0 },
    { ot: "B", etapa: "corte", fecha: lun, horas: 6, orden: 1 },
    { ot: "B", etapa: "canteado", fecha: lun, horas: 2, orden: 1 },
    // C: Corte de 12 h que arranca un viernes sigue el lunes
    { ot: "C", etapa: "corte", fecha: "2026-10-30", horas: 12, orden: 2 },
  ];
  const r = procesosPlan(items, { hoy: "2026-10-20" });
  const tramos = (ot) => r.get(ot).procesos.map((p) => [p.etapa, p.desde, p.ini, p.hasta, p.fin]);
  assert.deepEqual(tramos("A"), [
    ["corte", lun, 0, lun, 0.5], ["canteado", lun, 0.5, lun, 1], ["armado", "2026-10-27", 0, "2026-10-27", 1],
  ]);
  // El Corte de B espera que termine el de A; su Canteado, que termine su Corte
  assert.deepEqual(tramos("B"), [["corte", lun, 0.5, "2026-10-27", 0.25], ["canteado", "2026-10-27", 0.25, "2026-10-27", 0.5]]);
  assert.deepEqual(tramos("C"), [["corte", "2026-10-30", 0, "2026-11-02", 0.5]], "sábado y domingo no se trabaja");
  assert.equal(r.get("A").horas, 16, "la OT dura la suma de sus procesos");
  assert.equal(r.get("B").horas, 8);
  // Las horas de cada día salen de la grilla de horarios del personal operativo
  // (no instaladores): de lunes a jueves de 7 a 16 (9 h), viernes de 7 a 13 (6 h), sábado y domingo nadie
  const diagrama = { lun: { in: "07:00", out: "16:00" }, mar: { in: "07:00", out: "16:00" }, mie: { in: "07:00", out: "16:00" }, jue: { in: "07:00", out: "16:00" }, vie: { in: "07:00", out: "13:00" } };
  const empleados = [
    { id: 1, rol: "operativo", division: "M", diagrama },
    { id: 2, rol: "operativo", division: "M", es_instalador: true, diagrama: { ...diagrama, sab: { in: "08:00", out: "12:00" } } },
    { id: 3, rol: "administrativo", division: "M", diagrama: { ...diagrama, dom: { in: "08:00", out: "12:00" } } },
  ];
  const horasSemana = horasSemanaDeGrilla(empleados, DIV_M, null);
  assert.deepEqual(horasSemana, [0, 9, 9, 9, 9, 6, 0]);
  assert.deepEqual(horasSemanaDeGrilla([], DIV_M, null), [0, 8, 8, 8, 8, 8, 0], "sin grilla: 8 h de lunes a viernes");
  // C: 6 h el viernes y las otras 6 h el lunes; nada el sábado ni el domingo
  const conGrilla = procesosPlan(items, { hoy: "2026-10-20", horasSemana });
  assert.deepEqual(conGrilla.get("C").procesos.map((p) => [p.desde, p.ini, p.hasta, p.fin]), [["2026-10-30", 0, "2026-11-02", 6 / 9]]);
  // A con días de 9 h: Corte 4 h + Canteado 4 h + 1 h de Armado el lunes
  assert.deepEqual(conGrilla.get("A").procesos.map((p) => [p.etapa, p.hasta]), [["corte", lun], ["canteado", lun], ["armado", "2026-10-27"]]);
  assert.equal(conGrilla.get("A").procesos[2].desde, lun);
  // Aunque el plan haya puesto horas extra un sábado, el Gantt no trabaja el fin de semana
  const sabado = procesosPlan([{ ot: "D", etapa: "corte", fecha: "2026-10-31", horas: 4 }], { hoy: "2026-10-20", horasSemana });
  assert.equal(sabado.get("D").procesos[0].desde, "2026-11-02");
  // Canteadora con 2 personas: el plan guarda horas de gente, la máquina tarda la mitad
  assert.equal(procesosPlan(items, { hoy: "2026-10-20", params: { personas_canteadora: 2 } }).get("A").procesos[1].horas, 2);
});

test("procesosPlan — poco margen: va atrasado, es su último día, o el anterior viene atrasado", async () => {
  const { procesosPlan } = await import("../app/lib/ganttPlan.js");
  const hoy = "2026-10-28"; // miércoles
  const items = [
    // B: Corte el viernes 23 (atrasado) y Armado de 40 h desde el lunes
    { ot: "B", etapa: "corte", fecha: "2026-10-23", horas: 8, orden: 0 },
    { ot: "B", etapa: "armado", fecha: "2026-10-26", horas: 40, orden: 0 },
    // A: Corte de 32 h de lunes a jueves; al empezar hoy tenía que ir 50%
    { ot: "A", etapa: "corte", fecha: "2026-10-26", horas: 32, orden: 1 },
    { ot: "A", etapa: "canteado", fecha: "2026-10-26", horas: 4, orden: 1 },
    // C: hoy es el último día de Mecanizado
    { ot: "C", etapa: "mecanizado", fecha: hoy, horas: 8, orden: 2 },
  ];
  const codigos = { corte: 1, canteado: 2, mecanizado: 3, armado: 4 };
  const r = procesosPlan(items, { etapasCodigo: codigos, piezas: [{ ot: "A", etapa: 1, total: 10, pasaron: 3 }], hoy });
  const estado = (ot) => r.get(ot).procesos.map((p) => [p.etapa, p.atrasado ? "atrasado" : p.margen ? "margen" : "ok"]);
  assert.deepEqual(estado("B"), [["corte", "atrasado"], ["armado", "margen"]]);
  assert.match(r.get("B").procesos[1].motivoMargen, /Corte viene 5 días atrasado/);
  assert.deepEqual(estado("A"), [["corte", "margen"], ["canteado", "ok"]]);
  assert.match(r.get("A").procesos[0].motivoMargen, /va 30% y tenía que ir 50%/);
  assert.deepEqual(estado("C"), [["mecanizado", "margen"]]);
  // Con el Corte de A al día (5 de 10 piezas) ya no hay aviso
  const alDia = procesosPlan(items, { etapasCodigo: codigos, piezas: [{ ot: "A", etapa: 1, total: 10, pasaron: 5 }], hoy });
  assert.equal(alDia.get("A").pocoMargen.length, 0);
});

test("📅 Gantt — colores fijos, contorno amarillo de poco margen y horas de cada proceso y de la OT", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const t of ["proc-corte: #2563EB", "proc-canteado: #F97316", "proc-mecanizado: #7C3AED", "proc-armado: #B08968", "proc-margen: #FACC15"]) assert.ok(css.includes(`--color-${t}`), t);
  // Corte de 16 h que empezó ayer y no tiene nada escaneado: al empezar hoy tenía que ir 50%
  const planes = [{ id: 1, tipo: "semana", desde: dia(-5), hasta: dia(30), items: [
    { ot: "7100", etapa: "corte", fecha: dia(-1), horas: 16 },
    { ot: "7100", etapa: "canteado", fecha: dia(20), horas: 4 },
    { ot: "7100", etapa: "mecanizado", fecha: dia(21), horas: 3 },
    { ot: "7100", etapa: "armado", fecha: dia(22), horas: 5 },
  ] }];
  const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" }];
  const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={planes} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  const barra = (id) => container.querySelector(`[data-proceso="${id}"]`);
  const corte = barra("corte");
  // Si ayer fue fin de semana el Corte arranca hoy y no hay atraso todavía: solo cuando arrancó antes
  if (corte.getAttribute("data-estado") === "margen") {
    assert.match(corte.getAttribute("class"), /fill-proc-corte stroke-proc-margen/, "contorno amarillo, el color del proceso igual");
    assert.match(screen.getByLabelText("Colores del Gantt").textContent, /Poco margen 1/);
  }
  assert.match(barra("mecanizado").getAttribute("class"), /fill-proc-mecanizado/);
  assert.match(barra("armado").getAttribute("class"), /fill-proc-armado/);
  assert.equal(screen.queryByRole("region", { name: "Procesos con poco margen" }), null, "sin el cuadro de explicación");
  const textos = [...container.querySelectorAll("svg text")].map((t) => t.textContent);
  // Horas de máquina: la canteadora con 2 personas y las 2 CNC (valores por defecto) tardan la mitad
  for (const h of ["16 h", "2 h", "1,5 h", "5 h"]) assert.ok(textos.includes(h), `horas al lado de la barra: ${h}`);
  assert.match(container.querySelector('[data-ot="7100"] button').textContent, /7100 · 24,5 h/, "total planificado al lado del nombre");
});
