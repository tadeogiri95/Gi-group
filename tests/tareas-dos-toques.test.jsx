// tests/tareas-dos-toques.test.jsx — Reforma UX R7: tareas en 2 toques.
// Etapa + OT ya inicia la tarea; "Cambiar tarea" no corta antes de tiempo;
// después de estar parado, "Seguir con lo mismo"; vibración al iniciar.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { default: ActividadScreen } = await import("../app/actividad_screen.jsx");

afterEach(() => cleanup());

const ETAPAS = [
  { codigo: 0, nombre: "Parado", icon: "⏸", color: "#DC2626" },
  { codigo: 1, nombre: "Corte", icon: "✂️", color: "#F00" },
  { codigo: 2, nombre: "Armado", icon: "🔧", color: "#0F0" },
];
const PROYECTOS = [{ ot: "1001", cliente: "Acme", proyecto: "Portón" }, { ot: "1002", cliente: "Beta", proyecto: "Reja" }];

function pantalla(props = {}) {
  const llamadas = { iniciar: [], finalizar: 0 };
  render(
    <ActividadScreen
      tareaActiva={null} historial={[]} etapas={ETAPAS} proyectos={PROYECTOS} loading={false} elapsed={0}
      usuario={{ id: "emp-r7" }} empresa={{}} fichadaHoy={{ ingreso: "08:00:00" }}
      iniciarTarea={async (t) => { llamadas.iniciar.push(t); }}
      finalizarTarea={async () => { llamadas.finalizar++; }}
      cambiarTarea={async () => {}}
      {...props}
    />
  );
  return llamadas;
}

const ACTIVA = { id: 9, etapa: 1, codigo_proyecto: "1001", hora_inicio: new Date(Date.now() - 600000).toISOString(), tipo: "N" };
const PARADO = { id: 10, etapa: 0, causa: "M", hora_inicio: new Date().toISOString(), tipo: "N" };

test("dos toques: la etapa y la OT — la tarea arranca como trabajo normal y vibra", async () => {
  const vibraciones = [];
  navigator.vibrate = (ms) => { vibraciones.push(ms); return true; };
  const llamadas = pantalla();
  fireEvent.click(await screen.findByText(/Iniciar tarea/i));
  assert.ok(screen.getByText("Paso 1 de 2"));
  fireEvent.click(screen.getByText("Armado"));
  fireEvent.click(screen.getByText("Acme"));
  await waitFor(() => assert.equal(llamadas.iniciar.length, 1));
  assert.deepEqual(
    { etapa: llamadas.iniciar[0].etapa, ot: String(llamadas.iniciar[0].codigo_proyecto), tipo: llamadas.iniciar[0].tipo },
    { etapa: 2, ot: "1001", tipo: "N" }
  );
  assert.equal(vibraciones.length, 1);
  assert.equal(screen.queryByText("Tipo de trabajo"), null, "ya no hay un tercer paso");
});

test("caso especial: marcar retrabajo antes de elegir la OT", async () => {
  const llamadas = pantalla();
  fireEvent.click(await screen.findByText(/Iniciar tarea/i));
  fireEvent.click(screen.getByText("Corte"));
  fireEvent.click(screen.getByText("¿Es retrabajo u otro caso especial?"));
  fireEvent.click(screen.getByRole("radio", { name: "Retrabajo" }));
  fireEvent.click(screen.getByText("Beta"));
  await waitFor(() => assert.equal(llamadas.iniciar.length, 1));
  assert.equal(llamadas.iniciar[0].tipo, "R");
});

test("OT manual: se escribe el número y '▶ Iniciar'", async () => {
  const llamadas = pantalla();
  fireEvent.click(await screen.findByText(/Iniciar tarea/i));
  fireEvent.click(screen.getByText("Corte"));
  fireEvent.click(screen.getByText("✏️ Cargar manual"));
  fireEvent.change(screen.getByPlaceholderText("Número de OT"), { target: { value: "555" } });
  fireEvent.click(screen.getByText("▶ Iniciar"));
  await waitFor(() => assert.equal(llamadas.iniciar.length, 1));
  assert.equal(String(llamadas.iniciar[0].codigo_proyecto), "555");
});

test("U-05 — 'Cambiar tarea' no corta la actual: si vuelve atrás, sigue igual", async () => {
  const llamadas = pantalla({ tareaActiva: ACTIVA });
  fireEvent.click(await screen.findByText(/Cambiar tarea/));
  assert.equal(llamadas.finalizar, 0, "no se cerró la tarea en curso");
  assert.ok(screen.getByText("Paso 1 de 2"));
  fireEvent.click(screen.getByLabelText("Volver"));
  assert.ok(await screen.findByText(/Cambiar tarea/));
  assert.equal(llamadas.finalizar, 0);
  // Y si elige otra, la nueva reemplaza a la anterior (el servidor la cierra)
  fireEvent.click(screen.getByText(/Cambiar tarea/));
  fireEvent.click(screen.getByText("Armado"));
  fireEvent.click(screen.getByText("Beta"));
  await waitFor(() => assert.equal(llamadas.iniciar.length, 1));
  assert.equal(llamadas.finalizar, 0);
});

test("U-07 — parado: un toque para seguir con lo que estaba haciendo", async () => {
  const historial = [
    { id: 8, etapa: 2, codigo_proyecto: "1002", tipo: "R", hora_inicio: new Date(Date.now() - 3600000).toISOString(), hora_fin: new Date().toISOString() },
  ];
  const llamadas = pantalla({ tareaActiva: PARADO, historial });
  fireEvent.click(await screen.findByText("▶ Seguir con Armado · OT 1002"));
  await waitFor(() => assert.equal(llamadas.iniciar.length, 1));
  assert.deepEqual(
    { etapa: llamadas.iniciar[0].etapa, ot: llamadas.iniciar[0].codigo_proyecto, tipo: llamadas.iniciar[0].tipo },
    { etapa: 2, ot: "1002", tipo: "R" }
  );
  assert.ok(screen.getByText(/Otra tarea/));
});

test("parar: el botón dice 'Estoy parado' y las causas sin códigos", async () => {
  const llamadas = pantalla({ tareaActiva: ACTIVA });
  fireEvent.click(await screen.findByText("Estoy parado"));
  assert.ok(screen.getByText("Falta material"));
  assert.equal(screen.queryByText(/Código:/), null);
  fireEvent.click(screen.getByText("Falta material"));
  await waitFor(() => assert.equal(llamadas.iniciar.length, 1));
  assert.deepEqual({ etapa: llamadas.iniciar[0].etapa, causa: llamadas.iniciar[0].causa }, { etapa: 0, causa: "M" });
});
