// tests/canto-consumo.test.jsx — Consumo de canto desde los escaneos (pedido
// de Tadeo, 26/11; migración 210): cada lado escaneado en la etapa de canto
// suma su largo (L1 o L2) + 5 % de desperdicio, del tipo de canto que dice la
// planilla (E y COLOR), y la oficina lo asienta en el MRP como consumo de la OT.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  grosorMaterial, claveCanto, textoCanto, medidasArticuloCanto, candidatosCanto, elegirArticuloCanto,
  cantosPegados, cantoUsado, pendientesCanto,
} from "../app/lib/cantoConsumo.js";
import { leerPiezas, expandirPiezas, reglasPieza, espesorCanto } from "../app/lib/piezas.js";
import { piezasBody, cantoUsadoBody } from "../app/lib/schemas.ts";
import { normalizarParametros } from "../app/lib/planificacion.js";
import { opcionesBoton } from "../app/lib/menuGestion.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/stock/canto/route.js");
const { default: CantoUsado, leerMetros } = await import("../app/components/CantoUsado.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const ETAPAS = [
  { codigo: 1, nombre: "Corte", orden: 1, por_pieza: true },
  { codigo: 2, nombre: "Canto", orden: 2, por_pieza: true, columna_pieza: "L1A, L1B, L2A, L2B" },
];
// Como en el catálogo del MRP (hoja ARTICULOS)
const ARTICULOS = [
  { sku: "1.3.1.24.59.2.12.117", nombre: "CANTO ABS 22/045 LISO SIN COLA-Rehau-GRAFITO-1 MT", color: "GRAFITO", unidad: "MT", activo: true },
  { sku: "1.3.1.24.59.2.12.232", nombre: "CANTO ABS 22/2 LISO SIN COLA-Rehau-GRAFITO-1 MT", color: "GRAFITO", unidad: "MT", activo: true },
  { sku: "1.3.1.24.59.2.12.330", nombre: "CANTO ABS 45/045 LISO SIN COLA-Rehau-GRAFITO-1 MT", color: "GRAFITO", unidad: "MT", activo: true },
  { sku: "1.3.1.24.22.2.12.151", nombre: "CANTO ABS 22/045 LISO SIN COLA-Rehau-BLANCO-1 MT", color: "BLANCO", unidad: "MT", activo: true },
  { sku: "1.3.1.24.22.2.12.999", nombre: "CANTO ABS 22/045 TEXTURADO SIN COLA-Rehau-BLANCO-1 MT", color: "BLANCO", unidad: "MT", activo: true },
  { sku: "9.9", nombre: "PERFIL CANTO DE ALUMINIO U 18 MM-S/Marca-NATURAL-1 MT", color: "NATURAL", unidad: "MT", activo: true },
];

// ─── Planilla ───

test("planilla — cada lado con canto guarda espesor, color y largo (L1 para L1 A/B, L2 para L2 A/B)", () => {
  const tsv = [
    ["PANEL", "MATERIAL", "MEDIDAS", "", "", "L1 A", "", "", "L1 B", "", "L2 A", "", "L2 B", ""],
    ["", "", "L1", "L2", "CANT.", "E", "COLOR", "L2", "E", "COLOR", "E", "COLOR", "E", "COLOR"],
    ["A-1", "MELAMINA SOBRE MDF 18MM BLANCO", "791", "328", "2", "0.45-", "GRAFITO", "0", "0", "0", "0.45-", "GRAFITO", "2-", "GRAFITO"],
    ["A-2", "MDF 18MM", "400", "300", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
  ].map((f) => f.join("\t")).join("\n");
  const v = leerPiezas(tsv, reglasPieza(ETAPAS));
  assert.deepEqual(v.renglones[0].cantos, [
    { l: "l1a", e: 0.45, c: "GRAFITO", mm: 791 },
    { l: "l2a", e: 0.45, c: "GRAFITO", mm: 328 },
    { l: "l2b", e: 2, c: "GRAFITO", mm: 328 },
  ]);
  assert.deepEqual(v.renglones[1].cantos, []);
  assert.deepEqual(expandirPiezas(v.renglones).map((p) => p.cantos.length), [3, 3, 0]);
  assert.equal(piezasBody.safeParse({ accion: "cargar", ot: "7961", renglones: v.renglones }).success, true);
  // Sin las columnas de los lados: sin cantos
  assert.equal(leerPiezas("PANEL\tL1\tL2\tCANT.\nB-1\t300\t200\t2", []).renglones[0].cantos, null);
  assert.equal(espesorCanto("0,45"), 0.45);
  assert.equal(espesorCanto("VER PLANO"), null);
});

// ─── Artículo del MRP ───

test("artículo — espesor y ancho del nombre; placa 18 va con canto de 22", () => {
  assert.deepEqual(medidasArticuloCanto("CANTO ABS 22/045 LISO SIN COLA-Rehau-GRAFITO-1 MT"), { ancho: 22, espesor: 0.45 });
  assert.deepEqual(medidasArticuloCanto("CANTO ABS 22/2 LISO SIN COLA"), { ancho: 22, espesor: 2 });
  assert.deepEqual(medidasArticuloCanto("CANTO CONTRAVETA ABS 45/0.8 LISO SIN COLA"), { ancho: 45, espesor: 0.8 });
  assert.equal(medidasArticuloCanto("PERFIL CANTO DE ALUMINIO U 18 MM"), null, "un perfil no es canto");
  assert.equal(grosorMaterial("MELAMINA SOBRE MDF 18MM GRAFITO"), 18);
  assert.equal(grosorMaterial("TAPA"), null);
  const clave = claveCanto({ e: 0.45, c: "grafito" }, 18);
  assert.equal(clave, "0.45|GRAFITO|18");
  assert.equal(textoCanto(clave), "Canto 0,45 mm GRAFITO · placa 18 mm");
  assert.deepEqual(candidatosCanto(clave, ARTICULOS).map((a) => a.sku), ["1.3.1.24.59.2.12.117"], "22 antes que 45");
  assert.deepEqual(candidatosCanto("0.45|GRAFITO|36", ARTICULOS).map((a) => a.sku), ["1.3.1.24.59.2.12.330"], "placa 36: el de 45");
  assert.equal(candidatosCanto("0.45|GRAFITO|", ARTICULOS).length, 2, "sin el espesor de la placa, todos");
});

test("artículo — primero el de las necesidades de la OT, después el elegido antes, después el único", () => {
  const clave = "0.45|BLANCO|18";
  // Liso y texturado: dos opciones, hay que elegir
  const nada = elegirArticuloCanto({ clave, articulos: ARTICULOS });
  assert.equal(nada.sku, null);
  assert.equal(nada.opciones.length, 2);
  const nec = elegirArticuloCanto({ clave, articulos: ARTICULOS, necesidadesOt: new Set(["1.3.1.24.22.2.12.999"]) });
  assert.deepEqual([nec.sku, nec.por], ["1.3.1.24.22.2.12.999", "necesidad"]);
  const rec = elegirArticuloCanto({ clave, articulos: ARTICULOS, recordados: new Map([[clave, "1.3.1.24.22.2.12.151"]]) });
  assert.deepEqual([rec.sku, rec.por], ["1.3.1.24.22.2.12.151", "recordado"]);
  const unico = elegirArticuloCanto({ clave: "2|GRAFITO|18", articulos: ARTICULOS });
  assert.deepEqual([unico.sku, unico.por], ["1.3.1.24.59.2.12.232", "unico"]);
  // Un elegido que ya no está en la planilla no vale
  const viejo = elegirArticuloCanto({ clave, articulos: ARTICULOS, recordados: new Map([[clave, "no-esta"]]) });
  assert.equal(viejo.sku, null);
});

// ─── Metros ───

const PIEZAS = [
  // 2 piezas de 791 × 328 con L1 A (0,45) + L2 A (0,45) + L2 B (2)
  { id: 1, ot: "7961", material: "MDF 18MM", cantos: [{ l: "l1a", e: 0.45, c: "GRAFITO", mm: 791 }, { l: "l2a", e: 0.45, c: "GRAFITO", mm: 328 }, { l: "l2b", e: 2, c: "GRAFITO", mm: 328 }] },
  { id: 2, ot: "7961", material: "MDF 18MM", cantos: [{ l: "l1a", e: 0.45, c: "GRAFITO", mm: 791 }, { l: "l2a", e: 0.45, c: "GRAFITO", mm: 328 }, { l: "l2b", e: 2, c: "GRAFITO", mm: 328 }] },
  { id: 3, ot: "7962", material: "MDF 18MM", cantos: null },
];

test("metros — cada escaneo suma el lado que sigue, la pieza completa suma todos, + desperdicio", () => {
  assert.equal(cantosPegados(PIEZAS[0], 1).length, 1);
  assert.equal(cantosPegados(PIEZAS[0], 9).length, 3, "no más lados que los de la planilla");
  assert.equal(cantosPegados(PIEZAS[0], 0, true).length, 3, "pasó la etapa (por ejemplo, con el módulo): todos");
  assert.equal(cantosPegados(PIEZAS[2], 2).length, 0, "pieza leída antes de la 210: no suma");
  // Pieza 1 con 2 lados (791 + 328 de 0,45); pieza 2 completa
  const usado = cantoUsado({ piezas: PIEZAS, escaneos: new Map([[1, 2]]), completas: new Set([2]), pct: 5 });
  const ot = usado.get("7961");
  assert.deepEqual(ot.get("0.45|GRAFITO|18"), { metros: Math.round((791 + 328) * 2 / 1000 * 1.05 * 100) / 100, lados: 4 });
  assert.deepEqual(ot.get("2|GRAFITO|18"), { metros: Math.round(0.328 * 1.05 * 100) / 100, lados: 1 });
  assert.equal(usado.has("7962"), false);
  // Sin desperdicio
  assert.equal(cantoUsado({ piezas: PIEZAS, escaneos: new Map([[1, 1]]), pct: 0 }).get("7961").get("0.45|GRAFITO|18").metros, 0.79);
});

test("pendiente — lo usado menos lo asentado (sin los anulados); lo ya asentado no vuelve", () => {
  const usado = new Map([["7961", new Map([["0.45|GRAFITO|18", { metros: 2.35, lados: 4 }], ["2|GRAFITO|18", { metros: 0.34, lados: 1 }]])]]);
  const p = pendientesCanto(usado, [{ ot: "7961", canto: "0.45|GRAFITO|18", cantidad: 2 }, { ot: "7999", canto: "2|GRAFITO|18", cantidad: 5 }]);
  assert.deepEqual(p, [{ ot: "7961", renglones: [
    { clave: "0.45|GRAFITO|18", metros: 2.35, lados: 4, asentado: 2, pendiente: 0.35 },
    { clave: "2|GRAFITO|18", metros: 0.34, lados: 1, asentado: 0, pendiente: 0.34 },
  ] }]);
  assert.deepEqual(pendientesCanto(usado, [{ ot: "7961", canto: "0.45|GRAFITO|18", cantidad: 2.35 }, { ot: "7961", canto: "2|GRAFITO|18", cantidad: 0.34 }]), []);
});

test("desperdicio — 5 % si no se cargó, se cambia en Planificación → Parámetros", () => {
  assert.equal(normalizarParametros(null).pct_desperdicio_canto, 5);
  assert.equal(normalizarParametros({ pct_desperdicio_canto: 8 }).pct_desperdicio_canto, 8);
});

test("menú — Canto usado en Materiales, solo para la oficina", () => {
  const empresa = { modulos: null };
  assert.ok(opcionesBoton("inventario", empresa, { rol: "gerencial" }).some((o) => o.id === "canto-usado"));
  assert.equal(opcionesBoton("inventario", empresa, { rol: "operativo" }).some((o) => o.id === "canto-usado"), false);
});

test("migración 210 — cantos por pieza, tipo de canto en el consumo y artículos elegidos con RLS", () => {
  const sql = readFileSync(new URL("../supabase/migrations/210_consumo_canto.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /alter table public\.piezas_ot add column if not exists cantos jsonb/);
  assert.match(sql, /alter table public\.movimientos_stock add column if not exists canto text/);
  assert.match(sql, /create table if not exists public\.canto_articulos/);
  assert.match(sql, /canto_articulos enable row level security/);
  assert.match(sql, /revoke all on public\.canto_articulos from anon/);
});

// ─── Ruta ───

async function token(rol = "gerencial") {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = (t, body) => new Request("http://localhost/api/stock/canto", body
  ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body) }
  : { headers: { Authorization: `Bearer ${t}` } });

function mockRuta({ asentados = [], necesidades = [], recordados = [], etapas = ETAPAS } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/etapas?"), respond: () => ({ status: 200, body: etapas }) },
    { match: (u) => u.includes("/rest/v1/lados_pieza?"), respond: () => ({ status: 200, body: [{ pieza_id: 1 }, { pieza_id: 1 }] }) },
    { match: (u) => u.includes("/rest/v1/pasos_pieza?"), respond: () => ({ status: 200, body: [{ pieza_id: 2 }] }) },
    { match: (u) => u.includes("/rest/v1/piezas_ot?"), respond: () => ({ status: 200, body: PIEZAS.slice(0, 2) }) },
    { match: (u) => u.includes("/rest/v1/config_sistema?"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/necesidades_stock?"), respond: () => ({ status: 200, body: necesidades }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock?"), respond: () => ({ status: 200, body: ARTICULOS }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [{ ot: "7961" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ nombre: "Ana" }] }) },
    {
      match: (u) => u.includes("/rest/v1/movimientos_stock") || u.includes("/rest/v1/canto_articulos"),
      respond: (u, o) => {
        if (o?.method === "POST") { escrito.push({ url: u, body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        return { status: 200, body: u.includes("canto_articulos") ? recordados : asentados };
      },
    },
  ]);
  return escrito;
}

test("/api/stock/canto GET — por OT, lo que falta asentar con su artículo", async () => {
  mockRuta({ asentados: [{ ot: "7961", canto: "2|GRAFITO|18", cantidad: 0.1 }] });
  const res = await api.GET(pedir(await token()));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.pct, 5);
  assert.equal(d.ots.length, 1);
  const [delgado, grueso] = d.ots[0].renglones;
  assert.equal(delgado.clave, "0.45|GRAFITO|18");
  assert.equal(delgado.lados, 4);
  assert.equal(delgado.sku, "1.3.1.24.59.2.12.117");
  assert.equal(delgado.por, "unico");
  assert.equal(delgado.texto, "Canto 0,45 mm GRAFITO · placa 18 mm");
  assert.equal(grueso.asentado, 0.1);
  assert.equal(grueso.pendiente, Math.round((0.34 - 0.1) * 100) / 100);
});

test("/api/stock/canto — solo la oficina; sin etapa por lados avisa", async () => {
  mockRuta();
  assert.equal((await api.GET(pedir(await token("operativo")))).status, 403);
  mockRuta({ etapas: [{ codigo: 1, nombre: "Corte", por_pieza: true }] });
  const d = await (await api.GET(pedir(await token()))).json();
  assert.equal(d.sinEtapa, true);
});

test("/api/stock/canto POST asentar — un consumo por tipo con la OT y la clave; recuerda el artículo", async () => {
  const escrito = mockRuta();
  const res = await api.POST(pedir(await token(), { accion: "asentar", ot: "7961", renglones: [{ clave: "0.45|GRAFITO|18", sku: "1.3.1.24.59.2.12.117", metros: 2.35 }] }));
  assert.equal(res.status, 200);
  const mov = escrito.find((x) => x.url.includes("movimientos_stock")).body;
  assert.equal(mov.length, 1);
  assert.equal(mov[0].tipo, "consumo");
  assert.equal(mov[0].ot, "7961");
  assert.equal(mov[0].cantidad, 2.35);
  assert.equal(mov[0].canto, "0.45|GRAFITO|18");
  assert.equal(mov[0].unidad, "MT");
  assert.match(mov[0].notas, /Canto escaneado en planta/);
  const rec = escrito.find((x) => x.url.includes("canto_articulos"));
  assert.match(rec.url, /on_conflict=empresa_id,clave/);
  assert.deepEqual([rec.body[0].clave, rec.body[0].sku], ["0.45|GRAFITO|18", "1.3.1.24.59.2.12.117"]);
  // Datos mal: clave que no es un tipo de canto
  assert.equal(cantoUsadoBody.safeParse({ accion: "asentar", ot: "7961", renglones: [{ clave: "hola", sku: "A", metros: 1 }] }).success, false);
});

// ─── Pantalla ───

test("pantalla — muestra el canto de cada OT y asienta con el artículo y los metros", async () => {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    if (opts.method === "POST") { enviados.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, cargados: 1 }), { status: 200 }); }
    return new Response(JSON.stringify({
      pct: 5,
      ots: enviados.length ? [] : [{ ot: "7961", renglones: [{ clave: "0.45|BLANCO|18", texto: "Canto 0,45 mm BLANCO · placa 18 mm", metros: 1.2, lados: 3, asentado: 0, pendiente: 1.2, sku: null, por: null,
        opciones: [{ sku: "L", nombre: "CANTO LISO BLANCO" }, { sku: "T", nombre: "CANTO TEXTURADO BLANCO" }] }] }],
      cantos: [],
    }), { status: 200 });
  };
  render(<CantoUsado />);
  await screen.findByText("OT 7961");
  assert.ok(screen.getByText("Canto 0,45 mm BLANCO · placa 18 mm"));
  const boton = screen.getByRole("button", { name: "Asentar en el MRP" });
  assert.equal(boton.disabled, true, "falta elegir el artículo");
  const combo = screen.getByRole("combobox", { name: /Artículo para/ });
  fireEvent.focus(combo);
  fireEvent.change(combo, { target: { value: "liso" } });
  fireEvent.keyDown(combo, { key: "Enter" });
  fireEvent.change(screen.getByLabelText(/Metros de/), { target: { value: "1,5" } });
  fireEvent.click(boton);
  await screen.findByText(/1 consumo asentado en el MRP/);
  assert.deepEqual(enviados[0], { accion: "asentar", ot: "7961", renglones: [{ clave: "0.45|BLANCO|18", sku: "L", metros: 1.5 }] });
  assert.equal(leerMetros("1.234,5"), 1234.5);
  assert.equal(leerMetros("0"), null);
  await waitFor(() => assert.ok(screen.getByText(/No hay canto para asentar/)));
});
