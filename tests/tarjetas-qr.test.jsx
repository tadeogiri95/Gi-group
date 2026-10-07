// tests/tarjetas-qr.test.jsx — Tarjetas con QR para imprimir (ítem 18, D7):
// link personal, HTML de las tarjetas y login que abre en modo PIN desde el QR.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";

const { linkPersonal, htmlTarjetas, svgQR } = await import("../app/lib/tarjetasQR.js");

afterEach(() => { cleanup(); localStorage.clear(); });

test("linkPersonal — arma /{slug}?legajo=N sin barras dobles", () => {
  assert.equal(linkPersonal("https://gypi.app/", "gi-group", 7), "https://gypi.app/gi-group?legajo=7");
  assert.equal(linkPersonal("https://gypi.app", "gi-group", "15"), "https://gypi.app/gi-group?legajo=15");
});

test("svgQR — genera un QR en SVG", async () => {
  const svg = await svgQR("https://gypi.app/gi-group?legajo=7");
  assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
});

test("htmlTarjetas — una tarjeta por persona, con QR y textos escapados", async () => {
  const html = await htmlTarjetas({
    titulo: "Tarjetas de ingreso",
    empresa: "Gi <Group>",
    tarjetas: [
      { nombre: "Ana <script>alert(1)</script>", detalle: "Legajo 7", link: "https://gypi.app/gi-group?legajo=7", pie: "Escaneá y poné tu PIN" },
      { nombre: "Juan", link: "https://gypi.app/gi-group?legajo=8", pie: "Escaneá y poné tu PIN" },
    ],
  });
  assert.equal((html.match(/class="tarjeta"/g) || []).length, 2);
  assert.equal((html.match(/<svg/g) || []).length, 2);
  assert.ok(!html.includes("<script>"), "el nombre no puede inyectar HTML");
  assert.ok(html.includes("Ana &lt;script&gt;"));
  assert.ok(html.includes("Gi &lt;Group&gt;"));
  assert.ok(html.includes("Legajo 7"));
});

test("Login — al abrir el QR personal (?legajo=7) arranca en modo PIN con el legajo cargado", async (t) => {
  t.mock.module("next/navigation", {
    namedExports: {
      useRouter: () => ({ replace: () => {}, push: () => {} }),
      usePathname: () => "/gi-group",
      useSearchParams: () => new URLSearchParams("legajo=7"),
    },
  });
  const { default: LoginScreen } = await import(`../app/components/screens/LoginScreen.jsx?t=${Date.now()}`);
  render(<LoginScreen empresa={{ id: "11111111-1111-1111-1111-111111111111", slug: "gi-group" }} onLogin={() => {}} />);
  assert.equal(screen.getByLabelText("Legajo").value, "7");
  assert.ok(screen.getByLabelText("PIN"));
});

test("Login — un ?legajo= que no es un número se ignora", async (t) => {
  t.mock.module("next/navigation", {
    namedExports: {
      useRouter: () => ({ replace: () => {}, push: () => {} }),
      usePathname: () => "/gi-group",
      useSearchParams: () => new URLSearchParams("legajo=<x>"),
    },
  });
  const { default: LoginScreen } = await import(`../app/components/screens/LoginScreen.jsx?t=${Date.now()}`);
  render(<LoginScreen empresa={{ id: "11111111-1111-1111-1111-111111111111", slug: "gi-group" }} onLogin={() => {}} />);
  assert.ok(screen.getByPlaceholderText("Legajo o email"), "queda el ingreso con contraseña");
});
