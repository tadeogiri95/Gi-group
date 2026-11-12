// tests/factura-unica.test.jsx — Una factura, una sola vez (auditoría 12/11,
// parte 1): la factura de una OC, la "otra factura" de una OC y la factura
// suelta avisan si ese número del mismo proveedor ya está cargado en Compras
// o en Finanzas, y con "Cargarla igual" (forzar) se guardan.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { avisoFacturaRepetida, facturaRepetida, mismoNumero } from "../app/lib/facturaUnica.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { buscarFacturaRepetida } = await import("../app/lib/facturaUnicaServidor.js");
const facturas = await import("../app/api/facturas-sueltas/route.js");
const { default: AvisoFacturaRepetida } = await import("../app/components/AvisoFacturaRepetida.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

// ─── Reglas ───

test("mismo número — escrito distinto es el mismo; otro número o punto de venta no", () => {
  assert.equal(mismoNumero("A 00003-00012345", "3-12345"), true);
  assert.equal(mismoNumero("FC A-00003-00012345", "0003-00012345"), true);
  assert.equal(mismoNumero("12345", "12345"), true, "sin punto de venta: mismo número del mismo proveedor");
  assert.equal(mismoNumero("3-12345", "4-12345"), false);
  assert.equal(mismoNumero("3-12345", "3-12346"), false);
  assert.equal(mismoNumero("A 3-12345", "B 3-12345"), false);
  assert.equal(mismoNumero("NC A-3-12345", "A-3-12345"), false, "una nota de crédito no es la factura");
  assert.equal(mismoNumero("", "3-12345"), false);
});

test("factura repetida — del mismo proveedor por id o por nombre; de otro proveedor no", () => {
  const cargadas = [
    { tipo: "oc", numero: "0003-00012345", fecha: "2026-11-09", proveedor_id: 1, proveedor_nombre: "MADERAS CORDOBA SA", oc_numero: 41 },
    { tipo: "mi_caja", numero: "B 00001-00000777", fecha: "2026-11-10", proveedor_id: null, proveedor_nombre: "FERRETERIA EL TORNILLO" },
  ];
  assert.equal(facturaRepetida({ numero: "3-12345", proveedor_id: 1 }, cargadas)?.oc_numero, 41);
  assert.equal(facturaRepetida({ numero: "3-12345", proveedor_id: 2, proveedor_nombre: "OTRO" }, cargadas), null);
  assert.equal(facturaRepetida({ numero: "B-1-777", proveedor_nombre: "Ferreteria El Tornillo" }, cargadas)?.tipo, "mi_caja");
  assert.equal(facturaRepetida({ numero: "3-12345" }, cargadas), null, "sin proveedor no se puede saber");
  assert.equal(facturaRepetida({ numero: "", proveedor_id: 1 }, cargadas), null);
});

test("aviso — dice de quién, de cuándo y dónde quedó cargada", () => {
  assert.equal(
    avisoFacturaRepetida({ tipo: "oc", numero: "0003-00012345", fecha: "2026-11-09", proveedor_nombre: "MADERAS CORDOBA SA", oc_numero: 41 }),
    "La factura 0003-00012345 de MADERAS CORDOBA SA ya está cargada (del 09/11/2026, en la orden de compra N° 41). Si es otra, revisá el número; si es la misma, no hace falta cargarla de nuevo.",
  );
  assert.match(avisoFacturaRepetida({ tipo: "mi_caja", numero: "1-7" }), /\(en Mi caja\)/);
  assert.match(avisoFacturaRepetida({ tipo: "suelta", numero: "1-7", fecha: "2026-11-01" }), /del 01\/11\/2026, en Compras → Facturas/);
});

// ─── Búsqueda en la base ───

function mockBase({ ocs = [], otras = [], sueltas = [], ops = [], proveedores = [] } = {}) {
  const leido = [];
  const handlers = [
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ nombre: "Ana" }] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: [{ sku: "1.10", nombre: "MELAMINA BLANCA 18MM" }] }) },
    { match: (u) => u.includes("/rest/v1/asociaciones_articulos"), respond: (u, o) => ({ status: o?.method === "POST" ? 201 : 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/precios_articulos"), respond: () => ({ status: 201, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proveedores?"), respond: () => ({ status: 200, body: proveedores }) },
    { match: (u) => u.includes("/rest/v1/ordenes_compra_facturas?"), respond: (u) => { leido.push(u); return { status: 200, body: otras }; } },
    { match: (u) => u.includes("/rest/v1/ordenes_compra?"), respond: (u) => { leido.push(u); return { status: 200, body: ocs }; } },
    { match: (u) => u.includes("/rest/v1/fin_operaciones?"), respond: (u) => { leido.push(u); return { status: 200, body: ops }; } },
    { match: (u) => u.includes("/rest/v1/facturas_sueltas_renglones"), respond: (u, o) => ({ status: 201, body: JSON.parse(o.body).map((r, i) => ({ ...r, id: 100 + i })) }) },
    {
      match: (u) => u.includes("/rest/v1/facturas_sueltas"),
      respond: (u, o) => {
        if (o?.method === "POST") { escrito.push("facturas_sueltas"); return { status: 201, body: [{ id: 55, ...JSON.parse(o.body) }] }; }
        leido.push(u);
        return { status: 200, body: sueltas };
      },
    },
  ];
  const escrito = [];
  global.fetch = createFetchMock(handlers);
  return { leido, escrito };
}

test("buscarFacturaRepetida — encuentra la de una OC, sin contar la misma OC que se corrige", async () => {
  const OC = { id: 41, numero: 41, proveedor_id: 1, proveedor_nombre: "MADERAS CORDOBA SA", factura_numero: "0003-00012345", factura_fecha: "2026-11-09" };
  const { leido } = mockBase({ ocs: [OC] });
  const r = await buscarFacturaRepetida(E, { numero: "3-12345", proveedor_id: 1, proveedor_nombre: "MADERAS CORDOBA SA" });
  assert.deepEqual([r.tipo, r.oc_numero], ["oc", 41]);
  assert.ok(leido.every((u) => u.includes(`empresa_id=eq.${E}`)), "siempre filtra por empresa");
  assert.ok(leido.some((u) => u.includes("factura_numero=ilike.*12345*")));
  mockBase({ ocs: [OC] });
  assert.equal(await buscarFacturaRepetida(E, { numero: "3-12345", proveedor_id: 1 }, { oc: 41 }), null);
});

test("buscarFacturaRepetida — encuentra lo cargado en Mi caja con el proveedor de la lista", async () => {
  const { leido } = mockBase({
    ops: [{ id: 9, fecha: "2026-11-10", origen: "mi_caja", referencia: "A 00003-00012345", proveedor_id: 1, entidad: null }],
    proveedores: [{ id: 1, nombre: "MADERAS CORDOBA SA" }],
  });
  const r = await buscarFacturaRepetida(E, { numero: "0003-00012345", proveedor_id: null, proveedor_nombre: "Maderas Córdoba S.A." });
  assert.equal(r?.tipo, "mi_caja");
  assert.equal(r.proveedor_nombre, "MADERAS CORDOBA SA");
  const fin = decodeURIComponent(leido.find((u) => u.includes("fin_operaciones")));
  assert.match(fin, /origen=in\.\(mi_caja,gasto,sos,compra_manual,manual\)/, "lo que vino de Compras no se cuenta dos veces");
});

test("buscarFacturaRepetida — las listas de precios y la misma otra factura no cuentan", async () => {
  mockBase({
    sueltas: [{ id: 3, tipo: "lista", numero: "12345", proveedor: "FAPLAC", proveedor_id: null, fecha: "2026-11-01" }],
    otras: [{ id: 7, orden_id: 41, proveedor_id: 2, proveedor_nombre: "FAPLAC", numero: "12345", fecha: "2026-11-02" }],
    ocs: [],
  });
  assert.equal(await buscarFacturaRepetida(E, { numero: "12345", proveedor_nombre: "FAPLAC" }, { oc_otra: 7 }), null);
});

// ─── Factura suelta ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const guardar = async (body) => facturas.POST(new Request("http://localhost/api/facturas-sueltas", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token("gerencial")}` },
  body: JSON.stringify({ accion: "guardar", tipo: "factura", proveedor: "FAPLAC", numero: "0003-00012", fecha: "2026-11-11", moneda: "ARS", renglones: [{ descripcion: "Placa", cantidad: 2, precio: 100, sku: "1.10" }], ...body }),
}));

test("/api/facturas-sueltas — si la factura ya entró por una OC avisa y no guarda; con forzar la guarda", async () => {
  const OC = { id: 40, numero: 40, proveedor_id: 2, proveedor_nombre: "FAPLAC", factura_numero: "3-12", factura_fecha: "2026-11-09" };
  let { escrito } = mockBase({ ocs: [OC], proveedores: [{ id: 2, nombre: "FAPLAC" }] });
  let r = await guardar({});
  let d = await r.json();
  assert.equal(r.status, 409);
  assert.equal(d.repetida, true);
  assert.match(d.error, /La factura 3-12 de FAPLAC ya está cargada \(del 09\/11\/2026, en la orden de compra N° 40\)/);
  assert.equal(escrito.length, 0, "no guardó nada");

  ({ escrito } = mockBase({ ocs: [OC], proveedores: [{ id: 2, nombre: "FAPLAC" }] }));
  r = await guardar({ forzar: true });
  d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.deepEqual(escrito, ["facturas_sueltas"]);
});

test("/api/facturas-sueltas — una lista de precios con el mismo nombre no avisa", async () => {
  const OC = { id: 40, numero: 40, proveedor_id: 2, proveedor_nombre: "FAPLAC", factura_numero: "3-12", factura_fecha: "2026-11-09" };
  const { escrito } = mockBase({ ocs: [OC], proveedores: [{ id: 2, nombre: "FAPLAC" }] });
  const r = await guardar({ tipo: "lista", numero: "0003-00012" });
  assert.equal(r.status, 200);
  assert.deepEqual(escrito, ["facturas_sueltas"]);
});

// ─── Pantallas ───

test("aviso en pantalla — explica y deja revisar o cargarla igual", () => {
  let igual = 0;
  let revisar = 0;
  render(<AvisoFacturaRepetida mensaje="La factura 3-12 de FAPLAC ya está cargada." onCargarIgual={() => igual++} onRevisar={() => revisar++} />);
  assert.ok(screen.getByRole("alert").textContent.includes("La factura 3-12 de FAPLAC ya está cargada."));
  fireEvent.click(screen.getByText("Es otra: cargarla igual"));
  fireEvent.click(screen.getByText("Revisar el número"));
  assert.deepEqual([igual, revisar], [1, 1]);
  cleanup();
  const { container } = render(<AvisoFacturaRepetida mensaje={null} onCargarIgual={() => {}} onRevisar={() => {}} />);
  assert.equal(container.textContent, "");
});

test("la factura de la OC y la otra factura de la OC usan el mismo chequeo", () => {
  const ruta = readFileSync(new URL("../app/api/compras/route.js", import.meta.url), "utf8");
  assert.equal((ruta.match(/buscarFacturaRepetida\(/g) || []).length, 2);
  assert.match(ruta, /\{ oc: oc\.id \}/, "la OC que se corrige no se cuenta a sí misma");
  const pantalla = readFileSync(new URL("../app/components/OrdenesCompra.jsx", import.meta.url), "utf8");
  assert.equal((pantalla.match(/<AvisoFacturaRepetida /g) || []).length, 2);
  assert.match(pantalla, /forzar: true/);
});
