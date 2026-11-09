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

/* ─── Parte 3 del plan del 09/11: la cuenta de cada proveedor, compras sin
   factura y notas de crédito ───────────────────────────────────────────
   - La cuenta de cada proveedor (la del Estado de Resultados) se aprende de
     lo que ya se cargó (el histórico del libro incluido): la cuenta del debe
     que más se usó en sus compras. El dueño la confirma o la cambia, y queda
     en config_sistema ("finanzas_cuentas_proveedores"). La usan la compra
     automática de las facturas y la carga de compras a mano.
   - Compra sin factura (remito, ticket): la cuenta del proveedor al debe
     contra Proveedores, sin IVA, con "Sin factura" en la descripción.
   - Nota de crédito del proveedor: al revés (Proveedores al debe), con su
     IVA si lo tiene; resta de la deuda y del gasto. */

export const CLAVE_CUENTAS_PROV = "finanzas_cuentas_proveedores";
export const ORIGEN_COMPRA_MANUAL = "compra_manual";
export const TIPO_COMPRA = "COMPRAS";
export const CLASES_COMPRA = { sin_factura: "Compra sin factura", nota_credito: "Nota de crédito" };
const CODIGO = /^\d{2}(\.\d{2,3})+$/;

/** Lo guardado: { "p12": "04.02.01.001.003", … } (solo códigos válidos). */
export function leerCuentasProveedores(valor) {
  const c = valor?.cuentas && typeof valor.cuentas === "object" ? valor.cuentas : {};
  return Object.fromEntries(Object.entries(c).filter(([k, v]) => /^[pe][A-Z0-9]*\d*$/i.test(k) && k.length <= 80 && CODIGO.test(String(v))).slice(0, 5000));
}

/**
 * La cuenta que más usó cada proveedor en sus compras (el debe de lo que va
 * al haber de Proveedores), sin contar cajas, bancos ni las otras cuentas
 * que se pasen en excluir (Ajuste De Capital).
 * @returns {Map<string, { cuenta: string, veces: number, de: number, total: number }>}
 */
export function cuentasAprendidas(ops, cuentasProv, { excluir = new Set() } = {}) {
  const por = new Map();
  for (const op of ops || []) {
    if (op.anulada_at || !cuentasProv.has(op.cuenta_haber)) continue;
    const d = op.cuenta_debe;
    if (!d || cuentasProv.has(d) || excluir.has(d)) continue;
    const clave = claveDe(op);
    if (!clave) continue;
    const m = por.get(clave) || new Map();
    const x = m.get(d) || { cuenta: d, veces: 0, total: 0 };
    x.veces++;
    x.total += Number(op.total_ars) || 0;
    m.set(d, x);
    por.set(clave, m);
  }
  const out = new Map();
  for (const [clave, m] of por) {
    const lista = [...m.values()].sort((a, b) => b.veces - a.veces || b.total - a.total);
    out.set(clave, { cuenta: lista[0].cuenta, veces: lista[0].veces, de: lista.reduce((s, x) => s + x.veces, 0), total: centavos(lista[0].total) });
  }
  return out;
}

/** La cuenta de un proveedor: la elegida por el dueño, si no la aprendida, si no null. */
export function cuentaDeProveedor(clave, guardadas = {}, aprendidas = new Map()) {
  return guardadas[clave] || aprendidas.get(clave)?.cuenta || null;
}

/**
 * Valida una compra sin factura o una nota de crédito y arma la operación.
 * @param {{ clase, fecha, proveedor_id, importe, iva?, numero?, cuenta, descripcion? }} d importe = total (con IVA)
 * @param {{ cuentaProveedores: string, codigos: Set<string>, proveedores: Set<number>, ivaCredito?: string|null }} ctx
 * @returns {{ op?: object, error?: string }}
 */
export function operacionCompraManual(d, { cuentaProveedores, codigos, proveedores, ivaCredito = null }) {
  const clase = d?.clase;
  if (!CLASES_COMPRA[clase]) return { error: "Elegí si es una compra sin factura o una nota de crédito" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha || ""))) return { error: "Falta la fecha" };
  const proveedorId = Number(d.proveedor_id);
  if (!proveedores.has(proveedorId)) return { error: "Elegí un proveedor de la lista" };
  const total = centavos(d.importe);
  if (!(total > 0) || total >= 1e13) return { error: "El importe tiene que ser mayor a cero" };
  const iva = clase === "nota_credito" ? centavos(d.iva) : 0;
  if (iva < 0 || iva >= total) return { error: "El IVA tiene que ser menor que el total" };
  if (iva > 0 && !ivaCredito) return { error: "Falta la cuenta \"IVA Crédito Fiscal\" en el plan de cuentas" };
  const cuenta = String(d.cuenta || "");
  if (!codigos.has(cuenta)) return { error: "Elegí la cuenta del gasto (la del Estado de Resultados)" };
  if (cuenta === cuentaProveedores) return { error: "La cuenta del gasto no puede ser Proveedores" };
  const numero = String(d.numero || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const texto = String(d.descripcion || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const titulo = clase === "sin_factura" ? `Sin factura${numero ? ` (remito ${numero})` : ""}` : `Nota de crédito${numero ? ` N° ${numero}` : ""}`;
  const nc = clase === "nota_credito";
  return {
    op: {
      fecha: d.fecha, tipo: TIPO_COMPRA, proveedor_id: proveedorId, entidad: null,
      neto: centavos(total - iva), iva, otros_impuestos: 0, total, moneda: "ARS", tipo_cambio: null, total_ars: total,
      cuenta_debe: nc ? cuentaProveedores : cuenta, cuenta_haber: nc ? cuenta : cuentaProveedores,
      descripcion: [titulo, texto].filter(Boolean).join(" · "), referencia: numero || null,
      origen: ORIGEN_COMPRA_MANUAL, estado: "confirmada",
    },
  };
}
