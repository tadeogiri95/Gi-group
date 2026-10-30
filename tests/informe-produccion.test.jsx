// tests/informe-produccion.test.jsx — Informe de producción del día, la
// semana o el mes, con la nota del 1 al 10 (Tadeo, 29/10; migración 146).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { periodoDe, notaInforme, partesNota, calcularInforme, explicacionNota, textoPushInforme, informeVacio } from "../app/lib/informeProduccion.js";
import { autorizar, prepararBodyPost } from "../app/lib/dataPolicy.js";

const { default: InformeProduccionTab, VistaInforme } = await import("../app/components/InformeProduccionTab.jsx");
const { htmlInformeProduccion } = await import("../app/lib/email.js");

afterEach(() => cleanup());
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); });

test("periodoDe — el día, su semana de lunes a domingo y su mes", () => {
  assert.deepEqual(periodoDe("dia", "2026-10-28"), { tipo: "dia", desde: "2026-10-28", hasta: "2026-10-28" });
  assert.deepEqual(periodoDe("semana", "2026-10-28"), { tipo: "semana", desde: "2026-10-26", hasta: "2026-11-01" });
  assert.deepEqual(periodoDe("semana", "2026-11-01"), { tipo: "semana", desde: "2026-10-26", hasta: "2026-11-01" }, "el domingo es de la misma semana");
  assert.deepEqual(periodoDe("mes", "2026-02-10"), { tipo: "mes", desde: "2026-02-01", hasta: "2026-02-28" });
});

test("nota — parte de 0 y suma hasta 7 por cumplimiento, 2 por OT en su semana y 1 sin corrimiento, de a 0,1", () => {
  assert.equal(notaInforme({ cumplimiento: 100, enSemana: 100, sinCorrimiento: 100 }), 10);
  // 5,6 + 1 + 1 = 7,6
  assert.equal(notaInforme({ cumplimiento: 80, enSemana: 50, sinCorrimiento: 100 }), 7.6);
  // 6 (5,95) + 2 + 0,8 = 8,8
  assert.equal(notaInforme({ cumplimiento: 85, enSemana: 100, sinCorrimiento: 80 }), 8.8);
  assert.deepEqual(partesNota({ cumplimiento: 85, enSemana: 100, sinCorrimiento: 80 }).map((p) => [p.puntos, p.max]), [[6, 7], [2, 2], [0.8, 1]]);
  assert.equal(notaInforme({ cumplimiento: 0, enSemana: 0, sinCorrimiento: 0 }), 1, "nunca menos de 1");
  assert.equal(notaInforme({ cumplimiento: null, enSemana: 100, sinCorrimiento: 100 }), null, "sin nada planificado no hay nota");
});

// Miércoles 28/10: la 7100 tenía planificado medio Corte (escaneo) y la 7200 medio Armado (checkeo manual)
const DATOS = {
  periodo: periodoDe("dia", "2026-10-28"),
  etapasCodigo: { corte: 1, canteado: 2, mecanizado: 3, armado: 4 },
  items: [
    { ot: "7100", etapa: "corte", fecha: "2026-10-28", horas: 8 },
    { ot: "7100", etapa: "corte", fecha: "2026-10-29", horas: 8 },
    { ot: "7200", etapa: "armado", fecha: "2026-10-28", horas: 10 },
    { ot: "7200", etapa: "armado", fecha: "2026-10-30", horas: 10 },
  ],
  piezas: [{ ot: "7100", etapa: 1, total: 10, pasaron: 7 }],
  // 5 piezas el 28 (hora de Argentina) y 2 el 29: al final del 28 iba 50 %
  pasos: [
    ...Array.from({ length: 5 }, () => ({ ot: "7100", etapa: 1, created_at: "2026-10-28T14:00:00Z" })),
    ...Array.from({ length: 2 }, () => ({ ot: "7100", etapa: 1, created_at: "2026-10-29T14:00:00Z" })),
    { ot: "7100", etapa: 1, created_at: "2026-10-29T02:30:00Z" }, // 23:30 del 28 en Argentina
  ],
  manual: [
    { ot: "7200", etapa: 4, pct: 20, created_at: "2026-10-27T15:00:00Z" },
    { ot: "7200", etapa: 4, pct: 60, created_at: "2026-10-28T20:00:00Z" },
  ],
  proyectos: new Map([["7100", { cliente: "BCG" }], ["7200", { cliente: "Ana", descripcion: "Cocina" }]]),
  vivo: new Map([
    ["7100", { ot: "7100", tarde: true, diasTarde: 2, diasCorrido: 3, procesos: [{ etapa: "corte", completo: false, diasCorrido: 3 }] }],
    ["7200", { ot: "7200", tarde: false, diasTarde: 0, diasCorrido: 0, procesos: [{ etapa: "armado", completo: false, diasCorrido: 0 }] }],
  ]),
};

test("calcularInforme — planificado, hecho y desvío por proceso y por OT; cumplimiento en horas", () => {
  const r = calcularInforme(DATOS);
  const o71 = r.ots.find((o) => o.ot === "7100");
  const corte = o71.procesos[0];
  assert.equal(corte.planificado, 50);
  assert.equal(corte.hecho, 60, "6 de 10 piezas el 28 (las de las 23:30 también)");
  assert.equal(corte.alFinal, 50, "7 pasaron, 2 fueron después del 28");
  assert.equal(corte.desvio, 10);
  assert.equal(o71.cliente, "BCG");
  assert.equal(o71.tarde, true);
  const armado = r.ots.find((o) => o.ot === "7200").procesos[0];
  assert.equal(armado.planificado, 50);
  assert.equal(armado.hecho, 40, "el checkeo manual subió de 20 a 60");
  assert.equal(armado.alFinal, 60);
  assert.equal(armado.desvio, -10);
  assert.equal(r.ots[0].ot, "7200", "primero la más atrasada");
  // Cumplimiento: 7100 hizo 9,6 h de 8 planificadas (cuenta 8) y 7200 hizo 8 h de 10 → 16 / 18
  assert.equal(r.resumen.cumplimiento, 88.9);
  assert.equal(r.resumen.enSemana, 50);
  assert.equal(r.resumen.sinCorrimiento, 50);
  // 6,2 (de 7) + 1 (de 2) + 0,5 (de 1) = 7,7
  assert.equal(r.nota, 7.7);
  assert.match(explicacionNota(r), /parte de 0 y suma puntos: cumplimiento 88,9 % .* da 6,2 de 7; OT que llegan a su semana 50 % da 1 de 2; procesos sin correrse del plan 50 % da 0,5 de 1\. Total: 7,7 de 10\./);
  assert.equal(textoPushInforme(r), "Nota 7,7 · cumplimiento 88,9 % · 2 OT trabajadas");
  assert.equal(informeVacio(r), false);
  assert.equal(informeVacio(calcularInforme({ ...DATOS, periodo: periodoDe("dia", "2026-10-20") })), true);
});

// Tadeo, 29/10: "hoy se registraron avances a mano pero el informe dice que no se hizo nada"
test("calcularInforme — avance a mano con piezas sin escanear, sin historial, etapa firmada y OT fuera del plan", () => {
  const r = calcularInforme({
    ...DATOS,
    piezas: [...DATOS.piezas, { ot: "7300", etapa: 1, total: 20, pasaron: 0 }, { ot: "7400", etapa: 2, total: 8, pasaron: 0 }],
    proyectos: new Map([...DATOS.proyectos,
      // Checkeo de hoy sin historial (antes de la 146): cuenta lo cargado
      ["7300", { ot: "7300", cliente: "Luis", avance_manual: { activo: true, etapas: { 1: 40 }, at: "2026-10-28T19:00:00Z" } }],
      // Checkeo viejo: no cuenta como hecho hoy
      ["7500", { ot: "7500", avance_manual: { activo: true, etapas: { 1: 90 }, at: "2026-10-20T19:00:00Z" } }],
    ]),
    avance: [
      { ot: "7400", etapa: 2, estado: "terminada", terminada_at: "2026-10-28T16:00:00Z" },
      { ot: "7200", etapa: 4, estado: "aprobada", aprobada_at: "2026-10-28T21:00:00Z" },
      { ot: "7100", etapa: 2, estado: "no_aplica" },
    ],
  });
  const o73 = r.ots.find((o) => o.ot === "7300");
  assert.equal(o73.procesos[0].hecho, 40, "las piezas sin escanear no tapan el checkeo manual");
  assert.equal(o73.procesos[0].fuente, "manual");
  assert.equal(o73.fueraDelPlan, true);
  assert.equal(o73.enOtroPlan, false);
  const o74 = r.ots.find((o) => o.ot === "7400");
  assert.equal(o74.procesos[0].hecho, 100, "la etapa firmada como terminada llega al 100 %");
  assert.equal(o74.fueraDelPlan, true);
  assert.ok(!r.ots.find((o) => o.ot === "7500"));
  const armado = r.ots.find((o) => o.ot === "7200").procesos[0];
  assert.equal(armado.hecho, 80, "de 20 a 100 con la aprobación");
  assert.equal(armado.fueraDelPlan, false);
  assert.equal(r.ots.find((o) => o.ot === "7100").fueraDelPlan, false);
  assert.equal(r.resumen.otsFueraDelPlan, 2);
  // Lo de fuera del plan no cambia el cumplimiento: 7100 8 de 8 h y 7200 10 de 10 h
  assert.equal(r.resumen.cumplimiento, 100);
  assert.match(explicacionNota(r), /fuera del plan no cuenta en el cumplimiento/);
  assert.match(textoPushInforme(r), /4 OT trabajadas · 2 fuera del plan$/);
  const html = htmlInformeProduccion({ empresa: "GI", slug: "gi", informe: r, explicacion: explicacionNota(r) });
  assert.match(html, /OT con producción fuera del plan.*2: 7300, 7400/s);
  render(<VistaInforme informe={r} />);
  assert.match(document.querySelector("[data-fuera-plan]").textContent, /2 OT tuvieron producción sin estar planificada en el período: 7300, 7400/);
  assert.match(document.querySelector('[data-ot="7300"]').textContent, /🆕 fuera del plan/);
});

test("email — nota, cómo se calcula y gráficos por OT en barras", () => {
  const r = calcularInforme(DATOS);
  const html = htmlInformeProduccion({ empresa: "GI", slug: "gi", informe: r, explicacion: explicacionNota(r) });
  assert.match(html, /7,7 \/ 10/);
  assert.match(html, /Cumplimiento de lo planificado \(88,9 %\).*\+6,2 de 7/s);
  assert.match(html, /OT 7200/);
  assert.match(html, /La nota parte de 0 y suma puntos/);
  assert.match(html, /gris: planificado · naranja: hecho/);
});

test("/api/data — informes solo de lectura para gestión; el historial del checkeo lo carga gestión con su id", () => {
  assert.equal(autorizar("informes_produccion", "GET", { rol: "administrativo" }).ok, true);
  assert.equal(autorizar("informes_produccion", "GET", { rol: "operativo" }).ok, false);
  assert.equal(autorizar("informes_produccion", "POST", { rol: "gerencial" }).ok, false, "los guarda el cron");
  assert.equal(autorizar("avance_manual_historial", "POST", { rol: "gerencial" }).ok, true);
  const r = prepararBodyPost("avance_manual_historial", { ot: "7200", etapa: 4, pct: 60 }, { rol: "gerencial", empleado_id: "e-1" }, null);
  assert.equal(r.body.creado_por, "e-1");
  assert.equal(prepararBodyPost("avance_manual_historial", { ot: "7200", etapa: 4, pct: 160 }, { rol: "gerencial" }, null).status, 400);
  const sql = readFileSync(new URL("../supabase/migrations/146_informe_produccion.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /create table if not exists public\.informes_produccion/);
  assert.match(sql, /create table if not exists public\.avance_manual_historial/);
  const cron = readFileSync(new URL("../app/api/cron/reporte-diario/route.js", import.meta.url), "utf8");
  assert.match(cron, /enviarInformeDelDia/, "sale cada noche con el reporte del día");
});

test("🏭 Producción — guardados, informe parcial de la semana con la nota y el detalle por proceso", async () => {
  const r = calcularInforme({ ...DATOS, periodo: periodoDe("semana", "2026-10-28") });
  const pedidos = [];
  global.fetch = async (url) => {
    pedidos.push(String(url));
    if (String(url).includes("guardados=1")) return Response.json({ ok: true, informes: [{ id: 3, tipo: "dia", desde: "2026-10-27", hasta: "2026-10-27", nota: "8.5", created_at: "2026-10-28T02:00:00Z" }] });
    return Response.json({ ok: true, informe: r });
  };
  render(<InformeProduccionTab />);
  await esperar();
  const guardados = screen.getByRole("region", { name: "Informes guardados" });
  assert.match(guardados.textContent, /Día · 27\/10\/2026.*8,5/);
  fireEvent.click(screen.getByRole("button", { name: "Semana" }));
  fireEvent.click(screen.getByRole("button", { name: /Armar informe de la semana/ }));
  await esperar();
  assert.ok(pedidos.some((u) => /tipo=semana&fecha=\d{4}-\d{2}-\d{2}/.test(u)));
  const nota = screen.getByRole("region", { name: "Nota del período" });
  assert.match(nota.textContent, /6,3sobre 10/, "en la semana había más planificado");
  assert.match(nota.textContent, /La nota parte de 0 y suma puntos/, "explica cómo se calcula");
  assert.match(nota.textContent, /Cumplimiento de lo planificado · [\d,]+ %\+[\d,]+ de 7/);
  assert.equal(within(nota).getAllByRole("meter").length, 3);
  const ot = document.querySelector('[data-ot="7200"]');
  fireEvent.click(within(ot).getByRole("button"));
  assert.match(ot.querySelector("table").textContent, /Armado · ✋ a mano100 %60 %-4060 %/);
  // Uno guardado
  fireEvent.click(within(guardados).getByRole("button"));
  await esperar();
  assert.ok(pedidos.some((u) => u.endsWith("?id=3")));
  assert.match(screen.getByRole("region", { name: "Nota del período" }).textContent, /guardado/);
});

// ─── PDF (Tadeo, 29/10): lo mismo que el informe de la noche, hasta el momento, con gráficos ───

const REPORTE_DIA = {
  fecha: "2026-10-28", piezasHoy: 6,
  produccion: [{ ot: "7100", cliente: "BCG", antes: 0, despues: 30, piezasHoy: 6, etapas: [{ nombre: "Corte", hoy: 6, pasaron: 6, total: 10 }] }],
  completadas: [], etapasCerradas: [{ ot: "7200", cliente: "Ana", nombre: "Armado", que: "terminada" }],
  instalaciones: [], atrasadas: [{ ot: "7100", cliente: "BCG", dias: 2, porcentaje: 30 }],
};

test("PDF — una hoja: nota en medio círculo, partes, lo importante, por proceso, por OT y el reporte del día en una línea", async () => {
  const { htmlInformePdf, horasPorProceso, otsDeLaHoja } = await import("../app/lib/informePdf.js");
  const r = calcularInforme(DATOS);
  const html = htmlInformePdf({ empresa: { nombre: "GI Group" }, informe: r, reporteDia: REPORTE_DIA, ahora: new Date("2026-10-28T18:30:00Z") });
  assert.match(html, /@page \{ size: A4/);
  assert.match(html, /Parcial: con lo que hay hasta el 28\/10\/2026 a las 15:30/);
  assert.match(html, /aria-label="Nota 7,7 sobre 10"/);
  assert.match(html, /stroke-dasharray="77 100"/);
  assert.match(html, /aria-label="Partes de la nota"/);
  assert.match(html, /aria-label="Planificado y hecho por OT"/);
  assert.match(html, /aria-label="Horas por proceso"/);
  assert.match(html, /La nota parte de 0 y suma: hasta 7 puntos por cumplimiento, hasta 2 por OT en su semana y hasta 1/, "cómo se calcula, en una línea");
  assert.match(html, /\+6,2 de 7/);
  assert.match(html, /<h2>Lo importante<\/h2>/);
  assert.match(html, /Cumplimiento 88,9 %: se cumplieron 16 h de las 18 h planificadas\. En total se hicieron 17,6 h\./);
  assert.match(html, /Atrasadas contra el plan: OT 7200 \(-10 %\)\./);
  assert.match(html, /1 de 2 OT terminan después de su semana: OT 7100\./);
  assert.match(html, /Hoy: 6 piezas escaneadas, 1 etapa terminada o firmada, 0 reportes de instalación, 1 OT atrasada contra la entrega\./);
  assert.doesNotMatch(html, /Detalle por OT y proceso/, "el detalle queda en Gypi");
  assert.match(html, /\.hoja \{ max-height: 276mm; overflow: hidden; \}/, "nunca pasa de una hoja");
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /Producción fuera del plan/, "sin OT fuera del plan no va el punto");
  const fuera = htmlInformePdf({ informe: calcularInforme({ ...DATOS, avance: [{ ot: "7400", etapa: 2, estado: "terminada", terminada_at: "2026-10-28T16:00:00Z" }] }) });
  assert.match(fuera, /Producción fuera del plan: OT 7400 \(no cuenta en el cumplimiento\)\./);
  assert.match(fuera, /OT 7400<\/text>[\s\S]*\+100 %[\s\S]*🆕 fuera del plan/);
  // Muchas OT: las 14 que entran, con las de fuera del plan al final aunque no estén atrasadas
  const muchas = [...Array.from({ length: 20 }, (_, i) => ({ ot: String(i), desvio: -i })), { ot: "F1", fueraDelPlan: true }, { ot: "F2", fueraDelPlan: true }];
  assert.deepEqual(otsDeLaHoja(muchas).map((o) => o.ot), [...Array.from({ length: 12 }, (_, i) => String(i)), "F1", "F2"]);
  assert.deepEqual(horasPorProceso(r.ots).map((p) => [p.nombre, p.plan, Math.round(p.hecho * 10) / 10]), [["Corte", 8, 9.6], ["Armado", 10, 8]]);
  // Guardado de la noche, de una semana: sin reporte del día
  const semana = htmlInformePdf({ informe: calcularInforme({ ...DATOS, periodo: periodoDe("semana", "2026-10-28") }), guardado: "2026-10-29T02:00:00Z" });
  assert.match(semana, /Informe guardado al cerrar el día/);
  assert.match(semana, /de la semana del 26\/10\/2026 al 1\/11\/2026/);
  assert.doesNotMatch(semana, /Reporte del día/);
});

test("🏭 Producción — 📄 Exportar PDF abre la hoja con el reporte del día", async () => {
  const r = calcularInforme(DATOS);
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("guardados=1")) return Response.json({ ok: true, informes: [] });
    if (u.includes("/api/reportes/dia")) return Response.json({ ok: true, reporte: REPORTE_DIA });
    return Response.json({ ok: true, informe: r });
  };
  const escrito = [];
  const original = window.open;
  window.open = () => ({ document: { write: (h) => escrito.push(h), close() {} }, focus() {}, print() {} });
  try {
    render(<InformeProduccionTab empresa={{ nombre: "GI Group" }} />);
    await esperar();
    assert.equal(screen.queryByRole("button", { name: "📄 Exportar PDF" }), null, "primero hay que armar el informe");
    fireEvent.click(screen.getByRole("button", { name: /Armar informe del día/ }));
    await esperar();
    fireEvent.click(screen.getByRole("button", { name: "📄 Exportar PDF" }));
    assert.equal(escrito.length, 1);
    assert.match(escrito[0], /GI Group/);
    assert.match(escrito[0], /Hoy: 6 piezas escaneadas/, "con el reporte del día");
    assert.match(escrito[0], /Planificado y hecho por OT/);
  } finally {
    window.open = original;
  }
});
