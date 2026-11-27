// tests/placas-cortadas.test.jsx — 🪚 Placas cortadas entre varias OT (27/11):
// se escanea la placa, se pone cuántas se cortaron y las OT del corte, y Gypi
// reparte según lo que le falta a cada OT, con un decimal.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  pendientesPorOt, otsConFalta, repartirPlacas, sumaReparto, repartoValido, notaCorte, leerReparto,
} from "../app/lib/repartoPlacas.js";

afterEach(() => cleanup());

const { default: PlacasCortadas } = await import("../app/components/PlacasCortadas.jsx");
const { default: RetirarMaterial } = await import("../app/components/RetirarMaterial.jsx");

// ─── Reparto ───

test("reparto — según lo que le falta a cada OT, con un decimal", () => {
  assert.deepEqual(repartirPlacas(10, [{ ot: "A", necesario: 6, falta: 6 }, { ot: "B", necesario: 2, falta: 2 }]),
    [{ ot: "A", cantidad: 7.5 }, { ot: "B", cantidad: 2.5 }]);
  // Alcanza con lo que falta: no se pasa de lo pendiente
  assert.deepEqual(repartirPlacas(4, [{ ot: "A", necesario: 10, falta: 6 }, { ot: "B", necesario: 2, falta: 2 }]),
    [{ ot: "A", cantidad: 3 }, { ot: "B", cantidad: 1 }]);
});

test("reparto — siempre suma lo cortado (redondeo de décimas)", () => {
  const r = repartirPlacas(10, [{ ot: "A", falta: 1, necesario: 1 }, { ot: "B", falta: 1, necesario: 1 }, { ot: "C", falta: 1, necesario: 1 }]);
  assert.equal(sumaReparto(r), 10);
  assert.deepEqual(r.map((x) => x.cantidad), [3.4, 3.3, 3.3]);
  const r2 = repartirPlacas(7, [{ ot: "A", falta: 3.3 }, { ot: "B", falta: 5.1 }, { ot: "C", falta: 1.7 }]);
  assert.equal(sumaReparto(r2), 7);
});

test("reparto — si se cortó de más, el sobrante va según lo que necesitaba cada OT", () => {
  // A: le faltan 2 de 8; B: le falta 1 de 2. Se cortan 8 → sobran 5, reparten 8:2
  assert.deepEqual(repartirPlacas(8, [{ ot: "A", necesario: 8, falta: 2 }, { ot: "B", necesario: 2, falta: 1 }]),
    [{ ot: "A", cantidad: 6 }, { ot: "B", cantidad: 2 }]);
});

test("reparto — OT sin esa placa empieza en 0; si ninguna la tiene, partes iguales", () => {
  assert.deepEqual(repartirPlacas(4, [{ ot: "A", necesario: 5, falta: 5 }, { ot: "Z", necesario: 0, falta: 0 }]),
    [{ ot: "A", cantidad: 4 }, { ot: "Z", cantidad: 0 }]);
  assert.deepEqual(repartirPlacas(3, [{ ot: "X" }, { ot: "Y" }]), [{ ot: "X", cantidad: 1.5 }, { ot: "Y", cantidad: 1.5 }]);
  assert.deepEqual(repartirPlacas(0, [{ ot: "X" }]), [{ ot: "X", cantidad: 0 }]);
});

test("pendientes — necesidades menos lo retirado (las devoluciones restan; obras terminadas no)", () => {
  const p = pendientesPorOt(
    [{ ot: "A", cantidad: 6, fecha: "2026-12-05" }, { ot: "B", cantidad: 3, fecha: "2026-12-01" }, { ot: "C", cantidad: 4, obra_terminada: true }],
    [{ ot: "A", cantidad: 2, tipo: "consumo" }, { ot: "A", cantidad: 1, tipo: "devolucion" }, { ot: "B", cantidad: 5, tipo: "consumo" }, { ot: "A", cantidad: 9, tipo: "consumo", anulado: true }],
  );
  assert.equal(p.get("A").falta, 5);
  assert.equal(p.get("B").falta, 0);
  assert.equal(p.has("C"), false);
  assert.deepEqual(otsConFalta(p).map((f) => f.ot), ["A"]);
});

test("validar y nota — suma exacta, números del operario", () => {
  assert.equal(repartoValido([{ ot: "A", cantidad: 7.5 }, { ot: "B", cantidad: 2.5 }], 10), true);
  assert.equal(repartoValido([{ ot: "A", cantidad: 7 }, { ot: "B", cantidad: 2.5 }], 10), false);
  assert.equal(repartoValido([{ ot: "A", cantidad: 0 }], 0), false);
  assert.equal(leerReparto("7,5"), 7.5);
  assert.equal(leerReparto("0"), 0);
  assert.equal(leerReparto(""), null);
  assert.equal(leerReparto("-1"), null);
  assert.equal(notaCorte(10, ["A", "B"]), "Corte conjunto: 10 placas entre OT A, B");
});

// ─── Pantalla ───

const E = "11111111-1111-1111-1111-111111111111";
const MELAMINA = { sku: "1.1.1.1", nombre: "MELAMINA BLANCA 18 MM", unidad: "UN", division: "MADERA", familia: "Placas, chapas, mallas y paneles", activo: true };
const BISAGRA = { sku: "4.1.2.7", nombre: "Bisagra cazoleta 35", unidad: "UN", division: "HERRAJES", familia: "Bisagras", activo: true };

function mockPantalla() {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/stock/movimientos")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, cargados: body.renglones.length }), { status: 200 });
    }
    const path = body?.path || "";
    if (path.startsWith("articulos_stock")) return new Response(JSON.stringify({ data: [MELAMINA, BISAGRA] }), { status: 200 });
    if (path.startsWith("necesidades_stock")) return new Response(JSON.stringify({ data: [{ ot: "M-1", cantidad: 6 }, { ot: "M-2", cantidad: 4 }] }), { status: 200 });
    if (path.startsWith("movimientos_stock")) return new Response(JSON.stringify({ data: [{ id: 1, ot: "M-2", cantidad: 2, tipo: "consumo" }] }), { status: 200 });
    if (path.startsWith("proyectos")) return new Response(JSON.stringify({ data: [{ id: 1, ot: "M-1", estado: "activo" }, { id: 2, ot: "M-2", estado: "activo" }, { id: 3, ot: "M-3", estado: "activo" }] }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return enviados;
}

test("placas cortadas — busca la placa, marca las OT, reparte y registra un retiro por OT", async () => {
  const enviados = mockPantalla();
  render(<PlacasCortadas empresaId={E} onClose={() => {}} />);
  const buscar = screen.getByLabelText("Buscar placa");
  fireEvent.focus(buscar);
  fireEvent.change(buscar, { target: { value: "a" } });
  // Solo placas: la bisagra no aparece
  await screen.findByText("MELAMINA BLANCA 18 MM");
  assert.equal(screen.queryByText("Bisagra cazoleta 35"), null);
  fireEvent.click(screen.getByText("MELAMINA BLANCA 18 MM"));

  fireEvent.change(await screen.findByLabelText("¿Cuántas cortaste? (UN)"), { target: { value: "8" } });
  fireEvent.click(await screen.findByLabelText("La OT M-1 entró en el corte"));
  fireEvent.click(screen.getByLabelText("La OT M-2 entró en el corte"));
  // Le faltan 6 a M-1 y 2 a M-2 (necesita 4, ya retiró 2) → 6 y 2
  await waitFor(() => assert.equal(screen.getByLabelText("Placas para la OT M-1").value, "6"));
  assert.equal(screen.getByLabelText("Placas para la OT M-2").value, "2");
  // Con 10 cortadas sobran 2, que van según lo que necesitaba cada una (6 y 4)
  fireEvent.change(screen.getByLabelText("¿Cuántas cortaste? (UN)"), { target: { value: "10" } });
  await waitFor(() => assert.equal(screen.getByLabelText("Placas para la OT M-1").value, "7,2"));
  assert.equal(screen.getByLabelText("Placas para la OT M-2").value, "2,8");

  // A mano: si no suma, no deja registrar
  fireEvent.change(screen.getByLabelText("Placas para la OT M-1"), { target: { value: "7" } });
  assert.ok(screen.getByText("Suman 9,8 de 10 UN."));
  assert.equal(screen.getByText("Registrar el corte").disabled, true);
  fireEvent.change(screen.getByLabelText("Placas para la OT M-2"), { target: { value: "3" } });
  fireEvent.click(screen.getByText("Registrar el corte"));

  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], {
    accion: "registrar_varios", tipo: "consumo", notas: "Corte conjunto: 10 placas entre OT M-1, M-2",
    renglones: [{ sku: MELAMINA.sku, cantidad: 7, ot: "M-1" }, { sku: MELAMINA.sku, cantidad: 3, ot: "M-2" }],
  });
  await screen.findByText(/Registrado: 10 UN de MELAMINA BLANCA 18 MM/);
});

test("placas cortadas — se abre desde Retirar material", async () => {
  mockPantalla();
  render(<RetirarMaterial empresaId={E} usuario={{ id: "x", rol: "operativo" }} onClose={() => {}} />);
  fireEvent.click(screen.getByText("🪚 Placas cortadas (una o varias OT)"));
  assert.ok(await screen.findByLabelText("Buscar placa"));
  fireEvent.click(screen.getByText("Volver a Retirar material"));
  assert.ok(await screen.findByLabelText("Buscar artículo"));
});
