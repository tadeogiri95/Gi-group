// tests/listas-precios.test.jsx — Listas de precios de proveedores (migración
// 169): leer Excel o CSV y encontrar solas las columnas, guardar listas
// grandes en tandas, reconocer artículos, y en Sin asociar sugerencias,
// buscador por documento y "No es del MRP".
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  parsearCsv, detectarColumnas, renglonesDeGrilla, numeroCelda, sacarIva, sugerirParecidos, proveedorDeArchivo, letraColumna, rolDeTitulo,
} from "../app/lib/listasPrecios.js";
import { validarFactura, reconocerRenglon, borradorDeLectura, ESQUEMA_FACTURA, MAX_RENGLONES_LISTA } from "../app/lib/facturasSueltas.js";
import { leerHojaXlsx } from "../app/lib/leerXlsx.js";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/facturas-sueltas/route.js");
const { default: FacturasSueltas } = await import("../app/components/FacturasSueltas.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const ARTICULOS = [
  { sku: "1.10", nombre: "MELAMINA BLANCA 18MM" },
  { sku: "2.20", nombre: "CANTO ABS BLANCO 22MM" },
  { sku: "3.30", nombre: "BISAGRA CAZOLETA 35 CODO 0" },
];

const CSV = [
  "LISTA DE PRECIOS FAPLAC;;;;",
  "Vigencia noviembre 2026;;;;",
  ";;;;",
  "Código;Descripción;Unidad;Precio s/IVA;Precio c/IVA",
  "M18;MELAMINA BLANCA 18MM;placa;$ 45.000,50;$ 54.450,61",
  ";HERRAJES;;;",
  '202;"Bisagra cazoleta 35; codo 0";u;1.234;1.493,14',
  "999;Pegamento de contacto;lata;8.500;10.285",
].join("\n");

test("CSV — separador, comillas, títulos debajo del encabezado y columnas solas", () => {
  const g = parsearCsv(CSV);
  assert.equal(g[6][1], "Bisagra cazoleta 35; codo 0");
  const c = detectarColumnas(g);
  assert.deepEqual([c.titulos, c.codigo, c.descripcion, c.precio, c.porTitulos], [3, 0, 1, 3, true], "precio sin IVA antes que con IVA");
  const { renglones, salteados } = renglonesDeGrilla(g, c);
  assert.deepEqual(renglones.map((r) => [r.codigo, r.precio, r.cantidad]), [["M18", 45000.5, 1], ["202", 1234, 1], ["999", 8500, 1]]);
  assert.equal(salteados, 1, "el título de rubro HERRAJES no es un renglón");
  assert.deepEqual(parsearCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parsearCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
});

test("títulos — qué es cada columna; moneda y IVA por el título del precio", () => {
  assert.equal(rolDeTitulo("Cód. Artículo"), "codigo");
  assert.equal(rolDeTitulo("Descripción del artículo"), "descripcion");
  assert.equal(rolDeTitulo("Precio Lista"), "precio");
  assert.equal(rolDeTitulo("Unidad"), null);
  const c = detectarColumnas([["Producto", "Precio USD c/IVA"], ["Placa", "10"]]);
  assert.deepEqual([c.moneda, c.conIva, c.codigo], ["USD", true, -1]);
});

test("sin títulos — precio = números más a la derecha, descripción = textos más largos", () => {
  const g = [["101", "Placa MDF 18mm blanco", "45000.5"], ["102", "Placa MDF 15mm negro", "40000"], ["103", "Bisagra codo cero", "12.5"]];
  const c = detectarColumnas(g, { excel: true });
  assert.deepEqual([c.titulos, c.codigo, c.descripcion, c.precio, c.porTitulos], [-1, 0, 1, 2, false]);
  assert.equal(renglonesDeGrilla(g, c, { excel: true }).renglones.length, 3);
});

test("números — formato argentino, de Excel, con $ y sin confundir textos", () => {
  assert.equal(numeroCelda("$ 1.234,56"), 1234.56);
  assert.equal(numeroCelda("1.234"), 1234, "punto con tres cifras = mil");
  assert.equal(numeroCelda("0.125"), 0.125);
  assert.equal(numeroCelda("1,234.56"), 1234.56);
  assert.equal(numeroCelda("12,5"), 12.5);
  assert.equal(numeroCelda("1.234.567"), 1234567);
  assert.equal(numeroCelda("U$S 10"), 10);
  assert.equal(numeroCelda("18mm"), null);
  assert.equal(numeroCelda("Placa 18"), null);
  assert.equal(numeroCelda("1.234", { excel: true }), 1.234, "del Excel ya viene con punto decimal");
});

test("Excel — se lee la hoja y salen los renglones", () => {
  const filas = [["Lista Rehau"], [], ["Código", "Descripción", "Precio neto"], ["C22", "CANTO ABS BLANCO 22MM", 950.75], ["", "Total", ""]];
  const compartidos = [];
  const idx = (s) => (compartidos.includes(s) ? compartidos.indexOf(s) : compartidos.push(s) - 1);
  const xml = filas.map((f, i) => `<row r="${i + 1}">${f.map((v, c) => (v === "" ? "" : typeof v === "number" ? `<c r="${letraColumna(c)}${i + 1}"><v>${v}</v></c>` : `<c r="${letraColumna(c)}${i + 1}" t="s"><v>${idx(v)}</v></c>`)).join("")}</row>`).join("");
  const bytes = zipSync({
    "xl/workbook.xml": strToU8('<workbook xmlns:r="x"><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`),
    "xl/sharedStrings.xml": strToU8(`<sst>${compartidos.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`),
  });
  const g = leerHojaXlsx(bytes, "Hoja1");
  const c = detectarColumnas(g, { excel: true });
  assert.deepEqual(renglonesDeGrilla(g, c, { excel: true }).renglones, [{ descripcion: "CANTO ABS BLANCO 22MM", codigo: "C22", cantidad: 1, precio: 950.75 }]);
});

test("ayudas — sacar IVA, proveedor por el nombre del archivo, sugerencias parecidas", () => {
  assert.deepEqual(sacarIva([{ precio: 121 }, { precio: "" }]).map((r) => r.precio), [100, ""]);
  assert.equal(proveedorDeArchivo("Lista de precios Faplac 11-2026.xlsx"), "Faplac");
  assert.deepEqual(sugerirParecidos("Bisagra cazoleta 35mm codo 0", ARTICULOS).map((a) => a.sku), ["3.30"]);
  assert.deepEqual(sugerirParecidos("Flete", ARTICULOS), []);
});

test("validar lista — tipo, cantidad 1 por defecto, hasta 5000 renglones", () => {
  const v = validarFactura({ tipo: "lista", proveedor: "Faplac", fecha: "2026-11-08", carga: "planilla", renglones: [{ descripcion: "a", precio: 10 }] });
  assert.equal(v.factura.tipo, "lista");
  assert.equal(v.factura.carga, "planilla");
  assert.equal(v.renglones[0].cantidad, 1);
  assert.equal(validarFactura({ proveedor: "X", fecha: "2026-11-08", renglones: [{ descripcion: "a", precio: 10 }] }).error, "Renglón 1: la cantidad tiene que ser mayor que 0", "en factura la cantidad sigue siendo obligatoria");
  const muchos = Array.from({ length: 300 }, (_, i) => ({ descripcion: `a${i}`, precio: 1 }));
  assert.ok(validarFactura({ proveedor: "X", fecha: "2026-11-08", renglones: muchos.map((r) => ({ ...r, cantidad: 1 })) }).error, "factura: hasta 200");
  assert.equal(validarFactura({ tipo: "lista", proveedor: "X", fecha: "2026-11-08", renglones: muchos }).renglones.length, 300);
  const demas = Array.from({ length: MAX_RENGLONES_LISTA + 1 }, () => ({ descripcion: "a", precio: 1 }));
  assert.match(validarFactura({ tipo: "lista", proveedor: "X", fecha: "2026-11-08", renglones: demas }).error, /partila/);
});

test("reconocer — rápido con miles de renglones y miles de artículos", () => {
  const articulos = Array.from({ length: 8000 }, (_, i) => ({ sku: `9.${i}`, nombre: `ARTICULO NUMERO ${i}` }));
  const asociaciones = [{ tipo: "codigo", clave: "x5", sku: "9.5" }];
  const t0 = Date.now();
  let hallados = 0;
  for (let i = 0; i < 5000; i++) if (reconocerRenglon({ descripcion: `Articulo numero ${i}`, codigo: i === 1 ? "X5" : "" }, { asociaciones, articulos })) hallados++;
  assert.equal(hallados, 5000);
  assert.ok(Date.now() - t0 < 2000, "se arma el índice una sola vez");
  assert.deepEqual(reconocerRenglon({ descripcion: "otra cosa", codigo: "X5" }, { asociaciones, articulos }), { sku: "9.5", como: "codigo" });
});

test("IA — distingue factura de lista; en una lista la cantidad es 1", () => {
  assert.ok(ESQUEMA_FACTURA.required.includes("tipo_documento"));
  const b = borradorDeLectura({ tipo_documento: "lista", proveedor: "Faplac", fecha: "2026-11-01", renglones: [{ descripcion: "Placa", codigo: "", cantidad: 0, precio_unitario: 100 }] });
  assert.equal(b.tipo, "lista");
  assert.equal(b.renglones[0].cantidad, 1);
  assert.equal(borradorDeLectura({ renglones: [] }).tipo, "factura");
});

test("migración 169 — tipo, 'descartado' y carga 'planilla' sin tocar los otros controles", () => {
  const sql = readFileSync(new URL("../supabase/migrations/169_listas_precios.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/^do \$mig\$/gm) || []).length, 1);
  assert.match(sql, /add column if not exists tipo text not null default 'factura'/);
  assert.match(sql, /'manual', 'ia', 'planilla'/);
  assert.match(sql, /'nombre', 'manual', 'descartado'/);
  assert.match(sql, /\\mcarga\\M/, "no borra el control de cargada_por_nombre");
  assert.ok(MIGRACIONES.some((m) => m.n === 169 && m.tablas.facturas_sueltas.includes("tipo")));
});

// ─── API ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const post = async (rol, body) => api.POST(new Request("http://localhost/api/facturas-sueltas", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, body: JSON.stringify(body),
}));
const get = async (q) => api.GET(new Request(`http://localhost/api/facturas-sueltas${q}`, { headers: { Authorization: `Bearer ${await token("gerencial")}` } }));

function mockApi() {
  const escrito = [];
  const leidos = [];
  let sig = 100;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ nombre: "Ana" }] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock?"), respond: () => ({ status: 200, body: ARTICULOS }) },
    { match: (u, o) => u.includes("/rest/v1/asociaciones_articulos") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ tipo: "codigo", clave: "202", sku: "3.30" }] }) },
    {
      match: (u) => /\/rest\/v1\/(facturas_sueltas|facturas_sueltas_renglones|asociaciones_articulos|precios_articulos)/.test(u),
      respond: (u, o) => {
        const metodo = o?.method || "GET";
        const tabla = /rest\/v1\/(\w+)/.exec(u)[1];
        const body = o?.body ? JSON.parse(o.body) : null;
        if (metodo === "GET") { leidos.push(u); return { status: 200, body: [], headers: { "content-range": "0-0/7" } }; }
        escrito.push({ metodo, tabla, url: u, body });
        if (metodo === "POST" && (tabla === "facturas_sueltas" || tabla === "facturas_sueltas_renglones")) {
          return { status: 201, body: (Array.isArray(body) ? body : [body]).map((f) => ({ id: sig++, ...f })) };
        }
        if (metodo === "PATCH") return { status: 200, body: [{ id: 1, ...body }, { id: 2, ...body }] };
        return { status: 200, body: [] };
      },
    },
  ]);
  return { escrito, leidos };
}

test("/api/facturas-sueltas — guardar una lista grande en tandas, reconociendo por código recordado", async () => {
  const { escrito } = mockApi();
  const renglones = Array.from({ length: 1500 }, (_, i) => ({ descripcion: i === 0 ? "Melamina blanca 18mm" : `Cosa ${i}`, codigo: i === 1 ? "202" : "", precio: 10 + i }));
  const res = await post("administrativo", { accion: "guardar", tipo: "lista", carga: "planilla", proveedor: "Faplac", numero: "Lista nov", fecha: "2026-11-08", moneda: "ARS", renglones });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual([d.asociados, d.sinAsociar], [2, 1498]);
  const cab = escrito.find((w) => w.tabla === "facturas_sueltas" && w.metodo === "POST").body;
  assert.deepEqual([cab.tipo, cab.carga], ["lista", "planilla"]);
  const tandas = escrito.filter((w) => w.tabla === "facturas_sueltas_renglones" && w.metodo === "POST");
  assert.deepEqual(tandas.map((t) => t.body.length), [1000, 500]);
  assert.deepEqual(tandas[0].body.slice(0, 2).map((r) => [r.sku, r.asociado_como, r.cantidad]), [["1.10", "nombre", 1], ["3.30", "codigo", 1]]);
  assert.equal(escrito.filter((w) => w.tabla === "precios_articulos").reduce((s, w) => s + w.body.length, 0), 2);
});

test("/api/facturas-sueltas — No es del MRP de a uno o todo lo que queda de una lista, y deshacer", async () => {
  const { escrito } = mockApi();
  let res = await post("administrativo", { accion: "descartar", renglon_ids: [5, 6] });
  assert.equal(res.status, 200);
  let patch = escrito.at(-1);
  assert.match(patch.url, /facturas_sueltas_renglones\?id=in\.\(5,6\)&empresa_id=eq\..*&sku=is\.null&asociado_como=is\.null/);
  assert.deepEqual([patch.body.asociado_como, patch.body.asociado_por_nombre], ["descartado", "Ana"]);

  res = await post("administrativo", { accion: "descartar", factura_id: 12 });
  assert.equal((await res.json()).descartados, 2);
  assert.match(escrito.at(-1).url, /factura_id=eq\.12&empresa_id=eq\..*&sku=is\.null&asociado_como=is\.null/, "solo los que siguen sin asociar");

  assert.equal((await post("administrativo", { accion: "descartar", renglon_ids: ["x"] })).status, 400);
  assert.equal((await post("administrativo", { accion: "descartar" })).status, 400);
  assert.equal((await post("operativo", { accion: "descartar", factura_id: 12 })).status, 403);

  res = await post("gerencial", { accion: "restaurar", renglon_id: 5 });
  assert.equal(res.status, 200);
  patch = escrito.at(-1);
  assert.match(patch.url, /id=eq\.5&.*asociado_como=eq\.descartado/);
  assert.equal(patch.body.asociado_como, null);
});

test("/api/facturas-sueltas — Sin asociar deja afuera lo que no es del MRP; el total se cuenta sin traer filas", async () => {
  const { leidos } = mockApi();
  const r1 = await (await get("?vista=sin_asociar")).json();
  assert.equal(r1.ok, true);
  assert.ok(leidos.some((u) => u.includes("sku=is.null&asociado_como=is.null") && u.includes("facturas_sueltas!inner(tipo,")));
  const r2 = await (await get("")).json();
  assert.equal(r2.sinAsociar, 7);
});

// ─── Pantalla ───

test("pantalla — subir un CSV muestra las columnas encontradas y guarda una lista", async () => {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/data")) return Response.json({ data: ARTICULOS });
    if (opts.method === "POST") { pedidos.push(JSON.parse(opts.body)); return Response.json({ ok: true, id: 1, asociados: 2, sinAsociar: 1 }); }
    return Response.json({ ok: true, sinAsociar: 0, facturas: [] });
  };
  render(<FacturasSueltas />);
  await waitFor(() => screen.getByText(/Todavía no hay/));
  const file = new File([CSV], "Lista de precios Faplac.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("Archivo de la factura o lista"), { target: { files: [file] } });
  await waitFor(() => screen.getByText(/Gypi encontró los títulos en la fila 4/));
  assert.equal(screen.getByLabelText("Columna de precio").value, "3");
  assert.equal(screen.getByRole("radio", { name: /Lista de precios/ }).getAttribute("aria-checked"), "true");
  assert.equal(screen.getByLabelText("Proveedor").value, "Faplac");
  assert.equal(screen.queryByLabelText("Cantidad del renglón 1"), null, "en una lista no se pide cantidad");
  fireEvent.click(screen.getByText("💾 Guardar lista"));
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.equal(pedidos[0].tipo, "lista");
  assert.equal(pedidos[0].carga, "planilla");
  assert.equal(pedidos[0].planilla, undefined, "la planilla entera no viaja");
  assert.deepEqual(pedidos[0].renglones.map((r) => r.precio), [45000.5, 1234, 8500]);
});

test("pantalla — Sin asociar: sugerencia, filtro por documento y No es del MRP", async () => {
  const pedidos = [];
  const doc = { tipo: "lista", proveedor: "Faplac", numero: "Lista nov", fecha: "2026-11-08", moneda: "ARS" };
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/data")) return Response.json({ data: ARTICULOS });
    if (opts.method === "POST") { pedidos.push(JSON.parse(opts.body)); return Response.json({ ok: true, descartados: 2 }); }
    if (u.includes("vista=sin_asociar")) {
      return Response.json({ ok: true, renglones: [
        { id: 9, factura_id: 4, descripcion: "Bisagra cazoleta 35mm codo 0", codigo: "B35", cantidad: 1, precio: 1200, facturas_sueltas: doc },
        { id: 10, factura_id: 4, descripcion: "Flete a obra", codigo: "", cantidad: 1, precio: 5000, facturas_sueltas: doc },
      ] });
    }
    return Response.json({ ok: true, sinAsociar: 2, facturas: [] });
  };
  window.confirm = () => true;
  render(<FacturasSueltas />);
  fireEvent.click(await screen.findByRole("tab", { name: "Sin asociar (2)" }));
  fireEvent.click(await screen.findByText("¿Es BISAGRA CAZOLETA 35 CODO 0?"));
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.deepEqual(pedidos[0], { accion: "asociar", renglon_id: 9, sku: "3.30" });
  fireEvent.click(screen.getAllByText("🚫 No es del MRP")[1]);
  await waitFor(() => assert.equal(pedidos.length, 2));
  assert.deepEqual(pedidos[1], { accion: "descartar", renglon_ids: [10] });
  fireEvent.change(screen.getByLabelText("Buscar en Sin asociar"), { target: { value: "flete" } });
  await waitFor(() => assert.equal(screen.queryByText("Bisagra cazoleta 35mm codo 0"), null));
  fireEvent.change(screen.getByLabelText("Documento"), { target: { value: "4" } });
  fireEvent.click(await screen.findByText(/Los 2 que quedan de este documento no son del MRP/));
  await waitFor(() => assert.equal(pedidos.length, 3));
  assert.deepEqual(pedidos[2], { accion: "descartar", factura_id: 4 });
});
