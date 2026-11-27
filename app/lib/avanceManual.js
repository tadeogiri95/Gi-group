// app/lib/avanceManual.js — Checkeo manual de OT (Tadeo, 27/10; migración 141).
// Lo que manda para saber cuánto va cada proceso de una OT es el escaneo de
// piezas. Cuando no hay escaneo, gestión activa el "Checkeo manual de OT" y
// carga el % de cada proceso a mano (proyectos.avance_manual, jsonb):
//   { activo: true, etapas: { "1": 100, "2": 40 }, por: "Tadeo", at: "2026-10-27T13:00:00Z" }
// Un proceso con al menos una pieza escaneada sigue el escaneo; el % manual
// solo cuenta en los procesos sin escaneo. Excepción (Tadeo, 27/11): gestión
// puede "Completar a mano" un proceso con escaneo empezado (p. ej. el mueble
// ya se fue sin escanear): se guarda 100 y ese 100 pisa al escaneo.
import { buscarDivision, rutaDe } from "./rutas";

/** Lo guardado en proyectos.avance_manual, con los % entre 0 y 100 y enteros. */
export function normalizarAvanceManual(valor) {
  const v = valor && typeof valor === "object" ? valor : {};
  const etapas = {};
  for (const [codigo, pct] of Object.entries(v.etapas || {})) {
    const n = Number(pct);
    if (Number.isInteger(Number(codigo)) && Number(codigo) > 0 && Number.isFinite(n)) etapas[String(Number(codigo))] = Math.max(0, Math.min(100, Math.round(n)));
  }
  return { activo: !!v.activo, etapas, por: v.por || null, at: v.at || null };
}

/**
 * Control (o Control de calidad) no se carga en el checkeo manual (Tadeo,
 * 27/11): se revisa al final y no es un proceso que avance por %.
 */
export const esEtapaControl = (etapa) =>
  /\bcontrol\b/.test(String(etapa?.nombre ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());

/** Procesos de la OT para el checkeo: la ruta de su división (o todas las etapas productivas), sin Control. */
export function etapasDeOt(proyecto, etapas = [], divisiones = []) {
  const productivas = (etapas || []).filter((e) => Number(e.codigo) > 0 && !esEtapaControl(e));
  const ruta = rutaDe(buscarDivision(divisiones, proyecto?.division));
  if (!ruta.length) return productivas;
  return ruta.map((c) => productivas.find((e) => Number(e.codigo) === c)).filter(Boolean);
}

/**
 * Filas de v_avance_piezas (ot, etapa, total, pasaron) con el checkeo manual de
 * cada OT encima: en cada proceso sin piezas escaneadas, el % manual. La fila
 * manual usa el total de piezas de la OT (para que pese igual que las
 * escaneadas en el % de la OT) o 100 si la OT no tiene piezas.
 * Un proceso con escaneo que gestión completó a mano (100) también pasa a la
 * fila manual, con el total de piezas de ese proceso.
 * Marca manual: true en esas filas.
 */
export function piezasConManual(piezas = [], proyectos = []) {
  const manual = new Map();
  for (const p of proyectos || []) {
    const am = normalizarAvanceManual(p?.avance_manual);
    if (am.activo && Object.keys(am.etapas).length) manual.set(String(p.ot), am.etapas);
  }
  if (!manual.size) return piezas || [];
  const filas = [];
  const totalOt = new Map();
  const totalEtapa = new Map(); // total de piezas del proceso completado a mano
  for (const f of piezas || []) {
    const ot = String(f.ot);
    totalOt.set(ot, Math.max(totalOt.get(ot) || 0, Number(f.total) || 0));
    const etapas = manual.get(ot);
    const pct = etapas?.[String(Number(f.etapa))];
    // Sin escaneo en ese proceso y con % manual, o completado a mano (100): la reemplaza la fila manual
    if (pct != null && (!(Number(f.pasaron) > 0) || pct >= 100)) {
      if (Number(f.total) > 0) totalEtapa.set(`${ot}|${Number(f.etapa)}`, Number(f.total));
      continue;
    }
    filas.push(f);
  }
  const escaneadas = new Set(filas.filter((f) => Number(f.pasaron) > 0).map((f) => `${f.ot}|${Number(f.etapa)}`));
  for (const [ot, etapas] of manual) {
    for (const [codigo, pct] of Object.entries(etapas)) {
      if (escaneadas.has(`${ot}|${codigo}`)) continue;
      const total = totalEtapa.get(`${ot}|${codigo}`) || totalOt.get(ot) || 100;
      filas.push({ ot, etapa: Number(codigo), total, pasaron: Math.round((total * pct) / 100), manual: true });
    }
  }
  return filas;
}

/** Un proceso de la OT tiene escaneo: manda el escaneo y no se puede cargar a mano. */
export function tieneEscaneo(piezas = [], ot, codigo) {
  return (piezas || []).some((f) => String(f.ot) === String(ot) && Number(f.etapa) === Number(codigo) && Number(f.pasaron) > 0 && !f.manual);
}

/** % del escaneo de un proceso de la OT (0 a 100), o null si no tiene piezas para esa etapa. */
export function pctEscaneo(piezas = [], ot, codigo) {
  const f = (piezas || []).find((x) => String(x.ot) === String(ot) && Number(x.etapa) === Number(codigo) && !x.manual);
  return f && Number(f.total) > 0 ? Math.round((Math.min(Number(f.pasaron) || 0, Number(f.total)) / Number(f.total)) * 100) : null;
}

/**
 * Lo que se guarda para cada proceso al tocar "Guardar avance": el % escrito
 * en los procesos sin escaneo y 100 en los que gestión completó a mano
 * aunque tengan escaneo empezado (27/11).
 * @param {object[]} procesos etapasDeOt
 * @param {Record<string,string>} textos % escritos, por código
 * @param {Set<string>|string[]} completar códigos tildados "Completar a mano"
 */
export function valorEtapasManual(procesos = [], textos = {}, completar = [], piezas = [], ot) {
  const tildados = new Set([...(completar || [])].map((c) => String(Number(c))));
  const out = {};
  for (const e of procesos || []) {
    const c = String(Number(e.codigo));
    if (tieneEscaneo(piezas, ot, e.codigo)) {
      if (tildados.has(c)) out[c] = 100;
      continue;
    }
    const t = String(textos[e.codigo] ?? "").trim();
    if (t) out[c] = Math.round(Number(t.replace(",", ".")));
  }
  return out;
}
