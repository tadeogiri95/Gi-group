// tests/instalacion-plan.test.jsx — Días de instalación de cada OT (parte 42;
// app/lib/instalacionPlan.js, migración 153): gabinetes ÷ gabinetes por
// persona por día del tipo ÷ instaladores, de a medio día; corrección a mano
// en el Detalle de la OT; parámetros en ⚙ Parámetros → 🔧 Instalación.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanup } from "@testing-library/react";
import { normalizarParametros } from "../app/lib/planificacion.js";
import { gabinetesOt } from "../app/lib/cargaPlanta.js";
import { diasInstalacion, medioDia, cuerpoCorreccion, normalizarInstalacion, textoDias, errorInstalacion } from "../app/lib/instalacionPlan.js";
import { stripUnallowedFields } from "../app/lib/validate.ts";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

const { textoCalculo } = await import("../app/components/InstalacionOt.jsx");

afterEach(() => cleanup());

const params = (instalacion) => normalizarParametros({ instalacion });

test("normalizarInstalacion — 2 instaladores por defecto y gabinetes por día sin cargar", () => {
  const i = normalizarInstalacion(null);
  assert.equal(i.personas_por_ot, 2);
  assert.equal(i.gab_por_dia.cocina, null);
  assert.equal(i.gab_por_dia.global, null);
  const j = normalizarInstalacion({ personas_por_ot: 3, gab_por_dia: { cocina: "2,5", placard: -1, rack: "x" } });
  assert.equal(j.personas_por_ot, 3);
  assert.equal(j.gab_por_dia.cocina, 2.5);
  assert.equal(j.gab_por_dia.placard, null);
  assert.equal(j.gab_por_dia.rack, null);
  // Viaja dentro de los parámetros de la planificación (no se pierde al guardar)
  assert.equal(params({ personas_por_ot: 4 }).instalacion.personas_por_ot, 4);
});

test("medioDia — redondea para arriba de a medio día, mínimo medio día", () => {
  assert.equal(medioDia(0.1), 0.5);
  assert.equal(medioDia(1), 1);
  assert.equal(medioDia(1.2), 1.5);
  assert.equal(medioDia(1.6), 2);
});

test("diasInstalacion — módulos de la planilla ÷ gabinetes por persona por día del tipo ÷ instaladores", () => {
  const p = params({ gab_por_dia: { cocina: 3 } });
  const r = diasInstalacion({ ot: "1", descripcion: "COCINA", total_modulos: 12 }, p, p.instalacion);
  assert.equal(r.tipo, "cocina");
  assert.equal(r.gabinetes, 12);
  assert.equal(r.origenGabinetes, "modulos");
  assert.equal(r.diasPersona, 4);
  assert.equal(r.personas, 2);
  assert.equal(r.dias, 2);
  assert.equal(r.manual, false);
  // Con 4 instaladores, 1 día; con 3, 1,33 → 1,5
  assert.equal(diasInstalacion({ descripcion: "COCINA", total_modulos: 12, personas_instalacion: 4 }, p, p.instalacion).dias, 1);
  assert.equal(diasInstalacion({ descripcion: "COCINA", total_modulos: 12, personas_instalacion: 3 }, p, p.instalacion).dias, 1.5);
});

test("diasInstalacion — tipo sin cargar usa Sin tipo; sin nada avisa; a mano manda", () => {
  const p = params({ gab_por_dia: { global: 2 } });
  assert.equal(diasInstalacion({ descripcion: "PLACARD", total_modulos: 4 }, p, p.instalacion).dias, 1);
  const vacio = params(null);
  const sin = diasInstalacion({ descripcion: "PLACARD", total_modulos: 4 }, vacio, vacio.instalacion);
  assert.equal(sin.dias, null);
  assert.match(sin.sinDato, /gabinetes instala una persona/);
  const sinGab = diasInstalacion({ descripcion: "PLACARD" }, p, p.instalacion);
  assert.equal(sinGab.dias, null);
  assert.match(sinGab.sinDato, /módulos ni placas/);
  const manual = diasInstalacion({ descripcion: "PLACARD", dias_instalacion: 1.5, personas_instalacion: 3 }, vacio, vacio.instalacion);
  assert.equal(manual.manual, true);
  assert.equal(manual.dias, 1.5);
  assert.equal(manual.diasPersona, 4.5);
  assert.match(textoCalculo(manual), /Corregido a mano: 1,5 días con 3 instaladores/);
});

test("gabinetesOt — sin módulos sale de placas × gabinetes por placa (el mismo que usa Armado)", () => {
  const p = normalizarParametros(null);
  const g = gabinetesOt({ descripcion: "COCINA", placas: 10 }, p);
  assert.equal(g.origen, "placas");
  assert.ok(Math.abs(g.gabinetes - 14.7) < 1e-9);
  assert.deepEqual(gabinetesOt({ total_modulos: 3 }, p), { gabinetes: 3, origen: "modulos" });
  assert.deepEqual(gabinetesOt({ placas: 10 }, p, { modulosEtiquetas: 5 }), { gabinetes: 5, origen: "etiquetas" });
});

test("cuerpoCorreccion — de a medio día, instaladores enteros; vacío vuelve a automático", () => {
  assert.deepEqual(cuerpoCorreccion({ dias: "1,5", personas: "3" }).cuerpo, { dias_instalacion: 1.5, personas_instalacion: 3 });
  assert.deepEqual(cuerpoCorreccion({ dias: "", personas: "" }).cuerpo, { dias_instalacion: null, personas_instalacion: null });
  assert.equal(cuerpoCorreccion({ dias: "1,3", personas: "" }).cuerpo, null);
  assert.match(cuerpoCorreccion({ dias: "1,3", personas: "" }).errores.dias, /medio día/);
  assert.match(cuerpoCorreccion({ dias: "", personas: "2,5" }).errores.personas, /Sin decimales/);
  assert.match(cuerpoCorreccion({ dias: "abc", personas: "" }).errores.dias, /solo el número/);
  assert.equal(errorInstalacion("gab_por_dia", 0), "Entre 0,1 y 100");
});

test("textoDias", () => {
  assert.equal(textoDias(0.5), "medio día");
  assert.equal(textoDias(1), "1 día");
  assert.equal(textoDias(2.5), "2,5 días");
  assert.equal(textoDias(null), "—");
});

test("se puede guardar desde la app y está la migración 153", () => {
  assert.deepEqual(stripUnallowedFields({ dias_instalacion: 2, personas_instalacion: 3 }, "proyectos", "PATCH"), { dias_instalacion: 2, personas_instalacion: 3 });
  assert.ok(MIGRACIONES.some((m) => m.n === 153 && m.tablas.proyectos.includes("dias_instalacion")));
  const sql = readFileSync(new URL("../supabase/migrations/153_instalacion_ot.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /add column if not exists dias_instalacion/);
});

test("validarPatch — días de a medio día e instaladores enteros", async () => {
  const { validarPatch } = await import("../app/lib/dataPolicy.js");
  const s = { rol: "gerencial" };
  assert.equal(validarPatch("proyectos", { dias_instalacion: 1.5, personas_instalacion: 2 }, s), null);
  assert.equal(validarPatch("proyectos", { dias_instalacion: null, personas_instalacion: null }, s), null);
  assert.equal(validarPatch("proyectos", { dias_instalacion: 1.3 }, s)?.status, 400);
  assert.equal(validarPatch("proyectos", { dias_instalacion: "2" }, s)?.status, 400);
  assert.equal(validarPatch("proyectos", { personas_instalacion: 0 }, s)?.status, 400);
  assert.equal(validarPatch("proyectos", { prioridad_instalacion: 1.5 }, s)?.status, 400);
});
