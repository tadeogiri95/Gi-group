// tests/carga.test.jsx — Órdenes de Producción, parte 10 (ítem 39): acopio y
// carga. Bultos numerados con rótulo y QR, checklist de carga, faltantes,
// foto y dos firmas: "el camión no sale sin la lista firmada".
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { estadoCarga, htmlRotulos, linkCarga, CHECKLIST_CARGA_FABRICA, TAMANOS_ETIQUETA } from "../app/lib/carga.js";
import { cargaBody, configPatchBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { default: CargaOt } = await import("../app/components/CargaOt.jsx");
const { default: ChecklistEditor } = await import("../app/components/ChecklistEditor.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/carga/route.js");
const configApi = await import("../app/api/config-empresa/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const OTRO = "33333333-3333-3333-3333-333333333333";
const CHECK = ["Caja de herrajes cerrada", "Bultos protegidos"];

// ─── Cálculo ───

test("estado — qué falta para firmar y cuándo se puede firmar igual", () => {
  const bultos = [{ cargado: true }, { cargado: false }];
  let e = estadoCarga({ bultos, sueltos: [{ carga: true }, { carga: false }], carga: { checklist: ["Caja de herrajes cerrada"] }, checklist: CHECK });
  assert.deepEqual(e.pendientes, ["Faltan cargar 1 de 2 bultos", "Faltan tildar 1 sueltos", "Faltan 1 puntos del checklist"]);
  assert.equal(e.puedeFirmar, false);
  e = estadoCarga({ bultos, carga: { faltantes: "Falta la bacha, llega el lunes" }, checklist: CHECK });
  assert.equal(e.puedeFirmar, true, "con el faltante anotado se puede salir");
  assert.equal(e.completa, false);
  e = estadoCarga({ bultos: [{ cargado: true }], carga: { checklist: CHECK, firma_carga_por: EMP }, checklist: CHECK });
  assert.equal(e.completa, true);
  assert.equal(e.empezada, true);
  assert.equal(e.firmada, false);
  assert.equal(estadoCarga({ carga: { faltantes: "todo" } }).puedeFirmar, false, "sin bultos no se firma");
  assert.deepEqual(estadoCarga({}).pendientes, ["No hay bultos armados"]);
});

test("rótulos — uno por bulto, del tamaño del rollo, con QR que abre la carga", async () => {
  const link = linkCarga("https://app.gypi.com.ar/", "gi", "7038");
  assert.equal(link, "https://app.gypi.com.ar/gi?carga=7038");
  const html = await htmlRotulos({
    empresa: "GI Amoblamientos",
    proyecto: { ot: "7038", cliente: "Depto 05 <Cocina>", obra: "Torre A", fecha_entrega: "2026-10-20" },
    bultos: [{ numero: 1, contenido: "1.GB2P + 1.GB3C" }, { numero: 2, contenido: "Caja de herrajes" }, { numero: 3 }],
    link,
    tamano: TAMANOS_ETIQUETA[0],
  });
  assert.match(html, /@page \{ size: 100mm 50mm; margin: 0; \}/);
  assert.equal(html.match(/class="rotulo"/g).length, 3);
  assert.match(html, /Bulto 2 de 3/);
  assert.match(html, /Caja de herrajes/);
  assert.match(html, /Entrega 20\/10\/2026/);
  assert.match(html, /Depto 05 &lt;Cocina&gt;/, "el texto se escapa");
  assert.match(html, /<svg/);
});

test("esquema, permisos y checklist de ejemplo", () => {
  assert.ok(cargaBody.safeParse({ accion: "bulto_agregar", ot: "7038", contenido: "Módulos" }).success);
  assert.ok(cargaBody.safeParse({ accion: "faltantes", ot: "7038", texto: "Bacha", fecha: "2026-10-20" }).success);
  assert.ok(!cargaBody.safeParse({ accion: "faltantes", ot: "7038", texto: "Bacha", fecha: "20/10/2026" }).success);
  assert.ok(!cargaBody.safeParse({ accion: "firmar", ot: "7038", rol: "cliente" }).success);
  assert.ok(!cargaBody.safeParse({ accion: "bulto_tildar", id: 1, valor: true, empresa_id: E }).success);
  assert.ok(configPatchBody.safeParse({ action: "update_checklist_carga", items: CHECKLIST_CARGA_FABRICA }).success);
  for (const t of ["bultos_ot", "cargas_ot"]) {
    assert.equal(autorizar(t, "GET", { rol: "operativo" }).ok, true, t);
    for (const m of ["POST", "PATCH", "DELETE"]) assert.equal(autorizar(t, m, { rol: "gerencial" }).ok, false, `${t} ${m}`);
  }
});

test("migración 104 — bultos y cargas con RLS por empresa", () => {
  const sql = readFileSync(new URL("../supabase/migrations/104_acopio_carga.sql", import.meta.url), "utf8");
  for (const t of ["bultos_ot", "cargas_ot"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t}`));
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`create policy tenant_isolation_auth_${t} on public\\.${t} for all to authenticated`));
    assert.match(sql, new RegExp(`grant usage, select on sequence public\\.${t}_id_seq to authenticated`));
  }
  assert.match(sql, /unique \(empresa_id, ot, numero\)/);
  assert.match(sql, /unique \(empresa_id, ot\)/);
  assert.match(sql, /grant select, insert, update, delete on public\.bultos_ot to authenticated/);
  assert.match(sql, /grant select, insert, update on public\.cargas_ot to authenticated/);
  assert.doesNotMatch(sql, /to anon/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Servidor ───

async function token(rol, empleadoId = EMP) {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 7, rol })).token;
}

function req(body, t) {
  return new Request("http://localhost/api/carga", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
  });
}

function mock({ carga = null, bultos = [{ id: 1, ot: "7038", numero: 1, cargado: true }], sueltos = [], checklist = [], falla = null } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [{ id: 1, ot: "7038" }] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema?"), respond: () => ({ status: 200, body: checklist.length ? [{ valor: { lista: checklist } }] : [] }) },
    { match: (u, o) => u.includes("/rest/v1/sueltos_ot") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: sueltos }) },
    {
      match: (u, o) => (u.includes("/rest/v1/bultos_ot") || u.includes("/rest/v1/cargas_ot")) && (!o?.method || o.method === "GET"),
      respond: (u) => {
        if (falla) return { status: 404, body: { message: falla } };
        if (u.includes("/cargas_ot")) return { status: 200, body: carga ? [carga] : [] };
        const id = u.match(/[?&]id=eq\.(\d+)/);
        if (id) return { status: 200, body: bultos.filter((b) => String(b.id) === id[1]) };
        if (u.includes("order=numero.desc")) return { status: 200, body: bultos.length ? [{ numero: Math.max(...bultos.map((b) => b.numero)) }] : [] };
        const gt = u.match(/numero=gt\.(\d+)/);
        if (gt) return { status: 200, body: bultos.filter((b) => b.numero > Number(gt[1])) };
        return { status: 200, body: bultos };
      },
    },
    {
      match: (u, o) => (u.includes("/rest/v1/bultos_ot") || u.includes("/rest/v1/cargas_ot")) && ["POST", "PATCH", "DELETE"].includes(o?.method),
      respond: (u, o) => {
        const body = o.body ? JSON.parse(o.body) : null;
        escrito.push({ metodo: o.method, url: u, body });
        return { status: 200, body: body ? [body] : [] };
      },
    },
  ]);
  return escrito;
}

test("/api/carga — el operario arma los bultos: el número sigue al último", async () => {
  const escrito = mock({ bultos: [{ id: 1, ot: "7038", numero: 1 }, { id: 2, ot: "7038", numero: 2 }] });
  const res = await api.POST(req({ accion: "bulto_agregar", ot: "7038", contenido: "Caja de herrajes" }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito[0].body, { empresa_id: E, ot: "7038", numero: 3, contenido: "Caja de herrajes", creado_por: EMP });
});

test("/api/carga — sacar un bulto corre los que siguen para que no queden huecos", async () => {
  const escrito = mock({ bultos: [{ id: 1, ot: "7038", numero: 1 }, { id: 2, ot: "7038", numero: 2 }, { id: 3, ot: "7038", numero: 3 }] });
  const res = await api.POST(req({ accion: "bulto_borrar", id: 1 }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "DELETE");
  assert.deepEqual(escrito.slice(1).map((w) => [w.url.match(/[?&]id=eq\.(\d+)/)[1], w.body.numero]), [["2", 1], ["3", 2]]);
});

test("/api/carga — no se firma con cosas pendientes, salvo con el faltante anotado", async () => {
  let escrito = mock({ bultos: [{ cargado: true }, { cargado: false }], checklist: CHECK });
  let res = await api.POST(req({ accion: "firmar", ot: "7038", rol: "carga" }, await token("operativo")));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Faltan cargar 1 de 2 bultos/);
  assert.equal(escrito.length, 0);

  escrito = mock({ bultos: [{ cargado: true }, { cargado: false }], checklist: CHECK, carga: { faltantes: "Falta un bulto, sale el lunes" } });
  res = await api.POST(req({ accion: "firmar", ot: "7038", rol: "carga" }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.equal(escrito[0].body.firma_carga_por, EMP);
  assert.ok(escrito[0].body.firma_carga_at);

  escrito = mock({ bultos: [{ cargado: true }] });
  res = await api.POST(req({ accion: "firmar", ot: "7038", rol: "instalacion" }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "POST", "primera vez: se crea la fila de la carga");
  assert.equal(escrito[0].body.firma_instalacion_por, EMP);
});

test("/api/carga — dos personas distintas; una firma cierra la lista hasta que gestión la deshace", async () => {
  const firmada = { firma_carga_por: EMP, firma_carga_at: "2026-10-13T12:00:00Z" };
  let escrito = mock({ carga: firmada });
  let res = await api.POST(req({ accion: "firmar", ot: "7038", rol: "instalacion" }, await token("operativo")));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /personas distintas/);
  res = await api.POST(req({ accion: "firmar", ot: "7038", rol: "carga" }, await token("operativo", OTRO)));
  assert.equal(res.status, 409, "esa firma ya está");
  res = await api.POST(req({ accion: "bulto_tildar", id: 1, valor: false }, await token("operativo", OTRO)));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /deshacer las firmas/);
  res = await api.POST(req({ accion: "desfirmar", ot: "7038" }, await token("operativo")));
  assert.equal(res.status, 403);
  assert.equal(escrito.length, 0);

  res = await api.POST(req({ accion: "firmar", ot: "7038", rol: "instalacion" }, await token("operativo", OTRO)));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].body.firma_instalacion_por, OTRO);

  escrito = mock({ carga: firmada });
  res = await api.POST(req({ accion: "desfirmar", ot: "7038" }, await token("administrativo")));
  assert.equal(res.status, 200);
  assert.deepEqual([escrito[0].body.firma_carga_por, escrito[0].body.firma_instalacion_por], [null, null]);
});

test("/api/carga — checklist, faltantes y foto; la foto tiene que ser de la app", async () => {
  let escrito = mock();
  let res = await api.POST(req({ accion: "checklist", ot: "7038", items: ["Bultos protegidos", "Bultos protegidos", " "] .filter((x) => x.trim()) }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito[0].body.checklist, ["Bultos protegidos"]);

  escrito = mock();
  res = await api.POST(req({ accion: "faltantes", ot: "7038", texto: null, fecha: "2026-10-20" }, await token("operativo")));
  assert.equal(escrito[0].body.faltantes_fecha, null, "sin faltante no queda fecha");

  escrito = mock();
  res = await api.POST(req({ accion: "foto", ot: "7038", url: "https://otro.sitio/foto.jpg" }, await token("operativo")));
  assert.equal(res.status, 400);
  assert.equal(escrito.length, 0);
  res = await api.POST(req({ accion: "foto", ot: "7038", url: `https://test.supabase.co/storage/v1/object/public/reportes-obra/${E}/a.jpg` }, await token("operativo")));
  assert.equal(res.status, 200);
});

test("/api/carga — sin la migración 104 avisa qué falta", async () => {
  mock({ falla: 'relation "public.cargas_ot" does not exist' });
  const res = await api.POST(req({ accion: "checklist", ot: "7038", items: [] }, await token("operativo")));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 104/);
});

test("config-empresa — guarda el checklist de carga", async () => {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "POST", respond: (u, o) => { escrito.push(JSON.parse(o.body)); return { status: 200, body: [{}] }; } },
  ]);
  const r = new Request("http://localhost/api/config-empresa", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token("gerencial")}` }, body: JSON.stringify({ action: "update_checklist_carga", items: CHECK }) });
  const res = await configApi.PATCH(r);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).checklist_carga, CHECK);
  assert.equal(escrito[0].clave, "checklist_carga");
});

// ─── Pantallas ───

function mockPantalla({ bultos = [], sueltos = [], carga = null } = {}) {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/carga") || u.includes("/api/sueltos")) {
      const body = JSON.parse(opts.body);
      pedidos.push({ url: u, ...body });
      if (body.accion === "bulto_agregar") return new Response(JSON.stringify({ ok: true, bulto: { id: 50, numero: bultos.length + 1, contenido: body.contenido, cargado: false } }), { status: 200 });
      if (body.accion === "checklist") return new Response(JSON.stringify({ ok: true, carga: { ...(carga || {}), checklist: body.items } }), { status: 200 });
      if (body.accion === "firmar") return new Response(JSON.stringify({ ok: true, carga: { ...(carga || {}), [`firma_${body.rol}_por`]: EMP, [`firma_${body.rol}_at`]: "2026-10-13T15:00:00Z" } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const path = JSON.parse(opts.body).path || "";
    const data = path.startsWith("proyectos") ? [{ ot: "7038", cliente: "Depto 05", total_modulos: 4 }]
      : path.startsWith("bultos_ot") ? bultos
      : path.startsWith("sueltos_ot") ? sueltos
      : path.startsWith("cargas_ot") ? (carga ? [carga] : [])
      : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return pedidos;
}

test("pantalla — arma los bultos, tilda al cargar y no deja firmar con pendientes", async () => {
  const pedidos = mockPantalla({ bultos: [{ id: 1, numero: 1, contenido: "Módulos bajos", cargado: false }], sueltos: [{ id: 9, codigo: "AJ.1", descripcion: "Ajuste", cantidad: 1, carga: false }] });
  render(<CargaOt ot="7038" empresaId={E} checklist={CHECK} onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("Bulto 1 de 1")));
  assert.ok(screen.getByText(/La OT tiene 4 módulos/));
  assert.ok(screen.getByText("Bultos 0 de 1 cargados · Sueltos 0 de 1 · Checklist 0 de 2"));
  assert.ok(screen.getAllByText("Firmar").every((b) => b.disabled));
  assert.ok(screen.getByText(/Para firmar: Faltan cargar 1 de 1 bultos/));

  fireEvent.change(screen.getByLabelText("Contenido del bulto nuevo"), { target: { value: "Caja de herrajes" } });
  fireEvent.click(screen.getByText("＋ Bulto"));
  await waitFor(() => assert.ok(screen.getByText("Bulto 2 de 2")));
  assert.deepEqual(pedidos[0], { url: "/api/carga", accion: "bulto_agregar", ot: "7038", contenido: "Caja de herrajes" });

  fireEvent.click(screen.getByLabelText("Cargado bulto 1"));
  await waitFor(() => assert.equal(screen.getByLabelText("Cargado bulto 1").getAttribute("aria-pressed"), "true"));
  fireEvent.click(screen.getByLabelText("Cargado AJ.1 · Ajuste"));
  await waitFor(() => assert.equal(pedidos.at(-1).url, "/api/sueltos"));
  assert.deepEqual(pedidos.at(-1).columna, "carga");
  fireEvent.click(screen.getByLabelText("Caja de herrajes cerrada"));
  await waitFor(() => assert.deepEqual(pedidos.at(-1).items, ["Caja de herrajes cerrada"]));
});

test("pantalla — con todo cargado se firma; firmada, gestión puede deshacer", async () => {
  mockPantalla({ bultos: [{ id: 1, numero: 1, cargado: true }], carga: { checklist: CHECK } });
  const { unmount } = render(<CargaOt ot="7038" empresaId={E} checklist={CHECK} usuario={{ id: EMP }} onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("Quien carga")));
  const [firmarCarga] = screen.getAllByText("Firmar");
  assert.equal(firmarCarga.disabled, false);
  fireEvent.click(firmarCarga);
  await waitFor(() => assert.match(screen.getByText(/Firmado .* \(vos\)/).textContent, /13\/10/));
  assert.ok(screen.getByText(/Falta la otra firma/));
  assert.equal(screen.queryAllByText("＋ Bulto").length, 0, "con una firma la lista queda cerrada");
  unmount();

  mockPantalla({ bultos: [{ id: 1, numero: 1, cargado: true }], carga: { checklist: CHECK, firma_carga_por: EMP, firma_instalacion_por: OTRO } });
  render(<CargaOt ot="7038" empresaId={E} checklist={CHECK} esGestion onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("🚚 Carga completa y firmada.")));
  assert.ok(screen.getByText("Deshacer las firmas para corregir la carga"));
});

test("Configuración → Carga — usa el checklist de carga de fábrica", async () => {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    pedidos.push(body);
    return new Response(JSON.stringify({ checklist_carga: body.items }), { status: 200 });
  };
  const guardados = [];
  render(<ChecklistEditor tipo="carga" items={[]} onGuardado={(l) => guardados.push(l)} />);
  assert.ok(screen.getByText(/antes de que salga el camión/));
  fireEvent.click(screen.getByText("Usar el checklist de fábrica"));
  fireEvent.click(screen.getByText("Guardar checklist"));
  await waitFor(() => assert.equal(guardados.length, 1));
  assert.equal(pedidos[0].action, "update_checklist_carga");
  assert.deepEqual(guardados[0], CHECKLIST_CARGA_FABRICA);
});
