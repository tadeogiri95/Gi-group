// tests/component-kiosco.test.jsx — Pantalla del kiosco (ítem 19): legajo con
// el teclado, PIN de 4 números y resultado del fichaje.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { default: KioscoScreen } = await import("../app/components/screens/KioscoScreen.jsx");

afterEach(() => cleanup());

function servidor(respuesta) {
  const llamadas = [];
  global.fetch = async (url, opts) => {
    llamadas.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    return new Response(JSON.stringify(respuesta), { status: respuesta.ok === false ? 401 : 200 });
  };
  return llamadas;
}

const tocar = (nombre) => fireEvent.click(screen.getByRole("button", { name: nombre }));

function legajoYPin(legajo, pin) {
  for (const d of legajo) tocar(d);
  tocar("Seguir");
  for (const d of pin) tocar(d);
}

test("Kiosco — legajo + PIN: ficha y saluda con la hora", async () => {
  const llamadas = servidor({ ok: true, accion: "ingreso", apodo: "Ana", hora: "08:01", tardanza: { estado: "puntual", minutos: 0 } });
  render(<KioscoScreen empresa={{ nombre_corto: "Gi" }} slug="gi-group" />);
  legajoYPin("7", "2580");
  await screen.findByText("¡Hola, Ana!");
  assert.ok(screen.getByText(/Entrada registrada a las 08:01/));
  assert.equal(llamadas[0].url, "/api/kiosco/fichar");
  assert.deepEqual(llamadas[0].body, { legajo: "7", pin: "2580" });
});

test("Kiosco — PIN incorrecto: muestra el error y 'Listo' vuelve al inicio", async () => {
  servidor({ ok: false, error: "Legajo o PIN incorrectos." });
  render(<KioscoScreen empresa={{ nombre_corto: "Gi" }} slug="gi-group" />);
  legajoYPin("7", "1111");
  await screen.findByText("Legajo o PIN incorrectos.");
  tocar("Listo");
  assert.ok(screen.getByText("Fichá tu entrada o salida"));
});

test("Kiosco — 'No soy yo' vuelve a pedir el legajo", () => {
  servidor({ ok: true });
  render(<KioscoScreen empresa={{ nombre_corto: "Gi" }} slug="gi-group" />);
  tocar("7");
  tocar("Seguir");
  assert.ok(screen.getByText("Legajo 7"));
  tocar("No soy yo");
  assert.ok(screen.getByText("Fichá tu entrada o salida"));
});

test("Kiosco — tarea en curso al salir: ofrece cerrarla y reenvía con el mismo PIN", async () => {
  const llamadas = servidor({ ok: false, tipo: "tarea_activa", apodo: "Ana", error: "Tenés una tarea en curso." });
  render(<KioscoScreen empresa={{ nombre_corto: "Gi" }} slug="gi-group" />);
  legajoYPin("7", "2580");
  await screen.findByText("Tenés una tarea en curso.");
  servidor({ ok: true, accion: "egreso", apodo: "Ana", hora: "17:00" });
  tocar("Finalizar tarea y fichar salida");
  await screen.findByText(/Salida registrada a las 17:00/);
  assert.equal(llamadas.length, 1);
});
