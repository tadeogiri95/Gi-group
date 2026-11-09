// tests/finanzas-banco.test.jsx — Finanzas, parte F5a: leer el extracto del
// banco (resumen en PDF, Excel, CSV o tabla HTML), emparejarlo con lo que ya
// tiene Gypi, sugerir el tipo con lo aprendido del libro y cargar el resto.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  importeAr, fechaExtracto, movimientosDePdf, movimientosDeGrilla, grillaDeCsv, grillaDeHtml, claseDeArchivo,
} from "../app/lib/finanzasExtracto.js";
import {
  cuitDe, nombreDe, claveTexto, reglasDelLibro, reglasDeConfirmados, sugerir, marcasExtracto, emparejarExtracto, operacionDeMovimiento,
  controlSaldo, entidadDe, juntarReglas,
} from "../app/lib/finanzasBanco.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/banco/route.js");
const { default: SubirExtracto, contraDeTipo, codigoDe } = await import("../app/components/FinanzasExtracto.jsx");

const E = "66666666-6666-6666-6666-666666666666";
const EMP = "77777777-7777-7777-7777-777777777777";
const BANCO = "01.01.01.003.002";
const PROV = "02.01.02.001.001";
const IMP = "04.02.01.003.010";
const COM = "04.02.01.001.008";

// ─── Leer ───

test("importes y fechas como los escribe el banco", () => {
  assert.equal(importeAr("1.633.500,00"), 1633500);
  assert.equal(importeAr("54,60"), 54.6);
  assert.equal(importeAr("-1.200,50"), -1200.5);
  assert.equal(importeAr("(600,00)"), -600);
  assert.equal(importeAr("1,234.56"), 1234.56);
  assert.equal(importeAr(1500), 1500);
  assert.equal(importeAr("hola"), null);
  assert.equal(fechaExtracto("01/09/26"), "2026-09-01");
  assert.equal(fechaExtracto("1/9/2026"), "2026-09-01");
  assert.equal(fechaExtracto("2026-09-01T00:00"), "2026-09-01");
  assert.equal(fechaExtracto(46266), "2026-09-01", "fecha de Excel");
  assert.equal(fechaExtracto("32/09/26"), null);
});

// Un resumen como el de Credicoop: el importe es débito o crédito según bajo qué título queda
const T = (str, x, y, w = str.length * 5) => ({ str, x, y, w });
const PAGINA = [
  T("Cta. 191.416.006078.2", 490, 560), T("del: 01/09/2026   al: 30/09/2026", 330, 560),
  T("FECHA", 25, 520, 25), T("COMBTE", 60, 520, 30), T("DESCRIPCION", 180, 520, 50), T("DEBITO", 360, 520, 30), T("CREDITO", 440, 520, 35), T("SALDO", 540, 520, 25),
  T("SALDO ANTERIOR", 25, 510), T("20.000,00", 520, 510, 45),
  T("01/09/26", 25, 500), T("415171", 73, 500), T("Vencimiento Plazo Fijo", 110, 500), T("5.000,00", 430, 500, 45),
  T("Operacion: 17415171", 110, 492),
  T("01/09/26", 25, 484), T("322964", 73, 484), T("Transf.Inmediata e/Ctas.Dist Tit.O/Bco", 110, 484), T("1.500,00", 350, 484, 40),
  T("30717953866−FAC−VINY INDUSTRIES S.A.", 110, 476),
  T("01/09/26", 25, 468), T("I.V.A. − Debito Fiscal 21%", 110, 468), T("126,00", 360, 468, 30), T("23.374,00", 520, 468, 45),
  T("CONTINUA EN PAGINA SIGUIENTE >>>>>>", 300, 460),
  T("Credicoop Responde: 0800−888−4500", 100, 450),
];
const PAGINA2 = [
  T("FECHA", 25, 520, 25), T("DESCRIPCION", 180, 520, 50), T("DEBITO", 360, 520, 30), T("CREDITO", 440, 520, 35), T("SALDO", 540, 520, 25),
  T("02/09/26", 25, 500), T("Comision Transferencias", 110, 500), T("600,00", 360, 500, 30),
  T("SALDO AL 30/09/26", 60, 480), T("22.774,00", 520, 480, 45),
  T("02/09/26", 25, 470), T("No es un movimiento", 110, 470), T("9,00", 380, 470, 20),
];

test("resumen en PDF — débito o crédito por columna, descripción en dos renglones, saldo que cierra", () => {
  const r = movimientosDePdf([PAGINA, PAGINA2]);
  assert.deepEqual(r.movimientos.map((m) => [m.fecha, m.comprobante, m.importe]), [
    ["2026-09-01", "415171", 5000], ["2026-09-01", "322964", -1500], ["2026-09-01", null, -126], ["2026-09-02", null, -600],
  ]);
  assert.equal(r.movimientos[0].descripcion, "Vencimiento Plazo Fijo Operacion: 17415171");
  assert.match(r.movimientos[1].descripcion, /30717953866-FAC-VINY INDUSTRIES S\.A\.$/);
  assert.equal(r.movimientos[2].descripcion, "I.V.A. - Debito Fiscal 21%", "sin el pie de página");
  assert.deepEqual([r.saldo_anterior, r.saldo_final, r.cuenta, r.desde, r.hasta], [20000, 22774, "191.416.006078.2", "2026-09-01", "2026-09-30"]);
  assert.deepEqual(controlSaldo(r), { calculado: 22774, final: 22774, ok: true });
});

test("Excel, CSV y tabla HTML — por los títulos", () => {
  const grilla = [["Banco Credicoop"], [], ["Fecha", "Concepto", "Nro. Comprobante", "Débito", "Crédito", "Saldo"],
    ["01/09/2026", "Transf.Inmediata 30717953866-FAC-VINY", "322964", "1.633.500,00", "", "100,00"], ["02/09/2026", "Cobro", "", "", "2.000,00", ""], ["", "Total", "", "", "", ""]];
  const r = movimientosDeGrilla(grilla);
  assert.deepEqual(r.movimientos.map((m) => [m.fecha, m.importe, m.comprobante]), [["2026-09-01", -1633500, "322964"], ["2026-09-02", 2000, null]]);
  const csv = grillaDeCsv('﻿Fecha;Descripción;Importe\n01/09/2026;"Pago; EPEC";-131.053,60\n');
  assert.deepEqual(movimientosDeGrilla(csv).movimientos.map((m) => [m.descripcion, m.importe]), [["Pago; EPEC", -131053.6]]);
  const html = "<table><tr><th>Fecha</th><th>Descripcion</th><th>Debito</th><th>Credito</th></tr><tr><td>03/09/2026</td><td>Comisi&oacute;n &amp; IVA</td><td>600,00</td><td></td></tr></table>";
  assert.deepEqual(movimientosDeGrilla(grillaDeHtml(html)).movimientos.map((m) => m.importe), [-600]);
  assert.match(movimientosDeGrilla([["a", "b"]]).error, /títulos/);
  const b = (s) => new TextEncoder().encode(s);
  assert.equal(claseDeArchivo(b("%PDF-1.4")), "pdf");
  assert.equal(claseDeArchivo(new Uint8Array([0x50, 0x4b, 3, 4])), "xlsx");
  assert.equal(claseDeArchivo(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), "xls");
  assert.equal(claseDeArchivo(b("<html><table>")), "html");
  assert.equal(claseDeArchivo(b("Fecha;Importe")), "csv");
});

// ─── Aprender y sugerir ───

test("texto, CUIT y nombre del banco", () => {
  assert.equal(claveTexto("Impuesto Ley 25.413 Alic Gral s/Debitos"), claveTexto("Impuesto Ley 25.413 Ali Gral s/Debitos"));
  assert.equal(claveTexto("I.V.A. - Debito Fiscal 21%"), "IVA DEB FIS");
  assert.equal(claveTexto("Transf.Inmediata e/Ctas.Dist Tit.O/Bco 30717953866-FAC-VINY"), "TRA INM CTA DIS TIT BCO");
  assert.equal(cuitDe("Transf 30717953866-FAC-VINY INDUSTRIES S.A. CBU Destino: 0070"), "30717953866");
  assert.equal(cuitDe("Operacion: 17415171"), null);
  assert.equal(nombreDe("Transf 30717953866-FAC-VINY INDUSTRIES S.A. CBU Destino: 0070"), "VINY INDUSTRIES S.A.");
});

const LIBRO = [
  ["fecha_operación", "cod_tipo_op", "id_entidad", "descripcion", "cuenta_debe_final", "cuenta_haber_final"],
  ["46200", "PAGO IMPUESTO", "", "Impuesto Ley 25.413 Ali Gral s/Debitos", IMP, BANCO],
  ["46201", "PAGO IMPUESTO", "", "Impuesto Ley 25.413 Ali Gral s/Debitos", IMP, BANCO],
  ["46202", "PAGO IMPUESTO", "", "IVA - Alicuota Inscripto", "01.01.03.001.001", BANCO],
  ["46203", "PAGO GASTOS BANCARIOS", "", "Comision Transferencias Inmediatas", COM, BANCO],
  ["46204", "PAGO EFECTIVO A PROVEEDORES M.P", "VINY INDUSTRIES", "Transf.Inmediata e/Ctas.Dist Tit.O/Bco 30717953866-FAC-VINY", PROV, BANCO],
  ["46205", "PAGO GASTOS DE LOGÍSTICA", "", "Transf.Inmediata e/Ctas.Dist Tit.O/Bco 33534279049-FAC-EL FARO", PROV, BANCO],
  ["46206", "COBRO TRANSF", "BCG", "Transf. Inmediata e/Ctas. Dist. Titular 30707800808-FAC-BCG", BANCO, "01.01.02.001.001"],
  ["46207", "OTRA COSA", "", "No toca el banco", "x", "y"],
];

test("reglas del libro — por texto y por CUIT, según entre o salga plata", () => {
  const { reglas, usadas } = reglasDelLibro(LIBRO, BANCO);
  assert.equal(usadas, 7);
  const s = (descripcion, importe) => sugerir({ descripcion, importe }, reglas);
  assert.deepEqual(s("Impuesto Ley 25.413 Alic Gral s/Debitos", -95847.68), { tipo: "PAGO IMPUESTO", contra: IMP, entidad: "", por: "texto" });
  assert.deepEqual(s("Transf.Inmediata e/Ctas.Dist Tit.O/Bco 30717953866-FAC-VINY INDUSTRIES S.A.", -1633500), { tipo: "PAGO EFECTIVO A PROVEEDORES M.P", contra: PROV, entidad: "VINY INDUSTRIES", por: "cuit" });
  assert.equal(s("I.V.A. - Debito Fiscal 21%", -126).contra, "01.01.03.001.001", "se parece por la primera palabra");
  assert.equal(s("Comision Transferencias]Inmediatas!COM", -600).tipo, "PAGO GASTOS BANCARIOS");
  assert.equal(s("Impuesto Ley 25.413 Alic Gral s/Debitos", 500), null, "entra plata: no es la misma regla");
  assert.equal(s("Algo nunca visto", -1), null);
  const nuevas = reglasDeConfirmados([{ descripcion: "Algo nunca visto", importe: -1, tipo: "PAGO IMPUESTO", contra: IMP }]);
  assert.equal(sugerir({ descripcion: "Algo nunca visto", importe: -5 }, juntarReglas(reglas, nuevas)).tipo, "PAGO IMPUESTO");
  assert.match(reglasDelLibro([["x"]], BANCO).error, /cod_tipo_op/);
});

// ─── Emparejar ───

const MOVS = [
  { fecha: "2026-09-01", comprobante: "1", descripcion: "Transf 30717953866-FAC-VINY", importe: -1633500 },
  { fecha: "2026-09-01", comprobante: null, descripcion: "Comision", importe: -600 },
  { fecha: "2026-09-01", comprobante: null, descripcion: "Comision", importe: -600 },
  { fecha: "2026-09-03", comprobante: null, descripcion: "Cobro BCG", importe: 2000 },
];

test("emparejar — mismo importe y fecha cercana, una operación por renglón; lo de un extracto anterior por su marca", () => {
  const marcas = marcasExtracto(MOVS, BANCO);
  assert.equal(new Set(marcas).size, 4, "dos comisiones iguales tienen marcas distintas");
  assert.deepEqual(marcasExtracto(MOVS, BANCO), marcas, "la misma marca si se sube de nuevo");
  assert.ok(marcas.every((m) => /^[0-9a-z:]{6,60}$/.test(m)));
  const ops = [
    { id: 1, fecha: "2026-08-30", tipo: "PAGO TRANSF", cuenta_debe: PROV, cuenta_haber: BANCO, total_ars: 1633500, origen: "orden_pago" },
    { id: 2, fecha: "2026-09-01", tipo: "PAGO GASTOS BANCARIOS", cuenta_debe: COM, cuenta_haber: BANCO, total_ars: 600, origen: "banco", origen_id: marcas[1] },
    { id: 3, fecha: "2026-09-20", tipo: "COBRO TRANSF", cuenta_debe: BANCO, cuenta_haber: "01.01.02.001.001", total_ars: 2000, origen: "cobro" },
    { id: 4, fecha: "2026-09-02", tipo: "PAGO TRANSF", cuenta_debe: PROV, cuenta_haber: BANCO, total_ars: 99, origen: "orden_pago" },
    { id: 5, fecha: "2026-09-02", tipo: "X", cuenta_debe: PROV, cuenta_haber: "otra", total_ars: 600 },
  ];
  const { filas, sin_banco } = emparejarExtracto(MOVS, ops, BANCO);
  assert.deepEqual(filas.map((f) => [f.op?.id ?? null, f.ya]), [[1, false], [2, true], [null, false], [null, false]], "el cobro está a más de 7 días");
  assert.deepEqual(sin_banco.map((o) => o.id), [4]);
});

test("la operación de un renglón — el banco al debe si entra y al haber si sale", () => {
  const sale = operacionDeMovimiento({ ...MOVS[0], marca: "m1", tipo: "PAGO EFECTIVO A PROVEEDORES M.P", contra: PROV, proveedor_id: 9, entidad: "VINY" }, BANCO);
  assert.deepEqual([sale.cuenta_debe, sale.cuenta_haber, sale.total, sale.total_ars, sale.proveedor_id, sale.origen, sale.origen_id, sale.referencia], [PROV, BANCO, 1633500, 1633500, 9, "banco", "m1", "1"]);
  const entra = operacionDeMovimiento({ ...MOVS[3], marca: "m4", tipo: "COBRO TRANSF", contra: "01.01.02.001.001" }, BANCO);
  assert.deepEqual([entra.cuenta_debe, entra.cuenta_haber, entra.total], [BANCO, "01.01.02.001.001", 2000]);
  assert.deepEqual(entidadDe("Viny Industries S.A.", { proveedores: [{ id: 9, nombre: "VINY INDUSTRIES SA" }] }), { proveedor_id: 9, entidad: "VINY INDUSTRIES SA" });
  assert.deepEqual(entidadDe("BCG", { clientes: [{ id: 2, nombre: "BCG SRL", alias: ["BCG"] }] }), { cliente_id: 2, entidad: "BCG SRL" });
  assert.deepEqual(entidadDe("Nadie", {}), { entidad: "Nadie" });
  assert.equal(contraDeTipo({ cuenta_debe: COM, cuenta_haber: BANCO }, -600, BANCO), COM);
  assert.equal(contraDeTipo({ cuenta_debe: BANCO, cuenta_haber: "01.01.02.001.001" }, 2000, BANCO), "01.01.02.001.001");
  assert.equal(contraDeTipo({ cuenta_debe: BANCO, cuenta_haber: "x" }, -5, BANCO), "");
  assert.equal(codigoDe("02.01.02.001.001 · Proveedores"), PROV);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, body) => api.POST(new Request("http://localhost/api/finanzas/banco", {
  method: "POST", headers: { Authorization: `Bearer ${await token(rol)}`, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
  body: body instanceof FormData ? body : JSON.stringify(body),
}));

function mockApi({ reglas = null, opsCuenta = [], yaMarcas = [] } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: (u) => ({ status: 200, body: decodeURIComponent(u).includes(`cuenta=eq.${BANCO}`) ? [{ cuenta: BANCO, nombre: "Credicoop", tipo: "banco", moneda: "ARS" }] : [] }) },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => ({ status: 200, body: [{ codigo: "PAGO IMPUESTO" }, { codigo: "COBRO TRANSF" }] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: [{ codigo: IMP }, { codigo: BANCO }, { codigo: "01.01.02.001.001" }] }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => ({ status: 200, body: [{ id: 2, nombre: "BCG", alias: [], activo: true }] }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push({ tabla: "config_sistema", metodo: o.method, body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        return { status: 200, body: reglas ? [{ valor: reglas }] : [] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") { escrito.push({ tabla: "fin_operaciones", body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        if (u.includes("origen_id=in.")) return { status: 200, body: yaMarcas.map((m) => ({ origen_id: m })) };
        return { status: 200, body: opsCuenta };
      },
    },
  ]);
  return escrito;
}

test("/api/finanzas/banco — solo el Dueño", async () => {
  const escrito = mockApi();
  for (const rol of ["administrativo", "operativo"]) assert.equal((await pedir(rol, { accion: "confirmar" })).status, 403, rol);
  assert.equal(escrito.length, 0);
});

test("/api/finanzas/banco — leer un CSV: empareja con Gypi y sugiere con lo aprendido", async () => {
  const { reglas } = reglasDelLibro(LIBRO, BANCO);
  mockApi({ reglas: { [BANCO]: reglas }, opsCuenta: [{ id: 30, fecha: "2026-09-03", tipo: "COBRO TRANSF", entidad: "BCG", cuenta_debe: BANCO, cuenta_haber: "01.01.02.001.001", total_ars: 2000, origen: "cobro" }] });
  const form = new FormData();
  form.append("cuenta", BANCO);
  form.append("file", new File(["Fecha;Descripcion;Debito;Credito\n01/09/2026;Impuesto Ley 25.413 Alic Gral s/Debitos;95,50;\n03/09/2026;Transf. Inmediata e/Ctas. Dist. Titular 30707800808-FAC-BCG;;2.000,00\n"], "extracto.csv", { type: "text/csv" }));
  const r = await pedir("gerencial", form);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.filas.length, 2);
  assert.deepEqual([d.filas[0].op, d.filas[0].sugerencia.tipo, d.filas[0].sugerencia.contra], [null, "PAGO IMPUESTO", IMP]);
  assert.deepEqual([d.filas[1].op.id, d.filas[1].sugerencia], [30, null]);
  const otro = new FormData();
  otro.append("cuenta", "99");
  otro.append("file", new File(["x"], "x.csv"));
  assert.equal((await pedir("gerencial", otro)).status, 400, "cuenta que no es de la empresa");
});

test("/api/finanzas/banco — confirmar: una operación por renglón, sin repetir, y aprende", async () => {
  const escrito = mockApi({ yaMarcas: ["abc123:2"] });
  const fila = { fecha: "2026-09-01", descripcion: "Algo nuevo del banco", comprobante: null, importe: -95.5, marca: "abc123:1", tipo: "PAGO IMPUESTO", contra: IMP };
  const r = await pedir("gerencial", { accion: "confirmar", cuenta: BANCO, filas: [fila, { ...fila, marca: "abc123:2" }] });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, cargadas: 1, repetidas: 1 });
  const ops = escrito.find((x) => x.tabla === "fin_operaciones").body;
  assert.deepEqual(ops.map((o) => [o.cuenta_debe, o.cuenta_haber, o.total, o.origen, o.origen_id, o.cargada_por_nombre, o.empresa_id]), [[IMP, BANCO, 95.5, "banco", "abc123:1", "Tadeo", E]]);
  const cfg = escrito.find((x) => x.tabla === "config_sistema");
  assert.equal(cfg.body.clave, "finanzas_reglas_banco");
  assert.equal(Object.values(cfg.body.valor[BANCO])[0].tipo, "PAGO IMPUESTO");
  assert.equal((await pedir("gerencial", { accion: "confirmar", cuenta: BANCO, filas: [{ ...fila, tipo: "NO EXISTE" }] })).status, 400);
  assert.equal((await pedir("gerencial", { accion: "confirmar", cuenta: BANCO, filas: [{ ...fila, contra: BANCO }] })).status, 400, "contra el mismo banco no");
  assert.equal((await pedir("gerencial", { accion: "confirmar", cuenta: BANCO, filas: [{ ...fila, marca: "x;drop" }] })).status, 400);
});

test("/api/finanzas/banco — aprender guarda solo lo que tiene forma de regla", async () => {
  const escrito = mockApi({ reglas: { otra: { "+X": { tipo: "A", contra: "B", n: 1 } } } });
  const r = await pedir("gerencial", { accion: "aprender", cuenta: BANCO, reglas: { "-IMP LEY": { tipo: "PAGO IMPUESTO", contra: IMP, n: 3 }, basura: { tipo: 1 } } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).reglas, 1);
  const v = escrito[0].body.valor;
  assert.deepEqual(Object.keys(v[BANCO]), ["-IMP LEY"]);
  assert.ok(v.otra, "no pisa las de otra cuenta");
});

// ─── Pantalla ───

test("Subir extracto — muestra lo que ya está y carga lo elegido", async () => {
  const respuesta = {
    ok: true, desde: "2026-09-01", hasta: "2026-09-30", reglas: 5, control: { calculado: 10, final: 10, ok: true }, sin_banco: [],
    filas: [
      { fecha: "2026-09-01", comprobante: null, descripcion: "Impuesto Ley 25.413", importe: -95.5, marca: "m1", op: null, ya: false, sugerencia: { tipo: "PAGO IMPUESTO", contra: IMP, por: "texto", entidad: "" } },
      { fecha: "2026-09-01", comprobante: null, descripcion: "Nunca visto", importe: -10, marca: "m2", op: null, ya: false, sugerencia: null },
      { fecha: "2026-09-03", comprobante: null, descripcion: "Cobro BCG", importe: 2000, marca: "m3", op: { id: 30, tipo: "COBRO TRANSF" }, ya: false, sugerencia: null },
    ],
  };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    if (o.body instanceof FormData) return new Response(JSON.stringify(respuesta), { status: 200 });
    enviados.push(JSON.parse(o.body));
    return new Response(JSON.stringify({ ok: true, cargadas: 1, repetidas: 0 }), { status: 200 });
  };
  const datos = { cuentas: [{ codigo: IMP, nombre: "Impuesto Debitos Y Creditos Bancarios" }, { codigo: BANCO, nombre: "Banco" }], tipos: [{ codigo: "PAGO IMPUESTO", cuenta_debe: IMP, cuenta_haber: BANCO }] };
  let cargado = false;
  render(<SubirExtracto caja={{ cuenta: BANCO, nombre: "Credicoop" }} datos={datos} onCerrar={() => {}} onCargado={() => { cargado = true; }} />);
  fireEvent.change(screen.getByLabelText("Archivo del extracto"), { target: { files: [new File(["x"], "e.pdf")] } });
  await waitFor(() => assert.ok(screen.getByText(/✓ 1 ya en Gypi/)));
  assert.ok(screen.getByText(/El saldo cierra/));
  assert.equal(screen.getByLabelText("Cargar renglón 2").checked, false, "sin sugerencia no va marcado");
  fireEvent.click(screen.getByRole("button", { name: "Cargar 1 movimientos" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].filas.length, enviados[0].filas[0].contra, enviados[0].filas[0].marca], ["confirmar", 1, IMP, "m1"]);
  await waitFor(() => assert.ok(cargado));
});

test("CSV de Credicoop — fecha AAAAMMDD, del más nuevo al más viejo, saldo de cada renglón", () => {
  const csv = grillaDeCsv("FECHA;DESCRIPCION;COMBTE;DEBITO;CREDITO;SALDO;CODIGO\n20260930;Impuesto Ley 25.413 Ali Gral s/Debitos ;;62.406,23;;1595397,19;IDCC3\n20260901;Vencimiento Plazo Fijo (Exento);415171;;5.869.149,01;1657803,42;00618\n");
  const r = movimientosDeGrilla(csv);
  assert.deepEqual(r.movimientos.map((m) => [m.fecha, m.importe]), [["2026-09-01", 5869149.01], ["2026-09-30", -62406.23]], "queda en orden de fecha");
  assert.deepEqual([r.saldo_anterior, r.saldo_final, r.desde, r.hasta], [-4211345.59, 1595397.19, "2026-09-01", "2026-09-30"]);
  assert.equal(r.movimientos[0].comprobante, "415171");
});
