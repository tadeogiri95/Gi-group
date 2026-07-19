// tests/ui-tints.test.js — Guardia contra el patrón CSS inválido var()+alpha
//
// Concatenar un alpha hex a una CSS var (`${AMBER}22` donde AMBER es
// "var(--color-...)") no es CSS válido: el navegador descarta la declaración
// y el fondo/borde queda transparente EN SILENCIO. En 2026-07 esto rompía
// 93 sitios en 20 archivos (commit d9c6c73). La forma correcta:
//   color-mix(in srgb, ${AMBER} 13%, transparent)
//
// Este test escanea el código fuente de app/ y falla si el patrón reaparece.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = new URL("../app", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(p, out);
    else if (/\.(jsx|js|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test("ningún archivo de app/ concatena alpha hex a una CSS var", () => {
  const ofensas = [];
  for (const file of listFiles(APP_DIR)) {
    const src = readFileSync(file, "utf8");
    const lineas = src.split("\n");

    // Consts de este archivo cuyo valor es var(--...)
    const varConsts = [...src.matchAll(/const\s+(\w+)\s*=\s*"var\([^"]*\)"/g)].map(m => m[1]);

    lineas.forEach((linea, i) => {
      // Forma directa: var(--x)NN  (NN = 2 dígitos hex, no seguidos de \w)
      if (/var\(--[\w-]+\)[0-9A-Fa-f]{2}(?![0-9A-Fa-f\w])/.test(linea)) {
        ofensas.push(`${file}:${i + 1} → var(--x)NN directo`);
      }
      // Forma interpolada: ${CONST_var}NN o CONST_var + "NN"
      for (const name of varConsts) {
        if (new RegExp(`\\$\\{${name}\\}[0-9A-Fa-f]{2}(?![0-9A-Fa-f\\w])`).test(linea)) {
          ofensas.push(`${file}:${i + 1} → \${${name}}NN`);
        }
        if (new RegExp(`${name}\\s*\\+\\s*"[0-9A-Fa-f]{2}"`).test(linea)) {
          ofensas.push(`${file}:${i + 1} → ${name} + "NN"`);
        }
      }
    });
  }
  assert.deepEqual(
    ofensas,
    [],
    `Patrón var()+alpha inválido (produce color transparente en silencio). ` +
    `Usá color-mix(in srgb, <color> P%, transparent).\n${ofensas.join("\n")}`
  );
});
