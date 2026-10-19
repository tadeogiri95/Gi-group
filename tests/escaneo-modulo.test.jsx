// tests/escaneo-modulo.test.jsx — Escaneo de la etiqueta de módulo (Armado):
// al escanearla en una etapa pasan todas las piezas de ese módulo juntas, y
// así el Armado suma al % de producción por escaneo.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { textoQrModulo, leerQrModulo, leerQrPieza, modulosConPiezas, htmlEtiquetasModulos, mensajeEscaneo } from "../app/lib/piezas.js";
import { pasoPiezaBody } from "../app/lib/schemas.ts";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/piezas/paso/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const OTRO = "33333333-3333-3333-3333-333333333333";
const ETAPAS = [{ codigo: 1, nombre: "Corte", por_pieza: true }, { codigo: 4, nombre: "Armado", por_pieza: true }];

// ─── QR y etiquetas ───

test("QR de módulo — se escribe y se lee, y no se confunde con el de pieza", () => {
  const t = textoQrModulo("M-7495", "M.izq");
  assert.equal(t, "OT M-7495 - MODULO - M.izq");
  assert.deepEqual(leerQrModulo(t), { ot: "M-7495", modulo: "M.izq" });
  assert.deepEqual(leerQrModulo("ot 7495 - modulo - Bast TV "), { ot: "7495", modulo: "Bast TV" });
  assert.equal(leerQrModulo("OT M-7495 - PIEZA - 12"), null);
  assert.equal(leerQrPieza(t), null);
});

test("modulosConPiezas — un módulo por nombre con su cantidad; las sueltas no llevan etiqueta", () => {
  assert.deepEqual(modulosConPiezas([{ modulo: "M2" }, { modulo: "M10" }, { modulo: "M2" }, { modulo: null }]), [{ modulo: "M2", piezas: 2 }, { modulo: "M10", piezas: 1 }]);
});

test("htmlEtiquetasModulos — una página por módulo con su QR y el nombre escapado", async () => {
  const html = await htmlEtiquetasModulos({ empresa: "GI", ot: "7495", modulos: [{ modulo: "M<1>", piezas: 3 }, { modulo: "M2", piezas: 1 }], tamano: { ancho: 50, alto: 30 } });
  assert.equal((html.match(/class="etiqueta"/g) || []).length, 2);
  assert.ok(html.includes("M&lt;1&gt;"));
  assert.ok(html.includes("1 de 2 · 3 piezas"));
  assert.ok(html.includes("<svg"));
});

test("mensajeEscaneo — módulo listo, ya escaneado o que no pasa por la etapa", () => {
  const base = { ok: true, etapa: 4, etapaNombre: "Armado", progreso: { pasaron: 8, total: 20 } };
  const nombres = { 4: "Armado" };
  assert.deepEqual(mensajeEscaneo({ ...base, ya: false, modulo: { ot: "7495", nombre: "M1", piezas: 8, nuevas: 8, requeridas: 8 } }, nombres),
    { tono: "verde", texto: "Módulo M1 listo en Armado: 8 piezas.", detalle: "Armado: 8 de 20 piezas de la OT 7495." });
  assert.equal(mensajeEscaneo({ ...base, ya: true, modulo: { ot: "7495", nombre: "M1", nuevas: 0, requeridas: 8 } }, nombres).tono, "amarillo");
  assert.match(mensajeEscaneo({ ...base, ya: false, modulo: { ot: "7495", nombre: "M1", nuevas: 2, requeridas: 0 } }, nombres).texto, /no pasan por esa etapa/);
});

test("pasoPiezaBody — deshacer_modulo pide OT, módulo y etapa", () => {
  assert.equal(pasoPiezaBody.safeParse({ accion: "deshacer_modulo", ot: "7495", modulo: "M1", etapa: 4 }).success, true);
  assert.equal(pasoPiezaBody.safeParse({ accion: "deshacer_modulo", ot: "7495", etapa: 4 }).success, false);
});

// ─── Servidor ───

const token = async (rol = "operativo", empleadoId = EMP) => (await signAccessToken({ empleadoId, empresaId: E, legajo: 7, rol })).token;
const req = (body, t) => new Request("http://localhost/api/piezas/paso", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
});

const PIEZAS_M1 = [{ id: 10, ot: "M-7495", etapas: [1, 4] }, { id: 11, ot: "M-7495", etapas: [1, 4] }, { id: 12, ot: "M-7495", etapas: [1] }];

function mock({ piezas = PIEZAS_M1, hechos = [], total = 30, pasaron = 30, pasosModulo = [] } = {}) {
  const escrito = [];
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [{ ot: "M-7495" }] }) },
    { match: (u) => u.includes("/rest/v1/etapas?"), respond: (u) => ({ status: 200, body: ETAPAS.filter((e) => e.codigo === Number(u.match(/codigo=eq\.(\d+)/)?.[1])) }) },
    {
      match: (u, o) => u.includes("/rest/v1/piezas_ot?") && (!o?.method || o.method === "GET"),
      respond: (u) => {
        pedidos.push(decodeURIComponent(u));
        if (u.includes("etapas=cs.")) return { status: 200, body: [{ id: 1 }], headers: { "content-range": `0-0/${total}` } };
        return { status: 200, body: piezas };
      },
    },
    {
      match: (u, o) => u.includes("/rest/v1/pasos_pieza") && (!o?.method || o.method === "GET"),
      respond: (u) => {
        if (u.includes("requerida=eq.true")) return { status: 200, body: [{ id: 1 }], headers: { "content-range": `0-0/${pasaron}` } };
        if (u.includes("select=id,empleado_id,created_at")) return { status: 200, body: pasosModulo };
        return { status: 200, body: hechos.map((id) => ({ pieza_id: id })) };
      },
    },
    { match: (u, o) => u.includes("/rest/v1/avance_etapas") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u, o) => /\/rest\/v1\/(pasos_pieza|avance_etapas)/.test(u) && ["POST", "PATCH", "DELETE"].includes(o?.method),
      respond: (u, o) => { escrito.push({ metodo: o.method, url: decodeURIComponent(u), body: o.body ? JSON.parse(o.body) : null }); return { status: 201, body: [] }; },
    },
  ]);
  return { escrito, pedidos };
}

test("/api/piezas/paso — escanear un módulo anota todas sus piezas que faltaban, de una vez", async () => {
  const { escrito, pedidos } = mock({ hechos: [11], total: 30, pasaron: 12 });
  const res = await api.POST(req({ accion: "escanear", codigo: "OT M-7495 - MODULO - M1", etapa: 4 }, await token()));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.modulo, { ot: "M-7495", nombre: "M1", piezas: 3, nuevas: 2, requeridas: 2 });
  assert.deepEqual(data.progreso, { pasaron: 12, total: 30 });
  assert.equal(data.etapaTerminada, null);
  assert.ok(pedidos.some((u) => u.includes("ot=eq.M-7495&modulo=eq.M1")));
  const post = escrito.find((x) => x.url.includes("pasos_pieza?on_conflict=pieza_id,etapa"));
  assert.deepEqual(post.body.map((p) => [p.pieza_id, p.requerida, p.etapa, p.empleado_id]), [[10, true, 4, EMP], [12, false, 4, EMP]]);
});

test("/api/piezas/paso — el último módulo termina la etapa; repetir el escaneo no anota nada", async () => {
  let { escrito } = mock({ total: 30, pasaron: 30 });
  let data = await (await api.POST(req({ accion: "escanear", codigo: "OT M-7495 - MODULO - M1", etapa: 4 }, await token()))).json();
  assert.deepEqual(data.etapaTerminada, { codigo: 4, nombre: "Armado" });
  assert.ok(escrito.some((x) => x.url.includes("avance_etapas") && x.body.estado === "terminada"));

  ({ escrito } = mock({ hechos: [10, 11, 12] }));
  data = await (await api.POST(req({ accion: "escanear", codigo: "OT M-7495 - MODULO - M1", etapa: 4 }, await token()))).json();
  assert.equal(data.ya, true);
  assert.equal(escrito.length, 0);
});

test("/api/piezas/paso — módulo sin piezas en la OT", async () => {
  mock({ piezas: [] });
  const res = await api.POST(req({ accion: "escanear", codigo: "OT M-7495 - MODULO - M9", etapa: 4 }, await token()));
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /M9 no tiene piezas/);
});

test("/api/piezas/paso — deshacer_modulo: el operario borra solo sus escaneos recientes; gestión todos", async () => {
  const ahora = new Date().toISOString();
  const viejo = new Date(Date.now() - 2 * 3600000).toISOString();
  const pasosModulo = [{ id: 1, empleado_id: EMP, created_at: ahora }, { id: 2, empleado_id: EMP, created_at: viejo }, { id: 3, empleado_id: OTRO, created_at: ahora }];
  let { escrito } = mock({ pasosModulo });
  let res = await api.POST(req({ accion: "deshacer_modulo", ot: "M-7495", modulo: "M1", etapa: 4 }, await token()));
  assert.equal(res.status, 200);
  assert.match(escrito.find((x) => x.metodo === "DELETE").url, /id=in\.\(1\)$/);

  ({ escrito } = mock({ pasosModulo: [{ id: 3, empleado_id: OTRO, created_at: ahora }] }));
  res = await api.POST(req({ accion: "deshacer_modulo", ot: "M-7495", modulo: "M1", etapa: 4 }, await token()));
  assert.equal(res.status, 403);

  ({ escrito } = mock({ pasosModulo }));
  res = await api.POST(req({ accion: "deshacer_modulo", ot: "M-7495", modulo: "M1", etapa: 4 }, await token("gerencial")));
  assert.match(escrito.find((x) => x.metodo === "DELETE").url, /id=in\.\(1,2,3\)$/);
});
