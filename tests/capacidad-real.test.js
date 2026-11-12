// tests/capacidad-real.test.js — La capacidad de la planta con lo que de
// verdad hay (auditoría del 12/11, parte 7): vacaciones y ausencias aprobadas,
// feriados y máquinas paradas bajan la capacidad solas, con su aviso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ausenciasDe, avisosCapacidad, maquinasParadas } from "../app/lib/capacidadReal.js";
import { capacidadPlanta, cargaPeriodo } from "../app/lib/cargaPlanta.js";

const T = { in: "08:00", out: "16:00" };
const OPS = [
  { id: "a", legajo: 10, nombre: "Ana", diagrama: { lun: T, mar: T, mie: T } },
  { id: "b", legajo: 11, nombre: "Beto", diagrama: { lun: T, mar: T, mie: T } },
];
const DIAS = ["2026-11-16", "2026-11-17", "2026-11-18"]; // lunes a miércoles

test("ausencias — solo aprobadas de vacaciones, ausencia o justificación; por empleado o por legajo", () => {
  const a = ausenciasDe([
    { empleado_id: "a", tipo: "vacaciones", estado: "aprobado", fecha: "2026-11-17", fecha_hasta: "2026-11-18" },
    { legajo: 11, tipo: "ausencia", estado: "aprobado", fecha: "2026-11-16" },
    { legajo: 11, tipo: "vacaciones", estado: "pendiente", fecha: "2026-11-18" },
    { legajo: 11, tipo: "permiso", estado: "aprobado", fecha: "2026-11-17" },
    { legajo: 99, tipo: "vacaciones", estado: "aprobado", fecha: "2026-11-17" },
  ], OPS);
  assert.deepEqual([...a.get("a")], ["2026-11-17", "2026-11-18"]);
  assert.deepEqual([...a.get("b")], ["2026-11-16"]);
  assert.equal(a.size, 2);
});

test("capacidad — sin los días de vacaciones ni los feriados", () => {
  assert.equal(capacidadPlanta(OPS, DIAS).gente, 48);
  const ausencias = new Map([["a", new Set(["2026-11-17"])]]);
  const c = capacidadPlanta(OPS, DIAS, { ausencias, feriados: new Set(["2026-11-18"]) });
  assert.equal(c.gente, 24, "lunes 16 h + martes 8 h + miércoles feriado");
  assert.deepEqual(c.porDia.map((d) => d.gente), [16, 8, 0]);
  assert.equal(c.porDia[2].maquina, 0);
});

test("máquinas paradas — por proceso y división; restan de la carga sin bajar de 0", () => {
  const p = maquinasParadas([
    { id: 1, codigo: "CNC-01", tipo: "cnc", estado: "parada" },
    { id: 2, codigo: "SEC-01", tipo: "seccionadora", estado: "fuera_de_servicio", division: "HIERRO" },
    { id: 3, codigo: "PEG-01", tipo: "pegadora", estado: "en_servicio" },
    { id: 4, codigo: "COMP", tipo: "compresor", estado: "parada" },
  ], { id: "MUEBLES", nombre: "Muebles" });
  assert.deepEqual([p.corte, p.canteado, p.mecanizado], [0, 0, 1]);
  const etapa = (m) => ({ gente: m, maquina: m });
  const ot = { etapas: { corte: etapa(0), canteado: etapa(0), mecanizado: etapa(10), armado: etapa(0) } };
  const r = cargaPeriodo({ ots: [ot], params: { eficiencia: 100, maquinas_cnc: 2 }, capacidad: { gente: 100, maquina: 8, paradas: p } });
  const cnc = r.maquinas.find((m) => m.id === "mecanizado");
  assert.deepEqual([cnc.cantidad, cnc.paradas, cnc.disponibles, cnc.extra], [1, 1, 8, 2]);
  const todas = cargaPeriodo({ ots: [ot], params: { eficiencia: 100, maquinas_cnc: 1 }, capacidad: { gente: 100, maquina: 8, paradas: { mecanizado: 3 } } });
  assert.equal(todas.maquinas.find((m) => m.id === "mecanizado").disponibles, 0);
  assert.equal(todas.viable, false);
});

test("avisos — quién no está, feriados y máquinas paradas", () => {
  const avisos = avisosCapacidad({
    operarios: OPS, dias: DIAS, feriados: new Set(["2026-11-18"]),
    ausencias: new Map([["a", new Set(["2026-11-17", "2026-11-18", "2026-12-01"])]]),
    paradas: { mecanizado: 1, lista: [{ codigo: "CNC-01", estado: "parada", proceso: "mecanizado" }] },
    cantidades: { mecanizado: 2 },
  });
  assert.deepEqual(avisos, [
    "Ana no está del 17/11 al 18/11 (2 días)",
    "Feriado: 18/11",
    "CNC-01 parada: Mecanizado queda con 1 máquina hasta que vuelva a servicio",
  ]);
});
