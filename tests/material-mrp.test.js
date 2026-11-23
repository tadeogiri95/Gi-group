// Placas, fondos y canto del MRP como respaldo de los tiempos de OT (Tadeo, 23/11; migración 202)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claseMaterialMrp, espesorMm, materialMrpPorOt, cambiosMaterialMrp, materialProduccion } from "../app/lib/materialMrp.js";
import { horasOt, gabinetesOt } from "../app/lib/cargaPlanta.js";
import { materialOt } from "../app/lib/ot.js";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

const PLACAS = "Placas, chapas, mallas y paneles ";
const art = (nombre, familia = PLACAS, division = "MADERA") => ({ nombre, familia, division });

test("placas, fondos y cantos según el pre-análisis del 23/11", () => {
  assert.equal(claseMaterialMrp(art("MELAMINA SOBRE MDF 18MM-Faplac-BLANCO-1 UN")), "placa");
  assert.equal(claseMaterialMrp(art("MELAMINA SOBRE AGLOMERADO 18MM")), "placa");
  assert.equal(claseMaterialMrp(art("ENCHAPADO 19 MM SOBRE MDF")), "placa");
  assert.equal(claseMaterialMrp(art("MDF 25MM")), "placa");
  assert.equal(claseMaterialMrp(art("FIBROPLUS 3MM")), "fondo");
  assert.equal(claseMaterialMrp(art("FONDO MDF 5,5 MM")), "fondo");
  assert.equal(claseMaterialMrp(art("ENCHAPADO 3,7 MM SOBRE MDF")), "fondo");
  // Chapas de hierro y PVC no cuentan
  assert.equal(claseMaterialMrp(art("CHAPA LISA NEGRA LF COMERCIAL 1000X2000X1.25MM (C-18)", PLACAS, "HIERRO")), null);
  assert.equal(claseMaterialMrp(art("TABLA CIELORRASO PVC 250MM x 3MM", PLACAS, "GENERAL")), null);
  // Canto por el nombre, aunque esté en otra familia; el perfil de aluminio no
  assert.equal(claseMaterialMrp(art("CANTO ABS 22/045 LISO SIN COLA", "Herrajes y Accesorios")), "canto");
  assert.equal(claseMaterialMrp(art("CANTO ABS 22/2 LISO SIN COLA")), "canto");
  assert.equal(claseMaterialMrp(art("CANTO CHAPA CON TELA 22 MM SIN COLA", "Herrajes y Accesorios")), "canto");
  assert.equal(claseMaterialMrp(art("PERFIL CANTO DE ALUMINIO U 18 MM", "Perfilería y Estructurales")), null);
  assert.equal(claseMaterialMrp(art("BISAGRA CIERRE SUAVE", "Herrajes y Accesorios")), null);
  // Sin familia: por el nombre
  assert.equal(claseMaterialMrp({ nombre: "MELAMINA SOBRE MDF 15MM" }), "placa");
  assert.equal(claseMaterialMrp({ nombre: "FIBROPLUS 3MM" }), "fondo");
  assert.equal(espesorMm("FONDO MDF 5,5 MM"), 5.5);
});

test("totales por OT y solo los cambios para guardar", () => {
  const articulos = [
    { sku: "1", ...art("MELAMINA SOBRE MDF 18MM") },
    { sku: "2", ...art("FIBROPLUS 3MM") },
    { sku: "3", ...art("CANTO ABS 22/045 LISO SIN COLA", "Herrajes y Accesorios") },
    { sku: "4", ...art("BISAGRA", "Herrajes y Accesorios") },
  ];
  const nec = [
    { ot: "M-7871", sku: "1", cantidad: 9.1 }, { ot: "M-7871", sku: "2", cantidad: 2.2 },
    { ot: "M-7871", sku: "3", cantidad: 103.5 }, { ot: "M-7871", sku: "4", cantidad: 40 },
    { ot: "M-7872", sku: "1", cantidad: 0 },
  ];
  const t = materialMrpPorOt(nec, articulos);
  assert.deepEqual(t.get("M-7871"), { placas: 9.1, fondos: 2.2, metros: 103.5 });
  assert.equal(t.has("M-7872"), false);
  const cambios = cambiosMaterialMrp([
    { ot: "M-7871", placas_mrp: null },
    { ot: "M-7000", placas_mrp: 3, fondos_mrp: 0, metros_canto_mrp: 10 },
    { ot: "M-7001", placas_mrp: null, fondos_mrp: null, metros_canto_mrp: null },
  ], t);
  assert.deepEqual(cambios, [
    { ot: "M-7871", placas_mrp: 9.1, fondos_mrp: 2.2, metros_canto_mrp: 103.5 },
    { ot: "M-7000", placas_mrp: null, fondos_mrp: null, metros_canto_mrp: null },
  ]);
});

test("el Plan manda y el MRP completa lo que falta", () => {
  const mrp = { placas_mrp: 9, fondos_mrp: 2, metros_canto_mrp: 100 };
  // Todo en el Plan: el MRP no se usa
  let m = materialProduccion({ placas: 5, fondos: 1, metros_canto: 50, ...mrp });
  assert.deepEqual([m.placas, m.fondos, m.metros, m.algunoDelMrp], [5, 1, 50, false]);
  // Nada en el Plan: todo del MRP
  m = materialProduccion({ ...mrp });
  assert.deepEqual([m.placas, m.fondos, m.metros], [9, 2, 100]);
  assert.deepEqual(m.delMrp, { placas: true, fondos: true, metros: true });
  // Placas en el Plan, canto vacío: el canto del MRP; fondos N/A = 0
  m = materialProduccion({ placas: 5, ...mrp });
  assert.deepEqual([m.placas, m.fondos, m.metros], [5, 0, 100]);
  assert.deepEqual(m.delMrp, { placas: false, fondos: false, metros: true });
  // Un 0 cargado en el Plan manda
  m = materialProduccion({ placas: 5, metros_canto: 0, ...mrp });
  assert.equal(m.metros, 0);
  // Sin nada en ningún lado
  m = materialProduccion({});
  assert.deepEqual([m.placas, m.fondos, m.metros, m.algunoDelMrp], [null, null, null, false]);
});

test("horasOt usa el MRP cuando el Plan no trae el material", () => {
  const params = { min_placa: 10, min_metro_canto: 1, min_mecanizado: 0, min_armado_gabinete: 0, etapas: {} };
  const sinPlan = horasOt({ ot: "M-7871", descripcion: "VESTIDOR", placas_mrp: 9, fondos_mrp: 3, metros_canto_mrp: 120 }, params);
  assert.equal(sinPlan.sinDatos, false);
  assert.equal(sinPlan.algunoDelMrp, true);
  assert.equal(sinPlan.placas, 12);
  assert.equal(sinPlan.etapas.corte.gente, 2); // 12 placas × 10 min
  assert.equal(sinPlan.etapas.canteado.gente, 2); // 120 m × 1 min
  const conPlan = horasOt({ ot: "M-7871", descripcion: "VESTIDOR", placas: 6, metros_canto: 60, placas_mrp: 9, fondos_mrp: 3, metros_canto_mrp: 120 }, params);
  assert.equal(conPlan.placas, 6);
  assert.equal(conPlan.algunoDelMrp, false);
  assert.equal(horasOt({ ot: "1" }, params).sinDatos, true);
  assert.equal(gabinetesOt({ placas_mrp: 4, fondos_mrp: 1 }, { relaciones_tipo: {} }).origen, "placas");
});

test("el detalle de la OT marca lo que sale del MRP", () => {
  const filas = materialOt({ placas: 5, placas_mrp: 9, metros_canto_mrp: 103.5 });
  assert.deepEqual(filas.map((f) => f.label), ["Placas 18", "Cantos"]);
  assert.equal(filas[0].valor, "5");
  assert.match(filas[1].valor, /103,5 m 📦 del MRP/);
  assert.match(readFileSync(new URL("../app/components/DetalleOp.jsx", import.meta.url), "utf8"), /salen de las necesidades del MRP/);
});

test("la sincronización del MRP guarda el material y la migración 202 está en el chequeo", () => {
  assert.match(readFileSync(new URL("../app/lib/syncStock.js", import.meta.url), "utf8"), /recalcularMaterialMrp/);
  const sql = readFileSync(new URL("../supabase/migrations/202_ot_material_mrp.sql", import.meta.url), "utf8");
  assert.match(sql, /placas_mrp/);
  assert.ok(MIGRACIONES.some((m) => m.n === 202));
});
