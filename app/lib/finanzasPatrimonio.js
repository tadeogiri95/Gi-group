// app/lib/finanzasPatrimonio.js — etapa 6 de la auditoría de Finanzas
// integrada (14/11): Situación patrimonial, Posición de liquidez y Orígenes y
// aplicaciones de fondos. Sin migración: sale de fin_operaciones, como el
// Mayor (cada operación en sus renglones, todo en pesos, las anuladas no
// suman; las "para revisar" sí, igual que en el Mayor).
//
// El plan de cuentas del libro solo trae cuentas imputables (5 niveles), así
// que cada cuenta va al rubro de sus tres primeros niveles (01.01.02 =
// Créditos por ventas) con los nombres de RUBROS:
//   01.01 activo corriente · 01.02 activo no corriente
//   02.01 pasivo corriente · 02.02 pasivo no corriente
//   03 patrimonio neto · 04 en adelante, resultados
// Los resultados acumulados (ingresos − gastos de todo lo cargado) entran al
// patrimonio neto como "Resultado acumulado en Gypi", así el activo siempre
// es igual al pasivo más el patrimonio (partida doble).
import { renglonesEnPesos } from "./finanzasMayor";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Los fondos de Orígenes y aplicaciones: disponibilidades (caja, bancos, plazos fijos, valores a depositar). */
export const FONDOS = "01.01.01";
export const BIENES_DE_CAMBIO = "01.01.04";
export const INVERSIONES_CORTO = "01.01.05";

export const SECCIONES_PATRIMONIO = [
  { id: "AC", nombre: "Activo corriente", lado: "activo" },
  { id: "ANC", nombre: "Activo no corriente", lado: "activo" },
  { id: "PC", nombre: "Pasivo corriente", lado: "pasivo" },
  { id: "PNC", nombre: "Pasivo no corriente", lado: "pasivo" },
  { id: "PN", nombre: "Patrimonio neto", lado: "patrimonio" },
];

/** Nombre de cada rubro (tres primeros niveles del código). */
export const RUBROS = {
  "01.01.01": "Caja y bancos",
  "01.01.02": "Créditos por ventas",
  "01.01.03": "Otros créditos (impuestos a favor, anticipos)",
  "01.01.04": "Bienes de cambio (stock)",
  "01.01.05": "Inversiones temporarias",
  "01.01.06": "Activos biológicos",
  "01.02.01": "Inversiones a largo plazo",
  "01.02.02": "Bienes de uso",
  "01.02.03": "Activos intangibles",
  "01.02.04": "Obras en curso",
  "01.02.05": "Otros créditos a largo plazo",
  "01.02.06": "Activos biológicos no corrientes",
  "01.02.07": "Propiedades de inversión",
  "01.02.08": "Participaciones en sociedades",
  "01.02.09": "Otras inversiones en moneda extranjera",
  "02.01.01": "Deudas bancarias y financieras",
  "02.01.02": "Deudas comerciales (proveedores, anticipos de clientes)",
  "02.01.03": "Deudas sociales (sueldos y cargas)",
  "02.01.04": "Deudas fiscales y provisiones",
  "02.02.01": "Deudas bancarias a largo plazo",
  "02.02.02": "Deudas sociales a largo plazo",
  "02.02.03": "Deudas fiscales a largo plazo",
  "02.02.04": "Otras deudas en moneda extranjera",
  "03.01.01": "Capital y aportes",
  "03.02.01": "Reservas",
  "03.03.01": "Resultados de ejercicios anteriores",
};

/** Los tres primeros niveles del código. */
export const rubroDe = (codigo) => String(codigo || "").split(".").slice(0, 3).join(".");

/** Sección de una cuenta: AC, ANC, PC, PNC, PN o RES (resultados). */
export function seccionDe(codigo) {
  const c = String(codigo || "");
  if (c.startsWith("01.01")) return "AC";
  if (c.startsWith("01.")) return "ANC";
  if (c.startsWith("02.02")) return "PNC";
  if (c.startsWith("02.")) return "PC";
  if (c.startsWith("03")) return "PN";
  return "RES";
}

/**
 * Saldo de cada cuenta imputada (debe − haber, en pesos) hasta una fecha.
 * @returns {Map<string, number>}
 */
export function saldosHasta(ops = [], hasta = "", ctx = {}) {
  const out = new Map();
  for (const op of ops) {
    if (op.anulada_at || (hasta && String(op.fecha) > hasta)) continue;
    for (const r of renglonesEnPesos(op, ctx)) out.set(r.cuenta, (out.get(r.cuenta) || 0) + r.debe - r.haber);
  }
  return out;
}

/** Saldo por rubro y el resultado acumulado (ganancia positiva). */
function porRubro(saldos) {
  const rubros = new Map();
  let resultado = 0;
  for (const [cuenta, s] of saldos) {
    const sec = seccionDe(cuenta);
    if (sec === "RES") { resultado -= s; continue; }
    const k = rubroDe(cuenta);
    // Activo: debe − haber; pasivo y patrimonio: haber − debe
    rubros.set(k, (rubros.get(k) || 0) + (sec === "AC" || sec === "ANC" ? s : -s));
  }
  return { rubros, resultado: centavos(resultado) };
}

const nombreRubro = (k) => RUBROS[k] || `Otros (${k})`;

/**
 * La situación patrimonial a una fecha.
 * @param {Map<string, number>} saldos de saldosHasta
 * @returns {{ secciones: { id, nombre, total, rubros: { codigo, nombre, saldo }[] }[], activo, pasivo, patrimonio, resultado, cuadra: boolean, diferencia: number }}
 */
export function situacionPatrimonial(saldos) {
  const { rubros, resultado } = porRubro(saldos);
  const secciones = SECCIONES_PATRIMONIO.map((s) => {
    const lista = [...rubros]
      .filter(([k]) => seccionDe(k) === s.id)
      .map(([codigo, saldo]) => ({ codigo, nombre: nombreRubro(codigo), saldo: centavos(saldo) }))
      .filter((r) => Math.abs(r.saldo) >= 0.01)
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
    if (s.id === "PN" && Math.abs(resultado) >= 0.01) lista.push({ codigo: "RES", nombre: "Resultado acumulado en Gypi (ingresos − gastos)", saldo: resultado });
    return { id: s.id, nombre: s.nombre, lado: s.lado, rubros: lista, total: centavos(lista.reduce((t, r) => t + r.saldo, 0)) };
  });
  const tot = (ids) => centavos(secciones.filter((s) => ids.includes(s.id)).reduce((t, s) => t + s.total, 0));
  const activo = tot(["AC", "ANC"]);
  const pasivo = tot(["PC", "PNC"]);
  const patrimonio = tot(["PN"]);
  const diferencia = centavos(activo - pasivo - patrimonio);
  return { secciones, activo, pasivo, patrimonio, resultado, cuadra: Math.abs(diferencia) < 1, diferencia };
}

/** Un cociente o null si no se puede (sin pasivo corriente). */
const cociente = (a, b) => (b > 0.01 ? Math.round((a / b) * 100) / 100 : null);

/**
 * Posición de liquidez: con qué se pagan las deudas de corto plazo.
 * @param {ReturnType<typeof situacionPatrimonial>} sit
 */
export function posicionLiquidez(sit) {
  const sec = (id) => sit.secciones.find((s) => s.id === id);
  const rubro = (cod) => sec("AC").rubros.find((r) => r.codigo === cod)?.saldo || 0;
  const ac = sec("AC").total;
  const pc = sec("PC").total;
  const disponible = centavos(rubro(FONDOS) + rubro(INVERSIONES_CORTO));
  const stock = rubro(BIENES_DE_CAMBIO);
  return {
    activo_corriente: ac,
    pasivo_corriente: pc,
    disponible,
    stock,
    capital_trabajo: centavos(ac - pc),
    corriente: cociente(ac, pc),
    acida: cociente(ac - stock, pc),
    inmediata: cociente(disponible, pc),
    endeudamiento: sit.patrimonio > 0.01 ? Math.round((sit.pasivo / sit.patrimonio) * 100) / 100 : null,
  };
}

/** Cómo leer cada indicador (verde, amarillo o rojo). */
export function semaforo(id, valor) {
  if (valor === null || valor === undefined) return "gris";
  if (id === "endeudamiento") return valor <= 1 ? "verde" : valor <= 2 ? "amarillo" : "rojo";
  const [bien, justo] = { corriente: [1.5, 1], acida: [1, 0.7], inmediata: [0.5, 0.2] }[id] || [1, 0.5];
  return valor >= bien ? "verde" : valor >= justo ? "amarillo" : "rojo";
}

/**
 * Orígenes y aplicaciones de fondos entre dos fechas (fondos = caja y bancos).
 * De dónde salió la plata (orígenes) y en qué se usó (aplicaciones), por la
 * variación de cada rubro: un activo que baja o una deuda que sube es un
 * origen; un activo que sube o una deuda que baja es una aplicación. La
 * ganancia del período es un origen; la pérdida, una aplicación.
 * @param {Map<string, number>} inicio saldos al día anterior a "desde"
 * @param {Map<string, number>} fin saldos a "hasta"
 */
export function origenesAplicaciones(inicio, fin) {
  const a = porRubro(inicio);
  const b = porRubro(fin);
  const claves = [...new Set([...a.rubros.keys(), ...b.rubros.keys()])].sort();
  const origenes = [];
  const aplicaciones = [];
  const resultado = centavos(b.resultado - a.resultado);
  if (resultado > 0) origenes.push({ codigo: "RES", nombre: "Ganancia del período", importe: resultado });
  if (resultado < 0) aplicaciones.push({ codigo: "RES", nombre: "Pérdida del período", importe: -resultado });
  for (const k of claves) {
    if (k === FONDOS) continue;
    const sec = seccionDe(k);
    const delta = centavos((b.rubros.get(k) || 0) - (a.rubros.get(k) || 0));
    if (Math.abs(delta) < 0.01) continue;
    const activo = sec === "AC" || sec === "ANC";
    const nombre = nombreRubro(k);
    // Activo que baja o deuda/patrimonio que sube: entra plata
    if (activo ? delta < 0 : delta > 0) origenes.push({ codigo: k, nombre: `${nombre}: ${activo ? "bajó" : "subió"}`, importe: Math.abs(delta) });
    else aplicaciones.push({ codigo: k, nombre: `${nombre}: ${activo ? "subió" : "bajó"}`, importe: Math.abs(delta) });
  }
  const suma = (xs) => centavos(xs.reduce((t, x) => t + x.importe, 0));
  const fondosInicio = centavos(a.rubros.get(FONDOS) || 0);
  const fondosFin = centavos(b.rubros.get(FONDOS) || 0);
  const totalOrigenes = suma(origenes);
  const totalAplicaciones = suma(aplicaciones);
  const variacion = centavos(fondosFin - fondosInicio);
  const ord = (x, y) => y.importe - x.importe;
  return {
    fondos_inicio: fondosInicio, fondos_fin: fondosFin, variacion,
    origenes: origenes.sort(ord), aplicaciones: aplicaciones.sort(ord),
    total_origenes: totalOrigenes, total_aplicaciones: totalAplicaciones,
    cuadra: Math.abs(totalOrigenes - totalAplicaciones - variacion) < 1,
  };
}
