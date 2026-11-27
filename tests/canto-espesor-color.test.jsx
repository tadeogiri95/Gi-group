// tests/canto-espesor-color.test.jsx — Canto por espesor y color al escanear
// (pedido de Tadeo, 27/11; migración 214). Una pieza x5 lleva 2 lados L2 con
// canto de 2 mm y 1 lado L1 con 0,45. Si se pegó solo el de 2 mm, 10
// escaneos son 5 piezas con los dos lados de 2 mm (no 3 completas y 1
// empezada), y los metros se descuentan del canto de 2 mm.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  tipoCanto, textoTipoCanto, textoLado, usaCantos, ladosHechos, ladosPendientes, ladoParaEscaneo, avanceTipo, falta214,
} from "../app/lib/cantoLados.js";
import { cantoUsado, cantosPegados } from "../app/lib/cantoConsumo.js";
import { mensajeEscaneo, nombresEtapas } from "../app/lib/piezas.js";
import { pasoPiezaBody } from "../app/lib/schemas.ts";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* sin almacenamiento */ } });

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/piezas/paso/route.js");
const { default: EscanearPiezas } = await import("../app/components/EscanearPiezas.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const ETAPAS = [
  { id: "e1", codigo: 1, nombre: "Corte", orden: 1, por_pieza: true },
  { id: "e2", codigo: 2, nombre: "Canto", orden: 2, por_pieza: true, columna_pieza: "Canto, L1A, L1B, L2A, L2B" },
];
const NOMBRES = nombresEtapas(ETAPAS);
const DOS = "2|GRAFITO";
const FINO = "0.45|GRAFITO";
// L1 = 600 mm, L2 = 400 mm: L1 A con 0,45; L2 A y L2 B con 2 mm
const CANTOS = [
  { l: "l1a", e: 0.45, c: "GRAFITO", mm: 600 },
  { l: "l2a", e: 2, c: "GRAFITO", mm: 400 },
  { l: "l2b", e: 2, c: "GRAFITO", mm: 400 },
];
const RENGLON = [1, 2, 3, 4, 5].map((u) => ({
  id: 30 + u, ot: "M-7495", nombre: "LAT-1", unidad: u, de: 5, etapas: [1, 2], lados: 3, cantos: CANTOS, material: "MELAMINA 18MM",
}));

// ─── Reglas ───

test("tipos y textos — espesor y color; lados L1 A…L2 B", () => {
  assert.equal(tipoCanto(CANTOS[0]), FINO);
  assert.equal(tipoCanto({ e: 2, c: " grafito " }), DOS);
  assert.equal(textoTipoCanto(FINO), "0,45 mm GRAFITO");
  assert.equal(textoTipoCanto(DOS), "2 mm GRAFITO");
  assert.equal(textoLado("l2b"), "L2 B");
  assert.equal(usaCantos(RENGLON[0]), true);
  assert.equal(usaCantos({ lados: 3, cantos: CANTOS.slice(0, 2) }), false, "si falta el canto de un lado, se cuenta como antes");
  assert.equal(usaCantos({ lados: 3, cantos: null }), false);
  assert.equal(falta214({ message: "column lados_pieza.lado does not exist" }), true);
  assert.equal(falta214({ message: 'relation "public.lados_pieza" does not exist' }), false);
});

test("el ejemplo de Tadeo — 10 escaneos de 2 mm en 5 piezas: las 5 con sus dos lados de 2 mm, ninguna completa", () => {
  const filas = new Map();
  for (let i = 0; i < 10; i++) {
    const r = ladoParaEscaneo(RENGLON, { filas, tipo: DOS });
    assert.ok(r.pieza, `escaneo ${i + 1}`);
    assert.equal(r.tipo, DOS);
    filas.set(r.pieza.id, [...(filas.get(r.pieza.id) || []), { lado: r.lado }]);
  }
  assert.deepEqual([...filas].map(([id, f]) => [id, f.map((x) => x.lado)]), RENGLON.map((u) => [u.id, ["l2a", "l2b"]]));
  for (const u of RENGLON) assert.deepEqual(ladosPendientes(u, filas.get(u.id)).map((c) => c.l), ["l1a"]);
  // El 11.º de 2 mm no tiene dónde ir: queda el 0,45
  assert.deepEqual(ladoParaEscaneo(RENGLON, { filas, tipo: DOS }), { distinto: [FINO] });
  // Sin elegir, ahora queda un solo tipo: no pregunta
  assert.deepEqual(ladoParaEscaneo(RENGLON, { filas }), { pieza: RENGLON[0], lado: "l1a", tipo: FINO });
  assert.deepEqual(avanceTipo(RENGLON, { filas, tipo: DOS }), { total: 10, hechos: 10 });
  assert.deepEqual(avanceTipo(RENGLON, { filas, tipo: FINO }), { total: 5, hechos: 0 });

  // Metros: 10 lados de 400 mm de 2 mm (+5 %) y nada de 0,45
  const escaneos = new Map([...filas]);
  const usado = cantoUsado({ piezas: RENGLON, escaneos, pct: 5 }).get("M-7495");
  assert.deepEqual([...usado.keys()], ["2|GRAFITO|18"]);
  assert.deepEqual(usado.get("2|GRAFITO|18"), { metros: 4.2, lados: 10 });
});

test("sin elegir y con varios cantos pendientes pregunta; las completas no cuentan; escaneos viejos van en el orden de la planilla", () => {
  assert.deepEqual(ladoParaEscaneo(RENGLON, {}), { preguntar: [FINO, DOS] });
  assert.deepEqual(ladoParaEscaneo(RENGLON, { completas: new Set(RENGLON.map((u) => u.id)) }), { ninguno: true });
  // Un escaneo viejo (sin lado) es el primer lado de la planilla (L1 A)
  assert.deepEqual([...ladosHechos(RENGLON[0], [{ lado: null }])], ["l1a"]);
  assert.deepEqual([...ladosHechos(RENGLON[0], [{ lado: "l2b" }, {}])], ["l2b", "l1a"]);
  assert.deepEqual(cantosPegados(RENGLON[0], 1).map((c) => c.l), ["l1a"], "solo la cantidad, como antes");
  assert.deepEqual(cantosPegados(RENGLON[0], [{ lado: "l2a" }]).map((c) => c.l), ["l2a"]);
  // Pieza con un solo canto: sin elegir, va derecho
  const simple = { id: 1, lados: 2, cantos: [CANTOS[1], CANTOS[2]] };
  assert.deepEqual(ladoParaEscaneo([simple], {}), { pieza: simple, lado: "l2a", tipo: DOS });
});

test("esquema y migración 214 — el escaneo trae el canto; lados_pieza guarda lado y canto", () => {
  assert.ok(pasoPiezaBody.safeParse({ accion: "escanear", codigo: "7", etapa: 2, canto: DOS }).success);
  assert.ok(pasoPiezaBody.safeParse({ accion: "escanear", codigo: "7", etapa: 2, canto: FINO }).success);
  assert.ok(pasoPiezaBody.safeParse({ accion: "escanear", codigo: "7", etapa: 2, canto: null }).success);
  assert.ok(!pasoPiezaBody.safeParse({ accion: "escanear", codigo: "7", etapa: 2, canto: "grafito" }).success);
  const sql = readFileSync(new URL("../supabase/migrations/214_canto_lado_tipo.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.lados_pieza add column if not exists lado text/);
  assert.match(sql, /alter table public\.lados_pieza add column if not exists canto text/);
  assert.match(sql, /lado in \('l1a', 'l1b', 'l2a', 'l2b'\)/);
  assert.match(sql, /^do \$mig\$$/m);
  assert.equal((sql.match(/\$mig\$/g) || []).length, 2);
  assert.deepEqual(MIGRACIONES.find((x) => x.n === 214)?.tablas, { lados_pieza: ["lado", "canto"] });
});

// ─── Servidor ───

async function token() {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol: "operativo" })).token;
}
function req(body, t) {
  return new Request("http://localhost/api/piezas/paso", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
  });
}

function mock({ hechos = [], lados = [], sin214 = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/etapas?"), respond: (u) => ({ status: 200, body: ETAPAS.filter((e) => e.codigo === Number(u.match(/codigo=eq\.(\d+)/)?.[1])) }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [{ ot: "M-7495" }] }) },
    { match: (u) => u.includes("/rest/v1/pausas_ot?"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u, o) => u.includes("/rest/v1/piezas_ot?") && (!o?.method || o.method === "GET"),
      respond: (u) => {
        if (u.includes("etapas=cs.")) return { status: 200, body: [{ id: 1 }], headers: { "content-range": "0-0/50" } };
        if (u.includes("order=unidad.asc")) return { status: 200, body: RENGLON };
        const id = Number(u.match(/id=eq\.(\d+)/)?.[1]);
        return { status: 200, body: RENGLON.filter((p) => p.id === id) };
      },
    },
    {
      match: (u, o) => u.includes("/rest/v1/pasos_pieza") && (!o?.method || o.method === "GET"),
      respond: (u) => {
        if (u.includes("requerida=eq.true")) return { status: 200, body: [{ id: 1 }], headers: { "content-range": "0-0/10" } };
        if (u.includes("pieza_id=in.")) return { status: 200, body: hechos.map((id) => ({ pieza_id: id })) };
        return { status: 200, body: [] };
      },
    },
    { match: (u, o) => u.includes("/rest/v1/avance_etapas") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u, o) => u.includes("/rest/v1/lados_pieza?") && (!o?.method || o.method === "GET"),
      respond: (u) => {
        if (sin214 && u.includes("select=pieza_id,lado")) return { status: 400, body: { code: "42703", message: "column lados_pieza.lado does not exist" } };
        return { status: 200, body: lados.map(([id, lado]) => ({ pieza_id: id, lado: sin214 ? undefined : lado })) };
      },
    },
    {
      match: (u, o) => /\/rest\/v1\/(pasos_pieza|avance_etapas|lados_pieza)/.test(u) && ["POST", "PATCH", "DELETE"].includes(o?.method),
      respond: (u, o) => {
        const body = o.body ? JSON.parse(o.body) : null;
        if (sin214 && /lados_pieza/.test(u) && body?.lado) return { status: 400, body: { code: "PGRST204", message: "Could not find the 'lado' column of 'lados_pieza'" } };
        escrito.push({ url: u.replace(/.*\/rest\/v1\//, ""), body });
        return { status: 201, body: [] };
      },
    },
  ]);
  return escrito;
}

const CODIGO = "OT M-7495 - PIEZA - LAT-1";

test("/api/piezas/paso — con 2 mm elegido, cada unidad recibe sus dos lados de 2 mm y sigue con la próxima", async () => {
  // Primer escaneo
  let escrito = mock();
  let data = await (await api.POST(req({ accion: "escanear", codigo: CODIGO, etapa: 2, canto: DOS }, await token()))).json();
  assert.equal(data.ok, true);
  assert.equal(data.pieza.id, 31);
  assert.deepEqual(escrito.map((x) => x.url), ["lados_pieza"]);
  assert.equal(escrito[0].body.lado, "l2a");
  assert.equal(escrito[0].body.canto, DOS);
  assert.deepEqual(data.lados.canto, { tipo: DOS, total: 10, hechos: 1 });
  assert.equal(data.lados.nombre, "l2a");
  const m = mensajeEscaneo({ ...data, faltan: [] }, NOMBRES);
  assert.equal(m.texto, "LAT-1: pieza 1 de 5, lado L2 A (2 mm GRAFITO), 1 de 3 en Canto.");
  assert.match(m.detalle, /Canto 2 mm GRAFITO: 1 de 10 lados\. Van 1 de 15 lados/);

  // La 31 ya tiene sus dos de 2 mm: el tercer escaneo de 2 mm va a la 32 (antes iba al L1 de la 31)
  escrito = mock({ lados: [[31, "l2a"], [31, "l2b"]] });
  data = await (await api.POST(req({ accion: "escanear", codigo: CODIGO, etapa: 2, canto: DOS }, await token()))).json();
  assert.equal(data.pieza.id, 32);
  assert.equal(escrito[0].body.lado, "l2a");
  assert.equal(escrito.length, 1, "la 31 no queda completa");
  assert.deepEqual(data.conteo, { pasaron: 0, de: 5 });

  // Después, el 0,45 de la 31 la completa
  escrito = mock({ lados: RENGLON.flatMap((u) => [[u.id, "l2a"], [u.id, "l2b"]]) });
  data = await (await api.POST(req({ accion: "escanear", codigo: CODIGO, etapa: 2, canto: FINO }, await token()))).json();
  assert.equal(data.pieza.id, 31);
  assert.deepEqual(escrito.map((x) => [x.url, x.body.lado ?? null]), [["lados_pieza", "l1a"], ["pasos_pieza?on_conflict=pieza_id,etapa", null]]);
  assert.deepEqual(data.conteo, { pasaron: 1, de: 5 });
});

test("/api/piezas/paso — canto que la pieza no tiene pendiente, o varios sin elegir: pregunta y no anota", async () => {
  let escrito = mock({ lados: RENGLON.flatMap((u) => [[u.id, "l2a"], [u.id, "l2b"]]) });
  let data = await (await api.POST(req({ accion: "escanear", codigo: CODIGO, etapa: 2, canto: DOS }, await token()))).json();
  assert.equal(data.ok, false);
  assert.deepEqual(data.elegirCanto, { elegido: DOS, opciones: [FINO] });
  assert.equal(escrito.length, 0);

  escrito = mock();
  data = await (await api.POST(req({ accion: "escanear", codigo: CODIGO, etapa: 2 }, await token()))).json();
  assert.deepEqual(data.elegirCanto, { elegido: null, opciones: [FINO, DOS] });
  assert.equal(escrito.length, 0);

  // La etiqueta de una unidad (N° 33): el lado de esa pieza
  escrito = mock();
  data = await (await api.POST(req({ accion: "escanear", codigo: "33", etapa: 2, canto: DOS }, await token()))).json();
  assert.equal(data.pieza.id, 33);
  assert.equal(escrito[0].body.lado, "l2a");
});

test("/api/piezas/paso — sin la migración 214 sigue como antes (un lado tras otro, sin preguntar)", async () => {
  const escrito = mock({ sin214: true });
  const data = await (await api.POST(req({ accion: "escanear", codigo: CODIGO, etapa: 2, canto: DOS }, await token()))).json();
  assert.equal(data.ok, true);
  assert.equal(data.pieza.id, 31);
  assert.deepEqual(escrito.map((x) => x.url), ["lados_pieza"]);
  assert.equal(escrito[0].body.lado, undefined);
  assert.equal(data.lados.canto, undefined);
});

// ─── Pantalla ───

const USUARIO = { id: EMP, rol: "operativo", empresa_id: E };

test("operario — en Canto elige el canto de la máquina; se manda en cada escaneo y la tarjeta pregunta si no corresponde", async () => {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes("/api/piezas/paso")) {
      const b = JSON.parse(opts.body);
      pedidos.push(b);
      const data = b.canto === FINO
        ? { ok: true, ya: false, pieza: { id: 31, ot: "M-7495", nombre: "LAT-1", unidad: 1, de: 5 }, etapa: 2, requerida: true, faltan: [], progreso: null, etapaTerminada: null,
          lados: { lado: 3, de: 3, hechos: 11, total: 15, nombre: "l1a", canto: { tipo: FINO, total: 5, hechos: 1 }, tipos: [FINO, DOS] } }
        : { ok: false, elegirCanto: { elegido: DOS, opciones: [FINO] }, pieza: { id: 31, ot: "M-7495", nombre: "LAT-1", unidad: 1, de: 5 }, etapa: 2 };
      return new Response(JSON.stringify(data), { status: 200 });
    }
    if (String(opts.body || "").includes("piezas_ot")) return new Response(JSON.stringify({ data: [{ cantos: CANTOS }] }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  render(<EscanearPiezas usuario={USUARIO} etapas={ETAPAS} tareaActiva={{ etapa: 2, codigo_proyecto: "M-7495" }} onClose={() => {}} />);
  const dos = await screen.findByRole("button", { name: "2 mm GRAFITO" });
  assert.ok(screen.getByRole("button", { name: "0,45 mm GRAFITO" }));
  fireEvent.click(dos);
  assert.equal(dos.getAttribute("aria-pressed"), "true");
  assert.equal(localStorage.getItem("gypi_canto_maquina"), DOS);

  fireEvent.change(screen.getByLabelText("Número de la pieza"), { target: { value: "31" } });
  fireEvent.click(screen.getByText("Anotar"));
  await waitFor(() => assert.ok(screen.getByText("LAT-1 (5 unidades) no tiene lados pendientes de canto 2 mm GRAFITO. ¿Qué canto pegaste?")));
  assert.equal(pedidos[0].canto, DOS);

  fireEvent.click(screen.getByText("Anotar 0,45 mm GRAFITO"));
  await waitFor(() => assert.ok(screen.getByText("LAT-1: pieza 1 de 5, lado L1 A (0,45 mm GRAFITO), 3 de 3 en Canto.")));
  assert.equal(pedidos[1].canto, FINO);
  assert.equal(screen.getByRole("button", { name: "0,45 mm GRAFITO" }).getAttribute("aria-pressed"), "true", "queda como el canto de la máquina");
});

test("operario — en Corte no aparecen los botones de canto ni se manda el canto", async () => {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes("/api/piezas/paso")) {
      pedidos.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ ok: true, ya: false, pieza: { id: 7, ot: "M-7495", nombre: "P", unidad: 1, de: 1 }, etapa: 1, requerida: true, faltan: [], progreso: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  try { localStorage.setItem("gypi_canto_maquina", DOS); } catch { /* sin almacenamiento */ }
  render(<EscanearPiezas usuario={USUARIO} etapas={ETAPAS} tareaActiva={{ etapa: 1 }} onClose={() => {}} />);
  assert.equal(screen.queryByText("¿Qué canto tenés en la máquina?"), null);
  fireEvent.change(screen.getByLabelText("Número de la pieza"), { target: { value: "7" } });
  fireEvent.click(screen.getByText("Anotar"));
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.equal(pedidos[0].canto, undefined);
});
