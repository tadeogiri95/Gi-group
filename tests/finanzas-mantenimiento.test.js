// tests/finanzas-mantenimiento.test.js — Mantenimiento a Finanzas solo, "para
// revisar" (auditoría del 12/11, parte 9; sin migración).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";
import { CARGADA_POR, anularMantenimientoEnFinanzas, esDeMantenimiento, gastoParaRevisar, pasarMantenimientoAFinanzas } from "../app/lib/finanzasMantenimiento.js";
import { costosMantenimiento } from "../app/lib/finanzasIntegracion.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const E = "33333333-3333-3333-3333-333333333333";
const TIPOS = [
  { codigo: "GASTOS DE LOGÍSTICA", cuenta_debe: "05.02.01", cuenta_haber: "02.01.01", activo: true },
  { codigo: "GASTOS DE MANTENIMIENTO", cuenta_debe: "05.02.02", cuenta_haber: "01.01.01.001", activo: true },
];
const CUENTAS = [
  { codigo: "02.01.01", nombre: "Proveedores", activa: true },
  { codigo: "02.01.05", nombre: "Acreedores Varios", activa: true },
  { codigo: "05.02.01", nombre: "Fletes", activa: true },
  { codigo: "05.02.02", nombre: "Mantenimiento", activa: true },
];
const PROVS = [{ id: 9, nombre: "TALLER SUR", activo: true }];
const MANT = { id: 12, vehiculo_id: 7, tipo: "service", fecha: "2026-11-10", donde: "taller", taller: "TALLER SUR", proveedor_id: 9, detalle: "Aceite y filtros", costo: 85000 };
const VEH = [{ id: 7, marca: "Ford", modelo: "Transit", patente: "ab123cd" }];
const FALLA = { id: 30, maquina_id: 2, estado: "resuelta", descripcion: "Correa cortada", detalle: "Cambio de correa", costo: 42000.5, cerrado_at: "2026-11-11T15:00:00Z" };
const MAQ = [{ id: 2, codigo: "SEC-01", nombre: "Seccionadora" }];

test("gasto para revisar — service con proveedor de la lista va a Proveedores", () => {
  const item = costosMantenimiento({ mantenimientos: [MANT], vehiculos: VEH }).pendientes[0];
  const { op } = gastoParaRevisar(item, { tipos: TIPOS, cuentas: CUENTAS, proveedores: PROVS, proveedorId: 9 });
  assert.equal(op.estado, "para_revisar");
  assert.equal(op.origen, "gasto");
  assert.equal(op.origen_id, "ga0000000000c", "la misma clave que el Cargar de un toque");
  assert.equal(op.tipo, "GASTOS DE LOGÍSTICA");
  assert.equal(op.cuenta_debe, "05.02.01");
  assert.equal(op.cuenta_haber, "02.01.01");
  assert.equal(op.proveedor_id, 9);
  assert.equal(op.entidad, null);
  assert.equal(op.total, 85000);
  assert.equal(op.fecha, "2026-11-10");
  assert.match(op.descripcion, /^Service · Ford Transit AB123CD · Aceite y filtros$/);
});

test("gasto para revisar — falla sin proveedor: la deuda va a Acreedores Varios; sin tipo no se crea", () => {
  const item = costosMantenimiento({ fallas: [FALLA], maquinas: MAQ }).pendientes[0];
  const { op } = gastoParaRevisar(item, { tipos: TIPOS, cuentas: CUENTAS, proveedores: PROVS });
  assert.equal(op.tipo, "GASTOS DE MANTENIMIENTO");
  assert.equal(op.cuenta_haber, "02.01.05", "el haber del tipo es una caja: no sirve para la deuda");
  assert.equal(op.proveedor_id, null);
  assert.equal(op.origen_id, "gb0000000001e");
  assert.equal(op.total, 42000.5);
  assert.equal(gastoParaRevisar(item, { tipos: [], cuentas: CUENTAS }).op, null);
  assert.equal(gastoParaRevisar(item, { tipos: TIPOS, cuentas: [] }).op, null, "sin cuenta de deuda no se inventa");
  assert.equal(gastoParaRevisar(null).op, null);
});

test("esDeMantenimiento — solo el devengado que creó Gypi", () => {
  assert.equal(esDeMantenimiento({ origen: "gasto", origen_id: "ga0000000000c", cargada_por_nombre: CARGADA_POR }), true);
  assert.equal(esDeMantenimiento({ origen: "gasto", origen_id: "ga0000000000c-p", cargada_por_nombre: CARGADA_POR }), false);
  assert.equal(esDeMantenimiento({ origen: "gasto", origen_id: "ga0000000000c", cargada_por_nombre: "Tadeo" }), false);
});

function mockBase({ modulos = [{ modulo: "finanzas", activo: true }], ya = [], quitados = [], escrito = [] } = {}) {
  return createFetchMock([
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: modulos }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o.method === "POST" || o.method === "PATCH") { escrito.push({ url: u, method: o.method, body: JSON.parse(o.body) }); return { status: 201, body: [{ id: 1 }] }; }
        return { status: 200, body: ya };
      },
    },
    { match: (u) => u.includes("/rest/v1/vehiculo_mantenimientos"), respond: () => ({ status: 200, body: [MANT] }) },
    { match: (u) => u.includes("/rest/v1/vehiculos"), respond: () => ({ status: 200, body: VEH }) },
    { match: (u) => u.includes("/rest/v1/maquina_fallas"), respond: () => ({ status: 200, body: [FALLA] }) },
    { match: (u) => u.includes("/rest/v1/maquinas"), respond: () => ({ status: 200, body: MAQ }) },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => ({ status: 200, body: TIPOS }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: PROVS }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: quitados }) },
  ]);
}

test("pasar a Finanzas — crea el gasto para revisar una sola vez", async () => {
  const escrito = [];
  global.fetch = mockBase({ escrito });
  assert.deepEqual(await pasarMantenimientoAFinanzas(E, { modulo: "vehiculo", id: 12 }), { accion: "creada" });
  assert.equal(escrito.length, 1);
  assert.equal(escrito[0].body.estado, "para_revisar");
  assert.equal(escrito[0].body.cargada_por_nombre, CARGADA_POR);
  assert.equal(escrito[0].body.empresa_id, E);

  const escrito2 = [];
  global.fetch = mockBase({ escrito: escrito2, ya: [{ id: 5 }] });
  assert.equal((await pasarMantenimientoAFinanzas(E, { modulo: "vehiculo", id: 12 })).accion, "nada", "ya estaba");
  assert.equal(escrito2.length, 0);
});

test("pasar a Finanzas — no lo repite si el Dueño dijo Ya está cargado; sin Finanzas no hace nada", async () => {
  const escrito = [];
  global.fetch = mockBase({ escrito, quitados: [{ valor: { "m:30": { at: "2026-11-01", por: "Tadeo" } } }] });
  assert.equal((await pasarMantenimientoAFinanzas(E, { modulo: "maquina", id: 30 })).motivo, "quitado");
  global.fetch = mockBase({ escrito, modulos: [{ modulo: "finanzas", activo: false }] });
  // Otra empresa: los módulos se guardan un rato por empresa
  assert.equal((await pasarMantenimientoAFinanzas("44444444-4444-4444-4444-444444444444", { modulo: "maquina", id: 30 })).accion, "omitida");
  global.fetch = mockBase({ escrito });
  assert.equal((await pasarMantenimientoAFinanzas(E, { modulo: "maquina", id: 30 })).accion, "creada");
  assert.equal(escrito.length, 1);
  assert.equal(escrito[0].body.tipo, "GASTOS DE MANTENIMIENTO");
});

test("borrar en Flota — anula el que creó Gypi; el cargado a mano o ya pagado queda", async () => {
  const gypi = { id: 40, origen: "gasto", origen_id: "ga0000000000c", cargada_por_nombre: CARGADA_POR };
  let escrito = [];
  global.fetch = mockBase({ escrito, ya: [gypi] });
  assert.equal((await anularMantenimientoEnFinanzas(E, { modulo: "vehiculo", id: 12 })).accion, "anulada");
  assert.equal(escrito[0].method, "PATCH");
  assert.ok(escrito[0].url.includes("id=eq.40"));
  escrito = [];
  global.fetch = mockBase({ escrito, ya: [gypi, { id: 41, origen: "gasto", origen_id: "ga0000000000c-p", cargada_por_nombre: "Tadeo" }] });
  assert.equal((await anularMantenimientoEnFinanzas(E, { modulo: "vehiculo", id: 12 })).accion, "nada", "ya se pagó");
  global.fetch = mockBase({ escrito, ya: [{ ...gypi, cargada_por_nombre: "Tadeo" }] });
  assert.equal((await anularMantenimientoEnFinanzas(E, { modulo: "vehiculo", id: 12 })).accion, "nada", "lo cargó una persona");
  assert.equal(escrito.length, 0);
});
