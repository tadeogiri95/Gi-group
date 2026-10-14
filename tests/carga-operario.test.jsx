// tests/carga-operario.test.jsx — El operario llega a la carga de una OT
// desde su inicio (🚚 Carga de una OT), sin depender del QR de un rótulo.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { default: HomeEmp } = await import("../app/components/screens/HomeEmp.jsx");
const { filtrarOts } = await import("../app/components/ElegirOtCarga.jsx");
const { modulosEfectivos } = await import("../app/lib/modulos.js");

afterEach(() => cleanup());

const USUARIO = { id: "emp-1", empresa_id: "e-1", apodo: "Ana", rol: "operativo" };
const OTS = [
  { id: 1, ot: "7038", cliente: "Gómez", obra: "Casa Nordelta", estado: "activo" },
  { id: 2, ot: "7495", cliente: "Pérez", obra: "Oficina Centro", fecha_entrega: "2026-11-02", estado: "activo" },
];

function inicio({ plan = "planta_15", onAbrirCarga } = {}) {
  const pedidos = [];
  global.fetch = async (_u, o) => {
    const { path } = JSON.parse(o.body);
    pedidos.push(path);
    return Response.json({ ok: true, data: path.startsWith("proyectos?") ? OTS : [] });
  };
  render(
    <HomeEmp goto={() => {}} usuario={USUARIO} demo onAbrirCarga={onAbrirCarga}
      empresa={{ modulos: modulosEfectivos({ plan }) }}
      ctx={{ fichadaHoy: { ingreso: "08:00:00" }, misSolicitudes: [], fichadasSemana: [], notificaciones: [] }}
      etapas={[]} actividadesHoy={[]} />
  );
  return { pedidos };
}

test("inicio del operario — 🚚 Carga de una OT abre la lista y lleva a la carga elegida", async () => {
  const elegidas = [];
  const { pedidos } = inicio({ onAbrirCarga: (ot) => elegidas.push(ot) });
  fireEvent.click(screen.getByRole("button", { name: /Carga de una OT/ }));
  assert.ok(await screen.findByRole("button", { name: "Cargar la OT 7495" }));
  assert.ok(pedidos.some((p) => p.includes("estado=eq.activo") && p.includes("empresa_id=eq.e-1")), "solo las OT activas de su empresa");
  fireEvent.change(screen.getByLabelText("Buscar OT"), { target: { value: "nordelta" } });
  assert.equal(screen.queryByRole("button", { name: "Cargar la OT 7495" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Cargar la OT 7038" }));
  assert.deepEqual(elegidas, ["7038"]);
  assert.equal(screen.queryByLabelText("Buscar OT"), null, "la lista se cierra al elegir");
});

test("inicio del operario — en el demo (sin a dónde ir) no aparece", () => {
  inicio({ onAbrirCarga: undefined });
  assert.equal(screen.queryByRole("button", { name: /Carga de una OT/ }), null);
});

test("filtrarOts — busca por número, cliente u obra, sin acentos ni mayúsculas", () => {
  assert.deepEqual(filtrarOts(OTS, "749").map((p) => p.ot), ["7495"]);
  assert.deepEqual(filtrarOts(OTS, "GOMEZ").map((p) => p.ot), ["7038"]);
  assert.deepEqual(filtrarOts(OTS, "  ").map((p) => p.ot), ["7038", "7495"]);
});

test("HomeContent — la OT elegida abre la misma carga que el QR (?carga=OT), nunca en demo", () => {
  const home = readFileSync(new URL("../app/[slug]/HomeContent.jsx", import.meta.url), "utf8");
  assert.match(home, /const abrirCarga = \(ot\) => cambiarParams\(\(p\) => \{ p\.delete\("acta"\); p\.set\("carga", ot\); \}\)/);
  assert.match(home, /onAbrirCarga=\{isDemo \? undefined : abrirCarga\}/);
});
