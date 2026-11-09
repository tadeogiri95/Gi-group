// tests/finanzas-sos.test.jsx — Finanzas, parte 4: importar el CSV de compras
// del S.O.S Contador sin duplicar (sin migración). Datos de mentira.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { comprobanteSos, compararSos, leerCsvSos, mismoNombre, numeroSos, operacionSos } from "../app/lib/finanzasSos.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/sos/route.js");
const { default: FinanzasSos } = await import("../app/components/FinanzasSos.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const PROV = "02.01.02.001.001";
const MP = "01.01.04.001.002";
const FLETES = "04.02.03.001.004";
const TEL = "04.02.01.001.045";
const BANCO = "01.01.01.003.002";
const CUENTAS = [
  { codigo: MP, nombre: "Materias Primas" }, { codigo: FLETES, nombre: "Fletes Y Acarreos" },
  { codigo: TEL, nombre: "Telefonía Móvil" }, { codigo: BANCO, nombre: "Banco Uno" }, { codigo: PROV, nombre: "Proveedores" },
];
const CP = new Set([PROV]);

const TITULOS = "Fecha Comprobante;Fecha IVA;Fecha Vencimiento;CUIT;Proveedor;Email;Condicion IVA;Lista de precios;Vendedor;Comprobante;Neto;IVA COMPUTABLE;IVA NO COMPUTABLE;IVA;No Gravado;Exento;Percepciones IVA;Percepciones IIBB;Percepciones ITC;Otros impuestos;Total;CAE;Jurisdiccion;Rubro;Cuenta;Centro Costo;Observaciones;Pedido CAE;Letra;Sucursal;Numero;Moneda;Tipo Cambio;";
const renglon = ({ fecha = "01/10/2026", cuit = "30111111118", nombre = "Maderas Uno S.A.", comp = " A-00006-00039368", neto = "1000,00", iva = "210,00", otros = "0,00", total = "1210,00", cuenta = "Materias Primas" } = {}) =>
  `${fecha};${fecha};;${cuit};${nombre};;1;;;${comp};${neto};${iva};0,00;${iva};0,00;0,00;0,00;${otros};0,00;0,00;${total};123;Cordoba;01.01.04 Bienes;${cuenta};General;CAE;;A;6;1;ARS;1.00;`;
const CSV = [
  TITULOS,
  renglon(),
  renglon({ comp: "NC A-00006-00000012", neto: "-100,00", iva: "-21,00", total: "-121,00" }),
  renglon({ cuit: "30222222229", nombre: "AMX ARGENTINA SOCIEDAD ANONIMA", comp: " A-01340-00746569", neto: "149250,00", iva: "36870,00", otros: "4477,50", total: "190597,50", cuenta: "Telefon&#237;a M&#243;vil" }),
  renglon({ cuit: "20333333334", nombre: "GUZMAN FELIPE OMAR", comp: " C-00001-00000003", neto: "0,00", iva: "0,00", total: "1.000.000,00", cuenta: "Trabajos De Terceros" }),
  renglon({ cuit: "30444444440", nombre: "Fletes Raros SRL", comp: " A-00002-00000099", neto: "500,00", iva: "105,00", total: "605,00", cuenta: "Fletes Y Acarreos" }),
  renglon({ comp: " A-00031-00305668", neto: "0,00", iva: "0,00", total: "0,00" }),
  renglon(), // repetido en el mismo archivo
].join("\n");

// ─── Reglas ───

test("CSV — lee los comprobantes; las letras con &#…; no corren las columnas", () => {
  assert.equal(numeroSos("1.000.000,00"), 1000000);
  assert.equal(numeroSos("-127685,95"), -127685.95);
  assert.deepEqual(comprobanteSos("NC A-00003-00000312"), { clase: "NC", letra: "A", pv: 3, numero: 312 });
  assert.deepEqual(comprobanteSos(" C-00001-00000011"), { clase: "FC", letra: "C", pv: 1, numero: 11 });
  assert.equal(comprobanteSos("cualquiera"), null);
  const { filas, errores } = leerCsvSos(`﻿${CSV}`);
  assert.equal(filas.length, 5, "el repetido y el de total cero no cuentan");
  assert.equal(errores.length, 1);
  assert.match(errores[0], /total es cero/);
  const [fc, nc, amx, c] = filas;
  assert.deepEqual([fc.clave, fc.fecha, fc.neto, fc.iva, fc.otros, fc.total, fc.signo], ["sos30111111118FCA0000600039368", "2026-10-01", 1000, 210, 0, 1210, 1]);
  assert.deepEqual([nc.clase, nc.total, nc.neto, nc.iva, nc.signo], ["NC", 121, 100, 21, -1]);
  assert.equal(amx.cuenta_sos, "Telefonía Móvil");
  assert.equal(amx.otros, 4477.5, "percepciones aparte");
  assert.deepEqual([c.neto, c.iva, c.total], [0, 0, 1000000]);
  assert.match(leerCsvSos("a;b\n1;2").errores[0], /No es el CSV/);
});

test("nombres — mismo proveedor escrito distinto", () => {
  assert.ok(mismoNombre("GUZMAN FELIPE OMAR", "FELIPE OMAR GUZMAN"));
  assert.ok(mismoNombre("Acristalamientos Brocanelli S.", "ACRISTALAMIENTOS BROCANELLI SA"));
  assert.ok(!mismoNombre("ECENTRO SA", "EXA ALUMINIO SA"));
});

test("comparar — ya importado, ya está (libro, NC al revés, otro orden del nombre), ¿ya está? y nuevo", () => {
  const { filas } = leerCsvSos(CSV);
  const ops = [
    { id: 1, fecha: "2026-10-02", proveedor_id: 7, total_ars: 1210, cuenta_debe: MP, cuenta_haber: PROV, origen: "libro" },
    { id: 2, fecha: "2026-10-01", entidad: "Maderas Uno S.A.", total_ars: 121, cuenta_debe: PROV, cuenta_haber: MP, origen: "libro" },
    { id: 3, fecha: "2026-10-01", entidad: "Maderas Uno", total_ars: 121, cuenta_debe: PROV, cuenta_haber: BANCO, origen: "orden_pago" },
    { id: 4, fecha: "2026-10-03", entidad: "FELIPE OMAR GUZMAN", total_ars: 1000000, cuenta_debe: FLETES, cuenta_haber: PROV, origen: "libro" },
    { id: 5, fecha: "2026-10-05", entidad: "Otro Nombre", total_ars: 605, cuenta_debe: FLETES, cuenta_haber: PROV, origen: "libro" },
    { id: 6, fecha: "2026-10-01", entidad: "AMX", total_ars: 190597.5, cuenta_debe: TEL, cuenta_haber: PROV, origen: "sos", origen_id: "sos30222222229FCA0134000746569" },
    { id: 7, fecha: "2026-12-30", proveedor_id: 7, total_ars: 1210, cuenta_debe: MP, cuenta_haber: PROV, origen: "libro" },
  ];
  const proveedores = [{ id: 7, nombre: "MADERAS UNO SA", cuit: "30-11111111-8" }];
  const r = compararSos(filas, { operaciones: ops, proveedores, cuentasProv: CP, cajas: new Set([BANCO]) });
  const est = Object.fromEntries(r.map((f) => [f.comprobante, [f.estado, f.op_id ?? null]]));
  assert.deepEqual(est, {
    "A-00006-00039368": ["ya_esta", 1],
    "A-00006-00000012": ["ya_esta", 2],
    "A-01340-00746569": ["importada", 6],
    "C-00001-00000003": ["ya_esta", 4],
    "A-00002-00000099": ["dudosa", 5],
  });
  assert.equal(r[0].proveedor_id, 7, "por CUIT");
  // Sin el libro: todo nuevo, menos lo importado
  const solo = compararSos(filas, { operaciones: [ops[5]], proveedores, cuentasProv: CP });
  assert.equal(solo.filter((f) => f.estado === "nueva").length, 4);
});

test("operación — factura al haber de Proveedores, nota de crédito al revés; sin cuenta del proveedor queda para revisar", () => {
  const [fc, nc] = compararSos(leerCsvSos(CSV).filas, { proveedores: [{ id: 7, nombre: "Maderas Uno", cuit: "30111111118" }], cuentasProv: CP });
  const a = operacionSos(fc, { cuentaProveedores: PROV, cuenta: MP, deProveedor: true });
  assert.deepEqual([a.cuenta_debe, a.cuenta_haber, a.total, a.iva, a.origen, a.origen_id, a.estado, a.proveedor_id, a.tipo], [MP, PROV, 1210, 210, "sos", fc.clave, "confirmada", 7, "COMPRAS"]);
  assert.equal(a.descripcion, "Factura A-00006-00039368 (S.O.S)");
  const b = operacionSos(nc, { cuentaProveedores: PROV, cuenta: MP, deProveedor: false });
  assert.deepEqual([b.cuenta_debe, b.cuenta_haber, b.total, b.estado], [PROV, MP, 121, "para_revisar"]);
  assert.match(b.descripcion, /^Nota de crédito A-00006-00000012 \(S\.O\.S\) · Cuenta del S\.O\.S: Materias Primas/);
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const pedir = async (body, rol = "gerencial") => api.POST(new Request("http://localhost/api/finanzas/sos", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, body: JSON.stringify(body),
}));

function mockApi() {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [{ valor: { cuentas: { p7: MP } } }] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: [{ cuenta: BANCO }] }) },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => ({ status: 200, body: [{ codigo: "COMPRAS", cuenta_debe: MP }] }) },
    {
      match: (u) => u.includes("/rest/v1/proveedores"),
      respond: (u, o) => {
        if (o?.method === "POST") {
          const b = JSON.parse(o.body);
          escrito.push({ tabla: "proveedores", body: b });
          return { status: 201, body: b.map((x, i) => ({ ...x, id: 100 + i })) };
        }
        return { status: 200, body: [{ id: 7, nombre: "MADERAS UNO SA", cuit: "30111111118" }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") { escrito.push({ tabla: "fin_operaciones", body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        return { status: 200, body: [{ id: 1, fecha: "2026-10-01", proveedor_id: 7, total_ars: 1210, cuenta_debe: MP, cuenta_haber: PROV, origen: "libro" }] };
      },
    },
  ]);
  return escrito;
}

test("/api/finanzas/sos — solo el Dueño; ver y cargar los elegidos, con los proveedores nuevos", async () => {
  let escrito = mockApi();
  assert.equal((await pedir({ accion: "ver", texto: CSV }, "administrativo")).status, 403);
  const ver = await pedir({ accion: "ver", texto: CSV });
  assert.equal(ver.status, 200);
  const d = await ver.json();
  const por = Object.fromEntries(d.filas.map((f) => [f.comprobante, f]));
  assert.equal(por["A-00006-00039368"].estado, "ya_esta");
  assert.equal(por["A-00006-00000012"].estado, "nueva");
  assert.deepEqual([por["A-00006-00000012"].cuenta, por["A-00006-00000012"].de_proveedor], [MP, true], "la cuenta del proveedor");
  assert.deepEqual([por["A-01340-00746569"].cuenta, por["A-01340-00746569"].de_proveedor], [TEL, false], "la del S.O.S, por nombre");
  assert.equal(por["C-00001-00000003"].cuenta, MP, "si no, la del tipo COMPRAS");
  assert.equal(escrito.length, 0);

  escrito = mockApi();
  const claves = d.filas.map((f) => f.clave);
  const res = await pedir({ accion: "importar", texto: CSV, claves });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, cargadas: 4, proveedores_nuevos: 3, para_revisar: 3 });
  assert.deepEqual(escrito[0].body.map((p) => [p.nombre, p.cuit]), [
    ["AMX ARGENTINA SOCIEDAD ANONIMA", "30222222229"], ["GUZMAN FELIPE OMAR", "20333333334"], ["Fletes Raros SRL", "30444444440"],
  ]);
  const ops = escrito[1].body;
  assert.equal(ops.length, 4, "la que ya está no se carga aunque venga elegida");
  assert.deepEqual(ops.map((o) => o.proveedor_id), [7, 100, 101, 102]);
  assert.ok(ops.every((o) => o.empresa_id === E && o.origen === "sos"));
  assert.equal((await pedir({ accion: "importar", texto: CSV, claves: [] })).status, 400);
  assert.equal((await pedir({ accion: "borrar", texto: CSV })).status, 400);
});

// ─── Pantalla ───

test("Importar CSV del S.O.S — muestra nuevos y ya cargados, y carga los tildados", async () => {
  const filas = [
    { clave: "k1", estado: "nueva", nombre: "Fletes Raros SRL", proveedor_id: null, fecha: "2026-10-01", clase: "FC", comprobante: "A-00002-00000099", total: 605, signo: 1, moneda: "ARS", cuenta: FLETES, cuenta_nombre: "Fletes Y Acarreos", de_proveedor: false },
    { clave: "k2", estado: "ya_esta", nombre: "Maderas Uno", proveedor_id: 7, fecha: "2026-10-01", clase: "FC", comprobante: "A-00006-00039368", total: 1210, signo: 1, moneda: "ARS", op_nombre: "MADERAS UNO SA", op_fecha: "2026-10-02" },
  ];
  const enviados = [];
  global.fetch = async (u, o) => {
    const b = JSON.parse(o.body);
    enviados.push(b);
    return new Response(JSON.stringify(b.accion === "ver" ? { filas, errores: [] } : { ok: true, cargadas: 1, proveedores_nuevos: 1 }), { status: 200 });
  };
  let listo = false;
  render(<FinanzasSos onCerrar={() => {}} onImportado={() => { listo = true; }} />);
  const file = new File([CSV], "compras.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("CSV del S.O.S"), { target: { files: [file] } });
  await waitFor(() => assert.ok(screen.getByText("Fletes Raros SRL")));
  assert.ok(screen.getAllByText(/para revisar/).length >= 1);
  assert.ok(screen.getByRole("checkbox", { name: "Cargar A-00002-00000099" }).checked);
  fireEvent.click(screen.getByRole("button", { name: /Ya están \(1\)/ }));
  assert.ok(screen.getByText("MADERAS UNO SA"));
  fireEvent.click(screen.getByRole("button", { name: "Cargar 1" }));
  await waitFor(() => assert.ok(listo));
  assert.deepEqual(enviados[1].claves, ["k1"]);
  assert.match(enviados[0].texto, /Fletes Raros/);
});
