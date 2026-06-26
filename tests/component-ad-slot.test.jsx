// tests/component-ad-slot.test.jsx — Test de componente (RTL) para AdSlot:
// gating por plan y por configuración de env vars (kill-switch).
import "./helpers/domSetup.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, cleanup } from "@testing-library/react";

const { default: AdSlot } = await import("../app/components/AdSlot.jsx");

// Los 3 flags viven en window (no en el componente) a propósito: deben
// sobrevivir a que AdSlot se desmonte/remonte dentro de la misma sesión
// de página. Por eso mismo hay que resetearlos entre tests — si no, el
// primer test que efectivamente pide un anuncio deja "usada" la sesión
// para todos los que corren después.
beforeEach(() => {
  delete window.__gypiAdYaSolicitado;
  delete window.__gypiPageLevelAdsDisabled;
  delete window.__gypiAdWatchdog;
});
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

test("AdSlot — un segundo montaje en la misma sesión no vuelve a pedir anuncio ni renderiza el <ins>", () => {
  withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, () => {
    // Primer montaje: DashboardGerencia al entrar a Inicio la primera vez.
    const primero = render(<AdSlot plan="free" />);
    assert.ok(primero.container.querySelector("ins.adsbygoogle"), "el primer montaje debe pedir y mostrar el anuncio");
    primero.unmount(); // salir de la pestaña Inicio (DashboardGerencia se desmonta)

    // Segundo montaje en la MISMA sesión de página (sin reload real):
    // volver a entrar a Inicio. Pedirle a Google un anuncio nuevo para el
    // mismo slot en este punto es lo que rompía el scroll táctil en
    // producción (confirmado con video real por el usuario).
    const segundo = render(<AdSlot plan="free" />);
    assert.equal(segundo.container.querySelector("ins.adsbygoogle"), null, "el segundo montaje no debe volver a pedir el anuncio");
  });
});

test("AdSlot — el watchdog remueve un overlay full-viewport inyectado fuera de React", async () => {
  const overlay = document.createElement("div");
  await withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, async () => {
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
  });
  overlay.remove();
});

test("AdSlot — el watchdog no toca un elemento fixed chico (falso positivo)", async () => {
  const chip = document.createElement("div");
  await withEnv({ NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-test", NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: "123" }, async () => {
    render(<AdSlot plan="free" />);

    chip.style.position = "fixed";
    chip.getBoundingClientRect = () => ({ width: 40, height: 40, top: 0, left: 0, right: 40, bottom: 40, x: 0, y: 0, toJSON() {} });
    document.body.appendChild(chip);

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(document.body.contains(chip), true, "un elemento fixed chico no debería ser tratado como overlay");
  });
  chip.remove();
});
