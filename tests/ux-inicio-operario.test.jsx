// tests/ux-inicio-operario.test.jsx — Reforma UX R8: el inicio del operario
// despejado. Arriba lo de todos los días (estado, fichar, tarea, pedir
// permiso); horario, semana, fichadas, documentos, PIN y salir en "Mi cuenta",
// y salir pide confirmación (U-13).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { default: HomeEmp } = await import("../app/components/screens/HomeEmp.jsx");
const { modulosEfectivos } = await import("../app/lib/modulos.js");

afterEach(() => cleanup());

const USUARIO = { id: "emp-1", apodo: "Ana", nombre: "Ana Gómez", legajo: 7, rol: "operativo", diagrama: { lun: { in: "08:00", out: "17:00" } } };

function inicio({ plan = "planta_15", tareaActiva = null, fichadaHoy = { ingreso: "08:00:00" }, misSolicitudes = [] } = {}) {
  global.fetch = async () => Response.json({ ok: true, data: [] });
  const destinos = []; let salio = 0;
  render(
    <HomeEmp goto={(d) => destinos.push(d)} usuario={USUARIO} logout={() => salio++} demo
      empresa={{ modulos: modulosEfectivos({ plan }) }}
      ctx={{ fichadaHoy, misSolicitudes, fichadasSemana: [], notificaciones: [] }}
      tareaActiva={tareaActiva} etapas={[{ id: 2, codigo: 2, nombre: "Armado" }]} actividadesHoy={[]} />
  );
  return { destinos, salidas: () => salio };
}

test("inicio — sin ícono suelto de salir; lo de todos los días a la vista", () => {
  inicio();
  assert.equal(screen.queryByLabelText("Cerrar sesión"), null);
  assert.ok(screen.getByText("Hola, Ana"));
  assert.ok(screen.getByText(/Entrada 08:00/));
  assert.equal(screen.getByRole("button", { name: /Pedir permiso o vacaciones/ }).style.minHeight, "64px");
  assert.ok(screen.getByRole("button", { name: /Empezar una tarea/ }), "fichó y no tiene tarea: se ofrece empezar");
  // Horario, semana y documentos ya no están en el inicio
  assert.equal(screen.queryByText("Mi horario"), null);
  assert.equal(screen.queryByText("Esta semana"), null);
});

test("inicio — la tarea en curso dice qué está haciendo y lleva a Tareas", () => {
  const { destinos } = inicio({ tareaActiva: { etapa: 2, codigo_proyecto: "1001", hora_inicio: new Date().toISOString() } });
  fireEvent.click(screen.getByRole("button", { name: /Tarea en curso: Armado/ }));
  assert.deepEqual(destinos, ["actividad"]);
  assert.equal(screen.queryByRole("button", { name: /Empezar una tarea/ }), null);
});

test("Mi cuenta — horario, semana, historial, documentos y salir con confirmación", async () => {
  const { destinos, salidas } = inicio();
  fireEvent.click(screen.getByRole("button", { name: /Mi cuenta/ }));
  assert.ok(screen.getByRole("heading", { name: "Mi cuenta" }));
  assert.ok(screen.getByText("Mi horario"));
  assert.ok(screen.getByText("Esta semana"));
  fireEvent.click(screen.getByRole("button", { name: /Historial de fichajes/ }));
  assert.deepEqual(destinos, ["historial-fichajes"]);
  fireEvent.click(screen.getByRole("button", { name: /Cerrar sesión/ }));
  assert.equal(salidas(), 0, "no sale sin confirmar");
  assert.ok(await screen.findByText("¿Cerrar la sesión?"));
  const botones = screen.getAllByRole("button", { name: "Cerrar sesión" });
  fireEvent.click(botones.at(-1));
  await waitFor(() => assert.equal(salidas(), 1));
  fireEvent.click(screen.getByRole("button", { name: "← Inicio" }));
  assert.ok(screen.getByText("Hola, Ana"));
});

test("chat — 'Ya llegué' y 'Me voy' guardan sin señal como el botón grande (U-08)", () => {
  const chat = readFileSync(new URL("../app/components/screens/ChatScreen.jsx", import.meta.url), "utf8");
  assert.equal((chat.match(/empleadoId: usuario\.id/g) || []).length, 2);
  assert.match(chat, /Sin señal: guardamos tu entrada/);
  assert.match(chat, /Sin señal: guardamos tu salida/);
});
