// tests/finanzas-mi-caja.test.jsx — Finanzas, parte F3b (migración 176):
// cada responsable carga en su caja lo que gastó y lo que recibió; entra
// "para revisar" y el dueño lo confirma, le cambia el tipo o lo anula.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  leerConfigMiCaja, conceptosMiCaja, comprobanteValido, validarMovimientoMiCaja, cambioDeTipoMiCaja, resumenMiCaja, paraRevisarMiCaja, ORIGEN_MI_CAJA,
} from "../app/lib/finanzasMiCaja.js";
import { TIPOS_NUEVOS } from "../app/lib/finanzasTipos.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { invalidarCacheAccesos } = await import("../app/lib/accesosServidor.js");
const api = await import("../app/api/mi-caja/route.js");
const tesoreriaApi = await import("../app/api/finanzas/tesoreria/route.js");
const { default: MiCaja, detalleMovimiento, detalleMiCaja } = await import("../app/components/MiCaja.jsx");
const { default: FinanzasTesoreria } = await import("../app/components/FinanzasTesoreria.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const JUAN = "22222222-2222-2222-2222-222222222222";
const OTRO = "33333333-3333-3333-3333-333333333333";
const CAJA_JUAN = { cuenta: "01.01.01.001.001.02", nombre: "Caja Juan", tipo: "caja", moneda: "ARS", activa: true, responsable_id: JUAN };
const CAJA = { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true, responsable_id: null };
const TIPOS = [
  { codigo: "GASTO COMBUSTIBLE", nombre: "Combustible", cuenta_debe: "05.02.01", cuenta_haber: null, activo: true },
  { codigo: "GASTO VIATICOS", nombre: "Viáticos", cuenta_debe: "05.02.02", cuenta_haber: "01.01.01.001.001.01", activo: true },
  { codigo: "COBRO CLIENTE", nombre: "Cobro a un cliente", cuenta_debe: null, cuenta_haber: "01.01.02.001.001", activo: true },
  { codigo: "VIEJO", nombre: "Viejo", cuenta_debe: "05.09", cuenta_haber: null, activo: false },
];
const CONFIG = { gastos: ["GASTO COMBUSTIBLE", "GASTO VIATICOS", "VIEJO", "NO EXISTE"], ingresos: ["COBRO CLIENTE"] };
const FOTO = `https://test.supabase.co/storage/v1/object/public/reportes-obra/${E}/0b9e3c1a-1111-4222-8333-444455556666.jpg`;
const CTX = { caja: CAJA_JUAN, conceptos: conceptosMiCaja(CONFIG, TIPOS), supabaseUrl: "https://test.supabase.co", empresaId: E, hoy: "2026-11-09" };

// ─── Reglas ───

test("conceptos — todos los tipos de gasto e ingreso activos, con la cuenta del lado que corresponde, menos los escondidos", () => {
  assert.deepEqual(leerConfigMiCaja({ ocultos: { gastos: ["A", "A", " ", 3] } }), { ocultos: { gastos: ["A", "3"], ingresos: [] } });
  assert.deepEqual(leerConfigMiCaja({ gastos: ["A"] }), { ocultos: { gastos: [], ingresos: [] } }, "la lista vieja de elegidos ya no recorta");
  const c = conceptosMiCaja(CONFIG, TIPOS);
  assert.deepEqual(c.gastos.map((x) => [x.nombre, x.cuenta]), [["Combustible", "05.02.01"], ["Viáticos", "05.02.02"]]);
  assert.deepEqual(c.ingresos.map((x) => [x.nombre, x.cuenta]), [["Cobro a un cliente", "01.01.02.001.001"]]);
  const sinViaticos = conceptosMiCaja({ ocultos: { gastos: ["GASTO VIATICOS"] } }, TIPOS);
  assert.deepEqual(sinViaticos.gastos.map((x) => x.codigo), ["GASTO COMBUSTIBLE"]);
});

test("conceptos — con los tipos nuevos aparecen todos los gastos e ingresos, no solo desarrollismo", () => {
  const tipos = TIPOS_NUEVOS.map((t) => ({ codigo: t.codigo, nombre: t.nombre, grupo: t.grupo, cuenta_debe: "05.01", cuenta_haber: "04.01", activo: true }));
  // la config vieja que quedó de antes de pasar a los tipos nuevos
  const c = conceptosMiCaja({ gastos: ["INVERSIONES DESARROLLISMO"], ingresos: ["APORTES DESARROLLISMO"] }, tipos);
  const g = c.gastos.map((x) => x.codigo);
  const i = c.ingresos.map((x) => x.codigo);
  for (const k of ["COMPRAS", "SERVICIOS", "GASTOS DE LOGÍSTICA", "GASTOS DE MANTENIMIENTO", "VIÁTICOS", "IMPUESTOS", "SUELDOS", "OTROS GASTOS", "MAQUINARIA Y HERRAMIENTAS", "INVERSIONES DESARROLLISMO", "AJUSTE DE CAJA NEGATIVO"]) assert.ok(g.includes(k), `falta el gasto ${k}`);
  for (const k of ["COBRO A CLIENTES", "ANTICIPO DE CLIENTES", "OTROS INGRESOS", "APORTE DE SOCIOS", "APORTES DESARROLLISMO", "AJUSTE DE CAJA POSITIVO"]) assert.ok(i.includes(k), `falta el ingreso ${k}`);
  for (const k of ["TRANSFERENCIA ENTRE CAJAS", "PLAZO FIJO", "DÓLARES", "VENTA", "AMORTIZACIONES", "APERTURA", "RECLASIF"]) {
    assert.ok(!g.includes(k) && !i.includes(k), `${k} no se carga desde una caja chica`);
  }
  assert.ok(!i.includes("COMPRAS") && !g.includes("COBRO A CLIENTES"), "cada uno de su lado");
  assert.equal(g[0], "PAGO A PROVEEDORES", "en el orden de la lista");
  assert.equal(c.gastos.find((x) => x.codigo === "COMPRAS").grupo, "Compras");
  assert.ok(c.gastos.find((x) => x.codigo === "COMPRAS").leyenda, "con su leyenda");
});

test("foto del ticket — solo una subida por /api/upload para la misma empresa", () => {
  const ctx = { supabaseUrl: "https://test.supabase.co", empresaId: E };
  assert.equal(comprobanteValido(null, ctx), true);
  assert.equal(comprobanteValido(FOTO, ctx), true);
  assert.equal(comprobanteValido(FOTO.replace(E, "99999999-9999-9999-9999-999999999999"), ctx), false);
  assert.equal(comprobanteValido("https://malo.com/x.jpg", ctx), false);
  assert.equal(comprobanteValido(`${FOTO}/../../otra.jpg`, ctx), false);
});

test("gasto — el tipo al debe y la caja al haber, para revisar; recibido al revés; el dueño entra confirmado", () => {
  const { op, errores } = validarMovimientoMiCaja({ clase: "gasto", concepto: "GASTO COMBUSTIBLE", importe: "15000.5", fecha: "2026-11-08", descripcion: "camioneta", comprobante_url: FOTO }, CTX);
  assert.deepEqual(errores, []);
  assert.deepEqual([op.tipo, op.cuenta_debe, op.cuenta_haber, op.total, op.total_ars, op.estado, op.origen, op.comprobante_url, op.descripcion],
    ["GASTO COMBUSTIBLE", "05.02.01", CAJA_JUAN.cuenta, 15000.5, 15000.5, "para_revisar", ORIGEN_MI_CAJA, FOTO, "Combustible · Caja Juan · camioneta"]);
  const r = validarMovimientoMiCaja({ clase: "ingreso", concepto: "COBRO CLIENTE", importe: 1000, fecha: "2026-11-09" }, { ...CTX, confirmada: true });
  assert.deepEqual([r.op.cuenta_debe, r.op.cuenta_haber, r.op.estado, r.op.comprobante_url], [CAJA_JUAN.cuenta, "01.01.02.001.001", "confirmada", null]);
});

test("gasto — lo que no corresponde se rechaza", () => {
  const err = (f, ctx = CTX) => validarMovimientoMiCaja({ clase: "gasto", concepto: "GASTO COMBUSTIBLE", importe: 10, fecha: "2026-11-09", ...f }, ctx).errores.join(" | ");
  assert.match(err({ concepto: "COBRO CLIENTE" }), /en qué gastaste/i);
  assert.match(err({ concepto: "VIEJO" }), /en qué gastaste/i);
  assert.match(err({ importe: -5 }), /mayor a cero/);
  assert.match(err({ fecha: "2026-11-10" }), /más adelante que hoy/);
  assert.match(err({ comprobante_url: "https://otro.com/a.jpg" }), /foto del ticket/);
  assert.match(err({}, { ...CTX, caja: { ...CAJA_JUAN, moneda: "USD" } }), /tipo de cambio/);
  assert.match(err({ clase: "otra" }), /gasto o plata/);
});

test("cambiar el tipo — la caja queda donde estaba", () => {
  const cajas = [CAJA_JUAN.cuenta, CAJA.cuenta];
  assert.deepEqual(cambioDeTipoMiCaja({ cuenta_debe: "05.02.01", cuenta_haber: CAJA_JUAN.cuenta }, TIPOS[1], cajas), { tipo: "GASTO VIATICOS", cuenta_debe: "05.02.02" });
  assert.deepEqual(cambioDeTipoMiCaja({ cuenta_debe: CAJA_JUAN.cuenta, cuenta_haber: "x" }, TIPOS[2], cajas), { tipo: "COBRO CLIENTE", cuenta_haber: "01.01.02.001.001" });
  assert.equal(cambioDeTipoMiCaja({ cuenta_debe: CAJA_JUAN.cuenta, cuenta_haber: "x" }, TIPOS[0], cajas), null, "sin cuenta al haber no sirve");
});

const OPS = [
  { id: 1, fecha: "2026-11-01", tipo: "TRANSF INTERNA", total: 50000, total_ars: 50000, cuenta_debe: CAJA_JUAN.cuenta, cuenta_haber: CAJA.cuenta, origen: "manual", estado: "confirmada" },
  { id: 2, fecha: "2026-11-05", tipo: "GASTO COMBUSTIBLE", total: 15000, total_ars: 15000, cuenta_debe: "05.02.01", cuenta_haber: CAJA_JUAN.cuenta, origen: "mi_caja", estado: "para_revisar", comprobante_url: FOTO, descripcion: "Combustible · Caja Juan", cargada_por_nombre: "Juan" },
  { id: 3, fecha: "2026-11-03", tipo: "GASTO VIATICOS", total: 5000, total_ars: 5000, cuenta_debe: "05.02.02", cuenta_haber: CAJA_JUAN.cuenta, origen: "mi_caja", estado: "confirmada" },
];

test("resumen — saldo, sin revisar y lo último primero", () => {
  const r = resumenMiCaja(OPS, CAJA_JUAN, new Map([["GASTO COMBUSTIBLE", "Combustible"]]));
  assert.deepEqual([r.saldo, r.para_revisar], [30000, 1]);
  assert.deepEqual(r.movimientos.map((m) => [m.id, m.concepto, m.entra, m.sale, m.propia]), [[2, "Combustible", 0, 15000, true], [3, "GASTO VIATICOS", 0, 5000, true], [1, "TRANSF INTERNA", 50000, 0, false]]);
  assert.deepEqual(paraRevisarMiCaja([...OPS, { ...OPS[1], id: 9, anulada_at: "x" }]).map((o) => o.id), [2]);
});

test("migración 176 — la foto del ticket en fin_operaciones, en un solo bloque", () => {
  const sql = readFileSync(new URL("../supabase/migrations/176_finanzas_mi_caja.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /add column if not exists comprobante_url text/);
  assert.match(sql, /comprobante_url like 'https:\/\/%'/);
});

// ─── Servidor ───

async function token(empleadoId, rol = "operativo") {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (ruta, empleadoId, rol, metodo, body) => ruta[metodo](new Request("http://localhost/api/x", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(empleadoId, rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ modulos = [], ops = OPS, repetidas = [], parecidas = [], proveedores = [], accesos = null, cuentas = [], clientes = [], proyectos = [] } = {}) {
  const escrito = [];
  const leido = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    ...(accesos ? [{ match: (u) => u.includes("/rest/v1/accesos_personas"), respond: () => ({ status: 200, body: accesos }) }] : []),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: modulos }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: (u) => { leido.push(u); return { status: 200, body: [{ id: JUAN, nombre: "Juan", legajo: 1 }] }; } },
    {
      match: (u) => u.includes("/rest/v1/fin_tesoreria"),
      respond: (u) => ({ status: 200, body: [CAJA, CAJA_JUAN].filter((c) => !u.includes("responsable_id=eq.") || u.includes(`responsable_id=eq.${c.responsable_id}`)) }),
    },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: (u) => ({ status: 200, body: TIPOS.filter((t) => !u.includes("codigo=eq.") || u.includes(`codigo=eq.${encodeURIComponent(t.codigo)}`)) }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push({ tabla: "config_sistema", metodo: o.method, body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        return { status: 200, body: u.includes("select=clave") ? [] : [{ valor: CONFIG }] };
      },
    },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: (u) => { leido.push(u); return { status: 200, body: proveedores }; } },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: cuentas }) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: (u) => { leido.push(u); return { status: 200, body: clientes }; } },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: (u) => { leido.push(u); return { status: 200, body: proyectos }; } },
    { match: (u, o) => u.includes("/rest/v1/fin_operaciones") && u.includes("referencia=ilike.") && !o?.method, respond: (u) => { leido.push(u); return { status: 200, body: repetidas }; } },
    { match: (u, o) => u.includes("/rest/v1/fin_operaciones") && u.includes("&total=eq.") && !o?.method, respond: (u) => { leido.push(u); return { status: 200, body: parecidas }; } },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "fin_operaciones", url: u, metodo: o.method, body });
          if (o.method === "PATCH") return { status: 200, body: u.includes("id=eq.404") ? [] : [{ id: 2, ...body }] };
          return { status: 201, body: [{ id: 77, ...body }] };
        }
        leido.push(u);
        return { status: 200, body: /[?&]id=eq\./.test(u) ? ops.filter((x) => u.includes(`id=eq.${x.id}&`)) : ops };
      },
    },
  ]);
  return { escrito, leido };
}

test("/api/mi-caja — sin caja a cargo no hay nada (ni error)", async () => {
  mockApi();
  let r = await pedir(api, OTRO, "operativo", "GET");
  assert.deepEqual([r.status, (await r.json()).cajas], [200, []]);
  r = await pedir(api, OTRO, "operativo", "POST", { accion: "cargar", cuenta: CAJA_JUAN.cuenta });
  assert.equal(r.status, 403);
});

test("/api/mi-caja — el responsable ve solo su caja con el saldo y los conceptos", async () => {
  const { leido } = mockApi();
  const r = await pedir(api, JUAN, "operativo", "GET");
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(d.cajas.map((c) => [c.nombre, c.saldo, c.para_revisar]), [["Caja Juan", 30000, 1]]);
  assert.deepEqual(d.conceptos.gastos.map((c) => c.nombre), ["Combustible", "Viáticos"]);
  const opsUrl = decodeURIComponent(leido.find((u) => u.includes("fin_operaciones")));
  assert.match(opsUrl, /cuenta_debe\.in\.\("01\.01\.01\.001\.001\.02"\)/);
  assert.doesNotMatch(opsUrl, /001\.001\.01"/, "no mira la Caja Principal");
});

test("/api/mi-caja — el titular carga en cualquier caja o banco, confirmado; los pases siguen siendo solo de las suyas (11/11)", async () => {
  const DUENO = "44444444-4444-4444-4444-444444444444";
  invalidarCacheAccesos(E);
  const { escrito, leido } = mockApi({ accesos: [{ empleado_id: DUENO, es_titular: true, puede_configurar: true, modulos_ocultos: [] }] });
  let r = await pedir(api, DUENO, "gerencial", "GET");
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.titular, true);
  assert.deepEqual(d.cajas.map((c) => [c.nombre, c.propia, c.destinos.length]), [["Caja Principal", false, 0], ["Caja Juan", false, 0]]);
  assert.ok(leido.some((u) => u.includes("fin_operaciones")), "lee el saldo de todas");
  r = await pedir(api, DUENO, "gerencial", "POST", { accion: "cargar", cuenta: CAJA_JUAN.cuenta, clase: "gasto", concepto: "GASTO COMBUSTIBLE", importe: 8000, fecha: "2026-11-01" });
  assert.equal(r.status, 200);
  const op = escrito.find((x) => x.tabla === "fin_operaciones").body;
  assert.deepEqual([op.cuenta_haber, op.estado], [CAJA_JUAN.cuenta, "confirmada"]);
  // Pasarle plata a alguien desde una caja que no tiene a cargo: no
  r = await pedir(api, DUENO, "gerencial", "POST", { accion: "pasar", cuenta: CAJA_JUAN.cuenta, hacia: CAJA.cuenta, importe: 100, fecha: "2026-11-01" });
  assert.equal(r.status, 403);
  invalidarCacheAccesos(E);
});

test("/api/mi-caja — cargar un gasto: entra para revisar, con quién lo cargó, y avisa a los dueños", async () => {
  const { escrito, leido } = mockApi();
  const r = await pedir(api, JUAN, "operativo", "POST", { accion: "cargar", cuenta: CAJA_JUAN.cuenta, clase: "gasto", concepto: "GASTO COMBUSTIBLE", importe: 8000, fecha: "2026-11-01", comprobante_url: FOTO });
  assert.equal(r.status, 200);
  const [op] = escrito;
  assert.deepEqual([op.metodo, op.body.estado, op.body.cuenta_haber, op.body.empresa_id, op.body.cargada_por_nombre, op.body.comprobante_url], ["POST", "para_revisar", CAJA_JUAN.cuenta, E, "Juan", FOTO]);
  assert.ok(leido.some((u) => u.includes("rol=eq.gerencial")), "busca a los dueños para avisarles");
  const ajena = await pedir(api, JUAN, "operativo", "POST", { accion: "cargar", cuenta: CAJA.cuenta, clase: "gasto", concepto: "GASTO COMBUSTIBLE", importe: 8000, fecha: "2026-11-01" });
  assert.equal(ajena.status, 403);
});

test("/api/mi-caja — el ticket con factura: proveedor de la lista, número e IVA quedan en la operación", async () => {
  const { escrito } = mockApi({ proveedores: [{ id: 7, nombre: "Ferretería Centro SRL", cuit: "30711222339", activo: true }] });
  const r = await pedir(api, JUAN, "operativo", "POST", {
    accion: "cargar", cuenta: CAJA_JUAN.cuenta, clase: "gasto", concepto: "GASTO COMBUSTIBLE", importe: 12100, fecha: "2026-11-01",
    comercio: "FERRETERIA CENTRO", cuit: "30-71122233-9", letra: "A", punto_venta: "4", numero: "1234", neto: 10000, iva: 2100, descripcion: "Tornillos",
  });
  assert.equal(r.status, 200);
  const op = escrito[0].body;
  assert.deepEqual([op.proveedor_id, op.entidad, op.referencia, op.neto, op.iva, op.total], [7, null, "A 00004-00001234", 10000, 2100, 12100]);
  assert.match(op.descripcion, /Combustible · Caja Juan · Ferretería Centro SRL · Factura A 00004-00001234 · Tornillos/);
});

test("mi caja — en impuestos o sueldos el IVA no se separa: todo va al importe (11/11)", () => {
  const conceptos = { gastos: [{ codigo: "IMPUESTOS", nombre: "Impuestos", cuenta: "05.03.01", grupo: "Impuestos" }], ingresos: [] };
  const { op, errores } = validarMovimientoMiCaja({ clase: "gasto", concepto: "IMPUESTOS", importe: 12100, fecha: "2026-11-08", letra: "A", neto: 10000, iva: 2100 }, { ...CTX, conceptos });
  assert.deepEqual(errores, []);
  assert.deepEqual([op.neto, op.iva, op.otros_impuestos, op.total], [12100, 0, 0, 12100]);
});

test("/api/mi-caja — el mismo comprobante no entra dos veces, venga de donde venga", async () => {
  // ya cargado como gasto por el dueño, escrito con otro formato
  const { escrito } = mockApi({
    proveedores: [{ id: 7, nombre: "Ferretería Centro SRL", cuit: "30711222339", activo: true }],
    repetidas: [{ id: 50, fecha: "2026-10-30", origen: "gasto", referencia: "A 00004-00001234", proveedor_id: 7, entidad: null }],
  });
  const r = await pedir(api, JUAN, "operativo", "POST", {
    accion: "cargar", cuenta: CAJA_JUAN.cuenta, clase: "gasto", concepto: "GASTO COMBUSTIBLE", importe: 12100, fecha: "2026-11-01",
    comercio: "Ferretería Centro", letra: "A", punto_venta: "0004", numero: "00001234",
  });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Este ticket ya está cargado \(del 30\/10\/2026, como gasto\)/);
  assert.equal(escrito.length, 0);
});

test("/api/mi-caja — sin número: si hay otro igual en la caja pregunta, y con «es otro» lo guarda", async () => {
  const igual = { id: 51, fecha: "2026-10-31", total: 8000, cuenta_debe: "05.02.01", cuenta_haber: CAJA_JUAN.cuenta, descripcion: "Combustible · Caja Juan · nafta" };
  const { escrito, leido } = mockApi({ parecidas: [igual] });
  const carga = { accion: "cargar", cuenta: CAJA_JUAN.cuenta, clase: "gasto", concepto: "GASTO COMBUSTIBLE", importe: 8000, fecha: "2026-11-01" };
  const r = await pedir(api, JUAN, "operativo", "POST", carga);
  assert.equal(r.status, 409);
  const d = await r.json();
  assert.equal(d.parecido, true);
  assert.match(d.error, /Ya hay uno igual en esta caja: .*8\.000.* del 31\/10\/2026 \(Combustible · Caja Juan · nafta\)\. ¿Es otro\?/);
  assert.match(decodeURIComponent(leido.find((u) => u.includes("&total=eq."))), /cuenta_haber=eq\.01\.01\.01\.001\.001\.02&total=eq\.8000&fecha=gte\.2026-10-28&fecha=lte\.2026-11-05/);
  assert.equal(escrito.length, 0);
  const ok = await pedir(api, JUAN, "operativo", "POST", { ...carga, igual_confirmado: true });
  assert.equal(ok.status, 200);
  assert.equal(escrito.length, 1);
});

test("/api/mi-caja — anular solo lo propio que el dueño no revisó", async () => {
  const { escrito } = mockApi();
  const r = await pedir(api, JUAN, "operativo", "POST", { accion: "anular", id: 2 });
  assert.equal(r.status, 200);
  const url = decodeURIComponent(escrito[0].url);
  assert.match(url, /origen=eq\.mi_caja&estado=eq\.para_revisar&anulada_at=is\.null/);
  assert.match(url, /cuenta_haber\.in\.\("01\.01\.01\.001\.001\.02"\)/);
  assert.equal((await pedir(api, JUAN, "operativo", "POST", { accion: "anular", id: 404 })).status, 404);
});

test("/api/finanzas/tesoreria — el dueño confirma cambiando el tipo; solo el dueño elige los conceptos", async () => {
  const { escrito } = mockApi();
  assert.equal((await pedir(tesoreriaApi, JUAN, "administrativo", "POST", { accion: "revisar", id: 2 })).status, 403);
  const r = await pedir(tesoreriaApi, JUAN, "gerencial", "POST", { accion: "revisar", id: 2, tipo: "GASTO VIATICOS" });
  assert.equal(r.status, 200);
  assert.deepEqual([escrito[0].body.estado, escrito[0].body.tipo, escrito[0].body.cuenta_debe, escrito[0].body.cuenta_haber], ["confirmada", "GASTO VIATICOS", "05.02.02", undefined]);
  const c = await pedir(tesoreriaApi, JUAN, "gerencial", "POST", { accion: "config_mi_caja", ocultos: { gastos: ["GASTO COMBUSTIBLE", "COBRO CLIENTE"], ingresos: ["COBRO CLIENTE", "GASTO COMBUSTIBLE"] } });
  assert.equal(c.status, 200);
  assert.deepEqual(escrito[1].body.valor, { ocultos: { gastos: ["GASTO COMBUSTIBLE"], ingresos: ["COBRO CLIENTE"] } }, "se esconde cada tipo solo del lado donde se ofrece");
});

// Al final: el plan de la empresa queda guardado 5 minutos en memoria
test("/api/mi-caja — con Finanzas apagado no hay nada", async () => {
  mockApi({ modulos: [{ modulo: "finanzas", activo: false }] });
  const otraEmpresa = "44444444-4444-4444-4444-444444444444";
  const t = (await signAccessToken({ empleadoId: JUAN, empresaId: otraEmpresa, legajo: 7, rol: "operativo" })).token;
  const r = await api.GET(new Request("http://localhost/api/mi-caja", { headers: { Authorization: `Bearer ${t}` } }));
  assert.deepEqual([r.status, (await r.json()).cajas], [200, []]);
});

// ─── Pantallas ───

test("Mi caja — saldo, cargar un gasto y anular lo que no revisó el dueño", async () => {
  const datos = {
    cajas: [resumenMiCaja(OPS, CAJA_JUAN, new Map([["GASTO COMBUSTIBLE", "Combustible"]]))],
    conceptos: conceptosMiCaja(CONFIG, TIPOS), hoy: "2026-11-09", cargar: () => {},
  };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    enviados.push(JSON.parse(o.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  let cambios = 0;
  render(<MiCaja datos={datos} onClose={() => {}} onCambio={() => { cambios++; }} />);
  assert.ok(screen.getByText("$ 30.000,00"));
  assert.ok(screen.getByText("Falta que el dueño lo revise"));
  fireEvent.click(screen.getByText("➖ Gasté"));
  fireEvent.click(screen.getByRole("button", { name: "Viáticos" }));
  fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "2.500" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].cuenta, enviados[0].clase, enviados[0].concepto, enviados[0].importe, enviados[0].fecha], ["cargar", CAJA_JUAN.cuenta, "gasto", "GASTO VIATICOS", 2500, "2026-11-09"]);
  await waitFor(() => assert.ok(screen.getByText(/Gasto cargado/)));
  fireEvent.click(screen.getByRole("button", { name: "Anular" }));
  await waitFor(() => assert.equal(enviados.length, 2));
  assert.deepEqual(enviados[1], { accion: "anular", id: 2 });
  assert.equal(cambios, 2);
});

test("Mi caja — el titular elige cualquier caja o banco y lo que carga queda confirmado (11/11)", async () => {
  const nombres = new Map();
  const datos = {
    titular: true,
    cajas: [
      { ...resumenMiCaja(OPS, CAJA_JUAN, nombres), propia: true, destinos: [] },
      { ...resumenMiCaja(OPS, CAJA, nombres), propia: false, destinos: [] },
    ],
    conceptos: conceptosMiCaja(CONFIG, TIPOS), hoy: "2026-11-09", cargar: () => {},
  };
  assert.match(detalleMiCaja(datos.cajas), /^Caja Juan: \$ 30\.000,00 · cargás en 1 caja o banco más/);
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    enviados.push(JSON.parse(o.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  render(<MiCaja datos={datos} onClose={() => {}} onCambio={() => {}} />);
  assert.ok(screen.getByText(/Como titular cargás en cualquier caja o banco/));
  const caja = screen.getByLabelText("Caja");
  fireEvent.focus(caja);
  assert.deepEqual(screen.getAllByRole("option").map((o) => o.textContent), ["Caja Juan", "Caja Principal"]);
  fireEvent.change(caja, { target: { value: CAJA.cuenta } });
  fireEvent.click(screen.getByText("➖ Gasté"));
  fireEvent.click(screen.getByRole("button", { name: "Viáticos" }));
  fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].cuenta, CAJA.cuenta);
  await waitFor(() => assert.ok(screen.getByText(/en Caja Principal: ya está confirmado/)));
});

test("Mi caja — el detalle de cada movimiento sin repetir concepto ni caja", () => {
  assert.equal(detalleMovimiento({ concepto: "Combustible", descripcion: "Combustible · Caja Juan · nafta camioneta" }, "Caja Juan"), "nafta camioneta");
  assert.equal(detalleMovimiento({ concepto: "Transferencia entre cajas y bancos", descripcion: "De Caja Principal a Caja Juan · para obra" }, "Caja Juan"), "De Caja Principal a Caja Juan · para obra");
  assert.equal(detalleMovimiento({ concepto: "Combustible", descripcion: "Combustible · Caja Juan" }, "Caja Juan"), "");
  assert.equal(detalleMovimiento({ concepto: "X" }, "Caja Juan"), "");
});

test("Cajas y bancos — aviso de Mi caja para revisar y confirmar", async () => {
  const datos = { tesoreria: [CAJA, CAJA_JUAN], cuentas: [], personal: [{ id: JUAN, nombre: "Juan" }], operaciones: OPS, tipos: TIPOS, mi_caja: CONFIG };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify(datos), { status: 200 });
  };
  render(<FinanzasTesoreria />);
  fireEvent.click(await screen.findByText(/1 movimiento de Mi caja para revisar/));
  assert.ok(screen.getByText("🧾 Ver ticket"));
  fireEvent.change(screen.getByLabelText("Tipo del movimiento 2"), { target: { value: "GASTO VIATICOS" } });
  fireEvent.click(screen.getByRole("button", { name: "✓ Confirmar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], { accion: "revisar", id: 2, tipo: "GASTO VIATICOS" });
});

test("Cajas y bancos — ⚙ Mi caja: todo tildado de entrada; destildar esconde", async () => {
  const datos = { tesoreria: [CAJA, CAJA_JUAN], cuentas: [], personal: [], operaciones: [], tipos: TIPOS, mi_caja: { ocultos: { gastos: ["GASTO VIATICOS"], ingresos: [] } } };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify(datos), { status: 200 });
  };
  render(<FinanzasTesoreria />);
  fireEvent.click(await screen.findByRole("button", { name: "⋯ Más" }));
  fireEvent.click(screen.getByRole("button", { name: "⚙ Mi caja" }));
  const combustible = screen.getByRole("checkbox", { name: "Combustible" });
  assert.equal(combustible.checked, true, "un tipo que nadie tocó se ofrece");
  assert.equal(screen.getByRole("checkbox", { name: "Viáticos" }).checked, false, "el escondido queda destildado");
  assert.equal(screen.getByRole("checkbox", { name: "Cobro a un cliente" }).checked, true);
  assert.ok(screen.getByText("Gastos (1 de 2)"));
  fireEvent.click(combustible);
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], { accion: "config_mi_caja", ocultos: { gastos: ["GASTO VIATICOS", "GASTO COMBUSTIBLE"], ingresos: [] } });
});

// ─── 13/11: el cobro a un cliente dice de qué cliente es ───

const CUENTAS_CLI = [{ codigo: "01.01.02.001.001", nombre: "Deudores por Ventas" }, { codigo: "05.02.01", nombre: "Combustibles" }];
const CLIENTES = [{ id: 5, nombre: "Bosques SA", activo: true }, { id: 6, nombre: "Riofrío SRL", activo: true }, { id: 9, nombre: "Viejo", activo: true, unido_a: 5 }];
const PROYECTOS = [{ id: 40, ot: "7858", cliente: "Bosques", obra: "CEVT", cliente_id: 5 }, { id: 41, ot: "7961", cliente: "Riofrío", obra: "Casa", cliente_id: null }];

test("cobro a un cliente — pide el cliente y la OT tiene que ser de ese cliente (13/11)", () => {
  const conceptos = conceptosMiCaja(CONFIG, TIPOS, CUENTAS_CLI);
  assert.deepEqual(conceptos.ingresos.map((c) => [c.codigo, !!c.pide_cliente]), [["COBRO CLIENTE", true]]);
  assert.ok(conceptos.gastos.every((c) => !c.pide_cliente), "un gasto no pide cliente");
  const ctx = { ...CTX, conceptos, clientes: CLIENTES, proyectos: PROYECTOS };
  const base = { clase: "ingreso", concepto: "COBRO CLIENTE", importe: 50000, fecha: "2026-11-09" };
  assert.deepEqual(validarMovimientoMiCaja(base, ctx).errores, ["Elegí de qué cliente es la plata"]);
  assert.deepEqual(validarMovimientoMiCaja({ ...base, cliente_id: 99 }, ctx).errores, ["Ese cliente no está en la lista"]);
  assert.match(validarMovimientoMiCaja({ ...base, cliente_id: 6, proyecto_id: 40 }, ctx).errores[0], /La OT 7858 es de Bosques SA/);
  const { op, errores } = validarMovimientoMiCaja({ ...base, cliente_id: 5, proyecto_id: 40 }, ctx);
  assert.deepEqual(errores, []);
  assert.deepEqual([op.cliente_id, op.entidad, op.proyecto_id, op.proveedor_id, op.cuenta_debe, op.cuenta_haber], [5, "Bosques SA", 40, null, CAJA_JUAN.cuenta, "01.01.02.001.001"]);
  assert.match(op.descripcion, /Cobro a un cliente · Caja Juan · Bosques SA · OT 7858/);
  // La OT que todavía no tiene cliente unido va con el nombre del Plan
  assert.deepEqual(validarMovimientoMiCaja({ ...base, cliente_id: 6, proyecto_id: 41 }, ctx).errores, []);
});

test("/api/mi-caja — el cobro a un cliente queda en su cuenta con la OT; la pantalla trae clientes y OT (13/11)", async () => {
  const { escrito } = mockApi({ cuentas: CUENTAS_CLI, clientes: CLIENTES, proyectos: PROYECTOS });
  let r = await pedir(api, JUAN, "operativo", "GET");
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(d.clientes, [{ id: 5, nombre: "Bosques SA" }, { id: 6, nombre: "Riofrío SRL" }], "sin el unido a otro");
  assert.deepEqual(d.proyectos.map((p) => [p.ot, p.cliente_id]), [["7858", 5], ["7961", 6]]);
  r = await pedir(api, JUAN, "operativo", "POST", { accion: "cargar", cuenta: CAJA_JUAN.cuenta, clase: "ingreso", concepto: "COBRO CLIENTE", importe: 50000, fecha: "2026-11-09" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /de qué cliente/);
  r = await pedir(api, JUAN, "operativo", "POST", { accion: "cargar", cuenta: CAJA_JUAN.cuenta, clase: "ingreso", concepto: "COBRO CLIENTE", importe: 50000, fecha: "2026-11-09", cliente_id: 5, proyecto_id: 40 });
  assert.equal(r.status, 200);
  const op = escrito.find((x) => x.tabla === "fin_operaciones").body;
  assert.deepEqual([op.cliente_id, op.entidad, op.proyecto_id], [5, "Bosques SA", 40]);
});

test("/api/mi-caja — sin cuenta de clientes en el plan, nada cambia (ni se leen los clientes)", async () => {
  const { leido } = mockApi();
  const d = await (await pedir(api, JUAN, "operativo", "GET")).json();
  assert.equal(d.clientes, undefined);
  assert.ok(!leido.some((u) => u.includes("fin_clientes")));
});

test("Mi caja — Recibí plata de un cliente: elegir el cliente y la OT", async () => {
  const datos = {
    cajas: [resumenMiCaja(OPS, CAJA_JUAN, new Map())],
    conceptos: conceptosMiCaja(CONFIG, TIPOS, CUENTAS_CLI), hoy: "2026-11-09", cargar: () => {},
    clientes: [{ id: 5, nombre: "Bosques SA" }, { id: 6, nombre: "Riofrío SRL" }],
    proyectos: [{ id: 40, ot: "7858", cliente: "Bosques", obra: "CEVT", cliente_id: 5 }],
  };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    enviados.push(JSON.parse(o.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  render(<MiCaja datos={datos} onClose={() => {}} onCambio={() => {}} />);
  fireEvent.click(screen.getByText("➕ Recibí plata"));
  assert.ok(screen.getByText("¿De qué cliente?"));
  fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "50.000" } });
  // Elegir la OT pone su cliente
  fireEvent.change(screen.getByLabelText("OT"), { target: { value: "40" } });
  assert.equal(screen.getByLabelText("Cliente").value, "Bosques SA");
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].clase, enviados[0].concepto, enviados[0].cliente_id, enviados[0].proyecto_id, enviados[0].importe], ["ingreso", "COBRO CLIENTE", 5, 40, 50000]);
});
