// tests/finanzas-inicio.test.jsx — Finanzas, parte 10 del plan del 11/11:
// el Inicio de Finanzas (la plata, lo que entró y salió en el mes, "Para
// hacer" y el resto en tarjetas por tema) y Mi caja muy fácil (conceptos en
// botones con los más usados primero, Hoy / Ayer y la foto del ticket que
// Gypi lee sola).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { GRUPOS_FINANZAS, DETALLE_FINANZAS, pendientesFinanzas } from "../app/lib/finanzasInicio.js";
import { BOTONES_GESTION, ICONO_GESTION } from "../app/lib/menuGestion.js";
const OPCIONES_GESTION = { finanzas: BOTONES_GESTION.finanzas.opciones };
import {
  ayerDe, conceptosMiCaja, conceptosPorUso, esquemaTicket, propuestaTicket, resumenMiCaja,
} from "../app/lib/finanzasMiCaja.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.ANTHROPIC_API_KEY = "test-ia";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const apiInicio = await import("../app/api/finanzas/inicio/route.js");
const apiMiCaja = await import("../app/api/mi-caja/route.js");
const { default: FinanzasInicio } = await import("../app/components/FinanzasInicio.jsx");
const { default: MiCaja } = await import("../app/components/MiCaja.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const HOY = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

const token = async (rol, empleadoId = EMP) => (await signAccessToken({ empleadoId, empresaId: E, legajo: 7, rol })).token;
const pedir = async (ruta, rol, metodo, body) => ruta[metodo](new Request("http://localhost/api/x", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

// ─── Inicio: reglas ───

test("Inicio — las pantallas por tema cubren todo el menú de Finanzas, cada una con su línea", () => {
  const ids = GRUPOS_FINANZAS.flatMap((g) => g.opciones);
  const menu = OPCIONES_GESTION.finanzas.map((o) => o.id).filter((id) => id !== "fin-inicio");
  assert.deepEqual([...ids].sort(), [...menu].sort(), "ninguna pantalla queda afuera ni repetida");
  assert.equal(OPCIONES_GESTION.finanzas[0].id, "fin-inicio", "Finanzas abre en el Inicio");
  for (const id of ids) {
    assert.ok(DETALLE_FINANZAS[id], `falta la línea de ${id}`);
    assert.ok(ICONO_GESTION[id], `falta el ícono de ${id}`);
  }
});

test("Inicio — Para hacer: de lo más urgente a lo menos, con cuántos y por cuánto", () => {
  const p = pendientesFinanzas({
    hoy: "2026-11-11",
    revisar: [{ id: 1, origen: "mi_caja" }, { id: 2, origen: "mi_caja" }, { id: 3, origen: "manual" }],
    ordenes: [{ id: 1, estado: "para_aprobar", total: 1000 }, { id: 2, estado: "aprobada", total: 500.555 }],
    cheques: [
      { id: 1, clase: "propio", estado: "pendiente", fecha_pago: "2026-11-09", importe: 100 },
      { id: 2, clase: "propio", estado: "pendiente", fecha_pago: "2026-11-16", importe: 200 },
      { id: 3, clase: "propio", estado: "pendiente", fecha_pago: "2026-12-30", importe: 999 },
      { id: 4, clase: "tercero", estado: "en_cartera", fecha_pago: "2026-11-11", importe: 50 },
      { id: 5, clase: "tercero", estado: "en_cartera", fecha_pago: "2026-11-20", importe: 70 },
    ],
    costos: 2, costosTotal: 150000, plazosVencidos: 1,
  });
  assert.deepEqual(p.map((x) => x.id), ["cheques_propios", "cheques_terceros", "op_pagar", "plazos", "mi_caja", "revisar", "costos"]);
  const propios = p[0];
  assert.deepEqual([propios.cantidad, propios.importe, propios.tono, propios.ir], [2, 300, "rojo", "fin-cheques"], "uno ya se debitó sin plata: rojo");
  assert.match(propios.texto, /2 e-cheq o cheques propios se debitan esta semana/);
  assert.deepEqual([p[1].cantidad, p[1].importe], [1, 50], "solo el que ya se puede depositar");
  assert.equal(p[1].texto, "1 cheque de terceros ya se puede depositar");
  assert.deepEqual([p[2].cantidad, p[2].importe, p[2].texto], [2, 1500.56, "2 órdenes de pago sin pagar"], "no esperan al CFO");
  assert.equal(p[4].texto, "2 movimientos de Mi caja para revisar");
  assert.equal(p[4].ir, "fin-tesoreria");
  assert.equal(p[5].texto, "1 operación para revisar");
  assert.equal(p[6].texto, "2 costos de Flota y Maquinaria para pasar a Finanzas");
  assert.deepEqual(pendientesFinanzas({ hoy: "2026-11-11" }), [], "todo al día");
});

test("Inicio — el e-cheq propio se debita el hábil siguiente al depósito (regla de días hábiles)", () => {
  // Vence el sábado 14/11/2026: se deposita el lunes 16 y se debita el martes 17
  const p = pendientesFinanzas({ hoy: "2026-11-09", cheques: [{ id: 1, clase: "propio", estado: "pendiente", fecha_pago: "2026-11-14", importe: 10 }] });
  assert.equal(p.length, 0, "el 17 queda a más de una semana del 9");
  const q = pendientesFinanzas({ hoy: "2026-11-10", cheques: [{ id: 1, clase: "propio", estado: "pendiente", fecha_pago: "2026-11-14", importe: 10 }] });
  assert.deepEqual([q[0].id, q[0].tono], ["cheques_propios", "ambar"]);
});

// ─── Inicio: API ───

const TESORERIA = [
  { cuenta: "01.01.01.001.001", nombre: "Caja", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: "01.01.02.001.001", nombre: "Banco", tipo: "banco", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.002.001", nombre: "Caja dólares", tipo: "caja", moneda: "USD", activa: true },
];
const mesHoy = HOY.slice(0, 8);
const OPS = [
  { fecha: `${mesHoy}01`, total: 100000, total_ars: 100000, cuenta_debe: "01.01.02.001.001", cuenta_haber: "04.01.01", estado: "confirmada" },
  { fecha: `${mesHoy}01`, total: 30000, total_ars: 30000, cuenta_debe: "05.02.01", cuenta_haber: "01.01.01.001.001", estado: "confirmada" },
  { fecha: `${mesHoy}01`, total: 20000, total_ars: 20000, cuenta_debe: "01.01.01.001.001", cuenta_haber: "01.01.02.001.001", estado: "confirmada" },
  { fecha: `${mesHoy}01`, total: 500, total_ars: 500000, cuenta_debe: "01.01.01.002.001", cuenta_haber: "03.01", estado: "confirmada" },
  { fecha: `${mesHoy}01`, total: 7000, total_ars: 7000, cuenta_debe: "05.02.01", cuenta_haber: "01.01.01.001.001", estado: "para_revisar" },
  { fecha: "2020-01-01", total: 1000, total_ars: 1000, cuenta_debe: "01.01.01.001.001", cuenta_haber: "04.01.01", estado: "confirmada" },
];

function mockInicio({ fallaCheques = false } = {}) {
  const leido = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TESORERIA }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u) => {
        leido.push(u);
        if (u.includes("estado=eq.para_revisar")) return { status: 200, body: [{ id: 5, origen: "mi_caja" }] };
        if (u.includes("origen=eq.gasto")) return { status: 200, body: [] };
        return { status: 200, body: OPS };
      },
    },
    { match: (u) => u.includes("/rest/v1/fin_ordenes_pago"), respond: () => ({ status: 200, body: [{ id: 1, estado: "para_aprobar", total: 4000 }] }) },
    { match: (u) => u.includes("/rest/v1/fin_cheques"), respond: () => (fallaCheques ? { status: 404, body: { message: 'relation "fin_cheques" does not exist' } } : { status: 200, body: [] }) },
    { match: (u) => /vehiculo_mantenimientos|maquina_fallas/.test(u), respond: () => ({ status: 200, body: [] }) },
  ]);
  return leido;
}

test("/api/finanzas/inicio — la plata, el mes sin los pases entre cajas y lo que hay que hacer", async () => {
  mockInicio();
  const r = await pedir(apiInicio, "gerencial", "GET");
  assert.equal(r.status, 200);
  const d = await r.json();
  // Caja: -30.000 + 20.000 + 1.000 = -9.000; Banco: 100.000 - 20.000 = 80.000 → 71.000 (sin lo "para revisar")
  assert.deepEqual([d.saldo.ARS, d.saldo.USD], [71000, 500]);
  assert.deepEqual([d.mes.entro, d.mes.salio], [100000, 30000], "el pase Banco → Caja no cuenta y los dólares van aparte");
  assert.deepEqual(d.pendientes.map((p) => p.id), ["op_pagar", "mi_caja"]);
  assert.equal(d.cajas, 3);
  assert.equal((await pedir(apiInicio, "administrativo", "GET")).status, 403, "solo el dueño");
});

test("/api/finanzas/inicio — un módulo que la empresa no tiene queda en cero, no rompe", async () => {
  mockInicio({ fallaCheques: true });
  const r = await pedir(apiInicio, "gerencial", "GET");
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).pendientes.map((p) => p.id), ["op_pagar", "mi_caja"]);
});

// ─── Inicio: pantalla ───

test("Inicio — la plata, Para hacer y las tarjetas llevan cada una a su pantalla", async () => {
  global.fetch = async () => new Response(JSON.stringify({
    hoy: HOY, saldo: { ARS: 71000, USD: 0 }, mes: { entro: 100000, salio: 30000 }, cajas: 2,
    pendientes: [{ id: "op_pagar", ir: "fin-pagos", cantidad: 1, importe: 4000, tono: "normal", texto: "1 orden de pago sin pagar" }],
  }), { status: 200 });
  const idas = [];
  const opciones = OPCIONES_GESTION.finanzas.filter((o) => o.id !== "fin-config");
  render(<FinanzasInicio opciones={opciones} onIr={(id) => idas.push(id)} />);
  assert.ok(await screen.findByText("$ 71.000,00"));
  assert.ok(screen.getByText(/Diferencia \$ 70\.000,00/));
  fireEvent.click(screen.getByRole("button", { name: /1 orden de pago sin pagar/ }));
  fireEvent.click(screen.getByRole("button", { name: /En cajas y bancos/ }));
  fireEvent.click(screen.getByRole("button", { name: /Este mes/ }));
  fireEvent.click(screen.getByRole("button", { name: /Cheques y e-cheq propios/ }));
  assert.deepEqual(idas, ["fin-pagos", "fin-tesoreria", "fin-flujo", "fin-cheques"]);
  assert.equal(screen.queryByRole("region", { name: "Ajustes" }), null, "lo que no tiene, no se muestra");
});

test("Inicio — sin nada pendiente lo dice; si falla la lectura, avisa y las tarjetas siguen", async () => {
  global.fetch = async () => new Response(JSON.stringify({ hoy: HOY, saldo: { ARS: 0, USD: 0 }, mes: { entro: 0, salio: 0 }, pendientes: [], cajas: 0 }), { status: 200 });
  render(<FinanzasInicio opciones={OPCIONES_GESTION.finanzas} onIr={() => {}} />);
  assert.ok(await screen.findByText(/Nada pendiente/));
  cleanup();
  global.fetch = async () => new Response(JSON.stringify({ error: "Finanzas es solo para el dueño" }), { status: 403 });
  render(<FinanzasInicio opciones={OPCIONES_GESTION.finanzas} onIr={() => {}} />);
  assert.ok(await screen.findByText(/Finanzas es solo para el dueño/));
  assert.ok(screen.getByRole("button", { name: /Liquidar y pagar sueldos/ }));
});

// ─── Mi caja fácil: reglas ───

const CONCEPTOS = [
  { codigo: "NAFTA", nombre: "Combustible" },
  { codigo: "VIAT", nombre: "Viáticos" },
  { codigo: "FERR", nombre: "Ferretería" },
];

test("Mi caja — los conceptos más usados primero; empate en el orden del dueño", () => {
  const movs = [{ concepto: "Ferretería" }, { concepto: "Viáticos" }, { concepto: "Ferretería" }, { concepto: "Otro" }];
  assert.deepEqual(conceptosPorUso(CONCEPTOS, movs).map((c) => c.codigo), ["FERR", "VIAT", "NAFTA"]);
  assert.deepEqual(conceptosPorUso(CONCEPTOS, []).map((c) => c.codigo), ["NAFTA", "VIAT", "FERR"]);
  assert.deepEqual(conceptosPorUso(CONCEPTOS).map((c) => c.codigo), ["NAFTA", "VIAT", "FERR"]);
});

test("Mi caja — ayer, también al cambiar de mes y de año", () => {
  assert.equal(ayerDe("2026-11-11"), "2026-11-10");
  assert.equal(ayerDe("2026-03-01"), "2026-02-28");
  assert.equal(ayerDe("2027-01-01"), "2026-12-31");
});

const VACIA = { importe: null, fecha: null, concepto: null, descripcion: null, comercio: null, cuit: null, proveedor_id: null, letra: null, punto_venta: null, numero: null, neto: null, iva: null, otros_impuestos: null };

test("Mi caja — la lectura del ticket solo llena lo que tiene sentido", () => {
  const esq = esquemaTicket(CONCEPTOS);
  assert.deepEqual(esq.properties.concepto.enum, ["NAFTA", "VIAT", "FERR", ""]);
  assert.deepEqual(esq.required, ["importe", "fecha", "comercio", "cuit", "letra", "punto_venta", "numero", "neto", "iva", "otros_impuestos", "detalle", "concepto"]);
  const ctx = { conceptos: CONCEPTOS, hoy: "2026-11-11" };
  assert.deepEqual(propuestaTicket({ importe: 12500.456, fecha: "2026-11-10", comercio: "  YPF   Ruta 9 ", detalle: "Nafta súper", concepto: "NAFTA" }, ctx),
    { ...VACIA, importe: 12500.46, fecha: "2026-11-10", concepto: "NAFTA", descripcion: "Nafta súper", comercio: "YPF Ruta 9" });
  assert.deepEqual(propuestaTicket({ importe: 0, fecha: "2026-12-01", comercio: "", concepto: "INVENTADO" }, ctx), VACIA, "fecha futura, concepto que no está y sin importe: nada");
  assert.equal(propuestaTicket({ importe: 10, fecha: "2024-01-01" }, ctx).fecha, null, "más de un año atrás: seguro la leyó mal");
  assert.equal(propuestaTicket({ importe: 10, fecha: "2026-02-30" }, ctx).fecha, null, "un día que no existe");
  assert.deepEqual(propuestaTicket(null, ctx), VACIA);
});

test("Mi caja — factura A del ticket: proveedor de la lista por CUIT, número e IVA si cierra con el total", () => {
  const proveedores = [{ id: 7, nombre: "Ferretería Centro SRL", cuit: "30711222339" }];
  const ctx = { conceptos: CONCEPTOS, hoy: "2026-11-11", proveedores };
  const p = propuestaTicket({
    importe: 12100, fecha: "2026-11-10", comercio: "FERRETERIA CENTRO", cuit: "30-71122233-9", letra: "A", punto_venta: "0004", numero: "00001234",
    neto: 10000, iva: 2100, otros_impuestos: 0, detalle: "Tornillos y tarugos", concepto: "FERR",
  }, ctx);
  assert.deepEqual(p, {
    importe: 12100, fecha: "2026-11-10", concepto: "FERR", descripcion: "Tornillos y tarugos", comercio: "Ferretería Centro SRL", cuit: "30-71122233-9",
    proveedor_id: 7, letra: "A", punto_venta: "0004", numero: "00001234", neto: 10000, iva: 2100, otros_impuestos: null,
  });
  const noCierra = propuestaTicket({ importe: 12100, letra: "A", numero: "5", neto: 10000, iva: 3000 }, ctx);
  assert.deepEqual([noCierra.neto, noCierra.iva], [null, null], "si no cierra con el total, sin IVA");
  const b = propuestaTicket({ importe: 12100, letra: "B", numero: "5", neto: 10000, iva: 2100 }, ctx);
  assert.equal(b.iva, null, "una B no discrimina IVA");
  assert.equal(propuestaTicket({ importe: 100, comercio: "Kiosco", cuit: "123" }, ctx).cuit, null, "un CUIT que no tiene 11 números no sirve");
});

// ─── Mi caja fácil: API ───

const CAJA_JUAN = { cuenta: "01.01.01.001.001.02", nombre: "Caja Juan", tipo: "caja", moneda: "ARS", activa: true, responsable_id: EMP };
const TIPOS = [
  { codigo: "GASTO COMBUSTIBLE", nombre: "Combustible", cuenta_debe: "05.02.01", cuenta_haber: null, activo: true },
  { codigo: "GASTO VIATICOS", nombre: "Viáticos", cuenta_debe: "05.02.02", cuenta_haber: null, activo: true },
];
const CONFIG = { gastos: ["GASTO COMBUSTIBLE", "GASTO VIATICOS"], ingresos: [] };
const FOTO = `https://test.supabase.co/storage/v1/object/public/reportes-obra/${E}/0b9e3c1a-1111-4222-8333-444455556666.jpg`;

function mockMiCaja({ lectura = { importe: 8400, fecha: "", comercio: "Shell", concepto: "GASTO COMBUSTIBLE" }, iaFalla = false } = {}) {
  const ia = [];
  const bajadas = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: [CAJA_JUAN] }) },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => ({ status: 200, body: TIPOS }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [{ valor: CONFIG }] }) },
    { match: (u) => u.startsWith("https://test.supabase.co/storage/"), respond: (u) => { bajadas.push(u); return { status: 200, body: "fotobytes", headers: { "content-type": "image/jpeg" } }; } },
    {
      match: (u) => u.includes("api.anthropic.com"),
      respond: (u, o) => {
        ia.push(JSON.parse(o.body));
        if (iaFalla) return { status: 529, body: {} };
        return { status: 200, body: { content: [{ type: "text", text: JSON.stringify(lectura) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, model: "m" } };
      },
    },
  ]);
  return { ia, bajadas };
}

test("/api/mi-caja leer_ticket — la IA lee la foto de su caja y no guarda nada", async () => {
  const { ia, bajadas } = mockMiCaja();
  const r = await pedir(apiMiCaja, "operativo", "POST", { accion: "leer_ticket", cuenta: CAJA_JUAN.cuenta, comprobante_url: FOTO });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, ...VACIA, importe: 8400, concepto: "GASTO COMBUSTIBLE", comercio: "Shell", repetido: null });
  assert.deepEqual(bajadas, [FOTO]);
  assert.equal(ia.length, 1);
  assert.equal(ia[0].messages[0].content[0].source.media_type, "image/jpeg");
  assert.match(ia[0].system, /GASTO COMBUSTIBLE \(Combustible\)/);
  assert.deepEqual(ia[0].output_config.format.schema.properties.concepto.enum, ["GASTO COMBUSTIBLE", "GASTO VIATICOS", ""]);
});

test("/api/mi-caja leer_ticket — solo fotos de Gypi, solo su caja; si la IA falla, a mano", async () => {
  const { ia, bajadas } = mockMiCaja();
  const otraFoto = await pedir(apiMiCaja, "operativo", "POST", { accion: "leer_ticket", cuenta: CAJA_JUAN.cuenta, comprobante_url: "https://malo.com/x.jpg" });
  assert.equal(otraFoto.status, 400);
  const otraEmpresa = await pedir(apiMiCaja, "operativo", "POST", { accion: "leer_ticket", cuenta: CAJA_JUAN.cuenta, comprobante_url: FOTO.replace(E, "99999999-9999-9999-9999-999999999999") });
  assert.equal(otraEmpresa.status, 400);
  const otraCaja = await pedir(apiMiCaja, "operativo", "POST", { accion: "leer_ticket", cuenta: "01.01.01.001.001.01", comprobante_url: FOTO });
  assert.equal(otraCaja.status, 403);
  assert.deepEqual([bajadas.length, ia.length], [0, 0], "no baja nada ni llama a la IA");
  mockMiCaja({ iaFalla: true });
  const falla = await pedir(apiMiCaja, "operativo", "POST", { accion: "leer_ticket", cuenta: CAJA_JUAN.cuenta, comprobante_url: FOTO });
  assert.equal(falla.status, 502);
  assert.match((await falla.json()).error, /Cargalo a mano/);
});

// ─── Mi caja fácil: pantalla ───

test("Mi caja — gasto en dos toques: el concepto más usado primero, Ayer y el importe", async () => {
  const ops = [
    { id: 1, fecha: "2026-11-01", tipo: "GASTO VIATICOS", total: 100, total_ars: 100, cuenta_debe: "05.02.02", cuenta_haber: CAJA_JUAN.cuenta, estado: "confirmada", origen: "mi_caja" },
    { id: 2, fecha: "2026-11-02", tipo: "GASTO VIATICOS", total: 100, total_ars: 100, cuenta_debe: "05.02.02", cuenta_haber: CAJA_JUAN.cuenta, estado: "confirmada", origen: "mi_caja" },
  ];
  const datos = {
    cajas: [{ ...resumenMiCaja(ops, CAJA_JUAN, new Map([["GASTO VIATICOS", "Viáticos"]])), destinos: [] }],
    conceptos: conceptosMiCaja(CONFIG, TIPOS), hoy: "2026-11-11",
  };
  const enviados = [];
  global.fetch = async (url, o = {}) => { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
  render(<MiCaja datos={datos} onClose={() => {}} onCambio={() => {}} />);
  fireEvent.click(screen.getByText("➖ Gasté"));
  const chips = screen.getAllByRole("button").filter((b) => ["Viáticos", "Combustible"].includes(b.textContent));
  assert.deepEqual(chips.map((b) => b.textContent), ["Viáticos", "Combustible"], "el que más usa, primero");
  assert.ok(screen.getByLabelText(/Sacar foto del ticket/), "la foto del ticket va primero");
  assert.equal(screen.getByRole("button", { name: "Hoy" }).getAttribute("aria-pressed"), "true");
  assert.equal(screen.queryByLabelText("Fecha del movimiento"), null, "la fecha a mano solo con Otro día");
  fireEvent.click(chips[0]);
  fireEvent.click(screen.getByRole("button", { name: "Ayer" }));
  fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "1.200,50" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].concepto, enviados[0].importe, enviados[0].fecha], ["cargar", "GASTO VIATICOS", 1200.5, "2026-11-10"]);
});

test("Mi caja — Otro día abre el calendario", () => {
  const datos = { cajas: [{ ...resumenMiCaja([], CAJA_JUAN), destinos: [] }], conceptos: conceptosMiCaja(CONFIG, TIPOS), hoy: "2026-11-11" };
  render(<MiCaja datos={datos} onClose={() => {}} onCambio={() => {}} />);
  fireEvent.click(screen.getByText("➖ Gasté"));
  fireEvent.click(screen.getByRole("button", { name: "Otro día" }));
  const fecha = screen.getByLabelText("Fecha del movimiento");
  assert.equal(fecha.getAttribute("max"), "2026-11-11");
  fireEvent.change(fecha, { target: { value: "2026-11-03" } });
  assert.equal(screen.getByLabelText("Fecha del movimiento").value, "2026-11-03");
});
