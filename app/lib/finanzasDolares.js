// app/lib/finanzasDolares.js — 💱 Comprar o vender dólares (14/11, pedido de
// Tadeo: "que asiente los dólares que salieron a un tipo de cambio, la
// diferencia de cotización y el ingreso a la caja que corresponda").
//
// Sin migración. Reglas:
//   - Los dólares de una caja o banco en USD "valen" en pesos lo que dice el
//     Mayor: el saldo en pesos de esa cuenta ÷ su saldo en USD (costo
//     promedio). Se calcula con las mismas cuentas que el Mayor (cada
//     operación pasada a pesos con su tipo de cambio).
//   - Vender: (1) DÓLARES en USD al costo promedio, la caja en pesos al debe
//     y la de dólares al haber: la caja USD baja los dólares y su valor en
//     pesos; (2) la diferencia entre lo que se cobró y el costo, en pesos,
//     contra la cuenta de diferencia de cambio (ganancia al haber, pérdida al
//     debe). La caja en pesos termina con lo que entró de verdad.
//   - Comprar: una sola DÓLARES en USD al tipo de cambio de la compra (la caja
//     USD al debe, la de pesos al haber). Comprar no tiene diferencia.
//   - El costo lo calcula Gypi y se puede cambiar (por ejemplo si faltan
//     operaciones viejas de la caja). Si se venden todos los dólares al costo
//     calculado, sale exacto el saldo en pesos (no queda un resto de centavos).
//   - Las dos operaciones de una venta van juntas (origen "dolares", el mismo
//     origen_id con "-dif" en la diferencia) y se anulan juntas.
import { validarOperacion, movimientoCaja, numero, plata } from "./finanzasOperaciones";
import { renglonesEnPesos } from "./finanzasMayor";

export const ORIGEN_DOLARES = "dolares";
/** El tipo nuevo y los viejos del libro que significan lo mismo. */
export const TIPOS_DOLARES = ["DÓLARES", "VENTA USD", "COMPRA USD"];
export const GRUPO_DOLARES = /^d[0-9a-f]{12}$/;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
/** $ 1.400 · $ 1.312,5 (un tipo de cambio, sin ceros de más) */
export const pesosPorDolar = (n) => `$ ${(Number(n) || 0).toLocaleString("es-AR", { maximumFractionDigits: 4 })}`;

/** El tipo de operación para comprar o vender: DÓLARES, o los viejos VENTA USD / COMPRA USD. */
export function tipoDolares(tipos = [], accion = "vender") {
  const vivos = tipos.filter((t) => t.activo !== false);
  const de = (c) => vivos.find((t) => t.codigo === c);
  return de("DÓLARES") || de(accion === "comprar" ? "COMPRA USD" : "VENTA USD") || vivos.find((t) => TIPOS_DOLARES.includes(t.codigo)) || null;
}

/**
 * Cuántos dólares tiene una caja en USD y cuánto valen en pesos en el Mayor
 * (hasta una fecha, incluida).
 * @returns {{ usd: number, pesos: number, costo: number|null }} costo = pesos por dólar
 */
export function costoCajaUsd(ops = [], caja, { hasta = "", cuentas = [], tipos = [] } = {}) {
  let usd = 0;
  let pesos = 0;
  if (caja) {
    for (const op of ops) {
      if (op.anulada_at || (hasta && op.fecha > hasta)) continue;
      const m = movimientoCaja(op, caja);
      if (!m) continue;
      usd += m;
      for (const r of renglonesEnPesos(op, { cuentas, tipos })) if (r.cuenta === caja.cuenta) pesos += r.debe - r.haber;
    }
  }
  usd = centavos(usd);
  pesos = centavos(pesos);
  return { usd, pesos, costo: usd > 0 && pesos > 0 ? Math.round((pesos / usd) * 100) / 100 : null };
}

/** ¿La cuenta tiene cuentas debajo? (no se asienta en una que agrupa) */
const agrupa = (c, cuentas) => cuentas.some((x) => x.codigo !== c.codigo && String(x.codigo).startsWith(`${c.codigo}.`));
const esDeResultado = (c) => /resultado/i.test(String(c.rubro || "")) || /^0[45]\./.test(String(c.codigo || ""));
const NOMBRE_DIFERENCIA = /diferencias? (de )?(cambio|cotizaci)|dif\.? (de )?cambio/i;

/** Las cuentas donde puede ir la diferencia: las de resultado que no agrupan otras. */
export function cuentasParaDiferencia(cuentas = []) {
  return cuentas.filter((c) => c.activa !== false && esDeResultado(c) && !agrupa(c, cuentas));
}

/**
 * La cuenta de diferencia de cambio que Gypi propone: la del renglón
 * "Diferencia de cambio" del estado de resultados (FIN_DIF) o la que se llama
 * así; si hay una de ganancia y otra de pérdida, la que corresponde.
 */
export function cuentaDiferenciaSugerida(cuentas = [], ganancia = true) {
  const candidatas = cuentas.filter((c) => c.activa !== false && !agrupa(c, cuentas)
    && (/^FIN_DIF/i.test(String(c.linea_eerr || "")) || NOMBRE_DIFERENCIA.test(String(c.nombre || ""))));
  if (!candidatas.length) return null;
  const lado = ganancia ? /positiv|ganad|ganancia|ingreso/i : /negativ|p[eé]rdida|egreso/i;
  const otro = ganancia ? /negativ|p[eé]rdida|egreso/i : /positiv|ganad|ganancia|ingreso/i;
  return (candidatas.find((c) => lado.test(c.nombre)) || candidatas.find((c) => !otro.test(c.nombre)) || candidatas[0]).codigo;
}

/**
 * Las operaciones de una compra o venta de dólares.
 * @param {{ accion: "vender"|"comprar", caja_usd, caja_pesos, usd, tipo_cambio, costo?, fecha, cuenta_diferencia?, descripcion? }} f
 * @param {{ tipos, cuentas, tesoreria, centros?, proveedores?, proyectos?, calculado?: { usd, pesos, costo } }} ctx
 *   calculado: lo que tiene la caja en USD (costoCajaUsd) a esa fecha.
 * @returns {{ ops: object[], resumen?: object, avisos: string[], errores: string[] }}
 */
export function operacionesDolares(f = {}, ctx = {}) {
  const { tipos = [], cuentas = [], tesoreria = [], calculado = null } = ctx;
  const accion = f.accion === "comprar" ? "comprar" : "vender";
  const errores = [];
  const avisos = [];
  const vivas = tesoreria.filter((t) => t.activa !== false);
  const cajaUsd = vivas.find((t) => t.cuenta === f.caja_usd && t.moneda === "USD");
  const cajaPesos = vivas.find((t) => t.cuenta === f.caja_pesos && t.moneda !== "USD");
  if (!cajaUsd) errores.push("Elegí la caja o el banco en dólares.");
  if (!cajaPesos) errores.push("Elegí la caja o el banco en pesos.");
  const usd = centavos(numero(f.usd));
  if (!(usd > 0) || usd >= 1e10) errores.push("Poné cuántos dólares.");
  const tc = Number(numero(f.tipo_cambio));
  if (!(tc > 0) || tc >= 1e9) errores.push(`Falta el tipo de cambio de la ${accion === "comprar" ? "compra" : "venta"}.`);
  const fecha = txt(f.fecha, 10);
  if (!FECHA.test(fecha) || Number.isNaN(Date.parse(`${fecha}T12:00:00Z`))) errores.push("Falta la fecha.");
  const tipo = tipoDolares(tipos, accion);
  if (!tipo) errores.push("Falta el tipo de operación DÓLARES: pasá los tipos nuevos en Finanzas → Configuración.");
  let costo = null;
  if (accion === "vender") {
    costo = Number(numero(f.costo));
    if (!(costo > 0) || costo >= 1e9) errores.push("Falta el costo de esos dólares (a cuánto están anotados en la caja).");
  }
  if (errores.length) return { ops: [], avisos, errores: [...new Set(errores)] };

  const nota = txt(f.descripcion, 200);
  const conNota = (s) => txt(nota ? `${s} · ${nota}` : s, 500);
  const base = { fecha, tipo: tipo.codigo };
  const validar = (o) => validarOperacion({ ...base, ...o }, ctx);
  const pesos = centavos(usd * tc);

  if (accion === "comprar") {
    const { op, errores: e } = validar({
      neto: usd, moneda: "USD", tipo_cambio: tc, cuenta_debe: cajaUsd.cuenta, cuenta_haber: cajaPesos.cuenta,
      descripcion: conNota(`Compra de ${plata(usd, "USD")} a ${pesosPorDolar(tc)}: de ${cajaPesos.nombre} a ${cajaUsd.nombre}`),
    });
    if (!op) return { ops: [], avisos, errores: e };
    return {
      ops: [{ ...op, origen: ORIGEN_DOLARES }], avisos, errores: [],
      resumen: { accion, usd, tipo_cambio: tc, pesos, costo: null, costo_pesos: null, diferencia: 0, caja_usd: cajaUsd.nombre, caja_pesos: cajaPesos.nombre },
    };
  }

  // Vender todo al costo calculado: el valor exacto que dice el Mayor
  const todoAlCalculado = calculado && calculado.costo && Math.abs(usd - calculado.usd) < 0.005 && Math.abs(costo - calculado.costo) < 0.005;
  const costoPesos = todoAlCalculado ? centavos(calculado.pesos) : centavos(usd * costo);
  const diferencia = centavos(pesos - costoPesos);
  if (calculado && usd - calculado.usd > 0.005) avisos.push(`En ${cajaUsd.nombre} hay ${plata(calculado.usd, "USD")} al ${fecha.split("-").reverse().join("/")}: la caja queda en negativo.`);

  const { op: venta, errores: e1 } = validar({
    neto: usd, moneda: "USD", tipo_cambio: costo, cuenta_debe: cajaPesos.cuenta, cuenta_haber: cajaUsd.cuenta,
    descripcion: conNota(`Venta de ${plata(usd, "USD")} a ${pesosPorDolar(tc)} (costo ${pesosPorDolar(costo)}): de ${cajaUsd.nombre} a ${cajaPesos.nombre}`),
  });
  if (!venta) return { ops: [], avisos, errores: e1 };
  const ops = [{ ...venta, total_ars: costoPesos, origen: ORIGEN_DOLARES }];

  if (Math.abs(diferencia) >= 0.01) {
    const cuentaDif = cuentas.find((c) => c.codigo === txt(f.cuenta_diferencia, 40));
    if (!cuentaDif) return { ops: [], avisos, errores: [`Elegí la cuenta de la diferencia de cotización (${diferencia > 0 ? "ganancia" : "pérdida"} de ${plata(Math.abs(diferencia))}).`] };
    if (vivas.some((t) => t.cuenta === cuentaDif.codigo)) return { ops: [], avisos, errores: ["La diferencia de cotización no va a una caja: elegí una cuenta de resultado."] };
    const gana = diferencia > 0;
    const { op: dif, errores: e2 } = validar({
      neto: Math.abs(diferencia), moneda: "ARS",
      cuenta_debe: gana ? cajaPesos.cuenta : cuentaDif.codigo, cuenta_haber: gana ? cuentaDif.codigo : cajaPesos.cuenta,
      descripcion: conNota(`Diferencia de cotización (${gana ? "ganancia" : "pérdida"}): venta de ${plata(usd, "USD")} a ${pesosPorDolar(tc)}, costo ${pesosPorDolar(costo)}`),
    });
    if (!dif) return { ops: [], avisos, errores: e2 };
    ops.push({ ...dif, origen: ORIGEN_DOLARES });
  }
  return {
    ops, avisos, errores: [],
    resumen: { accion, usd, tipo_cambio: tc, pesos, costo, costo_pesos: costoPesos, diferencia, caja_usd: cajaUsd.nombre, caja_pesos: cajaPesos.nombre },
  };
}
