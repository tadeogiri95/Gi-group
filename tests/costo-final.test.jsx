// tests/costo-final.test.jsx — Costo de OT, parte C: costo final al cerrar la
// OT (materiales + costo de la hora × horas-persona) con constancia
// (migración 167), cron de pendientes y 🧾 Costo final en el detalle.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { armarConstancia, separarCostos, htmlConstancia } from "../app/lib/costoFinal.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/costo-final/route.js");
const cron = await import("../app/api/cron/costos-ot/route.js");
const { _limpiarCacheAlcance } = await import("../app/lib/alcance.js");
const { default: CostoFinalOt } = await import("../app/components/CostoFinalOt.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

const materiales = {
  fecha_ot: "2026-04-15", total: 704500, sinPrecio: 1,
  filas: [
    { sku: "C", nombre: "TORNILLO", cantidad: 50, sinPrecio: true, precio: null, subtotal: null },
    { sku: "A", nombre: "MELAMINA", unidad: "PL", cantidad: 10, precio: 70000, subtotal: 700000, fecha: "2026-01-01", origen: "mrp" },
    { sku: "B", nombre: "CANTO", cantidad: 5, precio: 900, precioMoneda: 0.9, moneda: "USD", tipoCambio: 1000, subtotal: 4500, fecha: "2026-03-01", origen: "oc", proveedor: "REHAU" },
  ],
};
const horas = {
  filas: [{ etapa: "corte", nombre: "Corte", presupuestadas: { valor: 4, aMano: false }, reales: { valor: 5, aMano: false } }],
  total: { etapa: "total", nombre: "Total", presupuestadas: { valor: 10, aMano: false }, reales: { valor: 12, aMano: true } },
};

test("constancia — materiales + costo de la hora × horas-persona, con la foto de todo", () => {
  const c = armarConstancia({ materiales, horas, costoHora: 5000 });
  assert.deepEqual([c.materiales, c.horas_persona, c.costo_hora, c.mano_obra, c.total, c.sin_precio], [704500, 12, 5000, 60000, 764500, 1]);
  assert.equal(c.detalle.renglones.length, 3);
  assert.deepEqual(c.detalle.renglones[2], { sku: "B", nombre: "CANTO", unidad: null, cantidad: 5, precio: 900, moneda: "USD", precio_moneda: 0.9, tipo_cambio: 1000, fecha: "2026-03-01", origen: "oc", proveedor: "REHAU", comprobante: null, subtotal: 4500 });
  assert.deepEqual(c.detalle.horas.map((h) => [h.etapa, h.reales.valor, h.reales.aMano]), [["corte", 5, false], ["total", 12, true]]);
  assert.equal(c.detalle.fecha_ot, "2026-04-15");
  assert.match(c.detalle.avisos.join(), /1 artículo sin precio/);
});

test("constancia — sin costo de la hora o sin horas, la mano de obra queda en blanco y avisa", () => {
  const c = armarConstancia({ materiales: { ...materiales, sinPrecio: 0 }, horas: null, costoHora: null });
  assert.equal(c.mano_obra, null);
  assert.equal(c.total, 704500);
  assert.match(c.detalle.avisos.join(" · "), /Sin horas-persona reales · Sin costo de la hora/);
});

test("separar — vigente, pendiente e historial", () => {
  const s = separarCostos([{ id: 3, estado: "pendiente" }, { id: 2, estado: "calculado" }, { id: 1, estado: "anulado" }]);
  assert.deepEqual([s.pendiente.id, s.vigente.id, s.historial.map((h) => h.id)], [3, 2, [1]]);
});

test("hoja de la constancia — resumen, horas y materiales, sin HTML colado", () => {
  const c = { ...armarConstancia({ materiales, horas, costoHora: 5000 }), motivo: "cierre", cerrada_at: "2026-11-08T15:00:00Z", calculado_at: "2026-11-08T15:01:00Z", calculado_por_nombre: "Automático" };
  const html = htmlConstancia({ costo: c, otTexto: "M-7471 · <b>Pérez</b>" });
  assert.match(html, /Constancia de costo final · M-7471 · &lt;b&gt;Pérez&lt;\/b&gt;/);
  assert.match(html, /12 h × \$ 5\.000,00 la hora/);
  assert.match(html, /\$ 764\.500,00/);
  assert.match(html, /sin precio/);
  assert.match(html, /US\$ 0,9 × 1000/);
  assert.match(html, /Al cerrarse la OT/);
});

test("migración 167 — un bloque, disparador al cerrar y reabrir, solo el dueño con su pase, cron sembrado", () => {
  const sql = readFileSync(new URL("../supabase/migrations/167_costos_finales_ot.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /new\.estado = 'cerrado' and old\.estado is distinct from 'cerrado'/);
  assert.match(sql, /set estado = 'anulado'/);
  assert.match(sql, /after update of estado on public\.proyectos/);
  assert.match(sql, /= 'gerencial'/);
  assert.match(sql, /'costos-ot'/);
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/cron/costos-ot"));
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, { ot = "M-7471", body } = {}) => new Request(`http://localhost/api/costo-final${body ? "" : `?ot=${encodeURIComponent(ot)}`}`, {
  method: body ? "POST" : "GET",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
  body: body ? JSON.stringify(body) : undefined,
});

function mockApi({ costos = [], estado = "cerrado", supervisor = false } = {}) {
  const escrito = [];
  let filas = [...costos];
  let sig = 100;
  _limpiarCacheAlcance();
  const vacio = (re) => ({ match: (u) => re.test(u), respond: () => ({ status: 200, body: [] }) });
  global.fetch = createFetchMock([
    { match: (u) => u.includes("select=id,solo_su_division"), respond: () => ({ status: 200, body: [{ id: EMP, solo_su_division: supervisor }] }) },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [{ ot: "M-7471", estado, created_at: "2026-04-15T15:00:00Z" }] }) },
    { match: (u) => u.includes("/rest/v1/necesidades_stock?"), respond: () => ({ status: 200, body: [{ sku: "A", nombre: "MELAMINA", cantidad: 10 }] }) },
    { match: (u) => u.includes("/rest/v1/precios_fijos_ot?"), respond: () => ({ status: 200, body: [{ sku: "A", fecha: "2026-01-01", precio: 70000, precio_ars: 70000, moneda: "ARS", origen: "mrp" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ nombre: "Tadeo" }] }) },
    { match: (u) => u.includes("/rest/v1/costos_empresa?"), respond: () => ({ status: 200, body: [{ costo_hora: 5000 }] }) },
    { match: (u) => u.includes("/rest/v1/horas_ot?"), respond: () => ({ status: 200, body: [{ etapa: "total", reales: 12, presupuestadas: 10 }] }) },
    vacio(/\/rest\/v1\/(movimientos_stock|articulos_stock|etapas|divisiones|config_sistema|v_avance_piezas|avance_etapas|avance_manual_historial|pausas_ot|pasos_pieza|registro_actividades)\?/),
    {
      match: (u) => u.includes("/rest/v1/costos_finales_ot"),
      respond: (u, o) => {
        const metodo = o?.method || "GET";
        if (metodo === "GET") {
          const lista = u.includes("estado=eq.pendiente") ? filas.filter((f) => f.estado === "pendiente") : filas;
          return { status: 200, body: [...lista].sort((a, b) => b.id - a.id) };
        }
        const body = JSON.parse(o.body);
        escrito.push({ metodo, url: u, body });
        if (metodo === "POST") { const f = { id: sig++, ...body }; filas.push(f); return { status: 201, body: [f] }; }
        const id = Number(/id=eq\.(\d+)/.exec(u)[1]);
        const est = /estado=eq\.(\w+)/.exec(u)?.[1];
        const hits = filas.filter((f) => f.id === id && (!est || f.estado === est));
        for (const f of hits) Object.assign(f, body);
        return { status: 200, body: hits };
      },
    },
  ]);
  return { escrito, filas: () => filas };
}

test("/api/costo-final — solo el dueño y el supervisor", async () => {
  const { escrito } = mockApi();
  for (const rol of ["operativo", "administrativo"]) {
    assert.equal((await api.GET(req(await token(rol)))).status, 403, rol);
    assert.equal((await api.POST(req(await token(rol), { body: { accion: "calcular", ot: "M-7471" } }))).status, 403, rol);
  }
  assert.equal(escrito.length, 0);
  mockApi({ supervisor: true });
  assert.equal((await api.GET(req(await token("administrativo")))).status, 200, "supervisor");
});

test("/api/costo-final — al abrir una OT recién cerrada calcula el pendiente con la constancia", async () => {
  const { escrito } = mockApi({ costos: [{ id: 1, empresa_id: E, ot: "M-7471", estado: "pendiente", motivo: "cierre", cerrada_at: "2026-11-08T12:00:00Z" }] });
  const res = await api.GET(req(await token("gerencial")));
  assert.equal(res.status, 200);
  const d = await res.json();
  const patch = escrito.find((w) => w.metodo === "PATCH");
  assert.match(patch.url, /id=eq\.1&.*estado=eq\.pendiente/, "solo si sigue pendiente");
  assert.equal(d.cerrada, true);
  assert.deepEqual([d.vigente.estado, d.vigente.materiales, d.vigente.horas_persona, d.vigente.mano_obra, d.vigente.total, d.vigente.calculado_por_nombre], ["calculado", 700000, 12, 60000, 760000, "Automático"]);
  assert.equal(d.vigente.detalle.renglones[0].precio, 70000);
});

test("/api/costo-final — una OT abierta no se calcula; una cerrada vieja sí, a mano; volver a calcular anula el anterior", async () => {
  mockApi({ estado: "en_curso" });
  const abierta = await api.POST(req(await token("gerencial"), { body: { accion: "calcular", ot: "M-7471" } }));
  assert.equal(abierta.status, 409);

  const { escrito, filas } = mockApi();
  const r1 = await api.POST(req(await token("gerencial"), { body: { accion: "calcular", ot: "M-7471" } }));
  assert.equal(r1.status, 200);
  const d1 = await r1.json();
  assert.deepEqual([d1.vigente.motivo, d1.vigente.calculado_por_nombre, d1.vigente.total], ["manual", "Tadeo", 760000]);

  const r2 = await api.POST(req(await token("gerencial"), { body: { accion: "recalcular", ot: "M-7471" } }));
  const d2 = await r2.json();
  assert.equal(d2.vigente.motivo, "recalculo");
  assert.equal(d2.vigente.cerrada_at, d1.vigente.cerrada_at, "mantiene la fecha de cierre");
  assert.equal(d2.historial.length, 1);
  assert.match(d2.historial[0].anulado_motivo, /Se volvió a calcular \(Tadeo\)/);
  assert.equal(filas().filter((f) => f.estado === "calculado").length, 1);
  assert.equal(escrito.filter((w) => w.metodo === "POST").length, 2);
});

test("cron/costos-ot — pide la clave y calcula los pendientes", async () => {
  process.env.CRON_SECRET = "secreto";
  const { filas } = mockApi({ costos: [{ id: 1, empresa_id: E, ot: "M-7471", estado: "pendiente", motivo: "cierre", cerrada_at: "2026-11-08T12:00:00Z" }] });
  assert.equal((await cron.GET(new Request("http://localhost/api/cron/costos-ot"))).status, 401);
  const res = await cron.GET(new Request("http://localhost/api/cron/costos-ot", { headers: { authorization: "Bearer secreto" } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, pendientes: 1, calculados: 1, errores: 0 });
  assert.equal(filas()[0].estado, "calculado");
});

// ─── Pantalla ───

test("detalle — 🧾 Costo final con materiales, mano de obra, avisos e historial", async () => {
  const vigente = { id: 2, ...armarConstancia({ materiales, horas, costoHora: 5000 }), estado: "calculado", motivo: "cierre", cerrada_at: "2026-11-08T15:00:00Z", calculado_at: "2026-11-08T15:01:00Z", calculado_por_nombre: "Automático" };
  global.fetch = async () => Response.json({ ok: true, ot: "M-7471", cerrada: true, vigente, historial: [{ id: 1, estado: "anulado", total: 500000, cerrada_at: "2026-10-01T15:00:00Z", anulado_at: "2026-10-02T15:00:00Z", anulado_motivo: "Se reabrió la OT" }] });
  render(<CostoFinalOt proyecto={{ ot: "M-7471", estado: "cerrado" }} />);
  await waitFor(() => screen.getByText("$ 764.500"));
  assert.ok(screen.getByText("Materiales: $ 704.500"));
  assert.ok(screen.getByText(/Mano de obra: 12 h × \$ 5\.000 la hora = \$ 60\.000/));
  assert.ok(screen.getByText(/1 artículo sin precio/));
  assert.ok(screen.getByText("🔄 Volver a calcular"));
  fireEvent.click(screen.getByText(/Ver historial \(1\)/));
  assert.ok(screen.getByText(/Se reabrió la OT/));
});

test("detalle — OT abierta: se calcula sola al cerrar; cerrada vieja: botón para calcular", async () => {
  global.fetch = async () => Response.json({ ok: true, ot: "M-1", cerrada: false, vigente: null, historial: [] });
  render(<CostoFinalOt proyecto={{ ot: "M-1", estado: "en_curso" }} />);
  await waitFor(() => screen.getByText(/Se calcula solo cuando se cierre la OT/));
  cleanup();
  global.fetch = async () => Response.json({ ok: true, ot: "M-2", cerrada: true, vigente: null, historial: [] });
  render(<CostoFinalOt proyecto={{ ot: "M-2", estado: "cerrado" }} />);
  await waitFor(() => screen.getByText("🧾 Calcular costo final"));
  const detalle = readFileSync(new URL("../app/components/DetalleOp.jsx", import.meta.url), "utf8");
  assert.match(detalle, /\{verCostos && <CostoFinalOt proyecto=\{proyecto\} \/>\}/);
});
