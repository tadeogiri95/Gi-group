// tests/fin-proceso.test.jsx — Avisos de fin de proceso (Tadeo, 01/11;
// migración 149): cuando llega la hora en que el plan dice que termina un
// proceso de hoy y no está terminado, aviso al celular (cron cada 15 minutos
// desde Supabase, sin repetir) y en el Gantt.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFetchMock } from "./helpers/mockFetch.js";
import { finesVencidos, minutosArg, textoAvisoFin } from "../app/lib/finProceso.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.CRON_SECRET = "test-cron-secret";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

const { revisarFinProcesos } = await import("../app/lib/finProcesoServidor.js");
const cron = await import("../app/api/cron/fin-proceso/route.js");
const E = "11111111-1111-1111-1111-111111111111";
const sinRed = global.fetch;
afterEach(() => { global.fetch = sinRed; });

const LV = [null, { ini: 480, fin: 960 }, { ini: 480, fin: 960 }, { ini: 480, fin: 960 }, { ini: 480, fin: 960 }, { ini: 480, fin: 960 }, null];

test("finesVencidos — solo lo de hoy, sin terminar y con la hora de fin ya pasada", () => {
  const vivo = new Map([
    ["7100", { ot: "7100", procesos: [
      { etapa: "corte", nombre: "Corte", hasta: "2026-11-02", fin: 0.25, pendiente: 0.5, completo: false },
      { etapa: "canteado", nombre: "Canteado", hasta: "2026-11-02", fin: 0.75, pendiente: 1, completo: false },
    ] }],
    ["7200", { ot: "7200", procesos: [
      { etapa: "corte", nombre: "Corte", hasta: "2026-11-02", fin: 0.1, pendiente: 0, completo: true },
      { etapa: "armado", nombre: "Armado", hasta: "2026-11-03", fin: 0.1, pendiente: 1, completo: false },
    ] }],
  ]);
  // Lunes a las 11:30: el Corte de la 7100 terminaba a las 10:00 (8 + 2 h); el Canteado, a las 14:00
  const r = finesVencidos(vivo, { hoy: "2026-11-02", ahoraMin: 11 * 60 + 30, ventanas: LV });
  assert.deepEqual(r.map((x) => [x.ot, x.etapa, x.hora]), [["7100", "corte", "10:00"]]);
  assert.equal(r[0].clave, "7100|corte|2026-11-02|600");
  assert.equal(minutosArg(new Date("2026-11-02T14:30:00Z")), 11 * 60 + 30, "hora de Argentina");
  assert.match(textoAvisoFin(r), /OT 7100 · Corte tenía que terminar a las 10:00\. ¿Está terminado o necesita más tiempo\?/);
});

function mockEmpresa({ avisados, posteados, tokens }) {
  const hoy = "2026-11-02";
  const tablas = {
    proyectos: [{ id: 1, ot: "7100", division: "M", estado: "activo" }],
    etapas: [{ codigo: 1, nombre: "Corte" }, { codigo: 2, nombre: "Canteado" }, { codigo: 3, nombre: "Mecanizado" }, { codigo: 4, nombre: "Armado" }],
    divisiones: [{ id: "M", label: "Muebles", ruta_etapas: [1, 2, 3, 4] }],
    planes_produccion: [{ id: 1, tipo: "semana", desde: hoy, hasta: "2026-11-30", division_id: null, dias_extra: [], confirmado_at: "2026-11-01T10:00:00Z" }],
    plan_produccion_items: [{ plan_id: 1, ot: "7100", etapa: "corte", fecha: hoy, horas: 2, orden: 0 }],
  };
  return createFetchMock([
    { match: (u, o) => u.includes("/avisos_fin_proceso") && o.method === "POST", respond: (u, o) => { posteados.push(...JSON.parse(o.body)); return { status: 201, body: [] }; } },
    { match: (u) => u.includes("/avisos_fin_proceso"), respond: () => ({ body: avisados.map((clave) => ({ clave })) }) },
    { match: (u) => u.includes("/empleados?") && u.includes("rol=eq.gerencial"), respond: () => ({ body: [{ legajo: 1 }] }) },
    { match: (u) => u.includes("/empleados?") && u.includes("solo_su_division"), respond: () => ({ body: [{ legajo: 5, division: "Muebles" }, { legajo: 6, division: "Herrería" }] }) },
    { match: (u) => u.includes("/push_tokens?"), respond: (u) => ({ body: tokens.filter((t) => decodeURIComponent(u).match(new RegExp(`legajo=in\\.\\([^)]*\\b${t.legajo}\\b`))) }) },
    { match: (u) => u.includes("/rest/v1/"), respond: (u) => {
      const tabla = u.split("/rest/v1/")[1].split("?")[0];
      return { body: tablas[tabla] || [] };
    } },
  ]);
}

test("revisarFinProcesos — avisa a gerencia y al supervisor de la división una sola vez", async () => {
  const posteados = [];
  const enviados = [];
  const messaging = { send: async (m) => { enviados.push(m); } };
  const tokens = [{ legajo: 1, token: "gerente" }, { legajo: 5, token: "supervisor" }, { legajo: 6, token: "otro" }];
  const ahora = new Date("2026-11-02T14:30:00Z"); // lunes 11:30 en Argentina
  global.fetch = mockEmpresa({ avisados: [], posteados, tokens });
  const r = await revisarFinProcesos({ id: E, slug: "acme" }, { ahora, messaging });
  assert.deepEqual([r.vencidos, r.nuevos], [1, 1]);
  assert.deepEqual(posteados.map((p) => p.clave), ["7100|corte|2026-11-02|600"]);
  assert.deepEqual(enviados.map((m) => m.token).sort(), ["gerente", "supervisor"], "el de otra división no");
  assert.match(enviados[0].notification.body, /OT 7100 · Corte tenía que terminar a las 10:00/);
  // A los 15 minutos: ya avisado, no se repite
  enviados.length = 0;
  global.fetch = mockEmpresa({ avisados: ["7100|corte|2026-11-02|600"], posteados, tokens });
  const r2 = await revisarFinProcesos({ id: E, slug: "acme" }, { ahora: new Date("2026-11-02T14:45:00Z"), messaging });
  assert.deepEqual([r2.nuevos, enviados.length], [0, 0]);
  // Antes de las 10 no avisa
  global.fetch = mockEmpresa({ avisados: [], posteados, tokens });
  const r3 = await revisarFinProcesos({ id: E, slug: "acme" }, { ahora: new Date("2026-11-02T12:30:00Z"), messaging });
  assert.equal(r3.vencidos, 0);
});

test("cron/fin-proceso — pide la clave y la migración lo programa cada 15 minutos sin guardar la clave", async () => {
  global.fetch = createFetchMock([]);
  assert.equal((await cron.GET(new Request("http://localhost/api/cron/fin-proceso"))).status, 401);
  const sql = readFileSync(new URL("../supabase/migrations/149_avisos_fin_proceso.sql", import.meta.url), "utf8");
  assert.match(sql, /'\*\/15 \* \* \* \*'/);
  assert.match(sql, /\/api\/cron\/fin-proceso/);
  assert.match(sql, /PEGAR_ACA_EL_CRON_SECRET/, "la clave la pega Tadeo, no va en el repositorio");
});
