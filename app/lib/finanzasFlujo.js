// app/lib/finanzasFlujo.js — Finanzas, parte F6b: el flujo de caja, como la
// hoja FLUJO_V2 del libro, y lo que viene (como PREVISIÓN CHEQUES). Sin
// migración: las líneas del flujo de cada tipo van en config_sistema
// ("finanzas_flujo"), copiadas de la hoja dim_flujo del libro.
//
//   - Lo real: cada operación confirmada mueve la caja según sus cuentas
//     (+ si la caja o el banco está al debe, − si está al haber; entre dos
//     cajas no mueve). Va a la línea de su tipo (dim_flujo, o la lista de
//     tipos nuevos de finanzasTipos.js: COBRO A CLIENTES → ING_TRANSF,
//     SUELDOS → EGR_SUELDOS…); un tipo viejo cuenta como su tipo nuevo.
//     Cobros y pagos a proveedores se abren por forma de pago.
//     Todo lo de Desarrollismo (inversiones por centro de costo, cobros por
//     ventas y aportes) va junto en "Inversiones Desarrollismo", abierto por
//     centro de costo. Las demás líneas se abren en las cuentas que las
//     componen (la cuenta de enfrente de la caja: Logística → Combustibles y
//     lubricantes, Movilidad…). Por mes, en pesos y en dólares por separado,
//     con la apertura (saldo antes del primer mes) y el cierre.
//   - Lo que viene, por semana: cheques de terceros a depositar (+), e-cheq
//     y cheques propios a debitar (−), órdenes de pago aprobadas o por
//     aprobar (−), sueldos confirmados sin pagar (−) e intereses de plazos
//     fijos al vencer (+, parte 8 del 11/11), desde el saldo de hoy.
import { LINEAS_RENOMBRADAS, MAPA_TIPOS, NOMBRE_FORMA, claveTipo, formaDePago, lineaDeLista } from "./finanzasTipos";
import { fechaDebito } from "./finanzasDiasHabiles";

export const CLAVE_FLUJO = "finanzas_flujo";
export const DESARROLLISMO = "INVERSIONES DESARROLLISMO";
/** La línea que junta todo lo de Desarrollismo. */
export const LINEA_DESARROLLISMO = "INV_DESARROLLISMO";
export const SEMANAS = 8;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const clave = (v) => txt(v, 200).toUpperCase();

/** Los nombres de las líneas del libro (FLUJO_V2). */
export const NOMBRES_LINEA = {
  ING_TRANSF: "Cobros por transferencia", ING_EFECTIVO: "Cobros en efectivo", ING_ECHEQ: "E-cheqs recibidos cobrados", ING_AJUSTE: "Ajustes de caja positivos",
  EGR_PROVEEDORES: "Pagos a proveedores (efectivo / transferencia)", EGR_ECHEQ: "E-cheqs emitidos pagados", EGR_SERVICIOS: "Servicios corrientes",
  EGR_SUELDOS: "Sueldos, aportes y cargas", EGR_ADMIN: "Gastos de administración", EGR_LOGISTICA: "Gastos de logística", EGR_MANTENIMIENTO: "Gastos de mantenimiento",
  EGR_BANCARIOS: "Gastos bancarios", EGR_COMERCIALIZACION: "Gastos de comercialización", EGR_HONORARIOS: "Honorarios", EGR_VIATICOS: "Viáticos",
  EGR_TERCERIZADOS: "Trabajos tercerizados", EGR_TARJETAS: "Tarjetas de crédito", EGR_OTROS: "Otros gastos", EGR_IMPUESTOS: "Impuestos y cargas fiscales", EGR_AJUSTE: "Ajustes de caja negativos",
  INV_DESARROLLISMO: "Inversiones Desarrollismo",
  "VTA_BS USO": "Venta de bienes de uso", INV_MAQUINARIA: "Maquinaria y herramental", INV_INFRA: "Infraestructura",
  ING_ALQUILERES: "Alquileres cobrados", ING_RENTA_FIN: "Renta financiera (intereses ganados)", ING_DESARR_VENTAS: "Cobros por ventas Desarrollismo",
  APORTES_SOCIOS: "Aportes de socios", ING_DESARR_APORTES: "Aportes Desarrollismo", DIVIDENDOS: "Pago de dividendos", EGR_FINANCIEROS: "Gastos financieros",
  TES_USD: "Compra y venta de dólares", TES_TITULOS: "Compra y venta de títulos", TES_APERTURA: "Apertura", TES_TRANSF_INTERNA: "Transferencias entre cajas", TES_MOV_INTERNO: "Depósitos, extracciones, plazos fijos y FCI",
  // Con los tipos nuevos (parte 2) estos renglones juntan todas las formas de pago
  ING_TRANSF: LINEAS_RENOMBRADAS.ING_TRANSF, ING_AJUSTE: LINEAS_RENOMBRADAS.ING_AJUSTE, EGR_PROVEEDORES: LINEAS_RENOMBRADAS.EGR_PROVEEDORES,
  EGR_BANCARIOS: LINEAS_RENOMBRADAS.EGR_BANCARIOS, EGR_FINANCIEROS: LINEAS_RENOMBRADAS.EGR_FINANCIEROS,
  "SIN CLASIFICAR": "⚠ Sin clasificar (el tipo no tiene línea)", "DESARR | SIN CC": "⚠ Desarrollismo sin centro de costo", "DESARR | CC NUEVA": "⚠ Desarrollismo con un centro de costo sin línea",
};

/** Las secciones del flujo, en orden. */
export const SECCIONES_FLUJO = [
  { id: "OPE", nombre: "Operativo" },
  { id: "INV", nombre: "Inversiones" },
  { id: "FIN", nombre: "Financiamiento" },
  { id: "TES", nombre: "Movimientos de tesorería (entre cuentas propias)" },
  { id: "SIN", nombre: "Sin clasificar" },
];

/** La sección de una línea del flujo. */
export function seccionFlujo(linea) {
  const l = clave(linea);
  if (l === "SIN CLASIFICAR" || l === "DESARR | SIN CC" || l === "DESARR | CC NUEVA") return "SIN";
  if (l.startsWith("TES_")) return "TES";
  if (["APORTES_SOCIOS", "ING_DESARR_APORTES", "DIVIDENDOS", "EGR_FINANCIEROS"].includes(l)) return "FIN";
  if (l.startsWith("INV_") || l.startsWith("DESARR") || ["VTA_BS USO", "ING_ALQUILERES", "ING_RENTA_FIN", "ING_DESARR_VENTAS"].includes(l)) return "INV";
  return "OPE";
}

export const nombreLinea = (linea) => NOMBRES_LINEA[clave(linea)] || (String(linea).startsWith("DESARR | ") ? String(linea).slice(9) : String(linea));

/**
 * dim_flujo → { tipos: { COD_TIPO: linea }, centros: { CC: linea }, avisos }.
 * Columnas cod_tipo_op / linea_flujo y, aparte, centro_costo / linea_flujo.
 */
export function flujoDeHoja(grilla) {
  const avisos = [];
  const tipos = {};
  const centros = {};
  const i = (grilla || []).slice(0, 20).findIndex((f) => (f || []).some((c) => txt(c).toLowerCase() === "cod_tipo_op"));
  if (i < 0) return { tipos, centros, avisos: ["No encontré los títulos de la hoja dim_flujo (la columna \"cod_tipo_op\")."] };
  const t = (grilla[i] || []).map((c) => txt(c).toLowerCase());
  const cTipo = t.indexOf("cod_tipo_op");
  const cLinea = t.indexOf("linea_flujo");
  const cCc = t.indexOf("centro_costo");
  const cLineaCc = cCc >= 0 ? t.indexOf("linea_flujo", cCc + 1) : -1;
  if (cLinea < 0) return { tipos, centros, avisos: ["La hoja dim_flujo no tiene la columna linea_flujo."] };
  for (const f of grilla.slice(i + 1)) {
    const tipo = txt(f?.[cTipo], 80);
    const linea = txt(f?.[cLinea], 60);
    if (tipo && linea && !linea.startsWith("(")) tipos[clave(tipo)] = linea.trim();
    if (cCc >= 0 && cLineaCc >= 0) {
      const cc = txt(f?.[cCc], 60);
      const lc = txt(f?.[cLineaCc], 60);
      if (cc && lc) centros[clave(cc)] = lc;
    }
  }
  if (!Object.keys(tipos).length) avisos.push("La hoja dim_flujo no tiene tipos con su línea.");
  return { tipos, centros, avisos };
}

/** Valida lo que se guarda (lo que viene del navegador). */
export function validarLineasFlujo(d = {}) {
  const limpio = (o, max) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).slice(0, max)
    .map(([k, v]) => [clave(k).slice(0, 80), txt(v, 60)]).filter(([k, v]) => k && v));
  return { tipos: limpio(d.tipos, 500), centros: limpio(d.centros, 500) };
}

/** Los renglones que se abren por forma de pago (efectivo, transferencia, cheque…). */
export const LINEAS_CON_FORMA = new Set(["ING_TRANSF", "EGR_PROVEEDORES"]);

/**
 * La línea del flujo de una operación. Un tipo viejo cuenta como el tipo
 * nuevo que lo reemplaza (aunque todavía no se haya pasado a los tipos
 * nuevos). Primero la línea copiada de dim_flujo; si no está, la de la lista.
 */
export function lineaDe(op, lineas = {}) {
  const nuevo = MAPA_TIPOS[claveTipo(op.tipo)];
  const tipo = clave(nuevo || op.tipo);
  if (tipo === DESARROLLISMO) {
    if (!op.centro_costo) return "DESARR | SIN CC";
    return lineas.centros?.[clave(op.centro_costo)] || "DESARR | CC NUEVA";
  }
  if (nuevo) return lineas.tipos?.[tipo] || lineaDeLista(nuevo) || "SIN CLASIFICAR";
  return lineas.tipos?.[tipo] || lineaDeLista(op.tipo) || "SIN CLASIFICAR";
}

/** ¿Es de Desarrollismo? (inversiones por centro de costo, cobros por ventas o aportes) */
export const esDeDesarrollismo = (linea) => {
  const l = clave(linea);
  return l.startsWith("DESARR") || l === "ING_DESARR_VENTAS" || l === "ING_DESARR_APORTES";
};

/** Debajo de "Inversiones Desarrollismo": { clave, nombre } del renglón de la operación. */
export function centroDesarrollismo(op, linea) {
  const l = clave(linea);
  if (l === "ING_DESARR_VENTAS" || l === "ING_DESARR_APORTES") return { clave: l, nombre: NOMBRES_LINEA[l] };
  if (l === "DESARR | SIN CC") return { clave: l, nombre: "⚠ Sin centro de costo" };
  if (l === "DESARR | CC NUEVA") return { clave: `CC|${clave(op.centro_costo)}`, nombre: `${txt(op.centro_costo, 60)} (⚠ sin línea en dim_flujo)` };
  return { clave: l, nombre: nombreLinea(linea) };
}

/** Cuánto mueve la caja una operación, por moneda: { ARS, USD }. */
export function deltaCaja(op, cajas) {
  // En pesos, el total en pesos; en dólares, el total de la operación
  const importe = { ARS: Number(op.total_ars ?? op.total) || 0, USD: Number(op.total) || 0 };
  const r = { ARS: 0, USD: 0 };
  for (const m of ["ARS", "USD"]) {
    const set = cajas[m];
    const d = (set.has(op.cuenta_debe) ? 1 : 0) - (set.has(op.cuenta_haber) ? 1 : 0);
    r[m] = centavos(importe[m] * d);
  }
  return r;
}

/** Las cuentas de caja y banco por moneda. */
export const cajasPorMoneda = (tesoreria = []) => ({
  ARS: new Set(tesoreria.filter((t) => t.moneda !== "USD").map((t) => t.cuenta)),
  USD: new Set(tesoreria.filter((t) => t.moneda === "USD").map((t) => t.cuenta)),
});

/**
 * El flujo real por mes.
 * @returns {{ meses, monedas: { ARS: { apertura, filas, neto, cierre }, USD: … }, sin_clasificar: number, tipos_sin_linea: string[] }}
 */
export function flujoReal({ ops = [], tesoreria = [], cuentas = [], lineas = {}, meses = [] }) {
  const cajas = cajasPorMoneda(tesoreria);
  const nombreCuenta = new Map(cuentas.map((c) => [c.codigo, c.nombre]));
  const idx = new Map(meses.map((m, i) => [m, i]));
  const primero = meses[0];
  const out = {};
  const sinLinea = new Set();
  for (const mon of ["ARS", "USD"]) out[mon] = { apertura: 0, porLinea: new Map(), porForma: new Map(), porDetalle: new Map() };
  for (const op of ops) {
    if (op.anulada_at || op.estado === "para_revisar") continue;
    const d = deltaCaja(op, cajas);
    if (!d.ARS && !d.USD) continue;
    const mes = String(op.fecha || "").slice(0, 7);
    for (const mon of ["ARS", "USD"]) {
      if (!d[mon]) continue;
      if (mes < primero) { out[mon].apertura += d[mon]; continue; }
      const i = idx.get(mes);
      if (i == null) continue;
      const original = lineaDe(op, lineas);
      if (seccionFlujo(original) === "SIN") sinLinea.add(String(op.tipo));
      const desarr = esDeDesarrollismo(original);
      const linea = desarr ? LINEA_DESARROLLISMO : original;
      const l = out[mon].porLinea.get(linea) || meses.map(() => 0);
      l[i] += d[mon];
      out[mon].porLinea.set(linea, l);
      if (LINEAS_CON_FORMA.has(linea)) {
        const formas = out[mon].porForma.get(linea) || new Map();
        const forma = formaDePago(op, { tesoreria, cuentas });
        const v = formas.get(forma) || meses.map(() => 0);
        v[i] += d[mon];
        formas.set(forma, v);
        out[mon].porForma.set(linea, formas);
      } else {
        // Debajo de la línea: el centro de costo (Desarrollismo) o la cuenta de enfrente de la caja
        let det;
        if (desarr) det = { ...centroDesarrollismo(op, original), tipo: "centro" };
        else {
          const contra = cajas[mon].has(op.cuenta_debe) ? op.cuenta_haber : op.cuenta_debe;
          det = { clave: String(contra || ""), nombre: nombreCuenta.get(contra) || contra || "Sin cuenta", tipo: "cuenta" };
        }
        const detalles = out[mon].porDetalle.get(linea) || new Map();
        const x = detalles.get(det.clave) || { ...det, valores: meses.map(() => 0) };
        x.valores[i] += d[mon];
        detalles.set(det.clave, x);
        out[mon].porDetalle.set(linea, detalles);
      }
    }
  }
  const monedas = {};
  for (const mon of ["ARS", "USD"]) {
    const filas = [];
    const neto = meses.map(() => 0);
    for (const sec of SECCIONES_FLUJO) {
      const ls = [...out[mon].porLinea.entries()].filter(([l]) => seccionFlujo(l) === sec.id).sort(([a], [b]) => {
        const orden = Object.keys(NOMBRES_LINEA);
        const ia = orden.indexOf(clave(a)); const ib = orden.indexOf(clave(b));
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
      });
      if (!ls.length) continue;
      const t = meses.map((_, i) => ls.reduce((s, [, v]) => s + v[i], 0));
      t.forEach((v, i) => { neto[i] += v; });
      filas.push({ tipo: "seccion", id: sec.id, nombre: sec.nombre, valores: t.map(centavos), total: centavos(t.reduce((s, v) => s + v, 0)) });
      for (const [l, v] of ls) {
        filas.push({ tipo: "linea", id: `${sec.id}|${l}`, seccion: sec.id, linea: l, nombre: nombreLinea(l), valores: v.map(centavos), total: centavos(v.reduce((s, x) => s + x, 0)) });
        // Abierto por forma de pago, si hay más de una
        const formas = [...(out[mon].porForma.get(l) || new Map()).entries()];
        if (formas.length > 1) {
          formas.sort(([a], [b]) => Object.keys(NOMBRE_FORMA).indexOf(a) - Object.keys(NOMBRE_FORMA).indexOf(b));
          for (const [f, fv] of formas) filas.push({ tipo: "forma", id: `${sec.id}|${l}|${f}`, seccion: sec.id, linea: l, forma: f, nombre: NOMBRE_FORMA[f] || f, valores: fv.map(centavos), total: centavos(fv.reduce((s, x) => s + x, 0)) });
        }
        // Abierto por centro de costo o por cuenta, de mayor a menor
        const detalles = [...(out[mon].porDetalle.get(l) || new Map()).values()]
          .map((x) => ({ ...x, total: centavos(x.valores.reduce((s, v) => s + v, 0)) }))
          .sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.nombre.localeCompare(b.nombre));
        for (const x of detalles) filas.push({ tipo: x.tipo, id: `${sec.id}|${l}|${x.clave}`, seccion: sec.id, linea: l, nombre: x.nombre, valores: x.valores.map(centavos), total: x.total });
      }
    }
    const apertura = centavos(out[mon].apertura);
    const cierre = [];
    let s = apertura;
    for (const v of neto) { s += v; cierre.push(centavos(s)); }
    monedas[mon] = { apertura, filas, neto: neto.map(centavos), cierre, hay: filas.length > 0 || Math.abs(apertura) >= 0.01 };
  }
  return { meses, monedas, tipos_sin_linea: [...sinLinea].sort() };
}

/** El lunes de la semana de una fecha (AAAA-MM-DD). */
export function lunesDe(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia);
  return d.toISOString().slice(0, 10);
}
const sumarDias = (fecha, n) => { const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const dm = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "");

/**
 * Lo que viene, por semana desde hoy (lo vencido va en la primera).
 * @param {{ hoy, saldoHoy, cheques, ordenes, sueldos: { fecha, importe, detalle }[] }} d
 */
export function flujoPrevisto({ hoy, saldoHoy = 0, cheques = [], ordenes = [], sueldos = [], intereses = [], semanas = SEMANAS, feriados = null }) {
  const inicio = lunesDe(hoy);
  const cols = Array.from({ length: semanas }, (_, i) => sumarDias(inicio, i * 7));
  const col = (fecha) => {
    if (!fecha || fecha < cols[0]) return 0;
    const i = Math.floor((Date.parse(`${fecha}T12:00:00Z`) - Date.parse(`${cols[0]}T12:00:00Z`)) / (7 * 86400000));
    return i < semanas ? i : null;
  };
  const filas = [
    { id: "cheques_terceros", nombre: "Cheques de terceros a acreditar", signo: 1 },
    { id: "cheques_propios", nombre: "E-cheq y cheques propios a debitar", signo: -1 },
    { id: "ordenes", nombre: "Órdenes de pago aprobadas o por aprobar", signo: -1 },
    { id: "sueldos", nombre: "Sueldos por pagar", signo: -1 },
    { id: "intereses", nombre: "Intereses de plazos fijos", signo: 1 },
  ].map((f) => ({ ...f, valores: cols.map(() => 0), detalle: cols.map(() => []), despues: 0 }));
  const por = Object.fromEntries(filas.map((f) => [f.id, f]));
  const poner = (id, fecha, importe, texto) => {
    const f = por[id];
    const i = col(fecha);
    const v = centavos(importe) * f.signo;
    if (i == null) { f.despues += v; return; }
    f.valores[i] += v;
    f.detalle[i].push({ fecha, importe: v, texto });
  };
  for (const ch of cheques) {
    // La plata se mueve el día hábil siguiente al depósito (finanzasDiasHabiles.js)
    const mueve = fechaDebito(ch.fecha_pago, feriados) || ch.fecha_pago;
    const vence = ` · vence ${dm(ch.fecha_pago)}`;
    if (ch.clase === "tercero" && ch.estado === "en_cartera") poner("cheques_terceros", mueve < hoy ? hoy : mueve, ch.importe, `${ch.banco || "Cheque"}${ch.numero ? ` N° ${ch.numero}` : ""}${ch.librador ? ` · ${ch.librador}` : ""}${vence}`);
    if (ch.clase === "propio" && ch.estado === "pendiente") poner("cheques_propios", mueve < hoy ? hoy : mueve, ch.importe, `${ch.beneficiario || "E-cheq"}${ch.numero ? ` N° ${ch.numero}` : ""}${vence}`);
  }
  for (const o of ordenes) {
    if (["aprobada", "para_aprobar"].includes(o.estado)) poner("ordenes", o.fecha < hoy ? hoy : o.fecha, o.total, `OP N° ${o.numero} · ${o.proveedor_nombre}${o.estado === "para_aprobar" ? " (por aprobar)" : ""}`);
  }
  for (const s of sueldos) if (s.importe > 0) poner("sueldos", s.fecha < hoy ? hoy : s.fecha, s.importe, s.detalle);
  // El interés entra el día que vence el plazo fijo (lo depositado vuelve al banco y no cambia el saldo)
  for (const x of intereses) if (x.importe > 0) poner("intereses", x.fecha < hoy ? hoy : x.fecha, x.importe, x.detalle);
  const neto = cols.map((_, i) => filas.reduce((s, f) => s + f.valores[i], 0));
  const saldo = [];
  let s = Number(saldoHoy) || 0;
  for (const v of neto) { s += v; saldo.push(centavos(s)); }
  return {
    semanas: cols, saldo_hoy: centavos(saldoHoy),
    filas: filas.map((f) => ({ ...f, valores: f.valores.map(centavos), despues: centavos(f.despues) })),
    neto: neto.map(centavos), saldo,
    despues: centavos(filas.reduce((x, f) => x + f.despues, 0)),
  };
}

/** El saldo de hoy de las cajas y bancos en pesos (todas las operaciones confirmadas). */
export function saldoCajas(ops = [], tesoreria = [], moneda = "ARS") {
  const cajas = cajasPorMoneda(tesoreria);
  return centavos(ops.reduce((s, op) => (op.anulada_at || op.estado === "para_revisar" ? s : s + deltaCaja(op, cajas)[moneda]), 0));
}
