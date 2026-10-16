// tests/piezas-escaneo.test.jsx — Órdenes de Producción, parte 18: el
// operario escanea cada pieza en Corte, Canto, CNC y Corte especial; cuando
// pasan todas, la etapa de la OT queda terminada (falta la firma).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  etapasSalteadas, avancePiezas, textoAvancePiezas, mensajeEscaneo, reglasPieza, nombresEtapas,
} from "../app/lib/piezas.js";
import { pasoPiezaBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* sin almacenamiento */ } });

const { default: EscanearPiezas } = await import("../app/components/EscanearPiezas.jsx");
const { default: PiezasOt } = await import("../app/components/PiezasOt.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/piezas/paso/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const OTRO = "33333333-3333-3333-3333-333333333333";

// Etapas como las del mapa de procesos de la fábrica; las cuatro primeras se
// escanean por pieza (Configuración → Etapas, migración 112)
const ETAPAS = [
  { id: "e1", codigo: 1, nombre: "Corte", orden: 1, por_pieza: true, icon: "🪚" },
  { id: "e2", codigo: 2, nombre: "Canto", orden: 2, por_pieza: true, columna_pieza: "Canto, L1A, L1B, L2A, L2B", icon: "Hammer" },
  { id: "e3", codigo: 3, nombre: "Procesos", orden: 3, por_pieza: true, columna_pieza: "FF, RAN, CAL" },
  { id: "e4", codigo: 4, nombre: "Corte especial", orden: 4, por_pieza: true, columna_pieza: "Corte 45" },
  { id: "e5", codigo: 5, nombre: "Armado", orden: 5 },
];
const NOMBRES = nombresEtapas(ETAPAS);

// ─── Reglas ───

test("etapas — se escanean por pieza las que la empresa marcó, en su orden y con su nombre", () => {
  const reglas = reglasPieza(ETAPAS);
  assert.deepEqual(reglas.map((r) => [r.codigo, r.nombre, r.icon]), [[1, "Corte", "🪚"], [2, "Canto", null], [3, "Procesos", null], [4, "Corte especial", null]]);
  assert.deepEqual(reglasPieza([{ ...ETAPAS[1], activa: false }, ETAPAS[4]]), [], "dadas de baja o sin marcar no");
  // Otra empresa, otros nombres
  const otra = [{ codigo: 7, nombre: "Plegado", por_pieza: true }, { codigo: 8, nombre: "Pintura", por_pieza: true }];
  assert.equal(mensajeEscaneo({ ok: true, requerida: true, pieza: { nombre: "P", ot: "1", de: 1 }, etapa: 8, faltan: [7], progreso: null }, nombresEtapas(otra)).texto,
    "P pasó por Pintura, pero no tiene escaneo de Plegado.");
  // Sin los nombres, usa el que manda el servidor
  assert.equal(mensajeEscaneo({ ok: true, requerida: true, pieza: { nombre: "P", ot: "1", de: 1 }, etapa: 8, etapaNombre: "Pintura", faltan: [], progreso: null }).texto, "P pasó por Pintura.");
});

test("migración 112 — etapas por pieza de cada empresa; los tipos viejos pasan a códigos", () => {
  const sql = readFileSync(new URL("../supabase/migrations/112_etapas_por_pieza.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.etapas add column if not exists por_pieza boolean not null default false/);
  assert.match(sql, /alter table public\.etapas add column if not exists columna_pieza text/);
  assert.match(sql, /when 'canto' then 'Canto, L1A, L1B, L2A, L2B'/);
  assert.match(sql, /alter table public\.piezas_ot rename column ruta to etapas/);
  assert.match(sql, /alter table public\.pasos_pieza add constraint pasos_pieza_pieza_id_etapa_key unique \(pieza_id, etapa\)/);
  assert.match(sql, /alter table public\.etapas drop column if exists tipo_pieza/);
  assert.match(sql, /udt_name = '_text'/, "idempotente: solo convierte si sigue siendo texto");
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

test("avance — etapas salteadas, piezas que faltan por etapa y texto", () => {
  const pieza = { id: 1, etapas: [1, 2, 3] };
  assert.deepEqual(etapasSalteadas(pieza, 3, [{ etapa: 1 }]), [2]);
  assert.deepEqual(etapasSalteadas(pieza, 3, [{ etapa: 1 }, { etapa: 2 }]), []);
  assert.deepEqual(etapasSalteadas(pieza, 1, []), []);
  assert.deepEqual(etapasSalteadas({ etapas: [1, 3] }, 3, [{ etapa: 1 }]), [], "si no lleva canto, no falta");
  assert.deepEqual(etapasSalteadas(pieza, 4, []), [], "una etapa que no le toca no tiene anteriores");

  const piezas = [pieza, { id: 2, etapas: [1, 2] }, { id: 3, etapas: [1] }];
  const avance = avancePiezas(piezas, [{ pieza_id: 1, etapa: 1 }, { pieza_id: 2, etapa: 1 }, { pieza_id: 3, etapa: 2 }], [1, 2, 3, 4]);
  assert.deepEqual(avance.map((a) => [a.codigo, a.total, a.pasaron]), [[1, 3, 2], [2, 2, 0], [3, 1, 0]], "un escaneo en una etapa que no le toca no cuenta");
  assert.deepEqual(avance[0].faltan.map((p) => p.id), [3]);
  assert.equal(textoAvancePiezas(avance, NOMBRES), "Corte 2 de 3 · Canto 0 de 2 · Procesos 0 de 1");
  assert.equal(textoAvancePiezas(avancePiezas([{ id: 1, etapas: [9] }], []), NOMBRES), "Etapa 9 0 de 1", "una etapa borrada");
});

test("mensaje — verde, ya estaba, salteó una etapa, no le toca, etapa terminada y error", () => {
  const base = { ok: true, pieza: { id: 7, ot: "M-7495", nombre: "M.izq-11", unidad: 2, de: 2 }, etapa: 2, requerida: true, faltan: [], progreso: { pasaron: 38, total: 51 } };
  assert.deepEqual(mensajeEscaneo(base, NOMBRES), { tono: "verde", texto: "M.izq-11 (2 de 2) pasó por Canto.", detalle: "Canto: 38 de 51 piezas de la OT M-7495." });
  assert.equal(mensajeEscaneo({ ...base, pieza: { ...base.pieza, de: 1 } }, NOMBRES).texto, "M.izq-11 pasó por Canto.");
  assert.equal(mensajeEscaneo({ ...base, ya: true, progreso: null }, NOMBRES).texto, "M.izq-11 (2 de 2) ya estaba escaneada en Canto.");
  const salteo = mensajeEscaneo({ ...base, etapa: 3, faltan: [1, 2] }, NOMBRES);
  assert.equal(salteo.tono, "amarillo");
  assert.equal(salteo.texto, "M.izq-11 (2 de 2) pasó por Procesos, pero no tiene escaneo de Corte ni Canto.");
  const noToca = mensajeEscaneo({ ...base, etapa: 4, requerida: false, progreso: null }, NOMBRES);
  assert.match(noToca.texto, /no pasa por esa etapa/);
  assert.equal(noToca.detalle, null);
  const fin = mensajeEscaneo({ ...base, progreso: { pasaron: 51, total: 51 }, etapaTerminada: { codigo: 2, nombre: "Canto" } }, NOMBRES);
  assert.match(fin.detalle, /Canto: 51 de 51 .* ✅ Pasaron todas: la etapa Canto quedó terminada, falta la firma\./);
  assert.deepEqual(mensajeEscaneo({ ok: false, error: "Esa pieza ya no está" }), { tono: "rojo", texto: "Esa pieza ya no está", detalle: null });
});

test("esquema y permisos — escanear o deshacer; los escaneos solo se leen por /api/data", () => {
  assert.ok(pasoPiezaBody.safeParse({ accion: "escanear", codigo: "OT M-7495 - PIEZA - 7", etapa: 2 }).success);
  assert.ok(pasoPiezaBody.safeParse({ accion: "escanear", codigo: "7", etapa: 3, op_id: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", momento: "2026-10-15T10:00:00-03:00" }).success);
  assert.ok(!pasoPiezaBody.safeParse({ accion: "escanear", codigo: "7", etapa: "canto" }).success);
  assert.ok(!pasoPiezaBody.safeParse({ accion: "escanear", codigo: "7", etapa: 0 }).success);
  assert.ok(!pasoPiezaBody.safeParse({ accion: "escanear", codigo: "7", etapa: 1, empleado_id: OTRO }).success);
  assert.ok(pasoPiezaBody.safeParse({ accion: "deshacer", pieza_id: 7, etapa: 1 }).success);
  assert.equal(autorizar("pasos_pieza", "GET", { rol: "operativo" }).ok, true);
  for (const m of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar("pasos_pieza", m, { rol: "gerencial" }).ok, false, m);
});

test("migración 110 — escaneos por pieza y etapa, con RLS y borrado en cascada", () => {
  const sql = readFileSync(new URL("../supabase/migrations/110_pasos_pieza.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.pasos_pieza/);
  assert.match(sql, /pieza_id\s+bigint not null references public\.piezas_ot\(id\) on delete cascade/);
  assert.match(sql, /unique \(pieza_id, etapa\)/);
  assert.match(sql, /alter table public\.pasos_pieza enable row level security/);
  assert.match(sql, /using \(empresa_id = \(current_setting\('request\.jwt\.claims', true\)::json->>'eid'\)::uuid\)/);
  assert.match(sql, /grant select, insert, update, delete on public\.pasos_pieza to authenticated/);
  assert.match(sql, /grant usage, select on sequence public\.pasos_pieza_id_seq to authenticated/);
  assert.doesNotMatch(sql, /to anon/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Servidor ───

async function token(rol = "operativo", empleadoId = EMP) {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 7, rol })).token;
}

function req(body, t) {
  return new Request("http://localhost/api/piezas/paso", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
  });
}

const PIEZA = { id: 7, ot: "M-7495", nombre: "M.izq-11", unidad: 2, de: 2, etapas: [1, 2, 3] };

function mock({ pieza = PIEZA, pasos = [], total = 51, pasaron = 38, avance = [], paso = null, falla = null, etapas = ETAPAS, sin112 = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    {
      match: (u) => u.includes("/rest/v1/etapas?"),
      respond: (u) => {
        if (sin112) return { status: 400, body: { code: "42703", message: "column etapas.por_pieza does not exist" } };
        const codigo = Number(u.match(/codigo=eq\.(\d+)/)?.[1]);
        return { status: 200, body: etapas.filter((e) => e.codigo === codigo) };
      },
    },
    {
      match: (u, o) => u.includes("/rest/v1/piezas_ot?") && (!o?.method || o.method === "GET"),
      respond: (u) => {
        if (falla) return { status: 404, body: { code: "PGRST205", message: falla } };
        if (u.includes("etapas=cs.")) return { status: 200, body: [{ id: 1 }], headers: { "content-range": `0-0/${total}` } };
        return { status: 200, body: pieza ? [pieza] : [] };
      },
    },
    {
      match: (u, o) => u.includes("/rest/v1/pasos_pieza") && (!o?.method || o.method === "GET"),
      respond: (u) => {
        if (u.includes("requerida=eq.true")) return { status: 200, body: [{ id: 1 }], headers: { "content-range": `0-0/${pasaron}` } };
        if (u.includes("select=id,empleado_id,created_at")) return { status: 200, body: paso ? [paso] : [] };
        return { status: 200, body: pasos };
      },
    },
    { match: (u, o) => u.includes("/rest/v1/avance_etapas") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: avance }) },
    {
      match: (u, o) => /\/rest\/v1\/(pasos_pieza|avance_etapas)/.test(u) && ["POST", "PATCH", "DELETE"].includes(o?.method),
      respond: (u, o) => {
        escrito.push({ metodo: o.method, url: u, body: o.body ? JSON.parse(o.body) : null, prefer: o.headers?.Prefer });
        return { status: 201, body: [] };
      },
    },
  ]);
  return escrito;
}

test("/api/piezas/paso — escanear: anota la pieza con quién, devuelve el avance de la etapa", async () => {
  const escrito = mock();
  const res = await api.POST(req({ accion: "escanear", codigo: "OT M-7495 - PIEZA - 7", etapa: 2 }, await token()));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data, {
    ok: true, ya: false, pieza: { id: 7, ot: "M-7495", nombre: "M.izq-11", unidad: 2, de: 2 }, etapa: 2, etapaNombre: "Canto", requerida: true,
    faltan: [1], progreso: { pasaron: 38, total: 51 }, etapaTerminada: null,
  });
  assert.equal(escrito.length, 1);
  assert.match(escrito[0].url, /pasos_pieza\?on_conflict=pieza_id,etapa$/);
  assert.match(escrito[0].prefer, /resolution=ignore-duplicates/);
  assert.equal(escrito[0].body.empresa_id, E);
  assert.equal(escrito[0].body.ot, "M-7495");
  assert.equal(escrito[0].body.pieza_id, 7);
  assert.equal(escrito[0].body.empleado_id, EMP);
  assert.equal(escrito[0].body.requerida, true);
  assert.ok(Math.abs(Date.parse(escrito[0].body.created_at) - Date.now()) < 5000);
});

test("/api/piezas/paso — la última pieza termina la etapa de la OT (si no estaba firmada)", async () => {
  let escrito = mock({ pasos: [{ etapa: 1 }, { etapa: 2 }], total: 51, pasaron: 51 });
  let res = await api.POST(req({ accion: "escanear", codigo: "OT M-7495 - PIEZA - 7", etapa: 3 }, await token()));
  let data = await res.json();
  assert.deepEqual(data.etapaTerminada, { codigo: 3, nombre: "Procesos" });
  const avance = escrito.find((x) => x.url.includes("avance_etapas"));
  assert.equal(avance.metodo, "POST");
  assert.equal(avance.body.etapa, 3);
  assert.equal(avance.body.estado, "terminada");
  assert.equal(avance.body.terminada_por, EMP);
  assert.equal(avance.body.ot, "M-7495");

  escrito = mock({ pasos: [{ etapa: 1 }, { etapa: 2 }], pasaron: 51, avance: [{ id: 1, estado: "aprobada" }] });
  res = await api.POST(req({ accion: "escanear", codigo: "OT M-7495 - PIEZA - 7", etapa: 3 }, await token()));
  data = await res.json();
  assert.ok(data.etapaTerminada);
  assert.equal(escrito.filter((x) => x.url.includes("avance_etapas")).length, 0, "una etapa firmada no se toca");
});

test("/api/piezas/paso — etapas de otra empresa; una etapa que no se escanea por pieza; falta la 112", async () => {
  const otra = [{ codigo: 7, nombre: "Plegado", por_pieza: true }, { codigo: 8, nombre: "Pintura", por_pieza: true }, { codigo: 9, nombre: "Embalaje" }];
  let escrito = mock({ pieza: { ...PIEZA, etapas: [7, 8] }, pasos: [{ etapa: 7 }], pasaron: 51, etapas: otra });
  let data = await (await api.POST(req({ accion: "escanear", codigo: "OT M-7495 - PIEZA - 7", etapa: 8 }, await token()))).json();
  assert.equal(data.etapaNombre, "Pintura");
  assert.deepEqual(data.etapaTerminada, { codigo: 8, nombre: "Pintura" });
  assert.equal(escrito.find((x) => x.url.includes("avance_etapas")).body.etapa, 8);

  escrito = mock({ etapas: otra });
  let res = await api.POST(req({ accion: "escanear", codigo: "7", etapa: 9 }, await token()));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /ya no se escanea por pieza/);
  res = await api.POST(req({ accion: "escanear", codigo: "7", etapa: 99 }, await token()));
  assert.equal(res.status, 400);
  assert.equal(escrito.length, 0);

  mock({ sin112: true });
  res = await api.POST(req({ accion: "escanear", codigo: "7", etapa: 1 }, await token()));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 112/);
});

test("/api/piezas/paso — ya escaneada, etapa que no le toca, número a mano y hora de la cola sin señal", async () => {
  let escrito = mock({ pasos: [{ etapa: 2, created_at: "2026-10-15T12:00:00Z" }] });
  let data = await (await api.POST(req({ accion: "escanear", codigo: "OT M-7495 - PIEZA - 7", etapa: 2 }, await token()))).json();
  assert.equal(data.ya, true);
  assert.equal(escrito.length, 0);

  escrito = mock();
  data = await (await api.POST(req({ accion: "escanear", codigo: "7", etapa: 4 }, await token()))).json();
  assert.equal(data.ok, true);
  assert.equal(data.requerida, false);
  assert.equal(data.progreso, null);
  assert.equal(escrito[0].body.requerida, false);

  const hace = new Date(Date.now() - 3600000).toISOString();
  escrito = mock();
  await api.POST(req({ accion: "escanear", codigo: "7", etapa: 1, op_id: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", momento: hace }, await token()));
  assert.equal(escrito[0].body.created_at, hace);
  escrito = mock();
  await api.POST(req({ accion: "escanear", codigo: "7", etapa: 1, momento: "2026-01-01T00:00:00Z" }, await token()));
  assert.ok(Math.abs(Date.parse(escrito[0].body.created_at) - Date.now()) < 5000, "una hora vieja no se cree");
});

test("/api/piezas/paso — código que no es de pieza, pieza de otra OT o borrada, falta la migración", async () => {
  let escrito = mock();
  let res = await api.POST(req({ accion: "escanear", codigo: "OT M-7495 - BULTO 1 DE 4", etapa: 1 }, await token()));
  assert.equal(res.status, 400);
  res = await api.POST(req({ accion: "escanear", codigo: "OT M-9999 - PIEZA - 7", etapa: 1 }, await token()));
  assert.equal(res.status, 404);
  assert.equal(escrito.length, 0);
  mock({ pieza: null });
  res = await api.POST(req({ accion: "escanear", codigo: "OT M-7495 - PIEZA - 7", etapa: 1 }, await token()));
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /Reimprimí su etiqueta/);
  mock({ falla: 'Could not find the table "public.piezas_ot"' });
  res = await api.POST(req({ accion: "escanear", codigo: "7", etapa: 1 }, await token()));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 110/);
});

test("/api/piezas/paso — deshacer: el mismo operario hasta 30 minutos; después, solo gestión", async () => {
  const reciente = { id: 99, empleado_id: EMP, created_at: new Date(Date.now() - 60000).toISOString() };
  let escrito = mock({ paso: reciente });
  let res = await api.POST(req({ accion: "deshacer", pieza_id: 7, etapa: 2 }, await token()));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "DELETE");
  assert.match(escrito[0].url, new RegExp(`pasos_pieza\\?id=eq\\.99&empresa_id=eq\\.${E}$`));

  escrito = mock({ paso: reciente });
  res = await api.POST(req({ accion: "deshacer", pieza_id: 7, etapa: 2 }, await token("operativo", OTRO)));
  assert.equal(res.status, 403);
  escrito = mock({ paso: { ...reciente, created_at: new Date(Date.now() - 3600000).toISOString() } });
  res = await api.POST(req({ accion: "deshacer", pieza_id: 7, etapa: 2 }, await token()));
  assert.equal(res.status, 403);
  assert.equal(escrito.length, 0);
  res = await api.POST(req({ accion: "deshacer", pieza_id: 7, etapa: 2 }, await token("gerencial", OTRO)));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "DELETE");
});

// ─── Pantalla del operario ───

function mockPantalla(responder) {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes("/api/piezas/paso")) {
      const body = JSON.parse(opts.body);
      pedidos.push(body);
      const { status = 200, data } = responder(body);
      return new Response(JSON.stringify(data), { status });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return pedidos;
}

const USUARIO = { id: EMP, rol: "operativo" };

test("operario — con una tarea de Canto en curso, la etapa ya viene elegida; anota y muestra en verde", async () => {
  const pedidos = mockPantalla((b) => ({
    data: b.accion === "deshacer" ? { ok: true } : {
      ok: true, ya: false, pieza: { id: 7, ot: "M-7495", nombre: "M.izq-11", unidad: 1, de: 2 }, etapa: b.etapa, requerida: true, faltan: [], progreso: { pasaron: 3, total: 51 }, etapaTerminada: null,
    },
  }));
  render(<EscanearPiezas usuario={USUARIO} etapas={ETAPAS} tareaActiva={{ etapa: 2 }} onClose={() => {}} />);
  assert.equal(screen.getByRole("button", { name: "Canto" }).getAttribute("aria-pressed"), "true");
  fireEvent.change(screen.getByLabelText("Número de la pieza"), { target: { value: "N° 7" } });
  fireEvent.click(screen.getByText("Anotar"));
  await waitFor(() => assert.ok(screen.getByText("M.izq-11 (1 de 2) pasó por Canto.")));
  assert.ok(screen.getByText("Canto: 3 de 51 piezas de la OT M-7495."));
  assert.equal(pedidos[0].accion, "escanear");
  assert.equal(pedidos[0].codigo, "7");
  assert.equal(pedidos[0].etapa, 2);
  assert.ok(pedidos[0].op_id, "lleva op_id por si se manda desde la cola");

  fireEvent.click(screen.getByText("Deshacer"));
  await waitFor(() => assert.ok(screen.getByText("Deshecho: M.izq-11 (1 de 2) pasó por Canto.")));
  assert.deepEqual(pedidos[1], { accion: "deshacer", pieza_id: 7, etapa: 2 });
});

test("operario — ve los botones con los nombres de su empresa", async () => {
  const pedidos = mockPantalla((b) => ({
    data: { ok: true, ya: false, pieza: { id: 7, ot: "M-7495", nombre: "M.izq-11", unidad: 1, de: 1 }, etapa: b.etapa, requerida: true, faltan: [], progreso: { pasaron: 3, total: 51 }, etapaTerminada: null },
  }));
  const propias = [
    { codigo: 7, nombre: "Seccionadora", activa: true, por_pieza: true, icon: "🪚" },
    { codigo: 8, nombre: "Canteado", activa: true, por_pieza: true },
    { codigo: 9, nombre: "Armado", activa: true },
  ];
  render(<EscanearPiezas usuario={USUARIO} etapas={propias} tareaActiva={{ etapa: 8 }} onClose={() => {}} />);
  assert.equal(screen.getByRole("button", { name: "Canteado" }).getAttribute("aria-pressed"), "true");
  assert.ok(screen.getByRole("button", { name: "🪚 Seccionadora" }));
  assert.equal(screen.queryByRole("button", { name: "Armado" }), null);
  fireEvent.change(screen.getByLabelText("Número de la pieza"), { target: { value: "7" } });
  fireEvent.click(screen.getByText("Anotar"));
  await waitFor(() => assert.ok(screen.getByText("M.izq-11 pasó por Canteado.")));
  assert.equal(pedidos[0].etapa, 8);
});

test("operario — sin etapa elegida pide elegirla; avisos en amarillo y errores en rojo; recuerda la etapa", async () => {
  mockPantalla((b) => (b.codigo === "8"
    ? { status: 404, data: { error: "Esa pieza ya no está en la OT (puede que se haya vuelto a pegar la planilla). Reimprimí su etiqueta." } }
    : { data: { ok: true, ya: true, pieza: { id: 7, ot: "M-7495", nombre: "11", unidad: 1, de: 1 }, etapa: b.etapa, requerida: true, faltan: [], progreso: null } }));
  render(<EscanearPiezas usuario={USUARIO} etapas={ETAPAS} onClose={() => {}} />);
  assert.ok(screen.getByText("Elegí la etapa y escaneá las etiquetas de las piezas."));
  assert.equal(screen.queryAllByLabelText("Número de la pieza").length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Procesos" }));
  fireEvent.change(screen.getByLabelText("Número de la pieza"), { target: { value: "7" } });
  fireEvent.click(screen.getByText("Anotar"));
  await waitFor(() => assert.ok(screen.getByText("11 ya estaba escaneada en Procesos.")));
  assert.match(screen.getByText("11 ya estaba escaneada en Procesos.").closest("li").className, /amber/);
  assert.equal(screen.queryAllByText("Deshacer").length, 0);
  fireEvent.change(screen.getByLabelText("Número de la pieza"), { target: { value: "8" } });
  fireEvent.click(screen.getByText("Anotar"));
  await waitFor(() => assert.ok(screen.getByText(/Reimprimí su etiqueta/)));
  assert.match(screen.getByText(/Reimprimí su etiqueta/).closest("li").className, /red/);
  cleanup();
  render(<EscanearPiezas usuario={USUARIO} etapas={ETAPAS} onClose={() => {}} />);
  assert.equal(screen.getByRole("button", { name: "Procesos" }).getAttribute("aria-pressed"), "true", "la próxima vez ya viene elegida");
});

// ─── Avance en 🧩 Piezas ───

test("piezas de la OT — avance por etapa y 'las que faltan en'", async () => {
  const piezas = [
    { id: 1, nombre: "M.izq-11", modulo: "M.izq", unidad: 1, de: 2, renglon: 0, etapas: [1, 2] },
    { id: 2, nombre: "M.izq-11", modulo: "M.izq", unidad: 2, de: 2, renglon: 0, etapas: [1, 2] },
    { id: 3, nombre: "1-FONDO", modulo: "1", unidad: 1, de: 1, renglon: 1, etapas: [1] },
  ];
  const pasos = [{ pieza_id: 1, etapa: 1 }, { pieza_id: 2, etapa: 1 }, { pieza_id: 3, etapa: 1 }, { pieza_id: 1, etapa: 2 }];
  global.fetch = async (url, opts = {}) => {
    const b = String(opts.body || "");
    const data = b.includes("etapas?empresa_id") ? ETAPAS : b.includes("pasos_pieza") ? pasos : piezas;
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  render(<PiezasOt proyecto={{ ot: "M-7495" }} empresaId={E} onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("Escaneadas: Corte 3 de 3 · Canto 1 de 2")));
  assert.ok(screen.getByText("Canto 1/2"));
  fireEvent.change(screen.getByLabelText("Ver"), { target: { value: "2" } });
  assert.ok(screen.getByText(/M\.izq-11/));
  assert.equal(screen.queryAllByText(/1-FONDO/).length, 0);
  fireEvent.change(screen.getByLabelText("Ver"), { target: { value: "1" } });
  assert.ok(screen.getByText("✅ Pasaron todas por Corte."));
});
