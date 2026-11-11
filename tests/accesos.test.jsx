// tests/accesos.test.jsx — Accesos por persona (migración 181, pedido del
// 11/11): el titular elige qué módulos ve cada persona de la oficina y quién
// cambia la configuración.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { accesoDe, accesoSinMigracion, modulosDePersona, puedeConfigurar, esTitular, limpiarOcultos } = await import("../app/lib/accesos.js");
const { requireModuloSesion, rechazarSiNoConfigura, accesoSesion, invalidarCacheAccesos } = await import("../app/lib/accesosServidor.js");
const { invalidarCachePlan } = await import("../app/lib/planEnforcement.js");
const { seccionesMas, opcionesBoton } = await import("../app/lib/menuGestion.js");
const { MIGRACIONES } = await import("../app/lib/esquemaMigraciones.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const apiAccesos = await import("../app/api/accesos/route.js");
const apiModulos = await import("../app/api/modulos/route.js");
const { default: AccesosScreen } = await import("../app/components/screens/AccesosScreen.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const TITULAR = "22222222-2222-4222-8222-222222222222";
const SOCIO = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";

const GENTE = [
  { id: TITULAR, nombre: "Tadeo", legajo: 1, rol: "gerencial", solo_su_division: false },
  { id: SOCIO, nombre: "Socio", legajo: 2, rol: "gerencial", solo_su_division: false },
  { id: ADMIN, nombre: "Ana", legajo: 3, rol: "administrativo", solo_su_division: true },
];

/** Base simulada: plan Planta, las filas de accesos y lo que se guarda. */
function base({ filas = [{ empleado_id: TITULAR, es_titular: true, puede_configurar: true, modulos_ocultos: [] }] } = {}) {
  invalidarCachePlan(E);
  invalidarCacheAccesos(E);
  const guardado = [];
  global.fetch = createFetchMock([
    {
      match: (u) => u.includes("/rest/v1/accesos_personas"),
      respond: (u, o) => {
        if (o.method === "POST") {
          const fila = JSON.parse(o.body);
          guardado.push(fila);
          const i = filas.findIndex((f) => f.empleado_id === fila.empleado_id);
          if (i >= 0) filas[i] = { ...filas[i], ...fila }; else filas.push(fila);
          return { status: 201 };
        }
        return { status: 200, body: filas };
      },
    },
    { match: (u) => u.includes("select=plan_activo,plan_vence"), respond: () => ({ status: 200, body: [{ plan_activo: "planta_40" }] }) },
    { match: (u) => u.includes("select=addons"), respond: () => ({ status: 200, body: [{ addons: [] }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?empresa_id=") && u.includes("rol=in."), respond: () => ({ status: 200, body: GENTE }) },
    ...authPassHandlers(),
  ]);
  return guardado;
}

const sesion = (empleado_id, rol = "gerencial") => ({ empresa_id: E, empleado_id, rol, legajo: 1 });
async function token(empleadoId, rol = "gerencial") {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 1, rol })).token;
}
const req = (t, method = "GET", body) => new Request("http://localhost/api/accesos", {
  method, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
});

// ─── Reglas ─────────────────────────────────────────────────────────────────

test("accesoDe — titular ve todo; oficina sin elegir: todo menos Finanzas y sin configurar; operario no cambia", () => {
  assert.deepEqual(accesoDe({ rol: "gerencial", titular: true }), { titular: true, puede_configurar: true, ocultos: [] });
  assert.deepEqual(accesoDe({ rol: "gerencial" }), { titular: false, puede_configurar: false, ocultos: ["finanzas"] });
  assert.deepEqual(accesoDe({ rol: "administrativo" }), { titular: false, puede_configurar: false, ocultos: ["finanzas"] });
  assert.deepEqual(accesoDe({ rol: "operativo" }), { titular: false, puede_configurar: false, ocultos: [] });
  assert.deepEqual(
    accesoDe({ rol: "gerencial", fila: { puede_configurar: true, modulos_ocultos: ["compras", "inventado", "compras"] } }),
    { titular: false, puede_configurar: true, ocultos: ["compras"] }
  );
  assert.deepEqual(limpiarOcultos(["finanzas", 3, "nada"]), ["finanzas"]);
  // Sin la 181, como antes
  assert.deepEqual(accesoSinMigracion("administrativo"), { titular: false, puede_configurar: true, ocultos: [], sin_migracion: true });
});

test("modulosDePersona — lo oculto sale de los módulos y se ve como apagado (sin candado)", () => {
  assert.deepEqual(
    modulosDePersona({ modulos: ["fichaje", "compras", "finanzas"], apagados: ["flota"] }, ["finanzas"]),
    { modulos: ["fichaje", "compras"], modulos_apagados: ["flota", "finanzas"] }
  );
});

test("menú — quien no configura ve la configuración en solo lectura, sin Módulos ni Accesos; el titular ve Accesos", () => {
  const usuario = { rol: "gerencial" };
  const empresa = { modulos: ["fichaje", "proyectos"], modulos_apagados: [] };
  const mira = seccionesMas({ empresa: { ...empresa, acceso: { titular: false, puede_configurar: false } }, usuario });
  assert.ok(!mira.some((s) => s.id === "modulos" || s.id === "accesos"));
  assert.equal(mira.find((s) => s.id === "admin").soloLectura, true);
  assert.equal(mira.find((s) => s.id === "produccion").soloLectura, true);
  assert.equal(mira.find((s) => s.id === "privacidad").soloLectura, false);

  const designado = seccionesMas({ empresa: { ...empresa, acceso: { titular: false, puede_configurar: true } }, usuario });
  assert.ok(designado.some((s) => s.id === "modulos"));
  assert.ok(!designado.some((s) => s.id === "accesos"));
  assert.equal(designado.find((s) => s.id === "admin").soloLectura, false);

  const titular = { ...empresa, acceso: { titular: true, puede_configurar: true } };
  assert.ok(seccionesMas({ empresa: titular, usuario }).some((s) => s.id === "accesos"));
  assert.equal(esTitular(titular), true);
  // Sin el dato (versión vieja en caché), como antes: la gestión configura
  assert.equal(puedeConfigurar({}, usuario), true);
  assert.equal(puedeConfigurar({}, { rol: "operativo" }), false);
});

test("menú — Finanzas oculta para la persona no aparece en la barra", () => {
  const usuario = { rol: "gerencial" };
  const conFin = { modulos: ["proyectos", "finanzas"], modulos_apagados: [] };
  assert.ok(opcionesBoton("finanzas", conFin, usuario).length > 0);
  const oculta = { ...conFin, ...modulosDePersona({ modulos: conFin.modulos, apagados: [] }, ["finanzas"]) };
  assert.equal(opcionesBoton("finanzas", oculta, usuario).length, 0);
});

// ─── Servidor ───────────────────────────────────────────────────────────────

test("servidor — otro Dueño sin elegir no entra a Finanzas; el titular sí; el operario no se toca", async () => {
  base();
  assert.equal(await requireModuloSesion(sesion(TITULAR), "finanzas"), null);
  const res = await requireModuloSesion(sesion(SOCIO), "finanzas");
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /No tenés acceso a Finanzas/);
  assert.equal(await requireModuloSesion(sesion(SOCIO), "compras"), null);
  assert.equal(await requireModuloSesion(sesion("55555555-5555-4555-8555-555555555555", "operativo"), "stock"), null);
});

test("servidor — un módulo ocultado a mano se corta; habilitarle Finanzas la abre", async () => {
  base({ filas: [
    { empleado_id: TITULAR, es_titular: true, puede_configurar: true, modulos_ocultos: [] },
    { empleado_id: SOCIO, es_titular: false, puede_configurar: false, modulos_ocultos: ["compras"] },
  ] });
  assert.equal((await requireModuloSesion(sesion(SOCIO), "compras")).status, 403);
  assert.equal(await requireModuloSesion(sesion(SOCIO), "finanzas"), null);
});

test("servidor — solo configura el titular o quien él designe", async () => {
  base({ filas: [
    { empleado_id: TITULAR, es_titular: true, puede_configurar: true, modulos_ocultos: [] },
    { empleado_id: ADMIN, es_titular: false, puede_configurar: true, modulos_ocultos: ["finanzas"] },
  ] });
  assert.equal(await rechazarSiNoConfigura(sesion(TITULAR)), null);
  assert.equal(await rechazarSiNoConfigura(sesion(ADMIN, "administrativo")), null);
  const res = await rechazarSiNoConfigura(sesion(SOCIO));
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /titular de la cuenta o quien él designe/);
  // Más → Módulos también es configuración
  assert.equal((await apiModulos.GET(new Request("http://localhost/api/modulos", { headers: { Authorization: `Bearer ${await token(SOCIO)}` } }))).status, 403);
});

test("servidor — sin titular marcado, es el Dueño con el email de la empresa", async () => {
  base({ filas: [] });
  const previo = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("select=admin_email")) return new Response(JSON.stringify([{ admin_email: "Socio@Mail.com" }]), { status: 200 });
    if (u.includes("rol=eq.gerencial")) return new Response(JSON.stringify([{ id: TITULAR, email: "otro@mail.com" }, { id: SOCIO, email: "socio@mail.com" }]), { status: 200 });
    return previo(url, opts);
  };
  assert.equal((await accesoSesion(sesion(SOCIO))).titular, true);
  assert.equal((await accesoSesion(sesion(TITULAR))).titular, false);
});

test("servidor — sin la migración 181 todo sigue como antes", async () => {
  invalidarCacheAccesos(E);
  global.fetch = createFetchMock([...authPassHandlers()]);
  const a = await accesoSesion(sesion(SOCIO));
  assert.equal(a.sin_migracion, true);
  assert.deepEqual(a.ocultos, []);
  assert.equal(await rechazarSiNoConfigura(sesion(ADMIN, "administrativo")), null);
});

// ─── /api/accesos ───────────────────────────────────────────────────────────

test("/api/accesos — solo el titular; lista la oficina con lo que ve cada uno", async () => {
  base();
  assert.equal((await apiAccesos.GET(req(await token(SOCIO)))).status, 403);
  const res = await apiAccesos.GET(req(await token(TITULAR)));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.personas[0].id, TITULAR);
  assert.equal(d.personas[0].titular, true);
  const socio = d.personas.find((p) => p.id === SOCIO);
  assert.deepEqual(socio.ocultos, ["finanzas"]);
  assert.equal(socio.puede_configurar, false);
  assert.equal(d.personas.find((p) => p.id === ADMIN).supervisor, true);
  assert.ok(d.modulos.find((m) => m.id === "finanzas").solo_dueno);
});

test("/api/accesos PATCH — designa, oculta; Finanzas nunca para Administración; no se toca a sí mismo", async () => {
  const guardado = base();
  const t = await token(TITULAR);
  let res = await apiAccesos.PATCH(req(t, "PATCH", { empleado_id: SOCIO, puede_configurar: true, modulos_ocultos: [] }));
  assert.equal(res.status, 200);
  assert.deepEqual(guardado.at(-1), { ...guardado.at(-1), empleado_id: SOCIO, puede_configurar: true, modulos_ocultos: [], es_titular: false, empresa_id: E });
  assert.equal(await rechazarSiNoConfigura(sesion(SOCIO)), null);

  res = await apiAccesos.PATCH(req(t, "PATCH", { empleado_id: ADMIN, modulos_ocultos: ["compras"] }));
  assert.equal(res.status, 200);
  assert.deepEqual(guardado.at(-1).modulos_ocultos.sort(), ["compras", "finanzas"]);

  assert.equal((await apiAccesos.PATCH(req(t, "PATCH", { empleado_id: TITULAR, puede_configurar: false }))).status, 400);
  assert.equal((await apiAccesos.PATCH(req(t, "PATCH", { empleado_id: "no-es-uuid" }))).status, 400);
});

test("/api/accesos PATCH — pasar la titularidad solo a otro Dueño; el que la deja sigue configurando", async () => {
  const guardado = base();
  const t = await token(TITULAR);
  assert.equal((await apiAccesos.PATCH(req(t, "PATCH", { empleado_id: ADMIN, titular: true }))).status, 400);
  assert.equal((await apiAccesos.PATCH(req(t, "PATCH", { empleado_id: SOCIO, titular: true }))).status, 200);
  assert.equal(guardado.find((f) => f.empleado_id === SOCIO).es_titular, true);
  assert.deepEqual(
    (({ es_titular, puede_configurar, modulos_ocultos }) => ({ es_titular, puede_configurar, modulos_ocultos }))(guardado.find((f) => f.empleado_id === TITULAR)),
    { es_titular: false, puede_configurar: true, modulos_ocultos: [] }
  );
  assert.equal((await accesoSesion(sesion(SOCIO))).titular, true);
});

// ─── Pantalla ───────────────────────────────────────────────────────────────

test("pantalla Accesos — tildar un módulo y dar permiso de configurar", async () => {
  const guardado = base();
  // La pantalla usa apiFetch (cookie de sesión): se le pone el token a mano
  const previo = global.fetch;
  const t = await token(TITULAR);
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith("/api/accesos")) {
      const r = new Request(`http://localhost${u}`, { method: opts.method || "GET", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: opts.body });
      return (opts.method === "PATCH" ? apiAccesos.PATCH : apiAccesos.GET)(r);
    }
    return previo(url, opts);
  };
  render(<AccesosScreen />);
  const finSocio = await screen.findAllByRole("button", { name: "Finanzas: oculto" });
  fireEvent.click(finSocio[0]);
  await waitFor(() => assert.deepEqual(guardado.at(-1)?.modulos_ocultos, []));
  fireEvent.click(screen.getByRole("switch", { name: "Socio: puede cambiar configuraciones" }));
  await waitFor(() => assert.equal(guardado.at(-1)?.puede_configurar, true));
  // A Administración no se le puede dar Finanzas
  const finAna = screen.getAllByRole("button", { name: "Finanzas: oculto" }).find((b) => b.disabled);
  assert.ok(finAna);
});

// ─── Migración ──────────────────────────────────────────────────────────────

test("migración 181 — un solo bloque, tabla solo del servidor, un titular por empresa y en la lista del chequeo", () => {
  const sql = readFileSync(new URL("../supabase/migrations/181_accesos_personas.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/^do \$mig\$/gm) || []).length, 1);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.accesos_personas from anon, authenticated/);
  assert.match(sql, /default '\{finanzas\}'/);
  assert.match(sql, /admin_email/);
  assert.ok(MIGRACIONES.some((m) => m.n === 181 && m.tablas.accesos_personas));
});
