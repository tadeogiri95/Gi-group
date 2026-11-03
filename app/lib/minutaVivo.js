// app/lib/minutaVivo.js — Minuta para cargar en vivo durante la reunión
// (03/11, hilo "Rediseñar minuta para registro en vivo"; boceto en
// notes/minuta-en-vivo/boceto.png).
//
// La pantalla muestra cada renglón en una o dos líneas y se abre uno solo a
// la vez para editarlo. Acá se arma ese texto corto con TODA la información
// del renglón (no se saca nada: solo se ordena), el resumen de cada sección
// plegada y el orden en que se recorren los renglones con ↑ / ↓.

import { AREAS_DYT, BLOQUES, ESTADOS_DYT, LISTO, SEMAFOROS, URGENCIAS, renglonConDatos, seccionesDe, textoCantidad } from "./minutas";
import { otCompleta, textoOt, textoRenglonOt } from "./nombreOt";

const lleno = (v) => v != null && String(v).trim() !== "";
const ddmm = (f) => (f ? `${Number(String(f).slice(8, 10))}/${Number(String(f).slice(5, 7))}` : "");

/** Lo obligatorio que le falta a un renglón con datos ("responsable", "fecha objetivo"). */
export function faltaEnRenglon(it, s) {
  if (!s?.obligatorios || !renglonConDatos(it)) return [];
  const falta = [];
  if (s.obligatorios.includes("responsable") && !lleno(it.responsable)) falta.push("responsable");
  if (s.obligatorios.includes("fecha") && !lleno(it.fecha_objetivo)) falta.push("fecha objetivo");
  return falta;
}

/**
 * El renglón en corto: { punto, titulo, detalle, falta }.
 * titulo = lo que identifica al renglón (OT completa, artículo, tema);
 * detalle = el resto de los campos cargados, separados por " · ".
 */
export function resumenRenglon(it, s, porOt = null) {
  const punto = SEMAFOROS.find((x) => x.id === it.semaforo)?.punto || "";
  const ot = textoRenglonOt(it, porOt);
  const texto = lleno(it.texto) ? String(it.texto).trim() : "";
  const d = it.datos || {};
  let titulo = "";
  const detalle = [];
  if (s?.id === "compra") {
    titulo = [texto, textoCantidad(it)].filter(Boolean).join(" · ");
    if (it.tipo === "urgente") detalle.push("🔴 Urgente");
    else if (it.tipo && it.tipo !== "normal") detalle.push(URGENCIAS.find((u) => u.id === it.tipo)?.label || it.tipo);
    if (ot) detalle.push(`Para ${ot}`);
    else if (d.ots) detalle.push(`Para ${String(d.ots).split(",").map((o) => textoOt(otCompleta(o, porOt))).join(" / ")}`);
    if (d.proveedor) detalle.push(`🏪 ${d.proveedor}`);
  } else if (s?.id === "movimiento" || s?.id === "estacionamiento") {
    titulo = texto;
    if (d.desde || d.hasta) detalle.push(`${d.desde || "?"} → ${d.hasta || "?"}`);
  } else if (s?.id === "dyt") {
    titulo = ot || "";
    const estado = ESTADOS_DYT.find((e) => e.id === it.tipo)?.label;
    if (estado) detalle.push(estado);
    if (texto) detalle.push(texto);
  } else if (s?.id === "feedback") {
    titulo = ot || texto;
    const tipo = [it.tipo, it.area && `para ${it.area}`].filter(Boolean).join(" ");
    if (tipo) detalle.push(tipo);
    if (ot && texto) detalle.push(texto);
  } else {
    titulo = ot || texto;
    if (ot && texto) detalle.push(texto);
  }
  if (it.division && it.ot && s?.id !== "dyt") detalle.push(it.division);
  if (d.instaladores) detalle.push(`🔧 ${d.instaladores}`);
  if (d.listo) detalle.push(LISTO.find((l) => l.id === d.listo)?.label || d.listo);
  if (lleno(it.responsable)) detalle.push(`👤 ${it.responsable}`);
  if (d.vehiculo) detalle.push(`🚚 ${d.vehiculo}`);
  if (it.fecha_objetivo) detalle.push(`📅 ${s?.id === "prod_a_iniciar" ? "entrega " : ""}${ddmm(it.fecha_objetivo)}`);
  if (d.donde) detalle.push(`📍 ${d.donde}`);
  return { punto, titulo, detalle: detalle.join(" · "), falta: faltaEnRenglon(it, s) };
}

/** Resumen de una sección plegada: { total, verde, amarillo, rojo, falta }. */
export function resumenSeccion(items, s = null) {
  const r = { total: items.length, verde: 0, amarillo: 0, rojo: 0, falta: 0 };
  for (const it of items) {
    if (r[it.semaforo] != null) r[it.semaforo]++;
    if (s && faltaEnRenglon(it, s).length) r.falta++;
  }
  return r;
}

/** Texto corto del resumen: "6 · 🟢4 🟡1 🔴1". */
export function textoResumenSeccion(r) {
  const colores = SEMAFOROS.filter((x) => r[x.id] > 0).map((x) => `${x.punto}${r[x.id]}`).join(" ");
  return [String(r.total), colores].filter(Boolean).join(" · ");
}

/**
 * Los renglones en el orden en que se ven en pantalla (bloque → sección →
 * renglón; Diseño y técnica por área), para pasar al anterior / siguiente.
 */
export function ordenRenglones(items) {
  const ids = [];
  for (const b of BLOQUES) {
    for (const s of seccionesDe(b.id)) {
      const de = items.filter((it) => it.seccion === s.id);
      if (s.id === "dyt") {
        for (const a of AREAS_DYT) de.filter((it) => it.area === a.id).forEach((it) => ids.push(it.id));
      } else de.forEach((it) => ids.push(it.id));
    }
  }
  return ids;
}

/** El id del renglón de al lado (paso = 1 siguiente, -1 anterior), o null. */
export function renglonVecino(orden, id, paso) {
  const i = orden.indexOf(id);
  if (i < 0) return null;
  return orden[i + paso] ?? null;
}

/** Por bloque: cuántos renglones tiene y cuántos con algo obligatorio sin completar (para la barra de secciones). */
export function conteoBloques(items) {
  const out = {};
  for (const b of BLOQUES) {
    let total = 0;
    let falta = 0;
    for (const s of seccionesDe(b.id)) {
      const de = items.filter((it) => it.seccion === s.id);
      total += de.length;
      falta += de.filter((it) => faltaEnRenglon(it, s).length).length;
    }
    out[b.id] = { total, falta };
  }
  return out;
}
