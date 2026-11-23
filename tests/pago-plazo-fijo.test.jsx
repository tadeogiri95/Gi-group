// tests/pago-plazo-fijo.test.jsx — 20/11 (Tadeo): cada e-cheq de la orden de
// pago puede llevar el plazo fijo NUEVO que lo calza, y la orden y el resumen
// para el CFO muestran "A rescatar del FCI" = transferencias + plazos fijos a
// constituir. Solo informativo: no carga el plazo fijo. Sin migración.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  validarOrden, plazoDeForma, sumasPagos, textoPlazo, datosParaCfo, textoWhatsappCfo, htmlOrdenPago, generarPago,
} from "../app/lib/finanzasPagos.js";
import { totalesResumen, renglonesResumen, datosResumenParaCfo, textoWhatsappResumen, htmlResumenPago } from "../app/lib/finanzasResumenPago.js";

afterEach(() => cleanup());

const { default: RescateFci } = await import("../app/components/RescateFci.jsx");
const { NuevaOrden } = await import("../app/components/FinanzasPagos.jsx");

const TESORERIA = [
  { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", tipo: "banco", moneda: "ARS", activa: true },
];
const CTX = { tesoreria: TESORERIA, proveedores: [{ id: 5, nombre: "EGGER ARGENTINA" }], cheques: [] };
const ECHEQ_PF = { forma: "echeq", importe: 400000, fecha_pago: "2026-12-15", plazo_fijo: { importe: 390000, vencimiento: "2026-12-14" } };
const O1 = {
  id: 1, numero: 7, proveedor_id: 5, proveedor_nombre: "EGGER ARGENTINA", fecha: "2026-11-20", estado: "borrador", total: 700000,
  formas: [{ forma: "transferencia", importe: 200000, cuenta_nombre: "Banco Credicoop" }, { forma: "efectivo", importe: 100000, cuenta_nombre: "Caja" }, ECHEQ_PF],
};
const O2 = {
  id: 2, numero: 8, proveedor_nombre: "Herrajes Sur", fecha: "2026-11-19", estado: "pagada", total: 350000,
  formas: [{ forma: "transferencia", importe: 50000 }, { forma: "echeq", importe: 300000, fecha_pago: "2027-01-10", plazo_fijo: { importe: 290000, vencimiento: "2027-01-08" } }],
};
const O3 = { id: 3, numero: 9, proveedor_nombre: "Otro", fecha: "2026-11-19", estado: "anulada", total: 1, formas: [{ forma: "transferencia", importe: 1 }, { ...ECHEQ_PF }] };

test("validar — el e-cheq guarda el plazo fijo que lo calza; sin monto va sin plazo fijo", () => {
  const { orden, errores } = validarOrden({ proveedor_id: 5, fecha: "2026-11-20", formas: [ECHEQ_PF] }, CTX);
  assert.deepEqual(errores, []);
  assert.deepEqual(orden.formas[0].plazo_fijo, { importe: 390000, vencimiento: "2026-12-14" });
  assert.equal(orden.total, 400000, "el plazo fijo no suma al total de la orden");
  const sin = validarOrden({ proveedor_id: 5, fecha: "2026-11-20", formas: [{ ...ECHEQ_PF, plazo_fijo: { importe: "", vencimiento: "" } }] }, CTX);
  assert.equal(sin.orden.formas[0].plazo_fijo, undefined);
  assert.equal(plazoDeForma(null), null);
});

test("validar — el plazo fijo no puede vencer después del cheque, y pide monto y fecha", () => {
  const tarde = validarOrden({ proveedor_id: 5, fecha: "2026-11-20", formas: [{ ...ECHEQ_PF, plazo_fijo: { importe: 1, vencimiento: "2026-12-16" } }] }, CTX);
  assert.match(tarde.errores[0], /antes o el mismo día que el e-cheq/);
  assert.match(validarOrden({ proveedor_id: 5, fecha: "2026-11-20", formas: [{ ...ECHEQ_PF, plazo_fijo: { importe: "0", vencimiento: "2026-12-10" } }] }, CTX).errores[0], /monto del plazo fijo/);
  assert.match(validarOrden({ proveedor_id: 5, fecha: "2026-11-20", formas: [{ ...ECHEQ_PF, plazo_fijo: { importe: 5, vencimiento: "" } }] }, CTX).errores[0], /cuándo vence/);
  // El mismo día que el cheque está bien
  assert.deepEqual(validarOrden({ proveedor_id: 5, fecha: "2026-11-20", formas: [{ ...ECHEQ_PF, plazo_fijo: { importe: 5, vencimiento: "2026-12-15" } }] }, CTX).errores, []);
});

test("sumas — a rescatar del FCI = transferencias + plazos fijos; efectivo y cheques aparte; las anuladas no suman", () => {
  const t = sumasPagos([O1, O2, O3]);
  assert.deepEqual([t.transferencia, t.plazos, t.cantidadPlazos, t.rescatar, t.efectivo, t.cheques], [250000, 680000, 2, 930000, 100000, 700000]);
  const r = totalesResumen([O1, O2, O3]);
  assert.deepEqual([r.plazos, r.cantidadPlazos, r.rescatar, r.total], [680000, 2, 930000, 1050000]);
});

test("pagar la orden no carga el plazo fijo (es solo informativo)", () => {
  const cuentas = [{ codigo: "02.01.02.001.001", nombre: "Proveedores", activa: true }, { codigo: "02.01.01.001.005", nombre: "E-cheq diferidos a pagar- Bco Credicoop", activa: true }];
  const g = generarPago({ ...O1, formas: [ECHEQ_PF] }, { cuentas, tesoreria: TESORERIA }, "2026-11-20");
  assert.equal(g.emitir.length, 1);
  assert.equal(g.emitir[0].importe, 400000);
  assert.equal(g.operaciones.length, 0);
});

test("CFO, una orden — el plazo fijo debajo del e-cheq, en WhatsApp y PDF con 'A rescatar del FCI'", () => {
  assert.match(textoPlazo(ECHEQ_PF), /Plazo fijo a constituir · vence el 14\/12\/26/);
  const d = datosParaCfo(O1, {});
  assert.equal(d.formas[2].plazo.importe, 390000);
  assert.equal(d.rescate.rescatar, 590000);
  const w = textoWhatsappCfo(O1, "https://x/op/t");
  assert.match(w, /Plazo fijo a constituir · vence el 14\/12\/26: \$ 390\.000,00/);
  assert.match(w, /A rescatar del FCI: \$ 590\.000,00/);
  assert.match(w, /transferencias \$ 200\.000,00 \+ plazos fijos a constituir \$ 390\.000,00/);
  const h = htmlOrdenPago({ orden: O1 });
  assert.match(h, /class="pf"/);
  assert.match(h, /A rescatar del FCI/);
  // Sin plazo fijo, la orden queda como antes
  const sin = { ...O1, formas: O1.formas.slice(0, 2) };
  assert.doesNotMatch(textoWhatsappCfo(sin, "https://x"), /FCI/);
  assert.doesNotMatch(htmlOrdenPago({ orden: sin }), /A rescatar del FCI/);
});

test("CFO, resumen — renglón del plazo fijo, totales y 'A rescatar del FCI' en página, WhatsApp y PDF", () => {
  const r = renglonesResumen([O1, O2]);
  assert.equal(r.filter((x) => x.plazo).length, 2);
  const d = datosResumenParaCfo({ numero: 3, fecha: "2026-11-20" }, [O1, O2], {});
  assert.equal(d.totales.rescatar, 930000);
  assert.equal(d.ordenes.find((o) => o.numero === 7).formas[2].plazo.importe, 390000);
  assert.match(textoWhatsappResumen({ numero: 3 }, [O1, O2], "https://x"), /A rescatar del FCI: \$ 930\.000,00/);
  const h = htmlResumenPago({ resumen: { numero: 3, fecha: "2026-11-20", estado: "armado" }, ordenes: [O1, O2] });
  assert.match(h, /Plazos fijos a constituir \(2\)/);
  assert.match(h, /A rescatar del FCI<\/td><td class="n">\$ 930\.000,00/);
});

test("RescateFci — muestra transferencias, plazos fijos y lo que hay que rescatar; sin nada no aparece", () => {
  const { container } = render(<RescateFci transferencia={250000} plazos={680000} cantidadPlazos={2} rescatar={930000} />);
  const s = screen.getByRole("region", { name: "A rescatar del FCI" });
  assert.match(s.textContent, /Transferencias\$ 250\.000,00/);
  assert.match(s.textContent, /Plazos fijos a constituir \(2\)\$ 680\.000,00/);
  assert.match(s.textContent, /A rescatar del FCI\$ 930\.000,00/);
  cleanup();
  const vacio = render(<RescateFci rescatar={0} />);
  assert.equal(vacio.container.textContent, "");
  assert.ok(container);
});

test("nueva orden — tildar el plazo fijo propone el importe y la fecha del e-cheq y muestra lo que hay que rescatar", () => {
  render(<NuevaOrden datos={{ tesoreria: TESORERIA, proveedores: CTX.proveedores, cheques: [] }} proveedorId={5} onCerrar={() => {}} onGuardada={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "+ E-cheq Credicoop" }));
  fireEvent.change(screen.getByLabelText("Importe en E-cheq Credicoop"), { target: { value: "400000" } });
  fireEvent.change(screen.getByLabelText("Fecha de pago del e-cheq"), { target: { value: "2026-12-15" } });
  fireEvent.click(screen.getByLabelText("Agregar el plazo fijo que calza este e-cheq"));
  assert.equal(screen.getByLabelText("Monto del plazo fijo").value, "400000");
  assert.equal(screen.getByLabelText("Vencimiento del plazo fijo").value, "2026-12-15");
  assert.match(screen.getByRole("region", { name: "A rescatar del FCI" }).textContent, /A rescatar del FCI\$ 400\.000,00/);
});
