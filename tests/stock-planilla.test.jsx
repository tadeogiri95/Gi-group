// tests/stock-planilla.test.jsx — Stock, parte 15 (ítem 40): la planilla MRP
// trae sola los movimientos de Gypi con una clave privada de la empresa.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  generarClave, empresaDeClave, claveValida, hashClave, movimientoParaPlanilla, fechaEnZona, scriptPlanilla, CLAVE_PLANILLA_MRP,
} from "../app/lib/planillaMrp.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/stock/planilla/route.js");
const { _resetBuckets } = await import("../app/lib/rateLimitMemory.js");
const { default: PlanillaMrpConexion } = await import("../app/components/PlanillaMrpConexion.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

// ─── Clave ───

test("clave — lleva la empresa, se guarda el hash y se compara bien", () => {
  const { clave, hash } = generarClave(E);
  assert.match(clave, /^gyp_11111111-1111-1111-1111-111111111111_[0-9a-f]{48}$/);
  assert.equal(empresaDeClave(clave), E);
  assert.equal(hash, hashClave(clave));
  assert.equal(claveValida(clave, hash), true);
  assert.equal(claveValida(clave, generarClave(E).hash), false, "otra clave");
  assert.equal(claveValida(clave, undefined), false);
  assert.equal(empresaDeClave("gyp_no-es-uuid_" + "a".repeat(48)), null);
  assert.equal(empresaDeClave(`gyp_${E}_corto`), null);
  assert.equal(empresaDeClave(""), null);
});

// ─── Cómo se anota en la planilla ───

test("planilla — retiro suma consumo; devolución y ajuste a favor restan; ingreso a su hoja", () => {
  const base = { id: 7, sku: "1.2.3", nombre: "MDF 18MM-Masisa-BLANCO", created_at: "2026-10-16T02:30:00Z", empleado_nombre: "Juan Pérez", legajo: 7 };
  const retiro = movimientoParaPlanilla({ ...base, tipo: "consumo", cantidad: "2.5", ot: "M-7495" }, "America/Argentina/Buenos_Aires");
  assert.equal(retiro.id, "GY-7");
  assert.equal(retiro.hoja, "consumos");
  assert.equal(retiro.cantidad, 2.5);
  assert.equal(retiro.origen, "CONSUMO FÁBRICA");
  assert.equal(retiro.fecha, "2026-10-15", "la fecha es la de Argentina, no la UTC");
  assert.equal(retiro.ot, "M-7495");
  const dev = movimientoParaPlanilla({ ...base, tipo: "devolucion", cantidad: 1 }, null);
  assert.equal(dev.cantidad, -1);
  assert.equal(dev.origen, "CONSUMO FÁBRICA");
  assert.equal(dev.detalle, "GYPI · Devolución");
  const ajuste = movimientoParaPlanilla({ ...base, tipo: "ajuste", cantidad: -3 }, null);
  assert.equal(ajuste.cantidad, 3, "un ajuste que resta stock va positivo en consumos");
  assert.equal(ajuste.origen, "AJUSTE");
  const ingreso = movimientoParaPlanilla({ ...base, tipo: "ingreso", cantidad: 10, proveedor: "Aluar", precio_unitario: 1500 }, null);
  assert.equal(ingreso.hoja, "ingresos");
  assert.equal(ingreso.cantidad, 10);
  assert.equal(ingreso.proveedor, "Aluar");
  assert.equal(movimientoParaPlanilla({ ...base, tipo: "otro", cantidad: 1 }, null), null);
  assert.equal(fechaEnZona("no es fecha", null), null);
});

// ─── Ruta ───

function mockRuta({ hash, movs = [], anulados = [], cfgFalta = false } = {}) {
  const pedidos = [];
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq.") && u.includes("select=timezone"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o.method === "POST" || o.method === "PATCH") {
          escrito.push({ metodo: o.method, url: u, body: JSON.parse(o.body) });
          return { status: 201, body: [] };
        }
        if (u.includes("select=clave")) return { status: 200, body: [] };
        return { status: 200, body: cfgFalta ? [] : [{ valor: { hash, creada_at: "2026-10-15T10:00:00Z" } }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/movimientos_stock"),
      respond: (u) => {
        pedidos.push(u);
        return { status: 200, body: u.includes("anulado=eq.true") ? anulados : movs };
      },
    },
  ]);
  return { pedidos, escrito };
}

const pedirFeed = (clave, desde = 0) => new Request(`http://localhost/api/stock/planilla?desde=${desde}`, { headers: clave ? { Authorization: `Bearer ${clave}` } : {} });

test("/api/stock/planilla GET — sin clave o con una vieja, no entra", async () => {
  _resetBuckets();
  const { clave } = generarClave(E);
  mockRuta({ hash: generarClave(E).hash });
  assert.equal((await api.GET(pedirFeed(null))).status, 401);
  assert.equal((await api.GET(pedirFeed("cualquier cosa"))).status, 401);
  assert.equal((await api.GET(pedirFeed(clave))).status, 401, "la clave anterior deja de andar");
  mockRuta({ cfgFalta: true });
  assert.equal((await api.GET(pedirFeed(clave))).status, 401);
});

test("/api/stock/planilla GET — trae lo siguiente al cursor, en orden, y lo anulado ya traído", async () => {
  _resetBuckets();
  const { clave, hash } = generarClave(E);
  const movs = [
    { id: 11, tipo: "consumo", sku: "1.2.3", nombre: "MDF", cantidad: 2, ot: "M-1", created_at: "2026-10-15T15:00:00Z", empleado_nombre: "Juan", anulado: false },
    { id: 12, tipo: "ingreso", sku: "1.2.3", nombre: "MDF", cantidad: 5, created_at: "2026-10-15T16:00:00Z", proveedor: "Masisa", anulado: false },
  ];
  const { pedidos, escrito } = mockRuta({ hash, movs, anulados: [{ id: 4 }] });
  const res = await api.GET(pedirFeed(clave, 10));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.movimientos.map((m) => [m.id, m.hoja, m.cantidad]), [["GY-11", "consumos", 2], ["GY-12", "ingresos", 5]]);
  assert.equal(data.hasta, 12);
  assert.equal(data.hayMas, false);
  assert.deepEqual(data.anulados, ["GY-4"]);
  assert.match(pedidos[0], new RegExp(`empresa_id=eq\\.${E}&id=gt\\.10&order=id\\.asc`));
  assert.ok(pedidos.every((p) => p.includes(`empresa_id=eq.${E}`)), "todo filtrado por la empresa de la clave");
  await waitFor(() => assert.ok(escrito.some((w) => w.metodo === "PATCH" && w.body.valor.ultima_lectura && w.body.valor.hash === hash)));
});

test("/api/stock/planilla GET — sin movimientos nuevos el cursor queda donde estaba", async () => {
  _resetBuckets();
  const { clave, hash } = generarClave(E);
  mockRuta({ hash });
  const data = await (await api.GET(pedirFeed(clave, 33))).json();
  assert.deepEqual(data.movimientos, []);
  assert.equal(data.hasta, 33);
});

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const generar = (t) => new Request("http://gypi.test/api/stock/planilla", { method: "POST", headers: { Authorization: `Bearer ${t}` } });

test("/api/stock/planilla POST — gestión genera el código; guarda solo el hash", async () => {
  let { escrito } = mockRuta({});
  assert.equal((await api.POST(generar(await token("operativo")))).status, 403);
  ({ escrito } = mockRuta({}));
  const res = await api.POST(generar(await token("gerencial")));
  assert.equal(res.status, 200);
  const { script } = await res.json();
  const clave = script.match(/var GYPI_CLAVE = "([^"]+)"/)[1];
  assert.equal(empresaDeClave(clave), E);
  assert.match(script, /var GYPI_URL = "http:\/\/gypi\.test\/api\/stock\/planilla"/);
  const [guardado] = escrito;
  assert.equal(guardado.metodo, "POST");
  assert.equal(guardado.body.clave, CLAVE_PLANILLA_MRP);
  assert.equal(guardado.body.valor.hash, hashClave(clave));
  assert.ok(!JSON.stringify(guardado.body).includes(clave), "la clave no se guarda");
});

// ─── El script de la planilla, corrido con una planilla de mentira ───

class Hoja {
  constructor(filas, ancho) { this.f = filas.map((r) => [...r, ...Array(ancho).fill("")].slice(0, ancho)); this.ancho = ancho; this.amarillas = []; }
  getMaxRows() { return this.f.length; }
  getLastRow() { for (let i = this.f.length - 1; i >= 0; i--) if (this.f[i].some((v) => v !== "" && v !== null)) return i + 1; return 0; }
  insertRowsAfter(_, n) { for (let i = 0; i < n; i++) this.f.push(Array(this.ancho).fill("")); }
  deleteRow(r) { this.f.splice(r - 1, 1); }
  getRange(r, c, nr, nc) {
    const hoja = this;
    return {
      getValues: () => hoja.f.slice(r - 1, r - 1 + nr).map((fila) => fila.slice(c - 1, c - 1 + nc)),
      setValues: (v) => v.forEach((fila, i) => fila.forEach((x, j) => { hoja.f[r - 1 + i][c - 1 + j] = x; })),
      setFormulas: (v) => v.forEach((fila, i) => fila.forEach((x, j) => { hoja.f[r - 1 + i][c - 1 + j] = x; })),
      setBackground: (color) => { hoja.amarillas.push({ fila: r, color, id: hoja.f[r - 1][0] }); },
    };
  }
}

function correrScript(script, { hojas, respuestas, props = {} }) {
  const pedidos = [];
  const entorno = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => hojas[n] || null }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    UrlFetchApp: {
      fetch: (url, opts) => {
        pedidos.push({ url, auth: opts.headers.Authorization });
        const r = respuestas.shift();
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(r) };
      },
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => {} }) }) }) },
  };
  const correr = new Function(...Object.keys(entorno), `${script}\ntraerMovimientosGypi();`);
  correr(...Object.values(entorno));
  return { pedidos, props };
}

test("script de la planilla — anota al final, reconoce al colaborador, no repite y borra lo anulado", () => {
  const script = scriptPlanilla({ url: "https://gypi.test/api/stock/planilla", clave: "gyp_x" });
  const cons = new Hoja([
    ["id_registro", "Marca temporal", "ID_SKU", "CODIGO COLABORADOR", "MES", "FECHA", "DESCRIPCIÓN  ARTICULO", "CANTIDAD CONSUMIDA", "COLABORADOR", "ORIGEN", "CODIGO PROYECTO ASOCIADO", "ORIGEN"],
    ["0098b61a", "", "1.1", 213, 9, new Date(2025, 8, 22), "CANTO", -68, "GIRI TADEO", "AJUSTE", "", ""],
    ["GY-4", "", "1.1", 200, 10, new Date(2026, 9, 14), "CANTO", 2, "GUZMAN FACUNDO ARIEL", "CONSUMO FÁBRICA", "", ""],
    ["", "", "1.2.3", 213, 10, new Date(2026, 9, 15), "MDF", 2, "GIRI TADEO", "CONSUMO FÁBRICA", "m-7495", ""],
    ["", "", "=XLOOKUP(G4…)", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
  ], 15);
  const ing = new Hoja([["ID_INGRESO", "ID_SKU", "ID_PROVEEDOR", "FECHA CARGA", "NOMBRE NORMALIZADO"], ["", "", "", "", "", "", "", "", "", "", "=I2*J2", "=K2*0.21", "=K2+L2"]], 13);
  const personal = new Hoja([["colaborador_id", "nombre"], [200, "GUZMAN FACUNDO ARIEL"], [213, "GIRI TADEO"]], 2);
  const mov = (id, extra) => ({ id: `GY-${id}`, hoja: "consumos", fecha: "2026-10-15", momento: "2026-10-15T15:00:00Z", sku: "1.2.3", nombre: "MDF", cantidad: 2, origen: "CONSUMO FÁBRICA", detalle: "GYPI · Retiro", ot: "M-7495", colaborador: "Facundo Guzmán", proveedor: "", comprobante: "", precio_unitario: null, anulado: false, ...extra });
  const { pedidos, props } = correrScript(script, {
    hojas: { fact_consumos_stock: cons, fact_ingresos_stock: ing, PERSONAL: personal },
    props: { GYPI_DESDE: "10" },
    respuestas: [
      { movimientos: [mov(11), mov(12, { anulado: true }), mov(4)], anulados: [], hasta: 12, hayMas: true },
      { movimientos: [mov(13, { hoja: "ingresos", proveedor: "Masisa", cantidad: 5, precio_unitario: 100 }), mov(14, { colaborador: "Nadie Conocido" })], anulados: [], hasta: 14, hayMas: false },
    ],
  });
  assert.deepEqual(pedidos.map((p) => p.url), ["https://gypi.test/api/stock/planilla?desde=10&ordenes=1", "https://gypi.test/api/stock/planilla?desde=12"]);
  assert.equal(pedidos[0].auth, "Bearer gyp_x");
  assert.equal(props.GYPI_DESDE, "14");

  const ids = cons.f.map((r) => r[0]);
  assert.deepEqual(ids.filter((x) => String(x).startsWith("GY-")), ["GY-4", "GY-11", "GY-14"], "sin repetir el 4 ni pasar el anulado 12");
  const fila11 = cons.f[ids.indexOf("GY-11")];
  assert.equal(ids.indexOf("GY-11"), 4, "en la primera fila libre, aunque abajo haya fórmulas");
  assert.equal(fila11[2], "1.2.3");
  assert.equal(fila11[3], 200, "código de PERSONAL");
  assert.equal(fila11[4], 10, "mes");
  assert.equal(fila11[5].getDate(), 15);
  assert.equal(fila11[7], 2);
  assert.equal(fila11[8], "GUZMAN FACUNDO ARIEL");
  assert.equal(fila11[10], "M-7495");
  assert.deepEqual(cons.amarillas.map((a) => [a.id, a.color]), [["GY-11", "yellow"]], "el 11 coincide con el renglón cargado a mano; el 14, igual, ya no tiene con cuál");
  assert.match(fila11[11], /¿duplicado\?/);
  const fila14 = cons.f[ids.indexOf("GY-14")];
  assert.equal(fila14[3], "", "sin código si no está en PERSONAL");
  assert.equal(fila14[8], "NADIE CONOCIDO");

  assert.equal(ing.f[1][0], "GY-13");
  assert.equal(ing.f[1][5], "Masisa");
  assert.equal(ing.f[1][8], 5);
  assert.equal(ing.f[1][10], "=I2*J2");

  // Al día siguiente: el 11 se anuló en Gypi
  correrScript(script, {
    hojas: { fact_consumos_stock: cons, fact_ingresos_stock: ing, PERSONAL: personal },
    props,
    respuestas: [{ movimientos: [], anulados: ["GY-11"], hasta: 14, hayMas: false }],
  });
  assert.equal(cons.f.some((r) => r[0] === "GY-11"), false);
  assert.equal(cons.f.some((r) => r[0] === "GY-14"), true);
});

// ─── Pantalla ───

test("conectar la planilla — genera el código y muestra los pasos", async () => {
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes("/api/stock/planilla")) return new Response(JSON.stringify({ ok: true, script: "var GYPI_CLAVE = \"gyp_x\";" }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  render(<PlanillaMrpConexion />);
  fireEvent.click(await screen.findByText(/Pasar a la planilla MRP · sin conectar/));
  fireEvent.click(screen.getByText("Generar el código para la planilla"));
  await waitFor(() => assert.match(screen.getByLabelText("Código para la planilla").value, /gyp_x/));
  assert.ok(screen.getByText(/instalarGypi/));
});

// ─── Bip al escanear ───

test("bip — suena una vez por código, aunque la cámara lo lea varias veces", async () => {
  const { debeSonar, PAUSA_BIP_MS, bip } = await import("../app/lib/bip.js");
  assert.equal(debeSonar(null, "A", 1000), true);
  assert.equal(debeSonar({ codigo: "A", t: 1000 }, "A", 1350), false, "el mismo código, recién leído");
  assert.equal(debeSonar({ codigo: "A", t: 1000 }, "B", 1350), true, "otro código suena enseguida");
  assert.equal(debeSonar({ codigo: "A", t: 1000 }, "A", 1000 + PAUSA_BIP_MS), true, "el mismo, un rato después");
  assert.doesNotThrow(() => bip(), "sin audio en el navegador no rompe");
  const escaner = (await import("node:fs")).readFileSync(new URL("../app/components/EscanerCodigo.jsx", import.meta.url), "utf8");
  assert.match(escaner, /bip\(\)/);
});
