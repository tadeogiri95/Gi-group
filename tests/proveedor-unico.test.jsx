// tests/proveedor-unico.test.jsx — Una sola lista de proveedores (auditoría
// del 12/11, parte 5; migración 183): no se carga otro con el mismo CUIT o
// nombre, se pregunta por los parecidos, los repetidos se unen con todo lo
// suyo y el taller de Flota y Maquinaria sale de la lista.
import "./helpers/domSetup.js";
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  proveedorRepetido, sugerirUniones, cualQueda, moverCuentaProveedor, moverParProveedor, tallerElegido, datosAgendaDeProveedor, datosAgendaDeCliente,
} from "../app/lib/proveedoresUnicos.js";
import { proveedorDeTexto } from "../app/components/ElegirTaller.jsx";
import { comprasBody } from "../app/lib/schemas.ts";
import { _limpiarCacheAlcance } from "../app/lib/alcance.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
beforeEach(() => _limpiarCacheAlcance());
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/compras/route.js");
const { default: ProveedoresCompras } = await import("../app/components/ProveedoresCompras.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

const MADERAS = { id: 3, nombre: "MADERAS CORDOBA SA", cuit: "30-71122233-9", contacto: "Raúl", activo: true, unido_a: null };
const MADERAS_2 = { id: 8, nombre: "Maderas Córdoba S.A.", cuit: null, activo: true, unido_a: null };
const BUGLIOTTI = { id: 5, nombre: "BUGLIOTTI JUAN", cuit: null, activo: true, unido_a: null };
const EGGER = { id: 6, nombre: "Egger", cuit: "30-55555555-5", activo: true, unido_a: null };

// ─── Reglas ───

test("repetido — mismo CUIT o el mismo nombre escrito distinto; parecidos aparte; el propio no cuenta", () => {
  const lista = [MADERAS, BUGLIOTTI, EGGER];
  assert.equal(proveedorRepetido({ nombre: "Otro nombre", cuit: "30711222339" }, lista).igual.id, 3, "mismo CUIT");
  assert.equal(proveedorRepetido({ nombre: "Maderas Córdoba S.A." }, lista).igual.id, 3, "sin tildes, puntos ni S.A.");
  const r = proveedorRepetido({ nombre: "Bugliotti" }, lista);
  assert.equal(r.igual, null);
  assert.deepEqual(r.parecidos.map((p) => p.id), [5]);
  assert.equal(proveedorRepetido({ nombre: "MADERAS CORDOBA SA", cuit: "30-71122233-9" }, lista, 3).igual, null, "al corregirse a sí mismo no es repetido");
  assert.equal(proveedorRepetido({ nombre: "MADERAS CORDOBA SA" }, [{ ...MADERAS, unido_a: 9 }]).igual, null, "el ya unido no cuenta");
});

test("sugerir uniones — por CUIT y por nombre; dos CUIT distintos no; queda el que tiene más datos", () => {
  const s = sugerirUniones([MADERAS, MADERAS_2, BUGLIOTTI, EGGER, { id: 7, nombre: "EGGER", cuit: "30-55555555-5", activo: true }]);
  assert.deepEqual(s.map((x) => [x.queda.id, x.sale.id, x.por]), [[6, 7, "cuit"], [3, 8, "nombre"]]);
  assert.deepEqual(sugerirUniones([MADERAS, { ...MADERAS_2, cuit: "20-11111111-1" }]), [], "dos CUIT distintos: son dos");
  assert.deepEqual(sugerirUniones([MADERAS, { ...MADERAS_2, unido_a: 3 }]), []);
  const [queda] = cualQueda({ id: 1, nombre: "A", activo: false, cuit: "1" }, { id: 2, nombre: "A", activo: true });
  assert.equal(queda.id, 2, "el activo queda");
});

test("config al unir — la cuenta del repetido pasa si el que queda no tiene; el par cliente-proveedor también", () => {
  assert.deepEqual(moverCuentaProveedor({ p8: "04.01", p1: "04.02" }, 3, 8), { p1: "04.02", p3: "04.01" });
  assert.deepEqual(moverCuentaProveedor({ p8: "04.01", p3: "04.09" }, 3, 8), { p3: "04.09" });
  assert.deepEqual(moverParProveedor([{ cliente_id: 1, proveedor_id: 8 }], 3, 8), [{ cliente_id: 1, proveedor_id: 3 }]);
  assert.deepEqual(moverParProveedor([{ cliente_id: 1, proveedor_id: 8 }, { cliente_id: 2, proveedor_id: 3 }], 3, 8), [{ cliente_id: 2, proveedor_id: 3 }]);
});

test("taller y agenda — de la lista con su nombre, o el texto; la agenda recibe CUIT, mail, teléfono y contacto", () => {
  assert.deepEqual(tallerElegido({ proveedor_id: 3, taller: "maderas" }, [MADERAS]), { proveedor_id: 3, taller: "MADERAS CORDOBA SA" });
  assert.deepEqual(tallerElegido({ proveedor_id: 99 }, [MADERAS]), { error: "Ese taller no está en la lista de proveedores" });
  assert.deepEqual(tallerElegido({ taller: "  Gomería   Sur " }), { proveedor_id: null, taller: "Gomería Sur" });
  assert.equal(proveedorDeTexto("maderas córdoba", [MADERAS]).id, 3);
  assert.equal(proveedorDeTexto("Maderas", [MADERAS]), null);
  assert.deepEqual(datosAgendaDeProveedor({ cuit: "30-1", whatsapp: "351 555", email: "a@b.c", contacto: null }), { cuit: "30-1", email: "a@b.c", telefono: "351 555" });
  assert.deepEqual(datosAgendaDeCliente({ cuit: null, telefono: "351", email: null }), { telefono: "351" });
});

test("esquema — es_otro y unir dos distintos", () => {
  const ok = (b) => comprasBody.safeParse(b).success;
  assert.equal(ok({ accion: "proveedor_guardar", nombre: "Aluar", es_otro: true }), true);
  assert.equal(ok({ accion: "proveedores_unir", queda: 3, sale: 8 }), true);
  assert.equal(ok({ accion: "proveedores_unir", queda: 3, sale: 3 }), false);
});

// ─── /api/compras ───

function mockRuta({ proveedores = [MADERAS, BUGLIOTTI], rpc = { ok: true, movidos: 4 }, sinRpc = false, config = {} } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ id: EMP, legajo: 7 }] }) },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/rpc/compras_unir_proveedores"),
      respond: (u, o) => {
        escrito.push({ tabla: "rpc", body: JSON.parse(o.body) });
        return sinRpc ? { status: 404, body: { code: "PGRST202", message: "Could not find the function public.compras_unir_proveedores" } } : { status: 200, body: rpc };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o.method === "PATCH") { escrito.push({ tabla: "config_sistema", url: u, body: JSON.parse(o.body) }); return { status: 200, body: [] }; }
        const clave = /clave=eq\.([a-z_]+)/.exec(u)?.[1];
        return { status: 200, body: config[clave] ? [{ valor: config[clave] }] : [] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_personas"),
      respond: (u, o) => { escrito.push({ tabla: "fin_personas", url: u, body: JSON.parse(o.body) }); return { status: 200, body: [] }; },
    },
    {
      match: (u) => u.includes("/rest/v1/proveedores"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: proveedores };
        const body = JSON.parse(o.body);
        escrito.push({ tabla: "proveedores", metodo: o.method, url: u, body });
        return { status: 201, body: [{ id: 9, ...body }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body, q = "") => new Request(`http://localhost/api/compras${q}`, {
  method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

test("/api/compras — no deja cargar el mismo proveedor; pregunta por el parecido; es_otro sigue", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token("gerencial"), { accion: "proveedor_guardar", nombre: "Maderas Córdoba S.A." }));
  assert.equal(res.status, 409);
  let d = await res.json();
  assert.equal(d.tipo, "repetido");
  assert.equal(d.igual.id, 3);
  assert.match(d.error, /Ya está MADERAS CORDOBA SA con ese nombre/);

  res = await api.POST(req(await token("gerencial"), { accion: "proveedor_guardar", nombre: "Otra SRL", cuit: "30711222339" }));
  assert.match((await res.json()).error, /con el CUIT 30-71122233-9/);

  res = await api.POST(req(await token("gerencial"), { accion: "proveedor_guardar", nombre: "Bugliotti" }));
  assert.equal(res.status, 409);
  d = await res.json();
  assert.equal(d.tipo, "parecidos");
  assert.deepEqual(d.parecidos, [{ id: 5, nombre: "BUGLIOTTI JUAN", cuit: null, activo: true }]);
  assert.equal(escrito.length, 0);

  res = await api.POST(req(await token("gerencial"), { accion: "proveedor_guardar", nombre: "Bugliotti", es_otro: true }));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "POST");
  assert.equal("es_otro" in escrito[0].body, false);
});

test("/api/compras — corregir un proveedor también corrige la agenda", async () => {
  const escrito = mockRuta();
  const res = await api.POST(req(await token("administrativo"), { accion: "proveedor_guardar", id: 3, nombre: "MADERAS CORDOBA SA", cuit: "30711222339", whatsapp: "351 555 1234", email: "ventas@maderas.com" }));
  assert.equal(res.status, 200);
  const ag = escrito.find((x) => x.tabla === "fin_personas");
  assert.match(ag.url, /fin_personas\?empresa_id=eq\..*&proveedor_id=eq\.9/);
  assert.deepEqual([ag.body.cuit, ag.body.telefono, ag.body.email], ["30-71122233-9", "351 555 1234", "ventas@maderas.com"]);
});

test("/api/compras — unir: la base mueve todo y se acomodan la cuenta y el par; solo Dueño o Supervisor", async () => {
  let escrito = mockRuta({
    config: {
      finanzas_cuentas_proveedores: { cuentas: { p8: "04.02.01.001.003" } },
      finanzas_cliente_proveedor: { pares: [{ cliente_id: 1, proveedor_id: 8 }] },
    },
  });
  let res = await api.POST(req(await token("gerencial"), { accion: "proveedores_unir", queda: 3, sale: 8 }));
  assert.deepEqual(await res.json(), { ok: true, movidos: 4 });
  assert.deepEqual(escrito[0], { tabla: "rpc", body: { p_empresa: E, p_queda: 3, p_sale: 8 } });
  const cfg = escrito.filter((x) => x.tabla === "config_sistema");
  assert.deepEqual(cfg[0].body.valor.cuentas, { p3: "04.02.01.001.003" });
  assert.deepEqual(cfg[1].body.valor.pares, [{ cliente_id: 1, proveedor_id: 3 }]);

  escrito = mockRuta();
  res = await api.POST(req(await token("administrativo"), { accion: "proveedores_unir", queda: 3, sale: 8 }));
  assert.equal(res.status, 403, "Administración compra pero no une");
  assert.equal(escrito.length, 0);

  mockRuta({ rpc: { ok: false, tipo: "ya_unido" } });
  res = await api.POST(req(await token("gerencial"), { accion: "proveedores_unir", queda: 3, sale: 8 }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /ya está unido/);

  mockRuta({ sinRpc: true });
  res = await api.POST(req(await token("gerencial"), { accion: "proveedores_unir", queda: 3, sale: 8 }));
  assert.match((await res.json()).error, /migración 183/);
});

test("/api/compras GET ?repetidos — las sugerencias y si puede unir", async () => {
  mockRuta({ proveedores: [MADERAS, MADERAS_2, EGGER] });
  let d = await (await api.GET(req(await token("gerencial"), null, "?repetidos=1"))).json();
  assert.deepEqual(d.repetidos.map((x) => [x.queda.id, x.sale.id]), [[3, 8]]);
  assert.equal(d.puede_unir, true);
  d = await (await api.GET(req(await token("administrativo"), null, "?repetidos=1"))).json();
  assert.equal(d.puede_unir, false);
  assert.equal((await api.GET(req(await token("operativo"), null, "?repetidos=1"))).status, 403);
});

// ─── Pantalla ───

function mockPantalla({ proveedores = [MADERAS, MADERAS_2], parecidos = null, puedeUnir = true } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/compras?repetidos")) {
      return new Response(JSON.stringify({ ok: true, repetidos: sugerirUniones(proveedores), puede_unir: puedeUnir }), { status: 200 });
    }
    if (String(url).includes("/api/compras")) {
      enviados.push(body);
      if (body.accion === "proveedor_guardar" && parecidos && !body.es_otro) {
        return new Response(JSON.stringify({ error: "Hay proveedores con un nombre parecido", tipo: "parecidos", parecidos }), { status: 409 });
      }
      return new Response(JSON.stringify({ ok: true, movidos: 4 }), { status: 200 });
    }
    if (body?.path?.startsWith("proveedores")) return new Response(JSON.stringify({ data: proveedores }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return { enviados };
}

test("proveedores — un parecido pregunta: 'Sí, es …' lleva a ese; 'No, es otro' guarda", async () => {
  const { enviados } = mockPantalla({ proveedores: [BUGLIOTTI], parecidos: [{ id: 5, nombre: "BUGLIOTTI JUAN", cuit: null, activo: true }] });
  render(<ProveedoresCompras empresaId={E} />);
  await screen.findByText("BUGLIOTTI JUAN");
  fireEvent.click(screen.getByText("＋ Nuevo proveedor"));
  fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Bugliotti" } });
  fireEvent.click(screen.getByText("Guardar"));
  assert.ok(await screen.findByText("¿Es alguno de estos?"));
  fireEvent.click(screen.getByText("No, es otro proveedor: guardar"));
  await waitFor(() => assert.equal(enviados.length, 2));
  assert.equal(enviados[1].es_otro, true);

  cleanup();
  mockPantalla({ proveedores: [BUGLIOTTI], parecidos: [{ id: 5, nombre: "BUGLIOTTI JUAN", cuit: null, activo: true }] });
  render(<ProveedoresCompras empresaId={E} />);
  await screen.findByText("BUGLIOTTI JUAN");
  fireEvent.click(screen.getByText("＋ Nuevo proveedor"));
  fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Bugliotti" } });
  fireEvent.click(screen.getByText("Guardar"));
  fireEvent.click(await screen.findByText("Sí, es BUGLIOTTI JUAN"));
  assert.equal(screen.getByLabelText("Buscar proveedor").value, "BUGLIOTTI JUAN", "vuelve a la lista buscando ese");
});

test("proveedores — los repetidos se ven arriba y se unen eligiendo cuál queda", async () => {
  const { enviados } = mockPantalla();
  render(<ProveedoresCompras empresaId={E} />);
  fireEvent.click(await screen.findByText(/1 proveedor parece repetido/));
  assert.ok(screen.getByText("Mismo nombre"));
  fireEvent.click(screen.getByText("Queda Maderas Córdoba S.A."));
  assert.match(document.querySelector("li [role=alert]").textContent, /Queda Maderas Córdoba S\.A\.\. MADERAS CORDOBA SA se da de baja.*No se puede deshacer/);
  fireEvent.click(screen.getByText("Unir"));
  await waitFor(() => assert.deepEqual(enviados[0], { accion: "proveedores_unir", queda: 8, sale: 3 }));
  assert.ok(await screen.findByText(/Uní MADERAS CORDOBA SA a Maderas Córdoba S.A. \(pasaron 4 registros\)/));

  cleanup();
  mockPantalla({ puedeUnir: false });
  render(<ProveedoresCompras empresaId={E} />);
  fireEvent.click(await screen.findByText(/1 proveedor parece repetido/));
  assert.ok(screen.getByText("Los une el Dueño o el Supervisor."));
  assert.equal(screen.queryByText("Unir"), null);
});

test("migración 183 — columnas, función con service_role y todo lo que mueve", () => {
  const sql = readFileSync(new URL("../supabase/migrations/183_proveedor_unico.sql", import.meta.url), "utf8");
  for (const t of ["proveedores add column if not exists unido_a", "vehiculo_mantenimientos add column if not exists proveedor_id", "maquina_fallas add column if not exists proveedor_id"]) assert.ok(sql.includes(t), t);
  for (const t of ["ordenes_compra ", "ordenes_compra_facturas", "facturas_sueltas", "fin_operaciones", "fin_cheques", "fin_ordenes_pago", "ordenes_compra_cotizaciones", "fin_personas"]) assert.ok(sql.includes(`update ${t}`), t);
  assert.match(sql, /security definer/);
  assert.match(sql, /grant execute on function public\.compras_unir_proveedores\(uuid, bigint, bigint\) to service_role/);
  assert.match(sql, /pg_advisory_xact_lock/);
});
