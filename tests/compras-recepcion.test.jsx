// tests/compras-recepcion.test.jsx — Compras, parte 22 (ítem 41): los jefes
// de taller o Administración reciben la OC con el remito; cada renglón con
// SKU entra como ingreso de stock; la factura puede llegar después y, si
// cambia el precio, el ingreso se reemplaza (migración 115).
import "./helpers/domSetup.js";
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { pendienteItem, estadoTrasRecepcion, precioEnPesos, renglonFactura, totalesFactura, cantidadFacturaInicial } from "../app/lib/ordenesCompra.js";
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
const { default: RecibirCompra } = await import("../app/components/RecibirCompra.jsx");
const { default: OrdenesCompra } = await import("../app/components/OrdenesCompra.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const OC = { id: 101, numero: 8, proveedor_id: 1, proveedor_nombre: "Aluar", estado: "enviada", moneda: "ARS", enviada_at: "2026-10-17T12:00:00Z", created_at: "2026-10-17T12:00:00Z" };
const PERFIL = { id: 1, orden_id: 101, sku: "3.3.1.6", descripcion: "Perfil 0277", unidad: "MT", cantidad: 12, precio_unitario: 1500, cantidad_recibida: 0, ot: "M-7495", pedido_id: 5 };
const TORNILLOS = { id: 2, orden_id: 101, sku: null, descripcion: "Tornillos 4x40", unidad: "cajas", cantidad: 2, precio_unitario: null, cantidad_recibida: 0, ot: null, pedido_id: 6 };

// ─── Reglas ───

test("lo que falta, el estado de la OC y el precio en pesos", () => {
  assert.equal(pendienteItem({ cantidad: 12, cantidad_recibida: 5 }), 7);
  assert.equal(pendienteItem({ cantidad: 12, cantidad_recibida: 15 }), 0, "si vino de más no queda negativo");
  assert.equal(pendienteItem({ cantidad: 0.3, cantidad_recibida: 0.1 }), 0.2);
  assert.equal(estadoTrasRecepcion([{ cantidad: 2, cantidad_recibida: 2 }, { cantidad: 1, cantidad_recibida: 1 }]), "recibida");
  assert.equal(estadoTrasRecepcion([{ cantidad: 2, cantidad_recibida: 1 }, { cantidad: 1, cantidad_recibida: 0 }]), "recibida_parcial");
  assert.equal(estadoTrasRecepcion([{ cantidad: 2, cantidad_recibida: 0 }]), "enviada");
  assert.equal(precioEnPesos(1500.555, "ARS"), 1500.56);
  assert.equal(precioEnPesos(10, "USD", 1050), 10500);
  assert.equal(precioEnPesos(10, "USD", null), null, "en dólares sin tipo de cambio no hay precio en pesos");
  assert.equal(precioEnPesos(null, "ARS"), null);
});

test("validación — recepción con remito, factura", () => {
  const ok = (b) => comprasBody.safeParse(b).success;
  const rec = { accion: "recepcion_crear", orden_id: 101, remito: "0004-00012345", items: [{ item_id: 1, cantidad: 12 }] };
  assert.equal(ok(rec), true);
  assert.equal(ok({ ...rec, remito: " " }), false, "el remito es obligatorio");
  assert.equal(ok({ ...rec, items: [] }), false);
  assert.equal(ok({ ...rec, items: [{ item_id: 1, cantidad: 0 }] }), false);
  assert.equal(ok({ ...rec, foto_url: "https://x.test/remito.jpg" }), true);
  assert.equal(ok({ ...rec, foto_url: "no es url" }), false);
  assert.equal(ok({ accion: "recepcion_anular", id: 3 }), true);
  assert.equal(ok({ accion: "oc_factura", id: 101, factura_numero: "A-0003-00001234", factura_fecha: "2026-10-20", tipo_cambio: 1050, renglones: [{ item_id: 1, precio_unitario: 1600 }] }), true);
  assert.equal(ok({ accion: "oc_factura", id: 101, tipo_cambio: 0 }), false);
  assert.equal(ok({ accion: "oc_factura", id: 101, otros_impuestos: 350.5, renglones: [{ item_id: 1, cantidad_facturada: 10, iva_alicuota: 10.5 }] }), true);
  assert.equal(ok({ accion: "oc_factura", id: 101, renglones: [{ item_id: 1, iva_alicuota: 19 }] }), false, "IVA 21, 10,5, 27 o 0");
  assert.equal(ok({ accion: "oc_factura", id: 101, otros_impuestos: -1 }), false);
});

test("migración 115 — recepciones por empresa, sin borrar; factura en la OC", () => {
  const sql = readFileSync(new URL("../supabase/migrations/115_compras_recepciones.sql", import.meta.url), "utf8");
  for (const col of ["factura_numero", "factura_fecha", "tipo_cambio"]) assert.match(sql, new RegExp(`add column if not exists ${col}`));
  assert.match(sql, /movimiento_id\s+bigint references public\.movimientos_stock\(id\)/);
  for (const t of ["recepciones_compra", "recepciones_compra_items"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`tenant_isolation_auth_${t} on`));
    assert.match(sql, new RegExp(`grant select, insert, update on public\\.${t} to authenticated`));
    assert.doesNotMatch(sql, new RegExp(`grant[^;]*delete[^;]*${t}`, "i"));
    assert.equal(autorizar(t, "GET", { rol: "operativo" }).ok, false);
    assert.equal(autorizar(t, "GET", { rol: "administrativo" }).ok, true);
    for (const metodo of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar(t, metodo, { rol: "gerencial" }).ok, false, `${t} ${metodo}`);
  }
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Ruta ───

// Lo que contestan las funciones de la migración 130 si todo sale bien
function respuestaRpc(nombre, body) {
  if (nombre === "compras_recibir") {
    return { ok: true, recepcion: { id: 77, orden_id: body.p_orden, ...body.p_recepcion }, estado: "recibida", ingresos: body.p_lineas.filter((l) => l.ingreso).length };
  }
  if (nombre === "compras_anular_recepcion") return { ok: true, recepcion: { id: body.p_recepcion, anulada: true }, estado: "enviada", movimientos: 1 };
  return { ok: true, orden: { id: body.p_orden, ...body.p_cabecera }, reemplazados: 1 };
}

function mockRuta({ supervisor = null, oc = OC, items = [PERFIL, TORNILLOS], recepcion = null, lineas = [], movs = [], recepciones = [], falla = null, fallaPatch = null, rpc = null } = {}) {
  const escrito = [];
  let siguienteMov = 500;
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return body;
  };
  const tabla = (nombre, leer) => ({
    match: (u) => u.includes(`/rest/v1/${nombre}?`) || u.endsWith(`/rest/v1/${nombre}`),
    respond: (u, o) => {
      if (falla && nombre.startsWith("recepciones")) return { status: 404, body: { message: falla } };
      if (fallaPatch && o.method === "PATCH") return { status: 400, body: { code: "PGRST204", message: fallaPatch } };
      if (!o.method || o.method === "GET") return { status: 200, body: leer(u) };
      const body = anotar(nombre, u, o);
      if (nombre === "movimientos_stock" && o.method === "POST") {
        const lista = Array.isArray(body) ? body : [body];
        return { status: 201, body: lista.map((m) => ({ id: siguienteMov++, ...m })) };
      }
      return { status: o.method === "POST" ? 201 : 200, body: Array.isArray(body) ? body : [{ id: 77, ...body }] };
    },
  });
  global.fetch = createFetchMock([
    {
      match: (u) => u.includes("/rest/v1/rpc/compras_"),
      respond: (u, o) => {
        const nombre = u.split("/rpc/")[1];
        const body = JSON.parse(o.body);
        escrito.push({ tabla: `rpc:${nombre}`, metodo: "POST", url: u, body });
        return rpc ? rpc(nombre, body) : { status: 200, body: respuestaRpc(nombre, body) };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/empleados"),
      respond: (u) => u.includes("solo_su_division")
        ? { status: 200, body: [{ id: EMP, legajo: 7, division: supervisor, solo_su_division: Boolean(supervisor) }] }
        : u.includes("select=id,legajo") ? { status: 200, body: [{ id: EMP, legajo: 7 }] } : { status: 200, body: [{ nombre: "Pedro Jefe" }] },
    },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: [{ sku: "3.3.1.6", nombre: "Tablilla perfil 0277", unidad: "MT", division: "ALUMINIO" }] }) },
    tabla("recepciones_compra_items", () => lineas),
    tabla("recepciones_compra", () => (recepcion ? [recepcion] : recepciones)),
    tabla("ordenes_compra_items", () => items.map((it) => ({ ...it }))),
    tabla("ordenes_compra", () => (oc ? [oc] : [])),
    tabla("movimientos_stock", () => movs),
    tabla("pedidos_compra", () => []),
  ]);
  return escrito;
}

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/compras", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/compras recepcion_crear — el jefe recibe todo: un solo pedido a la base con la recepción y el ingreso de stock", async () => {
  const escrito = mockRuta({ supervisor: "ALUMINIO" });
  const res = await api.POST(req(await token("administrativo"), {
    accion: "recepcion_crear", orden_id: 101, remito: "0004-00012345", items: [{ item_id: 1, cantidad: 12 }, { item_id: 2, cantidad: 2 }],
  }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.estado, "recibida");
  assert.equal(data.ingresos, 1, "los tornillos no son del stock: no generan ingreso");
  // Nada se escribe tabla por tabla: todo va junto a compras_recibir (130)
  assert.deepEqual(escrito.map((x) => x.tabla), ["rpc:compras_recibir"]);
  const { body } = escrito[0];
  assert.equal(body.p_empresa, E);
  assert.equal(body.p_orden, 101);
  assert.equal(body.p_recepcion.remito, "0004-00012345");
  assert.equal(body.p_recepcion.empleado_nombre, "Pedro Jefe");
  assert.deepEqual(body.p_lineas.map((l) => [l.item_id, l.cantidad, Boolean(l.ingreso)]), [[1, 12, true], [2, 2, false]]);
  const mov = body.p_lineas[0].ingreso;
  assert.deepEqual(
    { sku: mov.sku, nombre: mov.nombre, ot: mov.ot, proveedor: mov.proveedor, comprobante: mov.comprobante, precio: mov.precio_unitario, notas: mov.notas, legajo: mov.legajo },
    { sku: "3.3.1.6", nombre: "Tablilla perfil 0277", ot: "M-7495", proveedor: "Aluar", comprobante: "0004-00012345", precio: 1500, notas: "OC N° 8", legajo: 7 },
  );
});

test("/api/compras recepcion_crear — el mismo renglón dos veces se suma; en dólares sin tipo de cambio va sin precio", async () => {
  const escrito = mockRuta({ oc: { ...OC, moneda: "USD" } });
  const res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 2.5 }, { item_id: 1, cantidad: 2.5 }] }));
  assert.equal(res.status, 200);
  const [linea] = escrito[0].body.p_lineas;
  assert.equal(escrito[0].body.p_lineas.length, 1);
  assert.equal(linea.cantidad, 5);
  assert.equal(linea.ingreso.precio_unitario, null);
});

test("/api/compras recepcion_crear — si otra persona cambió la OC recién, avisa sin guardar nada", async () => {
  for (const [rpc, error] of [
    [{ ok: false, tipo: "estado", estado: "recibida" }, /recibió completa/],
    [{ ok: false, tipo: "estado", estado: "anulada" }, /anulada/],
    [{ ok: false, tipo: "renglon" }, /no es de esta orden/],
    [{ ok: false, tipo: "a_cotizar" }, /a cotizar/],
  ]) {
    mockRuta({ rpc: () => ({ status: 200, body: rpc }) });
    const res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 1 }] }));
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, error);
  }
});

test("/api/compras recepcion_crear — operario no; OC anulada o recibida no; renglón de otra OC no", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token("operativo"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 1 }] }));
  assert.equal(res.status, 403);
  assert.equal(escrito.length, 0);
  mockRuta({ oc: { ...OC, estado: "anulada" } });
  res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 1 }] }));
  assert.equal(res.status, 409);
  mockRuta({ oc: { ...OC, estado: "recibida" } });
  res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 1 }] }));
  assert.match((await res.json()).error, /recibió completa/);
  escrito = mockRuta();
  res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 99, cantidad: 1 }] }));
  assert.equal(res.status, 409);
  assert.equal(escrito.length, 0);
});

test("/api/compras recepcion_anular — Administración anula todo junto; el jefe de taller no", async () => {
  let escrito = mockRuta({ supervisor: "ALUMINIO", recepcion: { id: 9, orden_id: 101, remito: "R-1", anulada: false } });
  let res = await api.POST(req(await token("administrativo"), { accion: "recepcion_anular", id: 9 }));
  assert.equal(res.status, 403, "el jefe de taller no anula");
  assert.equal(escrito.length, 0);

  _limpiarCacheAlcance();
  escrito = mockRuta({ oc: { ...OC, estado: "recibida" } });
  res = await api.POST(req(await token("gerencial"), { accion: "recepcion_anular", id: 9 }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.estado, "enviada");
  assert.equal(data.recepcion.anulada, true);
  assert.deepEqual(escrito.map((x) => x.tabla), ["rpc:compras_anular_recepcion"]);
  assert.deepEqual(escrito[0].body, { p_empresa: E, p_recepcion: 9, p_empleado: EMP });

  mockRuta({ rpc: () => ({ status: 200, body: { ok: false, tipo: "sin_recepcion" } }) });
  res = await api.POST(req(await token("gerencial"), { accion: "recepcion_anular", id: 999 }));
  assert.equal(res.status, 404);
});

test("/api/compras oc_factura — la factura y el reemplazo de ingresos van juntos a la base", async () => {
  const escrito = mockRuta({ oc: { ...OC, estado: "recibida" }, items: [{ ...PERFIL, cantidad_recibida: 12 }] });
  const res = await api.POST(req(await token("gerencial"), {
    accion: "oc_factura", id: 101, factura_numero: "A-0003-00001234", factura_fecha: "2026-10-20", tipo_cambio: 1050, renglones: [{ item_id: 1, precio_unitario: 1600 }],
  }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).reemplazados, 1);
  assert.deepEqual(escrito.map((x) => x.tabla), ["rpc:compras_factura"]);
  const { body } = escrito[0];
  assert.deepEqual(body.p_renglones, [{ item_id: 1, precio_unitario: 1600 }]);
  assert.deepEqual(body.p_cabecera, { factura_numero: "A-0003-00001234", factura_fecha: "2026-10-20", tipo_cambio: null }, "en pesos no lleva tipo de cambio");
  assert.deepEqual(body.p_quien, { empleado_id: EMP, legajo: 7, empleado_nombre: "Pedro Jefe" });
});

test("/api/compras oc_factura — sin cambios en los renglones no los manda; OC anulada no; el jefe no", async () => {
  let escrito = mockRuta({ oc: { ...OC, estado: "recibida", factura_numero: "F-1" }, items: [{ ...PERFIL, cantidad_recibida: 12 }] });
  let res = await api.POST(req(await token("gerencial"), { accion: "oc_factura", id: 101, factura_numero: "F-1", renglones: [{ item_id: 1, precio_unitario: 1500 }] }));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito[0].body.p_renglones, []);

  escrito = mockRuta({ oc: { ...OC, estado: "anulada" } });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_factura", id: 101, factura_numero: "F-1" }));
  assert.equal(res.status, 409);
  assert.equal(escrito.length, 0);

  escrito = mockRuta({ oc: { ...OC, estado: "recibida" } });
  res = await api.POST(req(await token("gerencial"), { accion: "oc_factura", id: 101, renglones: [{ item_id: 99, precio_unitario: 1 }] }));
  assert.equal(res.status, 409, "renglón de otra OC");
  assert.equal(escrito.length, 0);

  mockRuta({ supervisor: "ALUMINIO" });
  res = await api.POST(req(await token("administrativo"), { accion: "oc_factura", id: 101, factura_numero: "F-1" }));
  assert.equal(res.status, 403, "la factura la carga Administración");
});

test("/api/compras — si falta la migración 130 o la 115 lo dice", async () => {
  const sinFuncion = { code: "PGRST202", message: "Could not find the function public.compras_recibir(p_empresa, p_lineas, p_orden, p_recepcion) in the schema cache" };
  mockRuta({ rpc: () => ({ status: 404, body: sinFuncion }) });
  let res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 1 }] }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 130/);

  mockRuta({ rpc: () => ({ status: 404, body: { ...sinFuncion, message: "Could not find the function public.compras_anular_recepcion(p_empleado, p_empresa, p_recepcion) in the schema cache" } }) });
  res = await api.POST(req(await token("gerencial"), { accion: "recepcion_anular", id: 9 }));
  assert.match((await res.json()).error, /migración 130/);

  mockRuta({ rpc: () => ({ status: 400, body: { code: "42P01", message: 'relation "recepciones_compra" does not exist' } }) });
  res = await api.POST(req(await token("gerencial"), { accion: "recepcion_crear", orden_id: 101, remito: "R-1", items: [{ item_id: 1, cantidad: 1 }] }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 115/);
});

test("migración 130 — recibir, anular y factura todo o nada, de a uno por OC y solo desde el servidor", () => {
  const sql = readFileSync(new URL("../supabase/migrations/130_compras_transacciones.sql", import.meta.url), "utf8");
  for (const f of ["compras_recibir", "compras_anular_recepcion", "compras_factura", "compras_estado_orden"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${f}\\(`));
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public`));
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from anon, authenticated`));
  }
  for (const f of ["compras_recibir", "compras_anular_recepcion", "compras_factura"]) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`));
  }
  assert.doesNotMatch(sql, /grant execute on function public\.compras_estado_orden/, "el estado lo usan solo las otras funciones");
  assert.doesNotMatch(sql, /to (anon|authenticated)\b/);
  assert.equal((sql.match(/security definer/g) || []).length, 4);
  assert.equal((sql.match(/pg_advisory_xact_lock\(hashtextextended\('compras_oc:'/g) || []).length, 3, "un candado por OC en las tres");
  assert.match(sql, /set cantidad_recibida = cantidad_recibida \+ v_cantidad/, "suma sobre lo guardado, no sobre lo que leyó la pantalla");
  assert.match(sql, /v_oc\.estado in \('anulada', 'cerrada_faltantes'\)/, "anular una recepción no reabre la OC cerrada");
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Pantallas ───

function mockPantalla({ ordenes = [OC], items = [PERFIL, TORNILLOS], recepciones = [] } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/compras")) {
      enviados.push(body);
      const extra = body.accion === "recepcion_crear" ? { estado: "recibida_parcial", ingresos: 1 } : body.accion === "oc_factura" ? { reemplazados: 1 } : {};
      return new Response(JSON.stringify({ ok: true, ...extra }), { status: 200 });
    }
    const path = body?.path || "";
    const data = path.startsWith("ordenes_compra_items") ? items
      : path.startsWith("ordenes_compra") ? ordenes
        : path.startsWith("recepciones_compra") ? recepciones
          : path.startsWith("proveedores") ? [{ id: 1, nombre: "Aluar" }] : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return enviados;
}

test("Recibir — el jefe abre la OC, ajusta lo que llegó y pone el remito", async () => {
  const enviados = mockPantalla({ items: [{ ...PERFIL, cantidad_recibida: 4 }, TORNILLOS] });
  render(<RecibirCompra empresaId={E} />);
  fireEvent.click(await screen.findByText("OC N° 8 · Aluar"));
  const perfil = await screen.findByLabelText("Llegó ahora de Perfil 0277");
  assert.equal(perfil.value, "8", "arranca con lo que falta");
  assert.ok(screen.getByText(/Pedido 12 MT · Llegó 4 · Falta 8/));
  fireEvent.change(screen.getByLabelText("Llegó ahora de Tornillos 4x40"), { target: { value: "" } });
  fireEvent.click(screen.getByText("📦 Registrar lo que llegó"));
  assert.match(screen.getByRole("alert").textContent, /N° de remito/);
  fireEvent.change(screen.getByLabelText("N° de remito"), { target: { value: "0004-00012345" } });
  fireEvent.click(screen.getByText("📦 Registrar lo que llegó"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], { accion: "recepcion_crear", orden_id: 101, remito: "0004-00012345", foto_url: null, notas: null, items: [{ item_id: 1, cantidad: 8 }] });
  await screen.findByText(/Recepción guardada y 1 ingreso de stock cargado\. La orden quedó recibida en parte\./);
});

test("Recibir — Administración ve las recepciones y anula una; el jefe no", async () => {
  const recepciones = [{ id: 9, remito: "R-1", empleado_nombre: "Pedro", created_at: "2026-10-17T15:00:00Z", anulada: false, foto_url: "https://x.test/r.jpg" }];
  let enviados = mockPantalla({ recepciones });
  render(<RecibirCompra empresaId={E} />);
  fireEvent.click(await screen.findByText("OC N° 8 · Aluar"));
  await screen.findByText("Remito R-1");
  assert.equal(screen.queryByLabelText("Anular recepción del remito R-1"), null);
  cleanup();
  enviados = mockPantalla({ recepciones });
  render(<RecibirCompra empresaId={E} comprador />);
  fireEvent.click(await screen.findByText("OC N° 8 · Aluar"));
  fireEvent.click(await screen.findByLabelText("Anular recepción del remito R-1"));
  await waitFor(() => assert.deepEqual(enviados[0], { accion: "recepcion_anular", id: 9 }));
});

test("Órdenes — la factura con tipo de cambio, cantidad, IVA y otros impuestos", async () => {
  const usd = { ...OC, moneda: "USD", estado: "recibida_parcial", updated_at: "x" };
  const enviados = mockPantalla({ ordenes: [usd], items: [{ ...PERFIL, precio_unitario: 10, cantidad_recibida: 4 }] });
  render(<OrdenesCompra empresaId={E} />);
  fireEvent.click(await screen.findByText("OC N° 8 · Aluar"));
  fireEvent.change(await screen.findByLabelText("N° de factura"), { target: { value: "A-0003-00001234" } });
  fireEvent.change(screen.getByLabelText("Tipo de cambio (pesos por dólar)"), { target: { value: "1.050" } });
  assert.equal(screen.getByLabelText("Cantidad en la factura de Perfil 0277").value, "4", "propone lo que llegó");
  assert.equal(screen.getByLabelText("IVA de Perfil 0277").value, "21");
  fireEvent.change(screen.getByLabelText("Precio en la factura de Perfil 0277"), { target: { value: "11,5" } });
  fireEvent.change(screen.getByLabelText("IVA de Perfil 0277"), { target: { value: "10.5" } });
  fireEvent.change(screen.getByLabelText(/Otros impuestos/), { target: { value: "2" } });
  // 4 × 11,5 = 46 neto; IVA 10,5% = 4,83; + 2 otros = 52,83
  await screen.findByText("Neto US$ 46 · IVA US$ 4,83 · Total US$ 50,83");
  assert.ok(screen.getByText("US$ 52,83"));
  fireEvent.click(screen.getByText("Guardar factura"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], {
    accion: "oc_factura", id: 101, factura_numero: "A-0003-00001234", factura_fecha: null, tipo_cambio: 1050, otros_impuestos: 2,
    renglones: [{ item_id: 1, precio_unitario: 11.5, cantidad_facturada: 4, iva_alicuota: 10.5 }],
  });
  await screen.findByText(/Corregí 1 ingreso de stock con el precio nuevo/);
});

test("factura — neto, IVA y total por renglón y al pie", () => {
  assert.deepEqual(renglonFactura({ cantidad: 3, precio: 100 }), { neto: 300, iva: 63, total: 363 }, "sin elegir es 21%");
  assert.deepEqual(renglonFactura({ cantidad: 2, precio: 50, iva: 0 }), { neto: 100, iva: 0, total: 100 });
  assert.equal(renglonFactura({ cantidad: 2, precio: null }), null);
  assert.deepEqual(totalesFactura([{ cantidad: 3, precio: 100, iva: 21 }, { cantidad: 1, precio: 200, iva: 10.5 }, { cantidad: 1, precio: null }], 15), { neto: 500, iva: 84, otros: 15, total: 599 });
  assert.equal(cantidadFacturaInicial({ cantidad: 12, cantidad_recibida: 5 }), 5, "lo que llegó");
  assert.equal(cantidadFacturaInicial({ cantidad: 12, cantidad_recibida: 0 }), 12, "nada llegó: lo pedido");
  assert.equal(cantidadFacturaInicial({ cantidad: 12, cantidad_recibida: 5, cantidad_facturada: 6 }), 6, "lo guardado");
});

test("/api/compras oc_factura — manda solo lo que cambió y otros impuestos en la OC", async () => {
  const escrito = mockRuta({ oc: { ...OC, estado: "recibida", factura_otros_impuestos: null }, items: [{ ...PERFIL, cantidad_recibida: 12, cantidad_facturada: null, iva_alicuota: null }] });
  const res = await api.POST(req(await token("gerencial"), {
    accion: "oc_factura", id: 101, factura_numero: "F-2", otros_impuestos: 120, renglones: [{ item_id: 1, precio_unitario: 1500, cantidad_facturada: 12, iva_alicuota: 21 }],
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito[0].body.p_renglones, [{ item_id: 1, cantidad_facturada: 12, iva_alicuota: 21 }], "el precio no cambió");
  assert.equal(escrito[0].body.p_cabecera.factura_otros_impuestos, 120);
});

test("/api/compras — si falta la migración 122 lo dice", async () => {
  mockRuta({ oc: { ...OC, estado: "recibida" }, items: [PERFIL], rpc: () => ({ status: 400, body: { code: "42703", message: 'column "iva_alicuota" of relation "ordenes_compra_items" does not exist' } }) });
  const res = await api.POST(req(await token("gerencial"), { accion: "oc_factura", id: 101, renglones: [{ item_id: 1, iva_alicuota: 10.5 }] }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 122/);
});

test("migración 122 — cantidad facturada, IVA y otros impuestos", () => {
  const sql = readFileSync(new URL("../supabase/migrations/122_factura_oc_impuestos.sql", import.meta.url), "utf8");
  for (const col of ["cantidad_facturada", "iva_alicuota", "factura_otros_impuestos"]) assert.match(sql, new RegExp(`add column if not exists ${col}`));
  assert.match(sql, /iva_alicuota in \(0, 10\.5, 21, 27\)/);
  assert.match(sql, /^do \$mig\$$/m);
});

test("accesos — Recibir para jefes y comprador", () => {
  const src = readFileSync(new URL("../app/components/ComprasScreen.jsx", import.meta.url), "utf8");
  assert.match(src, /PESTANAS_JEFE = \[\["pedidos", "🛒 Pedidos"\], \["recibir", "📦 Recibir"\]\]/);
  assert.match(src, /\["recibir", "📦 Recibir"\], \["proveedores", "🏭 Proveedores"\], \["reportes", "📊 Reportes"\]\]/);
  assert.match(src, /vista === "recibir" && permisos\.puede_pedir/);
});
