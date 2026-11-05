// tests/instalacion-arrastrar.test.jsx — Mover obras arrastrándolas en el 🔧
// Gantt de instalación (Tadeo, 05/11; migración 157): queda "instalar desde"
// en cada OT y nunca antes del día hábil siguiente a que termina producción.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { normalizarParametros } from "../app/lib/planificacion.js";
import { trabajosInstalacion, planInstalacion, fechaArrastrada } from "../app/lib/planInstalacion.js";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";
import { stripUnallowedFields } from "../app/lib/validate.ts";

const { default: GanttInstalacion } = await import("../app/components/GanttInstalacion.jsx");
afterEach(() => cleanup());

const params = normalizarParametros({ instalacion: { gab_por_dia: { global: 3 } } });
const hoy = "2026-11-03"; // martes

test("trabajosInstalacion — la fecha elegida corre la obra para después, nunca antes del fin de producción", () => {
  const proyectos = [
    { ot: "1", cliente: "A", obra: "x", total_modulos: 3, instalacion_desde: "2026-11-12" },
    { ot: "2", cliente: "B", obra: "y", total_modulos: 3, instalacion_desde: "2026-11-04" }, // antes de lo posible
    { ot: "3", cliente: "C", obra: "z", total_modulos: 3 },
  ];
  const fin = new Map([["1", { fin: "2026-11-04" }], ["2", { fin: "2026-11-06" }], ["3", { fin: "2026-11-04" }]]);
  const { trabajos } = trabajosInstalacion({ proyectos, finProduccion: fin, params, inst: params.instalacion, hoy });
  const de = (ot) => trabajos.find((t) => t.ots[0].ot === ot);
  assert.equal(de("1").desde, "2026-11-12");
  assert.equal(de("1").minimo, "2026-11-05");
  assert.equal(de("2").desde, "2026-11-09", "manda producción: el lunes después del viernes 6");
  assert.equal(de("3").desde, "2026-11-05");
  // Las movidas a mano van primero (por fecha) y toman su lugar
  assert.deepEqual(trabajos.map((t) => t.ots[0].ot), ["2", "1", "3"]);
  const obras = planInstalacion(trabajos, [], { hoy });
  assert.equal(obras.find((o) => o.ots[0].ot === "1").inicio, "2026-11-12");
  assert.equal(obras.find((o) => o.ots[0].ot === "1").esperaProduccion, false, "no espera producción: la movieron");
});

test("fechaArrastrada — antes del mínimo queda en el mínimo", () => {
  assert.deepEqual(fechaArrastrada({ minimo: "2026-11-09" }, "2026-11-05"), { fecha: "2026-11-09", ajustada: true });
  assert.deepEqual(fechaArrastrada({ minimo: "2026-11-09" }, "2026-11-12"), { fecha: "2026-11-12", ajustada: false });
});

test("migración 157 y se puede guardar desde la app", async () => {
  assert.ok(MIGRACIONES.some((m) => m.n === 157 && m.tablas.proyectos.includes("instalacion_desde")));
  const sql = readFileSync(new URL("../supabase/migrations/157_instalacion_desde.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /add column if not exists instalacion_desde date/);
  assert.deepEqual(stripUnallowedFields({ instalacion_desde: "2026-11-12" }, "proyectos", "PATCH"), { instalacion_desde: "2026-11-12" });
  const { validarPatch } = await import("../app/lib/dataPolicy.js");
  assert.equal(validarPatch("proyectos", { instalacion_desde: "mañana" })?.status, 400);
  assert.equal(validarPatch("proyectos", { instalacion_desde: null }), null);
  assert.equal(validarPatch("proyectos", { instalacion_desde: "2026-11-12" }), null);
});

function montar({ puedeConfirmar = true } = {}) {
  const parches = [];
  global.fetch = async (url, opts) => {
    const u = `${url} ${opts?.body || ""}`;
    if (opts?.body && /"method":"PATCH"/.test(opts.body)) { parches.push(JSON.parse(opts.body)); return Response.json({ data: [] }); }
    if (u.includes("empleados")) return Response.json({ data: [{ id: "a", nombre: "Ana" }, { id: "b", nombre: "Beto" }] });
    return Response.json({ data: [] });
  };
  return parches;
}

test("GanttInstalacion — arrastrar la barra a otro día guarda la fecha en las OT de la obra", async () => {
  const parches = montar();
  const { hoyArg } = await import("../app/lib/dates.js");
  const h = hoyArg();
  const fin = new Date(Date.parse(`${h}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);
  const proyectos = [{ id: 11, ot: "7961", cliente: "Riofrío", obra: "Maipú", division: "Muebles", total_modulos: 6, fecha_objetivo: "2099-01-10" }];
  const vivo = { renglones: [{ ot: "7961", fin, procesos: [{ completo: false }] }], cfgValor: { instalacion: { gab_por_dia: { global: 3 } } }, modulos: new Map() };
  const vistos = [];
  const { container } = render(<GanttInstalacion vivo={vivo} proyectos={proyectos} divisiones={[{ id: "muebles", label: "Muebles" }]} puedeConfirmar onVerDetalle={(p) => vistos.push(p.ot)} />);
  await screen.findByRole("button", { name: /OT 7961/ });
  const barras = container.querySelector("[data-barras]");
  // 10 días para adelante (46 px por día con "Todo")
  fireEvent.pointerDown(barras, { clientX: 100, pointerId: 1 });
  fireEvent.pointerMove(barras, { clientX: 100 + 46 * 10, pointerId: 1 });
  fireEvent.pointerUp(barras, { clientX: 100 + 46 * 10, pointerId: 1 });
  await waitFor(() => assert.ok(parches.length));
  assert.match(parches[0].path, /proyectos\?id=in\.\(11\)/);
  assert.match(parches[0].body.instalacion_desde, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(parches[0].body.instalacion_desde > fin);
  assert.ok(screen.getByText(/se instala desde el/));
  assert.deepEqual(vistos, [], "arrastrar no abre el detalle");
  // Para atrás, antes del fin de producción: queda en el mínimo y avisa
  fireEvent.pointerDown(barras, { clientX: 600, pointerId: 1 });
  fireEvent.pointerMove(barras, { clientX: 600 - 46 * 30, pointerId: 1 });
  fireEvent.pointerUp(barras, { clientX: 600 - 46 * 30, pointerId: 1 });
  await waitFor(() => assert.equal(parches.length, 2));
  assert.ok(parches[1].body.instalacion_desde > fin);
  assert.ok(screen.getByText(/no se puede instalar antes del/));
});

test("GanttInstalacion — sin permiso de gestión no se arrastra", async () => {
  const parches = montar();
  const { hoyArg } = await import("../app/lib/dates.js");
  const fin = new Date(Date.parse(`${hoyArg()}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);
  const proyectos = [{ id: 11, ot: "7961", cliente: "Riofrío", obra: "Maipú", division: "Muebles", total_modulos: 6 }];
  const vivo = { renglones: [{ ot: "7961", fin, procesos: [{ completo: false }] }], cfgValor: { instalacion: { gab_por_dia: { global: 3 } } }, modulos: new Map() };
  const { container } = render(<GanttInstalacion vivo={vivo} proyectos={proyectos} divisiones={[{ id: "muebles", label: "Muebles" }]} />);
  await screen.findByRole("button", { name: /OT 7961/ });
  const barras = container.querySelector("[data-barras]");
  fireEvent.pointerDown(barras, { clientX: 100, pointerId: 1 });
  fireEvent.pointerUp(barras, { clientX: 600, pointerId: 1 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(parches.length, 0);
});
