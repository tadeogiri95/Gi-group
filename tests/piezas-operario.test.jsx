// tests/piezas-operario.test.jsx — El operario mira las piezas y los módulos
// de una OT con cuántas lleva escaneadas (pedido de Tadeo, 26/11). Solo para
// mirar; en canto por lados (209) la pieza a medio pegar dice cuántos lados van.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { autorizar } from "../app/lib/dataPolicy.js";

afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* sin almacenamiento */ } });

const { default: PiezasOtOperario, avancePorModulo } = await import("../app/components/PiezasOtOperario.jsx");

const ETAPAS = [
  { codigo: 1, nombre: "Corte", orden: 1, por_pieza: true, columna_pieza: "" },
  { codigo: 2, nombre: "Canto", orden: 2, por_pieza: true, columna_pieza: "L1A, L1B, L2A, L2B" },
];
// M1: lateral × 2 (3 lados cada uno) y estante × 1 (sin canto); una suelta sin módulo
const PIEZAS = [
  { id: 1, nombre: "M1-1", modulo: "M1", renglon: 0, unidad: 1, etapas: [1, 2], lados: 3, l1: 700, l2: 500, material: "MELAMINA 18" },
  { id: 2, nombre: "M1-1", modulo: "M1", renglon: 0, unidad: 2, etapas: [1, 2], lados: 3, l1: 700, l2: 500, material: "MELAMINA 18" },
  { id: 3, nombre: "M1-2", modulo: "M1", renglon: 1, unidad: 1, etapas: [1], lados: 0 },
  { id: 4, nombre: "TAPA", modulo: null, renglon: 2, unidad: 1, etapas: [1, 2], lados: 1 },
];
const PASOS = [{ pieza_id: 1, etapa: 1 }, { pieza_id: 2, etapa: 1 }, { pieza_id: 3, etapa: 1 }, { pieza_id: 1, etapa: 2 }];
// La pieza 2 lleva 2 de sus 3 lados en Canto; la 1 ya está pegada (sus 3 lados)
const LADOS = [{ pieza_id: 1, etapa: 2 }, { pieza_id: 1, etapa: 2 }, { pieza_id: 1, etapa: 2 }, { pieza_id: 2, etapa: 2 }, { pieza_id: 2, etapa: 2 }];

function mockData(rutas) {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    const path = body?.path || "";
    pedidos.push(path);
    for (const [prefijo, data] of Object.entries(rutas)) {
      if (path.startsWith(prefijo)) return new Response(JSON.stringify({ data: path.includes("offset=0") ? data : [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return pedidos;
}

test("avancePorModulo — cuenta por módulo y, en canto por lados, los lados pegados", () => {
  const corte = avancePorModulo({ piezas: PIEZAS, pasos: PASOS, lados: LADOS, etapa: 1 });
  assert.deepEqual(corte.map((m) => [m.modulo, m.pasaron, m.total]), [["M1", 3, 3], [null, 0, 1]], "las sin módulo van al final");
  const canto = avancePorModulo({ piezas: PIEZAS, pasos: PASOS, lados: LADOS, etapa: 2, porLados: true });
  assert.deepEqual(canto.map((m) => [m.modulo, m.pasaron, m.total]), [["M1", 1, 2], [null, 0, 1]], "M1-2 no lleva canto");
  const lateral = canto[0].renglones[0];
  assert.equal(lateral.ladosHechos, 5, "3 de la pegada + 2 de la que está a medias");
  assert.equal(lateral.ladosTotal, 6);
  assert.equal(canto[1].renglones[0].ladosTotal, undefined, "con un solo lado no hace falta contar lados");
});

test("PiezasOtOperario — por módulo con la cuenta de cada pieza, solo para mirar", async () => {
  try { localStorage.setItem("gypi_etapa_piezas", "2"); } catch { /* sin almacenamiento */ }
  const pedidos = mockData({ proyectos: [{ id: 9, ot: "7961", cliente: "Siciliano" }], piezas_ot: PIEZAS, pasos_pieza: PASOS, lados_pieza: LADOS, etapas: ETAPAS });
  render(<PiezasOtOperario empresaId="e1" ot="7961" onClose={() => {}} />);
  await screen.findByText("Siciliano");
  // Viene elegida la etapa en la que escaneó la última vez (Canto)
  assert.equal(screen.getByRole("button", { name: /^Canto/ }).getAttribute("aria-pressed"), "true");
  assert.ok(screen.getByText("Canto: 1 de 3 piezas"));
  const m1 = screen.getByRole("list", { name: "Piezas de Módulo M1" });
  assert.match(m1.textContent, /^M1-1700 × 500 · MELAMINA 18/);
  assert.match(m1.textContent, /1 de 2$/);
  assert.match(m1.textContent, /Lados con canto: 5 de 6/);
  assert.ok(screen.getByRole("list", { name: "Piezas de Piezas sin módulo" }));
  // Nada para imprimir, pegar ni borrar
  assert.equal(screen.queryByText(/Imprimir|Pegar la planilla|Borrar/), null);
  assert.ok(pedidos.some((p) => p.startsWith("lados_pieza?empresa_id=eq.e1&ot=eq.7961")), "lee los lados de la OT");

  // Corte: M1 completo; "Solo las que faltan" deja solo la suelta
  fireEvent.click(screen.getByRole("button", { name: /^Corte/ }));
  assert.ok(screen.getByText("Corte: 3 de 4 piezas"));
  fireEvent.click(screen.getByRole("button", { name: "Solo las que faltan" }));
  assert.equal(screen.queryByRole("list", { name: "Piezas de Módulo M1" }), null);
  assert.match(within(screen.getByRole("list", { name: "Piezas de Piezas sin módulo" })).getByText("TAPA").textContent, /TAPA/);
});

test("PiezasOtOperario — OT sin piezas cargadas", async () => {
  mockData({ proyectos: [{ ot: "7961", cliente: "Siciliano" }] });
  render(<PiezasOtOperario ot="7961" onClose={() => {}} />);
  await screen.findByText(/todavía no tiene piezas cargadas/);
});

test("el operario puede leer los lados (solo lectura) y tiene el botón en su Inicio", () => {
  assert.equal(autorizar("lados_pieza", "GET", { rol: "empleado" }).ok, true);
  assert.equal(autorizar("lados_pieza", "POST", { rol: "empleado" }).ok, false, "se escribe solo por /api/piezas/paso");
  const ruta = readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8");
  assert.match(ruta, /TABLAS_SOLO_LECTURA = \[[^\]]*"lados_pieza"/);
  const home = readFileSync(new URL("../app/components/screens/HomeEmp.jsx", import.meta.url), "utf8");
  assert.match(home, /titulo="Piezas de una OT"/);
  const escanear = readFileSync(new URL("../app/components/EscanearPiezas.jsx", import.meta.url), "utf8");
  assert.match(escanear, /Ver las piezas de la OT/);
});
