// app/lib/finanzasBanco.js — Finanzas, parte F5a: el extracto del banco
// contra lo que tiene Gypi (sin migración; los movimientos nuevos van a
// fin_operaciones con origen "banco").
//
//   1. Emparejar: cada renglón del extracto busca en Gypi una operación de esa
//      cuenta con el mismo importe (entrada o salida) y fecha cercana (hasta 7
//      días): el pago a un proveedor, el e-cheq debitado, el cobro por
//      transferencia. Lo que ya se cargó desde un extracto anterior se
//      reconoce por su marca (origen_id) y no se repite.
//   2. Sugerir: lo que falta sale con el tipo y la cuenta de enfrente que se
//      usaron antes para ese texto del banco. Se aprende del libro
//      (T-OPERACIONES, la descripción es el texto del extracto) y de lo que se
//      confirma acá. Si la transferencia trae CUIT, se sugiere lo que se usó
//      para ese CUIT (el proveedor, la caja de la persona, el sueldo…).
//   3. Confirmar: cada renglón elegido es una operación; el banco va al debe si
//      entra plata y al haber si sale.
import { claveNombre } from "./finanzasProveedores";

export const ORIGEN_BANCO = "banco";
export const CLAVE_REGLAS_BANCO = "finanzas_reglas_banco";
export const DIAS_EMPAREJAR = 7;
export const MAX_REGLAS = 600;
export const MAX_MOVIMIENTOS = 2000;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max = 300) => String(v ?? "").replace(/[−–]/g, "-").replace(/\s+/g, " ").trim().slice(0, max);
const sinAcentos = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const dias = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;

/** El CUIT que trae el texto del banco ("30717953866-FAC-…"), o null. */
export function cuitDe(descripcion) {
  const m = txt(descripcion).match(/(?:^|\D)((?:20|23|24|27|30|33|34)\d{9})(?:\D|$)/);
  return m ? m[1] : null;
}

/** El nombre que sigue al CUIT ("…-FAC-VINY INDUSTRIES S.A. CBU Destino…" → "VINY INDUSTRIES S.A."), o "". */
export function nombreDe(descripcion) {
  const m = txt(descripcion).match(/(?:20|23|24|27|30|33|34)\d{9}\s*-\s*[A-Z]{2,4}\s*-\s*(.+?)(?:\s+CBU\b.*)?$/i);
  return m ? txt(m[1], 120) : "";
}

/**
 * El texto del banco sin números ni datos de la persona, con las palabras
 * cortadas a 3 letras, para reconocer el mismo concepto aunque el resumen en
 * PDF y la descarga de Internet lo escriban un poco distinto:
 * "Impuesto Ley 25.413 Alic Gral s/Debitos" y "… Ali Gral …" → "IMP LEY ALI GRA DEB".
 */
export function claveTexto(descripcion) {
  let s = sinAcentos(txt(descripcion)).toUpperCase().replace(/\bI\.\s?V\.\s?A\.?/g, "IVA");
  // Lo que viene después del CUIT es de cada persona; CBU, operación y cuenta, también
  s = s.replace(/(?:20|23|24|27|30|33|34)\d{9}.*$/, "").replace(/\b(CBU|OPERACION|CUENTA|ENTE|TIPO DE PAGO)\b.*$/, (m, k) => (k === "ENTE" || k === "TIPO DE PAGO" ? m : ""));
  s = s.replace(/[^A-Z ]+/g, " ").replace(/\s+/g, " ").trim();
  return s.split(" ").filter((w) => w.length > 1).slice(0, 8).map((w) => w.slice(0, 3)).join(" ");
}

/** Clave de la regla: el sentido (entra / sale) y el texto o el CUIT. */
const claveRegla = (signo, k) => `${signo > 0 ? "+" : "-"}${k}`;

/** Suma un caso a las reglas: { clave: { tipo, contra, entidad, n } } guardando el más usado. */
function sumar(cuentaReglas, clave, caso, peso = 1) {
  const r = cuentaReglas[clave] || { casos: {} };
  const k = `${caso.tipo}|${caso.contra}|${caso.entidad || ""}`;
  r.casos[k] = (r.casos[k] || 0) + peso;
  cuentaReglas[clave] = r;
}

function resumir(cuentaReglas) {
  const out = {};
  for (const [clave, { casos }] of Object.entries(cuentaReglas)) {
    const [k, n] = Object.entries(casos).sort((a, b) => b[1] - a[1])[0];
    const [tipo, contra, entidad] = k.split("|");
    out[clave] = { tipo, contra, ...(entidad ? { entidad } : {}), n: Math.round(n * 10) / 10 };
  }
  return out;
}

/**
 * Las reglas de una cuenta de banco aprendidas del libro (hoja T-OPERACIONES,
 * con títulos en la primera fila).
 * @returns {{ reglas: object, usadas: number, error?: string }}
 */
export function reglasDelLibro(grilla, cuenta) {
  const titulos = (grilla?.[0] || []).map((t) => String(t || "").trim().toLowerCase());
  const col = (n) => titulos.indexOf(n);
  const c = { tipo: col("cod_tipo_op"), entidad: col("id_entidad"), desc: col("descripcion"), debe: col("cuenta_debe_final"), haber: col("cuenta_haber_final") };
  if ([c.tipo, c.desc, c.debe, c.haber].some((i) => i < 0)) {
    return { reglas: {}, usadas: 0, error: "La hoja T-OPERACIONES no tiene las columnas cod_tipo_op, descripcion, cuenta_debe_final y cuenta_haber_final." };
  }
  const acum = {};
  let usadas = 0;
  for (const f of grilla.slice(1)) {
    const debe = String(f?.[c.debe] || "").trim();
    const haber = String(f?.[c.haber] || "").trim();
    if (debe !== cuenta && haber !== cuenta) continue;
    const tipo = txt(f[c.tipo], 80);
    const desc = txt(f[c.desc]);
    if (!tipo || !desc) continue;
    const signo = debe === cuenta ? 1 : -1;
    const contra = signo > 0 ? haber : debe;
    if (!contra || contra === cuenta) continue;
    const entidad = c.entidad >= 0 ? txt(f[c.entidad], 120) : "";
    const k = claveTexto(desc);
    if (k) sumar(acum, claveRegla(signo, k), { tipo, contra });
    const cuit = cuitDe(desc);
    if (cuit) sumar(acum, claveRegla(signo, `#${cuit}`), { tipo, contra, entidad: entidad || nombreDe(desc) });
    usadas++;
  }
  return { reglas: recortar(resumir(acum)), usadas };
}

/** Deja las reglas más usadas, hasta MAX_REGLAS. */
function recortar(reglas) {
  const lista = Object.entries(reglas).sort((a, b) => b[1].n - a[1].n).slice(0, MAX_REGLAS);
  return Object.fromEntries(lista);
}

/** Junta dos juegos de reglas: lo nuevo pisa a lo viejo para la misma clave. */
export function juntarReglas(viejas = {}, nuevas = {}) {
  return recortar({ ...viejas, ...nuevas });
}

/** Las reglas que deja lo confirmado (cada renglón cuenta como un caso). */
export function reglasDeConfirmados(filas = []) {
  const acum = {};
  for (const f of filas) {
    if (!f?.tipo || !f?.contra) continue;
    const signo = f.importe > 0 ? 1 : -1;
    const k = claveTexto(f.descripcion);
    if (k) sumar(acum, claveRegla(signo, k), { tipo: f.tipo, contra: f.contra });
    const cuit = cuitDe(f.descripcion);
    if (cuit) sumar(acum, claveRegla(signo, `#${cuit}`), { tipo: f.tipo, contra: f.contra, entidad: f.entidad || nombreDe(f.descripcion) });
  }
  return resumir(acum);
}

/**
 * La sugerencia para un renglón del extracto: primero por CUIT, después por
 * texto. null si no hay nada parecido.
 * @returns {{ tipo: string, contra: string, entidad: string, por: "cuit"|"texto" } | null}
 */
export function sugerir(mov, reglas = {}) {
  const signo = mov.importe > 0 ? 1 : -1;
  const cuit = cuitDe(mov.descripcion);
  const nombre = nombreDe(mov.descripcion);
  const porCuit = cuit ? reglas[claveRegla(signo, `#${cuit}`)] : null;
  if (porCuit) return { tipo: porCuit.tipo, contra: porCuit.contra, entidad: porCuit.entidad || nombre, por: "cuit" };
  const k = claveTexto(mov.descripcion);
  const porTexto = k ? reglas[claveRegla(signo, k)] || parecida(reglas, signo, k) : null;
  if (porTexto) return { tipo: porTexto.tipo, contra: porTexto.contra, entidad: nombre, por: "texto" };
  return null;
}

/**
 * La regla de texto que empieza con más palabras iguales (al menos 1; con 1
 * sola palabra solo si todas las que empiezan así dicen lo mismo). Ej.:
 * "IVA DEB FIS" encuentra "IVA ALI INS".
 */
function parecida(reglas, signo, k) {
  const palabras = k.split(" ");
  const pref = signo > 0 ? "+" : "-";
  let mejor = { largo: 0, reglas: [] };
  for (const [clave, r] of Object.entries(reglas)) {
    if (clave[0] !== pref || clave[1] === "#") continue;
    const otras = clave.slice(1).split(" ");
    let n = 0;
    while (n < palabras.length && n < otras.length && palabras[n] === otras[n]) n++;
    if (n > mejor.largo) mejor = { largo: n, reglas: [r] };
    else if (n === mejor.largo && n > 0) mejor.reglas.push(r);
  }
  if (!mejor.largo) return null;
  const top = mejor.reglas.sort((a, b) => b.n - a.n)[0];
  if (mejor.largo === 1 && mejor.reglas.some((r) => r.tipo !== top.tipo || r.contra !== top.contra)) return null;
  return top;
}

/** Hash corto y estable (para que la marca entre en 60 letras). */
function hashCorto(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

/**
 * La marca de cada renglón (origen_id): cuenta, fecha, importe, comprobante y
 * el número de vez si se repite igual ese día. Subir el mismo extracto dos
 * veces da las mismas marcas.
 */
export function marcasExtracto(movimientos = [], cuenta) {
  const vistas = new Map();
  const c = hashCorto(cuenta);
  return movimientos.map((m) => {
    const base = `${c}:${m.fecha.replace(/-/g, "")}:${m.importe < 0 ? "s" : "e"}${Math.abs(Math.round(m.importe * 100))}:${hashCorto(`${m.comprobante || ""}|${claveTexto(m.descripcion)}`)}`;
    const n = (vistas.get(base) || 0) + 1;
    vistas.set(base, n);
    return `${base}:${n}`.slice(0, 60);
  });
}

/** Cuánto movió una operación la cuenta: + si la cuenta está al debe, - al haber (en pesos). */
export function movimientoEnCuenta(op, cuenta) {
  const t = Number(op.total_ars ?? op.total) || 0;
  if (op.cuenta_debe === cuenta) return centavos(t);
  if (op.cuenta_haber === cuenta) return centavos(-t);
  return 0;
}

/**
 * Empareja el extracto con las operaciones de Gypi de esa cuenta.
 * @param {object[]} movimientos del extracto
 * @param {object[]} operaciones de Gypi (vivas)
 * @param {string} cuenta código de la cuenta del banco
 * @returns {{ filas: object[], sin_banco: object[] }} cada fila = movimiento + { marca, op?: operación de Gypi, ya: true si vino de un extracto anterior }
 */
export function emparejarExtracto(movimientos = [], operaciones = [], cuenta) {
  const marcas = marcasExtracto(movimientos, cuenta);
  const deCuenta = operaciones.filter((o) => !o.anulada_at && (o.cuenta_debe === cuenta || o.cuenta_haber === cuenta));
  const usadas = new Set();
  const porMarca = new Map(deCuenta.filter((o) => o.origen === ORIGEN_BANCO && o.origen_id).map((o) => [o.origen_id, o]));
  const filas = movimientos.map((m, i) => ({ ...m, marca: marcas[i], op: null, ya: false }));
  // Primero lo que ya se cargó desde un extracto
  for (const f of filas) {
    const o = porMarca.get(f.marca);
    if (o) { f.op = o; f.ya = true; usadas.add(o.id); }
  }
  // Después por importe y fecha (la más cercana), sin repetir operación
  for (const f of filas) {
    if (f.op) continue;
    let mejor = null;
    for (const o of deCuenta) {
      if (usadas.has(o.id) || o.origen === ORIGEN_BANCO) continue;
      if (Math.abs(movimientoEnCuenta(o, cuenta) - f.importe) >= 0.01) continue;
      const d = dias(o.fecha, f.fecha);
      if (d > DIAS_EMPAREJAR) continue;
      if (!mejor || d < mejor.d) mejor = { o, d };
    }
    if (mejor) { f.op = mejor.o; usadas.add(mejor.o.id); }
  }
  // Lo de Gypi del mismo período que no apareció en el banco
  const fechas = movimientos.map((m) => m.fecha).sort();
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];
  const sinBanco = desde
    ? deCuenta.filter((o) => !usadas.has(o.id) && o.fecha >= desde && o.fecha <= hasta && o.origen !== "saldo_inicial")
    : [];
  return { filas, sin_banco: sinBanco };
}

/**
 * La operación de un renglón confirmado.
 * @param {{ fecha, descripcion, comprobante, importe, marca, tipo, contra, entidad?, proveedor_id?, cliente_id? }} f
 */
export function operacionDeMovimiento(f, cuenta) {
  const total = centavos(Math.abs(f.importe));
  const entra = f.importe > 0;
  return {
    fecha: f.fecha, tipo: txt(f.tipo, 80),
    proveedor_id: f.proveedor_id ? Number(f.proveedor_id) : null,
    cliente_id: f.cliente_id ? Number(f.cliente_id) : null,
    entidad: txt(f.entidad, 120) || null,
    neto: total, iva: 0, otros_impuestos: 0, total, moneda: "ARS", tipo_cambio: null, total_ars: total,
    cuenta_debe: entra ? cuenta : f.contra,
    cuenta_haber: entra ? f.contra : cuenta,
    descripcion: txt(f.descripcion, 500) || null,
    referencia: f.comprobante ? txt(f.comprobante, 120) : null,
    origen: ORIGEN_BANCO, origen_id: f.marca, estado: "confirmada",
  };
}

/** Saldo del extracto: el anterior más los movimientos, contra el final que dice el banco. */
export function controlSaldo({ movimientos = [], saldo_anterior = null, saldo_final = null }) {
  if (saldo_anterior == null || saldo_final == null) return null;
  const calculado = centavos(saldo_anterior + movimientos.reduce((s, m) => s + m.importe, 0));
  return { calculado, final: centavos(saldo_final), ok: Math.abs(calculado - saldo_final) < 0.01 };
}

/** Busca un proveedor o un cliente por el nombre de la regla o del texto del banco. */
export function entidadDe(nombre, { proveedores = [], clientes = [] } = {}) {
  const k = claveNombre(nombre);
  if (!k) return {};
  const p = proveedores.find((x) => claveNombre(x.nombre) === k);
  if (p) return { proveedor_id: Number(p.id), entidad: p.nombre };
  const c = clientes.find((x) => x.activo !== false && [x.nombre, ...(x.alias || [])].some((n) => claveNombre(n) === k));
  if (c) return { cliente_id: Number(c.id), entidad: c.nombre };
  return { entidad: txt(nombre, 120) };
}

/* ─── Cotejar el saldo y encontrar repetidos (12/11) ─────────────────── */

/** Cómo se llama cada origen en pantalla. */
export const NOMBRE_ORIGEN = {
  saldo_inicial: "Saldo inicial (apertura)", libro: "Copiadas del libro (histórico)", banco: "Cargadas del extracto",
  manual: "Cargadas a mano en Gypi", plazo_fijo: "Plazos fijos", fci: "FCI", titulos: "Títulos", mi_caja: "Mi caja",
  cheque: "Cheques", pago: "Pagos", orden_pago: "Órdenes de pago", cobro: "Cobros", pago_sueldo: "Sueldos", gasto: "Gastos",
};

/**
 * El saldo de la cuenta en Gypi hasta una fecha, y de dónde sale: cuánto
 * suma cada origen (apertura, histórico del libro, extracto, a mano…).
 * @returns {{ saldo: number, origenes: { origen: string, nombre: string, n: number, saldo: number }[] }}
 */
export function saldoPorOrigen(ops = [], cuenta, hasta) {
  const por = new Map();
  let saldo = 0;
  for (const o of ops) {
    if (o.anulada_at || (hasta && o.fecha > hasta)) continue;
    const m = movimientoEnCuenta(o, cuenta);
    if (!m) continue;
    saldo += m;
    const k = o.origen || "manual";
    const x = por.get(k) || { origen: k, nombre: NOMBRE_ORIGEN[k] || k, n: 0, saldo: 0 };
    x.n++;
    x.saldo += m;
    por.set(k, x);
  }
  return {
    saldo: centavos(saldo),
    origenes: [...por.values()].map((x) => ({ ...x, saldo: centavos(x.saldo) })).sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo)),
  };
}

/**
 * De qué origen conviene quedarse cuando hay dos iguales: la copiada del
 * libro (si se anula la de Gypi, el libro borra su renglón GY-F y quedan bien
 * los dos lados), después la del extracto, después la más vieja.
 */
const PREFERIDO = { libro: 0, banco: 1, saldo_inicial: 9 };

/**
 * Operaciones de la cuenta que parecen la misma cargada dos veces: el mismo
 * importe (al centavo, mismo sentido) y hasta `diasMax` días entre una y la
 * siguiente. En cada grupo se propone con cuál quedarse (PREFERIDO) y anular
 * las otras; el Dueño elige.
 * @returns {{ importe: number, ops: object[], queda: number }[]}
 */
export function repetidosEnCuenta(ops = [], cuenta, { diasMax = 3, max = 150 } = {}) {
  const porImporte = new Map();
  for (const o of ops) {
    if (o.anulada_at || o.origen === "saldo_inicial") continue;
    const m = movimientoEnCuenta(o, cuenta);
    if (!m) continue;
    const k = Math.round(m * 100);
    if (!porImporte.has(k)) porImporte.set(k, []);
    porImporte.get(k).push(o);
  }
  const grupos = [];
  for (const [k, lista] of porImporte) {
    if (lista.length < 2) continue;
    lista.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
    let actual = [lista[0]];
    const cerrar = () => {
      if (actual.length < 2) return;
      const queda = [...actual].sort((a, b) => (PREFERIDO[a.origen] ?? 5) - (PREFERIDO[b.origen] ?? 5) || a.id - b.id)[0];
      grupos.push({ importe: k / 100, ops: actual, queda: queda.id });
    };
    for (const o of lista.slice(1)) {
      if (dias(actual[actual.length - 1].fecha, o.fecha) <= diasMax) actual.push(o);
      else { cerrar(); actual = [o]; }
    }
    cerrar();
  }
  // Los más grandes primero: son los que más desarman el saldo
  return grupos.sort((a, b) => Math.abs(b.importe) * (b.ops.length - 1) - Math.abs(a.importe) * (a.ops.length - 1)).slice(0, max);
}

/**
 * Para cada renglón del banco que no está en Gypi, la operación de Gypi sin
 * pareja que más se le parece: mismo sentido, hasta 7 días y hasta un 20% de
 * diferencia en el importe. Suele ser la misma cargada con otra fecha o mal
 * el importe: "Dejar como dice el banco" la corrige. Cada una se usa una vez.
 */
export function parecidosEnGypi(filas = [], sinBanco = [], cuenta) {
  const usadas = new Set();
  const salida = new Map();
  for (const [i, f] of filas.entries()) {
    if (f.op) continue;
    let mejor = null;
    for (const o of sinBanco) {
      if (usadas.has(o.id)) continue;
      const m = movimientoEnCuenta(o, cuenta);
      if (!m || Math.sign(m) !== Math.sign(f.importe)) continue;
      const dif = Math.abs(Math.abs(m) - Math.abs(f.importe));
      if (dif > Math.abs(f.importe) * 0.2) continue;
      const d = dias(o.fecha, f.fecha);
      if (d > DIAS_EMPAREJAR) continue;
      const puntos = dif / Math.abs(f.importe) + d / 100;
      if (!mejor || puntos < mejor.puntos) mejor = { o, puntos };
    }
    if (mejor) { usadas.add(mejor.o.id); salida.set(i, mejor.o); }
  }
  return salida;
}
