// tests/pausa-ot.test.jsx — ⏸ Poner en pausa una OT (Tadeo, 02/11; migración
// 151; app/lib/pausaOt.js): mientras está en pausa no suma tiempo de trabajo
// (lead time, plan vivo, Gantt, avisos, informe) y el operario ve un aviso.
import "./helpers/domSetup.js";
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MOTIVOS_PAUSA, validarPausa, validarReanudar, pausasAbiertas, otsEnPausa, intervalosPausa, diasEnPausa, enPausaElDia, textoPausa, textoMotivoPausa } from "../app/lib/pausaOt.js";
import { planVivo } from "../app/lib/ganttPlan.js";
import { horasTrabajo, horasSinPausa, leadTimeProcesos } from "../app/lib/leadTimeHoras.js";
import { leadTimes } from "../app/lib/leadTime.js";
import { autorizar, prepararBodyPost, validarPatch } from "../app/lib/dataPolicy.js";
import { calcularInforme } from "../app/lib/informeProduccion.js";
import { puntosClave } from "../app/lib/informePdf.js";
import { estadoOtLista } from "../app/lib/otLista.js";
import { mensajeEscaneo } from "../app/lib/piezas.js";
import { describirCambio, cambiosAnteriores, TABLAS_OT } from "../app/lib/historialOt.js";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

const { default: PausaOt } = await import("../app/components/PausaOt.jsx");

const sinRed = async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
global.fetch = sinRed;
afterEach(() => { cleanup(); global.fetch = sinRed; mock.timers.reset(); });
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); });

// Pausada el lunes 26/10 a las 8 (Argentina) y reanudada el miércoles 28/10 a las 8
const PAUSA = { id: 1, ot: "7100", motivo: "falta_pago", detalle: null, desde: "2026-10-26T11:00:00Z", hasta: "2026-10-28T11:00:00Z" };

test("motivos y validación de una pausa nueva", () => {
  assert.ok(MOTIVOS_PAUSA.some((m) => m.label === "Falta de pago"));
  assert.equal(validarPausa({ ot: "7100", motivo: "falta_pago" }), null);
  assert.equal(validarPausa({ ot: "7100" }), "Elegí el motivo de la pausa");
  assert.equal(validarPausa({ ot: "", motivo: "falta_pago" }), "Falta la OT");
  assert.equal(validarPausa({ ot: "7100", motivo: "otros" }), "Escribí cuál es el motivo");
  assert.equal(validarPausa({ ot: "7100", motivo: "otros", detalle: "Inundación" }), null);
  assert.equal(validarPausa({ ot: "7100", motivo: "falta_pago", hasta: "2026-10-28T11:00:00Z" }), "Una pausa nueva no puede venir terminada");
  assert.equal(textoMotivoPausa({ motivo: "otros", detalle: "Inundación" }), "Inundación");
  assert.equal(textoMotivoPausa({ motivo: "falta_pago", detalle: "cuota 2" }), "Falta de pago · cuota 2");
});

test("reanudar: solo hasta y quién", () => {
  assert.equal(validarReanudar({ hasta: "2026-10-28T11:00:00Z", reanudada_nombre: "Tadeo" }), null);
  assert.equal(validarReanudar({ hasta: "x" }), "Falta cuándo se reanudó");
  assert.match(validarReanudar({ hasta: "2026-10-28T11:00:00Z", motivo: "otros" }), /solo se le puede poner/);
});

test("abiertas, tramos, días y día por día", () => {
  const abierta = { id: 2, ot: "7200", motivo: "cliente", desde: "2026-10-27T11:00:00Z", hasta: null };
  const ps = [PAUSA, abierta];
  assert.deepEqual([...pausasAbiertas(ps).keys()], ["7200"]);
  assert.deepEqual([...otsEnPausa(ps)], ["7200"]);
  const ahora = new Date("2026-10-29T11:00:00Z");
  assert.deepEqual(intervalosPausa(ps, "7200", ahora), [{ a: Date.parse(abierta.desde), b: ahora.getTime() }], "la abierta llega hasta ahora");
  assert.equal(diasEnPausa(ps, "7100"), 2);
  assert.equal(enPausaElDia(ps, "7100", "2026-10-25"), false);
  assert.equal(enPausaElDia(ps, "7100", "2026-10-26"), true);
  assert.equal(enPausaElDia(ps, "7100", "2026-10-27"), true);
  assert.equal(enPausaElDia(ps, "7100", "2026-10-28"), false, "el día que se reanuda vuelve al plan");
  assert.equal(enPausaElDia(ps, "7200", "2026-11-30"), true);
  assert.equal(textoPausa(abierta), "⏸ En pausa desde 27/10 · El cliente pidió frenar o no definió");
});

test("lead time — las horas en pausa no cuentan", () => {
  // Del viernes 23/10 8 h al jueves 29/10 16 h: 5 días hábiles de 8 h = 40 h; dos días en pausa = 16 h menos
  const tramos = intervalosPausa([PAUSA], "7100");
  assert.equal(horasTrabajo("2026-10-23T11:00:00Z", "2026-10-29T19:00:00Z"), 40);
  assert.equal(horasSinPausa("2026-10-23T11:00:00Z", "2026-10-29T19:00:00Z", undefined, tramos), 24);
  const datos = { etapasCodigo: { corte: 1 }, ahora: new Date("2026-10-30T12:00:00Z"),
    piezas: [{ ot: "7100", etapa: 1, total: 4, pasaron: 4, primer_paso: "2026-10-23T11:00:00Z", ultimo_paso: "2026-10-29T19:00:00Z" }] };
  assert.equal(leadTimeProcesos(datos).get("7100").procesos[0].horas, 40);
  assert.equal(leadTimeProcesos({ ...datos, pausas: [PAUSA] }).get("7100").procesos[0].horas, 24);
  // En días corridos (Reportes → ⏱ Lead time): 6,3 días menos 2 de pausa
  const p = { ot: "7100", liberada_at: "2026-10-23T11:00:00Z", created_at: "2026-10-23T11:00:00Z" };
  const piezas = [{ ot: "7100", total: 4, pasaron: 4, primer_paso: "2026-10-23T11:00:00Z", ultimo_paso: "2026-10-29T19:00:00Z" }];
  assert.equal(leadTimes({ proyectos: [p], avancePiezas: piezas })[0].produccion, 6.3);
  assert.equal(leadTimes({ proyectos: [p], avancePiezas: piezas, pausas: [PAUSA] })[0].produccion, 4.3);
});

test("plan vivo — la OT en pausa sale y la siguiente toma su lugar", () => {
  const items = [
    { ot: "A", etapa: "corte", fecha: "2026-11-02", horas: 8, orden: 0 },
    { ot: "B", etapa: "corte", fecha: "2026-11-03", horas: 8, orden: 1 },
  ];
  const base = { proyectos: new Map([["A", { ot: "A" }], ["B", { ot: "B" }]]), etapasCodigo: { corte: 1 }, hoy: "2026-11-02" };
  const sin = planVivo(items, base);
  assert.equal(sin.get("B").procesos[0].desde, "2026-11-03");
  const con = planVivo(items, { ...base, pausadas: new Set(["A"]) });
  assert.ok(!con.has("A"), "la pausada no está en el plan vivo (ni en avisos ni en atrasadas)");
  assert.equal(con.get("B").procesos[0].desde, "2026-11-02", "B arranca antes");
});

test("informe — lo planificado en días de pausa no cuenta y se muestra aparte", () => {
  const base = { periodo: { tipo: "dia", desde: "2026-10-27", hasta: "2026-10-27" }, etapasCodigo: { corte: 1 },
    items: [{ ot: "7100", etapa: "corte", fecha: "2026-10-27", horas: 8 }, { ot: "7200", etapa: "corte", fecha: "2026-10-27", horas: 8 }],
    piezas: [{ ot: "7200", etapa: 1, total: 2, pasaron: 2 }],
    pasos: [{ ot: "7200", etapa: 1, created_at: "2026-10-27T13:00:00Z" }, { ot: "7200", etapa: 1, created_at: "2026-10-27T14:00:00Z" }],
    proyectos: new Map([["7100", { ot: "7100", cliente: "BCG" }], ["7200", { ot: "7200" }]]) };
  assert.equal(calcularInforme(base).resumen.cumplimiento, 50, "sin pausa: la 7100 no hizo nada");
  const r = calcularInforme({ ...base, pausas: [PAUSA] });
  assert.equal(r.resumen.cumplimiento, 100, "con pausa no baja");
  assert.deepEqual(r.enPausa.map((p) => [p.ot, p.cliente, p.motivo]), [["7100", "BCG", "Falta de pago"]]);
  assert.ok(puntosClave(r).some((p) => /⏸ En pausa: OT 7100 · BCG \(Falta de pago\)/.test(p.texto)));
  // Una pausa de otro mes no aparece
  assert.equal(calcularInforme({ ...base, pausas: [{ ...PAUSA, desde: "2026-09-01T11:00:00Z", hasta: "2026-09-02T11:00:00Z" }] }).enPausa.length, 0);
});

test("lista de OT — ⏸ En pausa", () => {
  assert.equal(estadoOtLista({ ot: "7100", estado: "activo" }, { porcentaje: 40, pausa: PAUSA }).texto, "⏸ En pausa");
  assert.equal(estadoOtLista({ ot: "7100", estado: "cerrado" }, { pausa: PAUSA }).texto, "Cerrada");
});

test("escaneo — se anota igual, con aviso amarillo", () => {
  const r = { ok: true, ya: false, pieza: { id: 1, ot: "7100", nombre: "Lateral", de: 1 }, etapa: 1, etapaNombre: "Corte", requerida: true, faltan: [] };
  assert.equal(mensajeEscaneo(r).tono, "verde");
  const m = mensajeEscaneo({ ...r, pausa: { motivo: "falta_pago" } });
  assert.equal(m.tono, "amarillo");
  assert.equal(m.texto, "Lateral pasó por Corte.");
  assert.match(m.detalle, /⏸ La OT 7100 está en pausa \(Falta de pago\)/);
  assert.equal(mensajeEscaneo({ ok: false, error: "x", pausa: { motivo: "falta_pago" } }).tono, "rojo");
  const ruta = readFileSync(new URL("../app/api/piezas/paso/route.js", import.meta.url), "utf8");
  assert.match(ruta, /pausas_ot\?empresa_id=eq\.\$\{sesion\.empresa_id\}&ot=eq\.\$\{encodeURIComponent\(ot\)\}&hasta=is\.null/);
});

test("permisos — gestión pausa y reanuda; todos ven; no se borra", () => {
  assert.equal(autorizar("pausas_ot", "POST", { rol: "gerencial" }).ok, true);
  assert.equal(autorizar("pausas_ot", "PATCH", { rol: "administrativo" }).ok, true);
  assert.equal(autorizar("pausas_ot", "POST", { rol: "operativo" }).ok, false);
  assert.equal(autorizar("pausas_ot", "GET", { rol: "operativo" }).ok, true);
  assert.equal(autorizar("pausas_ot", "DELETE", { rol: "gerencial" }).ok, false);
  const r = prepararBodyPost("pausas_ot", { ot: "7100", motivo: "falta_pago", creado_por: "otro", desde: "2020-01-01T00:00:00Z" }, { rol: "gerencial", empleado_id: "e-1" }, null);
  assert.equal(r.body.creado_por, "e-1");
  assert.notEqual(r.body.desde, "2020-01-01T00:00:00Z", "empieza ahora");
  assert.equal(prepararBodyPost("pausas_ot", { ot: "7100" }, { rol: "gerencial" }, null).status, 400);
  assert.equal(validarPatch("pausas_ot", { motivo: "otros" }, { rol: "gerencial" })?.status, 400);
  assert.ok(!validarPatch("pausas_ot", { hasta: "2026-10-28T11:00:00Z" }, { rol: "gerencial" }));
});

test("historial y migración 151", () => {
  assert.ok(TABLAS_OT.includes("pausas_ot"));
  assert.equal(describirCambio({ tabla: "pausas_ot", metodo: "POST", campos: { motivo: "falta_pago" } }), "⏸ Puso la OT en pausa · Falta de pago");
  assert.equal(describirCambio({ tabla: "pausas_ot", metodo: "PATCH", campos: { hasta: "x" } }), "▶ Reanudó la OT");
  const c = cambiosAnteriores({ pausas: [{ ...PAUSA, creado_nombre: "Ana", reanudada_nombre: "Tadeo" }] });
  assert.deepEqual(c.map((x) => [x.metodo, x.nombre]), [["POST", "Ana"], ["PATCH", "Tadeo"]]);
  assert.ok(MIGRACIONES.some((m) => m.n === 151 && m.tablas.pausas_ot));
  const sql = readFileSync(new URL("../supabase/migrations/151_pausas_ot.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /grant select, insert, update on public\.pausas_ot to authenticated/);
  assert.match(sql, /unique index if not exists uq_pausas_ot_abierta .* where hasta is null/);
});

test("Detalle OT — ⏸ Poner en pausa y ▶ Reanudar", async () => {
  const posts = [], patches = [];
  global.fetch = async (url, opts = {}) => {
    const { method, path, body } = JSON.parse(opts.body || "{}");
    if (method === "POST" && path === "pausas_ot") { posts.push(body); return new Response(JSON.stringify({ data: [{ ...body, id: 9, desde: "2026-11-02T15:00:00Z", hasta: null }] }), { status: 200 }); }
    if (method === "PATCH") { patches.push({ path, body }); return new Response(JSON.stringify({ data: [] }), { status: 200 }); }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  let cambios = 0;
  render(<PausaOt ot="7100" pausas={[]} puedePausar usuarioNombre="Tadeo" onCambio={() => cambios++} />);
  fireEvent.click(screen.getByRole("button", { name: "⏸ Poner en pausa" }));
  fireEvent.click(screen.getByRole("button", { name: "⏸ Poner en pausa" }));
  assert.equal(screen.getByRole("alert").textContent, "Elegí el motivo de la pausa");
  fireEvent.click(screen.getByRole("radio", { name: "Falta de pago" }));
  fireEvent.change(screen.getByLabelText("Nota (si querés)"), { target: { value: "cuota 2" } });
  fireEvent.click(screen.getByRole("button", { name: "⏸ Poner en pausa" }));
  await esperar();
  assert.deepEqual(posts[0], { ot: "7100", motivo: "falta_pago", detalle: "cuota 2", creado_nombre: "Tadeo" });
  assert.match(screen.getByRole("region", { name: "Pausa de la OT" }).textContent, /⏸ En pausa desde/);
  assert.equal(cambios, 1);
  fireEvent.click(screen.getByRole("button", { name: "▶ Reanudar la OT" }));
  await esperar();
  assert.equal(patches[0].path, "pausas_ot?id=eq.9&hasta=is.null");
  assert.ok(patches[0].body.hasta);
  assert.equal(patches[0].body.reanudada_nombre, "Tadeo");
  assert.ok(screen.getByRole("button", { name: "⏸ Poner en pausa" }), "se puede volver a pausar");
  assert.equal(cambios, 2);
});

test("Detalle OT — sin permiso solo se ve si está en pausa", () => {
  const { container, unmount } = render(<PausaOt ot="7100" pausas={[]} />);
  assert.equal(container.textContent, "", "sin pausas y sin permiso, nada");
  unmount();
  render(<PausaOt ot="7100" pausas={[{ ...PAUSA, hasta: null }]} />);
  assert.match(screen.getByRole("region", { name: "Pausa de la OT" }).textContent, /En pausa desde/);
  assert.ok(!screen.queryByRole("button"));
});
