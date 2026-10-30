// tests/lead-time-horas.test.jsx — Lead time por proceso y de la OT en horas de
// trabajo, con un decimal (Tadeo, 30/10; app/lib/leadTimeHoras.js).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { horasTrabajo, leadTimeProcesos, leadTimeDelPeriodo, ventanasDeGrilla, VENTANAS_POR_DEFECTO } from "../app/lib/leadTimeHoras.js";
import { calcularInforme } from "../app/lib/informeProduccion.js";
import { puntosClave } from "../app/lib/informePdf.js";
import { htmlInformeProduccion } from "../app/lib/email.js";

afterEach(() => cleanup());

const { default: LeadTimeTab } = await import("../app/components/LeadTimeTab.jsx");
const { VistaInforme } = await import("../app/components/InformeProduccionTab.jsx");

// Lunes 26/10/2026 a las 10 de Argentina = 13 UTC
const arg = (dia, hora) => new Date(Date.parse(`2026-${dia}T${hora}:00-03:00`)).toISOString();

test("horasTrabajo — solo las horas de la planta, con un decimal", () => {
  // Sin grilla: lunes a viernes de 8 a 16
  assert.equal(horasTrabajo(arg("10-26", "10:00"), arg("10-27", "12:00")), 10, "6 h el lunes + 4 h el martes");
  assert.equal(horasTrabajo(arg("10-30", "15:00"), arg("11-02", "09:00")), 2, "el fin de semana no cuenta");
  assert.equal(horasTrabajo(arg("10-26", "10:00"), arg("10-26", "10:20")), 0.3);
  assert.equal(horasTrabajo(arg("10-26", "18:00"), arg("10-27", "07:00")), 0, "de noche no cuenta");
  assert.equal(horasTrabajo(arg("10-27", "10:00"), arg("10-26", "10:00")), null);
  assert.equal(horasTrabajo(null, arg("10-26", "10:00")), null);
  // Con la grilla: lunes de 7 a 17 y sábado de 8 a 12
  const vs = [null, { ini: 7 * 60, fin: 17 * 60 }, null, null, null, null, { ini: 8 * 60, fin: 12 * 60 }];
  assert.equal(horasTrabajo(arg("10-24", "00:00"), arg("10-27", "00:00"), vs), 14);
});

test("ventanasDeGrilla — desde que entra el primero hasta que sale el último de cada día", () => {
  const empleados = [
    { rol: "operativo", activo: true, diagrama: { lun: { in: "07:00", out: "15:00" }, sab: { in: "08:00", out: "12:00" } } },
    { rol: "operativo", activo: true, diagrama: { lun: { in: "09:00", out: "17:30" } } },
    { rol: "gerencial", activo: true, diagrama: { mar: { in: "06:00", out: "20:00" } } },
  ];
  const vs = ventanasDeGrilla(empleados, [], null);
  assert.deepEqual(vs[1], { ini: 420, fin: 1050 });
  assert.deepEqual(vs[6], { ini: 480, fin: 720 });
  assert.equal(vs[2], null, "gerencia no cuenta");
  assert.deepEqual(ventanasDeGrilla([], [], null), VENTANAS_POR_DEFECTO);
});

const ETAPAS_CODIGO = { corte: 1, canteado: 2, mecanizado: 3, armado: 4 };
const DATOS = {
  etapasCodigo: ETAPAS_CODIGO,
  // 7100: Corte escaneado; Canteado a mano; Armado firmado como terminado
  piezas: [
    { ot: "7100", etapa: 1, total: 10, pasaron: 10, primer_paso: arg("10-26", "10:00"), ultimo_paso: arg("10-26", "14:30") },
    { ot: "7200", etapa: 1, total: 10, pasaron: 4, primer_paso: arg("10-27", "08:00"), ultimo_paso: arg("10-27", "09:00") },
  ],
  manual: [
    { ot: "7100", etapa: 2, pct: 30, created_at: arg("10-27", "08:00") },
    { ot: "7100", etapa: 2, pct: 100, created_at: arg("10-27", "12:00") },
    { ot: "7100", etapa: 4, pct: 50, created_at: arg("10-27", "13:00") },
  ],
  avance: [{ ot: "7100", etapa: 4, estado: "terminada", terminada_at: arg("10-28", "11:00") }],
  // 7300: sin historial (antes de la 146), con el checkeo manual de la OT
  proyectos: [{ ot: "7300", avance_manual: { activo: true, at: arg("10-26", "09:00"), etapas: { 1: 100 } } }],
};

test("leadTimeProcesos — inicio con el primer escaneo o checkeo manual; fin al 100 %; la OT termina con Armado", () => {
  const lt = leadTimeProcesos({ ...DATOS, ahora: new Date(arg("10-28", "16:00")) });
  const a = lt.get("7100");
  assert.deepEqual(a.procesos.map((q) => [q.nombre, q.horas]), [["Corte", 4.5], ["Canteado", 4], ["Armado", 6]]);
  assert.equal(a.inicio, arg("10-26", "10:00"));
  assert.equal(a.horas, 17, "del primer escaneo de Corte a Armado firmado: 6 + 8 + 3");
  const b = lt.get("7200");
  assert.equal(b.horas, null, "no terminó");
  assert.equal(b.procesos[0].lleva, 16, "lleva desde el primer escaneo hasta ahora");
  assert.equal(lt.get("7300").procesos[0].horas, 0, "cargado al 100 % de una: arranca y termina juntos");
});

test("leadTimeDelPeriodo — lo que terminó en el período, con promedios por proceso y de la OT", () => {
  const lt = leadTimeProcesos(DATOS);
  const r = leadTimeDelPeriodo(lt, { desde: "2026-10-28", hasta: "2026-10-28" }, new Map([["7100", { cliente: "BCG" }]]));
  assert.deepEqual(r.ots.map((o) => [o.ot, o.cliente, o.horas, o.procesos.map((q) => q.nombre)]), [["7100", "BCG", 17, ["Armado"]]]);
  assert.deepEqual(r.promedios.map((x) => [x.nombre, x.promedio]), [["Armado", 6], ["OT completa", 17]]);
  const sem = leadTimeDelPeriodo(lt, { desde: "2026-10-26", hasta: "2026-11-01" });
  assert.deepEqual(sem.promedios.map((x) => [x.nombre, x.cantidad, x.promedio]), [["Corte", 2, 2.3], ["Canteado", 1, 4], ["Armado", 1, 6], ["OT completa", 1, 17]]);
});

test("informe — el lead time sale en la pantalla, el PDF y el email", () => {
  const r = calcularInforme({
    periodo: { tipo: "dia", desde: "2026-10-28", hasta: "2026-10-28" }, etapasCodigo: ETAPAS_CODIGO,
    avance: DATOS.avance, leadTime: leadTimeProcesos(DATOS),
  });
  assert.equal(r.leadTime.ots[0].horas, 17);
  assert.ok(puntosClave(r).some((p) => /⏱ Lead time en horas de trabajo: Armado 6 h\. OT terminadas: OT 7100 en 17 h\./.test(p.texto)), puntosClave(r).map((p) => p.texto).join(" | "));
  assert.match(htmlInformeProduccion({ empresa: "GI", slug: "gi", informe: r, explicacion: "" }), /⏱ Lead time OT completa.*17 h/s);
  render(<VistaInforme informe={r} />);
  const s = screen.getByRole("region", { name: "Lead time" });
  assert.match(s.textContent, /OT 7100 · terminada en 17 h · Armado 6 h/);
  // Un informe guardado antes no tiene lead time
  cleanup();
  render(<VistaInforme informe={{ ...r, leadTime: undefined }} />);
  assert.ok(!screen.queryByRole("region", { name: "Lead time" }));
});

test("Reportes → Lead time — por proceso en horas de trabajo", async () => {
  const datos = {
    proyectos: [{ ot: "7100", cliente: "BCG", division: "M", created_at: arg("10-20", "10:00") }],
    v_avance_piezas: DATOS.piezas.slice(0, 1),
    avance_etapas: DATOS.avance,
    avance_manual_historial: DATOS.manual,
    etapas: [{ codigo: 1, nombre: "Corte" }, { codigo: 2, nombre: "Canteado" }, { codigo: 3, nombre: "Mecanizado CNC" }, { codigo: 4, nombre: "Armado" }],
  };
  global.fetch = async (url, opts) => {
    const { path } = JSON.parse(opts.body);
    const filas = datos[path.split("?")[0]] || [];
    return new Response(JSON.stringify({ data: path.includes("offset=0") ? filas : [] }), { status: 200 });
  };
  render(<LeadTimeTab fechaDesde="2026-10-01" fechaHasta="2026-10-31" labelPeriodo="octubre" empresaId="e1" divisiones={[{ id: "M", label: "Muebles", ruta_etapas: [1, 2, 3, 4] }]} />);
  const s = await screen.findByRole("region", { name: "Lead time por proceso" });
  assert.match(s.textContent, /OT 7100 · BCG · terminada en 17 h/);
  assert.match(s.textContent, /Corte 4,5 h · Canteado 4 h · Armado 6 h/);
  assert.ok(screen.getByText("OT completa · promedio de 1 OT"));
});
