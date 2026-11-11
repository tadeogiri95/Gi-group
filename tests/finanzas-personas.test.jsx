// tests/finanzas-personas.test.jsx — Finanzas, parte 4 (11/11): una sola
// agenda de clientes y proveedores, con la hoja PERSONAS, sin repetidos y con
// los datos que se completan. Datos inventados.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  armarAgenda, clavePersona, leerPersonasPegadas, opcionesAgenda, planImportarPersonas, posiblesRepetidos, validarPersona, datosFaltantes,
} from "../app/lib/finanzasPersonas.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const E = "00000000-0000-0000-0000-0000000000e1";
const EMP = "00000000-0000-0000-0000-0000000000a1";
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/personas/route.js");
const { default: FinanzasPersonas } = await import("../app/components/FinanzasPersonas.jsx");

test("Personas — el mismo nombre en otro orden, con S.A./S.R.L. o tildes es la misma persona", () => {
  assert.equal(clavePersona("GIRI EZEQUIEL"), clavePersona("EZEQUIEL GIRI"));
  assert.equal(clavePersona("PAPA, MIGUEL ANGEL"), clavePersona("MIGUEL ANGEL PAPA S.R.L."));
  assert.equal(clavePersona("STOM"), clavePersona("STOM SAS"));
  assert.equal(clavePersona("INDUMAC  S. A."), clavePersona("INDUMAC S.A"));
  assert.equal(clavePersona("CASTAÑO MONICA"), clavePersona("Castano Mónica"));
  assert.equal(clavePersona("PLUS MILENIUM SOCIEDAD ANONIMA"), clavePersona("PLUS MILENIUM SA"));
  assert.notEqual(clavePersona("A.G.A.F. SA"), clavePersona("F. L. G. S.A."));
});

test("Personas — leer lo pegado de la hoja (con títulos) y juntar repetidos de la hoja", () => {
  const texto = [
    "ID\tNOMBRE\tTELEFONO\tEMAIL\tDIRECCION\tCONTACTO 2\tTELEFONO",
    "1\tGIRI EZEQUIEL\t351111\t\tCALLE 1\t\t",
    "2\tEZEQUIEL GIRI\t\tezequiel@mail.com\t\tPEDRO\t35122",
    "3\tACERCO S A\t\t\t\t\t",
    "\t\t\t\t\t\t",
  ].join("\n");
  const filas = leerPersonasPegadas(texto);
  assert.equal(filas.length, 3);
  assert.deepEqual([filas[1].email, filas[1].contacto], ["ezequiel@mail.com", "PEDRO · 35122"]);
  const agenda = armarAgenda({ proveedores: [{ id: 5, nombre: "ACERCO S.A.", cuit: "30-1-1", activo: true }] });
  const plan = planImportarPersonas(filas, agenda);
  assert.equal(plan.juntadas, 1);
  assert.equal(plan.nuevas.length, 1);
  assert.deepEqual([plan.nuevas[0].nombre, plan.nuevas[0].alias, plan.nuevas[0].email, plan.nuevas[0].telefono], ["GIRI EZEQUIEL", ["EZEQUIEL GIRI"], "ezequiel@mail.com", "351111"]);
  assert.equal(plan.completar.length, 1, "ACERCO ya es proveedor: se crea su persona con el ID de la hoja");
  assert.equal(plan.completar[0].datos.id_planilla, "3");
});

test("Personas — la agenda junta proveedor y cliente, y propone los parecidos", () => {
  const agenda = armarAgenda({
    personas: [{ id: 1, nombre: "BUGLIOTTI", telefono: "351" }, { id: 2, nombre: "BUGLIOTTI ATILIO" }, { id: 3, nombre: "VIEJO", activo: false }],
    proveedores: [{ id: 10, nombre: "Carpintería del Sur", activo: true }],
    clientes: [{ id: 7, nombre: "CARPINTERIA DEL SUR SRL" }, { id: 8, nombre: "Hotel Norte", alias: ["HOTEL NORTE SA"] }],
  });
  assert.equal(agenda.length, 4);
  const sur = agenda.find((e) => e.proveedor_id === 10);
  assert.equal(sur.cliente_id, 7, "mismo nombre: proveedor y cliente en un renglón");
  assert.deepEqual(opcionesAgenda(agenda).find((o) => o.proveedor_id === 10), { value: "p10", label: "Carpintería del Sur (proveedor y cliente)", nombre: "Carpintería del Sur", proveedor_id: 10 });
  assert.equal(opcionesAgenda(agenda).find((o) => o.nombre === "Hotel Norte").value, "nHotel Norte");
  const rep = posiblesRepetidos(agenda);
  assert.deepEqual(rep.map((r) => [r.a.nombre, r.b.nombre]), [["BUGLIOTTI", "BUGLIOTTI ATILIO"]]);
  assert.deepEqual(datosFaltantes(agenda.find((e) => e.nombre === "BUGLIOTTI")), ["cuit", "email", "direccion"]);
});

test("Personas — validar: CUIT de 11 números y email", () => {
  assert.equal(validarPersona({ nombre: "X", cuit: "30712345678" }).persona.cuit, "30-71234567-8");
  assert.match(validarPersona({ nombre: "X", cuit: "123" }).errores[0], /11 números/);
  assert.match(validarPersona({ nombre: "X", email: "nada" }).errores[0], /email/);
  assert.match(validarPersona({}).errores[0], /nombre/);
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const llamar = async (metodo, body, rol = "gerencial") => api[metodo](new Request("http://localhost/api/finanzas/personas", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ personas = [], proveedores = [], clientes = [] } = {}) {
  const escrito = [];
  const guardar = (tabla) => (u, o) => {
    if (o?.method === "POST" || o?.method === "PATCH") {
      const body = JSON.parse(o.body);
      escrito.push({ tabla, metodo: o.method, url: u, body });
      return { status: 201, body: Array.isArray(body) ? body.map((b, i) => ({ id: 100 + i, ...b })) : [{ id: 99, ...body }] };
    }
    return { status: 200, body: tabla === "fin_personas" ? personas : tabla === "proveedores" ? proveedores : clientes };
  };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_personas"), respond: guardar("fin_personas") },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: guardar("proveedores") },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: guardar("fin_clientes") },
  ]);
  return escrito;
}

test("/api/finanzas/personas — solo el Dueño; importar sin repetir, guardar copia al proveedor, alta de proveedor", async () => {
  let escrito = mockApi({ proveedores: [{ id: 5, nombre: "ACERCO S A", activo: true }] });
  assert.equal((await llamar("GET", null, "administrativo")).status, 403);
  const g = await (await llamar("GET")).json();
  assert.equal(g.agenda.length, 1);

  const texto = "ID\tNOMBRE\tTELEFONO\n1\tGIRI EZEQUIEL\t351\n2\tEZEQUIEL GIRI\t\n3\tACERCO S.A.\t3514";
  const v = await (await llamar("POST", { accion: "importar", texto, ver: true })).json();
  assert.deepEqual([v.resumen.leidas, v.resumen.nuevas, v.resumen.juntadas], [3, 1, 1]);
  assert.equal(escrito.length, 0, "ver no guarda");
  const r = await llamar("POST", { accion: "importar", texto });
  assert.equal(r.status, 200);
  const nuevas = escrito.find((x) => x.tabla === "fin_personas" && Array.isArray(x.body));
  assert.deepEqual(nuevas.body.map((n) => [n.nombre, n.alias]), [["GIRI EZEQUIEL", ["EZEQUIEL GIRI"]]]);
  const acerco = escrito.find((x) => x.tabla === "fin_personas" && !Array.isArray(x.body));
  assert.deepEqual([acerco.body.proveedor_id, acerco.body.telefono, acerco.body.id_planilla], [5, "3514", "3"]);

  escrito = mockApi({ proveedores: [{ id: 5, nombre: "ACERCO S A", activo: true }] });
  const s = await llamar("POST", { accion: "guardar", clave: "p5", persona: { nombre: "ACERCO S A", cuit: "30712345678", email: "ventas@acerco.com" } });
  assert.equal(s.status, 200);
  const prov = escrito.find((x) => x.tabla === "proveedores" && x.metodo === "PATCH");
  assert.deepEqual([prov.body.cuit, prov.body.email], ["30-71234567-8", "ventas@acerco.com"], "se copia al proveedor");
  assert.equal((await llamar("POST", { accion: "guardar", clave: "p5", persona: { nombre: "X", cuit: "1" } })).status, 400);

  escrito = mockApi({ personas: [{ id: 3, nombre: "MARCOS PLOMERO", telefono: "351", activo: true }] });
  const p = await (await llamar("POST", { accion: "proveedor", clave: "a3" })).json();
  assert.equal(p.proveedor_id, 99);
  const alta = escrito.find((x) => x.tabla === "proveedores" && x.metodo === "POST");
  assert.deepEqual([alta.body.nombre, alta.body.whatsapp], ["MARCOS PLOMERO", "351"]);
  assert.ok(escrito.some((x) => x.tabla === "fin_personas" && x.metodo === "PATCH" && x.body.proveedor_id === 99), "la persona queda unida al proveedor");
});

test("/api/finanzas/personas — sin la migración 180 avisa", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/fin_personas"), respond: () => ({ status: 404, body: { code: "42P01", message: 'relation "public.fin_personas" does not exist' } }) },
    { match: () => true, respond: () => ({ status: 200, body: [] }) },
  ]);
  const r = await llamar("GET");
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /migración 180/);
});

// ─── Pantalla ───

test("📇 Personas — busca, filtra lo que falta y guarda la ficha", async () => {
  const enviados = [];
  const datos = {
    agenda: [
      { clave: "p5", nombre: "ACERCO S A", proveedor_id: 5, cliente_id: null, persona_id: null, cuit: "30-71234567-8", telefono: "351", email: "a@a.com", direccion: "X", alias: [] },
      { clave: "a1", nombre: "GIRI EZEQUIEL", proveedor_id: null, cliente_id: null, persona_id: 1, telefono: "351111", alias: ["EZEQUIEL GIRI"] },
    ],
    repetidos: [],
  };
  global.fetch = async (u, o) => {
    if (o?.method === "POST") { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify(datos), { status: 200 });
  };
  render(<FinanzasPersonas />);
  await waitFor(() => assert.ok(screen.getByText("GIRI EZEQUIEL")));
  fireEvent.click(screen.getByText(/^Faltan datos/));
  assert.equal(screen.queryByText("ACERCO S A"), null, "ACERCO tiene todo");
  fireEvent.click(screen.getByText(/^Todos/));
  fireEvent.change(screen.getByLabelText("Buscar persona"), { target: { value: "ezequiel giri" } });
  assert.equal(screen.queryByText("ACERCO S A"), null);
  fireEvent.click(screen.getByText("GIRI EZEQUIEL"));
  fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20-30111222-3" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].clave, enviados[0].persona.cuit], ["guardar", "a1", "20-30111222-3"]);
});
