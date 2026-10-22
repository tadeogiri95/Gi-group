// tests/articulos-nuevos.test.jsx — Artículos nuevos desde Gypi (Stock, ítem
// 40; migración 124): formulario con los campos de ARTICULOS, SKU provisorio
// armado con TABLAS, y el script de la planilla los anota en ARTICULOS.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  leerTablas, armarSku, siguienteNumero, nombreNormalizado, articuloParaPlanilla, parecidos, CLAVE_TABLAS_MRP,
} from "../app/lib/articulosNuevos.js";
import { generarClave, scriptPlanilla } from "../app/lib/planillaMrp.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/stock/articulos/route.js");
const planilla = await import("../app/api/stock/planilla/route.js");
const { _resetBuckets } = await import("../app/lib/rateLimitMemory.js");
const { validateCsrf } = await import("../app/lib/csrf.js");
const { default: ArticuloNuevo } = await import("../app/components/ArticuloNuevo.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

// Como la hoja TABLAS real: listas lado a lado, cada una con su ID al lado
const TABLAS_CSV = [
  "MARCA,ID,,FAMILIA,ID,,TIPO,ID,,MEDIDA,ID,,COLOR,ID,,PACK,ID,,centro_de_costos_id,centro_de_costos",
  "Masisa,01,,\"Placas, chapas, mallas y paneles \",01,,Procesable,01,,MT2,01,,Abeto Helsinki,01,,10KG,01,,1,MADERA",
  "Isover,52,,Aislantes,10,,Componente,02,,MT,02,,S/COLOR,155,,20 MT2,30,,2,HIERRO",
  "Aluar,06,,Herrajes y Accesorios,03,,Insumo,03,,KG,03,,NEGRO,109,,6MT,08,,3,ALUMINIO",
].join("\n");

test("TABLAS — lee cada lista con su número, sin ceros a la izquierda", () => {
  const { listas, faltan } = leerTablas(TABLAS_CSV);
  assert.deepEqual(faltan, []);
  assert.deepEqual(listas.marca[1], { id: "52", nombre: "Isover" });
  assert.deepEqual(listas.familia[0], { id: "1", nombre: "Placas, chapas, mallas y paneles" });
  assert.deepEqual(listas.division.map((d) => d.nombre), ["MADERA", "HIERRO", "ALUMINIO"]);
  assert.deepEqual(listas.pack[2], { id: "8", nombre: "6MT" });
  assert.deepEqual(leerTablas("A,B\n1,2").faltan.length, 7, "otra hoja: no encuentra nada");
});

test("SKU — igual que la planilla: división.familia.tipo.marca.color.medida.pack.número", () => {
  const { listas } = leerTablas(TABLAS_CSV);
  // LANA DE VIDRIO ROLLO-Isover-S/COLOR-20 MT2 → 2.10.2.52.155.1.30.1 en la planilla real
  const lana = { nombre_articulo: "LANA DE VIDRIO ROLLO", division: "hierro", familia: "aislantes", tipo: "Componente", marca: "ISOVER", color: "s/color", unidad: "MT2", pack: "20 mt2" };
  const r = armarSku(lana, listas, 1);
  assert.equal(r.sku, "2.10.2.52.155.1.30.1");
  assert.equal(r.valores.marca, "Isover", "con el nombre como está en TABLAS");
  assert.equal(nombreNormalizado({ ...lana, ...r.valores }), "LANA DE VIDRIO ROLLO-Isover-S/COLOR-20 MT2");
  const mal = armarSku({ ...lana, marca: "Inventada" }, listas, 1);
  assert.match(mal.error, /Marca "Inventada" no está en la hoja TABLAS/);
  assert.equal(siguienteNumero(["1.3.2.69.155.5.3.53", "2.10.2.52.155.1.30.2101", "raro", null]), 2102);
  assert.equal(siguienteNumero([]), 1);
});

test("parecidos — avisa si ya hay un artículo con ese nombre", () => {
  const arts = [{ sku: "1", nombre: "ZOCALO EPS 10CM-S/Marca-BLANCO-1 PZ" }, { sku: "2", nombre: "BISAGRA 35" }];
  assert.deepEqual(parecidos(arts, "zocalo eps").map((a) => a.sku), ["1"]);
  assert.deepEqual(parecidos(arts, "ab"), [], "con poco texto no busca");
});

// ─── Ruta /api/stock/articulos ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

function mockAlta({ listas = leerTablas(TABLAS_CSV).listas, skus = ["2.10.2.52.155.1.30.2101"], duplicarPrimero = false } = {}) {
  const escrito = [];
  let duplicado = duplicarPrimero;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: listas ? [{ valor: { listas } }] : [] }) },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ nombre: "Tadeo Giri" }] }) },
    {
      match: (u) => u.includes("/rest/v1/articulos_alta"),
      respond: (u, o) => {
        if (o.method === "POST") {
          const body = JSON.parse(o.body);
          if (duplicado) { duplicado = false; return { status: 409, body: { code: "23505", message: "duplicate key" } }; }
          escrito.push({ tabla: "articulos_alta", body });
          return { status: 201, body: [{ id: 5, ...body }] };
        }
        return { status: 200, body: [] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/articulos_stock"),
      respond: (u, o) => {
        if (o.method === "POST") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "articulos_stock", body });
          return { status: 201, body: [body] };
        }
        return { status: 200, body: skus.map((sku) => ({ sku })) };
      },
    },
  ]);
  return escrito;
}

const LANA = { nombre_articulo: "Lana  de vidrio rollo", division: "HIERRO", familia: "Aislantes", tipo: "Componente", marca: "Isover", color: "S/COLOR", unidad: "MT2", pack: "20 MT2", proveedor_principal: "", factor_tiempo: 7 };
const alta = async (rol, body = LANA) => api.POST(new Request("http://localhost/api/stock/articulos", {
  method: "POST", headers: { Authorization: `Bearer ${await token(rol)}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
}));

test("/api/stock/articulos — solo dueños y administradores", async () => {
  mockAlta();
  assert.equal((await alta("operativo")).status, 403);
  assert.equal((await alta("jefe")).status, 403);
});

test("/api/stock/articulos — arma el SKU con el número siguiente y queda en el stock como nuevo", async () => {
  const escrito = mockAlta();
  const res = await alta("administrativo");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.articulo.sku, "2.10.2.52.155.1.30.2102");
  const a = escrito.find((w) => w.tabla === "articulos_alta").body;
  assert.equal(a.numero, 2102);
  assert.equal(a.nombre, "Lana de vidrio rollo-Isover-S/COLOR-20 MT2");
  assert.equal(a.categoria, "C");
  assert.equal(a.factor_tiempo, 7);
  assert.equal(a.proveedor_principal, null, "el proveedor es opcional");
  assert.equal(a.empleado_nombre, "Tadeo Giri");
  assert.match(a.id_planilla, /^[0-9a-f]{12}$/);
  const s = escrito.find((w) => w.tabla === "articulos_stock").body;
  assert.equal(s.origen, "gypi");
  assert.equal(s.activo, true);
  assert.equal(s.plazo_dias, 7);
});

test("/api/stock/articulos — si el número se usó en el mismo momento, toma el siguiente", async () => {
  const escrito = mockAlta({ duplicarPrimero: true });
  const data = await (await alta("gerencial")).json();
  assert.equal(data.articulo.sku, "2.10.2.52.155.1.30.2103");
  assert.equal(escrito.filter((w) => w.tabla === "articulos_alta").length, 1);
});

test("/api/stock/articulos — sin TABLAS o con un valor que no está, avisa qué hacer", async () => {
  mockAlta({ listas: null });
  const sin = await alta("gerencial");
  assert.equal(sin.status, 409);
  assert.match((await sin.json()).error, /hoja TABLAS/);
  mockAlta();
  const mal = await alta("gerencial", { ...LANA, color: "VIOLETA" });
  assert.equal(mal.status, 400);
  assert.match((await mal.json()).error, /Color\/Acabado "VIOLETA" no está en la hoja TABLAS/);
});

// ─── Link de la planilla: artículos pendientes y confirmación ───

function mockPlanilla({ hash, altas = [], altaGuardada = null, yaEsta = false }) {
  const cambios = [];
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires" }] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: (u, o) => ({ status: 200, body: o.method === "PATCH" ? [] : [{ valor: { hash } }] }) },
    { match: (u) => u.includes("/rest/v1/movimientos_stock") && !u.includes("sku=eq."), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/articulos_alta"),
      respond: (u, o) => {
        if (o.method === "PATCH") { cambios.push({ url: u, body: JSON.parse(o.body) }); return { status: 200, body: [] }; }
        if (u.includes("en_planilla_at=is.null")) return { status: 200, body: altas };
        return { status: 200, body: altaGuardada ? [altaGuardada] : [] };
      },
    },
    {
      match: (u, o) => /\/rest\/v1\/(articulos_stock|movimientos_stock|pedidos_compra|ordenes_compra_items)\?/.test(u),
      respond: (u, o) => {
        if (o.method === "PATCH") { cambios.push({ url: u, body: JSON.parse(o.body) }); return { status: 200, body: [] }; }
        return { status: 200, body: yaEsta ? [{ sku: "x" }] : [] };
      },
    },
  ]);
  return cambios;
}

const ALTA = { id: 5, sku: "2.10.2.52.155.1.30.2102", numero: 2102, id_planilla: "abcdef123456", nombre: "LANA-Isover-S/COLOR-20 MT2", nombre_articulo: "LANA", division: "HIERRO", familia: "Aislantes", tipo: "Componente", marca: "Isover", color: "S/COLOR", unidad: "MT2", pack: "20 MT2", categoria: "C", stock_seguridad: null, factor_tiempo: 7, proveedor_principal: null, lote_minimo: null };

test("/api/stock/planilla GET — suma los artículos nuevos que la planilla no anotó", async () => {
  _resetBuckets();
  const { clave, hash } = generarClave(E);
  mockPlanilla({ hash, altas: [ALTA] });
  const data = await (await planilla.GET(new Request("http://localhost/api/stock/planilla?desde=0", { headers: { Authorization: `Bearer ${clave}` } }))).json();
  assert.equal(data.articulos.length, 1);
  assert.equal(data.articulos[0].alta, 5);
  assert.equal(data.articulos[0].columnas.ID_SKU, ALTA.sku);
  assert.equal(data.articulos[0].columnas["Factor Tiempo"], 7);
  assert.equal(data.articulos[0].columnas["Stock_de_seguridad"], "");
  assert.deepEqual(articuloParaPlanilla(null), null);
});

const confirmar = (clave, articulos) => planilla.PATCH(new Request("http://localhost/api/stock/planilla", {
  method: "PATCH", headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" }, body: JSON.stringify({ articulos }),
}));

test("/api/stock/planilla PATCH — con el mismo SKU solo lo anota; con otro, lo cambia en todos lados", async () => {
  _resetBuckets();
  const { clave, hash } = generarClave(E);
  let cambios = mockPlanilla({ hash, altaGuardada: { id: 5, sku: ALTA.sku, en_planilla_at: null } });
  let r = await (await confirmar(clave, [{ alta: 5, sku: ALTA.sku }])).json();
  assert.equal(r.confirmados[0].cambia, false);
  assert.deepEqual(cambios.map((c) => c.url.split("?")[0].split("/").pop()), ["articulos_alta"]);
  assert.ok(cambios[0].body.en_planilla_at);

  cambios = mockPlanilla({ hash, altaGuardada: { id: 5, sku: ALTA.sku, en_planilla_at: null } });
  r = await (await confirmar(clave, [{ alta: 5, sku: "2.10.2.52.155.1.30.3860" }])).json();
  assert.equal(r.confirmados[0].cambia, true);
  const tablas = cambios.map((c) => c.url.split("?")[0].split("/").pop());
  assert.deepEqual(tablas, ["articulos_stock", "movimientos_stock", "pedidos_compra", "ordenes_compra_items", "articulos_alta"]);
  assert.ok(cambios.slice(0, 4).every((c) => c.body.sku === "2.10.2.52.155.1.30.3860" && c.url.includes(`sku=eq.${ALTA.sku}`) && c.url.includes(`empresa_id=eq.${E}`)));
  assert.equal(cambios[4].body.sku_planilla, "2.10.2.52.155.1.30.3860");

  cambios = mockPlanilla({ hash, altaGuardada: { id: 5, sku: ALTA.sku, en_planilla_at: null } });
  await confirmar(clave, [{ alta: 5, sku: "" }]);
  assert.match(cambios.at(-1).body.aviso_planilla, /no armó el SKU/);

  mockPlanilla({ hash });
  assert.equal((await confirmar("otra", [])).status, 401);
});

test("CSRF — el script puede confirmar (PATCH con su clave); el POST de la misma ruta sigue protegido", () => {
  const req = (method) => ({ method, nextUrl: new URL("https://gypi.test/api/stock/planilla"), cookies: { get: () => undefined }, headers: new Headers() });
  assert.equal(validateCsrf(req("PATCH")), null);
  assert.notEqual(validateCsrf(req("POST")), null);
});

// ─── El script, con una hoja ARTICULOS de mentira ───

class HojaArticulos {
  constructor(titulos, filas, calcularSku) {
    this.ancho = titulos.length;
    this.celdas = [titulos, ...filas].map((f) => f.map((x) => ({ v: typeof x === "object" && x ? x.v : x, f: typeof x === "object" && x ? x.f : "" })));
    this.calcularSku = calcularSku;
    this.amarillas = [];
  }
  vacia() { return Array.from({ length: this.ancho }, () => ({ v: "", f: "" })); }
  getMaxRows() { return this.celdas.length; }
  getLastColumn() { return this.ancho; }
  insertRowsAfter(_, n) { for (let i = 0; i < n; i++) this.celdas.push(this.vacia()); }
  getRange(r, c, nr = 1, nc = 1) {
    const h = this;
    const filas = () => h.celdas.slice(r - 1, r - 1 + nr).map((f) => f.slice(c - 1, c - 1 + nc));
    return {
      getValues: () => filas().map((f) => f.map((x) => x.v)),
      getFormulas: () => filas().map((f) => f.map((x) => x.f)),
      getFormulasR1C1: () => filas().map((f) => f.map((x) => x.f)),
      setValues: (v) => v.forEach((fila, i) => fila.forEach((x, j) => { h.celdas[r - 1 + i][c - 1 + j] = { v: x, f: "" }; })),
      setFormulaR1C1: (f) => { h.celdas[r - 1][c - 1] = { v: h.calcularSku(r, c), f }; },
      getValue: () => h.celdas[r - 1][c - 1].v,
      setBackground: (color) => h.amarillas.push({ fila: r, color }),
    };
  }
}

function correr(script, { hojas, respuestas, props = {} }) {
  const pedidos = [];
  const entorno = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => hojas[n] || null }), flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    UrlFetchApp: {
      fetch: (url, opts) => {
        pedidos.push({ url, method: opts.method || "get", body: opts.payload ? JSON.parse(opts.payload) : null });
        const r = opts.method === "patch" ? { ok: true } : respuestas.shift();
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(r) };
      },
    },
    ScriptApp: { getProjectTriggers: () => [] },
    console: { warn: () => {} },
  };
  new Function(...Object.keys(entorno), `${script}\ntraerMovimientosGypi();`)(...Object.values(entorno));
  return { pedidos, props };
}

test("script — anota el artículo en ARTICULOS sin pisar las fórmulas y cambia el SKU de los retiros del mismo día", () => {
  const script = scriptPlanilla({ url: "https://gypi.test/api/stock/planilla", clave: "gyp_x" });
  const titulos = ["ID", "ID_SKU", "Numero Articulo", "Categoría", "Nombre normalizado", "Nombre Articulo", "División", "Familia", "Tipo de Material", "Marca", "Color/Acabado", "Unidad Medida", "Pack/Bulto", "Stock_de_seguridad", "Factor Tiempo", "PROVEEDOR PRINCIPAL"];
  const formula = (txt) => ({ v: "x", f: txt });
  const art = new HojaArticulos(titulos, [
    ["0a0acaa2b157", formula("=SKU(R[0]C[5])"), formula("=ROW()-1"), "C", formula("=NOMBRE()"), "LANA DE VIDRIO ROLLO", "HIERRO", "Aislantes", "Componente", "Isover", "S/COLOR", "MT2", "20 MT2", "", "", ""],
  ], (r, c) => (c === 2 ? `2.10.2.52.155.1.30.${r - 1}` : "calc"));
  const cons = { getLastRow: () => 1, getMaxRows: () => 1, insertRowsAfter: () => {}, getRange: () => ({ getValues: () => [[""]], setValues: () => {} }) };
  const personal = { getLastRow: () => 1, getRange: () => ({ getValues: () => [] }) };
  const pendiente = articuloParaPlanilla(ALTA);
  const mov = { id: "GY-20", hoja: "consumos", fecha: "2026-10-22", momento: "2026-10-22T12:00:00Z", sku: ALTA.sku, nombre: "LANA", cantidad: 1, origen: "CONSUMO FÁBRICA", detalle: "GYPI · Retiro", ot: "", colaborador: "", anulado: false };
  const filasConsumos = [];
  cons.getRange = (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, () => Array(nc || 1).fill("")), setValues: (v) => filasConsumos.push(...v) });
  const { pedidos, props } = correr(script, {
    hojas: { ARTICULOS: art, fact_consumos_stock: cons, fact_ingresos_stock: cons, PERSONAL: personal },
    respuestas: [{ movimientos: [mov], anulados: [], hasta: 20, hayMas: false, articulos: [pendiente] }],
  });
  const fila = art.celdas[2];
  assert.equal(fila[0].v, "abcdef123456", "ID escrito");
  assert.equal(fila[1].f, "=SKU(R[0]C[5])", "el SKU sale de la fórmula de arriba");
  assert.equal(fila[2].f, "=ROW()-1");
  assert.equal(fila[4].f, "=NOMBRE()");
  assert.equal(fila[5].v, "LANA");
  assert.equal(fila[14].v, 7, "Factor Tiempo");
  const patch = pedidos.find((p) => p.method === "patch");
  assert.deepEqual(patch.body, { articulos: [{ alta: 5, sku: "2.10.2.52.155.1.30.2" }] });
  assert.equal(filasConsumos[0][2], "2.10.2.52.155.1.30.2", "el retiro del mismo día sale con el SKU de la planilla");
  assert.equal(JSON.parse(props.GYPI_ARTICULOS)["5"], "2.10.2.52.155.1.30.2");

  // Si Gypi no recibió la confirmación, la próxima vuelta no lo escribe de nuevo
  const antes = art.celdas.length;
  const r2 = correr(script, {
    hojas: { ARTICULOS: art, fact_consumos_stock: cons, fact_ingresos_stock: cons, PERSONAL: personal },
    props,
    respuestas: [{ movimientos: [], anulados: [], hasta: 20, hayMas: false, articulos: [pendiente] }],
  });
  assert.equal(art.celdas.length, antes);
  assert.equal(art.celdas.filter((f) => f[0].v === "abcdef123456").length, 1);
  assert.deepEqual(r2.pedidos.find((p) => p.method === "patch").body.articulos, [{ alta: 5, sku: "2.10.2.52.155.1.30.2" }]);
});

// ─── La sincronización no apaga los nuevos que la planilla todavía no trae ───

test("sync — solo apaga lo que vino de la planilla y guarda las listas de TABLAS", () => {
  const sync = readFileSync(new URL("../app/lib/syncStock.js", import.meta.url), "utf8");
  assert.match(sync, /activo=eq\.true&origen=eq\.planilla&sincronizado_at=lt\./);
  assert.match(sync, /origen: "planilla"/);
  assert.match(sync, /CLAVE_TABLAS_MRP/);
  assert.equal(CLAVE_TABLAS_MRP, "stock_tablas_mrp");
  const mig = readFileSync(new URL("../supabase/migrations/124_articulos_alta.sql", import.meta.url), "utf8");
  assert.match(mig, /do \$mig\$/);
  assert.match(mig, /enable row level security/);
});

// ─── Pantalla ───

test("formulario — carga las listas, avisa parecidos y manda los campos de ARTICULOS", async () => {
  const { listas } = leerTablas(TABLAS_CSV);
  let enviado = null;
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes("/api/stock/articulos") && opts.method === "POST") {
      enviado = JSON.parse(opts.body);
      return new Response(JSON.stringify({ ok: true, articulo: { sku: "2.10.2.52.155.1.30.2102", nombre: "LANA-Isover-S/COLOR-20 MT2" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ puede: true, listas }), { status: 200 });
  };
  let creado = null;
  render(<ArticuloNuevo articulos={[{ sku: "9", nombre: "LANA DE VIDRIO ROLLO-Isover-S/COLOR-20 MT2" }]} nombreInicial="LANA DE VIDRIO" onCreado={(a) => { creado = a; }} onCancelar={() => {}} />);
  await screen.findByLabelText("Nombre del artículo");
  assert.ok(screen.getByText(/Ya hay parecidos/));
  for (const [label, valor] of [["División", "HIERRO"], ["Familia", "Aislantes"], ["Tipo de material", "Componente"], ["Marca", "Isover"], ["Color/Acabado", "S/COLOR"], ["Unidad de medida", "MT2"], ["Pack/Bulto", "20 MT2"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: valor } });
  }
  assert.ok(screen.getByText("LANA DE VIDRIO-Isover-S/COLOR-20 MT2"));
  fireEvent.click(screen.getByText("Cargar artículo"));
  await screen.findByText(/Artículo cargado/);
  assert.equal(enviado.marca, "Isover");
  assert.equal(enviado.proveedor_principal, null);
  assert.equal(enviado.categoria, "C");
  fireEvent.click(screen.getByText("Listo"));
  assert.equal(creado.sku, "2.10.2.52.155.1.30.2102");
});

test("formulario — sin la hoja TABLAS conectada dice qué hacer", async () => {
  global.fetch = async () => new Response(JSON.stringify({ puede: true, listas: null }), { status: 200 });
  render(<ArticuloNuevo onCreado={() => {}} onCancelar={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText(/Falta conectar la hoja TABLAS/)));
});
