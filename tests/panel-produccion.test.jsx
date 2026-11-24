// tests/panel-produccion.test.jsx — Panel de control de la producción en
// Producción → 📈 Panel de producción (Tadeo, 23/11; app/lib/panelProduccion.js):
// entregas a tiempo, plan y carga, velocidad, calidad, máquinas y gente, con
// semáforo y la semana contra las 4 anteriores.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup } from "@testing-library/react";
import {
  semanasPanel, semaforo, METAS, semaforoCarga, finProduccionDe, entregasDeSemana, produccionDeSemana, cargaDeSemana,
  calidadDeSemana, maquinasDeSemana, enProceso, atrasadasPlan, pausadasAhora, armarPanel, itemsDelHistorial,
} from "../app/lib/panelProduccion.js";
import { opcionesBoton } from "../app/lib/menuGestion.js";

afterEach(() => cleanup());

const { default: PanelProduccion } = await import("../app/components/PanelProduccion.jsx");

const arg = (dia, hora = "10:00") => new Date(Date.parse(`2026-${dia}T${hora}:00-03:00`)).toISOString();
const SEMANA = { desde: "2026-11-16", hasta: "2026-11-22" };

test("semanasPanel — la semana de la fecha (lunes a domingo) y las 4 anteriores, la más vieja primero", () => {
  const s = semanasPanel("2026-11-19");
  assert.equal(s.length, 5);
  assert.deepEqual(s[4], SEMANA);
  assert.deepEqual(s[0], { desde: "2026-10-19", hasta: "2026-10-25" });
});

test("semaforo — más alto es mejor, salvo las metas de 'menor'", () => {
  assert.equal(semaforo(95, METAS.entregas), "bien");
  assert.equal(semaforo(80, METAS.entregas), "atencion");
  assert.equal(semaforo(60, METAS.entregas), "mal");
  const menor = { bien: 3, atencion: 6, menor: true };
  assert.equal(semaforo(2, menor), "bien");
  assert.equal(semaforo(5, menor), "atencion");
  assert.equal(semaforo(9, menor), "mal");
  assert.equal(METAS.ausentismo, undefined, "sin ausentismo: la asistencia no la lleva Gypi");
  assert.equal(METAS.tarde, undefined);
  assert.equal(semaforo(null, METAS.entregas), null);
  assert.equal(semaforoCarga(85), "bien");
  assert.equal(semaforoCarga(110), "atencion");
  assert.equal(semaforoCarga(30), "mal");
});

const tarjeta = (ot, { fin = null, procesos = [], horas = null, produccion = null, objetivo = null } = {}) => ({
  ot, fin, procesos, horas, produccion, proyecto: { ot, cliente: `Cliente ${ot}`, fecha_objetivo: objetivo },
});

test("entregas — a tiempo contra la fecha objetivo; las que no tienen fecha no entran en el %", () => {
  const porOt = new Map([
    ["1", tarjeta("1", { fin: arg("11-18"), objetivo: "2026-11-21", horas: 40 })],
    ["2", tarjeta("2", { fin: arg("11-20"), objetivo: "2026-11-17", horas: 60 })],
    ["3", tarjeta("3", { fin: arg("11-19"), horas: 50 })],
    ["4", tarjeta("4", { fin: arg("11-10"), objetivo: "2026-11-21" })], // otra semana
  ]);
  const e = entregasDeSemana(porOt, SEMANA);
  assert.equal(e.entregadas, 3);
  assert.equal(e.conFecha, 2);
  assert.equal(e.aTiempo, 1);
  assert.equal(e.pct, 50);
  assert.equal(e.sinFecha, 1);
  assert.deepEqual(e.tarde.map((f) => [f.ot, f.diasTarde]), [["2", 3]]);
  assert.equal(e.leadTime, 50);
});

test("producción — OT con todos los procesos al 100 % en la semana, piezas escaneadas y $", () => {
  const p = (fin) => ({ etapa: "corte", fin });
  const porOt = new Map([
    ["1", tarjeta("1", { procesos: [p(arg("11-16")), p(arg("11-18"))], produccion: 20 })],
    ["2", tarjeta("2", { procesos: [p(arg("11-17")), p(null)] })],
    ["3", tarjeta("3", { procesos: [p(arg("11-02"))], produccion: 10 })],
  ]);
  assert.equal(finProduccionDe(porOt.get("1")), arg("11-18"));
  assert.equal(finProduccionDe(porOt.get("2")), null);
  const pasos = [{ created_at: arg("11-16") }, { created_at: arg("11-22", "20:00") }, { created_at: arg("11-23", "08:00") }];
  const r = produccionDeSemana(porOt, pasos, SEMANA, new Map([["1", 1000], ["3", 500]]));
  assert.deepEqual(r.otsLista, ["1"]);
  assert.equal(r.piezas, 2, "el domingo a la noche cuenta; el lunes siguiente no");
  assert.equal(r.valor, 1000);
  assert.equal(r.leadTime, 20);
  assert.equal(produccionDeSemana(porOt, [], SEMANA, null).valor, null, "sin permiso no hay $");
});

test("carga — horas del plan de la semana por proceso contra la grilla", () => {
  const items = [
    { etapa: "corte", fecha: "2026-11-16", horas: 10 }, { etapa: "armado", fecha: "2026-11-20", horas: 30 },
    { etapa: "armado", fecha: "2026-11-24", horas: 99 },
  ];
  const c = cargaDeSemana(items, SEMANA, 80);
  assert.equal(c.horas, 40);
  assert.equal(c.pct, 50);
  assert.equal(c.porEtapa.find((q) => q.etapa === "armado").horas, 30);
  assert.equal(cargaDeSemana(items, SEMANA, 0).pct, null);
});

test("calidad — OT sin retrabajo, horas y motivos, no conformidades y pendientes", () => {
  const retrabajos = [
    { ot: "1", etapa: "armado", horas: 3, motivo: "medida", created_at: arg("11-17") },
    { ot: "1", etapa: "armado", horas: 2, motivo: "medida", created_at: arg("11-18") },
    { ot: "9", etapa: "corte", horas: 4, motivo: "medida", created_at: arg("11-17"), anulado_at: arg("11-17") },
    { ot: "5", etapa: "corte", horas: 1, motivo: "otros", detalle: "viejo", created_at: arg("10-01") },
  ];
  const c = calidadDeSemana({
    s: SEMANA, retrabajos, producidas: ["1", "2", "5", "9"],
    noConformidades: [{ defecto: "MED", cantidad: 2, created_at: arg("11-17") }, { defecto: "MED", cantidad: 1, created_at: arg("11-19") }, { defecto: "GOL", cantidad: 1, created_at: arg("10-01") }],
    defectos: [{ cod: "MED", nombre: "Medida mal" }],
    pendientes: [{ created_at: arg("11-18") }, { created_at: arg("10-18") }],
  });
  assert.equal(c.horasRetrabajo, 5, "el anulado no cuenta");
  assert.equal(c.otsConRetrabajo, 1);
  assert.equal(c.motivos.length, 1);
  assert.equal(c.motivos[0].horas, 5);
  assert.equal(c.sinRetrabajo, 50, "1 y 5 tuvieron retrabajo alguna vez; 2 y 9 no (el de 9 se anuló)");
  assert.equal(c.noConformidades, 3);
  assert.deepEqual(c.defectos[0], { cod: "MED", nombre: "Medida mal", cantidad: 3 });
  assert.equal(c.pendientesNuevos, 1);
});

test("máquinas — horas paradas dentro de la semana y fallas nuevas", () => {
  const maquinas = [{ id: 1, codigo: "CNC1", nombre: "CNC" }, { id: 2, codigo: "SEC", nombre: "Seccionadora" }];
  const fallas = [
    { maquina_id: 1, parada: true, parada_desde: arg("11-15", "20:00"), cerrado_at: arg("11-16", "04:00"), created_at: arg("11-15", "20:00"), estado: "resuelta" },
    { maquina_id: 2, parada: false, created_at: arg("11-19"), estado: "pendiente" },
    { maquina_id: 2, parada: false, created_at: arg("11-19"), estado: "descartada" },
  ];
  const m = maquinasDeSemana({ s: SEMANA, maquinas, fallas, ahora: Date.parse(arg("11-23")) });
  assert.equal(m.horasParada, 4, "de la medianoche del lunes a las 4");
  assert.equal(m.fallas, 1);
  assert.deepEqual(m.porMaquina, [{ codigo: "CNC1", nombre: "CNC", horas: 4 }]);
});

test("en proceso — OT por etapa, esperando y cuello de botella", () => {
  const t = (ot, estado, lleva) => ({ ot, estado, lleva });
  const columnas = [
    { id: "corte", nombre: "Corte", tarjetas: [t("1", "en_curso", 5)] },
    { id: "canteado", nombre: "Canteado", tarjetas: [t("2", "esperando", 10), t("3", "esperando", 6)] },
    { id: "armado", nombre: "Armado", tarjetas: [t("4", "esperando", 30)] },
    { id: "terminadas", nombre: "Terminadas", tarjetas: [t("5", "terminada", 1)] },
  ];
  const r = enProceso(columnas, new Map([["1", 100], ["5", 999]]));
  assert.equal(r.ots, 4);
  assert.equal(r.esperando, 3);
  assert.equal(r.valor, 100, "las terminadas no están en proceso");
  assert.deepEqual(r.cuello, { id: "canteado", nombre: "Canteado", esperando: 2, horasEspera: 16 });
  assert.equal(r.etapas.find((e) => e.id === "canteado").esperaPromedio, 8);
  assert.equal(enProceso([{ id: "corte", nombre: "Corte", tarjetas: [t("1", "en_curso", 1)] }]).cuello, null);
  // Instalación no es producción: aunque tenga más OT esperando, no es el cuello
  const conInstalacion = [...columnas, { id: "instalacion", nombre: "Instalación", tarjetas: [t("6", "esperando", 5), t("7", "esperando", 5), t("8", "esperando", 5)] }];
  assert.equal(enProceso(conInstalacion).cuello.id, "canteado");
  assert.equal(enProceso([{ id: "instalacion", nombre: "Instalación", tarjetas: [t("6", "esperando", 5)] }]).cuello, null);
});

test("atrasadas y pausadas — las del plan vivo que terminan tarde y las OT en pausa hoy", () => {
  const vivo = new Map([
    ["1", { ot: "1", tarde: true, diasTarde: 4, procesos: [{ completo: false }] }],
    ["2", { ot: "2", tarde: false, diasTarde: 0, procesos: [{ completo: false }] }],
    ["3", { ot: "3", tarde: true, diasTarde: 2, procesos: [{ completo: false }] }],
  ]);
  const a = atrasadasPlan(vivo);
  assert.equal(a.cantidad, 2);
  assert.equal(a.abiertas, 3);
  assert.equal(a.diasPromedio, 3);
  assert.deepEqual(a.ots.map((f) => f.ot), ["1", "3"]);
  const p = pausadasAhora([{ ot: "7", motivo: "falta_pago", desde: arg("11-10") }, { ot: "8", motivo: "cliente", desde: arg("11-01"), hasta: arg("11-05") }]);
  assert.equal(p.cantidad, 1);
  assert.deepEqual(p.motivos, [{ motivo: "Falta de pago", cantidad: 1 }]);
});

test("armarPanel — junta todo con el tablero de etapas y el informe de la semana", () => {
  const hecho = (ot, etapa, ini, fin) => ({ ot, etapa, total: 10, pasaron: 10, primer_paso: ini, ultimo_paso: fin });
  const piezas = [
    hecho("100", 1, arg("11-16", "08:00"), arg("11-16", "12:00")), hecho("100", 2, arg("11-17", "08:00"), arg("11-17", "12:00")),
    { ot: "200", etapa: 1, total: 10, pasaron: 5, primer_paso: arg("11-18", "08:00"), ultimo_paso: arg("11-18", "10:00") },
  ];
  const proyectos = [
    { ot: "100", cliente: "Ana", estado: "activo", fecha_objetivo: "2026-11-21" },
    { ot: "200", cliente: "Beto", estado: "activo" },
  ];
  const panel = armarPanel({
    base: { vivo: new Map(), vigentes: [{ ot: "200", etapa: "corte", fecha: "2026-11-18", horas: 8 }], etapasCodigo: { corte: 1, canteado: 2, mecanizado: null, armado: null },
      cfgValor: null, proyectos, divisiones: [], empleados: [], piezas, avance: [], retrabajos: [], pausas: [] },
    pasos: [{ ot: "100", etapa: 1, created_at: arg("11-16") }, { ot: "200", etapa: 1, created_at: arg("11-18") }],
    actas: [{ ot: "100", firmada_at: arg("11-20") }],
    precios: new Map([["100", 5000], ["200", 3000]]),
    fecha: "2026-11-20", hoy: "2026-11-20", ahora: new Date(arg("11-20", "18:00")),
  });
  const s = panel.semanas[4];
  assert.equal(panel.semanas.length, 5);
  assert.equal(s.entregas.entregadas, 1);
  assert.equal(s.entregas.pct, 100);
  assert.equal(s.produccion.ots, 1);
  assert.equal(s.produccion.valor, 5000);
  assert.equal(s.produccion.piezas, 2);
  assert.equal(s.plan.carga.horas, 8);
  assert.equal(panel.ahora.enProceso.ots, 1);
  assert.equal(panel.ahora.enProceso.valor, 3000);
  assert.equal(panel.conPrecios, true);
  assert.equal(panel.maquinasMes, null);
});

test("itemsDelHistorial — cada día sale del plan que valía ese día (Tadeo, 24/11)", () => {
  const viejo = { division_id: "m", confirmado_at: "2026-11-10T12:00:00Z", desde: "2026-11-10", items: [
    { ot: "1", etapa: "corte", fecha: "2026-11-16", horas: 8 }, { ot: "1", etapa: "corte", fecha: "2026-11-17", horas: 8 },
  ] };
  // Confirmado el miércoles: el lunes y el martes siguen siendo del plan viejo
  const nuevo = { division_id: "m", confirmado_at: "2026-11-18T12:00:00Z", desde: "2026-11-18", items: [
    { ot: "2", etapa: "armado", fecha: "2026-11-18", horas: 5 }, { ot: "2", etapa: "armado", fecha: "2026-11-17", horas: 99 },
  ] };
  const items = itemsDelHistorial([viejo, nuevo]);
  assert.deepEqual(items.map((i) => `${i.ot}|${i.fecha}|${i.horas}`).sort(), ["1|2026-11-16|8", "2|2026-11-17|99", "2|2026-11-18|5"]);
  assert.equal(cargaDeSemana(items, SEMANA, null).horas, 112);
  // Otra división no pisa
  assert.equal(itemsDelHistorial([viejo, { ...nuevo, division_id: "p" }]).length, 4);
});

test("armarPanel — la carga usa el plan de cada día, la gente de la división del plan y descuenta vacaciones (24/11)", () => {
  const turno = { in: "08:00", out: "16:00" };
  const diagrama = { lun: turno, mar: turno, mie: turno, jue: turno, vie: turno };
  const divisiones = [{ id: "muebles", label: "Muebles" }, { id: "herreria", label: "Herrería" }];
  const empleados = [
    { id: "a", legajo: 1, rol: "operativo", division: "muebles", diagrama },
    { id: "b", legajo: 2, rol: "operativo", division: "muebles", diagrama },
    { id: "c", legajo: 3, rol: "operativo", division: "herreria", diagrama },
  ];
  const planes = [
    { division_id: "muebles", confirmado_at: "2026-11-10T12:00:00Z", desde: "2026-11-10", items: [{ ot: "1", etapa: "corte", fecha: "2026-11-16", horas: 8 }] },
    { division_id: "muebles", confirmado_at: "2026-11-18T12:00:00Z", desde: "2026-11-18", items: [{ ot: "2", etapa: "armado", fecha: "2026-11-18", horas: 12 }] },
  ];
  const panel = armarPanel({
    base: { vivo: new Map(), vigentes: planes[1].items, planes, etapasCodigo: { corte: 1, canteado: 2, mecanizado: null, armado: null },
      cfgValor: null, proyectos: [], divisiones, empleados, piezas: [], avance: [], retrabajos: [], pausas: [] },
    solicitudes: [{ legajo: 2, tipo: "vacaciones", estado: "aprobado", fecha: "2026-11-19", fecha_hasta: "2026-11-20" }],
    fecha: "2026-11-20", hoy: "2026-11-20", ahora: new Date(arg("11-20", "18:00")),
  });
  const c = panel.semanas[4].plan.carga;
  assert.equal(c.horas, 20, "el lunes del plan viejo + el miércoles del nuevo");
  // 2 operarios de Muebles × 8 h × 5 días = 80, menos 2 días de vacaciones = 64 (el de Herrería no cuenta)
  assert.equal(c.disponibles, 64);
});

test("pantalla — bloques con semáforo y detalle, desde /api/reportes/panel", async () => {
  const semana = (desde, extra = {}) => ({
    desde, hasta: desde, futura: false,
    entregas: { entregadas: 4, conFecha: 4, aTiempo: 3, pct: 75, tarde: [{ ot: "7100", cliente: "Ana", diasTarde: 2, objetivo: "2026-11-18" }], sinFecha: 0, leadTime: 80 },
    plan: { cumplimiento: 92, procesosPlanificados: 10, procesosCumplidos: 9, carga: { horas: 300, disponibles: 400, pct: 75, porEtapa: [{ etapa: "corte", nombre: "Corte", horas: 100 }] } },
    produccion: { ots: 5, piezas: 900, valor: 1000000, otsLista: [], leadTime: 40 },
    calidad: { horasRetrabajo: 6, otsConRetrabajo: 1, motivos: [{ motivo: "Medida", horas: 6 }], producidas: 5, sinRetrabajo: 80, noConformidades: 2, defectos: [{ cod: "MED", nombre: "Medida mal", cantidad: 2 }], pendientesNuevos: 1 },
    maquinas: { horasParada: 2, fallas: 1, porMaquina: [{ codigo: "CNC1", nombre: "CNC", horas: 2 }] },
    ...extra,
  });
  const panel = {
    fecha: "2026-11-20", hoy: "2026-11-20", conPrecios: true,
    semanas: ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"].map((d) => semana(d)),
    ahora: {
      enProceso: { etapas: [{ id: "corte", nombre: "Corte", enCurso: 2, esperando: 0, horasEspera: 0, esperaPromedio: null }, { id: "armado", nombre: "Armado", enCurso: 1, esperando: 3, horasEspera: 30, esperaPromedio: 10 }], ots: 6, esperando: 3, valor: 2000000, cuello: { id: "armado", nombre: "Armado", esperando: 3, horasEspera: 30 } },
      atrasadas: { cantidad: 1, abiertas: 8, diasPromedio: 3, ots: [{ ot: "7200", cliente: "Beto", diasTarde: 3 }] },
      pausadas: { cantidad: 0, ots: [], motivos: [] },
      pendientesAbiertos: 2,
    },
    maquinasMes: { mes: "2026-11", preventivo: 60, tocaban: 10, hechas: 6, arregloHoras: 5, entreFallasDias: 12, maquinas: 3 },
  };
  let pedido = null;
  global.fetch = async (url) => { pedido = String(url); return Response.json({ ok: true, panel }); };
  render(<PanelProduccion />);
  await screen.findByRole("region", { name: "1. Entregas" });
  assert.match(pedido, /\/api\/reportes\/panel\?fecha=\d{4}-\d{2}-\d{2}/);
  const tono = (id) => document.querySelector(`[data-indicador="${id}"]`).dataset.tono;
  assert.equal(tono("entregas"), "atencion");
  assert.equal(tono("cumplimiento"), "bien");
  assert.equal(tono("sin-retrabajo"), "mal");
  assert.equal(document.querySelector('[data-indicador="ausentismo"]'), null, "sin ausentismo");
  assert.equal(document.querySelector('[data-indicador="tarde"]'), null, "sin llegadas tarde");
  assert.equal(tono("preventivo"), "atencion");
  assert.equal(tono("cuello"), "mal");
  assert.match(document.querySelector('[data-indicador="cuello"]').textContent, /Armado/);
  assert.ok(document.querySelector('[data-indicador="valor"]'), "con precios se ve $ producidos");
  assert.ok(screen.getByRole("table", { name: "OT en proceso por etapa" }).textContent.includes("cuello de botella"));
  assert.match(screen.getByRole("region", { name: "Detalle" }).textContent, /7100.*2 días tarde/s);
  for (const b of ["2. Plan y capacidad", "3. Velocidad", "4. Calidad", "5. Máquinas"]) screen.getByRole("region", { name: b });
});

test("pantalla — si no tiene permiso, lo avisa", async () => {
  global.fetch = async () => Response.json({ ok: false, error: "Solo gerencia y administración ven el panel de producción" }, { status: 403 });
  render(<PanelProduccion />);
  const alerta = await screen.findByRole("alert");
  assert.match(alerta.textContent, /Solo gerencia/);
});

test("menú — Producción → 📈 Panel de producción solo para Dueño y supervisores", () => {
  const empresa = { modulos: ["proyectos", "actividad"] };
  assert.ok(opcionesBoton("proyectos", empresa, { rol: "gerencial" }).some((o) => o.id === "panel"));
  assert.ok(opcionesBoton("proyectos", empresa, { rol: "administrativo", solo_su_division: true }).some((o) => o.id === "panel"));
  assert.ok(!opcionesBoton("proyectos", empresa, { rol: "administrativo" }).some((o) => o.id === "panel"));
  const boton = readFileSync(new URL("../app/components/screens/BotonGestionScreen.jsx", import.meta.url), "utf8");
  assert.match(boton, /actual\.id === "panel" && <PanelProduccion \/>/);
});
