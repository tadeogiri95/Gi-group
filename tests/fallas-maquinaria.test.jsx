// tests/fallas-maquinaria.test.jsx — Mantenimiento, parte 35 (ítem 43,
// migración 134): fallas de las máquinas (avisadas por cualquiera, desde el
// Inicio o con el QR de la máquina, o salidas de un ❌ Mal de una tarea), su
// arreglo, la máquina 🔴 parada mientras tanto, e indicadores.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  cumplimientoPreventivo, fallasDeRegistro, fallasPendientes, horasParadaMes, indicadoresMaquinaria, leerQrMaquina, linkMaquina,
  nivelCumplimiento, sigueParada, textoHoras, tramosParada,
} from "../app/lib/fallasMaquinaria.js";
import { maquinariaBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";
import { miMantenimiento } from "../app/lib/mantenimiento.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/maquinaria/route.js");
const { default: AvisarFalla } = await import("../app/components/AvisarFalla.jsx");
const { ListaFallas } = await import("../app/components/FallasMaquina.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const OFI = "22222222-2222-2222-2222-222222222222";
const OPE = "33333333-3333-3333-3333-333333333333";
const MANT = "44444444-4444-4444-4444-444444444444";
const HOY = "2026-10-25";
const H = 3600000;

// ─── Reglas ───

test("fallas — de una tarea salen las ❌ Mal; pendientes con la parada primero; QR de la máquina", () => {
  assert.deepEqual(fallasDeRegistro([
    { punto: "a", nombre: "Sierra", estado: "bien" },
    { punto: "b", nombre: "Correa", estado: "mal", nota: "Cortada", foto: "https://x.test/f.jpg" },
    { punto: "c", nombre: "Aire", estado: "revisar", nota: "Pierde" },
  ]), [{ origen: "tarea", punto_nombre: "Correa", descripcion: "Correa: Cortada", foto: "https://x.test/f.jpg" }]);

  const fallas = [
    { id: 1, maquina_id: 1, estado: "pendiente", parada: false, created_at: "2026-10-20T10:00:00Z" },
    { id: 2, maquina_id: 1, estado: "pendiente", parada: true, created_at: "2026-10-21T10:00:00Z" },
    { id: 3, maquina_id: 1, estado: "resuelta", parada: true, created_at: "2026-10-19T10:00:00Z" },
    { id: 4, maquina_id: 2, estado: "pendiente", parada: false, created_at: "2026-10-18T10:00:00Z" },
  ];
  assert.deepEqual(fallasPendientes(fallas).map((f) => f.id), [2, 4, 1]);
  assert.deepEqual(fallasPendientes(fallas, 1).map((f) => f.id), [2, 1]);
  assert.equal(sigueParada(fallas, 1), true);
  assert.equal(sigueParada(fallas, 1, 2), false, "cerrando la 2 ya no queda ninguna que la pare");

  const link = linkMaquina("https://gypi.app/", "acme", "SEC-01");
  assert.equal(link, "https://gypi.app/acme?maquina=SEC-01");
  assert.equal(leerQrMaquina(link), "SEC-01");
  assert.equal(leerQrMaquina("cnc-01"), "CNC-01");
  assert.equal(leerQrMaquina("https://gypi.app/acme?articulo=X"), null);
  assert.equal(leerQrMaquina("con espacios"), null);
});

test("horas paradas — desde que se avisó hasta que se arregla, sin contar dos veces y por mes", () => {
  const fallas = [
    // 10 h el 2/10 y otra que se superpone 2 h con la primera
    { maquina_id: 1, parada: true, parada_desde: "2026-10-02T12:00:00Z", cerrado_at: "2026-10-02T22:00:00Z" },
    { maquina_id: 1, parada: true, parada_desde: "2026-10-02T20:00:00Z", cerrado_at: "2026-10-03T00:00:00Z" },
    // Una sin parar la máquina no cuenta
    { maquina_id: 1, parada: false, created_at: "2026-10-05T12:00:00Z", cerrado_at: "2026-10-06T12:00:00Z" },
    // Una que viene de septiembre: cuenta solo lo de octubre (desde las 0 de Argentina = 3 UTC)
    { maquina_id: 2, parada: true, parada_desde: "2026-09-30T03:00:00Z", cerrado_at: "2026-10-01T09:00:00Z" },
  ];
  assert.equal(tramosParada(fallas, 1).length, 1);
  assert.equal(horasParadaMes(fallas, 1, "2026-10"), 12);
  assert.equal(horasParadaMes(fallas, 2, "2026-10"), 6);
  assert.equal(horasParadaMes(fallas, 2, "2026-09"), 24);
  // Sigue parada: cuenta hasta ahora
  const ahora = Date.parse("2026-10-25T15:00:00Z");
  assert.equal(horasParadaMes([{ maquina_id: 3, parada: true, parada_desde: "2026-10-25T12:00:00Z" }], 3, "2026-10", ahora), 3);
  assert.deepEqual([textoHoras(0), textoHoras(0.5), textoHoras(5), textoHoras(52)], ["0 h", "30 min", "5 h", "2 días y 4 h"]);
});

test("cumplimiento del preventivo — de lo que tocaba en el mes, cuánto se hizo", () => {
  // Semanal desde antes del mes: en octubre hasta el 25 tocaba 3 veces; se hizo 2
  const semanal = { id: 1, cada_dias: 7, created_at: "2026-01-01T12:00:00Z", activa: true };
  const registros = [{ tarea_id: 1, fecha: "2026-10-03" }, { tarea_id: 1, fecha: "2026-10-10" }, { tarea_id: 1, fecha: "2026-09-28" }];
  assert.deepEqual(cumplimientoPreventivo([semanal], registros, "2026-10", HOY), { tocaban: 3, hechas: 2, pct: 67 });
  // Hacerla de más no compensa
  const demas = [1, 2, 3, 4, 5].map((d) => ({ tarea_id: 1, fecha: `2026-10-0${d}` }));
  assert.equal(cumplimientoPreventivo([semanal], demas, "2026-10", HOY).pct, 100);
  // Anual: solo cuenta el mes en que le tocaba
  const anual = { id: 2, cada_dias: 365, created_at: "2025-10-10T12:00:00Z", activa: true };
  assert.deepEqual(cumplimientoPreventivo([anual], [], "2026-10", HOY), { tocaban: 1, hechas: 0, pct: 0 });
  assert.deepEqual(cumplimientoPreventivo([anual], [], "2026-09", HOY), { tocaban: 0, hechas: 0, pct: null });
  // Una tarea dada de alta después no cuenta; un mes que no empezó tampoco
  assert.equal(cumplimientoPreventivo([{ ...semanal, created_at: "2026-11-01T12:00:00Z" }], [], "2026-10", HOY).tocaban, 0);
  assert.equal(cumplimientoPreventivo([semanal], [], "2026-11", HOY).pct, null);
  assert.deepEqual([nivelCumplimiento(85), nivelCumplimiento(60), nivelCumplimiento(20)], ["ok", "pronto", "vencido"]);
});

test("indicadores — horas paradas, tiempo entre fallas, tiempo de arreglo y costo por mes", () => {
  const ahora = Date.parse("2026-10-25T15:00:00Z");
  const maquinas = [{ id: 1, codigo: "SEC-01", activo: true }, { id: 2, codigo: "CNC-01", activo: true }];
  const fallas = [
    { maquina_id: 1, estado: "resuelta", parada: true, parada_desde: "2026-10-02T12:00:00Z", created_at: "2026-10-02T12:00:00Z", cerrado_at: "2026-10-02T22:00:00Z", costo: 50000 },
    { maquina_id: 1, estado: "resuelta", parada: false, created_at: "2026-10-10T12:00:00Z", cerrado_at: "2026-10-10T14:00:00Z", costo: 10000 },
    { maquina_id: 1, estado: "descartada", parada: false, created_at: "2026-10-11T12:00:00Z", cerrado_at: "2026-10-11T13:00:00Z" },
  ];
  const r = indicadoresMaquinaria({ maquinas, fallas, meses: ["2026-10"], hoy: HOY, ahora });
  const sec = r.filas.find((f) => f.maquina.id === 1);
  assert.equal(sec.horasParada, 10);
  assert.equal(sec.fallas, 2, "la descartada no cuenta");
  assert.equal(sec.arregloHoras, 6, "(10 + 2) / 2");
  assert.equal(sec.costoPorMes["2026-10"], 60000);
  const horasMes = (ahora - Date.parse("2026-10-01T03:00:00Z")) / H;
  assert.ok(Math.abs(sec.entreFallasDias - (horasMes - 10) / 2 / 24) < 1e-9);
  assert.equal(r.filas[0].maquina.id, 1, "la más parada arriba");
  assert.equal(r.filas.find((f) => f.maquina.id === 2).entreFallasDias, null);
  assert.deepEqual([r.total.horasParada, r.total.fallas, r.total.arregloHoras, r.total.costo], [10, 2, 6, 60000]);

  // Mi mantenimiento: una falla sin arreglar la pone en 🟡 aunque el plan esté al día
  const items = miMantenimiento(MANT, { maquinas: [{ ...maquinas[0], responsable_id: MANT, estado: "en_servicio" }], fallas: [{ id: 9, maquina_id: 1, estado: "pendiente" }], hoy: HOY });
  assert.deepEqual([items[0].nivel, items[0].fallas.length], ["pronto", 1]);
});

test("migración 134, validación y lectura por /api/data", () => {
  const sql = readFileSync(new URL("../supabase/migrations/134_fallas_maquinaria.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /create table if not exists public\.maquina_fallas /);
  for (const c of ["parada_desde", "registro_id", "responsable_id", "costo", "factura_url", "motivo", "cerrado_at", "enable row level security"]) assert.ok(sql.includes(c), c);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*maquina_fallas/, "sin borrar: se descarta");

  assert.ok(maquinariaBody.safeParse({ accion: "falla_crear", maquina_id: 1, descripcion: "Hace ruido", parada: true }).success);
  assert.ok(!maquinariaBody.safeParse({ accion: "falla_crear", maquina_id: 1, descripcion: " " }).success);
  assert.ok(maquinariaBody.safeParse({ accion: "falla_resolver", id: 3, detalle: "Cambio de correa", costo: 1500 }).success);
  assert.ok(!maquinariaBody.safeParse({ accion: "falla_editar", id: 3, parada: false }).success, "volver atrás es arreglarla");
  assert.ok(!maquinariaBody.safeParse({ accion: "falla_descartar", id: 3, motivo: "" }).success);

  assert.equal(autorizar("maquina_fallas", "GET", "operativo").ok, true);
  assert.equal(autorizar("maquina_fallas", "POST", "gerencial").ok, false);
  const data = readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8");
  assert.match(data, /"maquina_fallas"\]/);
});

// ─── API ───

function mockApi({ maquina = { id: 1, codigo: "SEC-01", estado: "en_servicio", activo: true, responsable_id: MANT, suplente_id: null }, falla = null, abiertas = [], sin134 = false } = {}) {
  const escrito = [];
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return body;
  };
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/empleados?id=eq.") && u.includes("select=nombre"), respond: () => ({ status: 200, body: [{ nombre: "Pedro" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?id=in."), respond: () => ({ status: 200, body: [{ legajo: 5 }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?id=eq.") && u.includes("select=id"), respond: () => ({ status: 200, body: [{ id: MANT }] }) },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/maquina_fallas"),
      respond: (u, o) => {
        if (sin134) return { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.maquina_fallas' in the schema cache" } };
        if (!o.method || o.method === "GET") return { status: 200, body: u.includes("estado=eq.pendiente&parada=eq.true") ? abiertas : falla ? [falla] : [] };
        const body = anotar("maquina_fallas", u, o);
        return { status: 201, body: [{ id: 30, ...body }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/maquinas"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: maquina ? [maquina] : [] };
        return { status: 200, body: [{ ...maquina, ...anotar("maquinas", u, o) }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol = "operativo", empleadoId = OPE) {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 9, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/maquinaria", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/maquinaria falla_crear — cualquiera avisa; parada pone la máquina 🔴 parada", async () => {
  let escrito = mockApi();
  let res = await api.POST(req(await token(), { accion: "falla_crear", maquina_id: 1, descripcion: "Se trabó el carro", parada: true }));
  assert.equal(res.status, 200);
  const f = escrito.find((x) => x.tabla === "maquina_fallas").body;
  assert.deepEqual([f.origen, f.parada, f.responsable_id, f.creado_por, f.creado_nombre, f.empresa_id], ["aviso", true, MANT, OPE, "Pedro", E]);
  assert.ok(f.parada_desde);
  assert.equal(escrito.find((x) => x.tabla === "maquinas").body.estado, "parada");

  // Sin parar: no toca la máquina
  escrito = mockApi();
  await api.POST(req(await token(), { accion: "falla_crear", maquina_id: 1, descripcion: "Hace ruido", parada: false }));
  assert.equal(escrito.find((x) => x.tabla === "maquina_fallas").body.parada_desde, null);
  assert.ok(!escrito.some((x) => x.tabla === "maquinas"));

  mockApi({ maquina: null });
  assert.equal((await api.POST(req(await token(), { accion: "falla_crear", maquina_id: 9, descripcion: "X" }))).status, 404);

  mockApi({ sin134: true });
  res = await api.POST(req(await token(), { accion: "falla_crear", maquina_id: 1, descripcion: "X" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 134/);
});

test("/api/maquinaria falla_resolver y falla_descartar — quién puede, y la máquina vuelve a servicio", async () => {
  const maquina = { id: 1, codigo: "SEC-01", estado: "parada", activo: true, responsable_id: MANT, suplente_id: null };
  const falla = { id: 30, maquina_id: 1, estado: "pendiente", parada: true, responsable_id: null };
  const arreglo = { accion: "falla_resolver", id: 30, detalle: "Cambio de correa", donde: "interno", repuestos: "Correa A-42", costo: 12000 };

  mockApi({ maquina, falla });
  let res = await api.POST(req(await token(), arreglo));
  assert.equal(res.status, 403, "un operario que no es el responsable");

  let escrito = mockApi({ maquina, falla, abiertas: [falla] });
  assert.equal((await api.POST(req(await token("operativo", MANT), arreglo))).status, 200);
  const cierre = escrito.find((x) => x.tabla === "maquina_fallas").body;
  assert.deepEqual([cierre.estado, cierre.costo, cierre.repuestos, cierre.cerrado_por], ["resuelta", 12000, "Correa A-42", MANT]);
  assert.ok(cierre.cerrado_at);
  assert.equal(escrito.find((x) => x.tabla === "maquinas").body.estado, "en_servicio", "era la única que la paraba");

  // Si queda otra que la para, sigue parada
  escrito = mockApi({ maquina, falla, abiertas: [falla, { id: 31, maquina_id: 1, estado: "pendiente", parada: true }] });
  assert.equal((await api.POST(req(await token("administrativo", OFI), arreglo))).status, 200);
  assert.ok(!escrito.some((x) => x.tabla === "maquinas"));

  // Ya cerrada
  mockApi({ maquina, falla: { ...falla, estado: "resuelta" } });
  assert.equal((await api.POST(req(await token("administrativo", OFI), arreglo))).status, 409);

  // Descartar: solo la oficina
  mockApi({ maquina, falla });
  assert.equal((await api.POST(req(await token("operativo", MANT), { accion: "falla_descartar", id: 30, motivo: "Repetida" }))).status, 403);
  escrito = mockApi({ maquina, falla, abiertas: [falla] });
  assert.equal((await api.POST(req(await token("gerencial", OFI), { accion: "falla_descartar", id: 30, motivo: "Repetida" }))).status, 200);
  assert.deepEqual([escrito[0].body.estado, escrito[0].body.motivo], ["descartada", "Repetida"]);

  // Marcar que quedó parada (oficina)
  escrito = mockApi({ maquina: { ...maquina, estado: "en_servicio" }, falla: { ...falla, parada: false } });
  assert.equal((await api.POST(req(await token("administrativo", OFI), { accion: "falla_editar", id: 30, responsable_id: MANT, parada: true }))).status, 200);
  const ed = escrito.find((x) => x.tabla === "maquina_fallas").body;
  assert.deepEqual([ed.parada, ed.responsable_id], [true, MANT]);
  assert.ok(ed.parada_desde);
  assert.equal(escrito.find((x) => x.tabla === "maquinas").body.estado, "parada");
});

// ─── Pantallas ───

test("avisar una falla — con el QR la máquina ya viene elegida; pide qué le pasa y si quedó parada", async () => {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/maquinaria")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, falla: { id: 1 } }), { status: 200 });
    }
    return Response.json({ ok: true, data: [{ id: 1, codigo: "SEC-01", nombre: "Seccionadora", tipo: "seccionadora", estado: "en_servicio" }, { id: 2, codigo: "CNC-01", nombre: "CNC", tipo: "cnc", estado: "en_servicio" }] });
  };
  render(<AvisarFalla codigoInicial="sec-01" onClose={() => {}} />);
  await screen.findByText(/SEC-01 · Seccionadora/);
  fireEvent.click(screen.getByRole("button", { name: "Avisar" }));
  assert.match(screen.getByRole("alert").textContent, /Contá qué le pasa/);
  fireEvent.change(screen.getByLabelText("Qué le pasa"), { target: { value: "Se trabó el carro" } });
  fireEvent.click(screen.getByRole("button", { name: "Avisar" }));
  assert.match(screen.getByRole("alert").textContent, /quedó parada/);
  fireEvent.click(screen.getByRole("button", { name: /Sí, no se puede usar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Avisar" }));
  await screen.findByText("Listo, avisaste");
  assert.deepEqual(enviados, [{ accion: "falla_crear", maquina_id: 1, descripcion: "Se trabó el carro", foto: null, parada: true }]);

  // Sin QR se elige de la lista
  cleanup();
  render(<AvisarFalla onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /CNC-01 · CNC/ }));
  assert.ok(screen.getByLabelText("Qué le pasa"));
});

test("lista de fallas — la parada arriba, cargar el arreglo con costo", async () => {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    enviados.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const fallas = [
    { id: 1, maquina_id: 1, estado: "pendiente", parada: false, descripcion: "Hace ruido", created_at: "2026-10-20T10:00:00Z" },
    { id: 2, maquina_id: 1, estado: "pendiente", parada: true, parada_desde: "2026-10-21T10:00:00Z", descripcion: "No arranca", created_at: "2026-10-21T10:00:00Z" },
  ];
  let cambios = 0;
  render(<ListaFallas fallas={fallas} maquinas={[{ id: 1, codigo: "SEC-01", nombre: "Seccionadora" }]} editable onCambio={() => { cambios++; }} />);
  const items = screen.getAllByRole("listitem");
  assert.match(items[0].textContent, /No arranca/);
  assert.match(items[0].textContent, /Parada hace/);
  fireEvent.click(screen.getAllByRole("button", { name: /Cargar arreglo/ })[0]);
  fireEvent.change(screen.getByLabelText("Qué se hizo"), { target: { value: "Cambio de capacitor" } });
  fireEvent.change(screen.getByLabelText("Costo ($)"), { target: { value: "12.500,50" } });
  fireEvent.click(screen.getByRole("button", { name: /Servicio externo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar arreglo" }));
  await waitFor(() => assert.equal(cambios, 1));
  assert.deepEqual(enviados[0], { accion: "falla_resolver", id: 2, detalle: "Cambio de capacitor", donde: "externo", repuestos: null, costo: 12500.5, factura_url: null, fotos: [] });
});

test("pantallas — Inicio del operario, QR que abre el aviso, etiqueta en la ficha e indicadores", () => {
  const fuente = (r) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
  assert.match(fuente("app/components/screens/HomeEmp.jsx"), /titulo="Avisar una falla"/);
  const home = fuente("app/[slug]/HomeContent.jsx");
  assert.match(home, /searchParams\.get\("maquina"\)/);
  assert.match(home, /<AvisarFalla codigoInicial=\{codigoMaquina\}/);
  const ficha = fuente("app/components/FichaMaquina.jsx");
  assert.match(ficha, /🏷 Etiqueta QR/);
  assert.match(ficha, /linkMaquina\(/);
  const lista = fuente("app/components/MaquinariaScreen.jsx");
  assert.match(lista, /📊 Indicadores/);
  assert.match(lista, /🔧 Fallas/);
});
