// app/lib/costoHoraDesglose.js — La hora de trabajo desglosada (auditoría del
// 12/11, parte 10; Tadeo: "una para toda la empresa, desglosada en Mano de
// obra, Costo Burden y GAC"). Sin migración.
//
// El costo de la hora sigue siendo uno (costos_empresa.costo_hora, el que usan
// todos los cálculos): ahora es la suma de las tres partes. Las partes se
// guardan en config_sistema (costo_hora_desglose) para mostrarlas y repartir
// la mano de obra de cada OT.

export const CLAVE_DESGLOSE = "costo_hora_desglose";

/** Las tres partes de la hora, en el orden en que se cargan. */
export const PARTES_HORA = [
  { id: "mano_obra", nombre: "Mano de obra", ayuda: "Sueldo y cargas sociales de quien trabaja" },
  { id: "burden", nombre: "Costo Burden", ayuda: "Lo indirecto de la planta: supervisión, energía, mantenimiento, amortización" },
  { id: "gac", nombre: "GAC", ayuda: "Gastos de administración y comercialización que se reparten por hora" },
];

const MAX = 99999999;
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const valido = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX;

/**
 * Lo guardado en config_sistema → { mano_obra, burden, gac } o null si no hay
 * nada que sirva.
 */
export function leerDesglose(valor) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const out = {};
  for (const p of PARTES_HORA) {
    const n = Number(valor[p.id]);
    if (!valido(n)) return null;
    out[p.id] = centavos(n);
  }
  return out;
}

/** La hora completa: la suma de las tres partes. */
export const totalDesglose = (d) => centavos(PARTES_HORA.reduce((s, p) => s + (Number(d?.[p.id]) || 0), 0));

/**
 * Las partes para mostrar: lo guardado, o (si solo había un costo de la hora
 * cargado antes) todo como Mano de obra, así la suma da lo mismo que antes.
 */
export function desgloseParaEditar(valor, costoHora) {
  const d = leerDesglose(valor);
  if (d) return d;
  const ch = Number(costoHora);
  return { mano_obra: Number.isFinite(ch) && ch > 0 ? centavos(ch) : 0, burden: 0, gac: 0 };
}

/**
 * Reparte un importe de mano de obra entre las tres partes, en proporción a
 * la hora. El último se queda con el redondeo para que la suma dé justo.
 * @returns {{ id: string, nombre: string, importe: number }[]} vacío si no hay desglose
 */
export function repartirHora(importe, desglose) {
  const total = totalDesglose(desglose);
  const imp = Number(importe);
  if (!(total > 0) || !Number.isFinite(imp)) return [];
  let resto = centavos(imp);
  return PARTES_HORA.map((p, i) => {
    const parte = i === PARTES_HORA.length - 1 ? resto : centavos((imp * (Number(desglose[p.id]) || 0)) / total);
    resto = centavos(resto - parte);
    return { id: p.id, nombre: p.nombre, importe: parte };
  });
}
