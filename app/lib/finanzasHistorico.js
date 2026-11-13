// app/lib/finanzasHistorico.js — Finanzas: el histórico del libro en Gypi.
// Sin migración.
//
// Del libro (hoja T-OPERACIONES, renglones CONFIRMADO) se pasa a Gypi:
//   - La apertura: el saldo de cada cuenta de balance (activo, pasivo y
//     patrimonio) el día anterior a la fecha de inicio, contra Ajuste De
//     Capital. Las cajas y bancos van por caja, Proveedores por proveedor y
//     Deudores por Ventas por cliente. Reemplaza a los saldos iniciales de
//     antes (origen saldo_inicial; mismas claves que los botones de saldos
//     iniciales: t<cuenta>, p<id>/e<nombre>, c<id>/ce<nombre>, a<cuenta>).
//   - Cada renglón desde la fecha de inicio, tal cual (origen "libro"). Los
//     que vienen de Gypi (GY-F-n) no: ya están.
// Cada renglón se reconoce por su contenido (el libro no tiene un número
// único por renglón): si se vuelve a pasar, lo igual se saltea, lo nuevo se
// carga y lo que ya no está (se borró o se cambió en el libro) se anula.
// Lo que vino del libro no vuelve al libro.
//
// Decisión del Dueño (09/11): las compras contra Ajuste De Capital (de un
// proveedor) pasan a Proveedores, para ver la cuenta corriente completa. Los
// pagos que hicieron los socios se ajustan después con un asiento.
import { fechaDelLibro, claveNombre, emparejarProveedor, CUENTA_AJUSTE_CAPITAL, CUENTA_PROVEEDORES, TIPO_SALDO_INICIAL, ORIGEN_SALDO_INICIAL } from "./finanzasProveedores";
import { CUENTA_DEUDORES, emparejarCliente } from "./finanzasClientes";

export const ORIGEN_LIBRO = "libro";
/** La marca de las operaciones de Gypi en el libro: la misma que PREFIJO_OPERACION de finanzasLibro.js (ese archivo usa crypto: no va al navegador). */
export const PREFIJO_OPERACION = "GY-F-";
export const DESDE_HISTORICO = "2026-06-01";
export const LOTE_HISTORICO = 400;

/** Tipos de compra o gasto devengado: si van contra Ajuste De Capital y tienen proveedor, pasan a Proveedores. */
export const TIPOS_COMPRA = new Set([
  "COMPRA MP", "COSTOS INDIRECTOS DE FABRICACIÓN", "GASTOS DE ADMINISTRACIÓN", "GASTOS DE MANTENIMIENTO",
  "GASTOS DE COMERCIALIZACIÓN", "GASTOS DE LOGÍSTICA", "GASTOS FINANCIEROS", "OTROS GASTOS", "TRABAJO TERCERIZADO",
  "INVERSIONES EN MAQUINARIA Y HERRAMENTAL", "INVERSIONES EN INFRAESTRUCTURA", "TARJETA DE CRÉDITO",
  // Los mismos con los tipos nuevos (parte 2)
  "COMPRAS", "TRABAJOS TERCERIZADOS", "MAQUINARIA Y HERRAMIENTAS", "INFRAESTRUCTURA",
].map((t) => sinAcentos(t)));
const SIN_TIPO = "SIN TIPO";

function sinAcentos(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const numero = (v) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  // "1.234,56" (como lo escribe la planilla en castellano) o "1234.56"
  const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const diaAnterior = (f) => new Date(Date.parse(`${f}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** Hash corto y estable (dos FNV-1a de 32 bits) → 16 letras. */
function hash(s) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * Los renglones de T-OPERACIONES.
 * @param {string[][]} grilla la hoja, con títulos en la primera fila
 */
export function renglonesDelLibro(grilla) {
  const titulos = (grilla?.[0] || []).map((t) => String(t || "").trim().toLowerCase());
  const col = (n) => titulos.indexOf(n);
  const c = {
    fecha: col("fecha_operación"), tipo: col("cod_tipo_op"), entidad: col("id_entidad"), cc: col("centro_costo"),
    neto: col("importe_neto"), imp: titulos.findIndex((t) => t.startsWith("impuestos")), total: col("total"), moneda: col("moneda"),
    descripcion: col("descripcion"), ref: col("referencia_externa"), estado: col("estado"), debe: col("cuenta_debe_final"), haber: col("cuenta_haber_final"),
  };
  if ([c.fecha, c.total, c.debe, c.haber, c.estado].some((i) => i < 0)) {
    return { filas: [], error: "La hoja T-OPERACIONES no tiene las columnas fecha_operación, Total, estado, cuenta_debe_final y cuenta_haber_final." };
  }
  const filas = [];
  const vistas = new Map();
  (grilla || []).slice(1).forEach((f, i) => {
    if (String(f[c.estado] || "").trim().toUpperCase() !== "CONFIRMADO") return;
    const fecha = fechaDelLibro(f[c.fecha]);
    const total = centavos(numero(f[c.total]));
    const debe = String(f[c.debe] || "").trim();
    const haber = String(f[c.haber] || "").trim();
    if (!fecha || !total || !debe || !haber) return;
    const r = {
      fila: i + 2, fecha, total, debe, haber,
      tipo: c.tipo >= 0 ? txt(f[c.tipo], 80) : "",
      entidad: c.entidad >= 0 ? txt(f[c.entidad], 120) : "",
      centro_costo: c.cc >= 0 ? txt(f[c.cc], 60) : "",
      neto: c.neto >= 0 ? centavos(numero(f[c.neto])) : 0,
      impuestos: c.imp >= 0 ? centavos(numero(f[c.imp])) : 0,
      moneda: c.moneda >= 0 && String(f[c.moneda] || "").trim().toUpperCase() === "USD" ? "USD" : "ARS",
      descripcion: c.descripcion >= 0 ? txt(f[c.descripcion], 400) : "",
      ref: c.ref >= 0 ? txt(f[c.ref], 120) : "",
    };
    // La clave: el contenido del renglón y cuántas veces apareció igual. Sin
    // el tipo, que se puede reescribir con los tipos nuevos sin cambiar nada más.
    const base = hash([r.fecha, claveNombre(r.entidad), r.centro_costo, r.neto.toFixed(2), r.total.toFixed(2), r.moneda, r.debe, r.haber, r.descripcion].join("|"));
    const n = (vistas.get(base) || 0) + 1;
    vistas.set(base, n);
    r.clave = `L${base}${n > 1 ? `-${n}` : ""}`;
    filas.push(r);
  });
  return { filas };
}

const ORIGENES_HISTORICO = new Set([ORIGEN_LIBRO, ORIGEN_SALDO_INICIAL]);
const diasEntre = (a, b) => Math.abs(Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000));

/**
 * Saca de las operaciones por pasar las que ya están en Gypi con otro origen
 * en la misma caja (mismo lado, importe y hasta 3 días). Las otras
 * operaciones traen id, fecha, total, cuenta_debe y cuenta_haber.
 * @returns {{ nuevas: object[], yaEnGypi: number }}
 */
export function sinLoYaCargado(ops = [], otras = [], cajas = new Map()) {
  if (!otras.length) return { nuevas: ops, yaEnGypi: 0 };
  const lado = (o) => (cajas.has(o.cuenta_debe) ? `d${o.cuenta_debe}` : cajas.has(o.cuenta_haber) ? `h${o.cuenta_haber}` : null);
  const por = new Map();
  for (const x of otras) {
    for (const l of [cajas.has(x.cuenta_debe) ? `d${x.cuenta_debe}` : null, cajas.has(x.cuenta_haber) ? `h${x.cuenta_haber}` : null]) {
      if (!l) continue;
      const k = `${l}|${Math.round(Math.abs(Number(x.total) || 0) * 100)}`;
      if (!por.has(k)) por.set(k, []);
      por.get(k).push(x);
    }
  }
  const usadas = new Set();
  const nuevas = [];
  let yaEnGypi = 0;
  for (const o of ops) {
    const l = lado(o);
    let mejor = null;
    if (l) {
      for (const x of por.get(`${l}|${Math.round(o.total * 100)}`) || []) {
        if (usadas.has(x.id)) continue;
        const d = diasEntre(x.fecha, o.fecha);
        if (d <= 3 && (!mejor || d < mejor.d)) mejor = { x, d };
      }
    }
    if (mejor) { usadas.add(mejor.x.id); yaEnGypi++; } else nuevas.push(o);
  }
  return { nuevas, yaEnGypi };
}

const esDeBalance = (codigo) => /^0[123]\./.test(String(codigo || ""));
const esDeGypi = (ref) => String(ref || "").toUpperCase().startsWith(PREFIJO_OPERACION);

/**
 * Qué hay que hacer para dejar Gypi como el libro desde una fecha.
 * @param {{ grilla: string[][], desde: string, cuentas: object[], tesoreria: object[], proveedores: object[], clientes: object[], existentes: { id: number, origen: string, origen_id: string }[], otras?: object[], tc?: Record<string, number> }} d
 *   otras: las operaciones vivas de otros orígenes que tocan cajas y bancos (id, fecha, total, cuenta_debe, cuenta_haber, origen).
 *   tc: tipo de cambio por mes ("AAAA-MM") para las operaciones en dólares, y "apertura" para lo anterior.
 */
export function planHistorico({ grilla, desde = DESDE_HISTORICO, cuentas = [], tesoreria = [], proveedores = [], clientes = [], existentes = [], otras = [], tc = {} }) {
  const leido = renglonesDelLibro(grilla);
  if (leido.error) return { error: leido.error };
  const codigos = new Set(cuentas.map((c) => c.codigo));
  const ajuste = cuentas.find((c) => CUENTA_AJUSTE_CAPITAL.test(String(c.nombre || "").trim()))?.codigo;
  const cProv = cuentas.find((c) => CUENTA_PROVEEDORES.test(String(c.nombre || "").trim()))?.codigo;
  const cDeu = new Set(cuentas.filter((c) => CUENTA_DEUDORES.test(String(c.nombre || "").trim())).map((c) => c.codigo));
  const cuentasProv = new Set(cuentas.filter((c) => CUENTA_PROVEEDORES.test(String(c.nombre || "").trim())).map((c) => c.codigo));
  if (!ajuste || !cProv) return { error: "Faltan las cuentas \"Ajuste De Capital\" o \"Proveedores\" en el plan de cuentas: copiá el libro en Configuración." };
  const cajas = new Map(tesoreria.map((t) => [t.cuenta, t]));
  const fechaApertura = diaAnterior(desde);

  const faltanCuentas = new Set();
  const faltaTc = new Set();
  const tcDe = (clave) => { const n = Number(tc?.[clave]); return n > 0 ? n : null; };

  // ─── Apertura: saldo de cada cuenta de balance antes de "desde" ───
  const saldos = new Map(); // clave → { cuenta, moneda, saldo, proveedor_id, cliente_id, entidad, origen_id }
  const sumar = (cuenta, r, signo) => {
    if (!esDeBalance(cuenta) || cuenta === ajuste) return;
    const caja = cajas.get(cuenta);
    const enUsd = caja?.moneda === "USD";
    let importe;
    if (enUsd) importe = r.moneda === "USD" ? r.total : 0;
    else if (r.moneda === "USD") {
      const t = tcDe("apertura");
      if (!t) { faltaTc.add("apertura"); return; }
      importe = r.total * t;
    } else importe = r.total;
    if (!importe) return;
    let clave = `a${cuenta}`;
    const extra = {};
    if (caja) clave = `t${cuenta}`;
    else if (cuentasProv.has(cuenta) && r.entidad) {
      const p = emparejarProveedor(r.entidad, proveedores);
      clave = p ? `p${p.id}` : `e${claveNombre(r.entidad)}`;
      Object.assign(extra, p ? { proveedor_id: Number(p.id), entidad: null } : { entidad: r.entidad });
    } else if (cDeu.has(cuenta) && r.entidad) {
      const cl = emparejarCliente(r.entidad, clientes);
      clave = cl ? `c${cl.id}` : `ce${claveNombre(r.entidad)}`;
      Object.assign(extra, cl ? { cliente_id: Number(cl.id), entidad: cl.nombre } : { entidad: r.entidad });
    }
    const s = saldos.get(clave) || { cuenta, moneda: enUsd ? "USD" : "ARS", saldo: 0, origen_id: clave.slice(0, 60), proveedor_id: null, cliente_id: null, entidad: caja ? caja.nombre : null, ...extra };
    s.saldo += signo * importe;
    saldos.set(clave, s);
  };
  for (const r of leido.filas) {
    if (r.fecha >= desde) continue;
    sumar(r.debe, r, 1);
    sumar(r.haber, r, -1);
  }
  const tcApertura = tcDe("apertura");
  const apertura = [];
  for (const s of saldos.values()) {
    const total = centavos(Math.abs(s.saldo));
    if (total < 0.01) continue;
    if (!codigos.has(s.cuenta)) { faltanCuentas.add(s.cuenta); continue; }
    if (s.moneda === "USD" && !tcApertura) faltaTc.add("apertura");
    apertura.push({
      fecha: fechaApertura, tipo: TIPO_SALDO_INICIAL, proveedor_id: s.proveedor_id, cliente_id: s.cliente_id, entidad: s.entidad ? txt(s.entidad, 120) : null,
      neto: total, iva: 0, otros_impuestos: 0, total, moneda: s.moneda,
      tipo_cambio: s.moneda === "USD" ? tcApertura : null, total_ars: s.moneda === "USD" ? centavos(total * (tcApertura || 0)) : total,
      cuenta_debe: s.saldo > 0 ? s.cuenta : ajuste, cuenta_haber: s.saldo > 0 ? ajuste : s.cuenta,
      descripcion: `Saldo al ${fechaApertura.split("-").reverse().join("/")}, del libro`,
      origen: ORIGEN_SALDO_INICIAL, origen_id: s.origen_id, estado: "confirmada",
    });
  }

  // ─── Operaciones desde "desde" ───
  const operaciones = [];
  const convertidas = [];
  let deGypi = 0;
  let sinTipo = 0;
  for (const r of leido.filas) {
    if (r.fecha < desde) continue;
    if (esDeGypi(r.ref)) { deGypi++; continue; }
    // Un total negativo es el asiento al revés
    const alReves = r.total < 0;
    const debe = alReves ? r.haber : r.debe;
    let haber = alReves ? r.debe : r.haber;
    const total = Math.abs(r.total);
    let nota = "";
    if (haber === ajuste && r.entidad && TIPOS_COMPRA.has(sinAcentos(r.tipo)) && !cajas.has(debe)) {
      haber = cProv;
      nota = " (en el libro, contra Ajuste De Capital)";
    }
    for (const cta of [debe, haber]) if (!codigos.has(cta)) faltanCuentas.add(cta);
    const mes = r.fecha.slice(0, 7);
    const t = r.moneda === "USD" ? tcDe(mes) : null;
    if (r.moneda === "USD" && !t) faltaTc.add(mes);
    const tocaProv = cuentasProv.has(debe) || cuentasProv.has(haber);
    const tocaDeu = cDeu.has(debe) || cDeu.has(haber);
    const p = tocaProv && r.entidad ? emparejarProveedor(r.entidad, proveedores) : null;
    const cl = tocaDeu && r.entidad ? emparejarCliente(r.entidad, clientes) : null;
    if (!r.tipo) sinTipo++;
    const neto = Math.abs(r.neto) || centavos(total - Math.abs(r.impuestos));
    const op = {
      fecha: r.fecha, tipo: r.tipo || SIN_TIPO,
      proveedor_id: p ? Number(p.id) : null, cliente_id: cl ? Number(cl.id) : null,
      entidad: r.entidad || null, centro_costo: r.centro_costo || null,
      neto: centavos(Math.min(neto, total)), iva: 0, otros_impuestos: centavos(Math.max(0, total - neto)), total, moneda: r.moneda,
      tipo_cambio: t, total_ars: r.moneda === "USD" ? centavos(total * (t || 0)) : total,
      cuenta_debe: debe, cuenta_haber: haber,
      descripcion: txt(`${r.descripcion}${nota}`, 500) || null,
      referencia: `Libro, renglón ${r.fila}`,
      origen: ORIGEN_LIBRO, origen_id: r.clave, estado: "confirmada",
    };
    operaciones.push(op);
    if (nota) convertidas.push(op);
  }

  // ─── Qué ya está ───
  const vivas = new Map(existentes.filter((x) => x.origen === ORIGEN_LIBRO).map((x) => [x.origen_id, x]));
  const porPasar = operaciones.filter((o) => !vivas.has(o.origen_id));
  // 13/11: lo que ya entró a Gypi por otro lado (extracto, planilla de plazos
  // fijos, un pago o cobro de Gypi…) no se repite: misma caja, mismo lado,
  // mismo importe y hasta 3 días de diferencia (el más cercano, una vez cada uno).
  const { nuevas, yaEnGypi } = sinLoYaCargado(porPasar, otras.filter((x) => !ORIGENES_HISTORICO.has(x.origen)), cajas);
  const claves = new Set(operaciones.map((o) => o.origen_id));
  const anular = [
    // Del libro, que ya no están (borradas o cambiadas)
    ...existentes.filter((x) => x.origen === ORIGEN_LIBRO && !claves.has(x.origen_id)).map((x) => x.id),
    // Los saldos iniciales de antes: los reemplaza la apertura
    ...existentes.filter((x) => x.origen === ORIGEN_SALDO_INICIAL).map((x) => x.id),
  ];
  return {
    desde, fecha_apertura: fechaApertura,
    apertura, nuevas, anular,
    iguales: operaciones.length - porPasar.length,
    ya_en_gypi: yaEnGypi,
    total_libro: operaciones.length,
    de_gypi: deGypi,
    convertidas: convertidas.length,
    sin_tipo: sinTipo,
    falta_tc: [...faltaTc].sort(),
    faltan_cuentas: [...faltanCuentas].sort(),
    meses_usd: [...new Set(operaciones.filter((o) => o.moneda === "USD").map((o) => o.fecha.slice(0, 7)))].sort(),
    hay_usd_antes: leido.filas.some((r) => r.fecha < desde && r.moneda === "USD"),
  };
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? centavos(n) : NaN; };

/**
 * Lo que valida el servidor de cada operación que manda la pantalla.
 * @returns {{ fila?: object, error?: string }}
 */
export function limpiarOperacionHistorico(o, { codigos, proveedores, clientes }) {
  if (!o || typeof o !== "object") return { error: "Operación vacía" };
  if (!ORIGENES_HISTORICO.has(o.origen)) return { error: "Origen no permitido" };
  if (!FECHA.test(String(o.fecha || ""))) return { error: "Fecha inválida" };
  const origenId = String(o.origen_id || "");
  if (!origenId || origenId.length > 60) return { error: "Falta la clave del renglón" };
  if (!codigos.has(o.cuenta_debe) || !codigos.has(o.cuenta_haber)) return { error: `La cuenta ${codigos.has(o.cuenta_debe) ? o.cuenta_haber : o.cuenta_debe} no está en el plan de cuentas` };
  const moneda = o.moneda === "USD" ? "USD" : "ARS";
  const [total, neto, otros, totalArs] = [num(o.total), num(o.neto), num(o.otros_impuestos), num(o.total_ars)];
  if (![total, neto, otros, totalArs].every(Number.isFinite) || total <= 0 || Math.abs(total) >= 1e13 || Math.abs(totalArs) >= 1e13) return { error: "Importe inválido" };
  const tcambio = moneda === "USD" ? Number(o.tipo_cambio) : null;
  if (moneda === "USD" && !(tcambio > 0)) return { error: "Falta el tipo de cambio" };
  const proveedorId = o.proveedor_id && proveedores.has(Number(o.proveedor_id)) ? Number(o.proveedor_id) : null;
  const clienteId = o.cliente_id && clientes.has(Number(o.cliente_id)) ? Number(o.cliente_id) : null;
  return {
    fila: {
      fecha: o.fecha, tipo: txt(o.tipo, 80) || SIN_TIPO, proveedor_id: proveedorId, cliente_id: clienteId,
      entidad: txt(o.entidad, 120) || null, centro_costo: txt(o.centro_costo, 60) || null,
      neto, iva: 0, otros_impuestos: otros, total, moneda, tipo_cambio: tcambio, total_ars: totalArs,
      cuenta_debe: o.cuenta_debe, cuenta_haber: o.cuenta_haber,
      descripcion: txt(o.descripcion, 500) || null, referencia: txt(o.referencia, 120) || null,
      origen: o.origen, origen_id: origenId, estado: "confirmada",
    },
  };
}
