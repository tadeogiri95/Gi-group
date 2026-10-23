// tests/auditoria-limpieza.test.jsx — PR 6 de la auditoría del 22/10:
// limpieza técnica. Escape cierra la ventana de arriba, firebase-admin con la
// API modular y sin el cron viejo de inactividad.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { useEscape } = await import("../app/hooks/useEscape.js");
const { default: Modal } = await import("../app/components/ui/Modal.jsx");

afterEach(() => cleanup());

const RAIZ = new URL("../", import.meta.url).pathname;
const leer = (f) => readFileSync(join(RAIZ, f), "utf8");
const escape = () => fireEvent.keyDown(document, { key: "Escape" });

function Ventana({ nombre, onClose, activo = true }) {
  useEscape(onClose, activo);
  return <div>{nombre}</div>;
}

test("Escape cierra solo la ventana de arriba, y después la de abajo", () => {
  const cerradas = [];
  const { rerender } = render(<Ventana nombre="abajo" onClose={() => cerradas.push("abajo")} />);
  rerender(<><Ventana nombre="abajo" onClose={() => cerradas.push("abajo")} /><Ventana nombre="arriba" onClose={() => cerradas.push("arriba")} /></>);
  escape();
  assert.deepEqual(cerradas, ["arriba"]);
  rerender(<Ventana nombre="abajo" onClose={() => cerradas.push("abajo")} />);
  escape();
  assert.deepEqual(cerradas, ["arriba", "abajo"]);
});

test("Escape no hace nada con la ventana inactiva ni con otras teclas", () => {
  let n = 0;
  render(<Ventana nombre="x" activo={false} onClose={() => n++} />);
  escape();
  fireEvent.keyDown(document, { key: "Enter" });
  assert.equal(n, 0);
});

test("un Modal abierto sobre otra ventana se cierra primero", () => {
  const cerradas = [];
  const { rerender } = render(<Ventana nombre="ficha" onClose={() => cerradas.push("ficha")} />);
  rerender(<><Ventana nombre="ficha" onClose={() => cerradas.push("ficha")} /><Modal open title="Confirmar" onClose={() => cerradas.push("modal")}><p>¿Seguro?</p></Modal></>);
  assert.ok(screen.getByRole("dialog", { name: "Confirmar" }));
  escape();
  assert.deepEqual(cerradas, ["modal"]);
});

function archivos(dir) {
  return readdirSync(join(RAIZ, dir)).flatMap((n) => {
    const r = `${dir}/${n}`;
    return statSync(join(RAIZ, r)).isDirectory() ? archivos(r) : r.endsWith(".jsx") ? [r] : [];
  });
}

test("toda ventana a pantalla completa se cierra con Escape", () => {
  const sinEscape = archivos("app")
    .filter((f) => leer(f).includes("fixed inset-0"))
    .filter((f) => !/useEscape\(|key === ['"]Escape['"]/.test(leer(f)));
  assert.deepEqual(sinEscape, []);
});

test("firebase-admin se usa con la API modular (la versión 14 sacó admin.*)", () => {
  for (const f of ["app/lib/pushGerencia.js", "app/api/send-push/route.js", "app/api/cron/push-ausencias/route.ts"]) {
    const s = leer(f);
    assert.match(s, /from "firebase-admin\/app"/, f);
    assert.match(s, /from "firebase-admin\/messaging"/, f);
    assert.doesNotMatch(s, /admin\.(apps|credential|messaging|initializeApp)/, f);
  }
});

test("el cron viejo de inactividad ya no existe", () => {
  assert.equal(existsSync(join(RAIZ, "app/api/cron/inactividad-produccion")), false);
  assert.doesNotMatch(leer("vercel.json"), /inactividad-produccion/);
});

test("sin avisos viejos en el build: nada de runtime edge ni disableLogger", () => {
  assert.doesNotMatch(leer("app/api/og/route.js"), /runtime\s*=\s*['"]edge/);
  assert.doesNotMatch(leer("next.config.mjs"), /disableLogger/);
});
