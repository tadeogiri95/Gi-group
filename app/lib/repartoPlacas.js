// app/lib/repartoPlacas.js — Placas cortadas entre varias OT (pedido de Tadeo,
// 27/11). En el seccionado a veces se cortan varias OT juntas y no se sabe
// cuántas placas fueron para cada una. El operario escanea la placa, pone
// cuántas cortó y marca las OT del corte; Gypi reparte esas placas según lo
// que le falta a cada OT de esa placa (necesidades del MRP, 108, menos lo ya
// retirado desde la app, 107). Los repartos van con un decimal (Tadeo eligió
// 7,5 antes que redondear a placas enteras) y siempre suman lo cortado.
//
// Reglas del reparto:
//  - Si lo que falta entre todas alcanza para lo cortado: según lo que falta.
//  - Si se cortó más de lo que faltaba: cada una recibe lo que le falta y el
//    sobrante se reparte según lo que necesitaba cada OT ("más de lo previsto").
//  - Una OT sin esa placa en sus necesidades empieza en 0 (si hay otras que sí
//    la tienen). Si ninguna la tiene, se reparte en partes iguales.
// Cada número se puede cambiar a mano antes de confirmar.

const r3 = (n) => Math.round(n * 1000) / 1000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Lo que necesita, lo retirado y lo que falta de una placa, por OT.
 * @param {object[]} necesidades renglones de necesidades_stock de ese SKU (ot, cantidad, fecha?, obra_terminada?)
 * @param {object[]} movimientos movimientos_stock de ese SKU (ot, cantidad, tipo, anulado)
 * @returns {Map<string, { ot: string, necesario: number, retirado: number, falta: number, fecha: string|null }>}
 */
export function pendientesPorOt(necesidades = [], movimientos = []) {
  const out = new Map();
  const fila = (ot) => {
    if (!out.has(ot)) out.set(ot, { ot, necesario: 0, retirado: 0, falta: 0, fecha: null, conNecesidad: false });
    return out.get(ot);
  };
  for (const n of necesidades || []) {
    const ot = String(n?.ot ?? "").trim();
    if (!ot || n?.obra_terminada === true) continue;
    const f = fila(ot);
    f.necesario += num(n.cantidad);
    f.conNecesidad = true;
    if (n.fecha && (!f.fecha || n.fecha < f.fecha)) f.fecha = n.fecha;
  }
  for (const m of movimientos || []) {
    const ot = String(m?.ot ?? "").trim();
    if (!ot || m.anulado || (m.tipo !== "consumo" && m.tipo !== "devolucion")) continue;
    fila(ot).retirado += (m.tipo === "devolucion" ? -1 : 1) * num(m.cantidad);
  }
  for (const f of out.values()) {
    f.necesario = r3(f.necesario);
    f.retirado = r3(f.retirado);
    f.falta = f.conNecesidad ? Math.max(0, r3(f.necesario - f.retirado)) : 0;
  }
  return out;
}

/** Las OT que todavía necesitan esa placa: primero la que la necesita antes. */
export function otsConFalta(pendientes) {
  return [...(pendientes?.values?.() || [])]
    .filter((f) => f.falta > 0)
    .sort((a, b) => String(a.fecha || "9999").localeCompare(String(b.fecha || "9999")) || String(a.ot).localeCompare(String(b.ot), "es", { numeric: true }));
}

/** Redondea a décimas con el método del mayor resto, para que la suma dé justo el total. */
function aDecimas(valores, total) {
  const totalD = Math.round(total * 10);
  const base = valores.map((v) => Math.floor(v * 10 + 1e-9));
  let resto = totalD - base.reduce((s, v) => s + v, 0);
  const orden = valores.map((v, i) => ({ i, frac: v * 10 - base[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; resto > 0 && orden.length; k = (k + 1) % orden.length, resto--) base[orden[k].i] += 1;
  return base.map((d) => d / 10);
}

/**
 * Reparte las placas cortadas entre las OT del corte.
 * @param {number} total placas cortadas (con hasta un decimal)
 * @param {{ ot: string, necesario?: number, falta?: number }[]} ots las OT marcadas, en el orden en que se muestran
 * @returns {{ ot: string, cantidad: number }[]} con un decimal; suman el total
 */
export function repartirPlacas(total, ots = []) {
  const t = Math.round(num(total) * 10) / 10;
  if (!(t > 0) || !ots.length) return ots.map((o) => ({ ot: String(o.ot), cantidad: 0 }));
  const falta = ots.map((o) => Math.max(0, num(o.falta)));
  const necesario = ots.map((o) => Math.max(0, num(o.necesario)));
  const sumaFalta = falta.reduce((s, v) => s + v, 0);
  const sumaNec = necesario.reduce((s, v) => s + v, 0);
  let crudo;
  if (sumaFalta >= t) {
    crudo = falta.map((f) => (t * f) / sumaFalta);
  } else {
    const sobra = t - sumaFalta;
    const pesos = sumaNec > 0 ? necesario : ots.map(() => 1);
    const sumaPesos = pesos.reduce((s, v) => s + v, 0);
    crudo = falta.map((f, i) => f + (sobra * pesos[i]) / sumaPesos);
  }
  const dec = aDecimas(crudo, t);
  return ots.map((o, i) => ({ ot: String(o.ot), cantidad: dec[i] }));
}

/** Suma de un reparto, con un decimal. */
export function sumaReparto(reparto = []) {
  return Math.round(reparto.reduce((s, r) => s + num(r.cantidad), 0) * 10) / 10;
}

/** El reparto se puede guardar: suma lo cortado y al menos una OT recibe algo. */
export function repartoValido(reparto = [], total) {
  const t = Math.round(num(total) * 10) / 10;
  return t > 0 && reparto.some((r) => num(r.cantidad) > 0) && reparto.every((r) => num(r.cantidad) >= 0) && sumaReparto(reparto) === t;
}

/** Nota que acompaña a cada retiro del corte conjunto. */
export function notaCorte(total, ots = []) {
  const lista = ots.map((o) => String(o.ot ?? o)).join(", ");
  const t = String(Math.round(num(total) * 10) / 10).replace(".", ",");
  return `Corte conjunto: ${t} placa${t === "1" ? "" : "s"} entre OT ${lista}`.slice(0, 300);
}

/** Lo que escribe el operario en el reparto: "7,5" → 7.5 (un decimal); 0 vale; vacío o inválido → null. */
export function leerReparto(texto) {
  let t = String(texto ?? "").replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n >= 1e7) return null;
  return Math.round(n * 10) / 10;
}
