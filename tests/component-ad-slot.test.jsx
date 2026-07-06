// tests/component-ad-slot.test.jsx — Test de componente (RTL) para AdSlot:
// gating por plan y por configuración de env vars (kill-switch), y que el
// anuncio se renderiza dentro de un iframe srcdoc aislado (ver AdSlot.jsx)
// en vez de cargar adsbygoogle.js directo en el document de la app.
// Incluye tests de NPA (non-personalized ads) según estado de consent.
import "./helpers/domSetup.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, cleanup } from "@testing-library/react";

const CONSENT_KEY = "gypi_cookie_consent";

beforeEach(() => localStorage.removeItem(CONSENT_KEY));
afterEach(() => { cleanup(); localStorage.removeItem(CONSENT_KEY); });

const { default: AdSlot } = await import("../app/components/AdSlot.jsx");

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

test("AdSlot — con consent aceptado ('1') renderiza ads personalizados (sin NPA)", () => {
  localStorage.setItem(CONSENT_KEY, "1");
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, () => {
    const { container } = render(<AdSlot plan="free" />);
    const iframe = container.querySelector("iframe");
    assert.ok(iframe, "debe renderizar un <iframe>");
    assert.equal(iframe.getAttribute("src"), null, "no debe tener atributo src (URL rastreable)");
    const srcdoc = iframe.getAttribute("srcdoc");
    assert.ok(srcdoc, "debe tener atributo srcdoc");
    assert.ok(srcdoc.includes('data-ad-client="ca-pub-test"'), "srcdoc debe incluir el client ID");
    assert.ok(srcdoc.includes('data-ad-slot="123"'), "srcdoc debe incluir el slot ID");
    assert.ok(!srcdoc.includes("nonpersonalized"), "con consent '1' NO debe incluir NPA");
  });
});

test("AdSlot — sin consent previo renderiza ads no personalizados (NPA)", () => {
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, () => {
    const { container } = render(<AdSlot plan="free" />);
    const iframe = container.querySelector("iframe");
    assert.ok(iframe, "debe renderizar un <iframe> aún sin consent");
    const srcdoc = iframe.getAttribute("srcdoc");
    assert.ok(srcdoc.includes('data-ad-request-nonpersonalized-ads="1"'), "sin consent debe incluir NPA");
  });
});

test("AdSlot — con consent rechazado ('0') renderiza ads no personalizados (NPA)", () => {
  localStorage.setItem(CONSENT_KEY, "0");
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, () => {
    const { container } = render(<AdSlot plan="free" />);
    const iframe = container.querySelector("iframe");
    assert.ok(iframe, "debe renderizar un <iframe> con consent '0'");
    const srcdoc = iframe.getAttribute("srcdoc");
    assert.ok(srcdoc.includes('data-ad-request-nonpersonalized-ads="1"'), "con consent '0' debe incluir NPA");
  });
});

test("AdSlot — un segundo montaje en la misma sesión vuelve a renderizar el iframe sin problema", () => {
  localStorage.setItem(CONSENT_KEY, "1");
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, () => {
    const primero = render(<AdSlot plan="free" />);
    assert.ok(primero.container.querySelector("iframe"));
    primero.unmount();

    const segundo = render(<AdSlot plan="free" />);
    assert.ok(segundo.container.querySelector("iframe"), "el segundo montaje también debe renderizar el iframe");
  });
});
