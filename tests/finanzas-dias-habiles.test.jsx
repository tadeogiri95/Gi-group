// tests/finanzas-dias-habiles.test.jsx — cuándo se debita o acredita un
// cheque (Tadeo, 11/11): se deposita el día que vence si es hábil (si no, el
// hábil siguiente) y el banco lo mueve el hábil siguiente al depósito.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FERIADOS_BANCARIOS, fechaDebito, fechaDeposito, feriadosFinanzas } from "../app/lib/finanzasDiasHabiles.js";
import { flujoPrevisto } from "../app/lib/finanzasFlujo.js";
import { calendarioCheques } from "../app/lib/finanzasCheques.js";
import { textoForma } from "../app/lib/finanzasPagos.js";

const F = feriadosFinanzas({ feriados: [{ fecha: "2026-11-27", nombre: "Feriado de la planta" }] });

test("Días hábiles — vence un día hábil: se deposita ese día y se debita el siguiente", () => {
  assert.equal(fechaDeposito("2026-11-10", F), "2026-11-10");
  assert.equal(fechaDebito("2026-11-10", F), "2026-11-11");
  assert.equal(fechaDebito("2026-11-13", F), "2026-11-16", "viernes → lunes");
});

test("Días hábiles — vence un día no hábil: se deposita el hábil siguiente y se debita el otro", () => {
  assert.equal(fechaDeposito("2026-11-14", F), "2026-11-16", "sábado → lunes");
  assert.equal(fechaDebito("2026-11-14", F), "2026-11-17");
  assert.equal(fechaDeposito("2026-11-06", F), "2026-11-09", "Día del Bancario");
  assert.equal(fechaDebito("2026-11-20", F), "2026-11-24", "lunes 23 es feriado (Soberanía)");
  assert.equal(fechaDebito("2026-11-26", F), "2026-11-30", "el feriado que cargó la empresa también cuenta");
  assert.equal(fechaDebito("", F), null);
  assert.ok(FERIADOS_BANCARIOS.every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.fecha)));
});

test("Flujo previsto — los cheques caen en la semana en que el banco mueve la plata", () => {
  const r = flujoPrevisto({
    hoy: "2026-11-11", saldoHoy: 1000, feriados: F,
    cheques: [
      { clase: "propio", estado: "pendiente", fecha_pago: "2026-11-14", importe: 100, beneficiario: "EGGER" },
      { clase: "tercero", estado: "en_cartera", fecha_pago: "2026-11-13", importe: 50, banco: "Galicia" },
    ],
  });
  const propios = r.filas.find((f) => f.id === "cheques_propios");
  const terceros = r.filas.find((f) => f.id === "cheques_terceros");
  assert.equal(propios.valores[0], 0, "vence el sábado 14 pero se debita el martes 17");
  assert.equal(propios.valores[1], -100);
  assert.equal(propios.detalle[1][0].fecha, "2026-11-17");
  assert.match(propios.detalle[1][0].texto, /vence 14\/11/);
  assert.equal(terceros.valores[1], 50, "vence el viernes 13, se acredita el lunes 16");
});

test("Calendario de cheques y orden de pago — usan el día de débito y dicen \"vence el\"", () => {
  const cal = calendarioCheques([{ clase: "propio", estado: "pendiente", fecha_pago: "2026-11-10", importe: 10 }], "2026-11-10", 8, F);
  assert.equal(cal.find((t) => t.etiqueta === "Hoy").debitar, 0);
  assert.equal(cal.find((t) => t.etiqueta === "1 a 7 días").debitar, 10);
  assert.match(textoForma({ forma: "echeq", fecha_pago: "2026-12-15" }), /vence el 15\/12\/26/);
});
