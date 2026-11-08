// tests/facturas-sueltas.test.jsx — Costo de OT, parte D: facturas sueltas (a
// mano o leídas por la IA), reconocer el artículo de cada renglón, "Sin
// asociar" que se recuerda por proveedor, y el precio a la lista de precios.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  normalizarTexto, reconocerRenglon, validarFactura, filaPrecioFactura, filasAsociacion, borradorDeLectura, netoFactura, ESQUEMA_FACTURA,
} from "../app/lib/facturasSueltas.js";

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
  { sku: "3.30", nombre: "TORNILLO 4X40" },
  { sku: "3.31", nombre: "TORNILLO 4X40" },
];

test("normalizar — sin acentos, signos ni mayúsculas", () => {
  assert.equal(normalizarTexto("  Melamína  BLANCA, 18mm. "), "melamina blanca 18mm");
  assert.equal(normalizarTexto(null), "");
});

test("reconocer — primero lo elegido antes, después el código, después el nombre único", () => {
  const asociaciones = [{ tipo: "texto", clave: "placa mela bco 18", sku: "1.10" }, { tipo: "codigo", clave: "rh 22", sku: "2.20" }];
  assert.deepEqual(reconocerRenglon({ descripcion: "Placa MELA bco 18" }, { asociaciones, articulos: ARTICULOS }), { sku: "1.10", como: "memoria" });
  assert.deepEqual(reconocerRenglon({ descripcion: "Algo", codigo: "2.20" }, { articulos: ARTICULOS }), { sku: "2.20", como: "sku" });
  assert.deepEqual(reconocerRenglon({ descripcion: "Canto", codigo: "RH-22" }, { asociaciones, articulos: ARTICULOS }), { sku: "2.20", como: "codigo" });
  assert.deepEqual(reconocerRenglon({ descripcion: "melamina blanca 18 mm." }, { articulos: ARTICULOS }), null, "18 mm no es 18mm");
  assert.deepEqual(reconocerRenglon({ descripcion: "Melamina Blanca 18MM" }, { articulos: ARTICULOS }), { sku: "1.10", como: "nombre" });
  assert.equal(reconocerRenglon({ descripcion: "tornillo 4x40" }, { articulos: ARTICULOS }), null, "dos artículos con el mismo nombre: Sin asociar");
  assert.equal(reconocerRenglon({ descripcion: "x" }, { asociaciones: [{ tipo: "texto", clave: "x", sku: "9.99" }], articulos: ARTICULOS }), null, "lo recordado de un artículo que ya no existe no cuenta");
});

test("validar — proveedor, fecha, tipo de cambio en dólares, renglones con cantidad y precio", () => {
  const ok = { proveedor: "Faplac", fecha: "2026-11-05", moneda: "ARS", renglones: [{ descripcion: "Placa", cantidad: "2", precio: "80.000,50" }] };
  const v = validarFactura(ok);
  assert.equal(v.renglones[0].precio, 80000.5);
  assert.equal(v.factura.tipo_cambio, null);
  assert.match(validarFactura({ ...ok, proveedor: " " }).error, /proveedor/);
  assert.match(validarFactura({ ...ok, fecha: "" }).error, /fecha/);
  assert.match(validarFactura({ ...ok, moneda: "USD" }).error, /tipo de cambio/);
  assert.match(validarFactura({ ...ok, renglones: [{ descripcion: "Placa", cantidad: 0, precio: 1 }] }).error, /Renglón 1: la cantidad/);
  assert.match(validarFactura({ ...ok, renglones: [] }).error, /no tiene renglones/);
  assert.equal(netoFactura([{ cantidad: 2, precio: 10.5 }, { cantidad: 1, precio: 3 }]), 24);
});

test("precio a la lista — en dólares, pasado a pesos con el tipo de cambio de la factura", () => {
  const fila = filaPrecioFactura(E, { fecha: "2026-11-05", moneda: "USD", tipo_cambio: 1000, proveedor: "Rehau", numero: "A-1" }, { id: 7, sku: "2.20", precio: 1.5, cantidad: 100, descripcion: "Canto" });
  assert.deepEqual([fila.origen, fila.referencia, fila.precio, fila.precio_ars, fila.moneda, fila.tipo_cambio, fila.comprobante], ["factura", "FS-7", 1.5, 1500, "USD", 1000, "A-1"]);
  const memoria = filasAsociacion(E, "REHAU S.A.", { descripcion: "Canto ABS", codigo: "RH-22" }, "2.20", "Ana");
  assert.deepEqual(memoria.map((m) => [m.proveedor_clave, m.tipo, m.clave]), [["rehau s a", "texto", "canto abs"], ["rehau s a", "codigo", "rh 22"]]);
});

test("lectura de la IA — borrador con números, fecha válida y sin renglones vacíos; esquema estricto", () => {
  const b = borradorDeLectura({ proveedor: "Faplac", numero: "0003-1", fecha: "05/11/2026", moneda: "USD", tipo_cambio: 0, precios_con_iva: true, renglones: [{ descripcion: "Placa", codigo: "", cantidad: 2, precio_unitario: 10 }, { descripcion: " ", cantidad: 1, precio_unitario: 1 }] });
  assert.equal(b.fecha, "", "una fecha que no es AAAA-MM-DD se deja para completar");
  assert.equal(b.tipo_cambio, "");
  assert.equal(b.precios_con_iva, true);
  assert.deepEqual(b.renglones, [{ descripcion: "Placa", codigo: "", cantidad: 2, precio: 10 }]);
  assert.equal(ESQUEMA_FACTURA.additionalProperties, false);
  assert.deepEqual(ESQUEMA_FACTURA.required.sort(), Object.keys(ESQUEMA_FACTURA.properties).sort());
});

test("migración 168 — un bloque, tablas con RLS de gestión, se anula sin borrar", () => {
  const sql = readFileSync(new URL("../supabase/migrations/168_facturas_sueltas.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  for (const t of ["facturas_sueltas", "facturas_sueltas_renglones", "asociaciones_articulos"]) assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
  assert.match(sql, /in \('gerencial', 'administrativo'\)/);
  assert.match(sql, /anulada_at/);
  assert.match(sql, /primary key \(empresa_id, proveedor_clave, tipo, clave\)/);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const post = async (rol, body) => api.POST(new Request("http://localhost/api/facturas-sueltas", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, body: JSON.stringify(body),
}));

function mockApi({ asociaciones = [], renglon = null, anthropic = null } = {}) {
  const escrito = [];
  let sig = 50;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("api.anthropic.com"), respond: (u, o) => { escrito.push({ metodo: "IA", body: JSON.parse(o.body) }); return anthropic; } },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ nombre: "Ana" }] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock?"), respond: (u) => ({ status: 200, body: u.includes("sku=eq.") ? ARTICULOS.filter((a) => u.includes(`sku=eq.${encodeURIComponent(a.sku)}`)) : ARTICULOS }) },
    { match: (u, o) => u.includes("/rest/v1/asociaciones_articulos") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: asociaciones }) },
    {
      match: (u) => /\/rest\/v1\/(facturas_sueltas|facturas_sueltas_renglones|asociaciones_articulos|precios_articulos)/.test(u),
      respond: (u, o) => {
        const metodo = o?.method || "GET";
        const tabla = /rest\/v1\/(\w+)/.exec(u)[1];
        const body = o?.body ? JSON.parse(o.body) : null;
        if (metodo !== "GET") escrito.push({ metodo, tabla, url: u, body, prefer: o.headers?.Prefer });
        if (metodo === "POST" && (tabla === "facturas_sueltas" || tabla === "facturas_sueltas_renglones")) {
          const filas = (Array.isArray(body) ? body : [body]).map((f) => ({ id: sig++, ...f }));
          return { status: 201, body: filas };
        }
        if (metodo === "GET" && tabla === "facturas_sueltas_renglones") {
          if (u.includes("facturas_sueltas!inner(*)")) return { status: 200, body: renglon ? [renglon] : [] };
          return { status: 200, body: [{ id: 5 }, { id: 6 }] };
        }
        if (metodo === "PATCH") return { status: 200, body: [{ id: 1, ...body }] };
        return { status: 200, body: [] };
      },
    },
  ]);
  return escrito;
}

test("/api/facturas-sueltas — solo el dueño y la oficina", async () => {
  const escrito = mockApi();
  for (const accion of ["guardar", "leer", "asociar", "anular"]) assert.equal((await post("operativo", { accion })).status, 403, accion);
  assert.equal(escrito.length, 0);
});

test("/api/facturas-sueltas — guardar reconoce, recuerda lo elegido a mano y manda los precios a la lista", async () => {
  const escrito = mockApi();
  const res = await post("administrativo", {
    accion: "guardar", proveedor: "Faplac", numero: "0003-12", fecha: "2026-11-05", moneda: "ARS",
    renglones: [
      { descripcion: "MELAMINA BLANCA 18MM", cantidad: 10, precio: 80000 },
      { descripcion: "Canto blanco", codigo: "C22", cantidad: 100, precio: 900, sku: "2.20", manual: true },
      { descripcion: "Flete", cantidad: 1, precio: 5000 },
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, id: 50, asociados: 2, sinAsociar: 1 });
  const renglones = escrito.find((w) => w.tabla === "facturas_sueltas_renglones" && w.metodo === "POST").body;
  assert.deepEqual(renglones.map((r) => [r.sku, r.asociado_como]), [["1.10", "nombre"], ["2.20", "manual"], [null, null]]);
  const memoria = escrito.find((w) => w.tabla === "asociaciones_articulos");
  assert.deepEqual(memoria.body.map((m) => [m.tipo, m.clave, m.sku]), [["texto", "canto blanco", "2.20"], ["codigo", "c22", "2.20"]], "solo lo elegido a mano");
  const precios = escrito.find((w) => w.tabla === "precios_articulos");
  assert.match(precios.url, /on_conflict=empresa_id,origen,referencia/);
  assert.deepEqual(precios.body.map((p) => [p.sku, p.precio_ars, p.referencia, p.origen]), [["1.10", 80000, "FS-51", "factura"], ["2.20", 900, "FS-52", "factura"]]);
  const factura = escrito.find((w) => w.tabla === "facturas_sueltas" && w.metodo === "POST").body;
  assert.equal(factura.cargada_por_nombre, "Ana");
});

test("/api/facturas-sueltas — un artículo que no está en el MRP no se guarda", async () => {
  mockApi();
  const res = await post("gerencial", { accion: "guardar", proveedor: "X", fecha: "2026-11-05", renglones: [{ descripcion: "a", cantidad: 1, precio: 1, sku: "9.99" }] });
  assert.equal(res.status, 400);
});

test("/api/facturas-sueltas — asociar un renglón Sin asociar lo recuerda y suma el precio", async () => {
  const escrito = mockApi({ renglon: { id: 9, descripcion: "Tornillo fix 4x40", codigo: null, cantidad: 500, precio: 12, facturas_sueltas: { id: 3, proveedor: "Bulonera", numero: "B-1", fecha: "2026-11-01", moneda: "ARS", anulada_at: null } } });
  const res = await post("administrativo", { accion: "asociar", renglon_id: 9, sku: "3.30" });
  assert.equal(res.status, 200);
  const patch = escrito.find((w) => w.tabla === "facturas_sueltas_renglones" && w.metodo === "PATCH");
  assert.deepEqual([patch.body.sku, patch.body.asociado_como, patch.body.asociado_por_nombre], ["3.30", "manual", "Ana"]);
  assert.deepEqual(escrito.find((w) => w.tabla === "asociaciones_articulos").body.map((m) => [m.proveedor_clave, m.clave]), [["bulonera", "tornillo fix 4x40"]]);
  assert.deepEqual(escrito.find((w) => w.tabla === "precios_articulos").body.map((p) => [p.sku, p.referencia, p.precio_ars]), [["3.30", "FS-9", 12]]);
});

test("/api/facturas-sueltas — anular saca sus precios de la lista", async () => {
  const escrito = mockApi();
  const res = await post("gerencial", { accion: "anular", id: 3 });
  assert.equal(res.status, 200);
  assert.match(escrito.find((w) => w.metodo === "PATCH").url, /facturas_sueltas\?id=eq\.3&.*anulada_at=is\.null/);
  const del = escrito.find((w) => w.metodo === "DELETE");
  assert.match(del.url, /precios_articulos\?empresa_id=eq\..*&origen=eq\.factura&referencia=in\.\(FS-5,FS-6\)/);
});

test("/api/facturas-sueltas — leer manda el PDF a la IA con esquema y devuelve el borrador reconocido", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const lectura = { proveedor: "Faplac", numero: "0003-12", fecha: "2026-11-05", moneda: "ARS", tipo_cambio: 0, precios_con_iva: false, renglones: [{ descripcion: "Melamina blanca 18mm", codigo: "", cantidad: 10, precio_unitario: 80000 }, { descripcion: "Flete", codigo: "", cantidad: 1, precio_unitario: 5000 }] };
  const escrito = mockApi({ anthropic: { status: 200, body: { model: "m", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: JSON.stringify(lectura) }] } } });
  const res = await post("administrativo", { accion: "leer", archivo: "JVBERi0xLjQK", tipo: "application/pdf" });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual(d.borrador.renglones.map((r) => [r.sku, r.como]), [["1.10", "nombre"], [null, undefined]]);
  const ia = escrito.find((w) => w.metodo === "IA").body;
  assert.equal(ia.messages[0].content[0].type, "document");
  assert.equal(ia.output_config.format.type, "json_schema");
  assert.equal(escrito.filter((w) => w.metodo === "POST").length, 0, "leer no guarda nada");

  mockApi({ anthropic: { status: 200, body: { stop_reason: "refusal", content: [] } } });
  const mal = await post("administrativo", { accion: "leer", archivo: "JVBERi0xLjQK", tipo: "application/pdf" });
  assert.equal(mal.status, 502);
  assert.equal((await post("administrativo", { accion: "leer", archivo: "abc", tipo: "text/plain" })).status, 400);
});

// ─── Pantalla ───

test("pantalla — Sin asociar con buscador; al elegir, asocia", async () => {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/data")) return Response.json({ data: ARTICULOS });
    if (opts.method === "POST") { pedidos.push(JSON.parse(opts.body)); return Response.json({ ok: true }); }
    if (u.includes("vista=sin_asociar")) return Response.json({ ok: true, renglones: [{ id: 9, descripcion: "Tornillo fix", cantidad: 500, precio: 12, facturas_sueltas: { proveedor: "Bulonera", numero: "B-1", fecha: "2026-11-01", moneda: "ARS" } }] });
    return Response.json({ ok: true, sinAsociar: 1, facturas: [{ id: 3, proveedor: "Bulonera", numero: "B-1", fecha: "2026-11-01", moneda: "ARS", carga: "ia", facturas_sueltas_renglones: [{ cantidad: 500, precio: 12, sku: null }] }] });
  };
  render(<FacturasSueltas />);
  await waitFor(() => screen.getByText(/0 de 1 asociados/));
  assert.ok(screen.getByText(/leída por la IA/));
  fireEvent.click(screen.getByRole("tab", { name: "Sin asociar (1)" }));
  await waitFor(() => screen.getByText("Tornillo fix"));
  fireEvent.change(screen.getByLabelText("Artículo para Tornillo fix"), { target: { value: "tornillo" } });
  await waitFor(() => screen.getAllByText(/TORNILLO 4X40/));
  fireEvent.click(screen.getAllByText(/TORNILLO 4X40/)[0]);
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.deepEqual(pedidos[0], { accion: "asociar", renglon_id: 9, sku: "3.30" });
  const compras = readFileSync(new URL("../app/components/ComprasScreen.jsx", import.meta.url), "utf8");
  assert.match(compras, /vista === "facturas" && comprador && gestion/);
});
