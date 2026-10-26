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

test("📅 Gantt — agrupa por división, muestra los colores y abre el detalle", () => {
  const vistos = [];
  const proyectos = [
    { id: 1, ot: "7100", cliente: "BCG", division: "M", semana_objetivo: 30, fecha_objetivo: "2026-07-25", estado: "activo" },
    { id: 2, ot: "7200", cliente: "Ana", division: "A", semana_objetivo: 60, fecha_objetivo: "2027-02-20", estado: "activo" },
    { id: 3, ot: "7300", cliente: "Sin semana", division: "M", semana_objetivo: null, fecha_objetivo: null, estado: "activo" },
  ];
  render(<GanttOt proyectos={proyectos} divisiones={[{ id: "M", label: "Muebles" }, { id: "A", label: "Aluminio" }]} etapas={[]} avanceHoras={{ avance: [], horas: new Set(), piezas: [] }} onVerDetalle={(p) => vistos.push(p.ot)} />);
  assert.ok(screen.getByText(/Atrasadas 1/));
  assert.ok(screen.getByText(/A tiempo 1/));
  assert.ok(screen.getByText("Muebles · 1"));
  assert.ok(screen.getByText("Aluminio · 1"));
  assert.equal(screen.queryByText("7300"), null, "sin semana no aparece");
  fireEvent.click(screen.getByRole("button", { name: /OT 7100, S30 \(25\/7\), atrasada/ }));
  assert.deepEqual(vistos, ["7100"]);
});

test("📅 Gantt — sin la migración 135 avisa qué falta", () => {
  render(<GanttOt proyectos={[{ id: 1, ot: "7100", estado: "activo" }]} avanceHoras={null} />);
  assert.ok(screen.getByText(/falta correr la migración 135/));
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
