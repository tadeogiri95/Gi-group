// tests/historial-ot.test.jsx — Quién cambió qué en cada OT y cuándo (Tadeo, 02/11)
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  filasDeCambio, filaDeAvance, describirCambio, cambiosAnteriores, armarHistorial, cambioDeAudit, ACCION_CAMBIO_OT,
} from "../app/lib/historialOt.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const sesion = { empresa_id: E, empleado_id: EMP, legajo: 7, rol: "gerencial" };
const etapa = (c) => ({ 1: "Corte", 4: "Armado" })[c] || `etapa ${c}`;

test("registro — una edición de OT guarda quién, la OT, lo que cambió y cómo estaba", () => {
  const filas = filasDeCambio({
    tabla: "proyectos", metodo: "PATCH", body: { prioridad: 2, empresa_id: E },
    filas: [{ id: 5, ot: "7751", prioridad: 2 }], antes: [{ id: 5, prioridad: 7 }], sesion,
  });
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0], {
    empresa_id: E, actor_id: EMP, actor_legajo: 7, actor_rol: "gerencial", accion: ACCION_CAMBIO_OT,
    entidad: "proyectos", entidad_id: "7751", datos_antes: { prioridad: 7 }, datos_despues: { metodo: "PATCH", id: 5, campos: { prioridad: 2 } },
  });
  // Cerrar en lote: una fila por OT
  assert.equal(filasDeCambio({ tabla: "proyectos", metodo: "PATCH", body: { estado: "cerrado" }, filas: [{ id: 1, ot: "1" }, { id: 2, ot: "2" }], sesion }).length, 2);
  // Tablas sin OT o lecturas no se registran
  assert.deepEqual(filasDeCambio({ tabla: "empleados", metodo: "PATCH", body: {}, filas: [{ id: 1 }], sesion }), []);
  assert.deepEqual(filasDeCambio({ tabla: "proyectos", metodo: "GET", filas: [{ id: 1, ot: "1" }], sesion }), []);
  assert.equal(filaDeAvance({ sesion, ot: "7751", accion: "aprobar", etapa: 4 }).datos_despues.accion, "aprobar");
});

test("textos — avance, demoras, retrabajos, edición, cierre y firmas", () => {
  const d = (c) => describirCambio(c, etapa);
  assert.equal(d({ tabla: "proyectos", metodo: "PATCH", campos: { avance_manual: { activo: true, etapas: { 1: 100, 4: 40 } } } }), "Cargó avance manual: Corte 100 % · Armado 40 %");
  assert.equal(d({ tabla: "proyectos", metodo: "PATCH", campos: { estado: "cerrado" } }), "Cerró la OT");
  assert.equal(d({ tabla: "proyectos", metodo: "PATCH", campos: { estado: "activo" } }), "Reactivó la OT");
  assert.equal(d({ tabla: "proyectos", metodo: "PATCH", campos: { prioridad: 2 }, antes: { prioridad: 7 } }), "Cambió prioridad de 7 a 2");
  assert.equal(d({ tabla: "proyectos", metodo: "PATCH", campos: { cliente: "PRANA", fecha_entrega: "2026-11-20" } }), "Cambió cliente: PRANA · entrega: 2026-11-20");
  assert.equal(d({ tabla: "ajustes_tiempo_ot", metodo: "POST", campos: { etapa: "corte", tipo: "faltan", horas: 2.5, motivo: "falla_maquina" } }), "Cargó demora en Corte: Faltan 2,5 h · Falla de máquina");
  assert.equal(d({ tabla: "retrabajos_ot", metodo: "POST", campos: { etapa: "armado", horas: 3, motivo: "error_medida", detalle: "puerta" } }), "Cargó retrabajo de 3 h en Armado · Error de medida o plano · puerta");
  assert.equal(d({ tabla: "retrabajos_ot", metodo: "PATCH", campos: { anulado_at: "x" } }), "Eliminó un retrabajo");
  assert.equal(d({ tabla: "avance_etapas", accion: "aprobar", campos: { etapa: 4 } }), "Firmó el cierre de la etapa Armado");
  assert.equal(d({ tabla: "avance_etapas", accion: "liberar", campos: {} }), "Liberó la OT");
  assert.equal(d({ tabla: "avance_manual", campos: { etapa: 1, pct: 60 } }), "Cargó avance manual: Corte 60 %");
});

test("historial — junta lo registrado con lo anterior, pone nombres y ordena de lo más nuevo a lo más viejo", () => {
  const desde = "2026-11-02T10:00:00Z";
  const anteriores = cambiosAnteriores({
    ajustes: [{ created_at: "2026-10-30T12:00:00Z", creado_nombre: "Ana", etapa: "corte", tipo: "faltan", horas: 1, motivo: "otros" }],
    retrabajos: [{ created_at: "2026-10-29T12:00:00Z", creado_nombre: "Luis", horas: 2, etapa: "armado", motivo: "otros", terminado_at: "2026-10-31T09:00:00Z", terminado_nombre: "Ana" }],
    manual: [{ created_at: "2026-10-28T12:00:00Z", creado_por: EMP, etapa: 1, pct: 50 }, { created_at: "2026-11-02T11:00:00Z", creado_por: EMP, etapa: 1, pct: 80 }],
    etapas: [{ etapa: 4, estado: "aprobada", terminada_at: "2026-10-31T10:00:00Z", terminada_por: "otro", aprobada_at: "2026-10-31T11:00:00Z", aprobada_por: EMP }],
    desde,
  });
  // El avance manual del 2/11 11:00 ya está en el registro: no se repite
  assert.equal(anteriores.filter((c) => c.tabla === "avance_manual").length, 1);
  const audit = cambioDeAudit({ created_at: "2026-11-02T12:00:00Z", actor_id: EMP, entidad: "proyectos", datos_despues: { metodo: "PATCH", campos: { estado: "cerrado" } } });
  const h = armarHistorial([...anteriores, audit], [{ id: EMP, nombre: "Tadeo" }]);
  assert.equal(h[0].nombre, "Tadeo");
  assert.equal(describirCambio(h[0], etapa), "Cerró la OT");
  assert.deepEqual(h.map((c) => c.at), [...h.map((c) => c.at)].sort().reverse());
  assert.equal(h.find((c) => c.tabla === "avance_etapas" && c.accion === "terminar").nombre, "Usuario dado de baja");
  assert.ok(h.some((c) => c.nombre === "Ana" && c.campos.terminado_at));
});

// ─── /api/data deja el registro ───

const { signAccessToken } = await import("../app/lib/jwt.ts");
const data = await import("../app/api/data/route.js");
const historial = await import("../app/api/historial-ot/route.js");

async function token(rol = "gerencial") {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

test("/api/data — al editar una OT queda en audit_log quién, cuándo, qué y cómo estaba", async () => {
  const audit = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/audit_log") && o.method === "POST", respond: (u, o) => { audit.push(...JSON.parse(o.body)); return { status: 201 }; } },
    { match: (u, o) => u.includes("/rest/v1/proyectos") && (!o.method || o.method === "GET"), respond: () => ({ body: [{ id: 5, prioridad: 7 }] }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos") && o.method === "PATCH", respond: () => ({ body: [{ id: 5, ot: "7751", prioridad: 2 }] }) },
  ]);
  const r = await data.POST(new Request("http://localhost/api/data", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ method: "PATCH", path: "proyectos?id=eq.5", body: { prioridad: 2 } }),
  }));
  assert.equal(r.status, 200);
  await waitFor(() => assert.equal(audit.length, 1));
  assert.equal(audit[0].entidad_id, "7751");
  assert.equal(audit[0].actor_id, EMP);
  assert.deepEqual(audit[0].datos_antes, { prioridad: 7 });
  assert.equal(audit[0].datos_despues.campos.prioridad, 2);
});

test("/api/historial-ot — solo gestión; trae los cambios de la OT con nombre", async () => {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/audit_log") && u.includes("entidad_id=eq.7751"), respond: (u) => { pedidos.push(u); return { body: [{ created_at: "2026-11-02T12:00:00Z", actor_id: EMP, entidad: "proyectos", datos_despues: { metodo: "PATCH", campos: { estado: "cerrado" } } }] }; } },
    { match: (u) => u.includes("/rest/v1/audit_log"), respond: () => ({ body: [{ created_at: "2026-11-02T10:00:00Z" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ body: [{ id: EMP, nombre: "Tadeo" }] }) },
    { match: (u) => u.includes("/rest/v1/ajustes_tiempo_ot"), respond: () => ({ body: [{ created_at: "2026-10-30T12:00:00Z", creado_nombre: "Ana", etapa: "corte", tipo: "faltan", horas: 1, motivo: "otros" }] }) },
    { match: (u) => u.includes("/rest/v1/"), respond: () => ({ body: [] }) },
  ]);
  const get = async (rol) => historial.GET(new Request("http://localhost/api/historial-ot?ot=7751", { headers: { Authorization: `Bearer ${await token(rol)}` } }));
  assert.equal((await get("operativo")).status, 403);
  const r = await get("gerencial");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.cambios.map((c) => [c.nombre, c.tabla]), [["Tadeo", "proyectos"], ["Ana", "ajustes_tiempo_ot"]]);
  assert.ok(pedidos[0].includes(`empresa_id=eq.${E}`), "siempre filtrado por la empresa de la sesión");
});

// ─── Pantalla ───

const { default: HistorialOt, diaHora } = await import("../app/components/HistorialOt.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");

test("detalle de OT — 🕓 Historial de cambios muestra qué, quién y a qué hora", async () => {
  global.fetch = async (url) => {
    assert.match(String(url), /\/api\/historial-ot\?ot=7751/);
    return new Response(JSON.stringify({ ok: true, cambios: [{ at: "2026-11-02T11:45:00Z", nombre: "Tadeo", tabla: "proyectos", metodo: "PATCH", campos: { prioridad: 2 }, antes: { prioridad: 7 } }] }), { status: 200 });
  };
  render(<AuthContext.Provider value={{ usuario: { rol: "gerencial" } }}><HistorialOt ot="7751" etapas={[]} /></AuthContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: /Historial de cambios/ }));
  await screen.findByText("Cambió prioridad de 7 a 2");
  assert.ok(screen.getByText(`Tadeo · ${diaHora("2026-11-02T11:45:00Z")}`));
  assert.match(diaHora("2026-11-02T11:45:00Z"), /02\/11\/26.*08:45/);
});

test("detalle de OT — el operario no ve el historial", () => {
  render(<AuthContext.Provider value={{ usuario: { rol: "operativo" } }}><HistorialOt ot="7751" /></AuthContext.Provider>);
  assert.equal(screen.queryByRole("button", { name: /Historial de cambios/ }), null);
});
