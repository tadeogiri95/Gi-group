// app/lib/cantoLados.js — Qué canto se pegó en cada escaneo (pedido de
// Tadeo, 27/11; migración 214). Sigue al canto por lados (209) y al consumo
// de canto (210).
//
// Una pieza puede llevar cantos distintos: por ejemplo 2 lados L2 con canto
// de 2 mm y 1 lado L1 con 0,45. En la máquina se pega un canto a la vez, así
// que el operario elige en Escanear piezas el canto que tiene puesto ("2 mm
// GRAFITO") y cada escaneo es un lado de ESE canto:
//   - con el código del renglón (el mismo para las 5 unidades), el escaneo va
//     a la primera unidad que todavía tiene un lado pendiente de ese canto.
//     10 escaneos de 2 mm = 5 piezas con los dos lados de 2 mm pegados y el
//     de 0,45 pendiente (no 3 completas y 1 empezada);
//   - si la pieza no tiene lados pendientes de ese canto, se pregunta;
//   - si no se eligió canto y la pieza lleva uno solo, no se pregunta.
// Cada escaneo guarda el lado (l1a…l2b) y el tipo ("2|GRAFITO"). Los
// escaneos viejos, sin lado, se cuentan en el orden de la planilla.

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** ¿Falta la migración 214 (lados_pieza.lado y canto)? */
export const falta214 = (err) => /\blado\b|\bcanto\b/.test(String(err?.message)) && /column|42703|PGRST204/i.test(String(err?.message));

/** Tipo de canto de un lado de la pieza: "2|GRAFITO" (espesor y color). */
export const tipoCanto = (c) => `${Number(c?.e)}|${norm(c?.c)}`;

/** "0.45|GRAFITO" → "0,45 mm GRAFITO". */
export function textoTipoCanto(tipo) {
  const [e, color] = String(tipo ?? "").split("|");
  const n = Number(e);
  const esp = Number.isFinite(n) && n > 0 ? `${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })} mm` : "";
  return [esp, color].filter(Boolean).join(" ") || "sin dato";
}

/** "l2a" → "L2 A". */
export const textoLado = (l) => (/^l[12][ab]$/.test(String(l)) ? `L${l[1]} ${l[2].toUpperCase()}` : String(l ?? ""));

/**
 * ¿La pieza sabe qué canto lleva cada lado? Sí si la planilla trajo el canto
 * de todos sus lados (piezas_ot.cantos, 210). Si falta alguno (espesor que no
 * se entiende), se sigue contando como antes.
 */
export function usaCantos(pieza) {
  const cantos = Array.isArray(pieza?.cantos) ? pieza.cantos : [];
  return cantos.length > 0 && cantos.length === Number(pieza?.lados);
}

/** Tipos distintos de una lista de lados, en el orden en que aparecen. */
export const tiposDe = (cantos = []) => [...new Set((cantos || []).map(tipoCanto))];

/**
 * Los lados ya pegados de una pieza (Set de "l1a"…): los escaneos con lado
 * marcan ese lado; los viejos, sin lado, toman los que faltan en el orden de
 * la planilla. Con completa, todos.
 * @param {object} pieza  con cantos [{ l, e, c, mm }]
 * @param {object[]} filas  escaneos de la pieza en la etapa: [{ lado }]
 */
export function ladosHechos(pieza, filas = [], completa = false) {
  const cantos = Array.isArray(pieza?.cantos) ? pieza.cantos : [];
  const hechos = new Set();
  if (completa) {
    for (const c of cantos) hechos.add(c.l);
    return hechos;
  }
  let sinLado = 0;
  for (const f of filas || []) {
    if (f?.lado && cantos.some((c) => c.l === f.lado) && !hechos.has(f.lado)) hechos.add(f.lado);
    else sinLado += 1;
  }
  for (const c of cantos) {
    if (sinLado <= 0) break;
    if (!hechos.has(c.l)) { hechos.add(c.l); sinLado -= 1; }
  }
  return hechos;
}

/** Los lados que le faltan a la pieza, en el orden de la planilla. */
export function ladosPendientes(pieza, filas = [], completa = false) {
  const hechos = ladosHechos(pieza, filas, completa);
  return (Array.isArray(pieza?.cantos) ? pieza.cantos : []).filter((c) => !hechos.has(c.l));
}

/**
 * Qué lado anota un escaneo.
 * @param {object[]} unidades  las unidades posibles en orden (una sola si se escaneó la etiqueta de esa unidad)
 * @param {object} p
 * @param {Map<number, object[]>} p.filas  pieza_id → escaneos de lado
 * @param {Set<number>} [p.completas]  unidades que ya pasaron la etapa
 * @param {string|null} [p.tipo]  el canto elegido ("2|GRAFITO")
 * @returns {{ pieza: object, lado: string, tipo: string }
 *   | { preguntar: string[] }            sin canto elegido y quedan varios tipos
 *   | { distinto: string[] }             el canto elegido no está pendiente; quedan estos
 *   | { ninguno: true }}                 no queda ningún lado
 */
export function ladoParaEscaneo(unidades = [], { filas = new Map(), completas = new Set(), tipo = null } = {}) {
  const abiertas = (unidades || [])
    .filter((u) => !completas.has(Number(u.id)))
    .map((u) => ({ u, pend: ladosPendientes(u, filas.get(Number(u.id)) || []) }))
    .filter((x) => x.pend.length);
  if (!abiertas.length) return { ninguno: true };
  const quedan = [...new Set(abiertas.flatMap((x) => tiposDe(x.pend)))];
  let elegido = tipo ? String(tipo) : null;
  if (!elegido) {
    if (quedan.length > 1) return { preguntar: quedan };
    [elegido] = quedan;
  }
  for (const { u, pend } of abiertas) {
    const c = pend.find((x) => tipoCanto(x) === elegido);
    if (c) return { pieza: u, lado: c.l, tipo: elegido };
  }
  return { distinto: quedan };
}

/**
 * Lados de un tipo de canto en las unidades: cuántos lleva y cuántos van
 * pegados (las completas cuentan todos).
 */
export function avanceTipo(unidades = [], { filas = new Map(), completas = new Set(), tipo } = {}) {
  let total = 0;
  let hechos = 0;
  for (const u of unidades || []) {
    const delTipo = (Array.isArray(u.cantos) ? u.cantos : []).filter((c) => tipoCanto(c) === tipo);
    if (!delTipo.length) continue;
    total += delTipo.length;
    const h = ladosHechos(u, filas.get(Number(u.id)) || [], completas.has(Number(u.id)));
    hechos += delTipo.filter((c) => h.has(c.l)).length;
  }
  return { total, hechos };
}
