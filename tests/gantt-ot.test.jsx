// tests/gantt-ot.test.jsx — Gantt de OT por la SEMANA del Plan de trabajo
// (migración 135; diseño en notes/diseno-gantt-ot.md). Pedido de Tadeo
// (26/10): solo OT sin terminar y con semana; que la forma de contar la
// semana sea configurable por empresa.
import "./helpers/domSetup.js";
import { test, before, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { rangoSemana, numeroSemana, inicioDeSemana, semanaPlanilla, fechaObjetivo, textoObjetivo, normalizarModo } from "../app/lib/semanaObjetivo.js";
import { filasGantt, escalaGantt, primerEscaneoPorOt, ventanaGantt, enVentana, escalaAncho } from "../app/lib/gantt.js";
import { parseCsvProyectos } from "../app/lib/csvProyectos.js";

const { default: GanttOt } = await import("../app/components/GanttOt.jsx");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const CSV_URL = "https://files.example.com/plan.csv";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
// El Gantt pide las etiquetas de módulo (piezas_ot): sin red, responde vacío
const sinRed = async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
global.fetch = sinRed;
afterEach(() => { cleanup(); global.fetch = sinRed; try { localStorage.clear(); } catch { /* sin almacenamiento */ } });

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


// Plan vivo (Tadeo, 29/10): las fechas se arman desde hoy con lo que falta y
// el orden del plan confirmado. Hoy = lunes 26/10/2026.
const lunes26 = () => mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-26T15:00:00Z") });
const PLAN_VIVO = [{
  id: 1, tipo: "semana", desde: "2026-10-12", hasta: "2026-11-30", items: [
    { ot: "7100", etapa: "corte", fecha: "2026-10-19", horas: 6, orden: 0 },
    { ot: "7100", etapa: "corte", fecha: "2026-10-20", horas: 6, orden: 0 },
    { ot: "7100", etapa: "armado", fecha: "2026-10-30", horas: 6, orden: 0 },
    { ot: "7200", etapa: "canteado", fecha: "2026-10-23", horas: 4, orden: 1 },
    { ot: "7200", etapa: "mecanizado", fecha: "2026-10-27", horas: 4, orden: 1 },
  ],
}];

test("📅 Gantt — plan vivo: lo que no se hizo pasa a hoy, todo se corre y avisa las dos alertas", () => {
  lunes26();
  try {
    const vistos = [];
    const proyectos = [
      { id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo", fecha_objetivo: "2026-10-24" },
      { id: 2, ot: "7200", cliente: "Ana", division: "M", estado: "activo", fecha_objetivo: "2026-10-31" },
      { id: 3, ot: "7300", cliente: "Sin plan", division: "M", semana_objetivo: 44, fecha_objetivo: "2026-10-31", estado: "activo" },
    ];
    // 7200: Canteado completo por escaneo (del jueves 22 al viernes 23)
    const piezas = [{ ot: "7200", etapa: 2, total: 10, pasaron: 10, primer_paso: "2026-10-22T13:00:00Z", ultimo_paso: "2026-10-23T18:00:00Z" }];
    const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={PLAN_VIVO} cfgValor={null}
      avanceHoras={{ avance: [], horas: new Set(), piezas }} onVerDetalle={(p) => vistos.push(p.ot)} />);
    assert.ok(screen.getByText("Muebles · 2"));
    assert.equal(screen.queryByText("7300"), null, "sin plan no aparece");
    const ot = container.querySelector('[data-ot="7100"]');
    assert.equal(ot.querySelector("svg").getAttribute("height"), "26", "filas bajas para que entren más OT (29/10)");
    assert.equal(ot.querySelectorAll("svg").length, 4, "un renglón por proceso");
    assert.deepEqual([...ot.querySelectorAll(".h-\\[26px\\]")].map((d) => d.textContent), ["Corte", "Canteado", "Mecanizado", "Armado"]);
    // El Corte no se hizo: arranca hoy y termina el martes (12 h con 8 h por día), se corrió 7 días;
    // el Armado (6 h) termina el miércoles 28: la OT pasa 4 días su semana (sábado 24)
    const colores = screen.getByLabelText("Colores del Gantt").textContent;
    assert.match(colores, /⚠ Termina después de su semana 1/);
    assert.match(colores, /↪ Se corrió del plan 1/);
    const corte = ot.querySelector('[data-proceso="corte"]');
    assert.equal(corte.getAttribute("data-estado"), "tarde");
    assert.match(corte.getAttribute("class"), /stroke-gypi-red/, "contorno rojo");
    assert.match(ot.querySelector("[data-alertas]").textContent, /⚠ \+4 d de su semana · ↪ \+7 d del plan/, "cada OT muestra las dos alertas");
    const alertas = screen.getByRole("region", { name: "Alertas del plan" });
    assert.match(alertas.textContent, /7100 · termina el 28\/10\/2026 · ⚠ 4 días después de su semana .* · ↪ se corrió 7 días del plan confirmado/);
    // El cuadro se minimiza para ver el Gantt entero, y se vuelve a abrir
    fireEvent.click(within(alertas).getByRole("button", { name: /Minimizar/ }));
    assert.doesNotMatch(alertas.textContent, /termina el/);
    fireEvent.click(within(alertas).getByRole("button", { name: /Ver detalle/ }));
    assert.match(alertas.textContent, /termina el/);
    // 7200: el Canteado terminado se ve desde que arrancó, más claro; el Mecanizado arranca hoy, antes de lo planificado
    const ot2 = container.querySelector('[data-ot="7200"]');
    assert.equal(ot2.querySelector('[data-proceso="canteado"]').getAttribute("data-estado"), "completo");
    assert.ok(ot2.querySelector('[data-pasado="canteado"]'), "la parte que ya pasó");
    assert.equal(ot2.querySelector('[data-proceso="mecanizado"]').getAttribute("data-estado"), "pendiente");
    assert.equal(ot2.querySelector("[data-alertas]"), null, "sin alertas");
    fireEvent.click(screen.getByRole("button", { name: /^OT 7100: faltan 18 h, termina 4 días después de su semana, se corrió 7 días del plan confirmado; Corte 12 h, del 26\/10\/2026 al 27\/10\/2026/ }));
    assert.deepEqual(vistos, ["7100"]);
  } finally {
    mock.timers.reset();
  }
});

test("planVivo — con los parámetros de ahora, desde el día que arrancó y corrido contra el plan confirmado", async () => {
  const { planVivo } = await import("../app/lib/ganttPlan.js");
  const { normalizarParametros } = await import("../app/lib/planificacion.js");
  const items = [{ ot: "A", etapa: "corte", fecha: "2026-10-22", horas: 8, orden: 0 }];
  const proyectos = new Map([["A", { ot: "A", placas: 48, fecha_objetivo: "2026-11-07" }]]);
  // 48 placas a 10 min = 8 h: igual que el plan, pero lo no hecho arranca hoy (lunes 26)
  const params = normalizarParametros({ min_placa: 10, eficiencia: 100, etapas: { corte: 1 } });
  const r = planVivo(items, { proyectos, params, etapasCodigo: { corte: 1 }, hoy: "2026-10-26" }).get("A");
  assert.deepEqual([r.procesos[0].desde, r.procesos[0].hasta, r.procesos[0].horas], ["2026-10-26", "2026-10-26", 8]);
  assert.equal(r.diasCorrido, 4, "el plan decía jueves 22");
  assert.equal(r.tarde, false);
  // Si se sube el tiempo por placa, el plan cambia sin volver a confirmar
  const lento = planVivo(items, { proyectos, params: { ...params, min_placa: 20 }, etapasCodigo: { corte: 1 }, hoy: "2026-10-26" }).get("A");
  assert.deepEqual([lento.procesos[0].hasta, lento.procesos[0].horas], ["2026-10-27", 16]);
  // Con la mitad escaneada desde el viernes: la barra arranca el viernes y faltan 4 h
  const piezas = [{ ot: "A", etapa: 1, total: 10, pasaron: 5, primer_paso: "2026-10-23T12:00:00Z" }];
  const mitad = planVivo(items, { proyectos, params, etapasCodigo: { corte: 1 }, piezas, hoy: "2026-10-26" }).get("A");
  assert.deepEqual([mitad.procesos[0].desde, mitad.procesos[0].ini, mitad.procesos[0].horas, mitad.procesos[0].hecho], ["2026-10-23", 0, 4, 50]);
});

test("📅 Gantt — lo elegido ocupa todo el ancho, fila de fechas fija y pantalla completa", () => {
  // 1 semana en 1050 px de barras: 150 px por día (sin tope, 29/10); 4 semanas: 37,5 px por día
  assert.deepEqual(escalaAncho(1050, 7), { px: 150, vista: "dias" });
  assert.deepEqual(escalaAncho(1050, 1), { px: 1050, vista: "dias" }, "1 día ocupa todo el ancho");
  assert.deepEqual(escalaAncho(1050, 28), { px: 37.5, vista: "dias" });
  assert.equal(escalaAncho(1050, 70).vista, "semanas", "10 semanas: no entran los números de cada día");
  assert.equal(escalaAncho(1050, 300).vista, "mes");
  assert.equal(escalaAncho(1050, 2000).px, 2, "nunca menos de 2 px por día");
  assert.deepEqual(escalaAncho(0, 28), { px: 44, vista: "dias" }, "sin medir todavía, por días");
  const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" }];
  const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={PLANES} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  assert.equal(screen.queryByRole("button", { name: "Días" }), null, "la escala sale sola de las semanas elegidas");
  assert.ok(container.querySelector("svg text")?.textContent.includes("·"), "por días, la semana va arriba de los días");
  assert.ok(container.querySelector(".sticky.top-0"), "la fila de las fechas queda fija al bajar");
  assert.ok(container.querySelector(".max-h-\\[75vh\\].overflow-auto"), "el Gantt tiene scroll propio");
  fireEvent.click(screen.getByRole("button", { name: "⛶ Pantalla completa" }));
  assert.ok(screen.getByRole("dialog", { name: "Gantt de OT en pantalla completa" }));
  fireEvent.click(screen.getByRole("button", { name: "✕ Salir" }));
  assert.equal(screen.queryByRole("dialog"), null);
});

test("📅 Gantt — 🔄 Refrescar vuelve a leer todo sin salir de la pantalla completa", async () => {
  const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" }];
  let veces = 0;
  render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={PLANES} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }}
    onRefrescar={async () => { veces++; }} />);
  fireEvent.click(screen.getByRole("button", { name: "⛶ Pantalla completa" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "🔄 Refrescar" })); for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); });
  assert.equal(veces, 1);
  assert.ok(screen.getByRole("dialog", { name: "Gantt de OT en pantalla completa" }), "sigue en pantalla completa");
  assert.ok(screen.getByRole("button", { name: "🔄 Refrescar" }), "listo para otra vez");
  const pantalla = readFileSync(new URL("../app/proyectos_screen.jsx", import.meta.url), "utf8");
  assert.match(pantalla, /onRefrescar=\{refrescarOts\}/);
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

// 29/10 (Tadeo): confirmó un plan de 1 OT y el Gantt seguía con 13 OT de los
// días ya pasados de los planes anteriores. Manda solo el último confirmado.
test("itemsVigentes — de cada división manda solo el último plan confirmado, entero", async () => {
  const { itemsVigentes } = await import("../app/lib/ganttPlan.js");
  const viejo = { id: 1, desde: "2026-10-26", hasta: "2026-10-28", confirmado_at: "2026-10-26T10:00:00Z", division_id: 1,
    items: [{ ot: "V1", etapa: "corte", fecha: "2026-10-26", horas: 8 }, { ot: "V2", etapa: "corte", fecha: "2026-10-27", horas: 8 }] };
  const nuevo = { id: 2, desde: "2026-10-29", hasta: "2026-11-05", confirmado_at: "2026-10-29T01:00:00Z", division_id: 1,
    items: [{ ot: "N", etapa: "corte", fecha: "2026-10-29", horas: 8 }] };
  const otraDivision = { id: 3, desde: "2026-10-20", hasta: "2026-11-30", confirmado_at: "2026-10-20T10:00:00Z", division_id: 2,
    items: [{ ot: "P", etapa: "armado", fecha: "2026-10-30", horas: 8 }] };
  assert.deepEqual(itemsVigentes([viejo, nuevo]).map((i) => i.ot), ["N"], "sin las OT de los días pasados del plan viejo");
  assert.deepEqual(itemsVigentes([nuevo, viejo]).map((i) => i.ot), ["N"], "no importa el orden en que llegan");
  assert.deepEqual(itemsVigentes([viejo, nuevo, otraDivision]).map((i) => i.ot).sort(), ["N", "P"], "cada división con el suyo");
  assert.deepEqual(itemsVigentes([]), []);
});

test("otAtrasadasPlan — atrasada la OT con un proceso vencido", async () => {
  const { itemsVigentes, procesosPlan, otAtrasadasPlan } = await import("../app/lib/ganttPlan.js");
  const planes = [
    { id: 2, desde: "2026-10-01", hasta: "2026-10-31", items: [{ ot: "A", etapa: "corte", fecha: "2026-10-05", horas: 8 }, { ot: "A", etapa: "armado", fecha: "2026-10-29", horas: 8 }] },
  ];
  const items = itemsVigentes(planes);
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

test("📅 Gantt — colores fijos, contorno cortado si se corrió y horas que faltan de cada proceso y de la OT", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const t of ["proc-corte: #2563EB", "proc-canteado: #F97316", "proc-mecanizado: #7C3AED", "proc-armado: #B08968", "proc-margen: #FACC15"]) assert.ok(css.includes(`--color-${t}`), t);
  lunes26();
  try {
    // Corte de 16 h planificado el jueves 22 y sin escanear: pasa a lunes y martes
    const planes = [{ id: 1, tipo: "semana", desde: "2026-10-19", hasta: "2026-11-30", items: [
      { ot: "7100", etapa: "corte", fecha: "2026-10-22", horas: 16 },
      { ot: "7100", etapa: "canteado", fecha: "2026-11-10", horas: 4 },
      { ot: "7100", etapa: "mecanizado", fecha: "2026-11-11", horas: 3 },
      { ot: "7100", etapa: "armado", fecha: "2026-11-12", horas: 5 },
    ] }];
    const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" }];
    const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={planes} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
    const barra = (id) => container.querySelector(`[data-proceso="${id}"]`);
    assert.equal(barra("corte").getAttribute("data-estado"), "corrido");
    assert.match(barra("corte").getAttribute("class"), /stroke-proc-margen/, "contorno amarillo");
    assert.equal(barra("corte").getAttribute("stroke-dasharray"), "6 3", "cortado, distinto del rojo");
    assert.match(screen.getByLabelText("Colores del Gantt").textContent, /↪ Se corrió del plan 1/);
    assert.ok(container.querySelector("rect.fill-proc-mecanizado"));
    assert.ok(container.querySelector("rect.fill-proc-armado"));
    const textos = [...container.querySelectorAll("svg text")].map((t) => t.textContent);
    // Horas de máquina: la canteadora con 2 personas y las 2 CNC (valores por defecto) tardan la mitad
    for (const h of ["16 h ↪", "2 h", "1,5 h", "5 h"]) assert.ok(textos.includes(h), `horas al lado de la barra: ${h}`);
    assert.match(container.querySelector('[data-ot="7100"] button').textContent, /7100 · 24,5 h/, "lo que le falta, al lado del nombre");
  } finally {
    mock.timers.reset();
  }
});

test("ventanaGantt — ◀ ▶ corren la ventana elegida para atrás y para adelante", () => {
  const escala = escalaGantt([{ inicio: "2026-10-26", fin: "2026-11-06", proyecto: {} }], { hoy: "2026-10-28" });
  const v = (c, h = "1s") => { const x = ventanaGantt(escala, h, "2026-10-28", c); return [x.desde, x.hasta]; };
  assert.deepEqual(v(0), ["2026-10-28", "2026-11-04"]);
  assert.deepEqual(v(-1), ["2026-10-21", "2026-10-28"]);
  assert.deepEqual(v(2), ["2026-11-11", "2026-11-18"]);
  assert.deepEqual(v(-1, "1m"), ["2026-09-28", "2026-10-28"]);
  assert.ok(ventanaGantt(escala, "1s", "2026-10-28", -1).semanas.length >= 1, "también rotula semanas de antes de la escala");
});

test("📅 Gantt — barra para moverse: Hoy, ◀ ▶ y el deslizador", () => {
  lunes26();
  try {
    const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo", fecha_objetivo: "2026-10-31" }];
    render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={PLAN_VIVO} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
    const nav = screen.getByRole("group", { name: "Moverse en el Gantt" });
    assert.ok(within(nav).getByRole("button", { name: "Hoy" }));
    fireEvent.click(screen.getByRole("button", { name: "1 semana" }));
    assert.match(nav.textContent, /Desde hoy/);
    fireEvent.click(within(nav).getByRole("button", { name: "Ver antes" }));
    assert.match(nav.textContent, /Del 19\/10\/2026 al 25\/10\/2026/);
    fireEvent.click(within(nav).getByRole("button", { name: "Hoy" }));
    assert.match(nav.textContent, /Desde hoy/);
  } finally {
    mock.timers.reset();
  }
});

// Armado con varios armadores (Tadeo, 27/10): hasta el máximo por OT; los que
// sobran arman otra OT en paralelo, y los de una máquina sin trabajo se suman.
test("procesosPlan — armado en paralelo, todos a una OT o con los de las máquinas que se liberan", async () => {
  const { procesosPlan } = await import("../app/lib/ganttPlan.js");
  const lun = "2026-10-26";
  const items = [
    { ot: "A", etapa: "armado", fecha: lun, horas: 32, orden: 0 },
    { ot: "B", etapa: "armado", fecha: lun, horas: 32, orden: 1 },
  ];
  const armado = (r, ot) => r.get(ot).procesos.map((p) => [p.personas, p.desde, p.hasta, p.horas]);
  // 6 armadores y hasta 4 por OT: A con 4 (32 h de gente = 8 h, el lunes) y B en paralelo con 2 (lunes y martes)
  const par = procesosPlan(items, { hoy: "2026-10-20", personal: { armadores: 6, maxPorOt: 4, ayudantes: {} } });
  assert.deepEqual(armado(par, "A"), [[4, lun, lun, 8]]);
  assert.deepEqual(armado(par, "B"), [[2, lun, "2026-10-27", 16]]);
  // 4 armadores: van todos a A y después todos a B
  const juntos = procesosPlan(items, { hoy: "2026-10-20", personal: { armadores: 4, maxPorOt: 4, ayudantes: {} } });
  assert.deepEqual(armado(juntos, "A"), [[4, lun, lun, 8]]);
  assert.deepEqual(armado(juntos, "B"), [[4, "2026-10-27", "2026-10-27", 8]]);
  // El máximo por OT se respeta aunque haya más gente
  const tope = procesosPlan(items, { hoy: "2026-10-20", personal: { armadores: 10, maxPorOt: 2, ayudantes: {} } });
  assert.deepEqual([armado(tope, "A")[0][0], armado(tope, "B")[0][0]], [2, 2]);
  // 1 armador; el de la seccionadora se suma cuando termina de cortar (lunes): el martes arman 2
  const ayuda = procesosPlan([
    { ot: "A", etapa: "corte", fecha: lun, horas: 8, orden: 0 },
    { ot: "A", etapa: "armado", fecha: lun, horas: 8, orden: 0 },
  ], { hoy: "2026-10-20", personal: { armadores: 1, maxPorOt: 4, ayudantes: { corte: 1 } } });
  assert.deepEqual(ayuda.get("A").procesos.map((p) => [p.etapa, p.personas, p.desde, p.horas]), [["corte", null, lun, 8], ["armado", 2, "2026-10-27", 4]]);
  // Sin datos del personal, una sola línea de armado como antes
  const solo = procesosPlan(items, { hoy: "2026-10-20" });
  assert.deepEqual(armado(solo, "B").map((x) => x[0]), [null]);
  assert.equal(solo.get("B").procesos[0].desde, "2026-10-30", "B espera que A termine el jueves");
});

test("personalGantt — armadores y ayudantes según el puesto de cada operario", async () => {
  const { personalGantt } = await import("../app/lib/ganttPlan.js");
  const op = (id, puesto_planta, extra = {}) => ({ id, rol: "operativo", division: "M", puesto_planta, ...extra });
  assert.equal(personalGantt([], DIV_M, null), null, "sin operarios no cambia nada");
  // Nadie con puesto: las máquinas se llevan 1 + 2 + 2 y arman los que sobran
  const sinPuesto = personalGantt([1, 2, 3, 4, 5, 6, 7].map((i) => op(i, null)), DIV_M, null);
  assert.deepEqual(sinPuesto, { armadores: 2, maxPorOt: 4, ayudantes: { corte: 1, canteado: 2, mecanizado: 2 } });
  // Con puesto: los de Otra línea (Puertas) e instaladores no cuentan
  const conPuesto = personalGantt([
    op(1, "corte"), op(2, "canteado"), op(3, "canteado"), op(4, "mecanizado"), op(5, "armado"), op(6, "armado"),
    op(7, "otra_linea"), op(8, "armado", { es_instalador: true }),
  ], DIV_M, { max_armadores_ot: 3 });
  assert.deepEqual(conPuesto, { armadores: 2, maxPorOt: 3, ayudantes: { corte: 1, canteado: 2, mecanizado: 1 } });
});

test("📅 Gantt — al lado de la barra de Armado van cuántos arman", () => {
  const diagrama = { lun: { in: "07:00", out: "15:00" }, mar: { in: "07:00", out: "15:00" }, mie: { in: "07:00", out: "15:00" }, jue: { in: "07:00", out: "15:00" }, vie: { in: "07:00", out: "15:00" } };
  const empleados = [1, 2, 3].map((id) => ({ id, rol: "operativo", division: "M", diagrama, puesto_planta: "armado" }));
  const planes = [{ id: 1, tipo: "semana", desde: dia(-5), hasta: dia(30), items: [{ ot: "7100", etapa: "armado", fecha: dia(10), horas: 12 }] }];
  const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" }];
  const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={planes} empleados={empleados}
    avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  const textos = [...container.querySelectorAll("svg text")].map((t) => t.textContent);
  assert.ok(textos.includes("4 h · 👷 3"), textos.join(" | "));
  assert.ok(screen.getByRole("button", { name: /Armado 4 h con 3 armadores, del / }));
});

test("📅 Gantt — a la izquierda, además de la OT y el cliente, el nombre del proyecto", async () => {
  const { nombreProyecto } = await import("../app/lib/gantt.js");
  assert.equal(nombreProyecto({ proyecto: "7751-01", descripcion: "Cocina", cliente: "BCG" }), "Cocina");
  assert.equal(nombreProyecto({ proyecto: "7751-01", descripcion: "", cliente: "BCG" }), "", "el código de la columna C no se muestra");
  assert.equal(nombreProyecto({ descripcion: "bcg", cliente: "BCG" }), "", "no repite el cliente");
  const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", obra: "Torre Norte", proyecto: "7100-02", descripcion: "Cama", division: "M", estado: "activo" }];
  const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={PLANES} cfgValor={null}
    avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} onVerDetalle={() => {}} />);
  const fila = container.querySelector('[data-ot="7100"]');
  assert.equal(fila.querySelector("[data-proyecto]").textContent, "Cama");
  assert.equal(fila.querySelector("[data-cliente]").textContent, "BCG");
  assert.equal(fila.querySelector("[data-obra]").textContent, "Torre Norte");
  assert.doesNotMatch(fila.textContent, /7100-02/);
});

test("📅 Gantt — OT por proceso: un bloque por proceso, las OT una debajo de otra en el orden en que pasan", () => {
  const planes = [{
    id: 1, tipo: "semana", desde: dia(-20), hasta: dia(20), items: [
      { ot: "7200", etapa: "corte", fecha: dia(3), horas: 8, orden: 1 },
      { ot: "7100", etapa: "corte", fecha: dia(1), horas: 8, orden: 0 },
      { ot: "7100", etapa: "armado", fecha: dia(6), horas: 6, orden: 0 },
    ],
  }];
  const proyectos = [
    { id: 1, ot: "7100", cliente: "BCG", obra: "Torre", descripcion: "Cocina", division: "M", estado: "activo" },
    { id: 2, ot: "7200", cliente: "Ana", descripcion: "Vanitory", division: "M", estado: "activo" },
  ];
  const vistos = [];
  const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={planes}
    avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} onVerDetalle={(p) => vistos.push(p.ot)} />);
  assert.equal(screen.getByRole("button", { name: "Procesos por OT" }).getAttribute("aria-pressed"), "true", "arranca como estaba");
  fireEvent.click(screen.getByRole("button", { name: "OT por proceso" }));
  assert.deepEqual([...container.querySelectorAll("[data-bloque]")].map((b) => b.getAttribute("data-bloque")), ["corte", "armado"], "solo los procesos con trabajo");
  const corte = screen.getByRole("region", { name: "Corte: 2 OT" });
  assert.deepEqual([...corte.querySelectorAll("[data-ot]")].map((f) => f.getAttribute("data-ot")), ["7100", "7200"], "primero la que pasa antes");
  assert.equal(corte.querySelectorAll('[data-proceso="corte"]').length, 2);
  assert.match(corte.querySelector('[data-ot="7100"]').textContent, /7100 · BCGTorre · Cocina/);
  const armado = screen.getByRole("region", { name: "Armado: 1 OT" });
  assert.equal(armado.querySelectorAll("[data-ot]").length, 1);
  fireEvent.click(within(corte).getByRole("button", { name: /^OT 7200, Corte: 8 h/ }));
  assert.deepEqual(vistos, ["7200"]);
  assert.equal(localStorage.getItem("gypi_gantt_forma"), "ots", "la elección queda guardada");
  cleanup();
  render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={planes} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  assert.equal(screen.getByRole("button", { name: "OT por proceso" }).getAttribute("aria-pressed"), "true");
  fireEvent.click(screen.getByRole("button", { name: "Procesos por OT" }));
  assert.equal(document.querySelectorAll("[data-bloque]").length, 0);
});

// 29/10 (Tadeo): ver 1, 2 o 3 días, 1 o 2 semanas o 1 mes desde hoy, o todo
test("📅 Gantt — elegir ver 1, 2 o 3 días, 1 o 2 semanas o 1 mes desde hoy, o todo el plan", () => {
  const escala = { desde: "2026-10-18", semanas: [["2026-10-18", 43], ["2026-10-25", 44], ["2026-11-01", 45]].map(([inicio, numero]) => ({ inicio, numero, actual: inicio === "2026-10-25" })) };
  const hoy = "2026-10-29";
  const un = ventanaGantt(escala, "1d", hoy);
  assert.deepEqual([un.desde, un.hasta, un.dias], [hoy, "2026-10-30", 1]);
  assert.deepEqual(un.semanas.map((s) => [s.numero, s.desde, s.hasta]), [[44, hoy, "2026-10-30"]]);
  assert.equal(ventanaGantt(escala, "3d", hoy).dias, 3);
  const sem = ventanaGantt(escala, "1s", hoy);
  assert.deepEqual(sem.semanas.map((s) => [s.numero, s.desde, s.hasta]), [[44, hoy, "2026-11-01"], [45, "2026-11-01", "2026-11-05"]], "de hoy a 7 días, partido en sus semanas");
  assert.equal(ventanaGantt(escala, "2s", hoy).dias, 14);
  const mes = ventanaGantt(escala, "1m", hoy);
  assert.deepEqual([mes.hasta, mes.dias], ["2026-11-29", 31]);
  assert.deepEqual(mes.semanas.map((s) => s.numero), [44, 45, 46, 47, 48], "las semanas que la escala no trae se siguen contando");
  assert.equal(ventanaGantt(escala, "1m", "2027-01-31").hasta, "2027-02-28", "31/1 + 1 mes = fin de febrero");
  const todo = ventanaGantt(escala, "todo", hoy);
  assert.deepEqual([todo.desde, todo.hasta, todo.semanas.length], ["2026-10-18", "2026-11-08", 3], "todo el plan, también la semana anterior");
  const v = ventanaGantt(escala, "1s", hoy);
  assert.ok(enVentana({ desde: "2026-10-27", hasta: "2026-10-29" }, v), "empezó antes y sigue hoy");
  assert.ok(enVentana({ desde: "2026-11-04", hasta: "2026-11-09" }, v));
  assert.ok(!enVentana({ desde: "2026-11-05", hasta: "2026-11-09" }, v), "después de los 7 días no");
  assert.ok(!enVentana({ desde: "2026-10-19", hasta: "2026-10-28" }, v), "lo que terminó ayer no");

  const planes = [{
    id: 1, tipo: "semana", desde: dia(-20), hasta: dia(40), items: [
      // Plan vivo: la 7200 va detrás de la 7100 (120 h de Corte, unas 3 semanas)
      { ot: "7100", etapa: "corte", fecha: dia(1), horas: 120, orden: 0 },
      { ot: "7200", etapa: "corte", fecha: dia(25), horas: 8, orden: 1 },
    ],
  }];
  const proyectos = [
    { id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" },
    { id: 2, ot: "7200", cliente: "Ana", division: "M", estado: "activo" },
  ];
  const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={planes} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
  assert.equal(screen.getByRole("button", { name: "Todo" }).getAttribute("aria-pressed"), "true", "arranca con todo el plan");
  assert.ok(container.querySelector('[data-ot="7200"]'));
  assert.deepEqual(within(screen.getByRole("group", { name: "Qué se ve" })).getAllByRole("button").map((b) => b.textContent),
    ["1 día", "2 días", "3 días", "1 semana", "2 semanas", "1 mes", "Todo"]);
  fireEvent.click(screen.getByRole("button", { name: "2 semanas" }));
  assert.ok(container.querySelector('[data-ot="7100"]'), "la de esta semana se ve");
  assert.ok(!container.querySelector('[data-ot="7200"]'), "la de dentro de 3 semanas no");
  fireEvent.click(screen.getByRole("button", { name: "OT por proceso" }));
  assert.equal(screen.getByRole("region", { name: "Corte: 1 OT" }).querySelectorAll("[data-ot]").length, 1);
  assert.equal(localStorage.getItem("gypi_gantt_horizonte"), "2s", "queda guardado");
  fireEvent.click(screen.getByRole("button", { name: "Todo" }));
  assert.ok(screen.getByRole("region", { name: "Corte: 2 OT" }));
});

test("📅 Gantt — con 1 semana o 1 día elegido, eso llena el ancho visible", () => {
  const original = globalThis.ResizeObserver;
  const ancho = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() { this.cb([]); } disconnect() {} };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
  try {
    localStorage.setItem("gypi_gantt_horizonte", "1s");
    const proyectos = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo" }];
    const { container } = render(<GanttOt proyectos={proyectos} divisiones={DIV_M} etapas={ETAPAS_M} planes={PLANES} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} />);
    // 1000 px − 260 de las columnas fijas − 56 para las horas − 2 de bordes = 682 px para 7 días
    const svg = () => container.querySelector(".sticky.top-0 svg");
    assert.ok(Math.abs(Number(svg().getAttribute("width")) - (682 + 56)) < 0.001);
    fireEvent.click(screen.getByRole("button", { name: "1 día" }));
    assert.ok(Math.abs(Number(svg().getAttribute("width")) - (682 + 56)) < 0.001, "1 día también llena el ancho");
    assert.match(svg().textContent, /(Dom|Lun|Mar|Mié|Jue|Vie|Sáb) \d+\/\d+/, "con lugar, el nombre del día y la fecha");
  } finally {
    globalThis.ResizeObserver = original;
    if (ancho) Object.defineProperty(HTMLElement.prototype, "clientWidth", ancho);
  }
});
