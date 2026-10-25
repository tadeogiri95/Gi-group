// tests/stock.test.jsx — Stock, parte 13 (ítem 40): artículos y stock leídos
// de la planilla MRP (la planilla manda), pantalla Stock y etiquetas con QR.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  numeroPlanilla, unirArticulos, nivelSemaforo, filtrarArticulos, sugerirArticulos, divisionesDe, cantidadTexto,
  linkArticulo, leerQrArticulo, htmlEtiquetasArticulos, CLAVE_STOCK_CSV,
} from "../app/lib/stock.js";
import { autorizar } from "../app/lib/dataPolicy.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { syncStockEmpresa } = await import("../app/lib/syncStock.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/stock/sync/route.js");
const { default: StockScreen } = await import("../app/components/StockScreen.jsx");
const { default: FichaArticulo } = await import("../app/components/FichaArticulo.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

// Hojas de la planilla MRP GI GROUP, publicadas como CSV (títulos reales)
const INVENTARIO = [
  "SKU,ARTICULO,STOCK TOTAL,NECESIDAD BRUTA,CONSUMO REAL,NECESIDAD PENDIENTE,DISPONIBLE,SEMÁFORO VIEJO,VALORIZACIÓN STOCK,VALORIZACIÓN NEC,VALORIZACIÓN DISP,CONSUMO DIARIO,LEAD TIME (d),STOCK SEGURIDAD,ORIGEN PARÁMETRO,PUNTO DE PEDIDO,PRÓXIMA NECESIDAD,SEMÁFORO MRP,MÚLTIPLO,CANTIDAD SUGERIDA,PRECIO VALORIZACIÓN,DIVISIÓN,EN TRÁNSITO,DISPONIBLE PROYECTADO",
  "2.10.2.52.15,LANA DE VIDRIO 50MM,0,0,0,0,0,,,,,\"0,000\",7,0,DEFECTO,0,,✅ OK,1,,,HIERRO,0,0",
  "3.3.1.6.109.2,0277 TABLILLA NEGRA,0,24,0,24,-24,,,,,\"0,000\",10,0,PROPUESTO,0,10/08/2026,🔴 URGENTE,1,24,,ALUMINIO,0,-24",
  "1.1.1.2.130.1,MELAMINA SOBRE MDF BLANCO,\"1.234,5\",\"15,7\",0,\"15,7\",\"1.218,8\",,,,,\"0,500\",7,2,DEFECTO,4,,⚠️ PEDIR,1,,,MADERA,\"$1.000,00\",0",
  ",,,,,,,,,,,,,,,,,,,,,,,",
  "SIN CODIGO,ALGO SIN SKU,1",
].join("\n");
const ARTICULOS = [
  "ID,ID_SKU,Numero Articulo,Categoría,Nombre normalizado,Nombre Articulo,División,Familia,Tipo de Material,Marca,Color/Acabado,Unidad Medida,Pack/Bulto,Stock_de_seguridad",
  "0a0acaa2b157,2.10.2.52.15,1,C,LANA DE VIDRIO,Lana de vidrio 50 mm,HIERRO,Aislantes,Componente,Isover,S/COLOR,MT2,20 MT2,",
  "6397d35daafe,3.3.1.6.109.2,3,C,0277 TABLILLA,Tablilla 0277 negra,ALUMINIO,Herrajes y Accesorios,Procesable,Aluar,NEGRO,MT,6MT,",
  "aaaaaaaaaaaa,9.9.9,4,C,,Tornillo 4x40,MADERA,Herrajes y Accesorios,Insumo,Fischer,ZINCADO,UN,100 PZ,",
].join("\n");

// ─── Lectura de la planilla ───

test("números — como los escribe la planilla", () => {
  assert.equal(numeroPlanilla("$1.012,00"), 1012);
  assert.equal(numeroPlanilla("15,7"), 15.7);
  assert.equal(numeroPlanilla("-24"), -24);
  assert.equal(numeroPlanilla("1.234"), 1234);
  assert.equal(numeroPlanilla("1.5"), 1.5);
  assert.equal(numeroPlanilla(" 0,000 "), 0);
  assert.equal(numeroPlanilla(""), null);
  assert.equal(numeroPlanilla("#N/A"), null);
  assert.equal(numeroPlanilla("muchos"), null);
});

test("planilla — junta INVENTARIO y ARTICULOS por SKU, con los títulos reales", () => {
  const { filas, sinSku, faltaColumnaSku } = unirArticulos({ inventario: INVENTARIO, articulos: ARTICULOS });
  assert.equal(faltaColumnaSku, false);
  assert.equal(sinSku, 1, "el renglón sin un SKU válido (el vacío ni cuenta)");
  assert.equal(filas.length, 4);
  const porSku = Object.fromEntries(filas.map((f) => [f.sku, f]));

  const tablilla = porSku["3.3.1.6.109.2"];
  assert.equal(tablilla.nombre, "0277 TABLILLA", "el nombre normalizado de ARTICULOS");
  assert.equal(tablilla.unidad, "MT");
  assert.equal(tablilla.familia, "Herrajes y Accesorios");
  assert.equal(tablilla.tipo, "Procesable");
  assert.equal(tablilla.necesidad, 24, "necesidad pendiente, no la bruta");
  assert.equal(tablilla.disponible, -24);
  assert.equal(tablilla.sugerido, 24);
  assert.equal(tablilla.proxima_necesidad, "2026-08-10");
  assert.equal(tablilla.semaforo, "🔴 URGENTE");

  const melamina = porSku["1.1.1.2.130.1"];
  assert.equal(melamina.nombre, "MELAMINA SOBRE MDF BLANCO", "solo en INVENTARIO: el nombre sale de ahí");
  assert.equal(melamina.stock, 1234.5);
  assert.equal(melamina.en_transito, 1000);
  assert.equal(melamina.punto_pedido, 4);
  assert.equal(melamina.unidad, null);

  const tornillo = porSku["9.9.9"];
  assert.equal(tornillo.nombre, "Tornillo 4x40", "solo en ARTICULOS: entra sin stock; sin normalizado usa Nombre Articulo");
  assert.equal(tornillo.stock, null);

  const claves = filas.map((f) => Object.keys(f).sort().join());
  assert.equal(new Set(claves).size, 1, "mismas claves en todas las filas del lote");
});

test("planilla — títulos de la hoja arriba, solo INVENTARIO, o sin columna SKU", () => {
  const conTitulo = unirArticulos({ inventario: `INVENTARIO GI GROUP,,\nAl 14/10,,\nSKU,ARTICULO,STOCK TOTAL\n1.2.3,Bisagra,10` });
  assert.deepEqual(conTitulo.filas.map((f) => [f.sku, f.nombre, f.stock]), [["1.2.3", "Bisagra", 10]]);
  assert.equal(unirArticulos({ inventario: "OT,CLIENTE\nM-1,Juan" }).faltaColumnaSku, true);
});

// ─── Semáforo, búsqueda y QR ───

test("semáforo y búsqueda — urgentes primero, sin acentos, por división", () => {
  assert.equal(nivelSemaforo("🔴 URGENTE"), "rojo");
  assert.equal(nivelSemaforo("⚠️ PEDIR"), "amarillo");
  assert.equal(nivelSemaforo("✅ OK"), "verde");
  assert.equal(nivelSemaforo(""), null);
  const { filas } = unirArticulos({ inventario: INVENTARIO, articulos: ARTICULOS });
  const lista = [...filas, { sku: "0.0.1", nombre: "Viejo", activo: false }];
  assert.equal(filtrarArticulos(lista)[0].sku, "3.3.1.6.109.2", "el urgente arriba");
  assert.equal(filtrarArticulos(lista).length, 4, "los inactivos no se muestran");
  assert.deepEqual(filtrarArticulos(lista, { texto: "tablilla 0277" }).map((a) => a.sku), ["3.3.1.6.109.2"]);
  assert.deepEqual(filtrarArticulos(lista, { texto: "aislantes" }).map((a) => a.sku), ["2.10.2.52.15"], "busca también en la familia");
  assert.deepEqual(filtrarArticulos(lista, { texto: "1.1.1.2" }).map((a) => a.sku), ["1.1.1.2.130.1"], "y en el SKU");
  assert.deepEqual(filtrarArticulos(lista, { urgentes: true }).map((a) => a.sku), ["3.3.1.6.109.2"]);
  assert.deepEqual(filtrarArticulos(lista, { division: "MADERA" }).map((a) => a.sku).sort(), ["1.1.1.2.130.1", "9.9.9"]);
  assert.deepEqual(divisionesDe(lista), ["ALUMINIO", "HIERRO", "MADERA"]);
  // El buscador de los formularios avisa cuántos quedan afuera
  const zocalos = Array.from({ length: 23 }, (_, i) => ({ sku: `1.3.${i}`, nombre: `ZOCALO ${i}` }));
  assert.equal(sugerirArticulos(zocalos, "zocalo").lista.length, 20);
  assert.equal(sugerirArticulos(zocalos, "zocalo").resto, 3);
  assert.deepEqual(sugerirArticulos(zocalos, "zocalo 22").lista.map((a) => a.sku), ["1.3.22"]);
  assert.deepEqual(sugerirArticulos(zocalos, "  "), { lista: [], resto: 0 });
  assert.equal(cantidadTexto(1234.5), "1.234,5");
  assert.equal(cantidadTexto(null), "—");
});

test("QR — el link de la etiqueta abre la ficha; también se entiende el SKU solo", () => {
  const link = linkArticulo("https://gypi.app/", "gi-group", "3.3.1.6.109.2");
  assert.equal(link, "https://gypi.app/gi-group?articulo=3.3.1.6.109.2");
  assert.equal(leerQrArticulo(link), "3.3.1.6.109.2");
  assert.equal(leerQrArticulo(" 1.2.3 "), "1.2.3");
  assert.equal(leerQrArticulo("https://gypi.app/gi-group?carga=M-7495"), null);
  assert.equal(leerQrArticulo("<script>"), null);
});

test("etiquetas — una por artículo con nombre, SKU, unidad y QR; el texto va escapado", async () => {
  const html = await htmlEtiquetasArticulos({
    empresa: "GI <Group>",
    articulos: [{ sku: "1.2.3", nombre: "Bisagra \"35\"", unidad: "UN", division: "MADERA" }, { sku: "4.5.6", nombre: null }],
    origen: "https://gypi.app", slug: "gi", tamano: { ancho: 100, alto: 50 },
  });
  assert.equal((html.match(/class="etiqueta"/g) || []).length, 2);
  assert.match(html, /GI &lt;Group&gt;/);
  assert.match(html, /Bisagra &quot;35&quot;/);
  assert.match(html, /UN · MADERA/);
  assert.match(html, /<div class="nombre">4\.5\.6<\/div>/, "sin nombre, el SKU");
  assert.equal((html.match(/<svg/g) || []).length, 2);
  assert.match(html, /@page \{ size: 100mm 50mm/);
});

// ─── Base de datos ───

test("migración 106 — articulos_stock por empresa, con RLS y los permisos de la sincronización", () => {
  const sql = readFileSync(new URL("../supabase/migrations/106_stock_articulos.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.articulos_stock/);
  assert.match(sql, /primary key \(empresa_id, sku\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /create policy tenant_isolation_auth_articulos_stock on public\.articulos_stock for all to authenticated/);
  assert.match(sql, /grant select, insert, update on public\.articulos_stock to authenticated/);
  assert.doesNotMatch(sql, /delete on public\.articulos_stock/);
  assert.doesNotMatch(sql, /to anon/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

test("datos — todos leen el stock; nadie lo escribe por /api/data", () => {
  assert.equal(autorizar("articulos_stock", "GET", { rol: "operativo" }).ok, true);
  for (const metodo of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar("articulos_stock", metodo, { rol: "gerencial" }).ok, false, metodo);
});

// ─── Sincronización ───

function mockSync({ urls = { inventario: "https://docs.google.com/inv.csv", articulos: "https://docs.google.com/art.csv" }, falla = null } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.startsWith("https://docs.google.com/inv.csv"), respond: () => ({ status: 200, body: INVENTARIO }) },
    { match: (u) => u.startsWith("https://docs.google.com/art.csv"), respond: () => ({ status: 200, body: ARTICULOS }) },
    {
      match: (u, o) => u.includes(`/rest/v1/config_sistema`) && (!o?.method || o.method === "GET"),
      respond: (u) => {
        assert.match(u, new RegExp(`clave=eq\\.${CLAVE_STOCK_CSV}`));
        return { status: 200, body: urls ? [{ valor: urls }] : [] };
      },
    },
    {
      match: (u, o) => (u.includes("/rest/v1/articulos_stock") || u.includes("/rest/v1/config_sistema")) && ["POST", "PATCH"].includes(o?.method),
      respond: (u, o) => {
        if (falla && u.includes("articulos_stock")) return { status: 404, body: { message: falla } };
        escrito.push({ metodo: o.method, url: u, body: JSON.parse(o.body) });
        if (o.method === "PATCH" && u.includes("articulos_stock")) return { status: 200, body: [{ sku: "0.0.1" }] };
        return { status: 201, body: null };
      },
    },
  ]);
  return escrito;
}

test("sincronizar — sube todo por SKU, apaga lo que ya no está y guarda la fecha", async () => {
  const escrito = mockSync();
  const r = await syncStockEmpresa(E);
  assert.deepEqual(r, { articulos: 4, desactivados: 1, sinSku: 1, errores: [], necesidades: 0, avisoNecesidades: null, avisoTablas: null });
  const [subida, apagar, config] = escrito;
  assert.equal(subida.metodo, "POST");
  assert.match(subida.url, /articulos_stock\?on_conflict=empresa_id,sku/);
  assert.equal(subida.body.length, 4);
  assert.ok(subida.body.every((f) => f.empresa_id === E && f.activo === true && f.origen === "planilla" && f.sincronizado_at));
  assert.equal(apagar.metodo, "PATCH");
  // Los artículos nuevos de Gypi que la planilla todavía no trae no se apagan (124)
  assert.match(apagar.url, new RegExp(`empresa_id=eq\\.${E}&activo=eq\\.true&origen=eq\\.planilla&sincronizado_at=lt\\.`));
  assert.deepEqual(apagar.body, { activo: false });
  assert.match(config.url, /config_sistema\?empresa_id=eq\..*&clave=eq\.stock_csv_url/);
  assert.equal(config.body.valor.inventario, "https://docs.google.com/inv.csv", "no pierde los links");
  assert.equal(config.body.valor.articulos_sync, 4);
  assert.ok(config.body.valor.ultima_sync);
});

test("sincronizar — sin link de INVENTARIO o con la hoja equivocada avisa claro", async () => {
  mockSync({ urls: null });
  await assert.rejects(syncStockEmpresa(E), (e) => e.aviso && /INVENTARIO/.test(e.message));
  mockSync({ urls: { inventario: "http://docs.google.com/inv.csv" } });
  await assert.rejects(syncStockEmpresa(E), (e) => e.aviso && /publicada como CSV/.test(e.message));
});

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t) => new Request("http://localhost/api/stock/sync", { method: "POST", headers: { Authorization: `Bearer ${t}` } });

test("/api/stock/sync — el encargado sincroniza; el operario no", async () => {
  mockSync();
  let res = await api.POST(req(await token("operativo")));
  assert.equal(res.status, 403);
  res = await api.POST(req(await token("administrativo")));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).articulos, 4);
});

test("/api/stock/sync — dice qué falta: la migración o el link", async () => {
  mockSync({ falla: 'relation "public.articulos_stock" does not exist' });
  let res = await api.POST(req(await token("gerencial")));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 106/);
  mockSync({ urls: null });
  res = await api.POST(req(await token("gerencial")));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Falta el link de la hoja INVENTARIO/);
});

// ─── Pantallas ───

const LISTA = unirArticulos({ inventario: INVENTARIO, articulos: ARTICULOS }).filas.map((f) => ({ ...f, activo: true }));

function mockPantalla({ articulos = LISTA, valor = { inventario: "https://docs.google.com/inv.csv", ultima_sync: "2026-10-15T09:00:00Z" } } = {}) {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/stock/sync")) {
      pedidos.push("sync");
      return new Response(JSON.stringify({ ok: true, articulos: 4, desactivados: 0, errores: [] }), { status: 200 });
    }
    if (body?.path?.startsWith("config_sistema")) return new Response(JSON.stringify({ data: valor ? [{ valor }] : [] }), { status: 200 });
    if (body?.path?.startsWith("articulos_stock")) return new Response(JSON.stringify({ data: articulos }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return pedidos;
}

test("pantalla Stock — lista con semáforo, búsqueda, urgentes y ficha", async () => {
  mockPantalla();
  render(<StockScreen empresa={{ slug: "gi", nombre: "GI" }} empresaId={E} />);
  await waitFor(() => assert.ok(screen.getByText("4 artículos")));
  const nombres = screen.getAllByRole("listitem").map((li) => li.textContent);
  assert.match(nombres[0], /0277 TABLILLA/, "el urgente arriba");
  assert.ok(screen.getByText("🔴 Urgentes (1)"));
  fireEvent.change(screen.getByLabelText("Buscar artículo"), { target: { value: "lana" } });
  assert.ok(screen.getByText("1 de 4 artículos"));
  fireEvent.click(screen.getByText("LANA DE VIDRIO"));
  assert.ok(screen.getByRole("dialog", { name: "Artículo 2.10.2.52.15" }));
  assert.ok(screen.getByText("Necesitan las OT"));
});

test("pantalla Stock — sin planilla conectada muestra dónde pegar los links", async () => {
  mockPantalla({ articulos: [], valor: null });
  render(<StockScreen empresa={{ slug: "gi" }} empresaId={E} />);
  await waitFor(() => assert.ok(screen.getByLabelText("Link de la hoja INVENTARIO")));
  assert.ok(screen.getByText(/Todavía no hay artículos/));
});

test("pantalla Stock — sincronizar y elegir etiquetas de lo filtrado", async () => {
  const pedidos = mockPantalla();
  render(<StockScreen empresa={{ slug: "gi" }} empresaId={E} />);
  await waitFor(() => assert.ok(screen.getByText("4 artículos")));
  fireEvent.click(screen.getByText("🔄 Sincronizar"));
  await waitFor(() => assert.deepEqual(pedidos, ["sync"]));
  fireEvent.click(screen.getByText("ALUMINIO"));
  fireEvent.click(screen.getByText("Elegir 1 de la lista"));
  assert.ok(screen.getByText(/1 elegidas/));
  assert.equal(screen.getByLabelText("Etiqueta de 0277 TABLILLA").checked, true);
});

test("ficha del QR — busca el artículo por SKU; si no está, lo dice", async () => {
  mockPantalla({ articulos: [LISTA[1]] });
  render(<FichaArticulo sku="3.3.1.6.109.2" onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("0277 TABLILLA")));
  assert.ok(screen.getByText("🔴 URGENTE"));
  assert.ok(screen.getByText(/Próxima necesidad: 10\/08\/2026/));
  cleanup();
  mockPantalla({ articulos: [] });
  render(<FichaArticulo sku="0.0.0" onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText(/No encontré ese artículo/)));
});

test("QR del artículo — la app abre la ficha con ?articulo=SKU y Stock está en Inventario", () => {
  const home = readFileSync(new URL("../app/[slug]/HomeContent.jsx", import.meta.url), "utf8");
  assert.match(home, /searchParams\.get\("articulo"\)/);
  assert.match(home, /<FichaArticulo sku=\{skuArticulo\}/);
  const menu = readFileSync(new URL("../app/lib/menuGestion.js", import.meta.url), "utf8");
  assert.match(menu, /\{ id: "stock", label: "Stock", modulo: "stock" \}/);
});
