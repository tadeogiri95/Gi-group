// tests/horas-ot.test.jsx — Costo de OT, parte E: horas-persona
// presupuestadas (Gantt o a mano) contra reales (escaneos sin pausas ×
// operarios, o a mano); migración 166.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { presupuestoAutomatico, realesAutomaticas, tablaHoras, textoHoras } from "../app/lib/horasOt.js";
import { normalizarParametros } from "../app/lib/planificacion.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/horas-ot/route.js");
const { horasDeOt } = await import("../app/lib/horasOtServidor.js");
const { default: HorasOt } = await import("../app/components/HorasOt.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

const CFG = { min_placa: 6, min_metro_canto: 1, min_mecanizado: 3, min_armado_gabinete: 60, eficiencia: 80, personas_canteadora: 1, etapas: { corte: 1, canteado: 2, mecanizado: 3, armado: 4 } };
const PROYECTO = { ot: "M-1", placas: 10, fondos: 0, metros_canto: 100, placas_mecanizadas: 20, total_modulos: 5, descripcion: "COCINA", created_at: "2026-11-02T12:00:00Z" };

test("presupuesto automático — la estimación del Gantt en horas-persona, con la eficiencia", () => {
  const p = presupuestoAutomatico(PROYECTO, normalizarParametros(CFG));
  // corte 10 placas × 6 min = 1 h; canteado 100 m × 1 min; mecanizado 20 × 3; armado 5 × 60; ÷ 0,8
  assert.deepEqual(p, { corte: 1.3, canteado: 2.1, mecanizado: 1.3, armado: 6.3 });
  assert.equal(presupuestoAutomatico({ ot: "X" }, normalizarParametros(CFG)), null, "sin placas, cantos ni mecanizados: va a mano");
});

test("reales automáticas — horas del proceso × operarios distintos, más tareas viejas", () => {
  const r = realesAutomaticas({
    etapasCodigo: { corte: 1, canteado: 2, mecanizado: 3, armado: 4 },
    leadTime: { procesos: [{ etapa: "corte", horas: 3, fin: "x" }, { etapa: "armado", horas: null, lleva: 2.5 }, { etapa: "canteado", horas: 1 }] },
    pasos: [{ etapa: "1", empleado_id: "a" }, { etapa: "1", empleado_id: "b" }, { etapa: "1", empleado_id: "a" }, { etapa: "4", empleado_id: "c" }],
    manual: [{ etapa: 4, pct: 50, creado_por: "d" }, { etapa: 4, pct: 0, creado_por: "e" }],
    tareasMin: { 3: 90 },
  });
  assert.deepEqual([r.corte.total, r.corte.personas, r.corte.terminado], [6, 2, true], "3 h × 2 personas");
  assert.deepEqual([r.armado.total, r.armado.personas, r.armado.terminado], [5, 2, false], "sigue: 2,5 h hasta ahora × 2");
  assert.equal(r.canteado.total, 1, "sin saber quién: 1 persona");
  assert.deepEqual([r.mecanizado.horas, r.mecanizado.total], [null, 1.5], "solo tareas viejas");
});

test("tabla — a mano gana al automático; total = suma o el total a mano; diferencia y %", () => {
  const t = tablaHoras({
    presupuesto: { corte: 2, canteado: 2, mecanizado: 1, armado: 5 },
    reales: { corte: { total: 3 }, armado: { total: 4 } },
    manuales: [{ etapa: "canteado", reales: 1.5, cambiado_por_nombre: "Tadeo" }, { etapa: "armado", presupuestadas: 6 }],
  });
  const f = Object.fromEntries(t.filas.map((x) => [x.etapa, x]));
  assert.deepEqual([f.corte.diferencia, f.corte.pct], [1, 150]);
  assert.deepEqual([f.canteado.reales.valor, f.canteado.reales.aMano, f.canteado.cambiadoPor], [1.5, true, "Tadeo"]);
  assert.deepEqual([f.armado.presupuestadas.valor, f.armado.presupuestadas.auto, f.armado.pct], [6, 5, 67]);
  assert.equal(f.mecanizado.reales.valor, null);
  assert.deepEqual([t.total.presupuestadas.valor, t.total.reales.valor], [11, 8.5]);
  const conTotal = tablaHoras({ presupuesto: { corte: 2 }, reales: {}, manuales: [{ etapa: "total", presupuestadas: 40 }] });
  assert.deepEqual([conTotal.total.presupuestadas.valor, conTotal.total.presupuestadas.aMano], [40, true]);
  assert.equal(textoHoras(12.5), "12,5 h");
  assert.equal(textoHoras(null), "—");
});

test("migración 166 — un bloque, por OT y proceso, solo el servidor escribe", () => {
  const sql = readFileSync(new URL("../supabase/migrations/166_horas_ot.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /primary key \(empresa_id, ot, etapa\)/);
  assert.match(sql, /'corte', 'canteado', 'mecanizado', 'armado', 'total'/);
  assert.match(sql, /grant select on public\.horas_ot to authenticated;/);
});

// ─── Servidor ───

function mockServidor({ manuales = [] } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [PROYECTO] }) },
    { match: (u) => u.includes("/rest/v1/etapas?"), respond: () => ({ status: 200, body: [1, 2, 3, 4].map((c) => ({ codigo: c, nombre: ["Corte", "Canteado", "Mecanizado", "Armado"][c - 1] })) }) },
    { match: (u) => u.includes("/rest/v1/config_sistema?"), respond: () => ({ status: 200, body: [{ valor: CFG }] }) },
    {
      match: (u) => u.includes("/rest/v1/v_avance_piezas?"),
      respond: () => ({ status: 200, body: [{ ot: "M-1", etapa: 1, total: 10, pasaron: 10, primer_paso: "2026-11-02T11:00:00Z", ultimo_paso: "2026-11-02T14:00:00Z" }] }),
    },
    // Pausa de 9 a 10 (hora argentina): no cuenta
    { match: (u) => u.includes("/rest/v1/pausas_ot?"), respond: () => ({ status: 200, body: [{ ot: "M-1", desde: "2026-11-02T12:00:00Z", hasta: "2026-11-02T13:00:00Z" }] }) },
    { match: (u) => u.includes("/rest/v1/pasos_pieza?"), respond: () => ({ status: 200, body: [{ etapa: "1", empleado_id: "a" }, { etapa: "1", empleado_id: "b" }] }) },
    { match: (u) => u.includes("/rest/v1/horas_ot?") && (!u.includes("on_conflict")), respond: () => ({ status: 200, body: manuales }) },
    {
      match: (u, o) => u.includes("/rest/v1/horas_ot?on_conflict"),
      respond: (u, o) => { escrito.push({ url: u, body: JSON.parse(o.body), prefer: o.headers?.Prefer }); return { status: 201, body: null }; },
    },
    { match: (u) => u.includes("/rest/v1/empleados?id=eq."), respond: () => ({ status: 200, body: [{ nombre: "Tadeo" }] }) },
    { match: (u) => /\/rest\/v1\/(divisiones|empleados|avance_etapas|avance_manual_historial|registro_actividades)\?/.test(u), respond: () => ({ status: 200, body: [] }) },
  ]);
  return escrito;
}

test("horas de la OT — presupuesto del Gantt contra escaneos sin la pausa, por 2 operarios", async () => {
  mockServidor();
  const d = await horasDeOt(E, "M-1", { ahora: new Date("2026-11-05T12:00:00Z") });
  const corte = d.filas.find((f) => f.etapa === "corte");
  // de 8 a 11 hora argentina menos 1 h de pausa = 2 h de proceso × 2 operarios
  assert.equal(corte.detalle.horas, 2);
  assert.equal(corte.reales.valor, 4);
  assert.equal(corte.presupuestadas.valor, 1.3);
  assert.equal(d.sinGantt, false);
});

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body) => new Request(`http://localhost/api/horas-ot${body ? "" : "?ot=M-1"}`, {
  method: body ? "POST" : "GET",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
  body: body ? JSON.stringify(body) : undefined,
});

test("/api/horas-ot — el operario no; gestión lee y escribe a mano (null vuelve al automático)", async () => {
  let escrito = mockServidor();
  assert.equal((await api.GET(req(await token("operativo")))).status, 403);
  assert.equal((await api.POST(req(await token("operativo"), { ot: "M-1", etapa: "corte", campo: "reales", valor: 3 }))).status, 403);
  const get = await api.GET(req(await token("administrativo")));
  assert.equal(get.status, 200);
  assert.equal((await get.json()).filas.length, 4);

  const ok = await api.POST(req(await token("gerencial"), { ot: "M-1", etapa: "total", campo: "presupuestadas", valor: 40.25 }));
  assert.equal(ok.status, 200);
  assert.deepEqual([escrito[0].body.etapa, escrito[0].body.presupuestadas, escrito[0].body.cambiado_por_nombre], ["total", 40.3, "Tadeo"]);
  assert.ok(!("reales" in escrito[0].body), "no toca el otro número");
  assert.match(escrito[0].prefer, /merge-duplicates/);

  escrito = mockServidor();
  await api.POST(req(await token("gerencial"), { ot: "M-1", etapa: "corte", campo: "reales", valor: null }));
  assert.equal(escrito[0].body.reales, null);
  for (const malo of [{ ot: "M-1", etapa: "pintura", campo: "reales", valor: 1 }, { ot: "M-1", etapa: "corte", campo: "precio", valor: 1 }, { ot: "M-1", etapa: "corte", campo: "reales", valor: -1 }, { ot: "M-1", etapa: "corte", campo: "reales", valor: "3" }]) {
    assert.equal((await api.POST(req(await token("gerencial"), malo))).status, 400, JSON.stringify(malo));
  }
});

// ─── Pantalla ───

test("detalle — ⏱ tabla con 🤖/✏, diferencia, % y el total", async () => {
  const lado = (valor, aMano = false, auto = valor) => ({ valor, aMano, auto });
  global.fetch = async () => Response.json({
    ok: true, sinGantt: false,
    filas: [
      { etapa: "corte", nombre: "Corte", presupuestadas: lado(2), reales: lado(3), diferencia: 1, pct: 150, detalle: { horas: 1.5, personas: 2, tareas: 0, terminado: true } },
      { etapa: "armado", nombre: "Armado", presupuestadas: lado(6, true, 5), reales: lado(4), diferencia: -2, pct: 67, cambiadoPor: "Tadeo", detalle: null },
    ],
    total: { etapa: "total", nombre: "Total", presupuestadas: lado(8), reales: lado(7), diferencia: -1, pct: 88 },
  });
  render(<HorasOt ot="M-1" />);
  await waitFor(() => screen.getByText("Corte"));
  const items = screen.getAllByRole("listitem");
  assert.match(items[0].textContent, /150 %.*🤖 2 h.*🤖 3 h.*\+1 h.*1,5 h de proceso × 2 personas/);
  assert.match(items[1].textContent, /✏ 6 h.*✏ por Tadeo/);
  assert.ok(screen.getByLabelText("Volver al automático: horas presupuestadas de Armado"));
  assert.match(items[2].textContent, /Total.*88 %/);
  const detalle = readFileSync(new URL("../app/components/DetalleOp.jsx", import.meta.url), "utf8");
  assert.match(detalle, /\{puedeCambiarSemana && <HorasOt ot=\{proyecto\?\.ot\} \/>\}/);
});
