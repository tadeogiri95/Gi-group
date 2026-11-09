// app/lib/finanzasProveedores.js — Finanzas, parte F2a (2): cuenta corriente
// de proveedores (reemplaza CC_PROVEEDORES). Sin migración: sale de las
// operaciones (fin_operaciones, 171) que usan la cuenta Proveedores.
//
//   - Lo que va al haber de Proveedores es lo comprado (la deuda sube); lo que
//     va al debe es lo pagado (la deuda baja). Deuda = comprado - pagado; si
//     da negativo, el proveedor tiene saldo a favor nuestro.
//   - Facturas pendientes: los pagos se aplican a las compras más viejas
//     primero, y queda lo que falta pagar de cada una con sus días.
//   - Saldos iniciales: se calculan del libro (T-OPERACIONES) hasta la fecha de
//     corte, por proveedor, juntando los nombres escritos distinto ("Bosques
//     Del Sur S.A." y "BOSQUES DEL SUR S.A." son el mismo). Cada saldo entra
//     como una operación "SALDO INICIAL" contra Ajuste De Capital, como hacía
//     el libro con lo histórico.

export const TIPO_SALDO_INICIAL = "SALDO INICIAL";
export const ORIGEN_SALDO_INICIAL = "saldo_inicial";
export const CUENTA_PROVEEDORES = /^proveedores$/i;
export const CUENTA_AJUSTE_CAPITAL = /^ajuste de capital$/i;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Nombre para comparar: sin mayúsculas, acentos, puntos ni espacios. "Bosques Del Sur S.A." → "BOSQUESDELSURSA". */
export function claveNombre(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Códigos de la cuenta Proveedores en el plan de cuentas. */
export function cuentasProveedores(cuentas = []) {
  return new Set(cuentas.filter((c) => CUENTA_PROVEEDORES.test(String(c.nombre || "").trim())).map((c) => c.codigo));
}

/** De quién es una operación: el proveedor de la lista, o el nombre escrito. */
export function claveDe(op) {
  if (op.proveedor_id) return `p${op.proveedor_id}`;
  const n = claveNombre(op.entidad);
  return n ? `e${n}` : "";
}

/** Cuánto suma a la deuda con el proveedor: + compra, - pago, 0 si no toca Proveedores. */
export function efectoDeuda(op, cuentasProv) {
  if (op.anulada_at) return 0;
  const t = Number(op.total_ars) || 0;
  if (cuentasProv.has(op.cuenta_haber)) return t;
  if (cuentasProv.has(op.cuenta_debe)) return -t;
  return 0;
}

/**
 * Saldo de cada proveedor.
 * @returns {{ clave: string, proveedor_id: number|null, nombre: string, comprado: number, pagado: number, deuda: number, ultimo: string }[]}
 */
export function saldosProveedores(ops, cuentasProv, proveedores = []) {
  const nombres = new Map(proveedores.map((p) => [`p${p.id}`, p.nombre]));
  const por = new Map();
  for (const op of ops || []) {
    const ef = efectoDeuda(op, cuentasProv);
    if (!ef) continue;
    const clave = claveDe(op);
    if (!clave) continue;
    const s = por.get(clave) || { clave, proveedor_id: op.proveedor_id || null, nombre: nombres.get(clave) || op.entidad || "", comprado: 0, pagado: 0, deuda: 0, ultimo: "" };
    if (ef > 0) s.comprado += ef; else s.pagado -= ef;
    s.deuda += ef;
    if (op.fecha > s.ultimo) s.ultimo = op.fecha;
    por.set(clave, s);
  }
  return [...por.values()]
    .map((s) => ({ ...s, comprado: centavos(s.comprado), pagado: centavos(s.pagado), deuda: centavos(s.deuda) }))
    .sort((a, b) => b.deuda - a.deuda || a.nombre.localeCompare(b.nombre));
}

/** Movimientos de un proveedor, del más viejo al más nuevo, con el saldo renglón por renglón. */
export function movimientosProveedor(ops, clave, cuentasProv) {
  let saldo = 0;
  return (ops || [])
    .filter((op) => claveDe(op) === clave && efectoDeuda(op, cuentasProv))
    .sort((a, b) => (a.fecha === b.fecha ? Number(a.id) - Number(b.id) : a.fecha < b.fecha ? -1 : 1))
    .map((op) => {
      const ef = efectoDeuda(op, cuentasProv);
      saldo = centavos(saldo + ef);
      return { op, compra: ef > 0 ? ef : 0, pago: ef < 0 ? -ef : 0, saldo };
    });
}

const dias = (desde, hasta) => Math.max(0, Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86400000));

/** Compras que faltan pagar: los pagos se aplican a las más viejas primero. */
export function pendientesProveedor(movimientos, hoy) {
  const compras = movimientos.filter((m) => m.compra > 0).map((m) => ({ op: m.op, importe: m.compra, falta: m.compra }));
  let pagado = movimientos.reduce((s, m) => s + m.pago, 0);
  for (const c of compras) {
    const usa = Math.min(c.falta, pagado);
    c.falta = centavos(c.falta - usa);
    pagado = centavos(pagado - usa);
  }
  return compras.filter((c) => c.falta > 0.009).map((c) => ({ ...c, dias: dias(c.op.fecha, hoy) }));
}

/** El proveedor de la lista que tiene ese nombre (comparando sin mayúsculas, puntos ni espacios), o null. */
export function emparejarProveedor(nombre, proveedores = []) {
  const k = claveNombre(nombre);
  if (!k) return null;
  return proveedores.find((p) => claveNombre(p.nombre) === k)
    // "ACERCO S A" y "ACERCO SA" ya son iguales; además, "BROCANELLI S." contra "BROCANELLI SA"
    || proveedores.find((p) => { const q = claveNombre(p.nombre); return q.length >= 6 && k.length >= 6 && (q.startsWith(k) || k.startsWith(q)); })
    || null;
}

/**
 * Saldo de cada proveedor en el libro hasta la fecha de corte (incluida), de
 * la hoja T-OPERACIONES. Junta los nombres escritos distinto.
 * @param {string[][]} grilla la hoja, con títulos en la primera fila
 * @param {string} hasta YYYY-MM-DD
 * @param {Set<string>} cuentasProv
 * @returns {{ filas: { nombre: string, comprado: number, pagado: number, deuda: number, ultimo: string }[], error?: string }}
 */
export function saldosDelLibro(grilla, hasta, cuentasProv) {
  const titulos = (grilla?.[0] || []).map((t) => String(t || "").trim().toLowerCase());
  const col = (n) => titulos.indexOf(n);
  const c = { fecha: col("fecha_operación"), entidad: col("id_entidad"), total: col("total"), debe: col("cuenta_debe_final"), haber: col("cuenta_haber_final"), estado: col("estado") };
  if ([c.fecha, c.entidad, c.total, c.debe, c.haber].some((i) => i < 0)) {
    return { filas: [], error: "La hoja T-OPERACIONES no tiene las columnas fecha_operación, id_entidad, Total, cuenta_debe_final y cuenta_haber_final." };
  }
  const por = new Map();
  for (const f of grilla.slice(1)) {
    const fecha = fechaDelLibro(f[c.fecha]);
    if (!fecha || fecha > hasta) continue;
    if (c.estado >= 0 && f[c.estado] && String(f[c.estado]).toUpperCase() !== "CONFIRMADO") continue;
    const debe = String(f[c.debe] || "").trim();
    const haber = String(f[c.haber] || "").trim();
    const t = Number(String(f[c.total] || "").replace(",", ".")) || 0;
    const ef = cuentasProv.has(haber) ? t : cuentasProv.has(debe) ? -t : 0;
    if (!ef) continue;
    const nombre = String(f[c.entidad] || "").replace(/\s+/g, " ").trim();
    const k = claveNombre(nombre);
    if (!k) continue;
    const s = por.get(k) || { nombre, comprado: 0, pagado: 0, deuda: 0, ultimo: "", variantes: new Map() };
    s.variantes.set(nombre, (s.variantes.get(nombre) || 0) + 1);
    if (ef > 0) s.comprado += ef; else s.pagado -= ef;
    s.deuda += ef;
    if (fecha > s.ultimo) s.ultimo = fecha;
    por.set(k, s);
  }
  const filas = [...por.values()].map((s) => ({
    // El nombre más usado de los que se escribieron
    nombre: [...s.variantes.entries()].sort((a, b) => b[1] - a[1])[0][0],
    comprado: centavos(s.comprado), pagado: centavos(s.pagado), deuda: centavos(s.deuda), ultimo: s.ultimo,
    variantes: s.variantes.size,
  })).filter((s) => Math.abs(s.deuda) >= 0.01).sort((a, b) => b.deuda - a.deuda);
  return { filas };
}

/** Fecha del libro (número de serie de Excel o dd/mm/aaaa o aaaa-mm-dd) → YYYY-MM-DD. */
export function fechaDelLibro(v) {
  const s = String(v ?? "").trim();
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * La operación de saldo inicial de un proveedor: deuda al haber de
 * Proveedores contra Ajuste De Capital (o al revés si es saldo a favor).
 */
export function operacionSaldoInicial({ fecha, proveedor_id, nombre, deuda }, { cuentaProveedores, cuentaAjuste }) {
  const total = centavos(Math.abs(deuda));
  const clave = proveedor_id ? `p${proveedor_id}` : `e${claveNombre(nombre)}`;
  return {
    fecha, tipo: TIPO_SALDO_INICIAL,
    proveedor_id: proveedor_id || null, entidad: proveedor_id ? null : String(nombre || "").slice(0, 120),
    neto: total, iva: 0, otros_impuestos: 0, total, moneda: "ARS", tipo_cambio: null, total_ars: total,
    cuenta_debe: deuda > 0 ? cuentaAjuste : cuentaProveedores,
    cuenta_haber: deuda > 0 ? cuentaProveedores : cuentaAjuste,
    descripcion: `Saldo inicial al ${fecha.split("-").reverse().join("/")}, copiado del libro`,
    origen: ORIGEN_SALDO_INICIAL, origen_id: clave.slice(0, 60), estado: "confirmada",
  };
}
