// tests/acta.test.jsx — Órdenes de Producción, parte 11 (ítem 39): acta de
// conformidad de instalación. Descarga de bultos, checklist de instalación,
// pendientes, problemas de obra y la firma del cliente con el dedo.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { estadoActa, htmlActa, CHECKLIST_INSTALACION_FABRICA, NOMBRE_ESTADO_ACTA } from "../app/lib/acta.js";
import { actaBody, configPatchBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { default: ActaOt } = await import("../app/components/ActaOt.jsx");
const { default: CargaOt } = await import("../app/components/CargaOt.jsx");
const { default: ChecklistEditor } = await import("../app/components/ChecklistEditor.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/acta/route.js");
const configApi = await import("../app/api/config-empresa/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const CHECK = ["Puertas reguladas", "Limpieza"];
const FIRMA = `https://test.supabase.co/storage/v1/object/public/reportes-obra/${E}/firma.png`;
const FIRMADA = { firmada_at: "2026-10-13T18:00:00Z", firmada_por: EMP, cliente_nombre: "Ana Pérez", firma_url: FIRMA, instalador: "Juan", checklist: CHECK };

// ─── Cálculo ───

test("estado — instalada, con pendientes, en obra o sin empezar", () => {
  assert.equal(estadoActa({}).estado, "sin_empezar");
  assert.equal(estadoActa({ bultos: [{ numero: 1, descargado: true }] }).estado, "en_obra");
  assert.equal(estadoActa({ acta: FIRMADA }).estado, "instalada");
  const e = estadoActa({ acta: FIRMADA, pendientes: [{ resuelto: false }, { resuelto: true }] });
  assert.equal(e.estado, "con_pendientes");
  assert.equal(e.abiertos, 1);
  assert.equal(NOMBRE_ESTADO_ACTA[e.estado], "⏳ Instalada con pendientes");
  assert.deepEqual(estadoActa({ bultos: [{ numero: 1, descargado: true }, { numero: 2 }, { numero: 3 }] }).noRecibidos, [2, 3]);
});

test("estado — se firma con el checklist completo o con lo que falta anotado como pendiente", () => {
  assert.equal(estadoActa({ acta: { checklist: ["Limpieza"] }, checklist: CHECK }).puedeFirmar, false);
  assert.equal(estadoActa({ acta: { checklist: ["Limpieza"] }, checklist: CHECK, pendientes: [{ descripcion: "Regular puerta" }] }).puedeFirmar, true);
  assert.equal(estadoActa({ acta: { checklist: CHECK }, checklist: CHECK }).puedeFirmar, true);
  assert.equal(estadoActa({ checklist: [] }).puedeFirmar, true, "sin checklist alcanza con la firma");
  assert.equal(estadoActa({ acta: FIRMADA, checklist: CHECK }).puedeFirmar, false, "firmada no se vuelve a firmar");
});

test("acta para imprimir — datos de la obra, bultos que no llegaron, pendientes y firma", () => {
  const html = htmlActa({
    empresa: "GI Amoblamientos",
    proyecto: { ot: "7038", cliente: "Depto <05>", obra: "Torre A" },
    acta: { ...FIRMADA, observaciones: "Cliente conforme" },
    bultos: [{ numero: 1, descargado: true }, { numero: 2, descargado: false }],
    pendientes: [{ descripcion: "Falta un tirador", fecha: "2026-10-20" }],
    checklist: CHECK,
  });
  assert.match(html, /Acta de conformidad de instalación/);
  assert.match(html, /@page \{ size: A4/);
  assert.match(html, /Depto &lt;05&gt;/, "el texto se escapa");
  assert.match(html, /Se recibieron 1 de 2 bultos\. No llegaron: bulto 2\./);
  assert.match(html, /Falta un tirador \(se resuelve el 20\/10\/2026\)/);
  assert.match(html, /con los pendientes que se detallan abajo/);
  assert.match(html, /13\/10\/2026/);
  assert.match(html, new RegExp(`<img src="${FIRMA.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`));
  assert.match(html, /Firma del cliente · Ana Pérez/);
  assert.match(html, /Instalador · Juan/);
  assert.match(html, /Cliente conforme/);
  const sinFirma = htmlActa({ empresa: "", proyecto: { ot: "1" }, acta: { firma_url: "javascript:alert(1)" } });
  assert.doesNotMatch(sinFirma, /<img/, "solo imágenes https");
  assert.match(sinFirma, /Sin pendientes/);
});

test("esquema, permisos y checklist de ejemplo", () => {
  assert.ok(actaBody.safeParse({ accion: "pendiente_agregar", ot: "7038", descripcion: "Tirador", fecha: "2026-10-20" }).success);
  assert.ok(!actaBody.safeParse({ accion: "pendiente_agregar", ot: "7038", descripcion: " " }).success);
  assert.ok(!actaBody.safeParse({ accion: "firmar", ot: "7038", cliente_nombre: "Ana", firma_url: "no-es-url" }).success);
  assert.ok(!actaBody.safeParse({ accion: "firmar", ot: "7038", cliente_nombre: "A", firma_url: FIRMA }).success);
  assert.ok(!actaBody.safeParse({ accion: "descarga", id: 1, valor: true, empresa_id: E }).success);
  assert.ok(configPatchBody.safeParse({ action: "update_checklist_instalacion", items: CHECKLIST_INSTALACION_FABRICA }).success);
  for (const t of ["actas_ot", "pendientes_obra"]) {
    assert.equal(autorizar(t, "GET", { rol: "operativo" }).ok, true, t);
    for (const m of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar(t, m, { rol: "gerencial" }).ok, false, `${t} ${m}`);
  }
});

test("migración 105 — actas y pendientes con RLS por empresa, y la tilde de descarga", () => {
  const sql = readFileSync(new URL("../supabase/migrations/105_acta_instalacion.sql", import.meta.url), "utf8");
  for (const t of ["actas_ot", "pendientes_obra"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t}`));
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`create policy tenant_isolation_auth_${t} on public\\.${t} for all to authenticated`));
    assert.match(sql, new RegExp(`grant usage, select on sequence public\\.${t}_id_seq to authenticated`));
  }
  assert.match(sql, /alter table public\.bultos_ot add column if not exists descargado boolean/);
  assert.match(sql, /unique \(empresa_id, ot\)/);
  assert.match(sql, /grant select, insert, update on public\.actas_ot to authenticated/);
  assert.doesNotMatch(sql, /to anon/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Servidor ───

async function token(rol, empleadoId = EMP) {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 7, rol })).token;
}

function req(body, t) {
  return new Request("http://localhost/api/acta", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
  });
}

function mock({ acta = null, pendientes = [], checklist = [], falla = null } = {}) {
  const escrito = [];
  const tablas = ["/rest/v1/actas_ot", "/rest/v1/pendientes_obra", "/rest/v1/bultos_ot"];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [{ id: 1, ot: "7038" }] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema?"), respond: () => ({ status: 200, body: checklist.length ? [{ valor: { lista: checklist } }] : [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ nombre: "Juan Instalador" }] }) },
    {
      match: (u, o) => tablas.some((t) => u.includes(t)) && (!o?.method || o.method === "GET"),
      respond: (u) => {
        if (falla) return { status: 404, body: { message: falla } };
        if (u.includes("/actas_ot")) return { status: 200, body: acta ? [acta] : [] };
        if (u.includes("/bultos_ot")) return { status: 200, body: [{ id: 1, ot: "7038" }] };
        const id = u.match(/[?&]id=eq\.(\d+)/);
        if (id) return { status: 200, body: pendientes.filter((p) => String(p.id) === id[1]).map((p) => ({ ...p, ot: "7038" })) };
        return { status: 200, body: pendientes };
      },
    },
    {
      match: (u, o) => tablas.some((t) => u.includes(t)) && ["POST", "PATCH", "DELETE"].includes(o?.method),
      respond: (u, o) => {
        const body = o.body ? JSON.parse(o.body) : null;
        escrito.push({ metodo: o.method, url: u, body });
        return { status: 200, body: body ? [body] : [] };
      },
    },
  ]);
  return escrito;
}

test("/api/acta — el instalador tilda los bultos al descargar", async () => {
  const escrito = mock();
  const res = await api.POST(req({ accion: "descarga", id: 1, valor: true }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.match(escrito[0].url, /bultos_ot\?id=eq\.1&empresa_id=eq\./);
  assert.equal(escrito[0].body.descargado, true);
  assert.equal(escrito[0].body.descargado_por, EMP);
});

test("/api/acta — pendientes con fecha; la foto tiene que ser de la app", async () => {
  let escrito = mock();
  let res = await api.POST(req({ accion: "pendiente_agregar", ot: "7038", descripcion: "Falta un tirador", fecha: "2026-10-20" }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito[0].body, { empresa_id: E, ot: "7038", descripcion: "Falta un tirador", fecha: "2026-10-20", foto_url: null, creado_por: EMP });

  escrito = mock();
  res = await api.POST(req({ accion: "pendiente_agregar", ot: "7038", descripcion: "x", foto_url: "https://otro.sitio/a.jpg" }, await token("operativo")));
  assert.equal(res.status, 400);
  assert.equal(escrito.length, 0);
});

test("/api/acta — no se firma con el checklist incompleto, salvo con pendientes anotados", async () => {
  let escrito = mock({ acta: { checklist: ["Limpieza"] }, checklist: CHECK });
  let res = await api.POST(req({ accion: "firmar", ot: "7038", cliente_nombre: "Ana Pérez", firma_url: FIRMA }, await token("operativo")));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Faltan 1 puntos del checklist/);
  assert.equal(escrito.length, 0);

  escrito = mock({ acta: { checklist: ["Limpieza"] }, checklist: CHECK, pendientes: [{ id: 5, resuelto: false }] });
  res = await api.POST(req({ accion: "firmar", ot: "7038", cliente_nombre: "Ana Pérez", firma_url: FIRMA }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.equal(escrito[0].body.cliente_nombre, "Ana Pérez");
  assert.equal(escrito[0].body.firma_url, FIRMA);
  assert.equal(escrito[0].body.firmada_por, EMP);
  assert.equal(escrito[0].body.instalador, "Juan Instalador");
  assert.ok(escrito[0].body.firmada_at);

  escrito = mock();
  res = await api.POST(req({ accion: "firmar", ot: "7038", cliente_nombre: "Ana", firma_url: "https://otro.sitio/firma.png" }, await token("operativo")));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /desde la app/);
});

test("/api/acta — firmada queda cerrada: solo se resuelven pendientes, y gestión la reabre", async () => {
  let escrito = mock({ acta: FIRMADA, pendientes: [{ id: 5, resuelto: false }] });
  let res = await api.POST(req({ accion: "pendiente_agregar", ot: "7038", descripcion: "Otro" }, await token("operativo")));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /reabrirla/);
  res = await api.POST(req({ accion: "descarga", id: 1, valor: false }, await token("operativo")));
  assert.equal(res.status, 409);
  res = await api.POST(req({ accion: "reabrir", ot: "7038" }, await token("operativo")));
  assert.equal(res.status, 403);
  assert.equal(escrito.length, 0);

  res = await api.POST(req({ accion: "pendiente_resolver", id: 5, valor: true }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.deepEqual([escrito[0].body.resuelto, escrito[0].body.resuelto_por], [true, EMP]);

  escrito = mock({ acta: FIRMADA });
  res = await api.POST(req({ accion: "reabrir", ot: "7038" }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.deepEqual([escrito[0].body.firmada_at, escrito[0].body.firma_url], [null, null]);
});

test("/api/acta — sin la migración 105 avisa qué falta", async () => {
  mock({ falla: 'relation "public.actas_ot" does not exist' });
  const res = await api.POST(req({ accion: "checklist", ot: "7038", items: [] }, await token("operativo")));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 105/);
});

test("config-empresa — guarda el checklist de instalación", async () => {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "POST", respond: (u, o) => { escrito.push(JSON.parse(o.body)); return { status: 200, body: [{}] }; } },
  ]);
  const r = new Request("http://localhost/api/config-empresa", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token("gerencial")}` }, body: JSON.stringify({ action: "update_checklist_instalacion", items: CHECK }) });
  const res = await configApi.PATCH(r);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).checklist_instalacion, CHECK);
  assert.equal(escrito[0].clave, "checklist_instalacion");
});

// ─── Pantallas ───

function mockPantalla({ bultos = [], acta = null, pendientes = [], carga = null } = {}) {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/acta")) {
      const body = JSON.parse(opts.body);
      pedidos.push(body);
      if (body.accion === "pendiente_agregar") return new Response(JSON.stringify({ ok: true, pendiente: { id: 70, descripcion: body.descripcion, fecha: body.fecha, resuelto: false } }), { status: 200 });
      if (body.accion === "checklist") return new Response(JSON.stringify({ ok: true, acta: { ...(acta || {}), checklist: body.items } }), { status: 200 });
      if (body.accion === "reabrir") return new Response(JSON.stringify({ ok: true, acta: { ...(acta || {}), firmada_at: null, firma_url: null } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const path = JSON.parse(opts.body).path || "";
    const data = path.startsWith("proyectos") ? [{ ot: "7038", cliente: "Ana Pérez", obra: "Torre A" }]
      : path.startsWith("bultos_ot") ? bultos
      : path.startsWith("actas_ot") ? (acta ? [acta] : [])
      : path.startsWith("pendientes_obra") ? pendientes
      : path.startsWith("cargas_ot") ? (carga ? [carga] : [])
      : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return pedidos;
}

test("pantalla — descarga, checklist y pendientes; sin firma no se puede firmar", async () => {
  const pedidos = mockPantalla({ bultos: [{ id: 1, numero: 1, contenido: "Bajo mesada", descargado: false }, { id: 2, numero: 2, descargado: false }] });
  render(<ActaOt ot="7038" empresaId={E} checklist={CHECK} onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("Bulto 1 de 2")));
  assert.ok(screen.getByText("Bultos 0 de 2 recibidos · Checklist 0 de 2"));
  assert.equal(screen.getByLabelText("Nombre y apellido de quien firma").value, "Ana Pérez", "propone el cliente de la OT");
  assert.equal(screen.getByText("Firmar el acta").disabled, true, "sin trazo no se firma");
  assert.ok(screen.getByText(/Faltan 2 puntos del checklist/));

  fireEvent.click(screen.getByLabelText("Recibido bulto 1"));
  await waitFor(() => assert.equal(screen.getByLabelText("Recibido bulto 1").getAttribute("aria-pressed"), "true"));
  assert.deepEqual(pedidos[0], { accion: "descarga", id: 1, valor: true });

  fireEvent.click(screen.getByLabelText("Limpieza"));
  await waitFor(() => assert.deepEqual(pedidos.at(-1).items, ["Limpieza"]));

  fireEvent.change(screen.getByLabelText("Pendiente nuevo"), { target: { value: "Regular puerta del alacena" } });
  fireEvent.change(screen.getByLabelText("Se resuelve el"), { target: { value: "2026-10-20" } });
  fireEvent.click(screen.getByText("＋ Pendiente"));
  await waitFor(() => assert.ok(screen.getByText("Regular puerta del alacena")));
  assert.deepEqual(pedidos.at(-1), { accion: "pendiente_agregar", ot: "7038", descripcion: "Regular puerta del alacena", fecha: "2026-10-20", foto_url: null });
  await waitFor(() => assert.equal(screen.queryByText(/Faltan 1 puntos del checklist/), null, "con el pendiente anotado ya se puede firmar"));
});

test("pantalla — firmada: estado, PDF, resolver pendientes y gestión reabre", async () => {
  const pedidos = mockPantalla({ acta: FIRMADA, pendientes: [{ id: 5, descripcion: "Falta un tirador", resuelto: false }] });
  render(<ActaOt ot="7038" empresaId={E} checklist={CHECK} esGestion onClose={() => {}} />);
  await waitFor(() => assert.match(screen.getByRole("status").textContent, /Instalada con pendientes: queda 1 pendiente\. Acta firmada por Ana Pérez el 13\/10/));
  assert.ok(screen.getByText("🖨 Imprimir o guardar en PDF"));
  assert.ok(screen.getByAltText("Firma de Ana Pérez"));
  assert.equal(screen.queryByText("Firmar el acta"), null);
  assert.equal(screen.queryByText("＋ Pendiente"), null, "firmada no se agregan pendientes");

  fireEvent.click(screen.getByLabelText("Resuelto: Falta un tirador"));
  await waitFor(() => assert.deepEqual(pedidos.at(-1), { accion: "pendiente_resolver", id: 5, valor: true }));
  await waitFor(() => assert.match(screen.getByRole("status").textContent, /✅ Instalada\./));

  fireEvent.click(screen.getByText("Reabrir el acta para corregirla"));
  fireEvent.click(screen.getByText("Sí, reabrir el acta"));
  await waitFor(() => assert.ok(screen.getByText("Firmar el acta")));
});

test("carga firmada — lleva al acta de instalación", async () => {
  mockPantalla({ bultos: [{ id: 1, numero: 1, cargado: true }], carga: { firma_carga_por: EMP, firma_instalacion_por: "x" } });
  const abiertas = [];
  render(<CargaOt ot="7038" empresaId={E} onClose={() => {}} onAbrirActa={() => abiertas.push(1)} />);
  await waitFor(() => assert.ok(screen.getByText("✍️ Acta de instalación")));
  fireEvent.click(screen.getByText("✍️ Acta de instalación"));
  assert.equal(abiertas.length, 1);
});

test("Configuración → Instalación — usa el checklist de instalación de fábrica", async () => {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    pedidos.push(body);
    return new Response(JSON.stringify({ checklist_instalacion: body.items }), { status: 200 });
  };
  const guardados = [];
  render(<ChecklistEditor tipo="instalacion" items={[]} onGuardado={(l) => guardados.push(l)} />);
  assert.ok(screen.getByText(/antes de que el cliente firme el acta/));
  fireEvent.click(screen.getByText("Usar el checklist de fábrica"));
  fireEvent.click(screen.getByText("Guardar checklist"));
  await waitFor(() => assert.equal(guardados.length, 1));
  assert.equal(pedidos[0].action, "update_checklist_instalacion");
  assert.deepEqual(guardados[0], CHECKLIST_INSTALACION_FABRICA);
});
