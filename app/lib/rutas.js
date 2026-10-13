// app/lib/rutas.js — Ruta de etapas de cada división (Órdenes de Producción,
// parte 2; ítem 39). La ruta es la lista ordenada de códigos de etapa que usa
// una división (divisiones.ruta_etapas, migración 098). Sin ruta, la división
// usa todas las etapas, como antes.

/** "  MUEBLES " → "muebles"; "Herrería" → "herreria". */
export function normalizar(texto) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/**
 * La división que corresponde a un texto: el id (OT cargadas a mano, empleados),
 * la clave o el nombre ("MUEBLES" de la planilla). null si no coincide ninguna.
 */
export function buscarDivision(divisiones, valor) {
  const v = normalizar(valor);
  if (!v) return null;
  return (divisiones || []).find((d) =>
    normalizar(d.id) === v || normalizar(d.clave) === v || normalizar(d.label) === v
  ) || null;
}

/** Códigos de la ruta de una división, sin repetidos; [] si no tiene. */
export function rutaDe(division) {
  const ruta = Array.isArray(division?.ruta_etapas) ? division.ruta_etapas : [];
  return [...new Set(ruta.map(Number).filter((c) => Number.isInteger(c) && c > 0))];
}

/**
 * Etapas productivas que ve el operario. Si su división tiene ruta: solo esas,
 * en el orden de la ruta. Si no: todas, como antes.
 */
export function etapasParaOperario(etapas, divisiones, divisionEmpleado) {
  const productivas = (etapas || []).filter((e) => e.codigo > 0);
  const ruta = rutaDe(buscarDivision(divisiones, divisionEmpleado));
  if (!ruta.length) return productivas;
  const porCodigo = new Map(productivas.map((e) => [e.codigo, e]));
  const enRuta = ruta.map((c) => porCodigo.get(c)).filter(Boolean);
  return enRuta.length ? enRuta : productivas;
}

/**
 * ¿La OT pasa por esa etapa? Sí si su división no se reconoce o no tiene ruta
 * (no se esconde nada que antes se veía); si tiene ruta, solo si la etapa está.
 */
export function otPasaPorEtapa(proyecto, divisiones, codigoEtapa) {
  const ruta = rutaDe(buscarDivision(divisiones, proyecto?.division));
  return !ruta.length || ruta.includes(Number(codigoEtapa));
}
