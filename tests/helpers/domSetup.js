// tests/helpers/domSetup.js — Entorno DOM mínimo para tests de componentes
// React con @testing-library/react, sin depender de un test runner con
// "environment: jsdom" incorporado (node:test no tiene ese concepto).
//
// Importar ANTES de cualquier import de react-dom o de un componente:
//   import "./helpers/domSetup.js";
import { JSDOM } from "jsdom";
import React from "react";

// tsx no aplica el JSX runtime automático (jsx: "react-jsx" en tsconfig.json)
// a archivos .jsx fuera del include de TS (la carpeta tests/ está excluida).
// Resultado: el JSX de los componentes se transforma a React.createElement
// clásico, que espera `React` en scope. Lo exponemos como global acá en vez
// de tocar los componentes de producción (que no necesitan import React).
global.React = React;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
// Node 21+ define `navigator` como getter de solo lectura en el global —
// hay que redefinir la propiedad en vez de asignarla.
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// IS_REACT_ACT_ENVIRONMENT silencia el warning de React 18+/19 sobre
// actualizaciones fuera de act() en entornos de test.
global.IS_REACT_ACT_ENVIRONMENT = true;
