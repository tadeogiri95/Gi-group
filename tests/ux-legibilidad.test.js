// tests/ux-legibilidad.test.js — Reforma UX, etapa R2: que todo se lea al sol
// y se pueda tocar con guantes. Son controles automáticos: si alguien vuelve a
// poner texto chico o un gris flojo, este test falla.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const { THEME_PRESETS, deriveDimMute, contraste, textOnColor } = await import("../app/lib/theme.js");

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const sobre = (rgba, fondo) => {
  const [r, g, b, a] = rgba.match(/[\d.]+/g).map(Number);
  return [r, g, b].map((c, i) => c * a + fondo[i] * (1 - a));
};

test("texto secundario: 4,5 a 1 o más en los 8 temas (antes 3,3 a 1 en el claro)", () => {
  for (const [nombre, p] of Object.entries(THEME_PRESETS)) {
    const fondo = rgb(p.bg);
    const { dim, mute } = deriveDimMute(p.text, p.bg);
    assert.ok(contraste(sobre(dim, fondo), fondo) >= 4.5, `${nombre}: gris secundario`);
    assert.ok(contraste(sobre(mute, fondo), fondo) >= 3, `${nombre}: gris de marcadores`);
  }
});

test("texto secundario: también con colores elegidos a mano por la empresa", () => {
  // Combinaciones flojas: texto gris claro sobre blanco, texto oscuro sobre fondo medio
  for (const [texto, fondo] of [["#666666", "#FFFFFF"], ["#14532D", "#F0FDF4"], ["#334155", "#CBD5E1"]]) {
    const { dim } = deriveDimMute(texto, fondo);
    const f = rgb(fondo);
    assert.ok(contraste(sobre(dim, f), f) >= 4.5 || dim.endsWith(",1)"), `${texto} sobre ${fondo}`);
  }
});

test("botones con el color de la empresa: la letra (negra o blanca) se lee", () => {
  const colores = [...Object.values(THEME_PRESETS).map((p) => p.primary), "#F97316", "#16A34A", "#2563EB", "#FACC15", "#7C3AED"];
  for (const c of colores) {
    const letra = rgb(textOnColor(c));
    assert.ok(contraste(letra, rgb(c)) >= 4.5, `${c} con letra ${textOnColor(c)}`);
  }
  // El naranja de Gypi lleva letra negra (blanca daba 2,8 a 1)
  assert.equal(textOnColor("#F97316"), "#000000");
});

test("tokens: nada de 9 px, botones de 48 px y la letra del primario según contraste", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const px = (token) => Number(css.match(new RegExp(`--text-${token}: \\d+ (\\d+)px`))[1]);
  assert.ok(px("overline") >= 11);
  assert.ok(px("micro") >= 12);
  assert.ok(px("label") >= 12);
  assert.match(css, /\.g-btn \{[^}]*min-height: 48px/);
  assert.match(css, /\.g-btn-primary \{[^}]*color: var\(--color-empresa-primary-text/);
  assert.match(css, /--color-text-dim: rgba\(26,26,26,0\.68\)/);
});

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "superadmin" ? [] : archivos(p);
    return /\.(jsx?|tsx?)$/.test(n) ? [p] : [];
  });
}

test("ninguna pantalla usa texto de menos de 11 px", () => {
  const chicos = [];
  for (const f of archivos(new URL("../app", import.meta.url).pathname)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]|fontSize: ?['"]?(\d+)(?:px)?['"]?[,} ]/g)) {
      const n = Number(m[1] ?? m[2]);
      if (n < 11) chicos.push(`${f.split("/app/")[1]}: ${m[0]}`);
    }
  }
  assert.deepEqual(chicos, []);
});

test("sobre el color de la empresa no se fuerza letra blanca ni negra", () => {
  const malos = [];
  for (const f of archivos(new URL("../app", import.meta.url).pathname)) {
    const src = readFileSync(f, "utf8");
    if (/bg-gypi-amber text-(white|black)\b/.test(src)) malos.push(f.split("/app/")[1]);
  }
  assert.deepEqual(malos, []);
});

test("botón de fichar y flechas para volver: legibles y de tamaño para guantes", () => {
  const boton = readFileSync(new URL("../app/components/BotonFichar.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(boton, /font-body text-white flex flex-col/, "la letra del botón grande sale de colorLetra");
  assert.match(boton, /color: colorLetra/);
  const act = readFileSync(new URL("../app/actividad_screen.jsx", import.meta.url), "utf8");
  assert.equal((act.match(/aria-label="Volver" className="min-w-\[48px\] min-h-\[48px\]/g) || []).length, 4);
  const nav = readFileSync(new URL("../app/components/nav/BottomNav.jsx", import.meta.url), "utf8");
  assert.match(nav, /min-h-\[52px\]/);
  assert.match(nav, /isActive \? 'text-gypi-text font-bold'/, "la pestaña activa no usa letra naranja sobre blanco");
});
