// tests/tecnica-panel-informe.test.js — Diseño y Técnica en el Panel y el
// informe de producción: el plan vivo del servidor (cargarPlanVivo, lo usan el
// informe y el cron fin-proceso) también espera el fin de Técnica (parte 49).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFetchMock } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";

const { cargarPlanVivo } = await import("../app/lib/informeProduccionServidor.js");
const { planDeEmpresa, noAntesDeTecnica } = await import("../app/lib/planDisenoTecnica.js");

const E = "11111111-1111-1111-1111-111111111111";
const LUNES = "2026-11-09";
const falta = { e: "falta" };
const ETAPAS = { dis: falta, np: falta, nf: falta, excel: falta, pdf: falta };
const CFG = { min_placa: 10, eficiencia: 100, etapas: { corte: 1 }, diseno_tecnica: { dias_diseno: 2, horas: { global: { B: 9 } }, arquitectas: [{ id: "12", pct_tecnica: 100 }] } };
const PROYECTOS = [
  { id: 1, ot: "A", estado: "activo", placas: 48, etapas_diseno: ETAPAS },
  { id: 2, ot: "B", estado: "activo", placas: 48, etapas_diseno: { ...ETAPAS, dis: { e: "hecho" }, np: { e: "hecho" }, nf: { e: "hecho" }, excel: { e: "hecho", q: "MJT" } } },
];

test("planDeEmpresa y noAntesDeTecnica — solo esperan las que no tienen EXCEL", () => {
  const plan = planDeEmpresa({ proyectos: PROYECTOS, divisiones: [], cfgValor: CFG, personal: [{ id: 12, nombre: "María José Torres" }], hoy: LUNES });
  assert.deepEqual([...noAntesDeTecnica(plan.espera)], [["A", "2026-11-12"]], "Diseño lun-mar, Técnica mié → jueves");
  assert.equal(plan.espera.get("B").excel, true);
  assert.deepEqual([...noAntesDeTecnica(null)], []);
});

test("cargarPlanVivo — el informe y el cron arrancan Producción después de Técnica", async () => {
  global.fetch = createFetchMock([{
    match: (url) => url.includes("/rest/v1/"),
    respond: (url) => {
      const tabla = url.split("/rest/v1/")[1].split("?")[0];
      const offset0 = !/offset=[1-9]/.test(url);
      const datos = {
        proyectos: PROYECTOS,
        config_sistema: [{ valor: CFG }],
        planes_produccion: [{ id: 7, tipo: "semana", desde: "2026-11-02", hasta: "2026-11-30", division_id: null, dias_extra: [], confirmado_at: "2026-11-01T10:00:00Z" }],
        plan_produccion_items: [{ plan_id: 7, ot: "A", etapa: "corte", fecha: LUNES, horas: 8, orden: 0 }, { plan_id: 7, ot: "B", etapa: "corte", fecha: LUNES, horas: 8, orden: 1 }],
        empleados: [{ id: 12, nombre: "María José Torres", rol: "operativo", activo: true }],
      }[tabla] || [];
      return { status: 200, body: offset0 ? datos : [] };
    },
  }]);
  const { vivo } = await cargarPlanVivo(E, { hoy: LUNES });
  assert.equal(vivo.get("A").esperaTecnica, "2026-11-12");
  assert.equal(vivo.get("A").procesos[0].desde, "2026-11-12");
  assert.equal(vivo.get("B").esperaTecnica, null, "EXCEL hecho: no espera");
});

test("Panel — el plan vivo de ⏰ OT atrasadas también espera Técnica", () => {
  const src = readFileSync(new URL("../app/dashboard_gerencia.jsx", import.meta.url), "utf8");
  assert.match(src, /noAntes: noAntesDeTecnica\(planDeEmpresa\(\{ proyectos: proy\.data/);
  assert.match(src, /empleados\?activo=eq\.true&select=id,nombre/);
});
