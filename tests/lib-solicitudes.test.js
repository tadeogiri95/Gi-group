// tests/lib-solicitudes.test.js — Qué se guarda al aprobar o rechazar (F1-06, ítem 38)
import { test } from "node:test";
import assert from "node:assert/strict";
import { horasExtraAprobables } from "../app/lib/calc.js";
import { buscarHoraExtraAprobable, planResolucion, horaDelPermiso } from "../app/lib/solicitudes.js";

// 2026-10-05 es lunes
const GRILLA = { lun: { in: "08:00", out: "17:00" } };
const NOCHE = { lun: { in: "22:00", out: "06:00" } };

test("horasExtraAprobables — llegó tarde pero trabajó más que la jornada: suma el excedente", () => {
  // jornada de 9 h; trabajó 08:30 → 18:00 = 9,5 h
  assert.equal(horasExtraAprobables({ fecha: "2026-10-05", ingreso: "08:30:00", egreso: "18:00:00", diagrama: GRILLA }), 0.5);
});

test("horasExtraAprobables — llegó tarde y no completó la jornada: 0", () => {
  assert.equal(horasExtraAprobables({ fecha: "2026-10-05", ingreso: "09:00", egreso: "17:00", diagrama: GRILLA }), 0);
});

test("horasExtraAprobables — turno noche que cruza la medianoche", () => {
  // jornada de 8 h; trabajó 22:30 → 07:00 = 8,5 h
  assert.equal(horasExtraAprobables({ fecha: "2026-10-05", ingreso: "22:30", egreso: "07:00", diagrama: NOCHE }), 0.5);
});

test("horasExtraAprobables — sin grilla o sin horas: 0", () => {
  assert.equal(horasExtraAprobables({ fecha: "2026-10-05", ingreso: "08:00", egreso: "18:00", diagrama: null }), 0);
  assert.equal(horasExtraAprobables({ fecha: "2026-10-05", ingreso: null, egreso: "18:00", diagrama: GRILLA }), 0);
});

function lectorFalso({ fichada, diagrama }) {
  const pedidos = [];
  const get = async (path) => {
    pedidos.push(path);
    if (path.startsWith("fichadas?")) return fichada ? [fichada] : [];
    if (path.startsWith("empleados?")) return [{ diagrama }];
    return [];
  };
  return { get, pedidos };
}

const SOL = { id: 3, tipo: "hora_extra", empleado_id: "emp-1", legajo: 7, fecha: "2026-10-05", motivo: "Hora extra" };

test("buscarHoraExtraAprobable — devuelve la fichada de esa jornada y las horas, sin escribir", async () => {
  const { get, pedidos } = lectorFalso({ fichada: { id: "f-50", fecha: "2026-10-05", ingreso: "08:30:00", egreso: "18:00:00" }, diagrama: GRILLA });
  assert.deepEqual(await buscarHoraExtraAprobable(get, SOL), { fichada_id: "f-50", horas: 0.5 });
  assert.ok(pedidos[0].includes("fecha=lte.2026-10-05") && pedidos[0].includes("egreso=not.is.null"));
});

test("buscarHoraExtraAprobable — sin fichada cerrada o sin excedente: null", async () => {
  assert.equal(await buscarHoraExtraAprobable(lectorFalso({ fichada: null, diagrama: GRILLA }).get, SOL), null);
  const sinExtra = lectorFalso({ fichada: { id: "f", fecha: "2026-10-05", ingreso: "09:00", egreso: "17:00" }, diagrama: GRILLA });
  assert.equal(await buscarHoraExtraAprobable(sinExtra.get, SOL), null);
});

test("buscarHoraExtraAprobable — fecha inválida no consulta la base", async () => {
  const { get, pedidos } = lectorFalso({ fichada: null, diagrama: GRILLA });
  assert.equal(await buscarHoraExtraAprobable(get, { ...SOL, fecha: "hoy&x=1" }), null);
  assert.equal(pedidos.length, 0);
});

const BASE = { aprobador: "Laura", hoy: "2026-10-09", horaCreacion: "07:55" };

test("planResolucion — permiso de ingreso aprobado: fichada con la hora del motivo y aviso", () => {
  const sol = { id: 1, tipo: "permiso", empleado_id: "emp-1", legajo: 7, motivo: "🔓 Permiso de ingreso (8:40 llegué tarde)" };
  const p = planResolucion({ ...BASE, sol, estado: "aprobado" });
  assert.deepEqual(p.fichada, { empleado_id: "emp-1", legajo: 7, fecha: "2026-10-09", ingreso: "08:40" });
  assert.equal(p.horasExtra, null);
  assert.equal(p.notificacion.destinatario_rol, "7");
  assert.equal(p.notificacion.asunto, "✅ Ingreso APROBADO — Ya quedaste fichado");
  assert.match(p.push.cuerpo, /a las 08:40/);
});

test("planResolucion — permiso de ingreso rechazado: sin fichada, aviso genérico", () => {
  const sol = { id: 1, tipo: "permiso", empleado_id: "emp-1", legajo: 7, motivo: "🔓 Permiso de ingreso" };
  const p = planResolucion({ ...BASE, sol, estado: "rechazado", nota: "No" });
  assert.equal(p.fichada, null);
  assert.match(p.notificacion.asunto, /RECHAZADA/);
  assert.match(p.notificacion.detalle, /Comentario: "No"$/);
});

test("planResolucion — hora extra aprobada: carga las horas y lo dice", () => {
  const p = planResolucion({ ...BASE, sol: SOL, estado: "aprobado", horaExtra: { fichada_id: "f-50", horas: 0.5 } });
  assert.deepEqual(p.horasExtra, { fichada_id: "f-50", horas: 0.5 });
  assert.equal(p.notificacion.detalle, "Laura aprobó 0.5h extra; ya figuran en tu fichada.");
});

test("planResolucion — salida anticipada: aviso propio, aprobada o rechazada", () => {
  const sol = { id: 4, tipo: "salida_anticipada", legajo: 7, motivo: "Médico" };
  assert.match(planResolucion({ ...BASE, sol, estado: "aprobado" }).notificacion.asunto, /Salida APROBADA/);
  assert.match(planResolucion({ ...BASE, sol, estado: "rechazado" }).notificacion.asunto, /Salida anticipada RECHAZADA/);
});

test("planResolucion — cambio de horario aprobado: solo avisa", () => {
  const p = planResolucion({ ...BASE, sol: { id: 5, tipo: "cambio_horario", legajo: 7, motivo: "Turno tarde" }, estado: "aprobado" });
  assert.equal(p.notificacion.asunto, "✅ Cambio de horario APROBADO");
  assert.equal(p.fichada, null);
});

test("horaDelPermiso — motivo, después desde, después la hora en que se pidió", () => {
  assert.equal(horaDelPermiso({ motivo: "(9:05" }, "07:00"), "09:05");
  assert.equal(horaDelPermiso({ motivo: "x", desde: "8:15" }, "07:00"), "08:15");
  assert.equal(horaDelPermiso({ motivo: "x", desde: "—" }, "07:00"), "07:00");
});
