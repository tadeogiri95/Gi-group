// tests/ux-ubicaciones.test.jsx — Reforma UX R11 (3/8): Ubicaciones con las piezas de diseño.
// Botones tocables, nombres claros para los modos y aviso de qué falta para guardar.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { default: GeolocalizacionScreen } = await import("../app/geolocalizacion_screen.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");

afterEach(() => cleanup());

const UBI = { id: "z1", nombre: "Planta Norte", lat: -31.4, lng: -64.18, radio: 150 };
const EMPS = [
  { id: "e1", nombre: "Ana Gómez", apodo: "Ana", legajo: 7, division: "produccion", geo_config: { activo: true, ubicacion_id: "z1", radio: 150 } },
  { id: "e2", nombre: "Luis Paz", apodo: "Luis", legajo: 8, division: "produccion", geo_config: null },
];

function pantalla({ ubicaciones = [UBI] } = {}) {
  // Todo pasa por el proxy /api/data: se responde según la tabla pedida
  global.fetch = async (_url, opts) => {
    const path = JSON.parse(opts?.body || "{}").path || "";
    if (path.startsWith("geo_zonas")) return Response.json({ ok: true, data: ubicaciones });
    if (path.startsWith("empleados")) return Response.json({ ok: true, data: EMPS });
    return Response.json({ ok: true, data: [] });
  };
  render(
    <AuthContext.Provider value={{ divisiones: [], plantas: [], usuario: { rol: "gerencial" } }}>
      <GeolocalizacionScreen empresaId="emp-1" />
    </AuthContext.Provider>
  );
}

test("ubicaciones — mientras carga no dice 'Sin ubicaciones'", async () => {
  pantalla();
  assert.equal(screen.queryByText("Sin ubicaciones"), null);
  assert.ok(await screen.findByRole("button", { name: "Editar Planta Norte" }));
});

test("ubicaciones — editar y borrar miden 44 px y los modos se llaman 'De a uno' y 'Varios a la vez'", async () => {
  pantalla();
  const editar = await screen.findByRole("button", { name: "Editar Planta Norte" });
  assert.match(editar.className, /w-11 h-11/);
  assert.match(screen.getByRole("button", { name: "Eliminar Planta Norte" }).className, /w-11 h-11/);
  const deAUno = screen.getByRole("button", { name: /De a uno/ });
  assert.equal(deAUno.getAttribute("aria-pressed"), "true");
  fireEvent.click(screen.getByRole("button", { name: /Varios a la vez/ }));
  assert.equal(screen.getByRole("button", { name: /Varios a la vez/ }).getAttribute("aria-pressed"), "true");
  assert.ok(await screen.findByText(/Seleccioná empleados/));
});

test("ubicaciones — sin ubicaciones ofrece crear la primera con el botón principal", async () => {
  pantalla({ ubicaciones: [] });
  assert.ok(await screen.findByText("Sin ubicaciones"));
  assert.ok(screen.getByText(/Creá puntos de fichaje/));
  const crear = screen.getByRole("button", { name: "+ Nueva ubicación" });
  assert.equal(crear.style.minHeight, "48px");
});

test("ubicaciones — al crear, dice qué falta para poder guardar", async () => {
  pantalla();
  await screen.findByRole("button", { name: "Editar Planta Norte" }); // esperar a que carguen
  fireEvent.click(screen.getByRole("button", { name: "+ Nueva ubicación" }));
  assert.ok(screen.getByRole("dialog", { name: "Nueva ubicación" }));
  assert.ok(screen.getByText("Falta ponerle un nombre."));
  assert.equal(screen.getByRole("button", { name: "Crear ubicación" }).disabled, true);
  fireEvent.change(screen.getByPlaceholderText(/Oficina Central/), { target: { value: "Depósito" } });
  assert.ok(screen.getByText(/Falta marcar dónde queda/));
});

test("ubicaciones — 'Cualquier lugar' guarda libre y avisa que ficha sin control", async () => {
  const pedidos = [];
  global.fetch = async (_url, opts) => {
    const body = JSON.parse(opts?.body || "{}");
    pedidos.push(body);
    const path = body.path || "";
    if (body.method === "GET" && path.startsWith("geo_zonas")) return Response.json({ ok: true, data: [UBI] });
    if (body.method === "GET" && path.startsWith("empleados")) return Response.json({ ok: true, data: EMPS });
    return Response.json({ ok: true, data: [] });
  };
  render(
    <AuthContext.Provider value={{ divisiones: [], plantas: [], usuario: { rol: "gerencial" } }}>
      <GeolocalizacionScreen empresaId="emp-1" />
    </AuthContext.Provider>
  );
  fireEvent.click(await screen.findByRole("button", { name: /Ana/ }));
  const libre = screen.getByRole("radio", { name: /Cualquier lugar/ });
  fireEvent.click(libre);
  assert.equal(screen.getByRole("radio", { name: /Cualquier lugar/ }).getAttribute("aria-checked"), "true");
  assert.ok(screen.getAllByText(/Ficha desde cualquier lugar/).length > 0);
  fireEvent.click(screen.getByRole("button", { name: /Guardar 1 cambio/ }));
  await new Promise((r) => setTimeout(r, 50));
  const patch = pedidos.find((p) => p.method === "PATCH" && p.path.startsWith("empleados"));
  assert.equal(patch.body.geo_config.libre, true);
  assert.equal(patch.body.geo_config.activo, false);
  const aviso = pedidos.find((p) => p.method === "POST" && p.path.startsWith("notificaciones"));
  assert.match(aviso.body.asunto, /cualquier lugar/);
});
