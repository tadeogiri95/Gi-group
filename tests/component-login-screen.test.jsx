// tests/component-login-screen.test.jsx — Test de componente (RTL) para
// LoginScreen: cubre el flujo de login feliz y el de credenciales inválidas.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock } from "./helpers/mockFetch.js";

afterEach(() => cleanup());

const EMPRESA = { id: "emp-1", nombre_corto: "TestCo" }; // sin logo_url: evita el camino de next/image

// LoginScreen usa useRouter/usePathname/useSearchParams (next/navigation) para
// leer y limpiar ?oauth_error= de la vuelta de Google. RTL no monta el
// AppRouterContext real, así que se mockea por test (con import con cache-
// busting para que el componente recargado tome el mock).
async function importLoginScreen(t) {
  t.mock.module("next/navigation", {
    namedExports: {
      useRouter: () => ({ replace: () => {}, push: () => {} }),
      usePathname: () => "/acme",
      useSearchParams: () => new URLSearchParams(),
    },
  });
  const { default: LoginScreen } = await import(`../app/components/screens/LoginScreen.jsx?t=${Date.now()}`);
  return LoginScreen;
}

test("LoginScreen — credenciales correctas llama onLogin con el usuario", async (t) => {
  const LoginScreen = await importLoginScreen(t);
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/api/login-empresa"),
      respond: () => ({ status: 200, body: { usuario: { legajo: 7, nombre: "Ana", rol: "empleado" }, expires_in: 1800 } }),
    },
  ]);

  let usuarioRecibido = null;
  render(<LoginScreen empresa={EMPRESA} onLogin={(u) => { usuarioRecibido = u; }} />);

  fireEvent.change(screen.getByPlaceholderText("Legajo o email"), { target: { value: "7" } });
  fireEvent.change(screen.getByPlaceholderText("Contraseña"), { target: { value: "Segura123" } });
  fireEvent.click(screen.getByText("Ingresar"));

  await waitFor(() => assert.notEqual(usuarioRecibido, null));
  assert.equal(usuarioRecibido.legajo, 7);
});

test("LoginScreen — credenciales incorrectas muestra el error y no llama onLogin", async (t) => {
  const LoginScreen = await importLoginScreen(t);
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/api/login-empresa"), respond: () => ({ status: 401, body: { error: "Legajo o contraseña incorrectos" } }) },
  ]);

  let llamado = false;
  render(<LoginScreen empresa={EMPRESA} onLogin={() => { llamado = true; }} />);

  fireEvent.change(screen.getByPlaceholderText("Legajo o email"), { target: { value: "7" } });
  fireEvent.change(screen.getByPlaceholderText("Contraseña"), { target: { value: "mala" } });
  fireEvent.click(screen.getByText("Ingresar"));

  await waitFor(() => assert.ok(screen.queryByText(/incorrectos/i)));
  assert.equal(llamado, false);
});

test("LoginScreen — botón Ingresar deshabilitado sin legajo/password", async (t) => {
  const LoginScreen = await importLoginScreen(t);
  render(<LoginScreen empresa={EMPRESA} onLogin={() => {}} />);
  const boton = screen.getByText("Ingresar").closest("button");
  assert.equal(boton.disabled, true);
});

test("LoginScreen — toggle mostrar/ocultar contraseña cambia el type del input", async (t) => {
  const LoginScreen = await importLoginScreen(t);
  render(<LoginScreen empresa={EMPRESA} onLogin={() => {}} />);
  const pwd = screen.getByPlaceholderText("Contraseña");
  assert.equal(pwd.type, "password");
  fireEvent.click(screen.getByText("Ver"));
  assert.equal(pwd.type, "text");
});
