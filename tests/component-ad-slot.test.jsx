// tests/component-ad-slot.test.jsx — Test de componente (RTL) para AdSlot:
// gating por plan y por configuración de env vars (kill-switch), y que el
// anuncio se renderiza dentro de un iframe aislado (ver public/ad-frame.html)
// en vez de cargar adsbygoogle.js directo en el document de la app.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, cleanup } from "@testing-library/react";

const { default: AdSlot } = await import("../app/components/AdSlot.jsx");

afterEach(() => cleanup());

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("AdSlot — no renderiza nada en un plan pago, aunque haya env vars configuradas", () => {
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, () => {
    const { container } = render(<AdSlot plan="pro" />);
    assert.equal(container.querySelector("iframe"), null);
  });
});

test("AdSlot — no renderiza nada en plan free si faltan las env vars (kill-switch)", () => {
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: undefined, NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: undefined }, () => {
    const { container } = render(<AdSlot plan="free" />);
    assert.equal(container.querySelector("iframe"), null);
  });
});

test("AdSlot — trial no muestra publicidad", () => {
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, () => {
    const { container } = render(<AdSlot plan="trial" />);
    assert.equal(container.querySelector("iframe"), null);
  });
});

test("AdSlot — renderiza un iframe hacia ad-frame.html con client/slot en plan free con env vars configuradas", () => {
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, () => {
    const { container } = render(<AdSlot plan="free" />);
    const iframe = container.querySelector("iframe");
    assert.ok(iframe, "debe renderizar un <iframe> hacia ad-frame.html");
    const src = iframe.getAttribute("src");
    assert.equal(src, "/ad-frame.html?client=ca-pub-test&slot=123");
  });
});

test("AdSlot — un segundo montaje en la misma sesión vuelve a renderizar el iframe sin problema", () => {
  // Cada montaje crea un iframe nuevo — un browsing context propio, distinto
  // del anterior. A diferencia del <ins> directo en el document de la app
  // (el diseño viejo), pedir un anuncio nuevo en un iframe nuevo es
  // equivalente a una carga de página fresca para adsbygoogle.js: no hay
  // estado compartido entre montajes que se pueda romper.
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, () => {
    const primero = render(<AdSlot plan="free" />);
    assert.ok(primero.container.querySelector("iframe"));
    primero.unmount();

    const segundo = render(<AdSlot plan="free" />);
    assert.ok(segundo.container.querySelector("iframe"), "el segundo montaje también debe renderizar el iframe");
  });
});
