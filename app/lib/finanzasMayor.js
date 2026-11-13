// app/lib/finanzasMayor.js — Finanzas → 📚 Mayor de cuentas (13/11, pedido de
// Tadeo: "ver los movimientos de cada cuenta contable y poder hacer asientos
// de registro y de ajuste").
//
// Sale de fin_operaciones (partida doble), sin migración. Reglas:
//   - Cada operación se abre en sus renglones con asientoDe (el IVA va a su
//     cuenta), así el mayor del IVA crédito también tiene sus movimientos.
//   - Todo en pesos: lo que está en dólares se pasa con el total en pesos de
//     esa operación (su tipo de cambio).
//   - Saldo = debe − haber. Una cuenta que tiene cuentas debajo (por ejemplo
//     "Caja" con la caja de cada uno) suma las de abajo.
//   - "Al revés": un activo (01) con saldo negativo, o un pasivo o el
//     patrimonio (02, 03) con saldo deudor. Casi siempre falta el saldo
//     inicial (lo que había antes de empezar a cargar en Gypi).
//   - Las anuladas no suman.
import { asientoDe } from "./finanzasOperaciones";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const orden = (a, b) => (a.fecha === b.fecha ? Number(a.id) - Number(b.id) : a.fecha < b.fecha ? -1 : 1);

/** ¿La cuenta c es cod o está debajo de cod? */
export const dentroDe = (c, cod) => !!c && !!cod && (c === cod || String(c).startsWith(`${cod}.`));

/** Pesos por cada unidad de la moneda de la operación. */
export function factorPesos(op) {
  if (op?.moneda !== "USD") return 1;
  const total = Number(op.total) || 0;
  const ars = Number(op.total_ars) || 0;
  if (total > 0 && ars > 0) return ars / total;
  return Number(op.tipo_cambio) || 1;
}

/** Los renglones de una operación, en pesos: [{ cuenta, debe, haber }]. */
export function renglonesEnPesos(op, ctx = {}) {
  const f = factorPesos(op);
  return asientoDe(op, ctx).renglones.map((r) => ({
    cuenta: r.cuenta,
    debe: r.lado === "debe" ? centavos(r.importe * f) : 0,
    haber: r.lado === "haber" ? centavos(r.importe * f) : 0,
  }));
}

/** ¿El saldo está del lado que no corresponde a la cuenta? Devuelve el aviso o null. */
export function saldoAlReves(codigo, saldo) {
  const s = centavos(saldo);
  const raiz = String(codigo || "").slice(0, 2);
  if (raiz === "01" && s < 0) return "Un activo no puede quedar en negativo: casi siempre falta el saldo inicial (lo que había antes de empezar a cargar) o hay un movimiento cargado al revés.";
  if ((raiz === "02" || raiz === "03") && s > 0) return "Esta cuenta normalmente tiene saldo acreedor (a favor de otro): casi siempre falta el saldo inicial o hay un movimiento cargado al revés.";
  return null;
}

/**
 * Sumas y saldos de todas las cuentas del plan (hasta una fecha, si se da).
 * @returns {{ codigo, nombre, debe, haber, saldo, movimientos, ultimo, hijas: boolean, al_reves: string|null }[]}
 */
export function sumasYSaldos(ops = [], { cuentas = [], tipos = [], hasta = "" } = {}) {
  const por = new Map();
  for (const op of ops) {
    if (op.anulada_at || (hasta && op.fecha > hasta)) continue;
    for (const r of renglonesEnPesos(op, { cuentas, tipos })) {
      const s = por.get(r.cuenta) || { debe: 0, haber: 0, movimientos: 0, ultimo: "" };
      s.debe += r.debe;
      s.haber += r.haber;
      s.movimientos++;
      if (op.fecha > s.ultimo) s.ultimo = op.fecha;
      por.set(r.cuenta, s);
    }
  }
  const codigos = [...new Set([...cuentas.map((c) => c.codigo), ...por.keys()])].filter(Boolean).sort();
  return codigos.map((codigo) => {
    const t = { debe: 0, haber: 0, movimientos: 0, ultimo: "" };
    for (const [c, s] of por) {
      if (!dentroDe(c, codigo)) continue;
      t.debe += s.debe;
      t.haber += s.haber;
      t.movimientos += s.movimientos;
      if (s.ultimo > t.ultimo) t.ultimo = s.ultimo;
    }
    const cuenta = cuentas.find((c) => c.codigo === codigo);
    const saldo = centavos(t.debe - t.haber);
    return {
      codigo,
      nombre: cuenta?.nombre || "(no está en el plan)",
      activa: cuenta ? cuenta.activa !== false : false,
      debe: centavos(t.debe),
      haber: centavos(t.haber),
      saldo,
      movimientos: t.movimientos,
      ultimo: t.ultimo,
      hijas: codigos.some((c) => c !== codigo && dentroDe(c, codigo)),
      al_reves: saldoAlReves(codigo, saldo),
    };
  });
}

/**
 * El mayor de una cuenta (con las de abajo) entre dos fechas: el saldo de
 * apertura (todo lo anterior a desde) y cada movimiento con su saldo.
 * @returns {{ apertura: number, renglones: { op: object, debe: number, haber: number, saldo: number, contra: string[] }[], debe: number, haber: number, saldo: number, primera: string }}
 */
export function movimientosDeCuenta(ops = [], codigo, { desde = "", hasta = "", cuentas = [], tipos = [] } = {}) {
  let apertura = 0;
  let saldo = 0;
  let debe = 0;
  let haber = 0;
  let primera = "";
  const renglones = [];
  for (const op of [...ops].filter((o) => !o.anulada_at).sort(orden)) {
    if (hasta && op.fecha > hasta) continue;
    const todos = renglonesEnPesos(op, { cuentas, tipos });
    const mios = todos.filter((r) => dentroDe(r.cuenta, codigo));
    if (!mios.length) continue;
    if (!primera) primera = op.fecha;
    const d = centavos(mios.reduce((s, r) => s + r.debe, 0));
    const h = centavos(mios.reduce((s, r) => s + r.haber, 0));
    if (desde && op.fecha < desde) {
      apertura = centavos(apertura + d - h);
      continue;
    }
    if (!renglones.length) saldo = apertura;
    saldo = centavos(saldo + d - h);
    debe += d;
    haber += h;
    // Contra qué cuentas fue (las del otro lado del asiento)
    const contra = [...new Set(todos.filter((r) => !dentroDe(r.cuenta, codigo)).map((r) => r.cuenta))];
    renglones.push({ op, debe: d, haber: h, saldo, contra });
  }
  return { apertura, renglones, debe: centavos(debe), haber: centavos(haber), saldo: renglones.length ? saldo : apertura, primera };
}

/** El día anterior a una fecha YYYY-MM-DD (para que el saldo inicial quede antes del primer movimiento). */
export function diaAnterior(fecha) {
  const t = Date.parse(`${fecha}T12:00:00Z`);
  if (Number.isNaN(t)) return "";
  return new Date(t - 86400000).toISOString().slice(0, 10);
}

/**
 * Lo que propone "＋ Asiento" desde una cuenta. Si el saldo está al revés,
 * arma el saldo inicial que lo deja en cero, contra Ajuste De Capital, con
 * fecha del día anterior al primer movimiento. Si no, la cuenta queda en el
 * debe y lo demás vacío.
 */
export function asientoPropuesto(fila, { cuentas = [], primera = "", hoy = "" } = {}) {
  const base = { fecha: hoy, tipo: "", cuenta_debe: fila?.codigo || "", cuenta_haber: "", importe: "", descripcion: "" };
  if (!fila?.al_reves || fila.hijas) return base;
  const ajuste = cuentas.find((c) => /^ajuste de capital$/i.test(String(c.nombre || "").trim()))?.codigo || "";
  const importe = String(Math.abs(fila.saldo).toFixed(2)).replace(".", ",");
  const fecha = primera ? diaAnterior(primera) : hoy;
  return fila.saldo < 0
    ? { fecha, tipo: "SALDO INICIAL", cuenta_debe: fila.codigo, cuenta_haber: ajuste, importe, descripcion: `Saldo inicial de ${fila.nombre}` }
    : { fecha, tipo: "SALDO INICIAL", cuenta_debe: ajuste, cuenta_haber: fila.codigo, importe, descripcion: `Saldo inicial de ${fila.nombre}` };
}
