// tests/compras-ordenes.test.jsx — Compras, parte 21 (ítem 41): Administración
// junta pedidos pendientes y sugeridos de la planilla MRP en "A comprar" y
// Gypi arma una orden de compra por proveedor, con PDF y WhatsApp
// (migración 114).
import "./helpers/domSetup.js";
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  redondearMultiplo, importeTexto, leerImporte, totalOrden, ocAtrasada, proveedorSugerido, lineasAComprar, agruparPorProveedor,
  textoOrdenCompra, htmlOrdenCompra,
} from "../app/lib/ordenesCompra.js";
import { unirArticulos } from "../app/lib/stock.js";
import { comprasBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";
import { _limpiarCacheAlcance } from "../app/lib/alcance.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
beforeEach(() => _limpiarCacheAlcance());
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/compras/route.js");
const { default: AComprar } = await import("../app/components/AComprar.jsx");
const { default: OrdenesCompra } = await import("../app/components/OrdenesCompra.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const ALUAR = { id: 1, nombre: "Aluar", activo: true, contacto: "Marta", whatsapp: "11 2345 6789", email: "ventas@aluar.test", cuit: "30-12345678-9", condicion_pago: "30 días" };
const EGGER = { id: 2, nombre: "Egger", activo: true };
const PLACA = { sku: "1.1.2.18", nombre: "Placa melamina blanca", unidad: "placas", semaforo: "🔴 URGENTE", sugerido: 7, multiplo: 5, ultimo_precio: 80000, proveedor_principal: "EGGER", activo: true };
const PERFIL = { sku: "3.3.1.6", nombre: "Perfil 0277", unidad: "MT", semaforo: "🟡 PEDIR", sugerido: 12, multiplo: null, ultimo_precio: null, activo: true };
const OK = { sku: "9.9.9", nombre: "Tornillo", semaforo: "✅ OK", sugerido: 0, activo: true };

// ─── Reglas ───

test("cantidades al múltiplo, importes y total sin IVA", () => {
  assert.equal(redondearMultiplo(7, 5), 10);
  assert.equal(redondearMultiplo(10, 5), 10);
  assert.equal(redondearMultiplo(2.5, null), 2.5);
  assert.equal(redondearMultiplo(0.3, 0.1), 0.3, "sin errores de coma flotante");
  assert.equal(redondearMultiplo(0, 5), null);
  assert.equal(leerImporte("1.050"), 1050, "punto de miles");
  assert.equal(leerImporte("$ 1.500,50"), 1500.5);
  assert.equal(leerImporte("10,5"), 10.5);
  assert.equal(leerImporte("US$ 12"), 12);
  assert.equal(leerImporte("-3"), null);
  assert.equal(leerImporte("abc"), null);
  assert.equal(importeTexto(1234.5), "$ 1.234,5");
  assert.equal(importeTexto(10, "USD"), "US$ 10");
  assert.equal(importeTexto(null), "—");
  assert.equal(totalOrden([{ cantidad: 2, precio_unitario: 100 }, { cantidad: 3, precio_unitario: 0.5 }, { cantidad: 1, precio_unitario: null }]), 201.5);
  assert.equal(totalOrden([{ cantidad: 2, precio_unitario: null }]), null);
});

test("OC atrasada — enviada y pasada la fecha prometida", () => {
  assert.equal(ocAtrasada({ estado: "enviada", fecha_prometida: "2026-10-10" }, "2026-10-17"), true);
  assert.equal(ocAtrasada({ estado: "enviada", fecha_prometida: "2026-10-17" }, "2026-10-17"), false);
  assert.equal(ocAtrasada({ estado: "borrador", fecha_prometida: "2026-10-10" }, "2026-10-17"), false);
  assert.equal(ocAtrasada({ estado: "enviada", fecha_prometida: null }, "2026-10-17"), false);
});

test("proveedor sugerido — el principal de la planilla o el de la última OC", () => {
  const provs = [ALUAR, EGGER];
  assert.equal(proveedorSugerido(PLACA, provs), 2, "PROVEEDOR PRINCIPAL sin importar mayúsculas");
  assert.equal(proveedorSugerido(PERFIL, provs, new Map([[PERFIL.sku, 1]])), 1);
  assert.equal(proveedorSugerido(PERFIL, provs, new Map([[PERFIL.sku, 99]])), null, "uno dado de baja no se sugiere");
  assert.equal(proveedorSugerido(PERFIL, provs), null);
});

test("A comprar — pedidos primero, después sugeridos de la planilla sin repetir", () => {
  const pedidos = [
    { id: 5, estado: "pendiente", sku: PLACA.sku, descripcion: "Placa melamina blanca", cantidad: 3, ot: "M-7495", empleado_nombre: "Ana", para_fecha: "2026-10-20" },
    { id: 6, estado: "pendiente", sku: null, descripcion: "Tornillos 4x40", unidad: "cajas", cantidad: 2 },
    { id: 7, estado: "en_oc", sku: "x", descripcion: "Ya en OC", cantidad: 1 },
  ];
  const lineas = lineasAComprar({
    pedidos, articulos: [PLACA, PERFIL, OK, { ...PERFIL, sku: "en.oc", semaforo: "🔴" }], proveedores: [ALUAR, EGGER], skusEnOc: new Set(["en.oc"]),
  });
  assert.deepEqual(lineas.map((l) => l.clave), ["p5", "p6", `m${PERFIL.sku}`]);
  const [placa, tornillos, perfil] = lineas;
  assert.equal(placa.cantidad, 5, "el pedido también se redondea al múltiplo");
  assert.equal(placa.precio_unitario, 80000);
  assert.equal(placa.proveedor_id, 2);
  assert.equal(placa.pedido_id, 5);
  assert.equal(placa.ot, "M-7495");
  assert.match(placa.detalle, /Ana · para el 20\/10\/2026/);
  assert.equal(tornillos.unidad, "cajas");
  assert.equal(tornillos.proveedor_id, null);
  assert.equal(perfil.origen, "mrp");
  assert.equal(perfil.cantidad, 12);
  assert.equal(perfil.nivel, "amarillo");
  assert.deepEqual(agruparPorProveedor([{ ...placa }, { ...perfil, proveedor_id: 1 }, tornillos]).map((g) => [g.proveedor_id, g.lineas.length]), [[2, 1], [1, 1]]);
});

test("texto para WhatsApp y PDF de la OC", () => {
  const oc = { numero: 12, proveedor_nombre: "Aluar", moneda: "ARS", fecha_prometida: "2026-10-24", notas: "Entregar en planta", created_at: "2026-10-17T12:00:00Z" };
  const items = [{ descripcion: "Perfil 0277", sku: "3.3.1.6", cantidad: 12, unidad: "MT", precio_unitario: 1500, ot: "M-7495" }];
  const texto = textoOrdenCompra({ empresa: "GI Group", oc, items, proveedor: ALUAR });
  assert.match(texto, /^Hola Marta, te paso la orden de compra N° 12 de GI Group:/);
  assert.match(texto, /• 12 MT Perfil 0277 \(3\.3\.1\.6\) · \$ 1\.500 c\/u/);
  assert.match(texto, /Total sin IVA: \$ 18\.000/);
  assert.match(texto, /Entrega: 24\/10\/2026/);

  const html = htmlOrdenCompra({
    empresa: { nombre: "GI <Group>", cuit: "30711222333", logo_url: "https://x.test/logo.png" },
    oc: { ...oc, moneda: "USD" }, items, proveedor: ALUAR,
  });
  assert.match(html, /Orden de compra N° 12/);
  assert.match(html, /GI &lt;Group&gt;/);
  assert.match(html, /CUIT 30-71122233-3/);
  assert.match(html, /<img src="https:\/\/x\.test\/logo\.png"/);
  assert.match(html, /US\$ 18\.000/);
  assert.match(html, /en dólares/);
  assert.match(html, /OT M-7495/);
  assert.doesNotMatch(htmlOrdenCompra({ empresa: { logo_url: "javascript:alert(1)" }, oc, items }), /javascript:/);
  assert.doesNotMatch(texto, /Obs\./, "sin observación no hay renglón de más");
});

test("la observación de cada renglón sale en el WhatsApp y en el PDF (120)", () => {
  const oc = { numero: 12, proveedor_nombre: "Aluar", moneda: "ARS", created_at: "2026-10-17T12:00:00Z" };
  const items = [
    { descripcion: "Perfil 0277", sku: "3.3.1.6", cantidad: 12, unidad: "MT", precio_unitario: 1500, observacion: "Anodizado <negro>" },
    { descripcion: "Tornillos", cantidad: 2, unidad: "cajas", precio_unitario: null },
  ];
  const texto = textoOrdenCompra({ empresa: "GI Group", oc, items });
  assert.match(texto, /• 12 MT Perfil 0277 \(3\.3\.1\.6\) · \$ 1\.500 c\/u\n {3}Obs\.: Anodizado <negro>\n• 2 cajas Tornillos/);
  const html = htmlOrdenCompra({ empresa: { nombre: "GI" }, oc, items });
  assert.match(html, /<div class="obs">Obs\.: Anodizado &lt;negro&gt;<\/div>/);
  assert.equal(html.match(/class="obs"/g).length, 1);
});

test("planilla — la sincronización trae último precio, proveedor principal, múltiplo y plazo", () => {
  const inventario = "SKU,ARTICULO,STOCK TOTAL,LEAD TIME (d),SEMÁFORO MRP,MÚLTIPLO,CANTIDAD SUGERIDA\n1.2.3,Bisagra,10,7,🔴,5,8";
  const articulos = "ID,ID_SKU,Nombre normalizado,Unidad Medida,ÚLTIMO PRECIO,PROVEEDOR PRINCIPAL,LOTE MÍNIMO / MÚLTIPLO\n1,1.2.3,Bisagra cazoleta,u,\"$1.012,50\",Herrajes SA,";
  const [fila] = unirArticulos({ inventario, articulos }).filas;
  assert.equal(fila.ultimo_precio, 1012.5);
  assert.equal(fila.proveedor_principal, "Herrajes SA");
  assert.equal(fila.multiplo, 5);
  assert.equal(fila.plazo_dias, 7);
  const [sinColumnas] = unirArticulos({ inventario: "SKU,ARTICULO\n1.2.3,Bisagra" }).filas;
  assert.equal(sinColumnas.multiplo, null);
  assert.equal(sinColumnas.ultimo_precio, null);
});

test("validación — armar, guardar, enviar y anular OC", () => {
  const ok = (b) => comprasBody.safeParse(b).success;
  const linea = { proveedor_id: 1, descripcion: "Placa", cantidad: 5, precio_unitario: 80000, pedido_id: 5, sku: "1.1.2" };
  assert.equal(ok({ accion: "oc_crear", lineas: [linea] }), true);
  assert.equal(ok({ accion: "oc_crear", moneda: "USD", lineas: [linea] }), true);
  assert.equal(ok({ accion: "oc_crear", moneda: "EUR", lineas: [linea] }), false);
  assert.equal(ok({ accion: "oc_crear", lineas: [] }), false);
  assert.equal(ok({ accion: "oc_crear", lineas: [{ ...linea, cantidad: 0 }] }), false);
  assert.equal(ok({ accion: "oc_crear", lineas: [{ ...linea, precio_unitario: -1 }] }), false);
  assert.equal(ok({ accion: "oc_crear", lineas: [{ ...linea, empresa_id: E }] }), false);
  assert.equal(ok({ accion: "oc_guardar", id: 3, fecha_prometida: "2026-10-24", notas: "" }), true);
  assert.equal(ok({ accion: "oc_guardar", id: 3, items: [{ id: 1, cantidad: 2, precio_unitario: null }], quitar: [4] }), true);
  assert.equal(ok({ accion: "oc_guardar", id: 3, estado: "recibida" }), false);
  assert.equal(ok({ accion: "oc_guardar", id: 3, items: [{ id: 1, cantidad: 2, precio_unitario: null, observacion: "Color blanco" }] }), true);
  assert.equal(ok({ accion: "oc_guardar", id: 3, items: [{ id: 1, cantidad: 2, precio_unitario: null, observacion: "x".repeat(301) }] }), false);
  assert.equal(ok({ accion: "oc_enviar", id: 3 }), true);
  assert.equal(ok({ accion: "oc_anular", id: "3" }), false);
});

test("migración 114 — columnas de la planilla, OC por empresa, sin borrar OC", () => {
  const sql = readFileSync(new URL("../supabase/migrations/114_compras_ordenes.sql", import.meta.url), "utf8");
  for (const col of ["ultimo_precio", "proveedor_principal", "multiplo", "plazo_dias"]) assert.match(sql, new RegExp(`add column if not exists ${col}`));
  assert.match(sql, /add column if not exists orden_id bigint references public\.ordenes_compra/);
  assert.match(sql, /ordenes_compra_empresa_numero on public\.ordenes_compra \(empresa_id, numero\)/);
  for (const t of ["ordenes_compra", "ordenes_compra_items"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`tenant_isolation_auth_${t} on`));
    assert.equal(autorizar(t, "GET", { rol: "operativo" }).ok, false);
    assert.equal(autorizar(t, "GET", { rol: "administrativo" }).ok, true);
    for (const metodo of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar(t, metodo, { rol: "gerencial" }).ok, false, `${t} ${metodo}`);
  }
  assert.match(sql, /grant select, insert, update on public\.ordenes_compra to authenticated/);
  assert.match(sql, /grant select, insert, update, delete on public\.ordenes_compra_items to authenticated/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Ruta ───

function mockRuta({ supervisor = null, proveedores = [ALUAR, EGGER], pedidos = null, ultima = 7, oc = null, items = [], choques = 0, falla = null, sin120 = false } = {}) {
  const escrito = [];
  let choquesQuedan = choques;
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return body;
  };
  global.fetch = createFetchMock([
    {
      match: (u) => u.includes("/rest/v1/empleados"),
      respond: (u) => u.includes("solo_su_division")
        ? { status: 200, body: [{ id: EMP, legajo: 7, division: supervisor, solo_su_division: Boolean(supervisor) }] }
        : u.includes("select=id,legajo") ? { status: 200, body: [{ id: EMP, legajo: 7 }] } : { status: 200, body: [{ nombre: "Laura Admin" }] },
    },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: proveedores }) },
    {
      match: (u) => u.includes("/rest/v1/pedidos_compra"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: pedidos ?? [] };
        anotar("pedidos_compra", u, o);
        return { status: 200, body: [] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/ordenes_compra_items"),
      respond: (u, o) => {
        if (falla) return { status: 404, body: { message: falla } };
        if (!o.method || o.method === "GET") return { status: 200, body: items };
        if (sin120 && String(o.body).includes("observacion")) {
          return { status: 400, body: { code: "PGRST204", message: "Could not find the 'observacion' column of 'ordenes_compra_items' in the schema cache" } };
        }
        const body = anotar("ordenes_compra_items", u, o);
        return { status: 201, body: Array.isArray(body) ? body : [] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/ordenes_compra"),
      respond: (u, o) => {
        if (falla) return { status: 404, body: { message: falla } };
        if (!o.method || o.method === "GET") return { status: 200, body: u.includes("order=numero.desc") ? (ultima ? [{ numero: ultima }] : []) : oc ? [oc] : [] };
        if (o.method === "POST" && choquesQuedan > 0) {
          choquesQuedan--;
          return { status: 409, body: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        const body = anotar("ordenes_compra", u, o);
        return { status: 201, body: [{ id: 100 + escrito.filter((x) => x.tabla === "ordenes_compra" && x.metodo === "POST").length, ...oc, ...body }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/compras", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const LINEAS = [
  { proveedor_id: 2, sku: PLACA.sku, descripcion: "Placa melamina blanca", unidad: "placas", cantidad: 5, precio_unitario: 80000, pedido_id: 5, ot: "M-7495" },
  { proveedor_id: 1, sku: PERFIL.sku, descripcion: "Perfil 0277", unidad: "MT", cantidad: 12 },
  { proveedor_id: 2, descripcion: "Tornillos 4x40", unidad: "cajas", cantidad: 2, pedido_id: 6 },
];

test("/api/compras oc_crear — una OC por proveedor, numeradas, y los pedidos pasan a en OC", async () => {
  const escrito = mockRuta({ pedidos: [{ id: 5, estado: "pendiente" }, { id: 6, estado: "pendiente" }] });
  const res = await api.POST(req(await token("administrativo"), { accion: "oc_crear", moneda: "USD", lineas: LINEAS }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.ordenes.map((o) => [o.numero, o.proveedor_nombre]), [[8, "Egger"], [9, "Aluar"]]);
  const ocs = escrito.filter((x) => x.tabla === "ordenes_compra");
  assert.equal(ocs[0].body.estado, "borrador");
  assert.equal(ocs[0].body.moneda, "USD");
  assert.equal(ocs[0].body.empresa_id, E);
  assert.equal(ocs[0].body.creada_por_nombre, "Laura Admin");
  const its = escrito.filter((x) => x.tabla === "ordenes_compra_items");
  assert.deepEqual(its[0].body.map((i) => [i.orden_id, i.descripcion, i.pedido_id]), [[101, "Placa melamina blanca", 5], [101, "Tornillos 4x40", 6]]);
  assert.equal(its[0].body[0].precio_unitario, 80000);
  assert.equal(its[1].body[0].orden_id, 102);
  const [ped] = escrito.filter((x) => x.tabla === "pedidos_compra");
  assert.match(ped.url, /id=in\.\(5,6\)&estado=eq\.pendiente/);
  assert.deepEqual(ped.body, { estado: "en_oc", orden_id: 101 });
});

test("/api/compras oc_crear — la nota del pedido pasa a la observación del renglón (120)", async () => {
  let escrito = mockRuta({ pedidos: [{ id: 5, estado: "pendiente", notas: "Color blanco, 18 mm" }, { id: 6, estado: "pendiente", notas: null }] });
  let res = await api.POST(req(await token("gerencial"), { accion: "oc_crear", lineas: LINEAS }));
  assert.equal(res.status, 200);
  let its = escrito.filter((x) => x.tabla === "ordenes_compra_items");
  assert.equal(its[0].body[0].observacion, "Color blanco, 18 mm");
  assert.equal("observacion" in its[0].body[1], false, "sin nota no manda la columna");
  assert.equal("observacion" in its[1].body[0], false, "lo de la planilla no tiene nota");

  // Sin la migración 120 la OC se arma igual, sin observación
  escrito = mockRuta({ pedidos: [{ id: 5, estado: "pendiente", notas: "Color blanco" }, { id: 6, estado: "pendiente" }], sin120: true });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_crear", lineas: LINEAS }));
  assert.equal(res.status, 200);
  its = escrito.filter((x) => x.tabla === "ordenes_compra_items");
  assert.equal(its.length, 2);
  assert.equal("observacion" in its[0].body[0], false);
  assert.equal(escrito.some((x) => x.tabla === "ordenes_compra" && x.body?.estado === "anulada"), false);
});

test("/api/compras oc_crear — si dos arman a la vez, toma el número siguiente", async () => {
  const escrito = mockRuta({ choques: 1 });
  const res = await api.POST(req(await token("gerencial"), { accion: "oc_crear", lineas: [LINEAS[1]] }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ordenes[0].numero, 9);
  assert.equal(escrito.filter((x) => x.tabla === "ordenes_compra").length, 1);
});

test("/api/compras oc_crear — el jefe de taller no; pedidos ya tomados o proveedor de baja no", async () => {
  let escrito = mockRuta({ supervisor: "MUEBLES" });
  let res = await api.POST(req(await token("administrativo"), { accion: "oc_crear", lineas: [LINEAS[1]] }));
  assert.equal(res.status, 403);
  assert.equal(escrito.length, 0);

  _limpiarCacheAlcance();
  escrito = mockRuta({ pedidos: [{ id: 5, estado: "en_oc" }, { id: 6, estado: "pendiente" }] });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_crear", lineas: LINEAS }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /ya no está pendiente/);
  assert.equal(escrito.length, 0);

  mockRuta({ proveedores: [ALUAR, { ...EGGER, activo: false }] });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_crear", lineas: [LINEAS[1], { ...LINEAS[0], pedido_id: null }] }));
  assert.equal(res.status, 409);
});

test("/api/compras oc_guardar — en borrador cambia renglones; quitar devuelve el pedido a pendiente", async () => {
  const oc = { id: 101, numero: 8, estado: "borrador", moneda: "ARS" };
  const escrito = mockRuta({ oc, items: [{ pedido_id: 5 }] });
  const res = await api.POST(req(await token("gerencial"), {
    accion: "oc_guardar", id: 101, moneda: "USD", fecha_prometida: "2026-10-24", notas: "En planta", items: [{ id: 1, cantidad: 10, precio_unitario: 75000 }], quitar: [2],
  }));
  assert.equal(res.status, 200);
  const borrado = escrito.find((x) => x.metodo === "DELETE");
  assert.match(borrado.url, /ordenes_compra_items\?orden_id=eq\.101&empresa_id=eq\..*&id=in\.\(2\)/);
  const liberado = escrito.find((x) => x.tabla === "pedidos_compra");
  assert.match(liberado.url, /orden_id=eq\.101&id=in\.\(5\)&estado=eq\.en_oc/);
  assert.deepEqual(liberado.body, { estado: "pendiente", orden_id: null });
  const renglon = escrito.find((x) => x.tabla === "ordenes_compra_items" && x.metodo === "PATCH");
  assert.deepEqual(renglon.body, { cantidad: 10, precio_unitario: 75000 });
  const cab = escrito.find((x) => x.tabla === "ordenes_compra" && x.metodo === "PATCH");
  assert.equal(cab.body.moneda, "USD");
  assert.equal(cab.body.fecha_prometida, "2026-10-24");
  assert.equal(cab.body.notas, "En planta");
});

test("/api/compras oc_guardar — guarda la observación del renglón; sin la 120 avisa", async () => {
  const oc = { id: 101, numero: 8, estado: "borrador", moneda: "ARS" };
  let escrito = mockRuta({ oc });
  let res = await api.POST(req(await token("gerencial"), { accion: "oc_guardar", id: 101, items: [{ id: 1, cantidad: 10, precio_unitario: null, observacion: " Color blanco " }, { id: 2, cantidad: 1, precio_unitario: null, observacion: "" }] }));
  assert.equal(res.status, 200);
  const renglones = escrito.filter((x) => x.tabla === "ordenes_compra_items" && x.metodo === "PATCH");
  assert.deepEqual(renglones.map((r) => r.body), [{ cantidad: 10, precio_unitario: null, observacion: "Color blanco" }, { cantidad: 1, precio_unitario: null, observacion: null }]);

  escrito = mockRuta({ oc, sin120: true });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_guardar", id: 101, items: [{ id: 1, cantidad: 10, precio_unitario: null, observacion: "Color blanco" }] }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 120/);
});

test("/api/compras oc_guardar — enviada: fecha prometida sí, precios no", async () => {
  const oc = { id: 101, numero: 8, estado: "enviada", moneda: "ARS" };
  let escrito = mockRuta({ oc });
  let res = await api.POST(req(await token("gerencial"), { accion: "oc_guardar", id: 101, items: [{ id: 1, cantidad: 10, precio_unitario: 1 }] }));
  assert.equal(res.status, 409);
  assert.equal(escrito.length, 0);
  res = await api.POST(req(await token("gerencial"), { accion: "oc_guardar", id: 101, moneda: "ARS", fecha_prometida: "2026-10-30" }));
  assert.equal(res.status, 200, "la misma moneda no cuenta como cambio");
  escrito = mockRuta({ oc: { ...oc, estado: "anulada" } });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_guardar", id: 101, fecha_prometida: "2026-10-30" }));
  assert.equal(res.status, 409);
});

test("/api/compras oc_enviar y oc_anular", async () => {
  let escrito = mockRuta({ oc: { id: 101, estado: "borrador" }, items: [{ id: 1 }] });
  let res = await api.POST(req(await token("gerencial"), { accion: "oc_enviar", id: 101 }));
  assert.equal(res.status, 200);
  const env = escrito.find((x) => x.tabla === "ordenes_compra");
  assert.match(env.url, /estado=eq\.borrador/);
  assert.equal(env.body.estado, "enviada");
  assert.ok(env.body.enviada_at);

  mockRuta({ oc: { id: 101, estado: "borrador" }, items: [] });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_enviar", id: 101 }));
  assert.equal(res.status, 409, "sin renglones no se manda");

  escrito = mockRuta({ oc: { id: 101, estado: "enviada" } });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_anular", id: 101 }));
  assert.equal(res.status, 200);
  assert.equal(escrito.find((x) => x.tabla === "ordenes_compra").body.estado, "anulada");
  const lib = escrito.find((x) => x.tabla === "pedidos_compra");
  assert.match(lib.url, /orden_id=eq\.101&estado=eq\.en_oc/);
  assert.deepEqual(lib.body, { estado: "pendiente", orden_id: null });

  mockRuta({ oc: { id: 101, estado: "recibida_parcial" } });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_anular", id: 101 }));
  assert.equal(res.status, 409);

  mockRuta({ oc: null });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_enviar", id: 101 }));
  assert.equal(res.status, 404);
});

test("/api/compras — si falta la migración 114 lo dice", async () => {
  mockRuta({ falla: 'relation "public.ordenes_compra" does not exist' });
  const res = await api.POST(req(await token("gerencial"), { accion: "oc_enviar", id: 101 }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 114/);
});

// ─── Pantallas ───

function mockPantalla({ ordenes = [], items = [], pedidos = [], articulos = [PLACA, PERFIL], proveedores = [ALUAR, EGGER] } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/compras")) {
      enviados.push(body);
      if (body.accion === "oc_crear") return new Response(JSON.stringify({ ok: true, ordenes: [{ id: 101, numero: 8, proveedor_nombre: "Egger" }] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const path = body?.path || "";
    const data = path.startsWith("articulos_stock") ? articulos
      : path.startsWith("pedidos_compra") ? pedidos
        : path.startsWith("proveedores") ? (path.includes("id=eq.") ? proveedores.filter((p) => path.includes(`id=eq.${p.id}`)) : proveedores)
          : path.startsWith("ordenes_compra_items") ? items
            : path.startsWith("ordenes_compra") ? ordenes : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return enviados;
}

test("A comprar — tilda el pedido y el sugerido, elige proveedor y arma las OC", async () => {
  const pedidos = [{ id: 5, estado: "pendiente", sku: PLACA.sku, descripcion: "Placa melamina blanca", cantidad: 3, ot: "M-7495", empleado_nombre: "Ana" }];
  const enviados = mockPantalla({ pedidos });
  let creadas = null;
  render(<AComprar empresaId={E} onCreadas={(l) => { creadas = l; }} />);
  fireEvent.click(await screen.findByLabelText("Comprar Placa melamina blanca"));
  fireEvent.click(screen.getByLabelText("Comprar Perfil 0277"));
  assert.equal(screen.getByLabelText("Proveedor de Placa melamina blanca").value, "2", "sugiere el principal de la planilla");
  assert.equal(screen.getByLabelText("Cantidad de Placa melamina blanca").value, "5");
  fireEvent.click(screen.getByText("Armar órdenes de compra"));
  assert.match(screen.getByRole("alert").textContent, /Elegí el proveedor de: Perfil 0277/);
  fireEvent.change(screen.getByLabelText("Proveedor de Perfil 0277"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Precio sin IVA de Perfil 0277"), { target: { value: "1.500,50" } });
  assert.ok(screen.getByText(/2 órdenes de compra: Egger, Aluar/));
  fireEvent.click(screen.getByText("Armar órdenes de compra"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], {
    accion: "oc_crear", moneda: "ARS",
    lineas: [
      { proveedor_id: 2, sku: PLACA.sku, descripcion: "Placa melamina blanca", unidad: "placas", cantidad: 5, precio_unitario: 80000, pedido_id: 5, ot: "M-7495" },
      { proveedor_id: 1, sku: PERFIL.sku, descripcion: "Perfil 0277", unidad: "MT", cantidad: 12, precio_unitario: 1500.5, pedido_id: null, ot: null },
    ],
  });
  await waitFor(() => assert.equal(creadas?.[0]?.numero, 8));
});

test("Órdenes — corrige el precio, la marca enviada y arma el WhatsApp", async () => {
  const ordenes = [{ id: 101, numero: 8, proveedor_id: 1, proveedor_nombre: "Aluar", estado: "borrador", moneda: "ARS", created_at: "2026-10-17T12:00:00Z" }];
  const items = [{ id: 1, orden_id: 101, sku: PERFIL.sku, descripcion: "Perfil 0277", unidad: "MT", cantidad: 12, precio_unitario: null, cantidad_recibida: 0 }];
  const enviados = mockPantalla({ ordenes, items });
  render(<OrdenesCompra empresaId={E} empresa={{ nombre: "GI Group" }} />);
  fireEvent.click(await screen.findByText("OC N° 8 · Aluar"));
  fireEvent.change(await screen.findByLabelText("Precio sin IVA de Perfil 0277"), { target: { value: "1500" } });
  assert.ok(screen.getByText("Total sin IVA: $ 18.000"));
  const wa = screen.getByText("💬 WhatsApp").getAttribute("href");
  assert.match(wa, /^https:\/\/wa\.me\/5491123456789\?text=/);
  assert.match(decodeURIComponent(wa), /Hola Marta, te paso la orden de compra N° 8 de GI Group/);
  assert.match(screen.getByText("✉️ Email").getAttribute("href"), /^mailto:ventas@aluar\.test\?subject=Orden%20de%20compra%20N%C2%B0%208/);
  fireEvent.change(screen.getByLabelText("Fecha prometida"), { target: { value: "2026-10-24" } });
  fireEvent.click(screen.getByText("📤 Marcar como enviada"));
  await waitFor(() => assert.equal(enviados.length, 2));
  assert.deepEqual(enviados[0], { accion: "oc_guardar", id: 101, fecha_prometida: "2026-10-24", notas: null, moneda: "ARS", items: [{ id: 1, cantidad: 12, precio_unitario: 1500 }] });
  assert.deepEqual(enviados[1], { accion: "oc_enviar", id: 101 });
});

test("Órdenes — en borrador se corrige la observación de cada renglón y sale en el WhatsApp", async () => {
  const ordenes = [{ id: 101, numero: 8, proveedor_id: 1, proveedor_nombre: "Aluar", estado: "borrador", moneda: "ARS", created_at: "2026-10-17T12:00:00Z" }];
  const items = [
    { id: 1, orden_id: 101, descripcion: "Perfil 0277", unidad: "MT", cantidad: 12, precio_unitario: 1500, cantidad_recibida: 0, observacion: "Anodizado" },
    { id: 2, orden_id: 101, descripcion: "Tornillos", unidad: "cajas", cantidad: 2, precio_unitario: null, cantidad_recibida: 0, observacion: null },
  ];
  const enviados = mockPantalla({ ordenes, items });
  render(<OrdenesCompra empresaId={E} empresa={{ nombre: "GI Group" }} />);
  fireEvent.click(await screen.findByText("OC N° 8 · Aluar"));
  const obs = await screen.findByLabelText("Observación para el proveedor de Perfil 0277");
  assert.equal(obs.value, "Anodizado");
  fireEvent.change(obs, { target: { value: "Anodizado negro" } });
  fireEvent.change(screen.getByLabelText("Observación para el proveedor de Tornillos"), { target: { value: "Cabeza fresada" } });
  assert.match(decodeURIComponent(screen.getByText("💬 WhatsApp").getAttribute("href")), /Obs\.: Anodizado negro[\s\S]*Obs\.: Cabeza fresada/);
  fireEvent.click(screen.getByText("Guardar cambios"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0].items, [
    { id: 1, cantidad: 12, precio_unitario: 1500, observacion: "Anodizado negro" },
    { id: 2, cantidad: 2, precio_unitario: null, observacion: "Cabeza fresada" },
  ]);
});

test("Órdenes — las atrasadas se ven y una enviada no se edita", async () => {
  const ordenes = [
    { id: 101, numero: 8, proveedor_id: 1, proveedor_nombre: "Aluar", estado: "enviada", moneda: "ARS", fecha_prometida: "2026-01-02", created_at: "2025-12-20T12:00:00Z" },
    { id: 102, numero: 9, proveedor_id: 2, proveedor_nombre: "Egger", estado: "anulada", moneda: "ARS", created_at: "2026-10-17T12:00:00Z" },
  ];
  mockPantalla({ ordenes, items: [{ id: 1, orden_id: 101, descripcion: "Perfil", cantidad: 3, precio_unitario: 10, cantidad_recibida: 0 }] });
  render(<OrdenesCompra empresaId={E} />);
  await screen.findByText("OC N° 8 · Aluar");
  assert.equal(screen.queryByText("OC N° 9 · Egger"), null, "arranca con las abiertas");
  assert.match(screen.getByText(/OC N° 8/).parentElement.textContent, /Atrasada/);
  fireEvent.click(screen.getByText("OC N° 8 · Aluar"));
  await screen.findByText(/\$ 10 c\/u/);
  assert.equal(screen.queryByLabelText("Precio sin IVA de Perfil"), null);
  assert.equal(screen.queryByText("📤 Marcar como enviada"), null);
  assert.ok(screen.getByText("Anular orden de compra"));
});

test("accesos — pestañas A comprar y Órdenes solo para el comprador", () => {
  const src = readFileSync(new URL("../app/components/ComprasScreen.jsx", import.meta.url), "utf8");
  assert.match(src, /\["acomprar", "🧾 A comprar"\], \["ordenes", "📄 Órdenes"\]/);
  assert.match(src, /vista === "acomprar" && comprador/);
  assert.match(src, /vista === "ordenes" && comprador/);
});
