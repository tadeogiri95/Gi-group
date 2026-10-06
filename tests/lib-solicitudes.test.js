// tests/lib-solicitudes.test.js — Aprobar hora extra la carga en la fichada (F1-06)
import { test } from "node:test";
import assert from "node:assert/strict";
import { horasExtraAprobables } from "../app/lib/calc.js";
import { cargarHoraExtraAprobada } from "../app/lib/solicitudes.js";

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

function sbFalso({ fichada, diagrama }) {
  const llamadas = { get: [], patch: [] };
  return {
    llamadas,
    get: async (path) => {
      llamadas.get.push(path);
      if (path.startsWith("fichadas?")) return fichada ? [fichada] : [];
      if (path.startsWith("empleados?")) return [{ diagrama }];
      return [];
    },
    patch: async (path, body) => { llamadas.patch.push({ path, body }); return [{}]; },
  };
}

const SOL = { id: 3, tipo: "hora_extra", empleado_id: "emp-1", legajo: 7, fecha: "2026-10-05" };

test("cargarHoraExtraAprobada — escribe las horas extra en la fichada de esa jornada", async () => {
  const sb = sbFalso({ fichada: { id: 50, fecha: "2026-10-05", ingreso: "08:30:00", egreso: "18:00:00" }, diagrama: GRILLA });
  const horas = await cargarHoraExtraAprobada(sb, SOL);
  assert.equal(horas, 0.5);
  assert.deepEqual(sb.llamadas.patch, [{ path: "fichadas?id=eq.50", body: { horas_extra: 0.5 } }]);
  assert.ok(sb.llamadas.get[0].includes("fecha=lte.2026-10-05") && sb.llamadas.get[0].includes("egreso=not.is.null"));
});

test("cargarHoraExtraAprobada — sin fichada cerrada no escribe nada", async () => {
  const sb = sbFalso({ fichada: null, diagrama: GRILLA });
  assert.equal(await cargarHoraExtraAprobada(sb, SOL), 0);
  assert.equal(sb.llamadas.patch.length, 0);
});

test("cargarHoraExtraAprobada — fecha inválida no consulta la base", async () => {
  const sb = sbFalso({ fichada: null, diagrama: GRILLA });
  assert.equal(await cargarHoraExtraAprobada(sb, { ...SOL, fecha: "hoy&x=1" }), 0);
  assert.equal(sb.llamadas.get.length, 0);
});
