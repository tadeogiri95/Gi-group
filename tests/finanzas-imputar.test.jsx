// tests/finanzas-imputar.test.jsx — 19/11 (punto 13, migración 200): imputar
// después una o varias operaciones a un cliente, proveedor, OT, centro de
// costo, cuenta, caja, vehículo o máquina; lo del vehículo o la máquina se ve
// en su ficha.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { imputacion, ladoDeCaja, porQueNoImputar } from "../app/lib/finanzasImputar.js";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/operaciones/route.js");
const { default: BarraImputar, opcionesImputar } = await import("../app/components/FinanzasImputar.jsx");
const { default: GastosImputados } = await import("../app/components/GastosImputados.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const BANCO = "01.01.01.003.002";
const CAJA = "01.01.01.001.001.01";
const COMB = "05.02.01";
const LOG = "05.02.02";
const CTX = {
  tesoreria: [{ cuenta: BANCO, nombre: "Banco Credicoop", activa: true }, { cuenta: CAJA, nombre: "Caja Principal", activa: true }],
  cuentas: [{ codigo: BANCO, nombre: "Banco" }, { codigo: CAJA, nombre: "Caja" }, { codigo: COMB, nombre: "Combustible" }, { codigo: LOG, nombre: "Gastos de logística" }],
  clientes: [{ id: 3, nombre: "Ocampo Urbano" }], proveedores: [{ id: 8, nombre: "YPF" }],
  proyectos: [{ id: 50, ot: "M-7877", cliente: "Ocampo" }], centros: [{ codigo: "PROD", nombre: "Producción" }],
  vehiculos: [{ id: 2, patente: "AB123CD", marca: "Ford", modelo: "Ranger" }], maquinas: [{ id: 6, codigo: "SEC-1", nombre: "Seccionadora" }],
};
const nafta = { id: 7, fecha: "2026-11-10", tipo: "GASTOS DE LOGÍSTICA", total: 50000, moneda: "ARS", cuenta_debe: COMB, cuenta_haber: CAJA, origen: "libro", proveedor_id: null, cliente_id: null, entidad: null, historial: [], updated_at: "2026-11-10T10:00:00+00:00", vehiculo_id: null, maquina_id: null };

test("qué se imputa en cada una", () => {
  assert.equal(porQueNoImputar(nafta, "vehiculo"), null, "vehículo, máquina y centro en cualquiera");
  assert.equal(porQueNoImputar({ ...nafta, origen: "factura_oc" }, "centro_costo"), null);
  assert.match(porQueNoImputar({ ...nafta, origen: "venta_ot" }, "ot"), /Gypi/);
  assert.equal(porQueNoImputar({ ...nafta, origen: "cheque" }, "ot"), null);
  assert.match(porQueNoImputar(nafta, "proveedor"), /otra pantalla/, "lo del libro, solo con el libro como copia");
  assert.equal(porQueNoImputar(nafta, "proveedor", { espejo: true }), null);
  assert.match(porQueNoImputar({ ...nafta, origen: "orden_pago" }, "cuenta", { espejo: true }), /otra pantalla/);
  assert.match(porQueNoImputar({ ...nafta, anulada_at: "2026-11-11" }, "vehiculo"), /anulada/);
  assert.equal(ladoDeCaja(nafta, new Set([CAJA])), "haber");
});

test("imputacion — lo que cambia y qué queda en el historial", () => {
  assert.deepEqual(imputacion(nafta, "vehiculo", "2", CTX).campos, { vehiculo_id: 2 });
  assert.deepEqual(imputacion(nafta, "ot", "50", CTX).detalle, [{ campo: "proyecto_id", antes: null, despues: 50 }]);
  const prov = imputacion({ ...nafta, cliente_id: 3, entidad: "Ocampo Urbano" }, "proveedor", "8", CTX, { espejo: true });
  assert.deepEqual(prov.campos, { proveedor_id: 8, cliente_id: null, entidad: "YPF" }, "de un cliente o de un proveedor, no de los dos");
  // La cuenta es el lado que no es caja; la caja, el que sí
  assert.deepEqual(imputacion(nafta, "cuenta", LOG, CTX, { espejo: true }).campos, { cuenta_debe: LOG });
  assert.deepEqual(imputacion(nafta, "caja", BANCO, CTX, { espejo: true }).campos, { cuenta_haber: BANCO });
  assert.match(imputacion(nafta, "cuenta", CAJA, CTX, { espejo: true }).error, /es una caja/);
  assert.match(imputacion({ ...nafta, cuenta_debe: BANCO }, "cuenta", LOG, CTX, { espejo: true }).error, /pase entre dos cajas/);
  assert.match(imputacion({ ...nafta, cuenta_haber: "02.01" }, "caja", BANCO, CTX, { espejo: true }).error, /No tiene caja/);
  assert.match(imputacion(nafta, "vehiculo", "99", CTX).error, /no está en Flota/);
  assert.match(imputacion({ ...nafta, vehiculo_id: 2 }, "vehiculo", "2", CTX).error, /Ya estaba así/);
  assert.deepEqual(imputacion({ ...nafta, vehiculo_id: 2 }, "vehiculo", null, CTX).campos, { vehiculo_id: null }, "se saca");
});

test("migración 200 — vehículo y máquina en la operación", () => {
  const sql = readFileSync(new URL("../supabase/migrations/200_imputar_vehiculo_maquina.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /add column if not exists vehiculo_id bigint references public\.vehiculos\(id\) on delete set null/);
  assert.match(sql, /add column if not exists maquina_id bigint references public\.maquinas\(id\) on delete set null/);
  assert.deepEqual(MIGRACIONES.find((m) => m.n === 200).tablas, { fin_operaciones: ["vehiculo_id", "maquina_id"] });
});

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const pedir = async (metodo, body, query = "") => api[metodo](new Request(`http://localhost/api/finanzas/operaciones${query}`, {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token("gerencial")}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ ops = [nafta, { ...nafta, id: 8, origen: "orden_pago" }], cfg = [] } = {}) {
  const escrito = [];
  const leidas = [];
  const lista = (body) => ({ status: 200, body });
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => lista([{ plan_activo: "pro", plan_vence: "2099-01-01" }]) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => lista([]) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => lista([{ id: EMP, nombre: "Tadeo" }]) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => lista(cfg) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => lista(CTX.tesoreria) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => lista(CTX.cuentas) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => lista(CTX.clientes) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => lista(CTX.proveedores) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => lista(CTX.proyectos) },
    { match: (u) => u.includes("/rest/v1/fin_centros_costo"), respond: () => lista(CTX.centros) },
    { match: (u) => u.includes("/rest/v1/vehiculos"), respond: () => lista(CTX.vehiculos) },
    { match: (u) => u.includes("/rest/v1/maquinas"), respond: () => lista(CTX.maquinas) },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => lista([]) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ url: decodeURIComponent(u), body });
          return { status: 200, body: [{ id: 1, ...body }] };
        }
        leidas.push(decodeURIComponent(u));
        return lista(ops);
      },
    },
  ]);
  return { escrito, leidas };
}

test("/api/finanzas/operaciones imputar — varias juntas; las que no se pueden vuelven con el motivo", async () => {
  const { escrito } = mockApi();
  const res = await pedir("POST", { accion: "imputar", ids: [7, 8, 8], campo: "vehiculo", valor: "2" });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.imputadas, 2, "vehículo va en cualquiera");
  assert.equal(escrito.length, 2);
  assert.equal(escrito[0].body.vehiculo_id, 2);
  assert.equal(escrito[0].body.historial[0].por, "Tadeo");
  assert.deepEqual(escrito[0].body.historial[0].cambios, [{ campo: "vehiculo_id", antes: null, despues: 2 }]);
  assert.match(escrito[0].url, /updated_at=eq\./);

  const prov = mockApi({ cfg: [{ valor: { espejo_completo_at: "2026-11-19T12:00:00Z" } }] });
  const r2 = await (await pedir("POST", { accion: "imputar", ids: [7, 8], campo: "proveedor", valor: 8 })).json();
  assert.equal(r2.imputadas, 1);
  assert.deepEqual(r2.saltadas, [{ id: 8, motivo: "Sale de otra pantalla: se cambia desde ahí" }]);
  assert.equal(prov.escrito[0].body.entidad, "YPF");

  // Sin la 200, vehículo y máquina avisan; lo demás anda
  const { vehiculo_id: _v, maquina_id: _m, ...sin200 } = nafta;
  mockApi({ ops: [sin200] });
  const r3 = await pedir("POST", { accion: "imputar", ids: [7], campo: "maquina", valor: 6 });
  assert.equal(r3.status, 409);
  assert.match((await r3.json()).error, /migración 200/);
  mockApi({ ops: [sin200] });
  assert.equal((await (await pedir("POST", { accion: "imputar", ids: [7], campo: "centro_costo", valor: "PROD" })).json()).imputadas, 1);
  assert.equal((await pedir("POST", { accion: "imputar", ids: [], campo: "ot", valor: 50 })).status, 400);
});

test("/api/finanzas/operaciones GET ?vehiculo= — lo imputado, para la ficha", async () => {
  const { leidas } = mockApi({ ops: [{ ...nafta, vehiculo_id: 2 }] });
  const res = await pedir("GET", null, "?vehiculo=2");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).operaciones.length, 1);
  assert.match(leidas[0], /vehiculo_id=eq\.2&anulada_at=is\.null/);
});

test("BarraImputar — elegir qué y a qué, y mandar las tildadas", async () => {
  const pedidos = [];
  global.fetch = async (u, o) => { pedidos.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, imputadas: 1, saltadas: [{ id: 8, motivo: "Está anulada" }] }), { status: 200 }); };
  let hecho = 0;
  render(<BarraImputar datos={CTX} ids={[7, 8]} total={5} onTodas={() => {}} onNinguna={() => {}} onHecho={() => { hecho += 1; }} />);
  assert.ok(screen.getByText("2 tildadas"));
  assert.ok(screen.getByRole("button", { name: "Tildar las 5 de la lista" }));
  fireEvent.change(screen.getByLabelText("Qué imputar"), { target: { value: "vehiculo" } });
  fireEvent.change(screen.getByLabelText("Vehículo a imputar"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Imputar" }));
  await waitFor(() => assert.equal(hecho, 1));
  assert.deepEqual(pedidos[0], { accion: "imputar", ids: [7, 8], campo: "vehiculo", valor: "2" });
  await waitFor(() => assert.match(screen.getByRole("status").textContent, /1 · Está anulada/));
  assert.deepEqual(opcionesImputar("cuenta", CTX).map((o) => o[0]), [COMB, LOG], "la cuenta no ofrece cajas");
  assert.deepEqual(opcionesImputar("maquina", CTX), [["6", "SEC-1 · Seccionadora"]]);
});

test("GastosImputados — el Dueño ve el total en la ficha; el resto, nada", async () => {
  global.fetch = async () => new Response(JSON.stringify({ operaciones: [{ ...nafta, vehiculo_id: 2, total_ars: 50000 }, { ...nafta, id: 9, total: 20000, total_ars: 20000, descripcion: "Seguro" }] }), { status: 200 });
  render(<GastosImputados tipo="vehiculo" id={2} usuario={{ rol: "gerencial" }} />);
  await waitFor(() => assert.ok(screen.getByRole("region", { name: "Gastos imputados en Finanzas" })));
  assert.match(screen.getByRole("region", { name: "Gastos imputados en Finanzas" }).textContent, /\$ 70\.000,00 en 2 operaciones/);
  cleanup();
  let llamadas = 0;
  global.fetch = async () => { llamadas += 1; return new Response("{}", { status: 403 }); };
  render(<GastosImputados tipo="vehiculo" id={2} usuario={{ rol: "administrativo" }} />);
  assert.equal(screen.queryByRole("region", { name: "Gastos imputados en Finanzas" }), null);
  assert.equal(llamadas, 0);
});
