// tests/minutas.test.jsx — Minuta de la reunión de Buenos Días (Minuta, parte
// M1; migración 150): secciones del formato v2, renglones elegidos de las OT
// y guardados como dato, regla de los pendientes de instalación (sin
// responsable y fecha no se registran), solo Dueño / Gerencia, e impresión.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  SECCIONES, BLOQUES, datosDeOt, duracionMinutos, faltantesMinuta, htmlMinuta, participantesDe, renglonNuevo, renglonesParaGuardar,
} from "../app/lib/minutas.js";
import { minutasBody } from "../app/lib/schemas.ts";
import { modulosEfectivos } from "../app/lib/modulos.js";
import { opcionesBoton } from "../app/lib/menuGestion.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/minutas/route.js");
const { default: MinutaScreen } = await import("../app/components/MinutaScreen.jsx");
const { ToastProvider } = await import("../app/components/ui/Toast.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const pantalla = () => render(
  <AuthContext.Provider value={{ divisiones: [{ id: "d-muebles", label: "Muebles" }] }}>
    <ToastProvider><MinutaScreen empresa={{ nombre: "Acme" }} /></ToastProvider>
  </AuthContext.Provider>
);

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const ID1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ID2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

// ─── Reglas ───

test("secciones — las de la minuta v2 en papel, en el mismo orden", () => {
  assert.deepEqual(BLOQUES.map((b) => b.titulo), ["Foco del día", "Producción", "Instalación", "Diseño y técnica", "Feedback general", "Compras y logística", "Estacionamiento"]);
  assert.deepEqual(SECCIONES.map((s) => s.id), ["foco", "prod_terminada", "prod_en_curso", "prod_a_iniciar", "inst_terminada", "inst_en_curso", "inst_pendiente", "postventa", "dyt", "feedback", "compra", "movimiento", "estacionamiento"]);
  // Las mismas que acepta la base (150)
  const sql = readFileSync(new URL("../supabase/migrations/150_minutas.sql", import.meta.url), "utf8");
  for (const s of SECCIONES) assert.match(sql, new RegExp(`'${s.id}'`));
});

test("renglones — la OT trae división, proyecto y cliente; los vacíos no se guardan; orden por sección", () => {
  assert.deepEqual(datosDeOt({ ot: "7751", division: "Muebles", descripcion: "ALACENAS X 4 DPTOS", cliente: "RIOFRIO", obra: "Riofrío" }),
    { ot: "7751", division: "Muebles", proyecto: "ALACENAS X 4 DPTOS", cliente: "RIOFRIO" });
  assert.equal(datosDeOt({ ot: "1", obra: "MALMÖ" }).cliente, "MALMÖ");
  const items = [
    renglonNuevo("foco", { ...datosDeOt({ ot: "7751", descripcion: "Cocinas" }), texto: " entrega viernes " }),
    renglonNuevo("foco"),
    renglonNuevo("foco", { proyecto: "Obra sin OT" }),
    renglonNuevo("compra", { texto: "KIT GO RUEDITAS", tipo: "urgente", datos: { proveedor: "Herrajes SA", sku: "" } }),
  ];
  const listos = renglonesParaGuardar(items);
  assert.equal(listos.length, 3, "el vacío se descarta");
  assert.deepEqual(listos.map((r) => [r.seccion, r.orden]), [["foco", 1], ["foco", 2], ["compra", 1]]);
  assert.equal(listos[0].texto, "entrega viernes");
  assert.deepEqual(listos[2].datos, { proveedor: "Herrajes SA" }, "sin datos vacíos");
  // Pasa la validación del servidor
  assert.ok(minutasBody.safeParse({ accion: "guardar", fecha: "2026-11-02", minuta: {}, items: listos }).success);
});

test("pendientes de instalación — sin responsable y sin fecha objetivo no se registran", () => {
  const sinNada = renglonNuevo("inst_pendiente", { ot: "7495", proyecto: "Estudio" });
  assert.deepEqual(faltantesMinuta([sinNada]), ['Pendientes de instalación: a "OT 7495" le falta responsable y fecha objetivo']);
  assert.deepEqual(faltantesMinuta([{ ...sinNada, responsable: "ANGELI", fecha_objetivo: "2026-10-30" }]), []);
  // Los demás no lo piden, y uno vacío no cuenta
  assert.deepEqual(faltantesMinuta([renglonNuevo("inst_en_curso", { ot: "1" }), renglonNuevo("inst_pendiente")]), []);
});

test("cabecera — duración y participantes", () => {
  assert.equal(duracionMinutos("09:02", "09:22"), 20);
  assert.equal(duracionMinutos("09:02", null), null);
  assert.deepEqual(participantesDe({ participantes: [{ nombre: " Zacarías ", area: "Gerencia" }, { nombre: "" }] }), [{ nombre: "Zacarías", area: "Gerencia" }]);
  assert.deepEqual(participantesDe(null), []);
});

test("impresión — formato v2: cabecera, asistencia, secciones, semáforo y firma del moderador", () => {
  const html = htmlMinuta({
    empresa: "GI Amoblamientos",
    minuta: { fecha: "2026-10-26", inicio: "09:02:00", cierre: "09:22", modera: "Zacarías", registra: "Tadeo", asistentes: ["Zacarías"], estado: "cerrada", notas: "<b>ojo</b>" },
    participantes: [{ nombre: "Zacarías", area: "Gerencia" }, { nombre: "Luciano", area: "Prod. muebles" }],
    items: [
      { seccion: "prod_en_curso", orden: 1, ot: "7861", division: "Muebles", proyecto: "ALACENAS 7B", cliente: "OCAMPO", semaforo: "amarillo", texto: "VER SI HAY FALTANTES", responsable: "ZACARIAS", fecha_objetivo: "2026-10-26" },
      { seccion: "dyt", orden: 1, area: "tecnica", tipo: "en_curso", texto: "COCINA SOLARES" },
    ],
  });
  assert.match(html, /Minuta — Reunión de Buenos Días/);
  assert.match(html, /26\/10\/2026/);
  assert.match(html, /09:02/);
  assert.match(html, /class="si">Zacarías · Gerencia/);
  assert.match(html, /<span class="">Luciano · Prod\. muebles/);
  assert.match(html, /OT 7861 · ALACENAS 7B/);
  assert.match(html, /class="punto amarillo"/);
  assert.match(html, /<td>26\/10<\/td>/);
  assert.match(html, /COCINA SOLARES/);
  assert.match(html, /Proyectos en producción hoy: <b>1<\/b>/);
  assert.match(html, /&lt;b&gt;ojo&lt;\/b&gt;/, "escapa lo escrito");
  assert.match(html, /Firma \/ conforme del moderador: Zacarías/);
});

test("módulo y menú — viene con las OT, se apaga aparte y la pestaña es solo de gerencia", () => {
  assert.ok(modulosEfectivos({ plan: "planta_15" }).includes("minutas"));
  assert.ok(!modulosEfectivos({ plan: "asistencia_15" }).includes("minutas"));
  const planta = { modulos: modulosEfectivos({ plan: "planta_15" }) };
  const tabs = (rol, emp = planta) => opcionesBoton("proyectos", emp, { rol }).map((o) => o.id);
  assert.ok(tabs("gerencial").includes("minuta"));
  assert.ok(!tabs("administrativo").includes("minuta"));
  assert.ok(!tabs("gerencial", { ...planta, modulos_apagados: ["minutas"] }).includes("minuta"));

  const sql = readFileSync(new URL("../supabase/migrations/150_minutas.sql", import.meta.url), "utf8");
  assert.match(sql, /^do \$mig\$/m);
  assert.match(sql, /create unique index if not exists minutas_empresa_fecha on public\.minutas \(empresa_id, fecha\)/);
  assert.equal((sql.match(/enable row level security/g) || []).length, 2);
  // Se lee y escribe solo por /api/minutas
  const data = readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8");
  assert.doesNotMatch(data, /minuta/);
});

// ─── Ruta ───

function mockRuta({ minuta = null, ajenos = [], sin150 = false, items = [] } = {}) {
  const escrito = [];
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method || "GET", url: u, body });
    return body;
  };
  const faltaTabla = { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.minutas' in the schema cache" } };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/minuta_items"),
      respond: (u, o) => {
        anotar("minuta_items", u, o);
        if (!o.method || o.method === "GET") return { status: 200, body: u.includes("minuta_id=neq.") || u.includes("&id=in.") ? ajenos : items };
        return { status: o.method === "DELETE" ? 204 : 201, body: o.method === "DELETE" ? undefined : "" };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/minutas"),
      respond: (u, o) => {
        if (sin150) return faltaTabla;
        const body = anotar("minutas", u, o);
        if (!o.method || o.method === "GET") return { status: 200, body: minuta ? [minuta] : [] };
        return { status: 201, body: [{ id: 9, estado: "abierta", ...(minuta || {}), ...body }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol = "gerencial") {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 1, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/minutas", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const reqGet = (t, q = "") => new Request(`http://localhost/api/minutas${q}`, { headers: { Authorization: `Bearer ${t}` } });

const guardarBody = (extra = {}) => ({
  accion: "guardar", fecha: "2026-11-02",
  minuta: { inicio: "08:47", modera: "Zacarías", registra: "Tadeo", asistentes: ["Zacarías", "Tadeo"] },
  items: renglonesParaGuardar([
    { ...renglonNuevo("foco", { ot: "7751", proyecto: "Cocinas", cliente: "PRANA", texto: "Entrega viernes" }), id: ID1 },
    { ...renglonNuevo("inst_pendiente", { ot: "7495", proyecto: "Estudio", responsable: "ANGELI", fecha_objetivo: "2026-11-04" }), id: ID2 },
  ]),
  ...extra,
});

test("/api/minutas — solo gerencia; administración y operarios no", async () => {
  mockRuta();
  assert.equal((await api.GET(reqGet(await token("administrativo"), "?fecha=2026-11-02"))).status, 403);
  assert.equal((await api.POST(req(await token("operativo"), guardarBody()))).status, 403);
  mockRuta({ minuta: { id: 9, fecha: "2026-11-02", estado: "abierta" }, items: [{ id: ID1, seccion: "foco" }] });
  const res = await api.GET(reqGet(await token(), "?fecha=2026-11-02"));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.minuta.id, 9);
  assert.equal(j.items.length, 1);
});

test("/api/minutas guardar — crea la del día, borra los renglones sacados y guarda los demás", async () => {
  const escrito = mockRuta();
  const res = await api.POST(req(await token(), guardarBody()));
  assert.equal(res.status, 200);
  const alta = escrito.find((x) => x.tabla === "minutas" && x.metodo === "POST");
  assert.deepEqual([alta.body.empresa_id, alta.body.fecha, alta.body.inicio, alta.body.creado_por], [E, "2026-11-02", "08:47", EMP]);
  const borrar = escrito.find((x) => x.tabla === "minuta_items" && x.metodo === "DELETE");
  assert.match(borrar.url, new RegExp(`minuta_id=eq\\.9&id=not\\.in\\.\\(${ID1},${ID2}\\)`));
  const upsert = escrito.find((x) => x.tabla === "minuta_items" && x.metodo === "POST");
  assert.match(upsert.url, /on_conflict=id/);
  assert.equal(upsert.body.length, 2);
  assert.ok(upsert.body.every((f) => f.empresa_id === E && f.minuta_id === 9));
});

test("/api/minutas guardar — cerrar anota el cierre; una cerrada no se edita; reabrir; renglón de otro día", async () => {
  let escrito = mockRuta({ minuta: { id: 9, fecha: "2026-11-02", estado: "abierta" } });
  assert.equal((await api.POST(req(await token(), guardarBody({ cerrar: true })))).status, 200);
  const cierre = escrito.find((x) => x.tabla === "minutas" && x.metodo === "PATCH").body;
  assert.equal(cierre.estado, "cerrada");
  assert.match(cierre.cierre, /^\d{2}:\d{2}$/);
  assert.ok(cierre.cerrada_at);

  mockRuta({ minuta: { id: 9, fecha: "2026-11-02", estado: "cerrada" } });
  let res = await api.POST(req(await token(), guardarBody()));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Reabrir/);

  escrito = mockRuta({ minuta: { id: 9, fecha: "2026-11-02", estado: "cerrada" } });
  assert.equal((await api.POST(req(await token(), { accion: "reabrir", fecha: "2026-11-02" }))).status, 200);
  assert.equal(escrito.find((x) => x.metodo === "PATCH").body.estado, "abierta");

  mockRuta({ minuta: { id: 9, fecha: "2026-11-02", estado: "abierta" }, ajenos: [{ id: ID1 }] });
  res = await api.POST(req(await token(), guardarBody()));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /otra minuta/);
});

test("/api/minutas guardar — un pendiente sin responsable no se registra; sin la migración avisa", async () => {
  mockRuta();
  const body = guardarBody();
  body.items[1].responsable = null;
  const res = await api.POST(req(await token(), body));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /le falta responsable/);

  mockRuta({ sin150: true });
  const r2 = await api.GET(reqGet(await token(), "?fecha=2026-11-02"));
  assert.equal(r2.status, 409);
  assert.match((await r2.json()).error, /migración 150/);
});

// ─── Pantalla ───

function mockPantalla(pedidos) {
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith("/api/minutas")) {
      const body = opts.body ? JSON.parse(opts.body) : null;
      pedidos.push({ url: u, body });
      if (body?.accion === "guardar") return new Response(JSON.stringify({ ok: true, minuta: { id: 9, fecha: body.fecha, ...body.minuta, estado: body.cerrar ? "cerrada" : "abierta" }, items: body.items }), { status: 200 });
      if (u.includes("fecha=")) return new Response(JSON.stringify({ ok: true, minuta: null, items: [] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, minutas: [] }), { status: 200 });
    }
    const { path = "" } = JSON.parse(opts.body || "{}");
    let data = [];
    if (path.startsWith("proyectos?")) data = [{ ot: "7751", descripcion: "COCINAS TIPO B", cliente: "PRANA", division: "d-muebles", estado: "activo" }];
    if (path.startsWith("empleados?")) data = [{ id: "e1", nombre: "Agustín Pérez", division: "Instalación" }];
    if (path.startsWith("config_sistema?")) data = [{ valor: { participantes: [{ nombre: "Zacarías", area: "Gerencia" }, { nombre: "Tadeo", area: "Compras/logística" }] } }];
    return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
  };
}

test("pantalla — asistencia, elegir la OT del listado y guardar con los datos de la OT", async () => {
  const pedidos = [];
  mockPantalla(pedidos);
  pantalla();
  // Asistencia con los participantes configurados
  const asistencia = await screen.findByRole("region", { name: "Asistencia" });
  const zaca = await within(asistencia).findByRole("button", { name: /Zacarías · Gerencia/ });
  fireEvent.click(zaca);
  assert.equal(zaca.getAttribute("aria-pressed"), "true");
  // Todas las secciones del formato
  for (const b of ["Foco del día", "Producción", "Instalación", "Diseño y técnica", "Feedback general", "Compras y logística", "Estacionamiento", "Notas libres"]) {
    assert.ok(screen.getByRole("region", { name: b }), b);
  }
  // Foco: se busca la OT por el cliente y trae división (con su nombre, no el id) y cliente
  fireEvent.click(screen.getByRole("button", { name: "Agregar a Foco del día" }));
  const foco = screen.getByRole("region", { name: "Foco del día" });
  const buscar = within(foco).getByRole("textbox", { name: "OT o proyecto" });
  fireEvent.focus(buscar);
  fireEvent.change(buscar, { target: { value: "prana" } });
  fireEvent.click(await within(foco).findByRole("button", { name: /OT 7751/ }));
  assert.ok(within(foco).getByText("Muebles · PRANA"));
  fireEvent.change(within(foco).getByRole("textbox", { name: "Por qué es prioridad" }), { target: { value: "Entrega el viernes" } });
  // Empezar anota la hora
  fireEvent.click(screen.getByRole("button", { name: "▶ Empezar" }));
  fireEvent.click(screen.getByRole("button", { name: "💾 Guardar" }));
  await waitFor(() => assert.ok(pedidos.some((p) => p.body?.accion === "guardar")));
  const g = pedidos.find((p) => p.body?.accion === "guardar").body;
  assert.deepEqual(g.minuta.asistentes, ["Zacarías"]);
  assert.match(g.minuta.inicio, /^\d{2}:\d{2}$/);
  assert.equal(g.items.length, 1);
  assert.deepEqual([g.items[0].ot, g.items[0].division, g.items[0].proyecto, g.items[0].cliente, g.items[0].texto], ["7751", "Muebles", "COCINAS TIPO B", "PRANA", "Entrega el viernes"]);
  await screen.findByRole("button", { name: "💾 Guardado" });
});

test("pantalla — un pendiente de instalación sin responsable avisa y no se guarda", async () => {
  const pedidos = [];
  mockPantalla(pedidos);
  pantalla();
  await screen.findByRole("region", { name: "Instalación" });
  fireEvent.click(screen.getByRole("button", { name: "Agregar a Pendientes de instalación" }));
  const inst = screen.getByRole("region", { name: "Instalación" });
  fireEvent.change(within(inst).getByRole("textbox", { name: "OT o proyecto" }), { target: { value: "Zocalines BCG" } });
  assert.ok(within(inst).getByText("Sin responsable no se registra"));
  assert.ok(within(inst).getByText("Sin fecha objetivo no se registra"));
  fireEvent.click(screen.getByRole("button", { name: "💾 Guardar" }));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!pedidos.some((p) => p.body?.accion === "guardar"));
});

// ─── Lo que Gypi sugiere (parte M2) ───

const { armarPrecarga, habilAnterior, habilSiguiente, listoParaIniciar, sugerenciasPendientes } = await import("../app/lib/minutasPrecarga.js");

test("precarga — días hábiles: el lunes mira desde el viernes; el viernes, a iniciar hasta el lunes", () => {
  assert.equal(habilAnterior("2026-11-02"), "2026-10-30"); // lunes → viernes
  assert.equal(habilAnterior("2026-11-04"), "2026-11-03");
  assert.equal(habilSiguiente("2026-11-06"), "2026-11-09"); // viernes → lunes
  assert.equal(listoParaIniciar({ conPiezas: true, faltaOt: new Map([["P1", 5]]), stock: new Map([["P1", 10]]) }), "listo");
  assert.equal(listoParaIniciar({ conPiezas: true, faltaOt: new Map([["P1", 5]]), stock: new Map([["P1", 2]]) }), "falta_material");
  assert.equal(listoParaIniciar({ conPiezas: false, faltaOt: undefined, stock: new Map() }), "falta_planilla");
  assert.equal(listoParaIniciar({ conPiezas: false, faltaOt: new Map([["P1", 1]]), stock: new Map() }), "falta_todo");
});

test("precarga — terminada, en curso, a iniciar según el plan, actas, cargadas y pendientes", () => {
  const fecha = "2026-11-02"; // lunes
  const s = armarPrecarga({
    fecha,
    proyectos: [
      { ot: "100", estado: "activo" }, { ot: "200", estado: "activo", fecha_entrega: "2026-11-10" }, { ot: "300", estado: "activo", fecha_entrega: "2026-11-20" },
      { ot: "400", estado: "activo" }, { ot: "500", estado: "activo" }, { ot: "600", estado: "cerrado" }, { ot: "700", estado: "activo" }, { ot: "800", estado: "activo" },
    ],
    avancePiezas: [
      { ot: "100", etapa: 1, total: 10, pasaron: 10 }, // terminó el sábado
      { ot: "700", etapa: 1, total: 10, pasaron: 10 }, // terminó hoy: mañana
      { ot: "200", etapa: 1, total: 10, pasaron: 4 },
      { ot: "300", etapa: 1, total: 8, pasaron: 0 },
    ],
    pasos: [
      { ot: "100", created_at: "2026-10-31T15:00:00Z" },
      { ot: "700", created_at: "2026-10-31T15:00:00Z" }, { ot: "700", created_at: "2026-11-02T12:00:00Z" },
    ],
    planItems: [{ ot: "300", fecha: "2026-11-03" }, { ot: "300", fecha: "2026-11-04" }, { ot: "200", fecha: "2026-11-02" }, { ot: "400", fecha: "2026-11-09" }],
    actas: [{ ot: "400", firmada_at: "2026-10-30T18:00:00Z" }, { ot: "800", firmada_at: "2026-10-20T18:00:00Z" }],
    cargas: [{ ot: "500", firma_carga_at: "2026-10-29T10:00:00Z" }, { ot: "400", firma_carga_at: "2026-10-28T10:00:00Z" }, { ot: "600", firma_carga_at: "2026-10-28T10:00:00Z" }],
    pendientes: [{ id: 9, ot: "400", descripcion: "Cambiar madera", fecha: "2026-11-04", resuelto: false, created_at: "2026-10-30T18:00:00Z" }],
    necesidades: [{ ot: "300", sku: "P1", cantidad: 6 }],
    movimientos: [{ ot: "300", sku: "P1", cantidad: 2, tipo: "consumo", anulado: false }],
    articulos: [{ sku: "P1", stock: 3 }],
  });
  assert.deepEqual(s.prod_terminada.map((x) => x.ot), ["100"], "la que terminó hoy va mañana");
  assert.deepEqual(s.prod_en_curso.map((x) => [x.ot, x.datos.avance, x.semaforo, x.fecha_objetivo]), [["200", 40, "verde", "2026-11-10"]]);
  // 200 ya empezó; 400 arranca la semana que viene
  assert.deepEqual(s.prod_a_iniciar.map((x) => [x.ot, x.datos.arranca, x.datos.listo, x.fecha_objetivo]), [["300", "2026-11-03", "falta_material", "2026-11-20"]]);
  assert.deepEqual(s.inst_terminada.map((x) => x.ot), ["400"], "el acta del viernes, no la vieja");
  assert.deepEqual(s.inst_en_curso.map((x) => x.ot), ["500"], "sin la de acta firmada ni la cerrada");
  assert.deepEqual(s.inst_pendiente.map((x) => [x.ot, x.texto, x.fecha_objetivo, x.datos.pendiente_id]), [["400", "Cambiar madera", "2026-11-04", 9]]);
  // Lo que ya está en la minuta no se vuelve a sugerir
  const items = [renglonNuevo("inst_pendiente", { ot: "400", datos: { pendiente_id: 9 } }), renglonNuevo("prod_en_curso", { ot: "200" })];
  assert.deepEqual(sugerenciasPendientes(s, items, "inst_pendiente"), []);
  assert.deepEqual(sugerenciasPendientes(s, items, "prod_en_curso"), []);
  assert.equal(sugerenciasPendientes(s, items, "prod_terminada").length, 1);
});

test("/api/minutas?precarga — solo gerencia, lee y no escribe", async () => {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [{ ot: "200", estado: "activo" }] }) },
    { match: (u) => u.includes("/rest/v1/v_avance_piezas"), respond: () => ({ status: 200, body: [{ ot: "200", etapa: 1, total: 10, pasaron: 5 }] }) },
    { match: (u, o) => { if (o.method && o.method !== "GET") escrito.push(u); return u.includes("/rest/v1/"); }, respond: () => ({ status: 200, body: [] }) },
  ]);
  assert.equal((await api.GET(reqGet(await token("administrativo"), "?precarga=2026-11-02"))).status, 403);
  const res = await api.GET(reqGet(await token(), "?precarga=2026-11-02"));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.sugeridos.prod_en_curso.map((x) => [x.ot, x.datos.avance]), [["200", 50]]);
  assert.deepEqual(escrito, []);
  assert.equal((await api.GET(reqGet(await token(), "?precarga=ayer"))).status, 400);
});

test("pantalla — Gypi sugiere: se agrega con la OT completa y deja de sugerirse", async () => {
  const pedidos = [];
  mockPantalla(pedidos);
  const base = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes("precarga=")) {
      return new Response(JSON.stringify({ ok: true, sugeridos: { prod_en_curso: [{ clave: "prod_en_curso|7751", ot: "7751", semaforo: "verde", fecha_objetivo: "2026-11-10", datos: { avance: 40 } }] } }), { status: 200 });
    }
    return base(url, opts);
  };
  pantalla();
  const sug = await screen.findByRole("group", { name: "Gypi sugiere para En curso" });
  assert.ok(within(sug).getByText("40 % · fecha 10/11"));
  // Total de proyectos en producción, aunque no estén en la minuta
  assert.ok(screen.getByText(/Proyectos en producción hoy:/).textContent.includes("1 en total"));
  fireEvent.click(await within(sug).findByRole("button", { name: /Agregar OT 7751 · COCINAS TIPO B · PRANA/ }));
  await waitFor(() => assert.equal(screen.queryByRole("group", { name: "Gypi sugiere para En curso" }), null));
  fireEvent.click(screen.getByRole("button", { name: "💾 Guardar" }));
  await waitFor(() => assert.ok(pedidos.some((p) => p.body?.accion === "guardar")));
  const it = pedidos.find((p) => p.body?.accion === "guardar").body.items[0];
  assert.deepEqual([it.seccion, it.ot, it.division, it.cliente, it.semaforo, it.fecha_objetivo, it.datos.avance], ["prod_en_curso", "7751", "Muebles", "PRANA", "verde", "2026-11-10", 40]);
});

// ─── Seguimiento (parte M3) ───

const { sigueAbierto, renglonQueSigue, seguimientoPendiente, textoSeguimiento } = await import("../app/lib/minutas.js");

test("seguimiento — qué pasa al día siguiente y la regla de los 3 días", () => {
  assert.equal(sigueAbierto({ seccion: "inst_pendiente" }), true);
  assert.equal(sigueAbierto({ seccion: "inst_pendiente", resuelto_at: "2026-11-02T10:00:00Z" }), false, "resuelto no sigue");
  assert.equal(sigueAbierto({ seccion: "prod_en_curso", semaforo: "verde" }), false, "lo verde lo vuelve a sugerir Gypi");
  assert.equal(sigueAbierto({ seccion: "prod_en_curso", semaforo: "amarillo" }), true);
  assert.equal(sigueAbierto({ seccion: "foco" }), false);
  assert.equal(sigueAbierto({ seccion: "estacionamiento" }), true);

  const dia1 = { id: ID1, seccion: "inst_pendiente", ot: "7495", proyecto: "Estudio", semaforo: "amarillo", texto: "Cambiar madera", responsable: "ANGELI", fecha_objetivo: "2026-10-30", datos: { pendiente_id: 9 } };
  const dia2 = renglonQueSigue(dia1, "2026-10-28");
  assert.equal(dia2.viene_de, ID1);
  assert.notEqual(dia2.id, ID1);
  assert.deepEqual([dia2.semaforo, dia2.datos.desde, dia2.datos.veces, dia2.datos.gerencia, dia2.responsable], ["amarillo", "2026-10-28", 2, undefined, "ANGELI"]);
  const dia3 = renglonQueSigue({ ...dia2, id: ID2 }, "2026-10-29");
  assert.deepEqual([dia3.semaforo, dia3.datos.desde, dia3.datos.veces, dia3.datos.gerencia], ["rojo", "2026-10-28", 3, true], "3 días seguidos: rojo y Gerencia");
  assert.equal(textoSeguimiento(dia3), "↩ Viene del 28/10 · 3.ª vez");
  // Ya pasado (por viene_de o por el mismo pendiente de obra): no se vuelve a ofrecer
  assert.deepEqual(seguimientoPendiente([dia1], [dia2], "inst_pendiente"), []);
  assert.deepEqual(seguimientoPendiente([dia1], [renglonNuevo("inst_pendiente", { datos: { pendiente_id: 9 } })], "inst_pendiente"), []);
  assert.equal(seguimientoPendiente([dia1], [], "inst_pendiente").length, 1);
  // Pasa la validación al guardar
  assert.ok(minutasBody.safeParse({ accion: "guardar", fecha: "2026-10-29", minuta: {}, items: renglonesParaGuardar([dia3]) }).success);
});

function mockSeguimiento({ minutas = [], items = [], patch = null } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/minutas"), respond: (u) => { escrito.push(u); return { status: 200, body: minutas }; } },
    {
      match: (u) => u.includes("/rest/v1/minuta_items"),
      respond: (u, o) => {
        escrito.push(`${o.method || "GET"} ${u}${o.body ? ` ${o.body}` : ""}`);
        if (o.method === "PATCH") return { status: 200, body: patch ? [patch] : [] };
        return { status: 200, body: items };
      },
    },
  ]);
  return escrito;
}

test("/api/minutas?seguimiento — lo abierto del último mes que no pasó a otra minuta", async () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
  const B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
  const C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
  const escrito = mockSeguimiento({
    minutas: [{ id: 2, fecha: "2026-10-30" }, { id: 1, fecha: "2026-10-29" }],
    items: [
      { id: A, minuta_id: 1, seccion: "inst_pendiente", texto: "Zocalines" },                // pasó a B
      { id: B, minuta_id: 2, seccion: "inst_pendiente", texto: "Zocalines", viene_de: A },   // sigue
      { id: C, minuta_id: 1, seccion: "estacionamiento", texto: "Orden del depósito", resuelto_at: "2026-10-29T12:00:00Z" },
    ],
  });
  const res = await api.GET(reqGet(await token(), "?seguimiento=2026-11-02"));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.anterior, "2026-10-30");
  assert.deepEqual(j.items.map((it) => [it.id, it.fecha]), [[B, "2026-10-30"]]);
  assert.ok(escrito.some((u) => u.includes("fecha=lt.2026-11-02") && u.includes("fecha=gte.2026-10-03")));
});

test("/api/minutas resolver — ✓ Resuelto aunque la minuta esté cerrada; ?ot y ?feedback", async () => {
  let escrito = mockSeguimiento({ patch: { id: ID1, resuelto_at: "2026-11-02T12:00:00Z" } });
  let res = await api.POST(req(await token(), { accion: "resolver", id: ID1, resuelto: true }));
  assert.equal(res.status, 200);
  const p = escrito.find((x) => x.startsWith("PATCH"));
  assert.match(p, new RegExp(`id=eq\\.${ID1}&empresa_id=eq\\.${E}`));
  assert.match(p, /"resuelto_at":"\d{4}-/);
  mockSeguimiento();
  assert.equal((await api.POST(req(await token(), { accion: "resolver", id: ID1, resuelto: false }))).status, 404);
  assert.equal((await api.POST(req(await token("administrativo"), { accion: "resolver", id: ID1, resuelto: true }))).status, 403);

  mockSeguimiento({ minutas: [{ id: 1, fecha: "2026-10-29" }], items: [{ id: ID1, minuta_id: 1, seccion: "feedback", ot: "7751", texto: "Faltó dato" }] });
  res = await api.GET(reqGet(await token(), "?ot=7751"));
  assert.deepEqual((await res.json()).items.map((it) => [it.ot, it.fecha]), [["7751", "2026-10-29"]]);
  escrito = mockSeguimiento({ minutas: [{ id: 1, fecha: "2026-10-29" }], items: [{ id: ID1, minuta_id: 1, seccion: "feedback", area: "DyT" }] });
  res = await api.GET(reqGet(await token(), "?feedback=2026-10-26"));
  assert.equal((await res.json()).items[0].fecha, "2026-10-29");
  assert.ok(escrito.some((u) => u.includes("seccion=eq.feedback")));
});

test("pantalla — lo abierto de ayer se pasa con un toque y muestra desde cuándo", async () => {
  const pedidos = [];
  mockPantalla(pedidos);
  const base = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes("seguimiento=")) {
      return new Response(JSON.stringify({ ok: true, anterior: "2026-10-30", items: [{ id: ID1, fecha: "2026-10-30", seccion: "inst_pendiente", ot: "7495", proyecto: "Estudio", cliente: "BCG", semaforo: "amarillo", texto: "Cambiar madera", responsable: "ANGELI", fecha_objetivo: "2026-11-04", datos: { desde: "2026-10-29", veces: 2 } }] }), { status: 200 });
    }
    return base(url, opts);
  };
  pantalla();
  const grupo = await screen.findByRole("group", { name: "Sigue abierto en Pendientes de instalación" });
  assert.ok(within(grupo).getByText(/del 30\/10 · Cambiar madera · ANGELI/));
  fireEvent.click(within(grupo).getByRole("button", { name: /Agregar OT 7495 · Estudio · BCG/ }));
  await waitFor(() => assert.equal(screen.queryByRole("group", { name: "Sigue abierto en Pendientes de instalación" }), null));
  assert.ok(screen.getByText("↩ Viene del 29/10 · 3.ª vez"));
  assert.ok(screen.getByText(/3 días seguidos: lo toma Gerencia/));
  fireEvent.click(screen.getByRole("button", { name: "💾 Guardar" }));
  await waitFor(() => assert.ok(pedidos.some((p) => p.body?.accion === "guardar")));
  const it = pedidos.find((p) => p.body?.accion === "guardar").body.items[0];
  assert.deepEqual([it.viene_de, it.semaforo, it.datos.veces, it.datos.gerencia], [ID1, "rojo", 3, true]);
});

test("Detalle de OT — 📝 En las minutas, solo para gerencia con el módulo", async () => {
  const { default: MinutasDeOt } = await import("../app/components/MinutasDeOt.jsx");
  const pedidos = [];
  global.fetch = async (url) => {
    pedidos.push(String(url));
    return new Response(JSON.stringify({ ok: true, items: [{ id: ID1, fecha: "2026-10-29", seccion: "inst_pendiente", semaforo: "rojo", texto: "Cambiar madera", responsable: "ANGELI", fecha_objetivo: "2026-11-04", resuelto_at: "2026-11-01T10:00:00Z" }] }), { status: 200 });
  };
  const ver = (usuario, modulos) => render(
    <AuthContext.Provider value={{ usuario, empresa: { modulos } }}><MinutasDeOt ot="7495" /></AuthContext.Provider>
  );
  ver({ rol: "gerencial" }, ["proyectos", "minutas"]);
  const sec = await screen.findByRole("region", { name: "En las minutas" });
  assert.ok(within(sec).getByText("29/10/2026"));
  assert.ok(within(sec).getByText("Pendientes de instalación"));
  assert.ok(within(sec).getByText("🔴 Cambiar madera"));
  assert.ok(within(sec).getByText("ANGELI · para el 04/11/2026"));
  assert.ok(within(sec).getByText("✓ Resuelto"));
  assert.ok(pedidos[0].includes("/api/minutas?ot=7495"));
  cleanup();
  pedidos.length = 0;
  ver({ rol: "administrativo" }, ["proyectos", "minutas"]);
  ver({ rol: "gerencial" }, ["proyectos"]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(pedidos.length, 0, "ni lo pide");
  assert.equal(screen.queryByRole("region", { name: "En las minutas" }), null);
});

// ─── Compras (parte M4) ───

const { pedidoDesdeMinuta, textoCantidad } = await import("../app/lib/minutas.js");
const minutasEsquemas = await import("../app/lib/schemas.ts");

test("compras a disparar — lo que falta para las OT en curso y a iniciar, menos stock y tránsito; urgente si arranca", () => {
  const s = armarPrecarga({
    fecha: "2026-11-02",
    proyectos: [{ ot: "200", estado: "activo" }, { ot: "300", estado: "activo" }, { ot: "900", estado: "activo" }],
    avancePiezas: [{ ot: "200", etapa: 1, total: 10, pasaron: 4 }, { ot: "300", etapa: 1, total: 8, pasaron: 0 }],
    planItems: [{ ot: "300", fecha: "2026-11-03" }],
    necesidades: [
      { ot: "300", sku: "P1", cantidad: 6 }, { ot: "200", sku: "P1", cantidad: 5 },
      { ot: "200", sku: "C1", cantidad: 10 }, { ot: "200", sku: "T1", cantidad: 3 },
      { ot: "900", sku: "X1", cantidad: 50 }, // ni en curso ni a iniciar
    ],
    movimientos: [{ ot: "300", sku: "P1", cantidad: 2, tipo: "consumo", anulado: false }],
    articulos: [
      { sku: "P1", nombre: "Placa blanca 18", unidad: "placas", stock: 3, en_transito: 1 },
      { sku: "C1", nombre: "Canto blanco", unidad: "m", stock: 4, en_transito: 0 },
      { sku: "T1", nombre: "Tornillo", unidad: "u", stock: 2, en_transito: 5 }, // llega con lo que viene
    ],
  });
  // P1: 4 + 5 = 9 menos 3 en stock y 1 en tránsito = 5; la necesita la 300 que arranca mañana → urgente
  assert.deepEqual(s.compra.map((x) => [x.texto, x.tipo, x.ot, x.datos.sku, x.datos.cantidad, x.datos.unidad, x.datos.ots ?? null]), [
    ["Placa blanca 18", "urgente", null, "P1", 5, "placas", "200, 300"],
    ["Canto blanco", "normal", "200", "C1", 6, "m", null],
  ]);
  assert.equal(textoCantidad(s.compra[0]), "5 placas");
  // La que ya está en la minuta no se vuelve a sugerir
  assert.deepEqual(sugerenciasPendientes(s, [renglonNuevo("compra", { texto: "Placa", datos: { sku: "P1" } })], "compra").map((x) => x.datos.sku), ["C1"]);
});

test("compras a disparar — el pedido para Compras lleva artículo, cantidad, OT, fecha y nota de la minuta", () => {
  const it = renglonNuevo("compra", { texto: "Placa blanca 18", tipo: "urgente", ot: "7751", fecha_objetivo: "2026-11-04", datos: { sku: "P1", cantidad: 5, unidad: "placas", proveedor: "Maderera Sur" } });
  const p = pedidoDesdeMinuta(it, "2026-11-02");
  assert.deepEqual(p, { accion: "pedido_crear", sku: "P1", descripcion: null, cantidad: 5, ot: "7751", para_fecha: "2026-11-04", notas: "Minuta del 2/11 · Urgente · Proveedor: Maderera Sur" });
  // Pasa el esquema de /api/compras
  const { comprasBody } = minutasEsquemas;
  assert.ok(comprasBody.safeParse(p).success);
  // Texto libre: va como descripción con su unidad
  const libre = pedidoDesdeMinuta(renglonNuevo("compra", { texto: "Bisagras cierre suave", datos: { cantidad: 40, unidad: "u" } }), "2026-11-02");
  assert.deepEqual([libre.sku, libre.descripcion, libre.unidad, libre.cantidad], [null, "Bisagras cierre suave", "u", 40]);
  assert.ok(comprasBody.safeParse(libre).success);
  assert.match(pedidoDesdeMinuta(renglonNuevo("compra", { texto: "Algo" }), "2026-11-02").error, /cantidad/);
  assert.match(pedidoDesdeMinuta(renglonNuevo("compra", { datos: { cantidad: 2 } }), "2026-11-02").error, /qué se compra/);
});


test("pantalla — compra sugerida por Gypi: se agrega con cantidad y 🛒 Crear pedido la manda a Compras", async () => {
  const pedidos = [];
  mockPantalla(pedidos);
  const base = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("precarga=")) {
      return new Response(JSON.stringify({ ok: true, sugeridos: { compra: [{ clave: "compra|P1", ot: "7751", texto: "Placa blanca 18", tipo: "urgente", datos: { sku: "P1", cantidad: 5, unidad: "placas" } }] } }), { status: 200 });
    }
    if (u.startsWith("/api/compras")) {
      pedidos.push({ url: u, body: JSON.parse(opts.body) });
      return new Response(JSON.stringify({ ok: true, pedido: { id: 77 } }), { status: 200 });
    }
    return base(url, opts);
  };
  pantalla();
  const sug = await screen.findByRole("group", { name: "Gypi sugiere para Compras a disparar hoy" });
  assert.ok(within(sug).getByText("🔴 Urgente · OT 7751"));
  fireEvent.click(within(sug).getByRole("button", { name: "Agregar Placa blanca 18 · 5 placas" }));
  const compras = screen.getByRole("region", { name: "Compras y logística" });
  const cant = await within(compras).findByRole("spinbutton", { name: "Cantidad" });
  assert.equal(cant.value, "5");
  assert.equal(within(compras).getByRole("combobox", { name: "Urgencia" }).value, "urgente");
  fireEvent.change(cant, { target: { value: "6" } });
  fireEvent.click(within(compras).getByRole("button", { name: "🛒 Crear pedido" }));
  await within(compras).findByText("✓ Pedido creado en Compras");
  const p = pedidos.find((x) => x.url.startsWith("/api/compras")).body;
  assert.deepEqual([p.accion, p.sku, p.cantidad, p.ot], ["pedido_crear", "P1", 6, "7751"]);
  assert.equal(within(compras).queryByRole("button", { name: "🛒 Crear pedido" }), null, "no se pide dos veces");
  fireEvent.click(screen.getByRole("button", { name: "💾 Guardar" }));
  await waitFor(() => assert.ok(pedidos.some((x) => x.body?.accion === "guardar")));
  const it = pedidos.find((x) => x.body?.accion === "guardar").body.items[0];
  assert.deepEqual([it.seccion, it.texto, it.tipo, it.datos.cantidad, it.datos.pedido_id], ["compra", "Placa blanca 18", "urgente", 6, 77]);
});
