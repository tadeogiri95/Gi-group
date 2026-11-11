// tests/finanzas-cheques.test.jsx — Finanzas, parte F2b (1; migración 174):
// cheques propios y de terceros, cada cambio de estado con su operación, los
// vivos de R-CHEQUES copiados sin operación, el calendario por semana y el
// aviso del día anterior solo a los Dueños.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  cuentasCheques, cuentaBancoDe, validarCheque, operacionAlta, cambioDeEstado, chequesDelLibro, calendarioCheques, chequesParaAvisar, textoAviso,
} from "../app/lib/finanzasCheques.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/cheques/route.js");
const { avisarCheques } = await import("../app/lib/finanzasChequesAviso.js");
const { default: FinanzasCheques } = await import("../app/components/FinanzasCheques.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const CUENTAS = [
  { codigo: "01.01.01.002.001", nombre: "Valores A Depositar", activa: true },
  { codigo: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", activa: true },
  { codigo: "01.01.01.003.004", nombre: "Banco Comafi CTA CTE", activa: true },
  { codigo: "01.01.01.014.001", nombre: "Cheques Rechazados", activa: true },
  { codigo: "01.01.01.022.001", nombre: "Valores A Depositar - E-Cheq", activa: true },
  { codigo: "01.01.02.001.001", nombre: "Deudores Por Ventas", activa: true },
  { codigo: "02.01.01.001.005", nombre: "E-cheq diferidos a pagar- Bco Credicoop", activa: true },
  { codigo: "02.01.02.001.001", nombre: "Proveedores", activa: true },
];
const TESORERIA = [
  { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", tipo: "banco", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.003.009", nombre: "Banco Credicoop Especial Dolar", tipo: "banco", moneda: "USD", activa: true },
  { cuenta: "01.01.01.003.004", nombre: "Banco Comafi CTA CTE", tipo: "banco", moneda: "ARS", activa: true },
];
const PROVEEDORES = [{ id: 5, nombre: "ANTONIO F PEPERMANS SA", activo: true }, { id: 6, nombre: "DAVID ELECTRICO", activo: true }];
const CTX = { cuentas: CUENTAS, tesoreria: TESORERIA, proveedores: PROVEEDORES };
const PROPIO = { id: 10, clase: "propio", tipo: "echeq_diferido", banco: "Credicoop", numero: "28887495", importe: 1600000, fecha_pago: "2026-11-10", proveedor_id: 5, beneficiario: "ANTONIO F PEPERMANS SA", cuenta_banco: "01.01.01.003.002", estado: "pendiente" };
const TERCERO = { id: 11, clase: "tercero", tipo: "cheque_fisico", banco: "Bancor", numero: "38908430", importe: 1200000, fecha_pago: "2026-11-20", recibido_de: "Municipalidad de Rio Ceballos", librador: "Municipalidad de Rio Ceballos", estado: "en_cartera" };

// ─── Reglas ───

test("cuentas — se buscan por nombre; el banco del cheque va a su cuenta en pesos", () => {
  const c = cuentasCheques(CUENTAS);
  assert.deepEqual([c.proveedores, c.diferidos, c.valores, c.valoresEcheq, c.rechazados, c.deudores],
    ["02.01.02.001.001", "02.01.01.001.005", "01.01.01.002.001", "01.01.01.022.001", "01.01.01.014.001", "01.01.02.001.001"]);
  assert.equal(cuentaBancoDe("Credicoop", TESORERIA), "01.01.01.003.002", "no la de dólares");
  assert.equal(cuentaBancoDe("Bancor", TESORERIA), null);
});

test("nuevo cheque — el propio pide proveedor y sale del Credicoop; el recibido pide de quién", () => {
  const p = validarCheque({ clase: "propio", tipo: "echeq_diferido", importe: 1000, fecha_pago: "2026-11-20", proveedor_id: 5 }, CTX);
  assert.deepEqual(p.errores, []);
  assert.deepEqual([p.cheque.banco, p.cheque.cuenta_banco, p.cheque.beneficiario, p.cheque.estado], ["Credicoop", "01.01.01.003.002", "ANTONIO F PEPERMANS SA", "pendiente"]);
  assert.match(validarCheque({ clase: "propio", tipo: "echeq_diferido", importe: 1000, fecha_pago: "2026-11-20" }, CTX).errores.join(), /proveedor/);
  assert.match(validarCheque({ clase: "tercero", tipo: "cheque_fisico", banco: "Bancor", importe: 1000, fecha_pago: "2026-11-20" }, CTX).errores.join(), /de quién/);
  assert.match(validarCheque({ clase: "tercero", tipo: "cheque_fisico", banco: "Bancor", importe: 0, recibido_de: "X" }, CTX).errores.join(), /importe.*fecha de pago/);
  assert.equal(validarCheque({ clase: "tercero", tipo: "cheque_fisico", banco: "Bancor", importe: 5, fecha_pago: "2026-11-20", recibido_de: "Cliente" }, CTX).cheque.estado, "en_cartera");
});

test("alta — propio: Proveedores contra E-cheq diferidos; recibido: Valores contra el cliente", () => {
  const p = operacionAlta(PROPIO, CUENTAS, "2026-11-01").op;
  assert.deepEqual([p.tipo, p.cuenta_debe, p.cuenta_haber, p.proveedor_id, p.total_ars, p.origen, p.origen_id], ["PAGO A PROVEEDORES", "02.01.02.001.001", "02.01.01.001.005", 5, 1600000, "cheque", "10:alta"]);
  const t = operacionAlta(TERCERO, CUENTAS, "2026-11-01").op;
  assert.deepEqual([t.tipo, t.cuenta_debe, t.cuenta_haber, t.entidad], ["COBRO A CLIENTES", "01.01.01.002.001", "01.01.02.001.001", "Municipalidad de Rio Ceballos"]);
  assert.equal(operacionAlta({ ...TERCERO, tipo: "echeq_diferido" }, CUENTAS, "2026-11-01").op.cuenta_debe, "01.01.01.022.001", "el e-cheq va a Valores - E-Cheq");
  assert.match(operacionAlta(PROPIO, CUENTAS.filter((c) => !/diferidos/.test(c.nombre)), "2026-11-01").error, /E-cheq diferidos/);
});

test("cambios — debitado baja el banco, depositado lo sube, entregado baja la deuda del proveedor", () => {
  const d = cambioDeEstado(PROPIO, "debitado", { fecha: "2026-11-10" }, CTX);
  assert.deepEqual([d.cambios.estado, d.op.tipo, d.op.cuenta_debe, d.op.cuenta_haber, d.op.origen_id], ["debitado", "PAGO A PROVEEDORES", "02.01.01.001.005", "01.01.01.003.002", "10:debitado"]);
  const dep = cambioDeEstado(TERCERO, "depositado", { fecha: "2026-11-20", cuenta_banco: "01.01.01.003.004" }, CTX);
  assert.deepEqual([dep.op.cuenta_debe, dep.op.cuenta_haber, dep.cambios.cuenta_banco], ["01.01.01.003.004", "01.01.01.002.001", "01.01.01.003.004"]);
  assert.match(cambioDeEstado(TERCERO, "depositado", { fecha: "2026-11-20", cuenta_banco: "01.01.01.001.001.01" }, CTX).error, /banco/, "una caja no es un banco");
  const ent = cambioDeEstado(TERCERO, "entregado", { fecha: "2026-11-12", proveedor: PROVEEDORES[1] }, CTX);
  assert.deepEqual([ent.op.cuenta_debe, ent.op.cuenta_haber, ent.op.proveedor_id, ent.cambios.entregado_a], ["02.01.02.001.001", "01.01.01.002.001", 6, "DAVID ELECTRICO"]);
});

test("cambios — rechazado sale de donde estaba; anular no genera operación; lo que no corresponde se rechaza", () => {
  assert.equal(cambioDeEstado(TERCERO, "rechazado", { fecha: "2026-11-21" }, CTX).op.cuenta_haber, "01.01.01.002.001");
  assert.equal(cambioDeEstado({ ...TERCERO, estado: "depositado", cuenta_banco: "01.01.01.003.004" }, "rechazado", { fecha: "2026-11-21" }, CTX).op.cuenta_haber, "01.01.01.003.004");
  const ent = cambioDeEstado({ ...TERCERO, estado: "entregado", proveedor_id: 6 }, "rechazado", { fecha: "2026-11-21" }, CTX);
  assert.deepEqual([ent.op.cuenta_debe, ent.op.cuenta_haber, ent.op.proveedor_id], ["01.01.01.014.001", "02.01.02.001.001", 6], "el proveedor nos lo devuelve: vuelve la deuda");
  assert.deepEqual(cambioDeEstado(PROPIO, "anular", { fecha: "2026-11-02" }, CTX), { cambios: { estado: "anulado", estado_fecha: "2026-11-02" }, op: null });
  assert.match(cambioDeEstado(PROPIO, "depositado", { fecha: "2026-11-02", cuenta_banco: "01.01.01.003.002" }, CTX).error, /no se puede/);
  assert.match(cambioDeEstado({ ...PROPIO, estado: "debitado" }, "anular", { fecha: "2026-11-02" }, CTX).error, /no se puede/);
});

test("libro — copia ACTIVO y ENTREGADO; propio es el que libra la empresa", () => {
  const T = ["|", "fecha_transac", "fecha_emision", "tipo", "cant", "librador", "banco", "beneficiario", "Nro Cheque", "vencimiento", "monto", "estado", "dias_al_vto", "ENTREGADO A"];
  const grilla = [
    T,
    ["13", "46001", "46001", "E-CHEQ PAGO DIFERIDO", "1", "Gi amoblamientos S.R.L", "Credicoop", "BALESTRO MARCELO", "28343656", "46094", "2500000", "PAGADO"],
    ["27", "46093", "46093", "E-CHEQ PAGO DIFERIDO", "1", "Gi amoblamientos S.R.L", "Credicoop", "ANTONIO F PEPERMANS SA", "28887495", "46340", "1600000", "ACTIVO"],
    ["41", "46099", "46099", "E-CHEQ COMÚN", "1", "FUNDACION PROGRESO", "Macro", "Gi amoblamientos S.R.L", "93674350", "46345", "1868300", "ACTIVO"],
    ["208", "46296", "46241", "CHEQUE FÍSICO", "", "Municipalidad de Rio Ceballos", "Bancor", "Gi amoblamientos S.R.L", "38908430", "46304", "1200000", "ENTREGADO", "-30", "DAVID ELECTRICO"],
  ];
  const r = chequesDelLibro(grilla);
  assert.equal(r.empresa, "Gi amoblamientos S.R.L");
  assert.deepEqual(r.filas.map((f) => [f.referencia, f.clase, f.tipo, f.estado]), [
    ["27", "propio", "echeq_diferido", "pendiente"],
    ["41", "tercero", "echeq_comun", "en_cartera"],
    ["208", "tercero", "cheque_fisico", "entregado"],
  ]);
  assert.equal(r.filas[2].entregado_a, "DAVID ELECTRICO");
  assert.equal(r.filas[0].fecha_pago, "2026-11-14");
  assert.match(chequesDelLibro([["x"]]).error, /R-CHEQUES/);
});

test("calendario y aviso — por semana desde hoy; avisa lo que vence hasta mañana una sola vez", () => {
  const cheques = [
    { ...PROPIO, fecha_pago: "2026-11-05" }, { ...PROPIO, id: 12, fecha_pago: "2026-11-10" }, { ...TERCERO, fecha_pago: "2026-11-20" },
    { ...TERCERO, id: 13, estado: "depositado", fecha_pago: "2026-11-10" },
  ];
  const cal = calendarioCheques(cheques, "2026-11-09");
  assert.equal(cal.find((t) => t.etiqueta === "Vencidos").debitar, 1600000);
  assert.equal(cal.find((t) => t.etiqueta === "1 a 7 días").debitar, 1600000);
  assert.equal(cal.find((t) => t.etiqueta === "8 a 14 días").cobrar, 1200000);
  const av = chequesParaAvisar(cheques, "2026-11-09");
  assert.deepEqual(av.map((c) => c.id), [10, 12], "no el depositado ni el de dentro de 11 días");
  assert.deepEqual(chequesParaAvisar([{ ...PROPIO, avisado_para: "2026-11-10", fecha_pago: "2026-11-10" }], "2026-11-09"), []);
  assert.match(textoAviso(av).body, /se debitan 2 cheques propios por \$ 3\.200\.000/);
});

test("migración 174 — fin_cheques con RLS solo Dueño y sin delete", () => {
  const sql = readFileSync(new URL("../supabase/migrations/174_finanzas_cheques.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /create table if not exists public\.fin_cheques/);
  assert.match(sql, /->>'rol'\) = 'gerencial'/);
  assert.match(sql, /grant select, insert, update on public\.fin_cheques to authenticated/);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*fin_cheques/);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, metodo, body, query = "") => api[metodo](new Request(`http://localhost/api/finanzas/cheques${query}`, {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ cheques = [PROPIO, TERCERO], sin174 = false, libro = [] } = {}) {
  const escrito = [];
  const leido = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_cheques"),
      respond: (u, o) => {
        if (sin174) return { status: 404, body: { code: "42P01", message: 'relation "public.fin_cheques" does not exist' } };
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "fin_cheques", url: u, metodo: o.method, body });
          if (o.method === "PATCH") {
            const ch = cheques.find((c) => u.includes(`id=eq.${c.id}&`));
            if (!ch || (/estado=eq\./.test(u) && !u.includes(`estado=eq.${ch.estado}`))) return { status: 200, body: [] };
            return { status: 200, body: [{ ...ch, ...body }] };
          }
          return { status: 201, body: Array.isArray(body) ? body : [{ id: 50, ...body }] };
        }
        leido.push(u);
        if (u.includes("origen=eq.libro")) return { status: 200, body: libro };
        return { status: 200, body: /[?&]id=eq\./.test(u) ? cheques.filter((c) => u.includes(`id=eq.${c.id}&`)) : cheques };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        const body = o?.body ? JSON.parse(o.body) : null;
        escrito.push({ tabla: "fin_operaciones", url: u, metodo: o?.method || "GET", body });
        return { status: 201, body: [{ id: 77, ...body }] };
      },
    },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TESORERIA }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: PROVEEDORES }) },
  ]);
  return { escrito, leido };
}

test("/api/finanzas/cheques — ni la oficina ni el operario; sin la 174 avisa", async () => {
  const { escrito } = mockApi();
  for (const rol of ["administrativo", "operativo"]) {
    assert.equal((await pedir(rol, "GET")).status, 403, rol);
    assert.equal((await pedir(rol, "POST", { accion: "cambiar", id: 10, a: "debitado", fecha: "2026-11-10" })).status, 403, rol);
  }
  assert.equal(escrito.length, 0);
  mockApi({ sin174: true });
  const res = await pedir("gerencial", "GET");
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 174/);
});

test("/api/finanzas/cheques — crear un propio guarda el cheque y su operación, y los une", async () => {
  const { escrito } = mockApi({ cheques: [] });
  const res = await pedir("gerencial", "POST", { accion: "crear", cheque: { clase: "propio", tipo: "echeq_diferido", numero: "1", importe: 1000, fecha_emision: "2026-11-09", fecha_pago: "2026-12-09", proveedor_id: 5 } });
  assert.equal(res.status, 200);
  const [ch, op, union] = escrito;
  assert.deepEqual([ch.tabla, ch.body.estado, ch.body.cargado_por_nombre, ch.body.empresa_id], ["fin_cheques", "pendiente", "Tadeo", E]);
  assert.deepEqual([op.tabla, op.body.tipo, op.body.fecha, op.body.origen_id], ["fin_operaciones", "PAGO A PROVEEDORES", "2026-11-09", "50:alta"]);
  assert.deepEqual([union.tabla, union.body.op_alta_id], ["fin_cheques", 77]);
  mockApi({ cheques: [] });
  const mal = await pedir("gerencial", "POST", { accion: "crear", cheque: { clase: "propio", tipo: "echeq_diferido", importe: 1000, fecha_pago: "2026-12-09" } });
  assert.equal(mal.status, 400);
});

test("/api/finanzas/cheques — debitado: el cambio solo vale si el cheque sigue igual, y genera su operación", async () => {
  const { escrito } = mockApi();
  const res = await pedir("gerencial", "POST", { accion: "cambiar", id: 10, a: "debitado", fecha: "2026-11-10" });
  assert.equal(res.status, 200);
  assert.match(escrito[0].url, /id=eq\.10&.*estado=eq\.pendiente/);
  assert.equal(escrito[1].body.tipo, "PAGO A PROVEEDORES");
  assert.equal(escrito[2].body.op_cierre_id, 77);
  mockApi({ cheques: [{ ...PROPIO, estado: "debitado" }] });
  assert.equal((await pedir("gerencial", "POST", { accion: "cambiar", id: 10, a: "debitado", fecha: "2026-11-10" })).status, 400);
});

test("/api/finanzas/cheques — anular anula la operación del alta (no se borra)", async () => {
  const { escrito } = mockApi({ cheques: [{ ...PROPIO, op_alta_id: 33 }] });
  const res = await pedir("gerencial", "POST", { accion: "cambiar", id: 10, a: "anular", fecha: "2026-11-09" });
  assert.equal(res.status, 200);
  const op = escrito.find((x) => x.tabla === "fin_operaciones");
  assert.equal(op.metodo, "PATCH");
  assert.match(op.url, /id=eq\.33&.*anulada_at=is\.null/);
  assert.ok(op.body.anulada_at);
});

test("/api/finanzas/cheques — copiar del libro: sin operaciones y sin repetir", async () => {
  const { escrito } = mockApi({ libro: [{ referencia: "27" }] });
  const filas = [
    { referencia: "27", clase: "propio", tipo: "echeq_diferido", estado: "pendiente", importe: 1600000, fecha_pago: "2026-11-14" },
    { referencia: "41", clase: "tercero", tipo: "echeq_comun", estado: "en_cartera", importe: 1868300, fecha_pago: "2026-11-19", librador: "FUNDACION" },
  ];
  const res = await pedir("gerencial", "POST", { accion: "copiar_libro", filas });
  assert.deepEqual(await res.json(), { ok: true, copiados: 1, repetidos: 1 });
  assert.equal(escrito.filter((x) => x.tabla === "fin_operaciones").length, 0);
  const [ins] = escrito;
  assert.deepEqual(ins.body.map((c) => [c.referencia, c.origen, c.recibido_de]), [["41", "libro", "FUNDACION"]]);
  mockApi();
  assert.equal((await pedir("gerencial", "POST", { accion: "copiar_libro", filas: [{ ...filas[1], estado: "debitado" }] })).status, 400);
});

test("aviso — solo a los Dueños y anota para qué fecha avisó", async () => {
  const escrito = [];
  let pedidos = "";
  global.fetch = createFetchMock([
    {
      match: (u) => u.includes("/rest/v1/fin_cheques"),
      respond: (u, o) => {
        if (o?.method === "PATCH") { escrito.push({ url: u, body: JSON.parse(o.body) }); return { status: 200, body: [] }; }
        return { status: 200, body: [{ id: 10, clase: "propio", estado: "pendiente", importe: 1000, fecha_pago: "2026-11-10" }] };
      },
    },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: (u) => { pedidos = u; return { status: 200, body: [{ legajo: 1 }] }; } },
    { match: (u) => u.includes("/rest/v1/push_tokens"), respond: () => ({ status: 200, body: [{ token: "t1" }] }) },
  ]);
  const enviados = [];
  const r = await avisarCheques({ id: E }, "2026-11-09", { messaging: { send: async (m) => enviados.push(m) } });
  assert.deepEqual(r, { cheques: 1, push: 1 });
  assert.match(pedidos, /rol=eq\.gerencial/);
  assert.match(enviados[0].notification.body, /se debita 1 cheque propio/);
  assert.equal(escrito[0].body.avisado_para, "2026-11-10");
});

// ─── Pantalla ───

test("Cheques — por debitar, en cartera, calendario y marcar debitado", async () => {
  const datos = { ...CTX, cheques: [PROPIO, TERCERO] };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify(datos), { status: 200 });
  };
  render(<FinanzasCheques />);
  await waitFor(() => assert.ok(screen.getByText("ANTONIO F PEPERMANS SA")));
  assert.ok(screen.getByText(/Por debitar \(1\)/));
  fireEvent.click(screen.getByText(/En cartera \(1\)/));
  await waitFor(() => assert.ok(screen.getByText("Municipalidad de Rio Ceballos")));
  fireEvent.click(screen.getByText("Calendario"));
  assert.ok(await screen.findByRole("table", { name: "Calendario de cheques" }));
  fireEvent.click(screen.getByText(/Por debitar \(1\)/));
  fireEvent.click(await screen.findByText("ANTONIO F PEPERMANS SA"));
  fireEvent.click(screen.getByRole("button", { name: "Debitado" }));
  assert.equal(screen.getByLabelText("Banco").value, "Banco Credicoop CTA CTE", "propone el banco del cheque");
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].id, enviados[0].a, enviados[0].cuenta_banco], ["cambiar", 10, "debitado", "01.01.01.003.002"]);
});
