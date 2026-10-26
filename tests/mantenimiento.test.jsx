// tests/mantenimiento.test.jsx — Mantenimiento, parte 34 (ítem 43, migración
// 133): responsables de mantenimiento con suplente para vehículos y máquinas.
// Ven "🔧 Mi mantenimiento" en su Inicio y hacen los checklists; el checklist
// de un vehículo pasa a ser solo de ellos (el chofer queda para su licencia).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  CAMPOS_MAQUINA, CAMPOS_VEHICULO, aCargoDe, conResponsables, destinatarios, detalleMiMantenimiento, leToca, miMantenimiento,
  opcionesResponsable, puedeChecklistVehiculo,
} from "../app/lib/mantenimiento.js";
import { avisoDelDiaMaquina, alertasMaquinaria } from "../app/lib/maquinaria.js";
import { flotaBody, maquinariaBody } from "../app/lib/schemas.ts";
import { modulosEfectivos } from "../app/lib/modulos.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const flota = await import("../app/api/flota/route.js");
const maquinaria = await import("../app/api/maquinaria/route.js");
const { revisarMaquinaria } = await import("../app/lib/maquinariaAlertasServidor.js");
const { default: HomeEmp } = await import("../app/components/screens/HomeEmp.jsx");
const { default: AsignarMantenimiento } = await import("../app/components/AsignarMantenimiento.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const OFI = "22222222-2222-2222-2222-222222222222";
const CHOFER = "33333333-3333-3333-3333-333333333333";
const MANT = "44444444-4444-4444-4444-444444444444";
const SUP = "55555555-5555-5555-5555-555555555555";
const HOY = "2026-10-25";

// ─── Reglas ───

test("a cargo — responsable o suplente; sin la 133 el chofer sigue haciendo el checklist", () => {
  const v = { id: 7, responsable_id: CHOFER, mant_responsable_id: MANT, mant_suplente_id: SUP };
  assert.ok(conResponsables(v, CAMPOS_VEHICULO));
  assert.ok(aCargoDe(v, MANT, CAMPOS_VEHICULO) && aCargoDe(v, SUP, CAMPOS_VEHICULO));
  assert.equal(aCargoDe(v, CHOFER, CAMPOS_VEHICULO), false);
  assert.equal(puedeChecklistVehiculo(v, { empleadoId: CHOFER }), false, "con la 133 el chofer ya no");
  assert.equal(puedeChecklistVehiculo(v, { empleadoId: SUP }), true);
  assert.equal(puedeChecklistVehiculo(v, { empleadoId: OFI, gestion: true }), true, "la oficina de cualquiera");
  assert.equal(puedeChecklistVehiculo({ ...v, mant_responsable_id: null, mant_suplente_id: null }, { empleadoId: CHOFER }), false, "sin asignar, solo la oficina");
  const viejo = { id: 7, responsable_id: CHOFER };
  assert.equal(conResponsables(viejo, CAMPOS_VEHICULO), false);
  assert.equal(puedeChecklistVehiculo(viejo, { empleadoId: CHOFER }), true, "sin la 133, como antes");

  const m = { id: 1, codigo: "SEC-01", activo: true, responsable_id: MANT, suplente_id: null };
  assert.ok(aCargoDe(m, MANT, CAMPOS_MAQUINA));
  assert.deepEqual(leToca(MANT, { vehiculos: [v, { ...v, id: 8, patente: "X", activo: false }].map((x, i) => ({ ...x, patente: x.patente || "AB123CD", activo: i === 0 })), maquinas: [m] }), ["SEC-01", "AB123CD"]);

  // Se eligen los marcados, y los que ya están asignados aunque se les haya sacado la casilla
  const empleados = [{ id: MANT, nombre: "Mario", es_mantenimiento: true }, { id: SUP, nombre: "Sofía" }, { id: CHOFER, nombre: "Juan" }];
  assert.deepEqual(opcionesResponsable(empleados).map((e) => e.id), [MANT]);
  assert.deepEqual(opcionesResponsable(empleados, [SUP]).map((e) => e.id), [MANT, SUP]);

  // Aviso al celular: responsable y suplente; sin ellos, el chofer
  assert.deepEqual(destinatarios(v, CAMPOS_VEHICULO, { choferId: CHOFER }), [MANT, SUP]);
  assert.deepEqual(destinatarios({ id: 7 }, CAMPOS_VEHICULO, { choferId: CHOFER }), [CHOFER]);
  assert.deepEqual(destinatarios(m, CAMPOS_MAQUINA), [MANT]);
});

test("mi mantenimiento — vehículos y máquinas a cargo, lo vencido arriba", () => {
  const vehiculos = [{ id: 7, patente: "AB123CD", km: 1000, activo: true, mant_responsable_id: null, mant_suplente_id: MANT }];
  const maquinas = [
    { id: 1, codigo: "SEC-01", nombre: "Seccionadora", criticidad: "A", estado: "en_servicio", activo: true, responsable_id: MANT },
    { id: 2, codigo: "CNC-01", nombre: "CNC", criticidad: "A", estado: "en_servicio", activo: true, responsable_id: MANT },
    { id: 3, codigo: "OTRA", nombre: "De otro", criticidad: "A", estado: "en_servicio", activo: true, responsable_id: SUP },
  ];
  const tareas = [
    { id: 10, maquina_id: 1, nombre: "Semanal", cada_dias: 7, aviso_dias: 1, ultima_fecha: "2026-10-24", activa: true },
    { id: 11, maquina_id: 2, nombre: "Semanal", cada_dias: 7, aviso_dias: 1, ultima_fecha: "2026-10-01", activa: true },
  ];
  // El vehículo ya tiene un checklist completo de ayer: al día salvo el service sin cargar
  const todas = ["limpieza", "fluidos", "neumaticos", "luces", "itv", "documentacion"];
  const checklists = [{ vehiculo_id: 7, created_at: "2026-10-24T13:00:00Z", km: 1000, secciones: todas }];
  const items = miMantenimiento(MANT, { vehiculos, maquinas, tareas, checklists, hoy: HOY });
  assert.deepEqual(items.map((x) => x.id), ["m-2", "v-7", "m-1"], "vencido, pronto (falta el service), al día");
  assert.equal(items[1].rol, "suplente");
  assert.equal(items[0].tareas[0].nivel, "vencido");
  assert.equal(detalleMiMantenimiento(items), "3 a cargo · 🔴 1 vencida · 🟡 1 para pronto");
  assert.equal(detalleMiMantenimiento([]), "Todavía no tenés vehículos ni máquinas a cargo");
  // Los papeles del vehículo los ve la oficina: no aparecen acá
  const papeles = [{ id: 1, vehiculo_id: 7, tipo: "seguro", vencimiento: "2026-10-01", created_at: "2026-01-01T00:00:00Z" }];
  assert.ok(!miMantenimiento(MANT, { vehiculos, papeles, checklists, hoy: HOY })[0].urgentes.some((a) => a.tipo === "papel"));
});

test("migración 133, validación y avisos sin repetir", () => {
  const sql = readFileSync(new URL("../supabase/migrations/133_responsables_mantenimiento.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  for (const c of ["es_mantenimiento", "mant_responsable_id", "mant_suplente_id", "suplente_id", "aviso_firma", "aviso_at"]) assert.ok(sql.includes(c), c);

  assert.ok(flotaBody.safeParse({ accion: "mantenimiento_asignar", vehiculo_id: 7, responsable_id: MANT, suplente_id: SUP }).success);
  assert.ok(flotaBody.safeParse({ accion: "mantenimiento_asignar", vehiculo_id: 7, responsable_id: null }).success, "se puede sacar");
  assert.ok(!flotaBody.safeParse({ accion: "mantenimiento_asignar", vehiculo_id: 7, responsable_id: "x" }).success);
  assert.ok(maquinariaBody.safeParse({ accion: "responsables_guardar", maquina_id: 1, responsable_id: MANT }).success);

  const m = { id: 1, codigo: "SEC-01", criticidad: "A", activo: true, estado: "en_servicio", aviso_firma: null };
  const tareas = [{ id: 10, maquina_id: 1, nombre: "Semanal", cada_dias: 7, ultima_fecha: "2026-10-01", activa: true }];
  const alertas = alertasMaquinaria([m], tareas, HOY);
  const a = avisoDelDiaMaquina(m, alertas);
  assert.equal(a.nuevas.length, 1);
  assert.ok(a.cambio);
  const b = avisoDelDiaMaquina({ ...m, aviso_firma: a.firma }, alertas);
  assert.deepEqual([b.nuevas.length, b.cambio], [0, false], "al otro día no se repite");
  assert.ok(avisoDelDiaMaquina({ ...m, aviso_firma: a.firma }, []).cambio, "al ponerse al día se borra la firma");
});

// ─── API ───

function mockApi({ vehiculo = null, maquina = null, tareas = [], sin133 = false, marcados = [] } = {}) {
  const escrito = [];
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return body;
  };
  const faltaColumna = { status: 400, body: { code: "PGRST204", message: "Could not find the 'mant_responsable_id' column of 'vehiculos' in the schema cache" } };
  const faltaColumnaMaq = { status: 400, body: { code: "PGRST204", message: "Could not find the 'responsable_id' column of 'maquinas' in the schema cache" } };
  global.fetch = createFetchMock([
    // ¿Responsable de mantenimiento? (pestaña Mantenimiento, 26/10)
    { match: (u) => u.includes("/rest/v1/empleados?id=eq.") && u.includes("select=es_mantenimiento"), respond: (u) => ({ status: 200, body: [{ es_mantenimiento: marcados.some((id) => u.includes(id)) }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?id=eq.") && u.includes("select=nombre"), respond: () => ({ status: 200, body: [{ nombre: "Mario" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?id=eq."), respond: (u) => ({ status: 200, body: [MANT, SUP, CHOFER].some((id) => u.includes(id)) ? [{ id: "x" }] : [] }) },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/flota_config"), respond: () => ({ status: 200, body: [{ checklist: [{ id: "luces", nombre: "Luces", puntos: [{ id: "bajas", nombre: "Bajas" }] }] }] }) },
    { match: (u) => u.includes("/rest/v1/vehiculo_arreglos"), respond: (u, o) => { anotar("vehiculo_arreglos", u, o); return { status: 201, body: [] }; } },
    { match: (u) => u.includes("/rest/v1/vehiculo_checklists"), respond: (u, o) => ({ status: 201, body: [{ id: 1, ...anotar("vehiculo_checklists", u, o) }] }) },
    {
      match: (u) => u.includes("/rest/v1/vehiculos"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: vehiculo ? [vehiculo] : [] };
        if (sin133) return faltaColumna;
        return { status: 200, body: [{ ...vehiculo, ...anotar("vehiculos", u, o) }] };
      },
    },
    { match: (u) => u.includes("/rest/v1/maquina_registros"), respond: (u, o) => ({ status: 201, body: [{ id: 70, ...anotar("maquina_registros", u, o) }] }) },
    {
      match: (u) => u.includes("/rest/v1/maquina_tareas"),
      respond: (u, o) => (!o.method || o.method === "GET" ? { status: 200, body: tareas } : { status: 200, body: [anotar("maquina_tareas", u, o)] }),
    },
    {
      match: (u) => u.includes("/rest/v1/maquinas"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: maquina ? [maquina] : [] };
        if (sin133) return faltaColumnaMaq;
        return { status: 200, body: [{ ...maquina, ...anotar("maquinas", u, o) }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol = "operativo", empleadoId = MANT) {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 9, rol })).token;
}
const req = (ruta, t, body) => new Request(`http://localhost/api/${ruta}`, {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

const CHK = {
  accion: "checklist_crear", vehiculo_id: 7, km: 1500, combustible: "1/2", secciones: ["luces"],
  items: [{ seccion: "luces", seccion_nombre: "Luces", punto: "bajas", nombre: "Bajas", estado: "mal", nota: "Quemada", foto: "https://x.test/f.jpg" }],
};

test("/api/flota — con la 133 el checklist lo hacen el responsable de mantenimiento y el suplente, no el chofer", async () => {
  const vehiculo = { id: 7, km: 1000, activo: true, responsable_id: CHOFER, mant_responsable_id: MANT, mant_suplente_id: SUP };
  mockApi({ vehiculo });
  let res = await flota.POST(req("flota", await token("operativo", CHOFER), CHK));
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /responsable de mantenimiento/);

  let escrito = mockApi({ vehiculo });
  assert.equal((await flota.POST(req("flota", await token("operativo", SUP), CHK))).status, 200);
  const arr = escrito.find((x) => x.tabla === "vehiculo_arreglos").body;
  assert.equal(arr[0].responsable_id, MANT, "lo que quedó mal queda a cargo del responsable de mantenimiento");

  // Sin la 133, el chofer como antes
  mockApi({ vehiculo: { id: 7, km: 1000, activo: true, responsable_id: CHOFER } });
  assert.equal((await flota.POST(req("flota", await token("operativo", CHOFER), CHK))).status, 200);
});

test("/api/flota mantenimiento_asignar — solo la oficina; el suplente es otra persona; sin la 133 avisa", async () => {
  const vehiculo = { id: 7, activo: true, mant_responsable_id: null, mant_suplente_id: null };
  mockApi({ vehiculo });
  assert.equal((await flota.POST(req("flota", await token("operativo"), { accion: "mantenimiento_asignar", vehiculo_id: 7, responsable_id: MANT }))).status, 403);

  mockApi({ vehiculo });
  let res = await flota.POST(req("flota", await token("administrativo", OFI), { accion: "mantenimiento_asignar", vehiculo_id: 7, responsable_id: MANT, suplente_id: MANT }));
  assert.equal(res.status, 400);

  let escrito = mockApi({ vehiculo });
  res = await flota.POST(req("flota", await token("administrativo", OFI), { accion: "mantenimiento_asignar", vehiculo_id: 7, responsable_id: MANT, suplente_id: SUP }));
  assert.equal(res.status, 200);
  const p = escrito.find((x) => x.tabla === "vehiculos").body;
  assert.deepEqual([p.mant_responsable_id, p.mant_suplente_id], [MANT, SUP]);

  // Sin responsable no queda suplente suelto
  escrito = mockApi({ vehiculo });
  await flota.POST(req("flota", await token("gerencial", OFI), { accion: "mantenimiento_asignar", vehiculo_id: 7, responsable_id: null, suplente_id: SUP }));
  assert.equal(escrito.find((x) => x.tabla === "vehiculos").body.mant_suplente_id, null);

  mockApi({ vehiculo, sin133: true });
  res = await flota.POST(req("flota", await token("administrativo", OFI), { accion: "mantenimiento_asignar", vehiculo_id: 7, responsable_id: MANT }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 133/);
});

test("/api/maquinaria — el responsable registra la tarea de su máquina; otro operario no; la oficina asigna", async () => {
  const maquina = { id: 1, codigo: "SEC-01", horas: null, con_horometro: false, responsable_id: SUP, suplente_id: MANT };
  const tareas = [{ id: 10, maquina_id: 1, nombre: "Semanal", activa: true, checklist: [{ id: "a", nombre: "Sierra" }] }];
  const registro = { accion: "registro_crear", tarea_id: 10, fecha: "2026-10-25", items: [{ punto: "a", nombre: "Sierra", estado: "bien" }] };
  let escrito = mockApi({ maquina, tareas });
  assert.equal((await maquinaria.POST(req("maquinaria", await token(), registro))).status, 200, "el suplente");
  assert.equal(escrito.find((x) => x.tabla === "maquina_registros").body.empleado_id, MANT);

  mockApi({ maquina, tareas });
  assert.equal((await maquinaria.POST(req("maquinaria", await token("operativo", CHOFER), registro))).status, 403);
  mockApi({ maquina, tareas });
  assert.equal((await maquinaria.POST(req("maquinaria", await token(), { accion: "horas_guardar", id: 1, horas: 10 }))).status, 403, "lo demás sigue siendo de la oficina");

  escrito = mockApi({ maquina, tareas });
  assert.equal((await maquinaria.POST(req("maquinaria", await token("administrativo", OFI), { accion: "responsables_guardar", maquina_id: 1, responsable_id: MANT, suplente_id: SUP }))).status, 200);
  const p = escrito.find((x) => x.tabla === "maquinas").body;
  assert.deepEqual([p.responsable_id, p.suplente_id], [MANT, SUP]);

  mockApi({ maquina, tareas, sin133: true });
  const res = await maquinaria.POST(req("maquinaria", await token("administrativo", OFI), { accion: "responsables_guardar", maquina_id: 1, responsable_id: MANT }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 133/);
});

test("aviso diario de la maquinaria — al responsable y al suplente, y a gerencia; no repite", async () => {
  const parches = [];
  const enviados = [];
  const messaging = { send: async (m) => { enviados.push(m); } };
  const maquinas = [{ id: 1, codigo: "SEC-01", nombre: "Seccionadora", criticidad: "A", estado: "en_servicio", activo: true, responsable_id: MANT, suplente_id: SUP, aviso_firma: null }];
  const tareas = [{ id: 10, maquina_id: 1, nombre: "Semanal", cada_dias: 7, ultima_fecha: "2026-10-01", activa: true }];
  const pag = (u, filas) => ({ status: 200, body: u.includes("offset=0") ? filas : [] });
  const mock = () => {
    global.fetch = createFetchMock([
      { match: (u, o) => u.includes("/rest/v1/maquinas") && o?.method === "PATCH", respond: (u, o) => { parches.push({ url: u, body: JSON.parse(o.body) }); return { status: 200, body: [] }; } },
      { match: (u) => u.includes("/rest/v1/maquinas"), respond: (u) => pag(u, maquinas) },
      { match: (u) => u.includes("/rest/v1/maquina_tareas"), respond: (u) => pag(u, tareas) },
      { match: (u) => u.includes("/rest/v1/empleados"), respond: (u) => pag(u, u.includes("rol=in.") ? [{ legajo: 1 }] : [{ id: MANT, legajo: 5 }, { id: SUP, legajo: 6 }]) },
      {
        match: (u) => u.includes("/rest/v1/push_tokens"),
        respond: (u) => pag(u, [{ legajo: 5, token: "mant" }, { legajo: 6, token: "sup" }, { legajo: 1, token: "gerente" }].filter((t) => new RegExp(`legajo=in\\.\\([^)]*\\b${t.legajo}\\b`).test(u))),
      },
    ]);
  };
  mock();
  const r = await revisarMaquinaria({ id: E, slug: "acme" }, HOY, { messaging });
  assert.equal(r.avisados, 1);
  const a = (token) => enviados.find((m) => m.token === token)?.notification;
  assert.match(a("mant").title, /SEC-01: le toca mantenimiento/);
  assert.match(a("sup").body, /Semanal: vencida hace/);
  assert.match(a("gerente").title, /1 máquina con algo vencido/);
  assert.equal(parches.length, 1);
  assert.match(parches[0].body.aviso_firma, /tarea-10:vencido/);

  maquinas[0].aviso_firma = parches[0].body.aviso_firma;
  enviados.length = 0;
  parches.length = 0;
  mock();
  const r2 = await revisarMaquinaria({ id: E, slug: "acme" }, HOY, { messaging });
  assert.deepEqual([r2.avisados, enviados.length, parches.length], [0, 0, 0]);

  // Sin la 133 no avisa (no tendría dónde anotar lo avisado)
  delete maquinas[0].aviso_firma;
  mock();
  assert.equal((await revisarMaquinaria({ id: E, slug: "acme" }, HOY, { messaging })).maquinas, 0);
});

// ─── Pantallas ───

test("inicio del operario — 🔧 Mi mantenimiento con lo suyo; el chofer ya no ve el checklist del vehículo", async () => {
  const VEH = { id: 7, patente: "AB123CD", km: 1000, activo: true, responsable_id: MANT, mant_responsable_id: SUP, mant_suplente_id: null };
  const MAQ = { id: 1, codigo: "SEC-01", nombre: "Seccionadora", tipo: "seccionadora", criticidad: "A", estado: "en_servicio", activo: true, responsable_id: MANT, suplente_id: null };
  const TAREA = { id: 10, maquina_id: 1, nombre: "Limpieza semanal", cada_dias: 7, aviso_dias: 1, ultima_fecha: "2026-01-01", activa: true, checklist: [{ id: "a", nombre: "Sierra" }] };
  global.fetch = async (_u, o) => {
    const { path = "" } = o?.body ? JSON.parse(o.body) : {};
    const data = path.startsWith("vehiculos") ? [VEH] : path.startsWith("maquinas") ? [MAQ] : path.startsWith("maquina_tareas") ? [TAREA] : [];
    return Response.json({ ok: true, data });
  };
  render(
    <HomeEmp goto={() => {}} usuario={{ id: MANT, empresa_id: E, apodo: "Mario", rol: "operativo", es_mantenimiento: true }}
      empresa={{ modulos: modulosEfectivos({ plan: "planta_15" }) }}
      ctx={{ fichadaHoy: { ingreso: "08:00:00" }, misSolicitudes: [], fichadasSemana: [], notificaciones: [] }}
      etapas={[]} actividadesHoy={[]} />
  );
  const boton = await screen.findByRole("button", { name: /Mi mantenimiento/ });
  assert.match(boton.textContent, /1 a cargo · 🔴 1 vencida/);
  // Es chofer del AB123CD, pero el mantenimiento lo tiene otro: no ve el checklist
  assert.equal(screen.queryByRole("button", { name: /Checklist de mi vehículo/ }), null);
  fireEvent.click(boton);
  const tarea = await screen.findByRole("button", { name: "SEC-01: Limpieza semanal" });
  fireEvent.click(tarea);
  await waitFor(() => assert.ok(screen.getByText("Qué revisar")));
});

test("asignar — se elige entre los marcados; sin nadie marcado explica dónde hacerlo", async () => {
  const guardados = [];
  render(<AsignarMantenimiento empleados={[{ id: MANT, nombre: "Mario", es_mantenimiento: true }, { id: SUP, nombre: "Sofía", es_mantenimiento: true }, { id: CHOFER, nombre: "Juan" }]}
    editable onGuardar={async (r) => { guardados.push(r); }} />);
  assert.ok(screen.getByText("Sin responsable de mantenimiento"));
  fireEvent.click(screen.getByRole("button", { name: "Elegir" }));
  const opciones = [...screen.getByLabelText("Responsable").querySelectorAll("option")].map((o) => o.textContent);
  assert.deepEqual(opciones, ["Sin responsable", "Mario", "Sofía"]);
  fireEvent.change(screen.getByLabelText("Responsable"), { target: { value: MANT } });
  fireEvent.change(screen.getByLabelText("Suplente (opcional)"), { target: { value: SUP } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.deepEqual(guardados, [{ responsable_id: MANT, suplente_id: SUP }]));

  cleanup();
  render(<AsignarMantenimiento empleados={[{ id: CHOFER, nombre: "Juan" }]} editable onGuardar={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Elegir" }));
  assert.ok(screen.getByText(/marcá "Responsable de mantenimiento"/));
});

test("pantallas — casilla en el empleado, chofer habitual en el vehículo y responsables en la ficha", () => {
  const fuente = (r) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
  const equipo = fuente("app/gestion_personal_screen.jsx");
  assert.match(equipo, /Responsable de mantenimiento/);
  assert.match(equipo, /es_mantenimiento: !!form\.es_mantenimiento/);
  assert.match(fuente("app/api/empleados/route.js"), /"es_mantenimiento"/);
  const vehiculo = fuente("app/components/FichaVehiculo.jsx");
  assert.match(vehiculo, /label="Chofer habitual"/);
  assert.match(vehiculo, /mantenimiento_asignar/);
  assert.match(fuente("app/components/FichaMaquina.jsx"), /responsables_guardar/);
  assert.match(fuente("app/api/cron/flota-alertas/route.js"), /revisarMaquinaria/);
});

// ─── Pestaña Mantenimiento del responsable (pedido de Tadeo, 26/10) ───
const { puedeGestionarMantenimiento } = await import("../app/lib/mantenimiento.js");
const { getItems } = await import("../app/components/nav/BottomNav.jsx");

test("pestaña Mantenimiento — el responsable la ve en su barra; la oficina y el resto no", () => {
  assert.deepEqual(getItems("operativo", 0, undefined, { mantenimiento: true }).map((i) => i.label), ["Inicio", "Mantenimiento", "Permisos", "Mi cuenta"]);
  assert.equal(getItems("operativo", 0, ["fichaje"], { mantenimiento: true }).some((i) => i.id === "mantenimiento"), false, "sin Flota ni Maquinaria no aparece");
  assert.equal(getItems("operativo", 0).some((i) => i.id === "mantenimiento"), false);
  assert.ok(puedeGestionarMantenimiento({ rol: "operativo", es_mantenimiento: true }));
  assert.ok(puedeGestionarMantenimiento({ rol: "administrativo" }));
  assert.ok(!puedeGestionarMantenimiento({ rol: "operativo" }));
});

test("/api/flota y /api/maquinaria — el responsable da de alta y queda a cargo; licencias y borrar services siguen de la oficina", async () => {
  const alta = { accion: "vehiculo_guardar", patente: "AB 123 CD", tipo: "utilitario" };
  let escrito = mockApi({ marcados: [MANT] });
  let res = await flota.POST(req("flota", await token(), alta));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const v = escrito.find((x) => x.tabla === "vehiculos" && x.metodo === "POST").body;
  assert.equal(v.mant_responsable_id, MANT, "queda a su cargo");

  mockApi({ marcados: [] });
  assert.equal((await flota.POST(req("flota", await token(), alta))).status, 403, "un operario sin la casilla no");

  mockApi({ marcados: [MANT] });
  assert.equal((await flota.POST(req("flota", await token(), { accion: "mantenimiento_borrar", id: 3 }))).status, 403, "borrar un service es de la oficina");
  mockApi({ marcados: [MANT] });
  assert.equal((await flota.POST(req("flota", await token(), { accion: "licencia_guardar", empleado_id: CHOFER, categoria: "B1", vencimiento: null }))).status, 403, "la licencia es de la oficina");

  // La oficina da de alta sin quedar a cargo
  escrito = mockApi({});
  assert.equal((await flota.POST(req("flota", await token("administrativo", OFI), alta))).status, 200);
  assert.equal(escrito.find((x) => x.tabla === "vehiculos" && x.metodo === "POST").body.mant_responsable_id, undefined);

  const maq = { accion: "maquina_guardar", codigo: "CNC-03", nombre: "CNC 3", tipo: "cnc", criticidad: "A", con_horometro: false, estado: "en_servicio" };
  escrito = mockApi({ marcados: [MANT] });
  res = await maquinaria.POST(req("maquinaria", await token(), maq));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(escrito.find((x) => x.tabla === "maquinas" && x.metodo === "POST").body.responsable_id, MANT);
  mockApi({ maquina: { id: 1, codigo: "SEC-01", horas: 5, con_horometro: true }, marcados: [MANT] });
  assert.equal((await maquinaria.POST(req("maquinaria", await token(), { accion: "horas_guardar", id: 1, horas: 10 }))).status, 200, "también carga horas de cualquier máquina");
});

test("pantallas — el responsable edita Flota y Maquinaria; 💲 Costos, 📊 Indicadores y licencias quedan para la oficina", () => {
  const flotaSrc = readFileSync(new URL("../app/components/FlotaScreen.jsx", import.meta.url), "utf8");
  assert.match(flotaSrc, /const editable = puedeGestionarMantenimiento\(usuario\)/);
  assert.match(flotaSrc, /\{oficina && <Chip active=\{vista === "costos"\}/);
  assert.match(flotaSrc, /disabled=\{!oficina\}/);
  const maqSrc = readFileSync(new URL("../app/components/MaquinariaScreen.jsx", import.meta.url), "utf8");
  assert.match(maqSrc, /const editable = puedeGestionarMantenimiento\(usuario\)/);
  assert.match(maqSrc, /\{oficina && <Chip active=\{vista === "indicadores"\}/);
  const home = readFileSync(new URL("../app/[slug]/HomeContent.jsx", import.meta.url), "utf8");
  assert.match(home, /!uIsGer && screen === "mantenimiento" && u\?\.es_mantenimiento && <BotonGestionScreen/);
});
