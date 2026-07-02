import "./helpers/domSetup.js";
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, cleanup, fireEvent } from "@testing-library/react";

const { default: CookieConsent } = await import("../app/components/CookieConsent.jsx");

const STORAGE_KEY = "gypi_cookie_consent";

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(STORAGE_KEY);
});

test("CookieConsent — muestra el banner si no hay consent en localStorage", () => {
  const { container } = render(<CookieConsent />);
  const dialog = container.querySelector('[role="dialog"]');
  assert.ok(dialog, "debe renderizar el dialog de cookies");
  assert.ok(dialog.textContent.includes("cookies"), "debe mencionar cookies");
});

test("CookieConsent — no muestra el banner si ya se aceptó", () => {
  localStorage.setItem(STORAGE_KEY, "1");
  const { container } = render(<CookieConsent />);
  const dialog = container.querySelector('[role="dialog"]');
  assert.equal(dialog, null, "no debe renderizar el dialog");
});

test("CookieConsent — click en Aceptar guarda en localStorage y oculta el banner", () => {
  const { container, getByText } = render(<CookieConsent />);
  assert.ok(container.querySelector('[role="dialog"]'), "banner visible antes de aceptar");

  fireEvent.click(getByText("Aceptar"));

  assert.equal(localStorage.getItem(STORAGE_KEY), "1", "debe guardar consent en localStorage");
  assert.equal(container.querySelector('[role="dialog"]'), null, "banner debe desaparecer tras aceptar");
});

test("CookieConsent — contiene link a la política de privacidad", () => {
  const { container } = render(<CookieConsent />);
  const link = container.querySelector('a[href="/privacy#publicidad"]');
  assert.ok(link, "debe tener link a /privacy#publicidad");
});

test("CookieConsent — click en Rechazar guarda '0' en localStorage y oculta el banner", () => {
  const { container, getByText } = render(<CookieConsent />);
  assert.ok(container.querySelector('[role="dialog"]'), "banner visible antes de rechazar");

  fireEvent.click(getByText("Rechazar"));

  assert.equal(localStorage.getItem(STORAGE_KEY), "0", "debe guardar '0' en localStorage");
  assert.equal(container.querySelector('[role="dialog"]'), null, "banner debe desaparecer tras rechazar");
});

// Decisión de diseño: con "0" guardado el banner NO vuelve a aparecer.
// No perseguimos al usuario en cada visita — la preferencia queda registrada igual que "1".
test("CookieConsent — no muestra el banner si el usuario ya rechazó (consent = '0')", () => {
  localStorage.setItem(STORAGE_KEY, "0");
  const { container } = render(<CookieConsent />);
  assert.equal(container.querySelector('[role="dialog"]'), null, "no debe renderizar el dialog cuando consent es '0'");
});
