// tests/informe-produccion.test.jsx — Informe de producción del día, la
// semana o el mes, con la nota del 1 al 10 (Tadeo, 29/10; migración 146).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { periodoDe, notaInforme, calcularInforme, explicacionNota, textoPushInforme, informeVacio } from "../app/lib/informeProduccion.js";
import { autorizar, prepararBodyPost } from "../app/lib/dataPolicy.js";

const { default: InformeProduccionTab } = await import("../app/components/InformeProduccionTab.jsx");
const { htmlInformeProduccion } = await import("../app/lib/email.js");

afterEach(() => cleanup());
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); });

test("periodoDe — el día, su semana de lunes a domingo y su mes", () => {
  assert.deepEqual(periodoDe("dia", "2026-10-28"), { tipo: "dia", desde: "2026-10-28", hasta: "2026-10-28" });
  assert.deepEqual(periodoDe("semana", "2026-10-28"), { tipo: "semana", desde: "2026-10-26", hasta: "2026-11-01" });
  assert.deepEqual(periodoDe("semana", "2026-11-01"), { tipo: "semana", desde: "2026-10-26", hasta: "2026-11-01" }, "el domingo es de la misma semana");
  assert.deepEqual(periodoDe("mes", "2026-02-10"), { tipo: "mes", desde: "2026-02-01", hasta: "2026-02-28" });
});

test("nota — 70 % cumplimiento + 20 % OT en su semana + 10 % sin corrimiento, de a 0,5", () => {
  assert.equal(notaInforme({ cumplimiento: 100, enSemana: 100, sinCorrimiento: 100 }), 10);
  // 0,7·80 + 0,2·50 + 0,1·100 = 76 → 7,6 → 7,5
  assert.equal(notaInforme({ cumplimiento: 80, enSemana: 50, sinCorrimiento: 100 }), 7.5);
  // 0,7·85 + 0,2·100 + 0,1·80 = 87,5 → 8,75 → 9
  assert.equal(notaInforme({ cumplimiento: 85, enSemana: 100, sinCorrimiento: 80 }), 9);
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
  // 0,7·88,9 + 0,2·50 + 0,1·50 = 77,2 → 7,72 → 7,5
  assert.equal(r.nota, 7.5);
  assert.match(explicacionNota(r), /70 % del cumplimiento \(88,9 %.*20 % de las OT que llegan a su semana \(50 %\).*10 % de los procesos que no se corrieron del plan confirmado \(50 %\).*Da 7,7 sobre 10 y se redondea de a 0,5: 7,5/);
  assert.equal(textoPushInforme(r), "Nota 7,5 · cumplimiento 88,9 % · 2 OT trabajadas");
  assert.equal(informeVacio(r), false);
  assert.equal(informeVacio(calcularInforme({ ...DATOS, periodo: periodoDe("dia", "2026-10-20") })), true);
});

test("email — nota, cómo se calcula y gráficos por OT en barras", () => {
  const r = calcularInforme(DATOS);
  const html = htmlInformeProduccion({ empresa: "GI", slug: "gi", informe: r, explicacion: explicacionNota(r) });
  assert.match(html, /7,5 \/ 10/);
  assert.match(html, /OT 7200/);
  assert.match(html, /Nota = 70 %/);
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
  assert.match(nota.textContent, /6,5sobre 10/, "en la semana había más planificado");
  assert.match(nota.textContent, /Nota = 70 %/, "explica cómo se calcula");
  assert.equal(within(nota).getAllByRole("meter").length, 3);
  const ot = document.querySelector('[data-ot="7200"]');
  fireEvent.click(within(ot).getByRole("button"));
  assert.match(ot.querySelector("table").textContent, /Armado100 %60 %-4060 %/);
  // Uno guardado
  fireEvent.click(within(guardados).getByRole("button"));
  await esperar();
  assert.ok(pedidos.some((u) => u.endsWith("?id=3")));
  assert.match(screen.getByRole("region", { name: "Nota del período" }).textContent, /guardado/);
});
