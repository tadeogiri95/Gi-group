// app/lib/costo.js — Costo de mano de obra (Órdenes de Producción, parte 8;
// ítem 39). Un solo costo por hora para toda la empresa (lo carga el dueño)
// por las horas que ya se registran. La instalación es un servicio, no
// producción: sus horas se ven aparte de las de fábrica.

/** Etapa de instalación: la que se llama "Instalación" (o "Instalar", "Instalaciones"...). */
export function esEtapaDeInstalacion(etapa) {
  const n = String(etapa?.nombre || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return n.includes("instal");
}

/** Pesos de los minutos a un costo por hora. */
export function costoDe(min, costoHora) {
  return ((Number(min) || 0) / 60) * (Number(costoHora) || 0);
}

/**
 * Costo de una OT a partir del resumen del detalle (resumirOp).
 * @param {{ etapas: { nombre: string, min: number }[], paradaMin?: number }} resumen
 * @param {number|null} costoHora
 * @returns null si no hay costo cargado; si no, minutos y pesos de fábrica,
 *   paradas e instalación, y el total.
 */
export function costoOp(resumen, costoHora) {
  if (!(Number(costoHora) > 0) || !resumen) return null;
  let fabricaMin = 0;
  let instalacionMin = 0;
  for (const e of resumen.etapas || []) {
    if (esEtapaDeInstalacion(e)) instalacionMin += Number(e.min) || 0;
    else fabricaMin += Number(e.min) || 0;
  }
  const paradaMin = Number(resumen.paradaMin) || 0;
  const fabrica = costoDe(fabricaMin, costoHora);
  const paradas = costoDe(paradaMin, costoHora);
  const instalacion = costoDe(instalacionMin, costoHora);
  return { fabricaMin, paradaMin, instalacionMin, fabrica, paradas, instalacion, total: fabrica + paradas + instalacion };
}

/** 12345.6 → "$ 12.346" (pesos redondeados, con punto de miles). */
export function fmtPesos(n) {
  const v = Math.round(Number(n) || 0);
  return `$ ${v.toLocaleString("es-AR")}`;
}
