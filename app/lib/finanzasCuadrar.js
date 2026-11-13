// app/lib/finanzasCuadrar.js — Finanzas: cuadrar las cajas y bancos de Gypi
// con el libro (13/11). Sin migración.
//
// Se sube el libro (T-OPERACIONES) y, por cada caja y banco, hasta la fecha
// de corte (lo último que tiene el libro), se compara movimiento por
// movimiento:
//   - Lo que está en Gypi y no en el libro ("sobra"): con su origen
//     (extracto, plazos fijos, saldo inicial…), para anularlo si está
//     repetido.
//   - Lo que está en el libro y no en Gypi ("falta"): se carga pasando el
//     histórico otra vez con el mismo libro.
// Cómo se emparejan, en este orden y cada uno una sola vez:
//   1. Lo que vino del libro, por su clave (la misma del histórico).
//   2. La apertura (todo lo del libro antes de la fecha de inicio) con el
//      saldo inicial de la caja.
//   3. Mismo importe y mismo lado (entra o sale): el mismo día, y si no hasta
//      1, 3 y 7 días de diferencia (el extracto y el libro a veces difieren
//      en la fecha). Si hay varios, el más cercano; a igual distancia, el que
//      vino del libro.
// Lo de Gypi después de la fecha de corte no se toca (salvo un saldo inicial,
// que es todo lo anterior a su fecha y se compara con la apertura).
import { movimientoCaja } from "./finanzasOperaciones";
import { DESDE_HISTORICO, ORIGEN_LIBRO, renglonesDelLibro } from "./finanzasHistorico";
import { ORIGEN_SALDO_INICIAL } from "./finanzasProveedores";
import { NOMBRE_ORIGEN } from "./finanzasBanco";

/** Los orígenes que vienen de cargar algo de afuera (libro, extracto, planillas del banco): se proponen tildados para anular. */
export const ORIGENES_IMPORTADOS = new Set([ORIGEN_SALDO_INICIAL, ORIGEN_LIBRO, "banco", "plazo_fijo", "fci", "titulos"]);
export const MAX_ANULAR_CUADRAR = 2000;
const DIAS = [0, 1, 3, 7];

const cent = (n) => Math.round((Number(n) || 0) * 100);
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dias = (a, b) => Math.abs(Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000));
const diaAnterior = (f) => new Date(Date.parse(`${f}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
export const nombreOrigen = (o) => NOMBRE_ORIGEN[o || "manual"] || o || "Cargadas a mano en Gypi";

/** Lo último que tiene el libro en las cajas y bancos (sin pasar de hoy). */
export function corteDelLibro(filas = [], tesoreria = [], hoy) {
  const cajas = new Set(tesoreria.map((t) => t.cuenta));
  let max = "";
  for (const r of filas) {
    if (r.fecha > max && (!hoy || r.fecha <= hoy) && (cajas.has(r.debe) || cajas.has(r.haber))) max = r.fecha;
  }
  return max || null;
}

/** Cuánto mueve un renglón del libro en una caja (+ entra, − sale), en la moneda de la caja; null si no la toca o es de otra moneda. */
function movimientoLibro(r, caja) {
  if (r.debe === r.haber) return null;
  const signo = r.debe === caja.cuenta ? 1 : r.haber === caja.cuenta ? -1 : 0;
  if (!signo) return null;
  if ((caja.moneda === "USD") !== (r.moneda === "USD")) return null;
  return signo * r.total;
}

/**
 * Compara una caja.
 * @returns {{ cuenta, nombre, moneda, saldo_libro, saldo_gypi, diferencia, sobran: object[], faltan: object[], otra_moneda: number }}
 */
export function cuadrarCaja({ caja, filas = [], ops = [], corte, desde = DESDE_HISTORICO }) {
  // Del libro: lo de antes de "desde" va junto, como apertura
  let apertura = 0;
  let otraMoneda = 0;
  const libro = [];
  for (const r of filas) {
    if (r.fecha > corte) continue;
    const m = movimientoLibro(r, caja);
    if (m == null) {
      if ((r.debe === caja.cuenta || r.haber === caja.cuenta) && r.debe !== r.haber) otraMoneda++;
      continue;
    }
    if (r.fecha < desde) apertura += m;
    else libro.push({ fecha: r.fecha, importe: centavos(m), c: cent(m), clave: r.clave, fila: r.fila, tipo: r.tipo, descripcion: r.descripcion, entidad: r.entidad });
  }
  if (cent(apertura)) libro.unshift({ fecha: diaAnterior(desde), importe: centavos(apertura), c: cent(apertura), apertura: true, tipo: "APERTURA", descripcion: `Saldo de antes del ${desde.split("-").reverse().join("/")}` });

  // De Gypi, hasta la fecha de corte
  const gypi = [];
  for (const o of ops) {
    // El saldo inicial cuenta aunque tenga fecha posterior: es todo lo de antes
    if (o.anulada_at || (o.fecha > corte && o.origen !== ORIGEN_SALDO_INICIAL)) continue;
    const m = movimientoCaja(o, caja);
    if (!m) continue;
    gypi.push({ op: o, importe: centavos(m), c: cent(m) });
  }

  const libres = new Set(gypi.map((_, i) => i));
  const parejas = new Map(); // índice del libro → índice de Gypi
  // 1. Por la clave del histórico
  const porClave = new Map();
  gypi.forEach((g, i) => { if (g.op.origen === ORIGEN_LIBRO && g.op.origen_id) porClave.set(g.op.origen_id, i); });
  libro.forEach((l, j) => {
    const i = l.clave ? porClave.get(l.clave) : undefined;
    if (i != null && libres.has(i) && Math.abs(gypi[i].c - l.c) <= 1) { parejas.set(j, i); libres.delete(i); }
  });
  // 2. La apertura con el saldo inicial de la caja
  libro.forEach((l, j) => {
    if (!l.apertura || parejas.has(j)) return;
    const i = [...libres].find((k) => gypi[k].op.origen === ORIGEN_SALDO_INICIAL && Math.abs(gypi[k].c - l.c) <= 1);
    if (i != null) { parejas.set(j, i); libres.delete(i); }
  });
  // 3. Mismo importe y lado, por cercanía de fecha
  const porImporte = new Map();
  gypi.forEach((g, i) => { const k = g.c; if (!porImporte.has(k)) porImporte.set(k, []); porImporte.get(k).push(i); });
  for (const tope of DIAS) {
    libro.forEach((l, j) => {
      if (parejas.has(j)) return;
      let mejor = null;
      for (const k of [l.c - 1, l.c, l.c + 1]) {
        for (const i of porImporte.get(k) || []) {
          if (!libres.has(i)) continue;
          const d = dias(gypi[i].op.fecha, l.fecha);
          if (d > tope) continue;
          const deLibro = gypi[i].op.origen === ORIGEN_LIBRO ? 0 : 1;
          if (!mejor || d < mejor.d || (d === mejor.d && deLibro < mejor.deLibro) || (d === mejor.d && deLibro === mejor.deLibro && gypi[i].op.id < gypi[mejor.i].op.id)) mejor = { i, d, deLibro };
        }
      }
      if (mejor) { parejas.set(j, mejor.i); libres.delete(mejor.i); }
    });
  }

  const sobran = [...libres].map((i) => {
    const { op, importe } = gypi[i];
    return {
      id: op.id, fecha: op.fecha, importe, tipo: op.tipo || "", descripcion: op.descripcion || "", entidad: op.entidad || "",
      origen: op.origen || "manual", nombre_origen: nombreOrigen(op.origen), importada: ORIGENES_IMPORTADOS.has(op.origen || "manual"),
    };
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
  const faltan = libro.filter((_, j) => !parejas.has(j)).map(({ c, ...l }) => l);
  const saldoLibro = centavos(libro.reduce((s, l) => s + l.importe, 0));
  const saldoGypi = centavos(gypi.reduce((s, g) => s + g.importe, 0));
  return {
    cuenta: caja.cuenta, nombre: caja.nombre, moneda: caja.moneda === "USD" ? "USD" : "ARS", tipo: caja.tipo,
    saldo_libro: saldoLibro, saldo_gypi: saldoGypi, diferencia: centavos(saldoGypi - saldoLibro),
    sobran, faltan, otra_moneda: otraMoneda,
  };
}

/**
 * Todas las cajas y bancos.
 * @param {{ grilla: string[][], ops: object[], tesoreria: object[], corte?: string|null, desde?: string, hoy: string }} d
 * @returns {{ error?: string, corte?: string, desde?: string, cajas?: object[], anulables?: number[] }}
 */
export function cuadrarConLibro({ grilla, ops = [], tesoreria = [], corte = null, desde = DESDE_HISTORICO, hoy }) {
  const leido = renglonesDelLibro(grilla);
  if (leido.error) return { error: leido.error };
  const cajas = tesoreria.filter((t) => t.activa !== false || ops.some((o) => !o.anulada_at && (o.cuenta_debe === t.cuenta || o.cuenta_haber === t.cuenta)));
  const fin = corte || corteDelLibro(leido.filas, cajas, hoy);
  if (!fin) return { error: "El libro no tiene movimientos de las cajas y bancos de Gypi." };
  const lista = cajas.map((caja) => cuadrarCaja({ caja, filas: leido.filas, ops, corte: fin, desde }))
    .filter((c) => c.saldo_libro || c.saldo_gypi || c.sobran.length || c.faltan.length);
  // Lo que sobra y vino de afuera, sin repetir (una operación entre dos cajas aparece en las dos)
  const anulables = [...new Set(lista.flatMap((c) => c.sobran.filter((s) => s.importada).map((s) => s.id)))];
  return { corte: fin, desde, cajas: lista, anulables };
}

/* ─── Empezar de nuevo (13/11) ──────────────────────────────────────────
 * Anula los movimientos de las cajas y bancos para volver a cargarlos desde
 * el libro y los extractos. No borra: quedan anulados con una marca
 * ("Empezar de nuevo dd/mm/aaaa hh:mm · quién") y se pueden volver atrás.
 *   - "importado": lo que vino de afuera (libro, saldos iniciales, extracto,
 *     plazos fijos, FCI, títulos) y lo cargado a mano en Movimientos.
 *   - "todo": también lo hecho en Gypi (pagos, cobros, cheques, Mi caja,
 *     sueldos…).
 */
export const MARCA_VACIAR = "Empezar de nuevo";
const ORIGENES_VACIAR = new Set([...ORIGENES_IMPORTADOS, "manual"]);

/** ¿Este movimiento se anula con ese alcance? */
export function entraEnVaciar(op, alcance = "importado") {
  return alcance === "todo" || ORIGENES_VACIAR.has(op?.origen || "manual");
}

/**
 * Qué se anularía: cuántos movimientos de cada origen y sus ids.
 * @returns {{ ids: number[], porOrigen: { origen: string, nombre: string, n: number }[], quedan: number }}
 */
export function resumenVaciar(ops = [], alcance = "importado") {
  const por = new Map();
  const ids = [];
  let quedan = 0;
  for (const o of ops) {
    if (o.anulada_at) continue;
    if (!entraEnVaciar(o, alcance)) { quedan++; continue; }
    ids.push(o.id);
    const k = o.origen || "manual";
    const x = por.get(k) || { origen: k, nombre: nombreOrigen(k), n: 0 };
    x.n++;
    por.set(k, x);
  }
  return { ids, porOrigen: [...por.values()].sort((a, b) => b.n - a.n), quedan };
}

/** La marca de una vez que se empezó de nuevo. */
export function marcaVaciar(quien, ahora = new Date()) {
  const ar = new Date(ahora.getTime() - 3 * 3600000).toISOString();
  return `${MARCA_VACIAR} ${ar.slice(8, 10)}/${ar.slice(5, 7)}/${ar.slice(0, 4)} ${ar.slice(11, 16)} · ${String(quien || "Dueño").slice(0, 60)}`;
}
export const esMarcaVaciar = (m) => typeof m === "string" && m.startsWith(`${MARCA_VACIAR} `) && m.length <= 120;
