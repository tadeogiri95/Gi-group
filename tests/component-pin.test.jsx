// tests/component-pin.test.jsx — Pantallas del PIN (F4-06): ingreso con
// legajo + PIN en el login y tarjeta para crearlo desde el inicio del operario.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

afterEach(() => { cleanup(); localStorage.clear(); });

const EMPRESA = { id: "11111111-1111-1111-1111-111111111111", nombre_corto: "Gi", slug: "gi-group" };

async function importLoginScreen(t) {
  t.mock.module("next/navigation", {
    namedExports: {
      useRouter: () => ({ replace: () => {}, push: () => {} }),
      usePathname: () => "/gi-group",
      useSearchParams: () => new URLSearchParams(),
    },
  });
  const { default: LoginScreen } = await import(`../app/components/screens/LoginScreen.jsx?t=${Date.now()}`);
  return LoginScreen;
}

function servidor(respuesta) {
  const cuerpos = [];
  global.fetch = async (url, opts) => {
    cuerpos.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    return new Response(JSON.stringify(respuesta.body), { status: respuesta.status ?? 200 });
  };
  return cuerpos;
}

test("Login — 'Entrar con PIN' manda legajo + PIN y recuerda el legajo para la próxima", async (t) => {
  const LoginScreen = await importLoginScreen(t);
  const cuerpos = servidor({ body: { usuario: { id: "e", legajo: 7 } } });
  let usuario = null;
  render(<LoginScreen empresa={EMPRESA} onLogin={(u) => { usuario = u; }} />);

  fireEvent.click(screen.getByRole("button", { name: "Entrar con PIN" }));
  fireEvent.change(screen.getByLabelText("Legajo"), { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "25a80" } });
  assert.equal(screen.getByLabelText("PIN").value, "2580", "solo números, hasta 4");
  fireEvent.click(screen.getByText("Ingresar"));

  await waitFor(() => assert.ok(usuario));
  assert.deepEqual(cuerpos[0].body, { legajo: "7", pin: "2580", empresa_id: EMPRESA.id });
  assert.equal(JSON.parse(localStorage.getItem("gypi_legajo_pin"))["gi-group"], "7");
});

test("Login — si ya se entró con PIN, arranca en modo PIN con el legajo cargado", async (t) => {
  localStorage.setItem("gypi_legajo_pin", JSON.stringify({ "gi-group": "7" }));
  const LoginScreen = await importLoginScreen(t);
  render(<LoginScreen empresa={EMPRESA} onLogin={() => {}} />);
  assert.equal(screen.getByLabelText("Legajo").value, "7");
  assert.ok(screen.getByRole("button", { name: "Entrar con contraseña" }));
});

test("Login — PIN incorrecto muestra el error y vacía el PIN", async (t) => {
  const LoginScreen = await importLoginScreen(t);
  servidor({ status: 401, body: { error: "Legajo o PIN incorrectos." } });
  render(<LoginScreen empresa={EMPRESA} onLogin={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Entrar con PIN" }));
  fireEvent.change(screen.getByLabelText("Legajo"), { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1111" } });
  fireEvent.click(screen.getByText("Ingresar"));
  await screen.findByText(/Legajo o PIN incorrectos/);
  assert.equal(screen.getByLabelText("PIN").value, "");
});

const { default: PinCard } = await import("../app/components/PinCard.jsx");

test("PinCard — sin PIN invita a crearlo; valida que coincidan y que no sea fácil", async () => {
  const cuerpos = servidor({ body: { ok: true } });
  render(<PinCard tienePin={false} onCambio={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Crear PIN" }));
  fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
  fireEvent.change(screen.getByLabelText("Repetí el PIN"), { target: { value: "1234" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar PIN" }));
  assert.match(screen.getByRole("alert").textContent, /escalera/);

  fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2580" } });
  fireEvent.change(screen.getByLabelText("Repetí el PIN"), { target: { value: "2581" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar PIN" }));
  assert.match(screen.getByRole("alert").textContent, /no coinciden/);
  assert.equal(cuerpos.length, 0);
});

test("PinCard — guarda el PIN y avisa", async () => {
  const cuerpos = servidor({ body: { ok: true, tiene_pin: true } });
  let cambio = null;
  render(<PinCard tienePin={false} onCambio={(v) => { cambio = v; }} />);
  fireEvent.click(screen.getByRole("button", { name: "Crear PIN" }));
  fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2580" } });
  fireEvent.change(screen.getByLabelText("Repetí el PIN"), { target: { value: "2580" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar PIN" }));
  await screen.findByText(/La próxima vez entrá con tu legajo y tu PIN/);
  assert.equal(cambio, true);
  assert.equal(cuerpos[0].url, "/api/pin");
  assert.deepEqual(cuerpos[0].body, { pin: "2580" });
});
