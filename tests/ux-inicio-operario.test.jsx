// tests/ux-inicio-operario.test.jsx — Reforma UX R8 y revisión de la
// interfaz (2026-10): el inicio del operario tiene el estado, fichar y los
// botones grandes del trabajo (escanear piezas primero). Pedir permiso está en
// la pestaña "Pedidos"; horario, semana, fichadas, documentos, PIN y salir en
// la pestaña "Mi cuenta", y salir pide confirmación (U-13).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { default: HomeEmp } = await import("../app/components/screens/HomeEmp.jsx");
const { default: MiCuentaScreen } = await import("../app/components/screens/MiCuentaScreen.jsx");
const { modulosEfectivos } = await import("../app/lib/modulos.js");

afterEach(() => cleanup());

const USUARIO = { id: "emp-1", empresa_id: "e-1", apodo: "Ana", nombre: "Ana Gómez", legajo: 7, rol: "operativo", diagrama: { lun: { in: "08:00", out: "17:00" } } };

function inicio({ plan = "planta_15", tareaActiva = null, fichadaHoy = { ingreso: "08:00:00" }, misSolicitudes = [], demo = true } = {}) {
  global.fetch = async () => Response.json({ ok: true, data: [] });
  render(
    <HomeEmp usuario={USUARIO} demo={demo} onAbrirCarga={demo ? undefined : () => {}}
      empresa={{ modulos: modulosEfectivos({ plan }) }}
      ctx={{ fichadaHoy, misSolicitudes, fichadasSemana: [], notificaciones: [] }}
      tareaActiva={tareaActiva} etapas={[{ id: 2, codigo: 2, nombre: "Armado" }]} />
  );
}

test("inicio — sin ícono suelto de salir; lo de todos los días a la vista", () => {
  inicio();
  assert.equal(screen.queryByLabelText("Cerrar sesión"), null);
  assert.ok(screen.getByText("Hola, Ana"));
  assert.ok(screen.getByText(/Entrada 08:00/));
  // El operario ya no inicia tareas ni le escribe al asistente (2026-10)
  assert.equal(screen.queryByRole("button", { name: /Empezar una tarea/ }), null);
  assert.equal(screen.queryByText("Escribirle al asistente"), null);
  // Pedir permiso y Mi cuenta son pestañas de la barra, no del inicio
  assert.equal(screen.queryByRole("button", { name: /Pedir permiso/ }), null);
  assert.equal(screen.queryByRole("button", { name: /Mi cuenta/ }), null);
  assert.equal(screen.queryByText("Mi horario"), null);
  assert.equal(screen.queryByText("Esta semana"), null);
});

test("inicio — botones grandes del trabajo, escanear piezas primero", () => {
  inicio({ demo: false });
  const botones = screen.getAllByRole("button").filter((b) => /Escanear piezas|Retirar material|Carga de una OT/.test(b.textContent));
  assert.deepEqual(botones.map((b) => b.textContent.match(/Escanear piezas|Retirar material|Carga de una OT/)[0]), ["Escanear piezas", "Retirar material", "Carga de una OT"]);
  for (const b of botones) assert.match(b.className, /min-h-\[80px\]/);
});

test("inicio — una tarea vieja abierta no vuelve a ofrecer Tareas", () => {
  inicio({ tareaActiva: { etapa: 2, codigo_proyecto: "1001", hora_inicio: new Date().toISOString() } });
  assert.equal(screen.queryByRole("button", { name: /Tarea en curso/ }), null);
});

test("Mi cuenta — horario, semana, historial, documentos y salir con confirmación", async () => {
  const destinos = []; let salidas = 0;
  render(<MiCuentaScreen usuario={USUARIO} ctx={{ fichadasSemana: [] }} goto={(d) => destinos.push(d)} logout={() => salidas++} demo />);
  assert.ok(screen.getByText("Mi horario"));
  assert.ok(screen.getByText("Esta semana"));
  fireEvent.click(screen.getByRole("button", { name: /Historial de fichajes/ }));
  fireEvent.click(screen.getByRole("button", { name: /Mi documentación/ }));
  assert.deepEqual(destinos, ["historial-fichajes", "documentos"]);
  fireEvent.click(screen.getByRole("button", { name: /Cerrar sesión/ }));
  assert.equal(salidas, 0, "no sale sin confirmar");
  assert.ok(await screen.findByText("¿Cerrar la sesión?"));
  const botones = screen.getAllByRole("button", { name: "Cerrar sesión" });
  fireEvent.click(botones.at(-1));
  await waitFor(() => assert.equal(salidas, 1));
});

test("chat — 'Ya llegué' y 'Me voy' guardan sin señal como el botón grande (U-08)", () => {
  const chat = readFileSync(new URL("../app/components/screens/ChatScreen.jsx", import.meta.url), "utf8");
  assert.equal((chat.match(/empleadoId: usuario\.id/g) || []).length, 2);
  assert.match(chat, /Sin señal: guardamos tu entrada/);
  assert.match(chat, /Sin señal: guardamos tu salida/);
});
