// tests/maquinaria.test.jsx — Mantenimiento, parte 33 (ítem 43, migración
// 132): máquinas con su criticidad, su horómetro y su plan de mantenimiento
// (tareas cada X días o X horas, lo que pase primero, con su checklist).
// Semáforo por tarea y por máquina; hacer una tarea la pone al día.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  TIPOS_MAQUINA, alertasMaquinaria, avisoDiasPorDefecto, estadoMaquina, estadoTarea, faltantesRegistro, itemsRegistro,
  normalizarCodigo, puedeEditarMaquinaria, tareasDePlantilla, textoEstadoTarea, textoFrecuencia,
} from "../app/lib/maquinaria.js";
import { maquinariaBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";
import { modulosEfectivos } from "../app/lib/modulos.js";
import { opcionesBoton } from "../app/lib/menuGestion.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/maquinaria/route.js");
const { default: MaquinariaScreen } = await import("../app/components/MaquinariaScreen.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const HOY = "2026-10-25";

// ─── Reglas ───

test("plantillas — las máquinas de la empresa, cada tarea con frecuencia y checklist", () => {
  const ids = TIPOS_MAQUINA.map((t) => t.id);
  for (const id of ["seccionadora", "pegadora", "cnc", "router", "escuadradora", "prensa", "soldadora", "compresor", "sensitiva", "cortadora_aluminio", "otra"]) {
    assert.ok(ids.includes(id), id);
  }
  for (const t of TIPOS_MAQUINA) {
    for (const tarea of t.tareas) {
      assert.ok(tarea.cada_dias || tarea.cada_horas, `${t.id}: ${tarea.nombre} tiene frecuencia`);
      assert.ok(tarea.checklist.length > 0, `${t.id}: ${tarea.nombre} tiene puntos`);
      assert.ok(!tarea.cada_dias || tarea.cada_dias >= 7, "nada diario: no llena de avisos");
      assert.equal(new Set(tarea.checklist.map((p) => p.id)).size, tarea.checklist.length);
      assert.ok(maquinariaBody.safeParse({ accion: "tarea_guardar", maquina_id: 1, ...tarea }).success, `${t.id}: ${tarea.nombre} pasa la validación`);
    }
  }
  // El compresor se cuenta también por horas; la plantilla se copia (no se comparte)
  const comp = tareasDePlantilla("compresor");
  assert.ok(comp.some((t) => t.cada_horas === 2000));
  comp[0].checklist[0].nombre = "x";
  assert.notEqual(tareasDePlantilla("compresor")[0].checklist[0].nombre, "x");
  assert.deepEqual(tareasDePlantilla("no-existe"), []);

  assert.equal(normalizarCodigo(" sec 01 "), "SEC-01");
  assert.equal(avisoDiasPorDefecto(7), 1);
  assert.equal(avisoDiasPorDefecto(30), 3);
  assert.equal(avisoDiasPorDefecto(365), 15);
  assert.equal(puedeEditarMaquinaria("gerencial"), true);
  assert.equal(puedeEditarMaquinaria("operativo"), false);
});

test("semáforo — por días desde la última vez (o el alta), por horas con horómetro, lo que pase primero", () => {
  const maq = { id: 1, con_horometro: true, horas: 1950, estado: "en_servicio", activo: true, criticidad: "A" };
  // Por días: hecha el 20/10, cada 7 → toca el 27/10; aviso 1 día
  const semanal = { id: 1, maquina_id: 1, cada_dias: 7, aviso_dias: 1, ultima_fecha: "2026-10-20" };
  assert.deepEqual(estadoTarea(semanal, maq, HOY), { nivel: "ok", proxima: "2026-10-27", dias: 2, faltanHoras: null });
  assert.equal(estadoTarea(semanal, maq, "2026-10-26").nivel, "pronto");
  assert.equal(estadoTarea(semanal, maq, "2026-10-28").nivel, "vencido");
  assert.equal(textoEstadoTarea(estadoTarea(semanal, maq, "2026-10-28")), "Vencida hace 1 día");
  assert.equal(textoEstadoTarea(estadoTarea(semanal, maq, "2026-10-27")), "Toca hoy");
  // Sin registro cuenta desde el alta
  assert.equal(estadoTarea({ cada_dias: 30, aviso_dias: 3, created_at: "2026-10-01T10:00:00Z" }, maq, HOY).proxima, "2026-10-31");
  // Por horas: base 0 + 2000 → faltan 50 h; aviso 200 → amarillo aunque por días esté bien
  const aceite = { id: 2, maquina_id: 1, cada_dias: 365, cada_horas: 2000, aviso_dias: 15, aviso_horas: 200, ultima_fecha: "2026-06-01", ultima_horas: 0 };
  const e = estadoTarea(aceite, maq, HOY);
  assert.equal(e.nivel, "pronto");
  assert.equal(e.faltanHoras, 50);
  assert.match(textoEstadoTarea(e), /faltan 50 h$/);
  assert.equal(estadoTarea(aceite, { ...maq, horas: 2100 }, HOY).nivel, "vencido");
  // Sin horómetro, las horas no cuentan
  assert.equal(estadoTarea(aceite, { ...maq, con_horometro: false }, HOY).nivel, "ok");
  assert.equal(textoFrecuencia(aceite), "Cada 365 días o 2.000 h");

  // Máquina: la peor de sus tareas; parada es rojo; fuera de servicio no avisa
  assert.equal(estadoMaquina(maq, [semanal, aceite], HOY).nivel, "pronto");
  assert.equal(estadoMaquina({ ...maq, estado: "parada" }, [semanal], HOY).nivel, "vencido");
  assert.equal(estadoMaquina({ ...maq, estado: "fuera_de_servicio" }, [aceite], HOY).nivel, "fuera");
  assert.equal(estadoMaquina(maq, [{ ...aceite, activa: false }], HOY).nivel, "ok", "una tarea sacada no avisa");

  // Alertas: primero lo vencido y, dentro, las A
  const b = { id: 2, codigo: "B", criticidad: "B", activo: true, estado: "en_servicio" };
  const a = { id: 3, codigo: "A", criticidad: "A", activo: true, estado: "en_servicio" };
  const vencida = (id, maquina_id) => ({ id, maquina_id, cada_dias: 7, ultima_fecha: "2026-10-01" });
  const lista = alertasMaquinaria([b, a, { ...maq, id: 4, estado: "parada", codigo: "P" }], [vencida(10, 2), vencida(11, 3)], HOY);
  assert.deepEqual(lista.map((x) => x.maquina.codigo), ["P", "A", "B"]);
  assert.equal(lista[0].texto, "Máquina parada");
});

test("registrar — seguridad confirmada, horas si tiene horómetro, cada punto y nota si no está bien", () => {
  const tarea = { seguridad: "Cortar la energía", checklist: [{ id: "a", nombre: "Correas" }, { id: "b", nombre: "Presión", valor: "bar" }] };
  const maq = { con_horometro: true };
  assert.deepEqual(faltantesRegistro({ tarea, maquina: maq, respuestas: {}, seguridadOk: false, horas: null }),
    ["Confirmar el aviso de seguridad", "Las horas del horómetro", "Correas", "Presión"]);
  const respuestas = { a: { estado: "mal" }, b: { estado: "bien", valor: "6" } };
  assert.deepEqual(faltantesRegistro({ tarea, maquina: maq, respuestas, seguridadOk: true, horas: 100 }), ["Correas (falta la nota)"]);
  respuestas.a.nota = "Gastada";
  assert.deepEqual(faltantesRegistro({ tarea, maquina: maq, respuestas, seguridadOk: true, horas: 100 }), []);
  assert.deepEqual(itemsRegistro(tarea, respuestas)[1], { punto: "b", nombre: "Presión", estado: "bien", valor: "6", unidad: "bar", nota: null, foto: null });
});

test("validación, migración 132, módulo propio y lectura por /api/data", () => {
  const ok = (b) => maquinariaBody.safeParse(b).success;
  assert.equal(ok({ accion: "maquina_guardar", codigo: "SEC-01", nombre: "Seccionadora", tipo: "seccionadora", criticidad: "A", con_plantilla: true }), true);
  assert.equal(ok({ accion: "maquina_guardar", codigo: "SEC-01", nombre: "Seccionadora", tipo: "seccionadora", criticidad: "D" }), false);
  assert.equal(ok({ accion: "maquina_guardar", codigo: "X", nombre: "X", tipo: "otra", criticidad: "B", manual_url: "http://x.test/m.pdf" }), false, "links https");
  assert.equal(ok({ accion: "tarea_guardar", maquina_id: 1, nombre: "Correas", checklist: [{ id: "a", nombre: "Correas" }] }), false, "sin frecuencia");
  assert.equal(ok({ accion: "tarea_guardar", maquina_id: 1, nombre: "Correas", cada_horas: 500, checklist: [] }), false, "sin puntos");
  assert.equal(ok({ accion: "horas_guardar", id: 1, horas: 1200 }), true);
  assert.equal(ok({ accion: "registro_crear", tarea_id: 1, fecha: HOY, items: [{ punto: "a", nombre: "Correas", estado: "bien" }] }), true);

  const sql = readFileSync(new URL("../supabase/migrations/132_maquinaria.sql", import.meta.url), "utf8");
  assert.match(sql, /^do \$mig\$/m);
  for (const t of ["maquinas", "maquina_tareas", "maquina_registros"]) assert.match(sql, new RegExp(`create table if not exists public\\.${t} `));
  assert.match(sql, /maquinas \(empresa_id, upper\(codigo\)\)/);
  assert.match(sql, /check \(cada_dias is not null or cada_horas is not null\)/);
  assert.match(sql, /\('maquinaria', 'Maquinaria',/);
  assert.equal((sql.match(/enable row level security/g) || []).length, 3);

  // Viene con las OT y se apaga aparte; va en Mantenimiento junto a la flota
  assert.ok(modulosEfectivos({ plan: "planta_15" }).includes("maquinaria"));
  assert.ok(!modulosEfectivos({ plan: "asistencia_15" }).includes("maquinaria"));
  const planta = { modulos: modulosEfectivos({ plan: "planta_15" }) };
  assert.deepEqual(opcionesBoton("mantenimiento", planta).map((o) => o.label), ["Flota vehicular", "Maquinaria"]);
  assert.deepEqual(opcionesBoton("mantenimiento", { ...planta, modulos_apagados: ["maquinaria"] }).map((o) => o.label), ["Flota vehicular"]);

  assert.equal(autorizar("maquinas", "GET", { rol: "operativo" }).ok, true, "el responsable va a ver sus máquinas (parte 34)");
  assert.equal(autorizar("maquina_tareas", "POST", { rol: "gerencial" }).ok, false, "se escribe por /api/maquinaria");
  const data = readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8");
  assert.match(data, /TABLAS_MAQUINARIA = \["maquinas", "maquina_tareas", "maquina_registros", "maquina_fallas"\]/);
});

// ─── Ruta ───

function mockRuta({ maquinas = [{ id: 5, horas: 1000, con_horometro: true }], tareas = [], duplicada = false, sin132 = false } = {}) {
  const escrito = [];
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return body;
  };
  const faltaTabla = { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.maquinas' in the schema cache" } };
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/empleados?id=eq."), respond: () => ({ status: 200, body: [{ nombre: "Ana" }] }) },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    // Parte 35 (134): lo que queda Mal pasa a fallas
    { match: (u) => u.includes("/rest/v1/maquina_fallas"), respond: (u, o) => { anotar("maquina_fallas", u, o); return { status: 201, body: [] }; } },
    {
      match: (u) => u.includes("/rest/v1/maquina_registros"),
      respond: (u, o) => ({ status: 201, body: [{ id: 70, ...anotar("maquina_registros", u, o) }] }),
    },
    {
      match: (u) => u.includes("/rest/v1/maquina_tareas"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: tareas.filter((t) => u.includes(`id=eq.${t.id}&`)) };
        const body = anotar("maquina_tareas", u, o);
        return { status: 201, body: Array.isArray(body) ? body : [{ id: 40, ...body }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/maquinas"),
      respond: (u, o) => {
        if (sin132) return faltaTabla;
        if (!o.method || o.method === "GET") return { status: 200, body: maquinas.filter((m) => u.includes(`id=eq.${m.id}&`)) };
        if (duplicada && o.method === "POST") return { status: 409, body: { code: "23505", message: "duplicate key value violates unique constraint \"maquinas_empresa_codigo\"" } };
        const body = anotar("maquinas", u, o);
        return { status: 201, body: [{ id: 5, ...body }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol = "administrativo") {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/maquinaria", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/maquinaria maquina_guardar — alta con el plan de su tipo, código repetido, permisos y migración", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token(), {
    accion: "maquina_guardar", codigo: "comp 01", nombre: "Compresor", tipo: "compresor", criticidad: "A", con_horometro: true, horas: 1200, con_plantilla: true,
  }));
  assert.equal(res.status, 200);
  const json = await res.json();
  const alta = escrito.find((x) => x.tabla === "maquinas");
  assert.deepEqual([alta.metodo, alta.body.codigo, alta.body.empresa_id, alta.body.horas], ["POST", "COMP-01", E, 1200]);
  assert.ok(alta.body.horas_at);
  const plan = escrito.find((x) => x.tabla === "maquina_tareas");
  assert.equal(plan.body.length, tareasDePlantilla("compresor").length);
  assert.equal(json.tareas, plan.body.length);
  assert.ok(plan.body.every((t) => t.maquina_id === 5 && t.empresa_id === E));
  const porHoras = plan.body.find((t) => t.cada_horas);
  assert.equal(porHoras.horas_base, 1200, "lo que va por horas arranca desde las horas de hoy");
  assert.equal(plan.body.find((t) => !t.cada_horas).horas_base, null);

  mockRuta({ duplicada: true });
  res = await api.POST(req(await token(), { accion: "maquina_guardar", codigo: "SEC-01", nombre: "Seccionadora", tipo: "seccionadora", criticidad: "A" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Ya hay una máquina con el código SEC-01/);

  mockRuta();
  assert.equal((await api.POST(req(await token("operativo"), { accion: "maquina_baja", id: 5, activo: false }))).status, 403);

  mockRuta({ sin132: true });
  res = await api.POST(req(await token(), { accion: "maquina_guardar", codigo: "X", nombre: "X", tipo: "otra", criticidad: "B" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 132/);
});

test("/api/maquinaria — horas, tareas y registrar una tarea hecha", async () => {
  // Las horas no bajan
  mockRuta();
  assert.equal((await api.POST(req(await token(), { accion: "horas_guardar", id: 5, horas: 900 }))).status, 400);
  let escrito = mockRuta();
  assert.equal((await api.POST(req(await token(), { accion: "horas_guardar", id: 5, horas: 1100 }))).status, 200);
  assert.equal(escrito.find((x) => x.tabla === "maquinas").body.horas, 1100);

  // Tarea nueva por horas: arranca desde las horas de la máquina y va al final
  escrito = mockRuta({ tareas: [] });
  let res = await api.POST(req(await token(), { accion: "tarea_guardar", maquina_id: 5, nombre: "Aceite", cada_horas: 500, checklist: [{ id: "aceite", nombre: "Cambio de aceite" }] }));
  assert.equal(res.status, 200);
  const t = escrito.find((x) => x.tabla === "maquina_tareas" && x.metodo === "POST").body;
  assert.deepEqual([t.horas_base, t.orden, t.cada_horas], [1000, 0, 500]);
  mockRuta();
  res = await api.POST(req(await token(), { accion: "tarea_guardar", maquina_id: 5, nombre: "X", cada_dias: 7, checklist: [{ id: "a", nombre: "A" }, { id: "a", nombre: "B" }] }));
  assert.equal(res.status, 400, "puntos con el mismo código");

  // Sacar una tarea la deja inactiva (no se borra)
  escrito = mockRuta();
  assert.equal((await api.POST(req(await token(), { accion: "tarea_borrar", id: 40 }))).status, 200);
  assert.equal(escrito.find((x) => x.tabla === "maquina_tareas").body.activa, false);

  // Registrar: pide seguridad, horas y cada punto; pone la tarea y las horas al día
  const tareas = [{ id: 40, maquina_id: 5, nombre: "Aceite", seguridad: "Cortar la energía", activa: true, ultima_fecha: "2026-01-01", ultima_horas: 500,
    checklist: [{ id: "aceite", nombre: "Cambio de aceite" }, { id: "filtro", nombre: "Filtro" }] }];
  const registro = (extra = {}) => ({ accion: "registro_crear", tarea_id: 40, fecha: "2026-10-20", horas: 1050, seguridad_ok: true,
    items: [{ punto: "aceite", nombre: "Cambio de aceite", estado: "bien" }, { punto: "filtro", nombre: "Filtro", estado: "mal", nota: "Roto" }], ...extra });
  mockRuta({ tareas });
  res = await api.POST(req(await token(), registro({ seguridad_ok: false })));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /seguridad/);
  mockRuta({ tareas });
  res = await api.POST(req(await token(), registro({ horas: null })));
  assert.equal(res.status, 400);
  mockRuta({ tareas });
  res = await api.POST(req(await token(), registro({ items: [{ punto: "aceite", nombre: "Cambio de aceite", estado: "bien" }] })));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Falta marcar Filtro/);
  mockRuta({ tareas });
  res = await api.POST(req(await token(), registro({ items: [{ punto: "aceite", nombre: "Cambio de aceite", estado: "bien" }, { punto: "filtro", nombre: "Filtro", estado: "mal" }] })));
  assert.equal(res.status, 400, "lo que está mal necesita nota");

  escrito = mockRuta({ tareas });
  res = await api.POST(req(await token(), registro()));
  assert.equal(res.status, 200);
  const r = escrito.find((x) => x.tabla === "maquina_registros").body;
  assert.deepEqual([r.tarea_nombre, r.maquina_id, r.horas, r.mal, r.revisar, r.empleado_nombre], ["Aceite", 5, 1050, 1, 0, "Ana"]);
  assert.deepEqual(escrito.find((x) => x.tabla === "maquina_tareas" && x.metodo === "PATCH").body, { ultima_fecha: "2026-10-20", ultima_horas: 1050 });
  assert.equal(escrito.find((x) => x.tabla === "maquinas" && x.metodo === "PATCH").body.horas, 1050);
  const falla = escrito.find((x) => x.tabla === "maquina_fallas").body;
  assert.deepEqual(falla.map((f) => [f.origen, f.descripcion, f.registro_id, f.maquina_id]), [["tarea", "Filtro: Roto", 70, 5]], "lo que quedó Mal pasa a fallas");

  // Un registro más viejo que el último no atrasa la tarea
  escrito = mockRuta({ tareas: [{ ...tareas[0], ultima_fecha: "2026-10-22" }] });
  res = await api.POST(req(await token(), registro({ horas: 990 })));
  assert.equal(res.status, 200);
  assert.ok(!escrito.some((x) => x.tabla === "maquina_tareas" && x.metodo === "PATCH"));
  assert.ok(!escrito.some((x) => x.tabla === "maquinas" && x.metodo === "PATCH"), "las horas no bajan");
});

// ─── Pantalla ───

const MAQUINAS = [
  { id: 1, codigo: "SEC-01", nombre: "Seccionadora", tipo: "seccionadora", criticidad: "A", estado: "en_servicio", activo: true },
  { id: 2, codigo: "SOL-01", nombre: "Soldadora 1", tipo: "soldadora", criticidad: "C", estado: "en_servicio", activo: true },
  { id: 3, codigo: "PRE-01", nombre: "Prensa", tipo: "prensa", criticidad: "B", estado: "parada", activo: true },
];
const TAREAS = [
  { id: 10, maquina_id: 1, nombre: "Limpieza y revisión semanal", cada_dias: 7, aviso_dias: 1, ultima_fecha: "2020-01-01", checklist: [{ id: "a", nombre: "Sierra" }], activa: true },
  { id: 11, maquina_id: 2, nombre: "Revisión semanal", cada_dias: 7, aviso_dias: 1, ultima_fecha: "2099-01-01", checklist: [{ id: "a", nombre: "Cables" }], activa: true },
];

function mockPantalla() {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/maquinaria")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, maquina: { id: 9 } }), { status: 200 });
    }
    const path = body?.path || "";
    const data = path.startsWith("maquinas") ? MAQUINAS : path.startsWith("maquina_tareas") ? TAREAS : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return enviados;
}

test("pantalla — semáforo con lo vencido arriba, alertas y alta con el plan del tipo", async () => {
  const enviados = mockPantalla();
  render(<MaquinariaScreen empresaId={E} usuario={{ rol: "gerencial" }} />);
  const lista = await screen.findByRole("list", { name: "Máquinas" });
  const botones = [...lista.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  assert.deepEqual(botones, ["Ver SEC-01", "Ver PRE-01", "Ver SOL-01"], "vencidas primero (la A antes), las al día al final");
  assert.ok(screen.getByText("🔴 Parada"));

  fireEvent.click(screen.getByRole("button", { name: /🔔 Alertas \(2\)/ }));
  const alertas = screen.getByRole("list", { name: "Alertas de la maquinaria" });
  assert.match(alertas.textContent, /Limpieza y revisión semanal: vencida hace/);
  assert.match(alertas.textContent, /Máquina parada/);

  fireEvent.click(screen.getByRole("button", { name: /Máquinas/ }));
  fireEvent.click(screen.getByRole("button", { name: "＋ Agregar máquina" }));
  fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "compresor" } });
  assert.equal(screen.getByLabelText("Nombre").value, "Compresor", "toma el nombre del tipo");
  fireEvent.change(screen.getByLabelText("Código"), { target: { value: "COMP-01" } });
  assert.ok(screen.getByText(/Cargar el plan de compresor/));
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].tipo, enviados[0].con_plantilla, enviados[0].criticidad], ["maquina_guardar", "compresor", true, "B"]);
});

test("pantalla — sin la migración avisa; un operario no ve los botones de carga", async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: 'La tabla "maquinas" no existe todavía en la base' }), { status: 409 });
  render(<MaquinariaScreen empresaId={E} usuario={{ rol: "gerencial" }} />);
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /migración 132/));
  cleanup();
  mockPantalla();
  render(<MaquinariaScreen empresaId={E} usuario={{ rol: "operativo" }} />);
  await screen.findByRole("list", { name: "Máquinas" });
  assert.equal(screen.queryByRole("button", { name: "＋ Agregar máquina" }), null);
});
