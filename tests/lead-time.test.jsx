// tests/lead-time.test.jsx — Seguimiento de OT por escaneo, parte 27: lead
// time de producción, instalación y total, con promedios por división.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { dias, leadTimes, resumenLeadTime } from "../app/lib/leadTime.js";

afterEach(() => cleanup());

const { default: LeadTimeTab } = await import("../app/components/LeadTimeTab.jsx");

const DIVISIONES = [{ id: "muebles", label: "Muebles" }, { id: "cocinas", label: "Cocinas" }];
const PROYECTOS = [
  { ot: "1", cliente: "Ana", division: "muebles", created_at: "2026-10-01T12:00:00Z", liberada_at: "2026-10-03T12:00:00Z" },
  { ot: "2", cliente: "Beto", division: "cocinas", created_at: "2026-10-01T12:00:00Z" },
  { ot: "3", cliente: "Caro", division: "muebles", created_at: "2026-10-01T12:00:00Z", liberada_at: "2026-10-02T12:00:00Z" },
];
const DATOS = {
  proyectos: PROYECTOS,
  avancePiezas: [
    // OT 1: completa, último escaneo el 8
    { ot: "1", etapa: 1, total: 10, pasaron: 10, primer_paso: "2026-10-04T12:00:00Z", ultimo_paso: "2026-10-07T12:00:00Z" },
    { ot: "1", etapa: 2, total: 5, pasaron: 5, primer_paso: "2026-10-05T12:00:00Z", ultimo_paso: "2026-10-08T12:00:00Z" },
    // OT 3: falta una pieza
    { ot: "3", etapa: 1, total: 10, pasaron: 9, primer_paso: "2026-10-03T12:00:00Z", ultimo_paso: "2026-10-09T12:00:00Z" },
  ],
  // OT 2 no tiene piezas: termina con sus etapas cerradas
  avanceEtapas: [
    { ot: "2", etapa: 1, estado: "aprobada", terminada_at: "2026-10-05T12:00:00Z", aprobada_at: "2026-10-06T00:00:00Z" },
    { ot: "2", etapa: 2, estado: "no_aplica" },
  ],
  cargas: [{ ot: "1", firma_carga_at: "2026-10-10T12:00:00Z" }],
  bultos: [{ ot: "2", cargado_at: "2026-10-07T12:00:00Z" }, { ot: "2", cargado_at: "2026-10-07T18:00:00Z" }],
  actas: [{ ot: "1", firmada_at: "2026-10-12T12:00:00Z" }, { ot: "2", firmada_at: "2026-10-09T12:00:00Z" }],
};

test("dias — días corridos con un decimal; null si falta o va para atrás", () => {
  assert.equal(dias("2026-10-01T00:00:00Z", "2026-10-03T12:00:00Z"), 2.5);
  assert.equal(dias(null, "2026-10-03T00:00:00Z"), null);
  assert.equal(dias("2026-10-03T00:00:00Z", "2026-10-01T00:00:00Z"), null);
});

test("leadTimes — producción, instalación y total de cada OT", () => {
  const [o1, o2, o3] = leadTimes(DATOS);
  // OT 1: liberada el 3, última pieza el 8 → 5 días; carga el 10, acta el 12 → 2; alta el 1 → 11
  assert.deepEqual([o1.produccion, o1.instalacion, o1.total], [5, 2, 11]);
  // OT 2: sin liberar ni piezas → sin inicio de producción; carga = primer bulto (7) → acta (9)
  assert.deepEqual([o2.produccion, o2.instalacion, o2.total], [null, 2, 8]);
  assert.equal(o2.finProduccion, "2026-10-06T00:00:00Z", "termina con la última etapa firmada");
  // OT 3: le falta una pieza → producción sin terminar
  assert.equal(o3.produccion, null);
  assert.equal(o3.finProduccion, null);
});

test("leadTimes — sin liberación arranca en el primer escaneo", () => {
  const [o] = leadTimes({ proyectos: [{ ot: "9" }], avancePiezas: [{ ot: "9", etapa: 1, total: 1, pasaron: 1, primer_paso: "2026-10-01T00:00:00Z", ultimo_paso: "2026-10-04T00:00:00Z" }] });
  assert.equal(o.produccion, 3);
});

test("resumenLeadTime — promedios de las OT que terminaron cada tramo en el período, por división", () => {
  const r = resumenLeadTime(leadTimes(DATOS), { desde: "2026-10-01", hasta: "2026-10-31", divisiones: DIVISIONES });
  const tramo = (c) => r.tramos.find((t) => t.clave === c);
  assert.deepEqual([tramo("produccion").cantidad, tramo("produccion").promedio], [1, 5]);
  assert.deepEqual([tramo("instalacion").cantidad, tramo("instalacion").promedio], [2, 2]);
  assert.deepEqual([tramo("total").cantidad, tramo("total").promedio], [2, 9.5]);
  assert.deepEqual(tramo("total").porDivision.map((d) => [d.nombre, d.promedio]), [["Cocinas", 8], ["Muebles", 11]]);
  assert.deepEqual(r.ots.map((o) => o.ot), ["1", "2"], "las más recientes primero; la que no terminó no aparece");
  const fuera = resumenLeadTime(leadTimes(DATOS), { desde: "2026-11-01", hasta: "2026-11-30", divisiones: DIVISIONES });
  assert.equal(fuera.ots.length, 0);
  assert.equal(fuera.tramos[0].promedio, null);
});

test("Reportes → Lead time — muestra promedios y cada OT, y filtra por división", async () => {
  global.fetch = async (url, opts) => {
    const { path } = JSON.parse(opts.body);
    const tabla = path.split("?")[0];
    const datos = { proyectos: PROYECTOS, v_avance_piezas: DATOS.avancePiezas, avance_etapas: DATOS.avanceEtapas, cargas_ot: DATOS.cargas, bultos_ot: DATOS.bultos, actas_ot: DATOS.actas }[tabla] || [];
    return new Response(JSON.stringify({ data: path.includes("offset=0") ? datos : [] }), { status: 200 });
  };
  const { rerender } = render(<LeadTimeTab fechaDesde="2026-10-01" fechaHasta="2026-10-31" labelPeriodo="octubre" empresaId="e1" divisiones={DIVISIONES} />);
  assert.ok(await screen.findByText("Producción · promedio de 1 OT"));
  assert.ok(screen.getByText("Total (alta → acta) · promedio de 2 OT"));
  assert.ok(screen.getByText("9,5 días"));
  assert.ok(screen.getByText(/Cocinas: 8 días \(1\) · Muebles: 11 días \(1\)/));
  assert.ok(screen.getByText("Producción 5 días · Instalación 2 días · Total 11 días"));
  rerender(<LeadTimeTab fechaDesde="2026-10-01" fechaHasta="2026-10-31" labelPeriodo="octubre" empresaId="e1" divisiones={DIVISIONES} division="cocinas" />);
  assert.ok(await screen.findByText("Total (alta → acta) · promedio de 1 OT"));
  assert.equal(screen.queryByText(/OT 1$/), null);
});
