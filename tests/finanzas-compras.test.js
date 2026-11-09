// tests/finanzas-compras.test.js — Finanzas, parte F2a (migración 172): la
// compra sale sola de la factura de una OC o de una factura suelta, se corrige
// con la factura y se anula con ella. Tipo de compra por proveedor.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFetchMock } from "./helpers/mockFetch.js";
import { importesFacturaOc, importesFacturaSuelta, tipoDeCompra, sincronizarCompra } from "../app/lib/finanzasCompras.js";
import { validarFactura } from "../app/lib/facturasSueltas.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const TIPOS = [
  { codigo: "COMPRA MP", grupo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", activo: true },
  { codigo: "GASTOS DE LOGISTICA", grupo: "COMPRAS", cuenta_debe: "04.02.01.001.010", cuenta_haber: "02.01.02.001.001", activo: true },
  { codigo: "SIN CUENTAS", grupo: "COMPRAS", cuenta_debe: null, cuenta_haber: "02.01.02.001.001", activo: true },
];
const OC = { id: 7, numero: 120, estado: "recibida", proveedor_id: 5, proveedor_nombre: "ACERCO S A", moneda: "ARS", factura_numero: "A-0001-00000123", factura_fecha: "2026-11-08", factura_otros_impuestos: 30 };
const ITEMS = [
  { cantidad: 10, cantidad_recibida: 10, cantidad_facturada: 10, precio_unitario: 100, iva_alicuota: 21, ot: "7961" },
  { cantidad: 5, cantidad_recibida: 5, cantidad_facturada: null, precio_unitario: 40, iva_alicuota: 10.5, ot: "7961" },
];

test("factura de OC — neto, IVA por renglón, otros impuestos y la OT si es una sola", () => {
  const i = importesFacturaOc(OC, ITEMS);
  assert.deepEqual([i.neto, i.iva, i.otros, i.total], [1200, 231, 30, 1461]);
  assert.equal(i.ot, "7961");
  assert.equal(i.fecha, "2026-11-08");
  assert.match(i.descripcion, /A-0001-00000123 · OC 120/);
  assert.equal(importesFacturaOc(OC, [ITEMS[0], { ...ITEMS[1], ot: "8000" }]).ot, null, "dos OT: sin OT");
});

test("factura de OC — sin factura, anulada o en dólares sin tipo de cambio: todavía no hay compra", () => {
  assert.equal(importesFacturaOc({ ...OC, factura_numero: null, factura_fecha: null }, ITEMS), null);
  assert.equal(importesFacturaOc({ ...OC, estado: "anulada" }, ITEMS), null);
  assert.equal(importesFacturaOc({ ...OC, moneda: "USD", tipo_cambio: null }, ITEMS), null);
  const usd = importesFacturaOc({ ...OC, moneda: "USD", tipo_cambio: 1450, factura_otros_impuestos: 0 }, [ITEMS[0]]);
  assert.equal(usd.total, 1210 * 1450, "la cuenta corriente va en pesos");
  assert.deepEqual(usd.usd, { total: 1210, tc: 1450 });
});

test("factura suelta — neto de los renglones más IVA y otros; las listas de precios no son compras", () => {
  const f = { id: 3, tipo: "factura", proveedor: "Shell", numero: "B-12", fecha: "2026-11-05", moneda: "ARS", iva: 21, otros_impuestos: 0 };
  const i = importesFacturaSuelta(f, [{ cantidad: 2, precio: 50 }]);
  assert.deepEqual([i.neto, i.iva, i.total], [100, 21, 121]);
  assert.equal(importesFacturaSuelta({ ...f, tipo: "lista" }, [{ cantidad: 2, precio: 50 }]), null);
  assert.equal(importesFacturaSuelta({ ...f, anulada_at: "2026-11-06" }, [{ cantidad: 2, precio: 50 }]), null);
});

test("tipo de compra — el del proveedor; si no tiene, COMPRA MP para revisar", () => {
  assert.deepEqual(tipoDeCompra(TIPOS, { fin_tipo: "GASTOS DE LOGISTICA" }).tipo.codigo, "GASTOS DE LOGISTICA");
  assert.equal(tipoDeCompra(TIPOS, { fin_tipo: "GASTOS DE LOGISTICA" }).revisar, false);
  assert.deepEqual([tipoDeCompra(TIPOS, null).tipo.codigo, tipoDeCompra(TIPOS, null).revisar], ["COMPRA MP", true]);
  assert.equal(tipoDeCompra(TIPOS, { fin_tipo: "SIN CUENTAS" }).tipo.codigo, "COMPRA MP", "un tipo sin cuentas no sirve");
  assert.equal(tipoDeCompra([TIPOS[2]], null).tipo, null);
});

test("factura suelta — IVA y otros impuestos se validan y solo van si hay", () => {
  const base = { proveedor: "Shell", fecha: "2026-11-05", renglones: [{ descripcion: "Gasoil", cantidad: 1, precio: 100 }] };
  assert.equal(validarFactura({ ...base, iva: "21" }).factura.iva, 21);
  assert.equal("iva" in validarFactura(base).factura, false);
  assert.match(validarFactura({ ...base, iva: "-1" }).error, /IVA/);
  assert.equal("iva" in validarFactura({ ...base, tipo: "lista", iva: "21" }).factura, false);
});

// ─── La compra en Finanzas ───

function mock({ viva = null, plan = "pro", proveedor = { id: 5, fin_tipo: null }, oc = OC } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: plan, plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos") || u.includes("/rest/v1/empresa_addons"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push({ url: u, metodo: o.method, body: JSON.parse(o.body) }); return { status: 201, body: [{}] }; }
        return { status: 200, body: viva ? [viva] : [] };
      },
    },
    { match: (u) => u.includes("/rest/v1/ordenes_compra_items"), respond: () => ({ status: 200, body: ITEMS }) },
    { match: (u) => u.includes("/rest/v1/ordenes_compra?"), respond: () => ({ status: 200, body: oc ? [oc] : [] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [{ id: 9 }] }) },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => ({ status: 200, body: TIPOS }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: [proveedor] }) },
  ]);
  return escrito;
}

const E = "33333333-3333-3333-3333-333333333333";

test("sincronizar — factura nueva: crea la compra con el tipo por defecto, para revisar", async () => {
  const escrito = mock();
  assert.deepEqual(await sincronizarCompra(E, { origen: "factura_oc", id: 7 }), { accion: "creada" });
  const op = escrito[0].body;
  assert.equal(escrito[0].metodo, "POST");
  assert.equal(op.tipo, "COMPRA MP");
  assert.equal(op.estado, "para_revisar");
  assert.equal(op.origen, "factura_oc");
  assert.equal(op.origen_id, "7");
  assert.equal(op.total, 1461);
  assert.equal(op.proveedor_id, 5);
  assert.equal(op.proyecto_id, 9);
  assert.equal(op.cargada_por_nombre, "Gypi");
});

test("sincronizar — proveedor con tipo: confirmada con su tipo", async () => {
  const escrito = mock({ proveedor: { id: 5, fin_tipo: "GASTOS DE LOGISTICA" } });
  await sincronizarCompra(E, { origen: "factura_oc", id: 7 });
  assert.equal(escrito[0].body.tipo, "GASTOS DE LOGISTICA");
  assert.equal(escrito[0].body.estado, "confirmada");
});

test("sincronizar — factura corregida: corrige importes sin tocar el tipo que eligió el dueño", async () => {
  const escrito = mock({ viva: { id: 40, tipo: "GASTOS DE LOGISTICA" } });
  assert.deepEqual(await sincronizarCompra(E, { origen: "factura_oc", id: 7 }), { accion: "corregida" });
  assert.equal(escrito[0].metodo, "PATCH");
  assert.match(escrito[0].url, /id=eq\.40/);
  assert.equal(escrito[0].body.total, 1461);
  assert.equal("tipo" in escrito[0].body, false);
  assert.equal("cuenta_debe" in escrito[0].body, false);
});

test("sincronizar — OC anulada: la compra se anula", async () => {
  const escrito = mock({ viva: { id: 40 }, oc: { ...OC, estado: "anulada" } });
  assert.deepEqual(await sincronizarCompra(E, { origen: "factura_oc", id: 7 }), { accion: "anulada" });
  assert.ok(escrito[0].body.anulada_at);
  mock({ oc: { ...OC, estado: "anulada" } });
  assert.deepEqual(await sincronizarCompra(E, { origen: "factura_oc", id: 7 }), { accion: "nada" }, "sin compra viva no hay nada que anular");
});

test("sincronizar — sin Finanzas en el plan no hace nada, y un error nunca rompe la factura", async () => {
  const escrito = mock({ plan: "asistencia_15" });
  assert.deepEqual(await sincronizarCompra("44444444-4444-4444-4444-444444444444", { origen: "factura_oc", id: 7 }), { accion: "omitida" });
  assert.equal(escrito.length, 0);
  global.fetch = async () => { throw new Error("sin red"); };
  assert.deepEqual(await sincronizarCompra("55555555-5555-5555-5555-555555555555", { origen: "factura_oc", id: 7 }), { accion: "omitida" });
});

test("migración 172 — tipo por proveedor, IVA en facturas sueltas y una compra viva por factura", () => {
  const sql = readFileSync(new URL("../supabase/migrations/172_finanzas_compras.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /proveedores add column if not exists fin_tipo/);
  assert.match(sql, /facturas_sueltas add column if not exists proveedor_id/);
  assert.match(sql, /facturas_sueltas add column if not exists iva/);
  assert.match(sql, /create unique index if not exists fin_operaciones_origen_viva/);
});
