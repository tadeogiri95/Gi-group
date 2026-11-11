// app/lib/finanzasPlazosFijos.js — Finanzas, parte 8 del plan del 11/11:
// plazos fijos con el interés aparte e importados del Excel del banco sin
// repetir (/api/finanzas/plazos-fijos). Sin migración: la lista va en
// config_sistema ("finanzas_plazos_fijos").
//
// Como en el libro:
//   - Constitución: PLAZO FIJO, Debe la cuenta del plazo fijo / Haber el banco,
//     por lo depositado.
//   - Vencimiento (siempre vuelve a la cuenta): PLAZO FIJO, Debe el banco /
//     Haber la cuenta del plazo fijo, por lo depositado.
//   - El interés aparte: RENDIMIENTOS FINANCIEROS, Debe el banco / Haber
//     Intereses Ganados, por lo que se cobra de más, con la fecha del
//     vencimiento (se cuenta en el mes en que vence).
// Cada operación lleva origen "plazo_fijo" y origen_id pf<certificado>:c, :r
// o :i, así la base no deja cargar dos veces la misma. Lo que ya está cargado
// a mano o copiado del libro se reconoce por "Operacion: <certificado>" en la
// descripción (y el interés por el importe, cerca del vencimiento).
import { fechaExtracto, importeAr } from "./finanzasExtracto";
import { fechaDeSerie } from "./leerXls";

export const CLAVE_PLAZOS_FIJOS = "finanzas_plazos_fijos";
export const ORIGEN_PLAZO_FIJO = "plazo_fijo";
export const MAX_PLAZOS = 500;
const TIPO_PF = "PLAZO FIJO";
const TIPOS_PF_VIEJOS = { c: "CONSTITUCIÓN PLAZO FIJO", r: "RESCATE PLAZO FIJO" };
const TIPO_INTERES = "RENDIMIENTOS FINANCIEROS";
const TIPO_INTERES_VIEJO = "COBRO RENDIMIENTOS FINANCIEROS";
const INTERESES = /^intereses ganados$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const clave = (v) => txt(v, 300).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const dias = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
export const fechaPf = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");

function fecha(v) {
  const s = txt(v);
  if (/^\d{5}(\.\d+)?$/.test(s)) return fechaDeSerie(s);
  return fechaExtracto(s);
}

/** Solo los dígitos del certificado ("17415168"), o "" si no parece uno. */
export const certificadoDe = (v) => {
  const s = txt(v, 40).replace(/[\s.-]/g, "");
  return /^\d{4,20}$/.test(s) ? s : "";
};

/**
 * La planilla de plazos fijos vigentes que baja el banco (Credicoop: "Nro de
 * Certificado", "Monto Depositado", "Vencimiento", "Monto a reembolsar").
 * @param {string[][]} grilla
 * @returns {{ plazos: object[], exportado: string|null, avisos: string[], error?: string }}
 */
export function leerPlazosFijos(grilla = []) {
  const avisos = [];
  const filas = Array.isArray(grilla) ? grilla : [];
  let cab = -1;
  let c = null;
  for (let i = 0; i < Math.min(filas.length, 60) && cab < 0; i++) {
    const t = (filas[i] || []).map(clave);
    const col = (re) => t.findIndex((x) => re.test(x));
    const cert = col(/CERTIFICADO|N(RO|°|º)?\.? ?DE ?OPERACION|^OPERACION$/);
    const dep = col(/DEPOSITAD|CAPITAL|MONTO INICIAL|IMPORTE INICIAL/);
    const venc = col(/VENCIMIENTO|VENCE/);
    if (cert >= 0 && dep >= 0 && venc >= 0) {
      cab = i;
      c = { cert, dep, venc, reemb: col(/REEMBOLSAR|A COBRAR|MONTO FINAL|IMPORTE FINAL|TOTAL A/), interes: col(/INTERES/), tipo: col(/^TIPO/), moneda: col(/MONEDA/), alta: col(/CONSTITUCION|FECHA DE ALTA|^ALTA|^DESDE|FECHA DE INICIO/) };
    }
  }
  if (cab < 0) return { plazos: [], exportado: null, avisos, error: "No encontré las columnas de los plazos fijos (número de certificado, monto depositado y vencimiento). ¿Es la planilla de plazos fijos vigentes del banco?" };
  // La fecha en que se bajó la planilla (arriba de los títulos: "29/10/2026 - 12:50")
  let exportado = null;
  for (let i = 0; i < cab && !exportado; i++) for (const v of filas[i] || []) { const f = /\d{1,2}\/\d{1,2}\/\d{4}/.test(String(v)) ? fecha(v) : null; if (f) { exportado = f; break; } }
  const plazos = [];
  const vistos = new Set();
  for (let i = cab + 1; i < filas.length && plazos.length < MAX_PLAZOS; i++) {
    const f = filas[i] || [];
    const certificado = certificadoDe(f[c.cert]);
    if (!certificado) continue;
    if (vistos.has(certificado)) continue;
    const depositado = importeAr(f[c.dep]);
    const vencimiento = fecha(f[c.venc]);
    let reembolsar = c.reemb >= 0 ? importeAr(f[c.reemb]) : null;
    const interesCol = c.interes >= 0 ? importeAr(f[c.interes]) : null;
    if (reembolsar == null && interesCol != null && depositado != null) reembolsar = centavos(depositado + interesCol);
    if (!(depositado > 0) || !vencimiento || !(reembolsar > 0)) { avisos.push(`El certificado ${certificado} no tiene bien el monto o el vencimiento: no se tomó.`); continue; }
    if (reembolsar < depositado) { avisos.push(`El certificado ${certificado} devuelve menos de lo depositado: revisalo.`); }
    vistos.add(certificado);
    const moneda = /USD|DOLAR|U\$S/.test(clave(c.moneda >= 0 ? f[c.moneda] : "")) || /DOLAR/.test(clave(c.tipo >= 0 ? f[c.tipo] : "")) ? "USD" : "ARS";
    plazos.push({
      certificado, tipo: c.tipo >= 0 ? txt(f[c.tipo], 80) : "", moneda,
      depositado: centavos(depositado), reembolsar: centavos(reembolsar), interes: centavos(reembolsar - depositado),
      vencimiento, constituido: c.alta >= 0 ? fecha(f[c.alta]) : null,
    });
  }
  if (!plazos.length) return { plazos, exportado, avisos, error: "La planilla no tiene plazos fijos." };
  return { plazos, exportado, avisos };
}

/** Un plazo como llega del navegador → limpio, o null. */
export function plazoValido(p = {}) {
  const certificado = certificadoDe(p.certificado);
  const depositado = centavos(p.depositado);
  const reembolsar = centavos(p.reembolsar);
  if (!certificado || !(depositado > 0) || depositado >= 1e13 || !(reembolsar >= depositado) || reembolsar >= 1e13 || !FECHA.test(String(p.vencimiento || ""))) return null;
  return {
    certificado, tipo: txt(p.tipo, 80), moneda: p.moneda === "USD" ? "USD" : "ARS",
    depositado, reembolsar, interes: centavos(reembolsar - depositado),
    vencimiento: p.vencimiento, constituido: FECHA.test(String(p.constituido || "")) ? p.constituido : null,
  };
}

/** La lista guardada en config_sistema (vieja o rota → vacía). */
export function leerGuardados(valor) {
  const lista = Array.isArray(valor?.plazos) ? valor.plazos : [];
  return lista.map((p) => {
    const v = plazoValido(p);
    return v ? { ...v, banco: txt(p.banco, 40) || null, cuenta_pf: txt(p.cuenta_pf, 40) || null, importado: FECHA.test(String(p.importado || "")) ? p.importado : null } : null;
  }).filter(Boolean);
}

/** Junta lo guardado con lo nuevo por certificado: no se repite ninguno. Los más nuevos primero. */
export function unirPlazos(guardados = [], nuevos = []) {
  const por = new Map(guardados.map((p) => [p.certificado, p]));
  for (const n of nuevos) por.set(n.certificado, { ...(por.get(n.certificado) || {}), ...n });
  return [...por.values()].sort((a, b) => b.vencimiento.localeCompare(a.vencimiento) || a.certificado.localeCompare(b.certificado)).slice(0, MAX_PLAZOS);
}

/* ─── Cuentas y tipos ──────────────────────────────────────────────────── */

const PALABRAS_COMUNES = new Set(["PLAZO", "PLAZOS", "FIJO", "FIJOS", "BCO", "BANCO", "CTA", "CTE", "CC", "CA", "DE", "DEL", "LA", "EL", "PESOS", "ARS", "CUENTA", "CORRIENTE", "CAJA", "AHORRO", "COOP", "COOPERATIVO", "LTDO", "LTDA", "SA"]);
const palabras = (s) => new Set(String(s ?? "").slice(0, 20000).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 2 && !PALABRAS_COMUNES.has(w)));

/**
 * Las cuentas que se proponen: la cuenta de plazo fijo del banco que aparece en
 * el archivo (Credicoop…) y el banco en pesos que comparte el nombre.
 */
export function cuentasPorDefecto(tesoreria = [], pista = "") {
  const vivas = tesoreria.filter((t) => t.activa !== false && t.moneda !== "USD");
  const pfs = vivas.filter((t) => t.tipo === "plazo_fijo");
  const bancos = vivas.filter((t) => t.tipo === "banco");
  const enPista = palabras(pista);
  const comparte = (a, b) => [...palabras(a)].some((w) => b.has(w));
  const pf = pfs.find((t) => comparte(t.nombre, enPista)) || (pfs.length === 1 ? pfs[0] : null);
  const banco = pf ? bancos.find((t) => comparte(t.nombre, palabras(pf.nombre))) : bancos.find((t) => comparte(t.nombre, enPista));
  return { cuenta_pf: pf?.cuenta || "", banco: banco?.cuenta || (bancos.length === 1 ? bancos[0].cuenta : "") };
}

/**
 * Los tipos y cuentas para armar las operaciones.
 * @returns {{ ctx?: object, errores: string[] }}
 */
export function contextoPlazos({ tipos = [], cuentas = [], tesoreria = [], banco, cuenta_pf: cuentaPf }) {
  const errores = [];
  const vivo = (codigo) => tipos.find((t) => t.codigo === codigo && t.activo !== false);
  const b = tesoreria.find((t) => t.cuenta === banco && t.activa !== false && t.tipo !== "plazo_fijo");
  const pf = tesoreria.find((t) => t.cuenta === cuentaPf && t.activa !== false && t.tipo === "plazo_fijo");
  if (!b) errores.push("Elegí el banco de donde sale y adonde vuelve la plata");
  if (!pf) errores.push("Elegí la cuenta del plazo fijo");
  if (b && pf && b.cuenta === pf.cuenta) errores.push("El banco y la cuenta del plazo fijo tienen que ser distintos");
  const tipoC = vivo(TIPO_PF) ? TIPO_PF : vivo(TIPOS_PF_VIEJOS.c) ? TIPOS_PF_VIEJOS.c : null;
  const tipoR = vivo(TIPO_PF) ? TIPO_PF : vivo(TIPOS_PF_VIEJOS.r) ? TIPOS_PF_VIEJOS.r : null;
  const tipoI = vivo(TIPO_INTERES) || vivo(TIPO_INTERES_VIEJO) || null;
  if (!tipoC || !tipoR) errores.push("Falta el tipo de operación PLAZO FIJO: revisá la lista de tipos en Configuración");
  if (!tipoI) errores.push("Falta el tipo de operación RENDIMIENTOS FINANCIEROS: revisá la lista de tipos en Configuración");
  const existe = (codigo) => cuentas.some((c) => c.codigo === codigo && c.activa !== false);
  const cuentaInteres = tipoI && /^04/.test(String(tipoI.cuenta_haber || "")) && existe(tipoI.cuenta_haber)
    ? tipoI.cuenta_haber
    : cuentas.find((c) => c.activa !== false && INTERESES.test(txt(c.nombre)))?.codigo || null;
  if (!cuentaInteres) errores.push("Falta la cuenta Intereses Ganados en el plan de cuentas");
  if (errores.length) return { errores };
  return { errores, ctx: { banco: b.cuenta, nombre_banco: b.nombre, cuenta_pf: pf.cuenta, tipo_c: tipoC, tipo_r: tipoR, tipo_i: tipoI.codigo, cuenta_interes: cuentaInteres } };
}

/* ─── Qué ya está cargado ─────────────────────────────────────────────── */

/** ¿La descripción nombra el certificado (sin ser parte de otro número)? */
function tieneCert(op, cert) {
  const d = String(op.descripcion || "");
  for (let i = d.indexOf(cert); i >= 0; i = d.indexOf(cert, i + 1)) {
    if (!/\d/.test(d.charAt(i - 1)) && !/\d/.test(d.charAt(i + cert.length))) return true;
  }
  return false;
}
const esInteres = (op) => /RENDIMIENTOS FINANCIEROS/i.test(String(op.tipo || ""));

/**
 * Qué parte de cada plazo ya está en Gypi: la constitución, el vencimiento y el
 * interés (o null). Un interés del libro se reconoce por el importe (±1
 * centavo) hasta 3 días antes o después del vencimiento; cada operación sirve
 * para un solo plazo.
 * @returns {Map<string, { c: object|null, r: object|null, i: object|null }>}
 */
export function estadoDePlazos(plazos = [], ops = [], cuentasPf = []) {
  const pfs = new Set(cuentasPf);
  const vivas = ops.filter((o) => !o.anulada_at);
  const usadas = new Set();
  const out = new Map();
  for (const p of plazos) {
    const id = (paso) => `pf${p.certificado}:${paso}`;
    const buscar = (paso, cond) => vivas.find((o) => !usadas.has(o.id) && (o.origen === ORIGEN_PLAZO_FIJO ? o.origen_id === id(paso) : cond(o))) || null;
    const c = buscar("c", (o) => tieneCert(o, p.certificado) && pfs.has(o.cuenta_debe));
    if (c) usadas.add(c.id);
    const r = buscar("r", (o) => tieneCert(o, p.certificado) && pfs.has(o.cuenta_haber));
    if (r) usadas.add(r.id);
    const i = p.interes > 0
      ? buscar("i", (o) => esInteres(o) && (tieneCert(o, p.certificado) || (Math.abs(centavos(o.total) - p.interes) <= 0.011 && Math.abs(dias(o.fecha, p.vencimiento)) <= 3)))
      : null;
    if (i) usadas.add(i.id);
    out.set(p.certificado, { c, r, i });
  }
  return out;
}

/* ─── Las operaciones ─────────────────────────────────────────────────── */

/** La operación de un paso (c constitución, r vencimiento, i interés). */
export function operacionPlazo(p, paso, ctx, fechaAlta = null) {
  const vence = `vence ${fechaPf(p.vencimiento)}`;
  const base = {
    proveedor_id: null, entidad: txt(ctx.nombre_banco, 120) || null, iva: 0, otros_impuestos: 0, moneda: "ARS", tipo_cambio: null,
    referencia: p.certificado, origen: ORIGEN_PLAZO_FIJO, origen_id: `pf${p.certificado}:${paso}`, estado: "confirmada",
  };
  const op = (fecha, tipo, debe, haber, importe, descripcion) => ({ ...base, fecha, tipo, cuenta_debe: debe, cuenta_haber: haber, neto: importe, total: importe, total_ars: importe, descripcion });
  if (paso === "c") return op(fechaAlta, ctx.tipo_c, ctx.cuenta_pf, ctx.banco, p.depositado, `Constitución de plazo fijo · Operacion: ${p.certificado} · ${vence}`);
  if (paso === "r") return op(p.vencimiento, ctx.tipo_r, ctx.banco, ctx.cuenta_pf, p.depositado, `Vencimiento de plazo fijo · Operacion: ${p.certificado}`);
  return op(p.vencimiento, ctx.tipo_i, ctx.banco, ctx.cuenta_interes, p.interes, `Intereses del plazo fijo · Operacion: ${p.certificado}`);
}

/**
 * Qué falta cargar de cada plazo de la planilla.
 *   - Si no está la constitución, se propone con la fecha elegida (por
 *     defecto, la de alta de la planilla o el día en que se bajó).
 *   - Si ya venció, el vencimiento y el interés que falten.
 * Los que están en dólares no se cargan solos (se avisa).
 * @returns {{ filas: { plazo, estado: "nuevo"|"cargado"|"vencido"|"dolares", ops: object[], ya: string[] }[], ops: object[] }}
 */
export function planPlazosFijos({ plazos = [], ops = [], ctx, cuentasPf = [], hoy, fechas = {}, fechaPorDefecto = null, omitir = [] }) {
  const estado = estadoDePlazos(plazos, ops, cuentasPf.length ? cuentasPf : [ctx.cuenta_pf]);
  const saltear = new Set(omitir.map(String));
  const filas = plazos.map((p) => {
    const e = estado.get(p.certificado);
    const ya = ["c", "r", "i"].filter((k) => e[k]).map((k) => ({ c: "constitución", r: "vencimiento", i: "interés" })[k]);
    if (p.moneda === "USD") return { plazo: p, estado: "dolares", ops: [], ya };
    if (saltear.has(p.certificado)) return { plazo: p, estado: "omitido", ops: [], ya };
    const alta = FECHA.test(String(fechas[p.certificado] || "")) ? fechas[p.certificado] : p.constituido || fechaPorDefecto || hoy;
    const nuevas = [];
    if (!e.c) nuevas.push(operacionPlazo(p, "c", ctx, alta > p.vencimiento ? p.vencimiento : alta));
    if (p.vencimiento <= hoy) {
      if (!e.r) nuevas.push(operacionPlazo(p, "r", ctx));
      if (!e.i && p.interes > 0) nuevas.push(operacionPlazo(p, "i", ctx));
    }
    const est = !nuevas.length ? "cargado" : e.c ? "vencido" : "nuevo";
    return { plazo: p, estado: est, ops: nuevas, ya, fecha_alta: e.c ? e.c.fecha : alta };
  });
  return { filas, ops: filas.flatMap((f) => f.ops) };
}

/**
 * Los plazos guardados que ya vencieron, con la constitución en Gypi y sin el
 * vencimiento o el interés: se registran con un botón (siempre vuelven a la
 * cuenta).
 */
export function vencidosPendientes(guardados = [], ops = [], cuentasPf = [], hoy) {
  const estado = estadoDePlazos(guardados, ops, cuentasPf);
  return guardados.filter((p) => {
    const e = estado.get(p.certificado);
    return p.moneda !== "USD" && p.vencimiento <= hoy && e.c && (!e.r || (!e.i && p.interes > 0));
  }).map((p) => ({ ...p, falta: { r: !estado.get(p.certificado).r, i: !estado.get(p.certificado).i && p.interes > 0 } }));
}

/** Cómo está cada plazo guardado, para la lista: vigente, vencido sin registrar o terminado. */
export function listaPlazos(guardados = [], ops = [], cuentasPf = [], hoy) {
  const estado = estadoDePlazos(guardados, ops, cuentasPf);
  return guardados.map((p) => {
    const e = estado.get(p.certificado);
    let situacion = "vigente";
    if (!e.c) situacion = "sin_cargar";
    else if (p.vencimiento <= hoy) situacion = e.r && (e.i || !(p.interes > 0)) ? "terminado" : "vencido";
    return { ...p, situacion };
  });
}

/** Los intereses que van a entrar, para el flujo de caja (fecha = vencimiento). */
export function interesesPorCobrar(lista = [], hoy) {
  return lista
    .filter((p) => p.moneda !== "USD" && p.interes > 0 && (p.situacion === "vigente" || p.situacion === "vencido"))
    .map((p) => ({ fecha: p.vencimiento < hoy ? hoy : p.vencimiento, importe: p.interes, detalle: `Plazo fijo N° ${p.certificado} · vence ${fechaPf(p.vencimiento).slice(0, 5)}` }));
}

/** Las operaciones que hacen falta para saber qué está cargado (las de las cuentas de plazo fijo y los intereses de los últimos 2 años). */
export function pathOpsPlazos(empresaId, cuentasPf = [], hoy) {
  const desde = `${Number(hoy.slice(0, 4)) - 2}${hoy.slice(4)}`;
  const lista = cuentasPf.map((c) => `"${String(c).replace(/"/g, "")}"`).join(",");
  const or = [
    ...(lista ? [`cuenta_debe.in.(${lista})`, `cuenta_haber.in.(${lista})`] : []),
    `tipo.in.("${TIPO_INTERES}","${TIPO_INTERES_VIEJO}")`, `origen.eq.${ORIGEN_PLAZO_FIJO}`,
  ].join(",");
  return `fin_operaciones?empresa_id=eq.${empresaId}&anulada_at=is.null&fecha=gte.${desde}&or=(${encodeURIComponent(or)})&select=id,fecha,tipo,total,cuenta_debe,cuenta_haber,descripcion,origen,origen_id,anulada_at&order=fecha.asc,id.asc`;
}
