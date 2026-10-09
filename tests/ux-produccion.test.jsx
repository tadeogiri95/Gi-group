// tests/ux-produccion.test.jsx — Reforma UX R11 (6/8): Producción en vivo.
// El color dice el estado (trabajando / parado / sin tarea), las etiquetas
// van completas y cada persona se abre con un botón de verdad.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

const { default: GerenciaActividadScreen } = await import("../app/gerencia_actividad_screen.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");

afterEach(() => cleanup());

const HACE_20 = new Date(Date.now() - 20 * 60000).toISOString();
const RESUMEN = [
  { empleado_id: "e1", empleado_nombre: "Ana Gómez", legajo: 7, division: "produccion", etapa_actual: 2, inicio_tarea_actual: HACE_20, minutos_productivos: 120, minutos_espera: 10, pct_productivo: 92 },
  { empleado_id: "e2", empleado_nombre: "Luis Paz", legajo: 8, division: "produccion", etapa_actual: 0, inicio_tarea_actual: HACE_20, minutos_productivos: 60, minutos_espera: 45, pct_productivo: 57 },
  { empleado_id: "e3", empleado_nombre: "Eva Ruiz", legajo: 9, division: "produccion", etapa_actual: null, minutos_productivos: 0, minutos_espera: 0, pct_productivo: 0 },
];
const ETAPAS = [{ division: "produccion", codigo: 2, nombre: "Armado", icon: "🔧", color: "#0F0" }];

function pantalla() {
  global.fetch = async (_url, opts) => {
    const path = JSON.parse(opts?.body || "{}").path || "";
    if (path.startsWith("v_resumen_diario")) return Response.json({ ok: true, data: RESUMEN });
    if (path.startsWith("etapas")) return Response.json({ ok: true, data: ETAPAS });
    if (path.startsWith("registro_actividades")) return Response.json({ ok: true, data: [{ id: 1, hora_inicio: HACE_20, hora_fin: null, codigo_proyecto: "1001", etapa: 2, tipo: "N", division: "produccion" }] });
    if (path.startsWith("fichadas")) return Response.json({ ok: true, data: [{ ingreso: "08:00:00", egreso: null, llegada_tarde: true, minutos_tarde: 12 }] });
    return Response.json({ ok: true, data: [] });
  };
  render(<AuthContext.Provider value={{ divisiones: [] }}><GerenciaActividadScreen empresaId="emp-1" /></AuthContext.Provider>);
}

test("producción — resumen con etiquetas completas: trabajando, parados, sin tarea y el porcentaje explicado", async () => {
  pantalla();
  await screen.findByText(/Trabajando · 3h 0m en el día/);
  const resumen = screen.getByRole("region", { name: "Ahora en la planta" });
  assert.ok(within(resumen).getByText(/Trabajando · 3h 0m en el día/));
  assert.ok(within(resumen).getByText(/Parados · /));
  assert.ok(within(resumen).getByText("Sin tarea, de 3"));
  assert.ok(within(resumen).getByText("Del tiempo, trabajando (el resto, parados)"));
});

test("producción — cada persona es un botón que dice su estado y abre lo que hizo hoy", async () => {
  pantalla();
  const ana = await screen.findByRole("button", { name: /Ana Gómez: trabajando en Armado/ });
  assert.ok(screen.getByRole("button", { name: /Luis Paz: parado/ }));
  assert.ok(screen.getByRole("button", { name: /Eva Ruiz: sin tarea/ }));
  assert.equal(ana.tagName, "BUTTON");
  fireEvent.click(ana);
  assert.equal(ana.getAttribute("aria-expanded"), "true");
  assert.ok(await screen.findByText("Lo que hizo hoy"));
  assert.ok(screen.getByText("Llegó 12 min tarde"));
  assert.ok(screen.getByText("OT 1001"));
});

test("producción — sin estilos sueltos: la barra es un SVG y el color es por estado", () => {
  const src = readFileSync(new URL("../app/gerencia_actividad_screen.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /style=\{\{/);
  assert.match(src, /<rect width=\{/);
  assert.doesNotMatch(src, /role="button"/, "la tarjeta es un <button>, no un div con rol");
});
