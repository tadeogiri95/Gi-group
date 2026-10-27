// app/lib/avanceManual.js — Checkeo manual de OT (Tadeo, 27/10; migración 141).
// Lo que manda para saber cuánto va cada proceso de una OT es el escaneo de
// piezas. Cuando no hay escaneo, gestión activa el "Checkeo manual de OT" y
// carga el % de cada proceso a mano (proyectos.avance_manual, jsonb):
//   { activo: true, etapas: { "1": 100, "2": 40 }, por: "Tadeo", at: "2026-10-27T13:00:00Z" }
// Un proceso con al menos una pieza escaneada sigue el escaneo; el % manual
// solo cuenta en los procesos sin escaneo.
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

/** Procesos de la OT para el checkeo: la ruta de su división (o todas las etapas productivas). */
export function etapasDeOt(proyecto, etapas = [], divisiones = []) {
  const productivas = (etapas || []).filter((e) => Number(e.codigo) > 0);
  const ruta = rutaDe(buscarDivision(divisiones, proyecto?.division));
  if (!ruta.length) return productivas;
  return ruta.map((c) => productivas.find((e) => Number(e.codigo) === c)).filter(Boolean);
}

/**
 * Filas de v_avance_piezas (ot, etapa, total, pasaron) con el checkeo manual de
 * cada OT encima: en cada proceso sin piezas escaneadas, el % manual. La fila
 * manual usa el total de piezas de la OT (para que pese igual que las
 * escaneadas en el % de la OT) o 100 si la OT no tiene piezas.
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
  for (const f of piezas || []) {
    const ot = String(f.ot);
    totalOt.set(ot, Math.max(totalOt.get(ot) || 0, Number(f.total) || 0));
    const etapas = manual.get(ot);
    // Sin escaneo en ese proceso y con % manual: la reemplaza la fila manual
    if (etapas && etapas[String(Number(f.etapa))] != null && !(Number(f.pasaron) > 0)) continue;
    filas.push(f);
  }
  const escaneadas = new Set(filas.filter((f) => Number(f.pasaron) > 0).map((f) => `${f.ot}|${Number(f.etapa)}`));
  for (const [ot, etapas] of manual) {
    const total = totalOt.get(ot) || 100;
    for (const [codigo, pct] of Object.entries(etapas)) {
      if (escaneadas.has(`${ot}|${codigo}`)) continue;
      filas.push({ ot, etapa: Number(codigo), total, pasaron: Math.round((total * pct) / 100), manual: true });
    }
  }
  return filas;
}

/** Un proceso de la OT tiene escaneo: manda el escaneo y no se puede cargar a mano. */
export function tieneEscaneo(piezas = [], ot, codigo) {
  return (piezas || []).some((f) => String(f.ot) === String(ot) && Number(f.etapa) === Number(codigo) && Number(f.pasaron) > 0 && !f.manual);
}
