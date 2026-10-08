// tests/component-boton-fichar.test.jsx — Botón grande de fichar (D6, F4-04)
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { default: BotonFichar, accionFichaje } = await import("../app/components/BotonFichar.jsx");

afterEach(() => cleanup());

const USUARIO = { id: "emp-1", legajo: 7, apodo: "Ana", nombre: "Ana Gómez", empresa_id: "e-1" };

// GPS simulado: responde al toque con una ubicación
Object.defineProperty(global.navigator, "geolocation", {
  configurable: true,
  value: { getCurrentPosition: (ok) => ok({ coords: { latitude: -34.6, longitude: -58.4, accuracy: 20 } }) },
});

function servidor(respuestas) {
  const llamadas = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    const body = opts?.body ? JSON.parse(opts.body) : null;
    llamadas.push({ url: u, body });
    if (u.includes("/api/fichar")) {
      const r = respuestas.shift();
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("/api/data")) return Response.json([{ id: 1 }]);
    if (u.includes("/api/send-push")) return Response.json({ ok: true });
    throw new Error("fetch inesperado " + u);
  };
  return llamadas;
}

async function tocarYConfirmar(etiqueta) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(etiqueta, "i") }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
}

test("accionFichaje — decide ingreso, salida (incluido turno noche) o jornada cerrada", () => {
  assert.equal(accionFichaje(null, null), "ingreso");
  assert.equal(accionFichaje({ ingreso: "08:00:00", egreso: null }, null), "egreso");
  assert.equal(accionFichaje({ ingreso: "08:00:00", egreso: "17:00:00" }, null), "cerrada");
  assert.equal(accionFichaje(null, { ingreso: "22:00:00", egreso: null, fecha: "ayer" }), "egreso", "turno noche: ingresó ayer");
});

test("sin fichar: muestra 'Fichar entrada', pide confirmación y ficha con la ubicación", async () => {
  const llamadas = servidor([{ body: { ok: true, hora: "08:01" } }]);
  let recargo = 0;
  render(<BotonFichar usuario={USUARIO} fichadaHoy={null} onFichado={() => recargo++} />);
  fireEvent.click(screen.getByRole("button", { name: /Fichar entrada/i }));
  assert.ok(screen.getByRole("dialog"), "pide confirmación antes de fichar");
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
  await screen.findByText(/Entrada fichada a las 08:01/);
  const f = llamadas.find((l) => l.url.includes("/api/fichar"));
  assert.equal(f.body.accion, "ingreso");
  assert.equal(f.body.geo_lat, -34.6);
  assert.equal(recargo, 1);
});

test("cancelar la confirmación no ficha nada", () => {
  const llamadas = servidor([]);
  render(<BotonFichar usuario={USUARIO} fichadaHoy={null} />);
  fireEvent.click(screen.getByRole("button", { name: /Fichar entrada/i }));
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  assert.ok(screen.getByRole("button", { name: /Fichar entrada/i }));
  assert.equal(llamadas.length, 0);
});

test("ingreso bloqueado por tardanza: ofrece pedir permiso y lo manda a gerencia", async () => {
  const llamadas = servidor([{ body: { ok: false, tipo: "bloqueado_tardanza", error: "Llegás 40 min tarde: necesitás permiso." } }]);
  render(<BotonFichar usuario={USUARIO} fichadaHoy={null} />);
  await tocarYConfirmar("Fichar entrada");
  await screen.findByText(/necesitás permiso/);
  fireEvent.click(screen.getByRole("button", { name: "Pedir permiso para entrar" }));
  await screen.findByText(/le pediste permiso a gerencia/);
  const solicitud = llamadas.find((l) => l.url.includes("/api/data") && l.body?.path === "solicitudes");
  assert.equal(solicitud.body.body.tipo, "permiso");
});

test("salida con tarea activa: ofrece finalizarla y ficha forzando el cierre", async () => {
  const llamadas = servidor([
    { body: { ok: false, tipo: "tarea_activa", error: "Tenés una tarea activa." } },
    { body: { ok: true, hora: "17:05" } },
  ]);
  render(<BotonFichar usuario={USUARIO} fichadaHoy={{ ingreso: "08:00:00", egreso: null }} />);
  await tocarYConfirmar("Fichar salida");
  fireEvent.click(await screen.findByRole("button", { name: "Finalizar tarea y fichar salida" }));
  await screen.findByText(/Salida fichada a las 17:05/);
  const fichadas = llamadas.filter((l) => l.url.includes("/api/fichar"));
  assert.equal(fichadas[1].body.forzar_cierre_tarea, true);
});

test("salida anticipada sin permiso: ofrece pedirlo; con el pedido ya hecho, solo avisa", async () => {
  servidor([{ body: { ok: false, tipo: "salida_anticipada", pendiente: false, error: "Tu jornada termina a las 17:00." } }]);
  render(<BotonFichar usuario={USUARIO} fichadaHoy={{ ingreso: "08:00:00", egreso: null }} />);
  await tocarYConfirmar("Fichar salida");
  await screen.findByRole("button", { name: "Pedir permiso para salir antes" });
  cleanup();

  servidor([{ body: { ok: false, tipo: "salida_anticipada", pendiente: true, error: "Ya pediste permiso." } }]);
  render(<BotonFichar usuario={USUARIO} fichadaHoy={{ ingreso: "08:00:00", egreso: null }} />);
  await tocarYConfirmar("Fichar salida");
  await screen.findByText(/Ya pediste permiso/);
  assert.equal(screen.queryByRole("button", { name: "Pedir permiso para salir antes" }), null);
});

test("salida con hora extra para aprobar: ofrece pedirla", async () => {
  const llamadas = servidor([{ body: { ok: true, hora: "18:30", solicitar_hora_extra: true, datos_jornada: { excedente_min: 45 } } }]);
  render(<BotonFichar usuario={USUARIO} fichadaHoy={{ ingreso: "09:00:00", egreso: null }} />);
  await tocarYConfirmar("Fichar salida");
  fireEvent.click(await screen.findByRole("button", { name: "Pedir hora extra" }));
  await screen.findByText(/apruebe la hora extra/);
  const s = llamadas.find((l) => l.url.includes("/api/data") && l.body?.path === "solicitudes");
  assert.equal(s.body.body.tipo, "hora_extra");
});

test("jornada cerrada: no hay botón, se muestra el resumen", () => {
  servidor([]);
  render(<BotonFichar usuario={USUARIO} fichadaHoy={{ ingreso: "08:00:00", egreso: "17:00:00" }} />);
  assert.ok(screen.getByText("Jornada cerrada"));
  assert.ok(screen.getByText(/Entrada 08:00 · Salida 17:00/));
  assert.equal(screen.queryByRole("button"), null);
});

test("modo demo: no llama al servidor", async () => {
  const llamadas = servidor([]);
  render(<BotonFichar usuario={USUARIO} fichadaHoy={null} demo />);
  await tocarYConfirmar("Fichar entrada");
  await screen.findByText(/Modo demo/);
  await waitFor(() => assert.equal(llamadas.filter((l) => l.url.includes("/api/fichar")).length, 0));
});
