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

test("AdSlot — el watchdog remueve un overlay full-viewport inyectado fuera de React", async () => {
  const prevClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const prevSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD;
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID = "ca-pub-test";
  process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD = "123";
  delete window.__gypiAdWatchdog;
  delete window.__gypiPageLevelAdsDisabled;
  const overlay = document.createElement("div");
  try {
    render(<AdSlot plan="free" />);

    // Simula un anchor/vignette ad: hijo directo de <body>, fixed, cubre
    // toda la pantalla. jsdom no hace layout real, por eso se fuerza
    // getBoundingClientRect en vez de depender de CSS real.
    overlay.style.position = "fixed";
    overlay.getBoundingClientRect = () => ({
      width: window.innerWidth, height: window.innerHeight,
      top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight, x: 0, y: 0, toJSON() {},
    });
    document.body.appendChild(overlay);

    await new Promise((resolve) => setTimeout(resolve, 0)); // deja correr el microtask del MutationObserver

    assert.equal(document.body.contains(overlay), false, "el overlay full-viewport debería haber sido removido por el watchdog");
  } finally {
    overlay.remove();
    if (prevClient === undefined) delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID; else process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID = prevClient;
    if (prevSlot === undefined) delete process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD; else process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD = prevSlot;
    delete window.__gypiAdWatchdog;
    delete window.__gypiPageLevelAdsDisabled;
  }
});

test("AdSlot — el watchdog no toca un elemento fixed chico (falso positivo)", async () => {
  const prevClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const prevSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD;
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID = "ca-pub-test";
  process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD = "123";
  delete window.__gypiAdWatchdog;
  delete window.__gypiPageLevelAdsDisabled;
  const chip = document.createElement("div");
  try {
    render(<AdSlot plan="free" />);

    chip.style.position = "fixed";
    chip.getBoundingClientRect = () => ({ width: 40, height: 40, top: 0, left: 0, right: 40, bottom: 40, x: 0, y: 0, toJSON() {} });
    document.body.appendChild(chip);

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(document.body.contains(chip), true, "un elemento fixed chico no debería ser tratado como overlay");
  } finally {
    chip.remove();
    if (prevClient === undefined) delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID; else process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID = prevClient;
    if (prevSlot === undefined) delete process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD; else process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD = prevSlot;
    delete window.__gypiAdWatchdog;
    delete window.__gypiPageLevelAdsDisabled;
  }
});
