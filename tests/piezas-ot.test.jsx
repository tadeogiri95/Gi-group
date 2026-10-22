// tests/piezas-ot.test.jsx — Órdenes de Producción, parte 17: piezas de la OT
// pegadas de la planilla técnica, una por unidad física, con etiqueta QR.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  leerPiezas, expandirPiezas, agruparRenglones, cambiosAlReemplazar, moduloDe, tieneValor,
  textoQrPieza, leerQrPieza, htmlEtiquetasPiezas, medidas, reglasPieza, nombresEtapas, columnasDeTexto,
} from "../app/lib/piezas.js";
import { leerQr } from "../app/lib/escaneoCarga.js";
import { piezasBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { default: PiezasOt } = await import("../app/components/PiezasOt.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/piezas/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

// La planilla técnica de la OT 7495, copiada de Google Sheets: hoja PLANILLA
// desde la fila de títulos (3 filas de títulos combinados) y hoja CUT RITE.
const PLANILLA = readFileSync(new URL("./fixtures/planilla-7495-piezas.tsv", import.meta.url), "utf8");
const CUT_RITE = readFileSync(new URL("./fixtures/cutrite-7495-piezas.tsv", import.meta.url), "utf8");

const buscar = (r, nombre) => r.renglones.find((x) => x.nombre === nombre);

// Etapas de la empresa que se escanean por pieza (Configuración → Etapas,
// migración 112), como las que deja la migración en la fábrica de la OT 7495
const ETAPAS = [
  { codigo: 1, nombre: "Corte", por_pieza: true, orden: 1 },
  { codigo: 2, nombre: "Canto", por_pieza: true, orden: 2, columna_pieza: "Canto, L1A, L1B, L2A, L2B" },
  { codigo: 3, nombre: "CNC", por_pieza: true, orden: 3, columna_pieza: "FF, RAN, Ranurado, CAL, Calado, CNC, Perforado, Perforacion" },
  { codigo: 4, nombre: "Corte especial", por_pieza: true, orden: 4, columna_pieza: "Corte 45, 45, Diagonal, Diag, Corte especial" },
  { codigo: 5, nombre: "Armado", orden: 5 },
];
const REGLAS = reglasPieza(ETAPAS);
const leer = (texto) => leerPiezas(texto, REGLAS);

// ─── Lo pegado de la planilla ───

test("planilla — hoja PLANILLA: 47 renglones, 218 piezas, medidas, material y módulo", () => {
  const r = leer(PLANILLA);
  assert.deepEqual(r.faltaColumnas, []);
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.sinColumna, []);
  assert.equal(r.renglones.length, 47);
  assert.equal(expandirPiezas(r.renglones).length, 218);
  assert.deepEqual(buscar(r, "M.izq-11"), {
    nombre: "M.izq-11", modulo: "M.izq", material: "ENCHAPADO 19MM SOBRE MDF KIRI", l1: 402, l2: 342, cantidad: 2, etapas: [1, 2, 3],
  });
  assert.equal(buscar(r, "11").modulo, null, "sin guion no hay módulo");
  assert.equal(buscar(r, "Cenefa - T1").modulo, "Cenefa");
  assert.equal(buscar(r, "TIRAS CORTAS").cantidad, 55);
});

test("planilla — etapas de la empresa: todas por Corte; Canto, CNC y Corte especial según sus columnas", () => {
  const r = leer(PLANILLA);
  assert.deepEqual(buscar(r, "1-FONDO").etapas, [1], "fondo de fibroplus: sin cantos");
  assert.deepEqual(buscar(r, "1-FRENTE CAJON").etapas, [1, 2]);
  assert.deepEqual(buscar(r, "M.der-52").etapas, [1, 3], "calado '2 tomas' sin canto");
  assert.deepEqual(buscar(r, "Bast.TV-21/31").etapas, [1, 2, 3], "calado 'VER PLANO'");
  assert.deepEqual(buscar(r, "Cenefa - T1").etapas, [1, 2, 4], "corte a 45°");
  assert.deepEqual(buscar(r, "FZOC.T2").etapas, [1, 4]);
  assert.deepEqual(buscar(r, "ZOC.T1").etapas, [1]);
});

test("planilla — nombre repetido: el segundo renglón pasa a 'nombre (2)' con aviso", () => {
  const r = leer(PLANILLA);
  assert.ok(buscar(r, "M.central-91"));
  assert.equal(buscar(r, "M.central-91 (2)").l2, 600);
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /M\.central-91" está repetido/);
  assert.equal(new Set(r.renglones.map((x) => x.nombre)).size, r.renglones.length);
});

test("planilla — hoja CUT RITE: mismas piezas y cantos; sin columnas de procesos ni 45°, ninguna pieza las lleva (con aviso)", () => {
  const r = leer(CUT_RITE);
  assert.deepEqual(r.sinColumna.map((x) => x.nombre), ["CNC", "Corte especial"]);
  assert.equal(expandirPiezas(r.renglones).length, 218);
  const planilla = leer(PLANILLA);
  for (const x of r.renglones) {
    assert.equal(x.etapas.includes(2), buscar(planilla, x.nombre).etapas.includes(2), `canto de ${x.nombre}`);
    assert.ok(x.etapas.includes(1));
    assert.ok(!x.etapas.includes(3) && !x.etapas.includes(4));
  }
});

test("reglas — las etapas de cada empresa, con los nombres de columna que elija", () => {
  assert.deepEqual(REGLAS.map((r) => [r.codigo, r.columnas.length]), [[1, 0], [2, 5], [3, 8], [4, 5]], "Armado no se escanea por pieza");
  assert.deepEqual(columnasDeTexto(" Canto ; L1A,,L1B\nL2A "), ["Canto", "L1A", "L1B", "L2A"]);
  assert.deepEqual(reglasPieza([{ codigo: 9, nombre: "X", por_pieza: true, activa: false }, { codigo: 0, nombre: "Sin tarea", por_pieza: true }]), [], "dadas de baja o sin código no");
  assert.deepEqual(nombresEtapas(ETAPAS)[4], "Corte especial");
  // Otra empresa, con otros nombres y otro orden: Pintura solo para las piezas con algo en "Color"
  const otra = reglasPieza([
    { codigo: 20, nombre: "Pintura", por_pieza: true, orden: 2, columna_pieza: "Color" },
    { codigo: 10, nombre: "Plegado", por_pieza: true, orden: 1 },
  ]);
  const r = leerPiezas("PIEZA\tL1\tL2\tCANT\tCOLOR\nP-1\t100\t50\t2\tNegro\nP-2\t100\t50\t1\t", otra);
  assert.deepEqual(r.renglones.map((x) => [x.nombre, x.etapas]), [["P-1", [10, 20]], ["P-2", [10]]]);
  // Sin etapas por pieza, las piezas quedan sin etapas
  assert.deepEqual(leerPiezas("PIEZA\tL1\tL2\tCANT\nP-1\t100\t50\t2", []).renglones[0].etapas, []);
});

test("planilla — sin títulos, sin cantidad o cantidad rara", () => {
  assert.match(leerPiezas("M.izq-11\tMDF\t402\t342\t2").faltaColumnas[0], /títulos/);
  assert.deepEqual(leerPiezas("PANEL\tMATERIAL\tL1\tL2\nA-1\tMDF\t1\t2").faltaColumnas, ["CANT."]);
  const r = leer("PANEL\tL1\tL2\tCANT\nA-3\t400\t300\t2\nA-1\t400\t300\t\nA-2\t400\t300\t2,5\n0\t0\t0\t0");
  assert.deepEqual(r.errores.map((e) => e.fila), [3, 4]);
  assert.match(r.errores[0].motivo, /no tiene cantidad/);
  assert.match(r.errores[1].motivo, /2,5/);
  assert.deepEqual(r.renglones.map((x) => x.nombre), ["A-3"]);
  assert.deepEqual(r.renglones[0].etapas, [1], "sin columnas de cantos, procesos ni 45°: solo Corte");
  assert.equal(r.sinColumna.length, 3);
});

test("piezas — una por unidad física, agrupar, reemplazar y ayudas", () => {
  const piezas = expandirPiezas([{ nombre: "A-1", modulo: "A", cantidad: 3, etapas: [1] }, { nombre: "B", cantidad: 1, etapas: [1] }]);
  assert.deepEqual(piezas.map((p) => `${p.nombre} ${p.unidad} de ${p.de} r${p.renglon}`), ["A-1 1 de 3 r0", "A-1 2 de 3 r0", "A-1 3 de 3 r0", "B 1 de 1 r1"]);
  const renglones = agruparRenglones([...piezas].reverse());
  assert.deepEqual(renglones.map((r) => [r.nombre, r.piezas.map((p) => p.unidad)]), [["A-1", [1, 2, 3]], ["B", [1]]]);
  const nuevas = expandirPiezas([{ nombre: "A-1", cantidad: 2, etapas: [1] }, { nombre: "C", cantidad: 2, etapas: [1] }]);
  assert.deepEqual(cambiosAlReemplazar(piezas, nuevas), { nuevas: 2, siguen: 2, salen: 2 });
  assert.equal(moduloDe("M.der-CAJ1-FRENTE"), "M.der");
  assert.equal(moduloDe("-raro"), null);
  assert.equal(tieneValor("0.45-"), true);
  for (const v of ["", "0", "0 0", "-", "#REF!", "#VALUE!", "No"]) assert.equal(tieneValor(v), false, v);
  assert.equal(medidas({ l1: 1568, l2: 342 }), "1.568 × 342");
});

test("QR — 'OT M-7495 - PIEZA - 1234' ida y vuelta; la carga lo lee como pieza, no como la OT", () => {
  assert.equal(textoQrPieza("M-7495", 1234), "OT M-7495 - PIEZA - 1234");
  assert.deepEqual(leerQrPieza(" ot M-7495 - pieza - 1234 "), { ot: "M-7495", id: 1234 });
  assert.equal(leerQrPieza("OT M-7495 - BULTO 1 DE 4 - M.izq"), null);
  assert.equal(leerQrPieza("OT M-7495"), null);
  assert.deepEqual(leerQr("OT M-7495 - PIEZA - 1234"), { ot: "M-7495", piezaId: 1234 }, "en la carga busca el suelto que se llama como la pieza");
});

test("etiquetas — una página por pieza con OT, nombre, 'n de N', medidas, módulo, etapas y QR", async () => {
  const html = await htmlEtiquetasPiezas({
    empresa: "GI", ot: "M-7495", tamano: { ancho: 100, alto: 50 },
    nombres: nombresEtapas(ETAPAS),
    piezas: [
      { id: 10, nombre: "M.izq-11", modulo: "M.izq", material: "ENCHAPADO 19MM", l1: 402, l2: 342, unidad: 1, de: 2, etapas: [1, 2, 3] },
      { id: 11, nombre: "<script>", unidad: 2, de: 2, etapas: [1] },
    ],
  });
  assert.equal((html.match(/class="etiqueta"/g) || []).length, 2);
  assert.match(html, /@page \{ size: 100mm 50mm/);
  assert.match(html, /GI · OT M-7495/);
  assert.match(html, /1 de 2 · 402 × 342/);
  assert.match(html, /Módulo M\.izq/);
  assert.match(html, /Corte › Canto › CNC · N° 10/);
  assert.match(html, /N° 11/);
  assert.equal((html.match(/<svg/g) || []).length, 2);
  assert.doesNotMatch(html, /<script>/);
});

test("esquema y permisos — renglones válidos, nombres únicos, tope de piezas; la tabla solo se lee por /api/data", () => {
  const r = { nombre: "A-1", cantidad: 2, etapas: [3, 1, 3] };
  const ok = piezasBody.safeParse({ accion: "cargar", ot: "7495", renglones: [r] });
  assert.ok(ok.success);
  assert.deepEqual(ok.data.renglones[0].etapas, [3, 1], "sin repetidas (el orden lo pone el servidor)");
  assert.ok(!piezasBody.safeParse({ accion: "cargar", ot: "7495", renglones: [r, r] }).success, "nombres repetidos");
  assert.ok(!piezasBody.safeParse({ accion: "cargar", ot: "7495", renglones: [{ ...r, cantidad: 1.5 }] }).success);
  assert.ok(piezasBody.safeParse({ accion: "cargar", ot: "7495", renglones: [{ ...r, etapas: [] }] }).success, "sin etapas por pieza");
  assert.ok(!piezasBody.safeParse({ accion: "cargar", ot: "7495", renglones: [{ ...r, etapas: ["corte"] }] }).success);
  assert.ok(!piezasBody.safeParse({ accion: "cargar", ot: "7495", renglones: [{ ...r, etapas: [0] }] }).success);
  const muchos = Array.from({ length: 7 }, (_, i) => ({ nombre: `P${i}`, cantidad: 500, etapas: [1] }));
  assert.ok(!piezasBody.safeParse({ accion: "cargar", ot: "7495", renglones: muchos }).success, "más de 3000 piezas");
  assert.ok(!piezasBody.safeParse({ accion: "cargar", ot: "7495", renglones: [{ ...r, empresa_id: E }] }).success);
  assert.ok(piezasBody.safeParse({ accion: "etapas", ot: "7495", nombre: "A-1", etapas: [1] }).success);
  assert.equal(autorizar("piezas_ot", "GET", { rol: "operativo" }).ok, true);
  for (const m of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar("piezas_ot", m, { rol: "gerencial" }).ok, false, m);
});

test("migración 109 — tabla de piezas con RLS por empresa y una fila por unidad", () => {
  const sql = readFileSync(new URL("../supabase/migrations/109_piezas_ot.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.piezas_ot/);
  assert.match(sql, /unique \(empresa_id, ot, nombre, unidad\)/);
  assert.match(sql, /etapas <@ array\['corte', 'canto', 'cnc', 'especial'\]::text\[\]/);
  assert.match(sql, /alter table public\.piezas_ot enable row level security/);
  assert.match(sql, /using \(empresa_id = \(current_setting\('request\.jwt\.claims', true\)::json->>'eid'\)::uuid\)/);
  assert.match(sql, /grant select, insert, update, delete on public\.piezas_ot to authenticated/);
  assert.match(sql, /grant usage, select on sequence public\.piezas_ot_id_seq to authenticated/);
  assert.doesNotMatch(sql, /to anon/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

function req(body, t) {
  return new Request("http://localhost/api/piezas", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
  });
}

function mock({ existe = true, actuales = [], falla = null, sin112 = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (u) => u.includes("/rest/v1/etapas?"),
      respond: () => (sin112
        ? { status: 400, body: { code: "42703", message: "column etapas.por_pieza does not exist" } }
        : { status: 200, body: ETAPAS }),
    },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: existe ? [{ id: 1, ot: "M-7495" }] : [] }) },
    {
      match: (u, o) => u.includes("/rest/v1/piezas_ot") && (!o?.method || o.method === "GET"),
      respond: () => (falla ? { status: 404, body: { message: falla } } : { status: 200, body: actuales }),
    },
    {
      match: (u, o) => u.includes("/rest/v1/piezas_ot") && ["POST", "PATCH", "DELETE"].includes(o?.method),
      respond: (u, o) => {
        if (falla) return { status: 404, body: { message: falla } };
        const body = o.body ? JSON.parse(o.body) : null;
        escrito.push({ metodo: o.method, url: u, body, prefer: o.headers?.Prefer });
        return { status: 200, body: o.method === "PATCH" ? [{ id: 1 }, { id: 2 }] : [] };
      },
    },
  ]);
  return escrito;
}

test("/api/piezas — cargar: una fila por unidad, upsert que conserva ids y borra lo que ya no está", async () => {
  const { renglones } = leer(PLANILLA);
  let escrito = mock();
  let res = await api.POST(req({ accion: "cargar", ot: "M-7495", renglones }, await token("administrativo")));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, piezas: 218, nuevas: 218, siguen: 0, salen: 0 });
  assert.equal(escrito.length, 1, "un lote; nada que borrar");
  assert.match(escrito[0].url, /piezas_ot\?on_conflict=empresa_id,ot,nombre,unidad$/);
  assert.match(escrito[0].prefer, /resolution=merge-duplicates/);
  assert.equal(escrito[0].body.length, 218);
  const fila = escrito[0].body.find((f) => f.nombre === "M.izq-11" && f.unidad === 2);
  assert.equal(fila.de, 2);
  assert.equal(fila.empresa_id, E);
  assert.equal(fila.ot, "M-7495");
  assert.equal(fila.creado_por, EMP);
  assert.deepEqual(fila.etapas, [1, 2, 3]);
  assert.equal(new Set(escrito[0].body.map((f) => Object.keys(f).sort().join())).size, 1, "mismas claves en todas las filas");

  escrito = mock({ actuales: [{ nombre: "M.izq-11", unidad: 1 }, { nombre: "VIEJA", unidad: 1 }] });
  res = await api.POST(req({ accion: "cargar", ot: "M-7495", renglones }, await token("gerencial")));
  assert.deepEqual(await res.json(), { ok: true, piezas: 218, nuevas: 217, siguen: 1, salen: 1 });
  const borrar = escrito.find((x) => x.metodo === "DELETE");
  const cargada = escrito[0].body[0].cargada_at;
  assert.match(borrar.url, new RegExp(`empresa_id=eq\\.${E}&ot=eq\\.M-7495&cargada_at=lt\\.${encodeURIComponent(cargada).replace(/\./g, "\\.")}`));
});

test("/api/piezas — etapas de un renglón, vaciar; el operario no puede", async () => {
  let escrito = mock();
  for (const body of [{ accion: "cargar", ot: "M-7495", renglones: [{ nombre: "A", cantidad: 1, etapas: [1] }] }, { accion: "vaciar", ot: "M-7495" }]) {
    const res = await api.POST(req(body, await token("operativo")));
    assert.equal(res.status, 403, body.accion);
  }
  assert.equal(escrito.length, 0);

  let res = await api.POST(req({ accion: "etapas", ot: "M-7495", nombre: "Bast.TV-21/31", etapas: [2, 1, 5, 77] }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, etapas: [1, 2], piezas: 2 }, "en el orden de las etapas; Armado y las que no existen no");
  assert.equal(escrito[0].metodo, "PATCH");
  assert.match(escrito[0].url, /&nombre=eq\.Bast\.TV-21%2F31$/);
  assert.deepEqual(escrito[0].body, { etapas: [1, 2] });

  escrito = mock();
  res = await api.POST(req({ accion: "vaciar", ot: "M-7495" }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "DELETE");
  assert.match(escrito[0].url, new RegExp(`piezas_ot\\?empresa_id=eq\\.${E}&ot=eq\\.M-7495$`));
});

test("/api/piezas — OT que no existe y falta de las migraciones 109 o 112", async () => {
  let escrito = mock({ existe: false });
  let res = await api.POST(req({ accion: "vaciar", ot: "9999" }, await token("gerencial")));
  assert.equal(res.status, 404);
  assert.equal(escrito.length, 0);

  mock({ falla: 'relation "public.piezas_ot" does not exist' });
  res = await api.POST(req({ accion: "cargar", ot: "M-7495", renglones: [{ nombre: "A", cantidad: 1, etapas: [1] }] }, await token("gerencial")));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 109/);

  escrito = mock({ sin112: true });
  res = await api.POST(req({ accion: "cargar", ot: "M-7495", renglones: [{ nombre: "A", cantidad: 1, etapas: [1] }] }, await token("gerencial")));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 112/);
  assert.equal(escrito.length, 0);
});

// ─── Pantalla ───

function mockPantalla(filas = []) {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes("/api/piezas")) {
      const body = JSON.parse(opts.body);
      pedidos.push(body);
      if (body.accion === "cargar") {
        const piezas = expandirPiezas(body.renglones);
        filas = piezas.map((p, i) => ({ ...p, id: 500 + i }));
        return new Response(JSON.stringify({ ok: true, piezas: piezas.length, nuevas: piezas.length, siguen: 0, salen: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, etapas: body.etapas }), { status: 200 });
    }
    // Sin escaneos (parte 18)
    if (String(opts.body || "").includes("pasos_pieza")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    if (String(opts.body || "").includes("etapas?empresa_id")) return new Response(JSON.stringify({ data: ETAPAS }), { status: 200 });
    return new Response(JSON.stringify({ data: filas }), { status: 200 });
  };
  return pedidos;
}

const PROYECTO = { ot: "M-7495", cliente: "Mueble divisorio TV" };

test("pantalla — técnica pega la hoja PLANILLA, ve el resumen y guarda", async () => {
  const pedidos = mockPantalla([]);
  render(<PiezasOt proyecto={PROYECTO} empresaId={E} esGestion onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("Esta OT todavía no tiene piezas cargadas.")));
  fireEvent.click(screen.getByText("📋 Pegar la planilla técnica"));
  fireEvent.change(screen.getByRole("textbox", { name: "Pegar la planilla técnica" }), { target: { value: PLANILLA } });
  assert.ok(screen.getByText("218 piezas en 47 renglones"));
  assert.ok(screen.getByText(/M\.central-91" está repetido/));
  assert.equal(screen.queryAllByText(/No encontré la columna/).length, 0);
  fireEvent.click(screen.getByText("Guardar 218 piezas"));
  await waitFor(() => assert.ok(screen.getByText("Listo: la OT tiene 218 piezas.")));
  assert.equal(pedidos[0].accion, "cargar");
  assert.equal(pedidos[0].renglones.length, 47);
  await waitFor(() => assert.ok(screen.getByText("🖨 Imprimir 218 etiquetas")));
  assert.ok(screen.getByText(/218 piezas · 47 renglones · \d+ módulos/));
});

test("pantalla — CUT RITE avisa que ninguna queda con CNC; se corrige por renglón", async () => {
  const pedidos = mockPantalla([
    { id: 1, nombre: "M.izq-11", modulo: "M.izq", l1: 402, l2: 342, unidad: 1, de: 2, renglon: 0, etapas: [1, 2, 3] },
    { id: 2, nombre: "M.izq-11", modulo: "M.izq", l1: 402, l2: 342, unidad: 2, de: 2, renglon: 0, etapas: [1, 2, 3] },
  ]);
  render(<PiezasOt proyecto={PROYECTO} empresaId={E} esGestion onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("🖨 Imprimir 2 etiquetas")));
  fireEvent.click(screen.getByText("📋 Volver a pegar la planilla (si cambió)"));
  fireEvent.change(screen.getByRole("textbox", { name: "Pegar la planilla técnica" }), { target: { value: CUT_RITE } });
  assert.ok(screen.getByText(/No encontré la columna FF, RAN, .* para CNC: ninguna pieza queda con CNC/));
  assert.ok(screen.getByText(/para Corte especial: ninguna pieza queda con Corte especial/));
  assert.ok(screen.getByText(/2 quedan como estaban/));
  fireEvent.click(screen.getByText("Cancelar"));

  const cnc = screen.getByLabelText("CNC en M.izq-11");
  assert.equal(cnc.getAttribute("aria-pressed"), "true");
  fireEvent.click(cnc);
  await waitFor(() => assert.equal(screen.getByLabelText("CNC en M.izq-11").getAttribute("aria-pressed"), "false"));
  assert.deepEqual(pedidos[0], { accion: "etapas", ot: "M-7495", nombre: "M.izq-11", etapas: [1, 2] });
});

test("pantalla — el operario ve las piezas y sus etapas, sin pegar ni cambiar", async () => {
  mockPantalla([{ id: 1, nombre: "1-FONDO", modulo: "1", material: "FIBROPLUS 3MM", l1: 523, l2: 288, unidad: 1, de: 1, renglon: 0, etapas: [1] }]);
  render(<PiezasOt proyecto={PROYECTO} empresaId={E} onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("523 × 288 · FIBROPLUS 3MM · Módulo 1")));
  assert.equal(screen.queryAllByText(/Pegar la planilla/).length, 0);
  assert.equal(screen.queryAllByRole("button", { name: /en 1-FONDO/ }).length, 0);
  assert.ok(screen.getByText("Corte"));
  assert.ok(screen.getByLabelText("Imprimir las etiquetas de 1-FONDO"));
});
