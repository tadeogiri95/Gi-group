// tests/component-ad-slot.test.jsx — Test de componente (RTL) para AdSlot:
// gating por plan y por configuración de env vars (kill-switch).
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
    assert.equal(container.querySelector("ins.adsbygoogle"), null);
  });
});

test("AdSlot — no renderiza nada en plan free si faltan las env vars (kill-switch)", () => {
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: undefined, NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: undefined }, () => {
    const { container } = render(<AdSlot plan="free" />);
    assert.equal(container.querySelector("ins.adsbygoogle"), null);
  });
});

test("AdSlot — renderiza el contenedor del anuncio en plan free con env vars configuradas", () => {
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, () => {
    const { container } = render(<AdSlot plan="free" />);
    const ins = container.querySelector("ins.adsbygoogle");
    assert.ok(ins, "debe renderizar el <ins class=adsbygoogle>");
    assert.equal(ins.getAttribute("data-ad-client"), "ca-pub-test");
    assert.equal(ins.getAttribute("data-ad-slot"), "123");
  });
});

test("AdSlot — trial no muestra publicidad", () => {
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, () => {
    const { container } = render(<AdSlot plan="trial" />);
    assert.equal(container.querySelector("ins.adsbygoogle"), null);
  });
});
