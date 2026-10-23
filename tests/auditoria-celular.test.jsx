// tests/auditoria-celular.test.jsx — PR 3 de la auditoría del 22/10: el
// celular más despejado. La lista de OT muestra solo lo justo y los botones
// van en la ventana de la OT; las sub-pestañas se deslizan en una fila; en
// Personas los filtros y lo de vez en cuando quedan plegados.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

const { default: ProyectosScreen } = await import("../app/proyectos_screen.jsx");
const { default: GestionPersonalScreen } = await import("../app/gestion_personal_screen.jsx");
const { default: FilaDeslizable } = await import("../app/components/ui/FilaDeslizable.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");

afterEach(() => cleanup());

const E = "11111111-1111-1111-1111-111111111111";
const OTS = [
  { id: 1, ot: "7495", cliente: "Banco Norte", obra: "Sucursal Centro", division: "muebles", estado: "activo", fecha_entrega: "2026-11-20", cantidad: 4 },
  { id: 2, ot: "7858", cliente: "CEVT", obra: null, proyecto: null, division: "muebles", estado: "activo" },
];

function mockDatos(tablas) {
  return async (url, opts = {}) => {
    const { path = "" } = JSON.parse(opts.body || "{}");
    const tabla = path.split("?")[0];
    return new Response(JSON.stringify({ ok: true, data: tablas[tabla] || [] }), { status: 200 });
  };
}

const conAuth = (ui, extra = {}) => (
  <AuthContext.Provider value={{ divisiones: [{ id: "muebles", label: "Muebles" }], empresa: { id: E, nombre: "Acme", slug: "acme" }, usuario: { rol: "gerencial", empresa_id: E }, updateEmpresa: () => {}, ...extra }}>
    {ui}
  </AuthContext.Provider>
);

test("lista de OT — cada OT es un solo renglón; al tocarla se abre con todos sus botones grandes", async () => {
  global.fetch = mockDatos({ proyectos: OTS });
  render(conAuth(<ProyectosScreen empresaId={E} />));
  const fila = await screen.findByRole("button", { name: /OT 7495: Banco Norte/ });
  assert.match(fila.textContent, /Sucursal Centro · Muebles · Entrega 20\/11\/2026/);
  // Los 8 botones ya no se repiten en cada OT
  assert.equal(screen.queryByRole("button", { name: "📊 Detalle" }), null);
  assert.equal(screen.queryByRole("button", { name: "🚚 Carga" }), null);

  fireEvent.click(fila);
  const ventana = screen.getByRole("dialog", { name: "OT 7495" });
  for (const nombre of ["📊 Detalle", "🧩 Piezas", "📦 Sueltos", "🚚 Carga", "🏷 Módulos", "✍️ Acta", "✏️ Editar", "Cerrar OT"]) {
    const b = within(ventana).getByRole("button", { name: nombre });
    assert.match(b.className, /min-h-\[52px\]/);
    assert.match(b.className, /text-\[15px\]/);
  }
  assert.match(ventana.textContent, /Cantidad 4/);
  fireEvent.click(within(ventana).getByRole("button", { name: "✏️ Editar" }));
  assert.equal(screen.queryByRole("dialog", { name: "OT 7495" }), null, "al elegir, la ventana se cierra");
  assert.ok(screen.getByText("Editar OT"));
});

test("lista de OT — sin obra no queda un puntito suelto antes de la división", async () => {
  global.fetch = mockDatos({ proyectos: OTS });
  render(conAuth(<ProyectosScreen empresaId={E} />));
  const fila = await screen.findByRole("button", { name: /OT 7858: CEVT/ });
  assert.doesNotMatch(fila.textContent, /·\s*Muebles/);
  assert.match(fila.textContent, /Muebles/);
});

test("Personas — buscador y Filtrar a la vista; filtros, CSV, tarjetas y kiosco plegados", async () => {
  global.fetch = mockDatos({ empleados: [{ id: "a", legajo: 7, nombre: "Ana", rol: "operativo", area: "produccion", activo: true, division: "muebles" }] });
  render(conAuth(<GestionPersonalScreen empresaId={E} />));
  const filtrar = await screen.findByRole("button", { name: "Filtrar" });
  assert.equal(filtrar.getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByRole("button", { name: "Inactivos" }), null);
  assert.equal(screen.queryByText(/Importar personas desde un CSV/), null);
  assert.equal(screen.queryByText(/Modo kiosco/), null);

  fireEvent.click(filtrar);
  fireEvent.click(screen.getByRole("button", { name: "Inactivos" }));
  assert.ok(screen.getByRole("button", { name: "Filtrar (1)" }), "se ve cuántos filtros cambiaron");

  fireEvent.click(screen.getByRole("button", { name: /Más acciones/ }));
  assert.ok(screen.getByText(/Importar personas desde un CSV/));
  assert.ok(screen.getByRole("button", { name: "Imprimir tarjetas QR" }));
  assert.ok(screen.getByRole("button", { name: "Activar acá" }));
});

test("Personas — el área se ve con tilde (en la base sigue sin tilde)", () => {
  const src = readFileSync(new URL("../app/gestion_personal_screen.jsx", import.meta.url), "utf8");
  assert.match(src, /produccion: "producción"/);
  assert.match(src, /\{nombreArea\(emp\.area \|\| "produccion"\)\}/);
  assert.match(src, /<option key=\{a\} value=\{a\}>\{nombreArea\(a\)\}<\/option>/);
});

test("fila que se desliza — no se parte en renglones y avisa si hay más a la derecha", () => {
  render(<FilaDeslizable role="tablist" aria-label="Prueba" activa="a"><button role="tab" aria-selected="true">A</button></FilaDeslizable>);
  const fila = screen.getByRole("tablist", { name: "Prueba" });
  assert.match(fila.className, /fila-desliza/);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.fila-desliza \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto/);
  assert.match(css, /\.fila-desliza\[data-hay-mas="si"\] \{[^}]*mask-image/);
  // Compras, Flota, Reportes y las pestañas de Planta/Equipo la usan
  for (const f of ["components/ComprasScreen.jsx", "components/FlotaScreen.jsx", "reportes_screen.jsx", "components/ui/Pestanas.jsx"]) {
    assert.match(readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8"), /<FilaDeslizable /, f);
  }
  assert.doesNotMatch(readFileSync(new URL("../app/components/ComprasScreen.jsx", import.meta.url), "utf8"), /aria-label="Compras" className="flex gap-1\.5 mb-3 flex-wrap"/);
});
