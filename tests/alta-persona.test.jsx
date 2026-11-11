// tests/alta-persona.test.jsx — "➕ Nuevo" cliente o proveedor sin cambiar de
// pantalla (parte 4 del plan Finanzas e Inventario, 11/11): antes de crear
// nada se busca en la agenda (CUIT o nombre), los parecidos se preguntan, y el
// botón está en Nueva operación, pagos y cheques, Mi caja, Compras y Stock.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { buscarEnAgenda, cuitConGuiones, textoParecido, tieneRol, validarAlta } from "../app/lib/altaPersona.js";
import { armarAgenda } from "../app/lib/finanzasPersonas.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/agenda/route.js");
const { VentanaAltaPersona } = await import("../app/components/AltaPersona.jsx");
const { default: SelectBuscable } = await import("../app/components/ui/SelectBuscable.jsx");
const { ToastProvider } = await import("../app/components/ui/Toast.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const DUENO = "44444444-4444-4444-4444-444444444444";
const JUAN = "22222222-2222-2222-2222-222222222222";

const PROVEEDORES = [
  { id: 1, nombre: "MADERAS CORDOBA SA", cuit: "30-71122233-9", activo: true },
  { id: 2, nombre: "BUGLIOTTI JUAN", cuit: null, activo: true },
];
const CLIENTES = [{ id: 7, nombre: "RIOFRIO IVAN", cuit: null, activo: true }];
const PERSONAS = [{ id: 30, nombre: "GIRI EZEQUIEL", alias: [], cuit: null, proveedor_id: null, cliente_id: null, activo: true }];
const AGENDA = armarAgenda({ personas: PERSONAS, proveedores: PROVEEDORES, clientes: CLIENTES });

// ─── Reglas ───

test("validar — nombre obligatorio, CUIT de 11 números o vacío, y si es proveedor o cliente", () => {
  assert.deepEqual(validarAlta({ nombre: "  Ferretería   Centro ", cuit: "30-71122233-9", rol: "proveedor" }), { errores: [], alta: { nombre: "Ferretería Centro", cuit: "30711222339", rol: "proveedor" } });
  assert.deepEqual(validarAlta({ nombre: "X", rol: "cliente" }).alta.cuit, null);
  const { errores } = validarAlta({ nombre: " ", cuit: "123", rol: "otro" });
  assert.equal(errores.length, 3);
  assert.match(errores.join(" "), /Falta el nombre/);
  assert.match(errores.join(" "), /11 números/);
  assert.equal(cuitConGuiones("30711222339"), "30-71122233-9");
  assert.equal(cuitConGuiones("123"), null);
});

test("buscar — mismo CUIT o mismo nombre escrito distinto es la misma persona; parecidos se preguntan", () => {
  assert.equal(buscarEnAgenda({ nombre: "Otro nombre", cuit: "30711222339" }, AGENDA).igual.proveedor_id, 1, "por CUIT");
  assert.equal(buscarEnAgenda({ nombre: "Maderas Córdoba S.A." }, AGENDA).igual.proveedor_id, 1, "sin tildes ni S.A.");
  const giri = buscarEnAgenda({ nombre: "Ezequiel Giri" }, AGENDA).igual;
  assert.equal(giri.persona_id, 30, "el orden de las palabras no importa");
  assert.equal(tieneRol(giri, "proveedor"), false, "está en la agenda pero no es proveedor");
  const r = buscarEnAgenda({ nombre: "Bugliotti" }, AGENDA);
  assert.equal(r.igual, null);
  assert.deepEqual(r.parecidos.map((p) => p.proveedor_id), [2], "BUGLIOTTI se parece a BUGLIOTTI JUAN");
  assert.equal(textoParecido(r.parecidos[0]), "BUGLIOTTI JUAN (proveedor)");
  assert.deepEqual(buscarEnAgenda({ nombre: "Pinturerías del Sur" }, AGENDA), { igual: null, parecidos: [] });
});

// ─── Servidor ───

async function token(empleadoId, rol) {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (empleadoId, rol, body) => api.POST(new Request("http://localhost/api/agenda", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(empleadoId, rol)}` }, body: JSON.stringify(body),
}));

function mockApi({ cajas = [] } = {}) {
  const escrito = [];
  const tabla = (nombre, filas, idNuevo) => ({
    match: (u) => u.includes(`/rest/v1/${nombre}`),
    respond: (u, o) => {
      if (o?.method === "POST" || o?.method === "PATCH") {
        const body = JSON.parse(o.body);
        escrito.push({ tabla: nombre, metodo: o.method, url: u, body });
        return { status: o.method === "POST" ? 201 : 200, body: [{ id: idNuevo, ...body }] };
      }
      if (u.includes("nombre=ilike.")) {
        const buscado = decodeURIComponent(u.split("nombre=ilike.")[1].split("&")[0]).toLowerCase();
        return { status: 200, body: filas.filter((f) => f.nombre.toLowerCase() === buscado) };
      }
      return { status: 200, body: filas };
    },
  });
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: cajas }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [] }) },
    tabla("fin_personas", PERSONAS, 31),
    tabla("proveedores", PROVEEDORES, 50),
    tabla("fin_clientes", CLIENTES, 60),
  ]);
  return { escrito };
}

test("/api/agenda — un proveedor nuevo se da de alta con el CUIT con guiones", async () => {
  const { escrito } = mockApi();
  const r = await pedir(DUENO, "gerencial", { nombre: "Pinturerías del Sur", cuit: "30711222330", rol: "proveedor" });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.nueva, true);
  assert.deepEqual([d.persona.nombre, d.persona.proveedor_id, d.persona.cliente_id], ["Pinturerías del Sur", 50, null]);
  const alta = escrito.find((x) => x.tabla === "proveedores");
  assert.deepEqual([alta.metodo, alta.body.nombre, alta.body.cuit, alta.body.empresa_id], ["POST", "Pinturerías del Sur", "30-71122233-0", E]);
  assert.equal(Object.keys(d.persona).sort().join(","), "clave,cliente_id,cuit,nombre,proveedor_id", "a la pantalla vuelve solo lo necesario");
});

test("/api/agenda — si ya está (por CUIT o nombre) no se crea otro", async () => {
  const { escrito } = mockApi();
  const r = await pedir(DUENO, "gerencial", { nombre: "Maderas Córdoba S.A.", rol: "proveedor" });
  const d = await r.json();
  assert.deepEqual([d.ya_estaba, d.persona.proveedor_id], [true, 1]);
  assert.equal(escrito.length, 0, "no escribe nada");
});

test("/api/agenda — alguien de la agenda que no era proveedor pasa a serlo y queda anotado en su renglón", async () => {
  const { escrito } = mockApi();
  const d = await (await pedir(DUENO, "gerencial", { nombre: "Ezequiel Giri", rol: "proveedor" })).json();
  assert.deepEqual([d.era_de_agenda, d.persona.proveedor_id, d.persona.nombre], [true, 50, "GIRI EZEQUIEL"]);
  assert.equal(escrito.find((x) => x.tabla === "proveedores").body.nombre, "GIRI EZEQUIEL", "con el nombre de la agenda");
  const p = escrito.find((x) => x.tabla === "fin_personas");
  assert.deepEqual([p.metodo, p.body.proveedor_id], ["PATCH", 50]);
  assert.match(p.url, /id=eq\.30&empresa_id=eq\./);
});

test("/api/agenda — un nombre parecido se pregunta; con 'es otro' se crea y con la clave se usa ese", async () => {
  let { escrito } = mockApi();
  let d = await (await pedir(DUENO, "gerencial", { nombre: "Bugliotti", rol: "proveedor" })).json();
  assert.equal(d.preguntar, true);
  assert.deepEqual(d.parecidos.map((p) => [p.proveedor_id, p.texto]), [[2, "BUGLIOTTI JUAN (proveedor)"]]);
  assert.equal(escrito.length, 0);

  d = await (await pedir(DUENO, "gerencial", { nombre: "Bugliotti", rol: "proveedor", es_otro: true })).json();
  assert.deepEqual([d.nueva, d.persona.proveedor_id], [true, 50]);

  ({ escrito } = mockApi());
  d = await (await pedir(DUENO, "gerencial", { nombre: "Bugliotti", rol: "proveedor", clave: "p2" })).json();
  assert.deepEqual([d.ya_estaba, d.persona.proveedor_id], [true, 2]);
  assert.equal(escrito.length, 0);
});

test("/api/agenda — un cliente nuevo va a la lista de clientes; un cliente que pasa a proveedor queda unido en la agenda", async () => {
  let { escrito } = mockApi();
  let d = await (await pedir(DUENO, "gerencial", { nombre: "Constructora Norte", rol: "cliente" })).json();
  assert.deepEqual([d.persona.cliente_id, d.persona.proveedor_id], [60, null]);
  assert.equal(escrito.find((x) => x.tabla === "fin_clientes").body.nombre, "Constructora Norte");

  ({ escrito } = mockApi());
  d = await (await pedir(DUENO, "gerencial", { nombre: "Riofrío Iván", rol: "proveedor" })).json();
  assert.deepEqual([d.persona.cliente_id, d.persona.proveedor_id], [7, 50]);
  const p = escrito.find((x) => x.tabla === "fin_personas");
  assert.deepEqual([p.metodo, p.body.cliente_id, p.body.proveedor_id], ["POST", 7, 50], "se crea su renglón con los dos");
});

test("/api/agenda — quién puede: administración y quien tiene caja dan de alta proveedores; clientes solo el dueño", async () => {
  mockApi();
  assert.equal((await pedir(JUAN, "administrativo", { nombre: "Pinturerías del Sur", rol: "proveedor" })).status, 200);
  assert.equal((await pedir(JUAN, "administrativo", { nombre: "Constructora Norte", rol: "cliente" })).status, 403);
  assert.equal((await pedir(JUAN, "operativo", { nombre: "Pinturerías del Sur", rol: "proveedor" })).status, 403, "sin caja a cargo, no");
  mockApi({ cajas: [{ cuenta: "01.01.01.001.001.02" }] });
  assert.equal((await pedir(JUAN, "operativo", { nombre: "Pinturerías del Sur", rol: "proveedor" })).status, 200, "con caja a cargo (Mi caja), sí");
  const r = await pedir(DUENO, "gerencial", { nombre: "", rol: "proveedor" });
  assert.deepEqual([r.status, (await r.json()).error], [400, "Falta el nombre."]);
});

test("/api/agenda — sin la migración 180 (no hay hoja PERSONAS) igual da de alta", async () => {
  mockApi();
  const antes = global.fetch;
  global.fetch = async (u, o) => (String(u).includes("/rest/v1/fin_personas")
    ? new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.fin_personas' in the schema cache" }), { status: 404 })
    : antes(u, o));
  const d = await (await pedir(DUENO, "gerencial", { nombre: "Pinturerías del Sur", rol: "proveedor" })).json();
  assert.equal(d.persona.proveedor_id, 50);
});

// ─── Pantalla ───

function mockPantalla(respuestas) {
  const pedidos = [];
  global.fetch = async (u, o) => {
    if (String(u).includes("/api/agenda")) {
      const body = JSON.parse(o.body);
      pedidos.push(body);
      return new Response(JSON.stringify(respuestas(body)), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };
  return pedidos;
}

test("el desplegable buscable — lo que no está se da de alta con ➕ y lo escrito", async () => {
  let pedido = null;
  render(<SelectBuscable aria-label="Proveedor" value="" onChange={() => {}} nuevo={{ etiqueta: "Nuevo proveedor", onElegir: (t) => { pedido = t; } }}>
    <option value="">Elegí</option><option value="1">MADERAS CORDOBA SA</option>
  </SelectBuscable>);
  const caja = screen.getByRole("combobox", { name: "Proveedor" });
  fireEvent.focus(caja);
  fireEvent.change(caja, { target: { value: "Pinturerías" } });
  assert.ok(screen.getByText("No hay coincidencias"));
  fireEvent.mouseDown(screen.getByRole("option", { name: "➕ Nuevo proveedor: «Pinturerías»" }));
  assert.equal(pedido, "Pinturerías");
});

test("la ventana — pregunta por los parecidos y elige el que dice la persona", async () => {
  const pedidos = mockPantalla((b) => (b.clave ? { ok: true, persona: { clave: "p2", nombre: "BUGLIOTTI JUAN", proveedor_id: 2 }, ya_estaba: true }
    : { ok: true, preguntar: true, parecidos: [{ clave: "p2", nombre: "BUGLIOTTI JUAN", proveedor_id: 2, texto: "BUGLIOTTI JUAN (proveedor)" }] }));
  let creada = null;
  let cerrada = false;
  render(<ToastProvider><VentanaAltaPersona abierta nombre="Bugliotti" rol="proveedor" onCerrar={() => { cerrada = true; }} onCreada={(p) => { creada = p; }} /></ToastProvider>);
  assert.equal(screen.getByLabelText("Nombre").value, "Bugliotti", "arranca con lo escrito");
  fireEvent.click(screen.getByRole("button", { name: "Dar de alta" }));
  await waitFor(() => screen.getByText("¿Es alguno de estos?"));
  assert.ok(screen.getByRole("button", { name: "No, es otro: crear Bugliotti" }));
  fireEvent.click(screen.getByRole("button", { name: "Sí, es BUGLIOTTI JUAN (proveedor)" }));
  await waitFor(() => assert.equal(creada?.proveedor_id, 2));
  assert.equal(cerrada, true);
  assert.deepEqual(pedidos.map((p) => p.clave || null), [null, "p2"]);
});

test("la ventana — en Nueva operación elige entre cliente y proveedor", async () => {
  const pedidos = mockPantalla(() => ({ ok: true, nueva: true, persona: { clave: "c60", nombre: "Constructora Norte", cliente_id: 60, proveedor_id: null } }));
  let creada = null;
  render(<ToastProvider><VentanaAltaPersona abierta nombre="" rol="cliente" roles={["cliente", "proveedor"]} onCerrar={() => {}} onCreada={(p, rol) => { creada = [p.cliente_id, rol]; }} /></ToastProvider>);
  assert.ok(screen.getByRole("dialog", { name: "Nuevo cliente o proveedor" }));
  assert.equal(screen.getByRole("button", { name: "Dar de alta" }).disabled, true, "sin nombre no se puede");
  fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Constructora Norte" } });
  fireEvent.click(screen.getByRole("button", { name: "Dar de alta" }));
  await waitFor(() => assert.deepEqual(creada, [60, "cliente"]));
  assert.equal(pedidos[0].rol, "cliente");
});

test("el botón está donde se elige un proveedor o un cliente", () => {
  const leer = (f) => readFileSync(new URL(`../app/components/${f}`, import.meta.url), "utf8");
  assert.match(leer("FinanzasMovimientos.jsx"), /nuevo=\{\{ etiqueta: "Nuevo cliente o proveedor"/, "Nueva operación");
  assert.match(leer("FinanzasElegirProveedor.jsx"), /nuevo=\{\{ etiqueta: "Nuevo proveedor"/, "pagos, cheques y cargar gasto");
  assert.match(leer("MiCaja.jsx"), /BotonNuevaPersona rol="proveedor"/, "Mi caja");
  assert.match(leer("AComprar.jsx"), /OPCION_NUEVA/, "Compras: A comprar");
  assert.equal((leer("OrdenesCompra.jsx").match(/<option value=\{OPCION_NUEVA\}>/g) || []).length, 2, "Compras: otra factura y cotizaciones");
  assert.match(leer("MovimientosStock.jsx"), /BotonNuevaPersona rol="proveedor"/, "Stock: ingreso");
});
