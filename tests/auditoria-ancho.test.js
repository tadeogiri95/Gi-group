// tests/auditoria-ancho.test.js — PR 4 de la auditoría del 22/10: en la
// computadora, Planta y Equipo usan todo el ancho y las listas van en
// columnas. El celular y las demás pantallas no cambian.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8");

test("el shell se ensancha solo en Planta y Equipo de gestión", () => {
  const home = leer("[slug]/HomeContent.jsx");
  assert.match(home, /const ancho = uIsGer && \(screen === "planta" \|\| screen === "equipo"\);/);
  assert.match(home, /className=\{`app-shell bg-gypi-bg \$\{ancho \? "app-shell--ancho" : ""\}`\}/);
});

test("CSS: ancho completo y listas en columnas solo desde 1024 px", () => {
  const css = leer("globals.css");
  const bloques = [...css.matchAll(/@media \(min-width: (\d+)px\) \{([\s\S]*?)\n\}/g)];
  const ancho = bloques.find(([, , cuerpo]) => cuerpo.includes(".app-shell--ancho"));
  assert.ok(ancho, "hay un bloque para el modo ancho");
  assert.equal(ancho[1], "1024", "en celular y tablet no cambia");
  assert.match(ancho[2], /\.app-shell\.app-shell--ancho \{\s*max-width: 1440px;/);
  assert.match(ancho[2], /\.app-shell--ancho \.lista-ancha \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(auto-fill, minmax\(360px, 1fr\)\)/);
  assert.match(ancho[2], /\.app-shell--ancho > nav\[aria-label="Navegación principal"\]/, "la barra de abajo no se estira");
  // .lista-ancha no aparece fuera del modo ancho
  for (const [, , cuerpo] of bloques.filter((b) => b !== ancho)) assert.doesNotMatch(cuerpo, /lista-ancha/);
});

test("las listas de oficina van en columnas en la computadora", () => {
  const listas = {
    "proyectos_screen.jsx": /<div className="lista-ancha flex flex-col gap-2">\s*\{filtrados\.map\(p =>/,
    "gestion_personal_screen.jsx": /<div className="lista-ancha flex flex-col gap-2">\s*\{filtrados\.map\(emp =>/,
    "components/AComprar.jsx": /aria-label="A comprar" className="[^"]*lista-ancha/,
    "components/OrdenesCompra.jsx": /aria-label="Órdenes de compra" className="[^"]*lista-ancha/,
    "components/ComprasScreen.jsx": /aria-label="Pedidos de material" className="[^"]*lista-ancha/,
    "components/RecibirCompra.jsx": /aria-label="Órdenes para recibir" className="[^"]*lista-ancha/,
    "components/StockScreen.jsx": /lista-ancha/,
    "components/FlotaScreen.jsx": /aria-label="Vehículos" className="[^"]*lista-ancha/,
  };
  for (const [f, re] of Object.entries(listas)) assert.match(leer(f), re, f);
});
