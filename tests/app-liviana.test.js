// tests/app-liviana.test.js — La app se estaba poniendo pesada: cada rol pide
// solo lo que usa, "Más" baja cada sección al abrirla y el cliente de
// tiempo real no se descarga en la pantalla de ingreso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { consultasInicio, esGestion } = await import("../app/lib/cargaInicio.js");
const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const FECHAS = { hoy: "2026-10-08", lunes: "2026-10-05", ayer: "2026-10-07" };
const tablas = (c) => Object.values(c).map((x) => x.path.split("?")[0]);

test("operario — no baja la lista de empleados, las fichadas de todos ni los pedidos de todos", () => {
  const c = consultasInicio({ usuario: { rol: "operativo", legajo: 7 }, ...FECHAS });
  assert.deepEqual(Object.keys(c).sort(), ["fichadasSemana", "miAbierta", "miFichada", "misSolicitudes", "notificaciones"]);
  assert.ok(!tablas(c).includes("empleados"));
  assert.ok(!tablas(c).includes("reglas_bot"));
  // Todo lo suyo, filtrado por su legajo
  for (const { path } of Object.values(c)) assert.match(path, /legajo=eq\.7|destinatario_rol=eq\.7/, path);
  assert.match(c.miAbierta.path, /fecha=gte\.2026-10-07&fecha=lt\.2026-10-08/);
});

test("gestión — baja el equipo y el día de la empresa, no su fichada ni sus pedidos personales", () => {
  for (const rol of ["gerencial", "administrativo"]) {
    const c = consultasInicio({ usuario: { rol, legajo: 1 }, ...FECHAS });
    assert.deepEqual(Object.keys(c).sort(), ["empleados", "fichadasHoy", "notificaciones", "reglas", "solicitudes"], rol);
    assert.equal(c.empleados.todas, true, "todas las páginas (F3-03)");
    assert.equal(c.fichadasHoy.todas, true);
    assert.match(c.fichadasHoy.path, /fecha=eq\.2026-10-08/);
    assert.match(c.notificaciones.path, /destinatario_rol=eq\.gerencial/);
  }
  assert.equal(esGestion({ rol: "operativo" }), false);
});

test("gestión — no carga las tareas propias (son del operario)", () => {
  const home = leer("app/[slug]/HomeContent.jsx");
  assert.match(home, /useActividad\(\s*u && !isDemo && !uIsGer/);
  assert.match(home, /consultasInicio\(/);
});

test("Más — cada sección se descarga recién al abrirla", () => {
  const config = leer("app/components/screens/ConfigScreen.jsx");
  assert.doesNotMatch(config, /^import \w+ from "\.\.\/\.\.\/(reportes|grilla_horario|proyectos|geolocalizacion|calendario|admin_empresa|documentos_empleado)_screen/m);
  for (const s of ["ReportesScreen", "GrillaHorarioScreen", "GeolocalizacionScreen", "CalendarioScreen", "AdminEmpresaScreen", "ReglasScreen", "AsistenciaReglasScreen"]) {
    assert.match(config, new RegExp(`const ${s} = perezosa\\(\\(\\) => import\\(`), s);
  }
});

test("tiempo real — el cliente de Supabase se baja recién con la sesión iniciada", () => {
  const hook = leer("app/hooks/useRealtimeSync.js");
  assert.doesNotMatch(hook, /^import .*lib\/realtime/m);
  assert.match(hook, /import\("\.\.\/lib\/realtime"\)/);
});
