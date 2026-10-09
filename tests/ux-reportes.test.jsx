// tests/ux-reportes.test.jsx — Reforma UX R11 (4/8): Reportes con las piezas de diseño.
// Números con la etiqueta completa, leyenda de los íconos de cada día y
// descargas con nombres que se entienden ("Imagen", no "PDF").
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

const { default: ReportesScreen } = await import("../app/reportes_screen.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { hoyArg } = await import("../app/lib/dates.js");

afterEach(() => cleanup());

const TODOS = { lun: { in: "08:00", out: "17:00" }, mar: { in: "08:00", out: "17:00" }, mie: { in: "08:00", out: "17:00" }, jue: { in: "08:00", out: "17:00" }, vie: { in: "08:00", out: "17:00" }, sab: { in: "08:00", out: "17:00" }, dom: { in: "08:00", out: "17:00" } };
const EMPS = [{ id: "e1", nombre: "Ana Gómez", apodo: "Ana", legajo: 7, division: "produccion", rol: "operativo", diagrama: TODOS }];

function pantalla({ usuario = { rol: "gerencial", empresa_id: "x" }, empresa = { modulos: ["fichaje"] } } = {}) {
  global.fetch = async (_url, opts) => {
    const path = JSON.parse(opts?.body || "{}").path || "";
    if (path.startsWith("empleados")) return Response.json({ ok: true, data: EMPS });
    // Ana fichó hoy a horario
    if (path.startsWith("fichadas")) return Response.json({ ok: true, data: [{ legajo: 7, fecha: hoyArg(), ingreso: "08:00:00", egreso: null }] });
    return Response.json({ ok: true, data: [] });
  };
  render(<AuthContext.Provider value={{ divisiones: [], usuario, empresa }}><ReportesScreen /></AuthContext.Provider>);
}

test("reportes — resumen con etiquetas completas y leyenda de los íconos de los días", async () => {
  pantalla();
  const resumen = await screen.findByRole("region", { name: "Resumen del período" });
  for (const etiqueta of ["Asistencia", "Horas cumplidas", "Faltas", "Tardanzas"]) assert.ok(within(resumen).getByText(etiqueta), etiqueta);
  const leyenda = screen.getByRole("list", { name: "Qué significa cada ícono" });
  for (const texto of ["vino", "tarde", "faltó", "franco"]) assert.ok(within(leyenda).getByText(texto), texto);
  // El renglón del empleado se abre con un botón (antes era un div sin rol)
  const fila = screen.getByRole("button", { name: /Ana/ });
  assert.equal(fila.getAttribute("aria-expanded"), "false");
  fireEvent.click(fila);
  assert.equal(fila.getAttribute("aria-expanded"), "true");
  assert.ok(screen.getByText("Días que vino"));
});

test("reportes — la pestaña Descargar dice qué baja cada botón", async () => {
  pantalla();
  fireEvent.click(await screen.findByText("📥 Descargar"));
  assert.ok(screen.getByRole("button", { name: /📄 Excel/ }));
  assert.ok(screen.getByRole("button", { name: /Imagen/ }));
  assert.equal(screen.queryByText(/PDF|Reporte visual/), null);
  assert.equal(screen.getByRole("button", { name: /📄 Excel/ }).style.minHeight, "48px");
});

test("reportes — sin colores a mano ni estilos sueltos; la imagen se dibuja en lib/exportarReporte", () => {
  const src = readFileSync(new URL("../app/reportes_screen.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /style=\{\{/);
  assert.match(src, /import \{ exportCSV, exportImagen \} from "\.\/lib\/exportarReporte"/);
  const lib = readFileSync(new URL("../app/lib/exportarReporte.js", import.meta.url), "utf8");
  assert.match(lib, /export function exportImagen/);
  assert.match(lib, /image\/png/);
});
