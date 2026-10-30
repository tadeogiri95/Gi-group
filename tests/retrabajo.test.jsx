// tests/retrabajo.test.jsx — 🔁 Retrabajo de un proceso de una OT (Tadeo, 30/10;
// migración 147; app/lib/retrabajo.js): suma horas sin bajar el %, va en rojo
// al final de la barra del Gantt y sale en el informe de producción.
import "./helpers/domSetup.js";
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { MOTIVOS_RETRABAJO, validarRetrabajo, validarFinRetrabajo, retrabajoPendiente, pendientesDe, retrabajosDe, retrabajosHechos, textoMotivoRetrabajo } from "../app/lib/retrabajo.js";
import { planVivo } from "../app/lib/ganttPlan.js";
import { autorizar, prepararBodyPost, validarPatch } from "../app/lib/dataPolicy.js";
import { calcularInforme, textoPushInforme, explicacionNota, informeVacio } from "../app/lib/informeProduccion.js";
import { puntosClave, svgPorOt } from "../app/lib/informePdf.js";
import { htmlInformeProduccion } from "../app/lib/email.js";

const { default: GanttOt } = await import("../app/components/GanttOt.jsx");

const sinRed = async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
global.fetch = sinRed;
afterEach(() => { cleanup(); global.fetch = sinRed; mock.timers.reset(); });

const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); });

const RT = { ot: "7100", etapa: "corte", horas: 3, motivo: "pieza_mal_cortada", detalle: null };

test("motivos — los propuestos más Canto mal pegado, Pieza mal procesada y Error de diseño", () => {
  const labels = MOTIVOS_RETRABAJO.map((m) => m.label);
  for (const l of ["Pieza mal cortada", "Canto mal pegado", "Pieza mal procesada", "Error de diseño", "Otros"]) assert.ok(labels.includes(l), l);
  assert.equal(textoMotivoRetrabajo(RT), "Pieza mal cortada");
  assert.equal(textoMotivoRetrabajo({ motivo: "otros", detalle: "Se mojó" }), "Otros: Se mojó");
});

test("validarRetrabajo — horas mayores a 0, proceso y motivo; Otros pide el renglón", () => {
  assert.equal(validarRetrabajo(RT), null);
  assert.equal(validarRetrabajo({ ...RT, horas: 0 }), "Escribí cuántas horas de retrabajo");
  assert.equal(validarRetrabajo({ ...RT, horas: NaN }), "Escribí cuántas horas de retrabajo");
  assert.equal(validarRetrabajo({ ...RT, etapa: "pintura" }), "Proceso inválido");
  assert.equal(validarRetrabajo({ ...RT, motivo: null }), "Elegí el motivo");
  assert.equal(validarRetrabajo({ ...RT, motivo: "otros" }), "Escribí cuál es el motivo");
});

test("retrabajoPendiente — suma lo sin terminar por OT y proceso", () => {
  const l = [
    { id: 1, ...RT, created_at: "2026-10-26T12:00:00Z" },
    { id: 2, ...RT, horas: 1.5, created_at: "2026-10-26T11:00:00Z" },
    { id: 3, ...RT, horas: 9, created_at: "2026-10-26T09:00:00Z", terminado_at: "2026-10-26T15:00:00Z" },
    { id: 4, ...RT, etapa: "armado", horas: 2 },
  ];
  const m = retrabajoPendiente(l);
  assert.equal(m.get("7100|corte"), 4.5);
  assert.equal(m.get("7100|armado"), 2);
  assert.deepEqual(pendientesDe(l, "7100", "corte").map((r) => r.id), [2, 1], "el más viejo primero, sin los terminados");
  // Eliminado (148): no cuenta en ningún lado
  const conAnulado = [...l, { id: 5, ...RT, horas: 50, created_at: "2026-10-26T10:00:00Z", anulado_at: "2026-10-26T13:00:00Z" },
    { id: 6, ...RT, horas: 8, created_at: "2026-10-26T10:00:00Z", terminado_at: "2026-10-26T14:00:00Z", anulado_at: "2026-10-26T15:00:00Z" }];
  assert.equal(retrabajoPendiente(conAnulado).get("7100|corte"), 4.5);
  assert.deepEqual(retrabajosDe(conAnulado, "7100", "corte").map((r) => r.id), [2, 1, 3], "los terminados al final, sin los eliminados");
  assert.deepEqual(retrabajosHechos(conAnulado).get("7100|corte").map((h) => h.horas), [9], "terminados, para la parte roja");
  assert.equal(validarFinRetrabajo({ anulado_at: "2026-10-26T15:00:00Z" }), null);
  assert.equal(validarFinRetrabajo({ anulado_at: "x" }), "Falta cuándo se eliminó");
});

test("planVivo — el retrabajo suma horas a un proceso completo, va al final y corre lo que sigue", () => {
  const items = [{ ot: "A", etapa: "corte", fecha: "2026-10-26", horas: 8, orden: 0 }, { ot: "A", etapa: "armado", fecha: "2026-10-27", horas: 4, orden: 0 }];
  const base = { proyectos: new Map([["A", { ot: "A" }]]), etapasCodigo: { corte: 1, armado: 4 }, hoy: "2026-10-26",
    piezas: [{ ot: "A", etapa: 1, total: 10, pasaron: 10, primer_paso: "2026-10-23T12:00:00Z", ultimo_paso: "2026-10-23T15:00:00Z" }] };
  const sin = planVivo(items, base).get("A");
  assert.equal(sin.procesos.find((q) => q.etapa === "corte").completo, true);
  const con = planVivo(items, { ...base, retrabajo: new Map([["A|corte", 9]]) }).get("A");
  const corte = con.procesos.find((q) => q.etapa === "corte");
  assert.equal(corte.retrabajo, 9);
  assert.equal(corte.hecho, 100, "el % no baja");
  assert.ok(corte.retrabajoDesde, "dónde empieza la parte roja");
  assert.ok(con.procesos.find((q) => q.etapa === "armado").hasta > sin.procesos.find((q) => q.etapa === "armado").hasta, "Armado se corre");
  assert.equal(sin.procesos.find((q) => q.etapa === "corte").retrabajo, 0);
});

test("/api/data — lo cargan gestión; quién lo cargó sale de la sesión; solo se marca terminado", () => {
  assert.equal(autorizar("retrabajos_ot", "POST", { rol: "gerencial" }).ok, true);
  assert.equal(autorizar("retrabajos_ot", "PATCH", { rol: "administrativo" }).ok, true);
  assert.equal(autorizar("retrabajos_ot", "POST", { rol: "operativo" }).ok, false);
  assert.equal(autorizar("retrabajos_ot", "DELETE", { rol: "gerencial" }).ok, false, "no se borran");
  const r = prepararBodyPost("retrabajos_ot", { ...RT, creado_por: "otro" }, { rol: "gerencial", empleado_id: "e-1" }, null);
  assert.equal(r.body.creado_por, "e-1");
  assert.equal(prepararBodyPost("retrabajos_ot", { ...RT, horas: -1 }, { rol: "gerencial" }, null).status, 400);
  assert.equal(validarPatch("retrabajos_ot", { terminado_nombre: "x" }, { rol: "gerencial" })?.status, 400);
  assert.ok(!validarPatch("retrabajos_ot", { terminado_at: "2026-10-30T12:00:00Z" }, { rol: "gerencial" }));
  assert.match(readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8"), /"retrabajos_ot"/);
  const sql = readFileSync(new URL("../supabase/migrations/147_retrabajos_ot.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /error_diseno/);
});

// Hoy = lunes 26/10/2026: el Corte de la 7100 ya está completo
const PLAN = [{
  id: 1, tipo: "semana", desde: "2026-10-12", hasta: "2026-11-30", confirmado_at: "2026-10-18T12:00:00Z", items: [
    { ot: "7100", etapa: "corte", fecha: "2026-10-26", horas: 6, orden: 0 },
    { ot: "7100", etapa: "armado", fecha: "2026-10-28", horas: 6, orden: 0 },
  ],
}];
const ETAPAS = [{ codigo: 1, nombre: "Corte" }, { codigo: 2, nombre: "Canteado" }, { codigo: 3, nombre: "Mecanizado CNC" }, { codigo: 4, nombre: "Armado" }];
const DIV = [{ id: "M", label: "Muebles", ruta_etapas: [1, 2, 3, 4] }];
const PROYECTOS = [{ id: 1, ot: "7100", cliente: "BCG", division: "M", estado: "activo", fecha_objetivo: "2026-11-30" }];
const PIEZAS = [{ ot: "7100", etapa: 1, total: 10, pasaron: 10, primer_paso: "2026-10-23T12:00:00Z", ultimo_paso: "2026-10-23T15:00:00Z" }];

test("📅 Gantt — 🔁 Retrabajo en un proceso completo: barra roja y ✓ Terminado", async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-26T15:00:00Z") });
  const posts = [], patches = [];
  global.fetch = async (url, opts = {}) => {
    const { method, path, body } = JSON.parse(opts.body || "{}");
    if (method === "POST" && path === "retrabajos_ot") { posts.push(body); return new Response(JSON.stringify({ data: [{ ...body, id: 55 }] }), { status: 200 }); }
    if (method === "PATCH") { patches.push({ path, body }); return new Response(JSON.stringify({ data: [] }), { status: 200 }); }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  const { container } = render(<GanttOt proyectos={PROYECTOS} divisiones={DIV} etapas={ETAPAS} planes={PLAN} cfgValor={null} puedeAjustar usuarioNombre="Tadeo"
    avanceHoras={{ avance: [], horas: new Set(), piezas: PIEZAS }} />);
  await esperar();
  assert.ok(!container.querySelector("[data-retrabajo]"));
  fireEvent.click(screen.getByRole("button", { name: "🔁 Corte de la OT 7100: retrabajo" }));
  let dialogo = screen.getByRole("dialog", { name: "⏱ Corte de la OT 7100" });
  assert.match(dialogo.textContent, /El proceso está al 100 %/);
  assert.ok(!within(dialogo).queryByLabelText("Faltan (horas)"), "completo: solo retrabajo");
  fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
  assert.equal(within(dialogo).getByRole("alert").textContent, "Escribí cuántas horas de retrabajo");
  fireEvent.change(within(dialogo).getByLabelText("Horas de retrabajo"), { target: { value: "2,5" } });
  fireEvent.click(within(dialogo).getByRole("radio", { name: "Canto mal pegado" }));
  fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
  await esperar();
  assert.ok(!screen.queryByRole("dialog"), "se cierra al guardar");
  assert.equal(posts.length, 1);
  assert.deepEqual({ ...posts[0] }, { ot: "7100", etapa: "corte", horas: 2.5, motivo: "canto_mal_pegado", detalle: null, creado_nombre: "Tadeo" });
  assert.ok(container.querySelector('[data-retrabajo="corte"]'), "parte roja de la barra");
  const textos = [...container.querySelectorAll('[data-ot="7100"] svg text')].map((t) => t.textContent);
  assert.ok(textos.some((t) => /🔁 2,5 h/.test(t)), textos.join(" | "));
  // Se marca terminado y la parte roja se va
  fireEvent.click(screen.getByRole("button", { name: "🔁 Corte de la OT 7100: retrabajo" }));
  dialogo = screen.getByRole("dialog", { name: "⏱ Corte de la OT 7100" });
  assert.match(within(dialogo).getByRole("region", { name: "Retrabajos del proceso" }).textContent, /Canto mal pegado/);
  fireEvent.click(within(dialogo).getByRole("button", { name: "✓ Terminado" }));
  await esperar();
  assert.equal(patches[0].path, "retrabajos_ot?id=eq.55");
  assert.ok(patches[0].body.terminado_at);
  assert.ok(!container.querySelector("[data-retrabajo]"), "ya no hay retrabajo pendiente");
  assert.ok(container.querySelector('[data-retrabajo-hecho="corte"]'), "terminado: sigue en rojo hasta cuándo se terminó");
  // Mal cargado: se elimina (pide confirmar) y desaparece del todo
  fireEvent.click(screen.getByRole("button", { name: "🔁 Corte de la OT 7100: retrabajo" }));
  dialogo = screen.getByRole("dialog", { name: "⏱ Corte de la OT 7100" });
  assert.match(within(dialogo).getByRole("region", { name: "Retrabajos del proceso" }).textContent, /✓ terminado/);
  assert.ok(!within(dialogo).queryByRole("button", { name: "✓ Terminado" }));
  fireEvent.click(within(dialogo).getByRole("button", { name: "Eliminar retrabajo de 2,5 h" }));
  assert.match(dialogo.textContent, /¿Eliminar este retrabajo\?/);
  fireEvent.click(within(dialogo).getByRole("button", { name: "Sí, eliminar" }));
  await esperar();
  assert.equal(patches[1].path, "retrabajos_ot?id=eq.55");
  assert.ok(patches[1].body.anulado_at);
  assert.equal(patches[1].body.anulado_nombre, "Tadeo");
  assert.ok(!container.querySelector("[data-retrabajo-hecho]"), "eliminado: no se dibuja");
});

test("planVivo — el retrabajo terminado queda en rojo y la barra llega hasta cuándo se terminó", () => {
  const items = [{ ot: "A", etapa: "corte", fecha: "2026-10-26", horas: 8, orden: 0 }];
  const base = { proyectos: new Map([["A", { ot: "A" }]]), etapasCodigo: { corte: 1 }, hoy: "2026-10-30",
    piezas: [{ ot: "A", etapa: 1, total: 10, pasaron: 10, primer_paso: "2026-10-23T12:00:00Z", ultimo_paso: "2026-10-26T15:00:00Z" }] };
  const sin = planVivo(items, base).get("A").procesos[0];
  assert.equal(sin.hasta, "2026-10-26");
  // Cargado el martes 27 a las 10 y terminado el miércoles 28 a las 12 (Argentina)
  const q = planVivo(items, { ...base, retrabajoHecho: new Map([["A|corte", [{ desde: "2026-10-27T13:00:00Z", hasta: "2026-10-28T15:00:00Z", horas: 6 }]]]) }).get("A").procesos[0];
  assert.equal(q.completo, true);
  assert.equal(q.hasta, "2026-10-28", "la barra se extiende");
  assert.equal(q.fin, 0.5);
  assert.deepEqual(q.hechos.map((h) => [h.fecha, h.frac, h.hastaFecha, h.hastaFrac]), [["2026-10-27", 0.25, "2026-10-28", 0.5]]);
});

test("informe — un retrabajo eliminado no cuenta", () => {
  const r = calcularInforme({ periodo: { tipo: "dia", desde: "2026-10-26", hasta: "2026-10-26" }, etapasCodigo: { corte: 1 },
    retrabajos: [{ ...RT, created_at: "2026-10-26T15:00:00Z", anulado_at: "2026-10-26T16:00:00Z" }] });
  assert.equal(r.retrabajos.length, 0);
  assert.equal(r.resumen.horasRetrabajo, 0);
  const sql = readFileSync(new URL("../supabase/migrations/148_retrabajos_anular.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /anulado_at/);
});

test("informe — horas de retrabajo del período por OT y proceso, sin cambiar la nota; PDF, email y aviso", () => {
  const periodo = { tipo: "dia", desde: "2026-10-26", hasta: "2026-10-26" };
  const base = {
    periodo, etapasCodigo: { corte: 1 },
    items: [{ ot: "7100", etapa: "corte", fecha: "2026-10-26", horas: 8 }],
    pasos: [{ ot: "7100", etapa: 1, created_at: "2026-10-26T14:00:00Z" }],
    piezas: [{ ot: "7100", etapa: 1, total: 1, pasaron: 1 }],
    proyectos: new Map([["7100", { ot: "7100", cliente: "BCG" }]]),
  };
  const sin = calcularInforme(base);
  const r = calcularInforme({ ...base, retrabajos: [
    { ...RT, horas: 2.5, created_at: "2026-10-26T15:00:00Z" },
    { ...RT, motivo: "otros", detalle: "Se mojó", horas: 1, created_at: "2026-10-26T16:00:00Z", terminado_at: "2026-10-26T18:00:00Z" },
    { ...RT, horas: 7, created_at: "2026-10-20T15:00:00Z" },
  ] });
  assert.equal(r.nota, sin.nota, "no cambia la nota");
  assert.equal(r.resumen.horasRetrabajo, 3.5, "solo lo cargado en el período");
  assert.equal(r.ots[0].retrabajo, 3.5);
  assert.deepEqual(r.retrabajos.map((x) => [x.nombre, x.horas, x.motivo, x.terminado]), [["Corte", 2.5, "Pieza mal cortada", false], ["Corte", 1, "Otros: Se mojó", true]]);
  assert.ok(puntosClave(r).some((p) => /🔁 Retrabajo: 3,5 h\. OT 7100 Corte 3,5 h \(Pieza mal cortada, Otros: Se mojó\)/.test(p.texto)));
  assert.match(svgPorOt(r.ots), /🔁 3,5 h/);
  assert.match(htmlInformeProduccion({ empresa: "GI", slug: "gi", informe: r, explicacion: explicacionNota(r) }), /🔁 Retrabajo.*3,5 h: OT 7100 Corte 2,5 h/s);
  assert.match(textoPushInforme(r), /🔁 3,5 h de retrabajo/);
  assert.match(explicacionNota(r), /El retrabajo no cambia la nota/);
  assert.equal(informeVacio({ ots: [], retrabajos: r.retrabajos }), false, "un día solo con retrabajo también tiene informe");
});
