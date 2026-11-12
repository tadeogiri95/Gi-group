// tests/pc-menu-lateral.test.jsx — Versión para computadora (auditoría 01/11,
// PR 5): menú a la izquierda para la oficina, las opciones de cada botón a la
// vista, la tabla de OT y el detalle al costado. En el celular no cambia.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import MenuLateral, { gruposMenu, opcionAbierta } from "../app/components/nav/MenuLateral.jsx";

afterEach(() => cleanup());
const leer = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8");

const empresa = { nombre: "Acme", modulos: ["proyectos", "actividad", "stock", "minutas"] };
const gerente = { rol: "gerencial" };

test("menú — los botones con sus opciones, lo no contratado con candado, y Empresa al final", () => {
  const g = gruposMenu(empresa, gerente, 3);
  assert.deepEqual(g.map((x) => x.titulo || x.id), ["inicio", "Producción", "Materiales", "Personal", "Empresa"], "sin Mantenimiento: no tiene flota ni maquinaria");
  const prod = g.find((x) => x.id === "proyectos").items;
  assert.deepEqual(prod.map((i) => i.label), ["OT", "Reportes", "Instalaciones", "Planificación", "Minuta"]);
  const mat = g.find((x) => x.id === "inventario").items;
  assert.deepEqual(mat.map((i) => [i.label, !!i.bloqueado]), [["Stock", false], ["Compras", true]]);
  assert.equal(g.find((x) => x.id === "personal").items.find((i) => i.label === "Permisos").badge, 3);
  // Planificación y Minuta son solo del dueño
  const admin = gruposMenu(empresa, { rol: "administrativo" }).find((x) => x.id === "proyectos").items;
  assert.deepEqual(admin.map((i) => i.label), ["OT", "Reportes", "Instalaciones"]);
});

test("menú — la opción abierta es la elegida o la primera que la empresa tiene", () => {
  assert.equal(opcionAbierta("proyectos", empresa, gerente, "minuta"), "minuta");
  assert.equal(opcionAbierta("proyectos", empresa, gerente, null), "ot");
  assert.equal(opcionAbierta("inventario", empresa, gerente, "nada"), "stock");
});

test("menú — marca dónde está y lleva a cada opción", () => {
  const idas = [];
  render(<MenuLateral empresa={empresa} usuario={gerente} pend={2} screen="proyectos" seccion={null} onIr={(d) => idas.push(d)} />);
  const menu = screen.getByRole("complementary", { name: "Menú" });
  assert.ok(within(menu).getByText("Acme"));
  assert.equal(within(menu).getByRole("button", { name: "OT" }).getAttribute("aria-current"), "page");
  fireEvent.click(within(menu).getByRole("button", { name: /Minuta/ }));
  fireEvent.click(within(menu).getByRole("button", { name: "Inicio" }));
  fireEvent.click(within(menu).getByRole("button", { name: /Permisos/ }));
  assert.deepEqual(idas, ["proyectos:minuta", "home", "solicitudes"]);
});

test("shell — el menú es solo de la oficina y la barra de abajo se esconde en la computadora", () => {
  const home = leer("[slug]/HomeContent.jsx");
  assert.match(home, /\{uIsGer && <MenuLateral /);
  assert.match(home, /<div className="columna-app">/);
  const css = leer("globals.css");
  const pc = [...css.matchAll(/@media \(min-width: (\d+)px\) \{([\s\S]*?)\n\}/g)].find(([, , c]) => c.includes(".app-shell.app-shell--pc"));
  assert.equal(pc[1], "1024", "en celular y tablet no cambia");
  assert.match(pc[2], /\.app-shell--pc \.columna-app > nav\[aria-label="Navegación principal"\],\s*\.app-shell--pc \.solo-cel \{\s*display: none;/);
  assert.match(pc[2], /\.app-shell--pc \.menu-lateral \{\s*display: block;/);
  assert.match(css, /\.menu-lateral,\s*\.solo-pc \{\s*display: none;/, "fuera de la computadora, ni menú ni tabla");
  // Las pestañas de cada botón quedan para el celular (en la computadora están en el menú)
  assert.match(leer("components/screens/BotonGestionScreen.jsx"), /<div className="solo-cel shrink-0">\s*<Pestanas /);
});

test("OT — tabla en la computadora, tarjetas en el celular, y el detalle al costado", () => {
  const ot = leer("proyectos_screen.jsx");
  assert.match(ot, /<div className="solo-pc">\s*<table [^>]*aria-label="Órdenes de trabajo"/);
  assert.match(ot, /<tr key=\{p\.id\} onClick=\{\(\) => setDetalle\(p\)\}/);
  assert.match(ot, /<div className="solo-cel">\s*<div className="lista-ancha flex flex-col gap-2">/);
  assert.match(leer("components/DetalleOp.jsx"), /lg:items-stretch lg:justify-end/);
});
