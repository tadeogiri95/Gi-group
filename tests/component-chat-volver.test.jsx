// tests/component-chat-volver.test.jsx — El chat tiene botón "Volver" (F4-03).
// El chat oculta la barra de navegación; en la app instalada en iOS (sin botón
// atrás del sistema) el operario quedaba atrapado.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { default: ChatScreen } = await import("../app/components/screens/ChatScreen.jsx");

afterEach(() => cleanup());

const USUARIO = { id: "emp-1", legajo: 7, apodo: "Ana", nombre: "Ana Gómez", rol: "operativo", empresa_id: "e-1", diagrama: {} };

test("ChatScreen — muestra 'Volver' y al tocarlo llama a onBack", () => {
  let volvio = 0;
  render(<ChatScreen usuario={USUARIO} ctx={{}} reload={() => {}} onBack={() => { volvio++; }} />);
  fireEvent.click(screen.getByRole("button", { name: "Volver al inicio" }));
  assert.equal(volvio, 1);
});

test("HomeContent — le pasa onBack al chat (vuelve al inicio)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../app/[slug]/HomeContent.jsx", import.meta.url), "utf8");
  assert.match(src, /<ChatScreen [^>]*onBack=\{\(\) => setScreen\("home"\)\}/);
});

test("InboxScreen — ya no depende de datos_horario, que no existe (F1-07)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../app/components/screens/InboxScreen.jsx", import.meta.url), "utf8");
  assert.ok(!src.includes("sol.datos_horario"));
  assert.ok(src.includes("cargarHoraExtraAprobada"), "aprobar una hora extra la carga en la fichada (F1-06)");
});
