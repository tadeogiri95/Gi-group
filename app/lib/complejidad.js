// app/lib/complejidad.js — Diseño y Técnica (parte 46; diseño en
// notes/diseno-gantt-diseno-tecnica.md): estado de las etapas de Diseño y de
// Técnica de cada OT según el Nuevo Plan de trabajo, y la clase de
// complejidad A / B / C de cada OT dentro de su tipo de proyecto.
//
// Clase (Tadeo, 05/11): se mide con las cantidades TOTALES de la OT:
//   - componentes = unidades de todo lo que no es placa ni canto (herrajes,
//     accesorios, perfiles por metro, LED…),
//   - placas,
//   - metros de canto.
// Salen de las necesidades de la planilla MRP (necesidades_stock, 108), que
// son las mismas de la lista NECESIDADES del Excel de la OT (se comprobó con
// 72 Excel el 05/11). Si la OT todavía no tiene necesidades, se usan las
// placas y los cantos preliminares del Plan de trabajo (136).
// Puntaje de 0 a 1 = 45 % componentes + 35 % placas + 20 % canto, cada uno
// comparado contra las demás OT de la empresa (percentil). Dentro de cada tipo
// de proyecto: el 20 % de las OT con más puntaje es A, el 50 % siguiente B y
// el 30 % restante C. Un tipo con pocas OT usa los cortes de todas las OT.
// La clase elegida a mano (proyectos.clase_complejidad, 159) manda.
import { tipoDeOt } from "./tipoProyecto";

/* ─── Etapas del Plan de trabajo ─── */

/** Columnas del Plan (títulos de la fila 3, en minúscula) y a qué área van.
 *  La S (PERF/ESPEJO/VIDRIO) no cuenta. */
export const ETAPAS_DISENO = [
  { id: "dis", area: "diseno", nombre: "Diseño", titulos: ["dis"] },
  { id: "skp", area: "diseno", nombre: "Dibujo SketchUp", titulos: ["skp"] },
  { id: "info", area: "diseno", nombre: "Info proyecto", titulos: ["info proy", "info proyecto"] },
  { id: "relev", area: "diseno", nombre: "Relevamiento", titulos: ["relev", "relevamiento"] },
  { id: "np", area: "diseno", nombre: "Necesidades preliminares", titulos: ["n.p", "n.p.", "np"] },
  { id: "nf", area: "tecnica", nombre: "Necesidades finales", titulos: ["n.f", "n.f.", "nf"] },
  { id: "excel", area: "tecnica", nombre: "Excel", titulos: ["excel"] },
  { id: "pdf", area: "tecnica", nombre: "PDF", titulos: ["pdf"] },
];
export const AREAS = { diseno: "Diseño", tecnica: "Técnica" };

/** Índice de cada etapa en los títulos del Plan (solo las que están). */
export function columnasEtapas(headers) {
  const h = headers.map((t) => String(t || "").trim().toLowerCase());
  return ETAPAS_DISENO.map((e) => ({ id: e.id, i: h.findIndex((t) => e.titulos.includes(t)) })).filter((e) => e.i >= 0);
}

/** Celda → { e: "falta" | "na" | "hecho", q?: iniciales }. Vacía = falta; N/A = no aplica; otra cosa = hecha. */
export function estadoCelda(valor) {
  const t = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { e: "falta" };
  if (/^n\s*\/\s*a$/i.test(t) || /^no aplica$/i.test(t)) return { e: "na" };
  // "SI" también es hecha, pero no dice quién
  return /^s[ií]$/i.test(t) ? { e: "hecho" } : { e: "hecho", q: t.slice(0, 20) };
}

/** Una OT con varios renglones: falta si falta en alguno; N/A si es N/A en todos; si no, hecha. */
export function juntarEtapas(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id], y = b[id];
    if (!x || !y) { out[id] = x || y; continue; }
    const e = x.e === "falta" || y.e === "falta" ? "falta" : x.e === "na" && y.e === "na" ? "na" : "hecho";
    const q = e === "hecho" ? (x.q || y.q) : undefined;
    out[id] = q ? { e, q } : { e };
  }
  return out;
}

/** % de un área (etapas hechas ÷ etapas que aplican), terminada y quiénes. null si no hay datos. */
export function avanceArea(etapas, area) {
  if (!etapas || typeof etapas !== "object") return null;
  const lista = ETAPAS_DISENO.filter((e) => e.area === area && etapas[e.id]);
  if (!lista.length) return null;
  const aplican = lista.filter((e) => etapas[e.id].e !== "na");
  const hechas = aplican.filter((e) => etapas[e.id].e === "hecho");
  const quienes = [...new Set(hechas.map((e) => etapas[e.id].q).filter(Boolean))];
  return {
    pct: aplican.length ? Math.round((hechas.length / aplican.length) * 100) : 100,
    terminada: hechas.length === aplican.length,
    hechas: hechas.length,
    aplican: aplican.length,
    quienes,
  };
}

/* ─── Clase de complejidad ─── */

export const CLASES = ["A", "B", "C"];
export const PESOS = { componentes: 0.45, placas: 0.35, canto: 0.2 };
/** Cortes dentro de cada tipo: 20 % A, 50 % B, 30 % C. */
export const CORTE_A = 0.2;
export const CORTE_B = 0.7;
/** Un tipo con menos OT que esto usa los cortes de todas las OT. */
export const MIN_OT_POR_TIPO = 10;
export const CLASE_SIN_DATOS = "B";
export const AVISO_MIGRACION_159 = "Para cambiar la clase a mano falta correr la migración 159 en Supabase.";

/** Qué es cada renglón de necesidades, por el nombre: canto, placa o componente. */
export function categoriaArticulo(nombre) {
  const u = String(nombre || "").toUpperCase();
  if (u.includes("CANTO")) return "canto";
  if (/M2\b|-MT2-/.test(u) || /^(MELAMINA|FIBROPLUS|ENCHAPADO|MDF|TAPA|AGLOMERADO|TERCIADO|MULTILAMINADO|LAMINADO|ALTO BRILLO)/.test(u.trim())) return "placa";
  return "componente";
}

/** Necesidades (ot, nombre, cantidad) → Map ot → { componentes, placas, canto }. */
export function totalesNecesidades(necesidades = []) {
  const out = new Map();
  for (const n of necesidades) {
    const ot = String(n?.ot ?? "").trim();
    const q = Number(n?.cantidad);
    if (!ot || !Number.isFinite(q) || q <= 0) continue;
    const t = out.get(ot) || { componentes: 0, placas: 0, canto: 0 };
    const c = categoriaArticulo(n.nombre);
    if (c === "canto") t.canto += q;
    else if (c === "placa") t.placas += q;
    else t.componentes += q;
    out.set(ot, t);
  }
  return out;
}

/** Cantidades de la OT: las necesidades del MRP, o las placas y cantos preliminares del Plan. null sin datos. */
export function cantidadesOt(proyecto, totales) {
  const t = totales?.get(String(proyecto?.ot ?? "").trim());
  if (t) return { ...t, origen: "necesidades" };
  const placas = (Number(proyecto?.placas) || 0) + (Number(proyecto?.fondos) || 0);
  const canto = Number(proyecto?.metros_canto) || 0;
  if (placas > 0 || canto > 0) return { componentes: null, placas, canto, origen: "plan" };
  return null;
}

const percentil = (ordenados, x) => {
  if (!ordenados.length) return 0;
  let menores = 0, iguales = 0;
  for (const v of ordenados) { if (v < x) menores++; else if (v === x) iguales++; }
  return (menores + iguales / 2) / ordenados.length;
};

/**
 * Clase automática de cada OT.
 * @param {object[]} proyectos  ot, descripcion, tipo_proyecto, placas, fondos, metros_canto
 * @param {object[]} necesidades ot, nombre, cantidad
 * @returns {Map<string, { clase: "A"|"B"|"C", puntaje: number, tipo: string|null, cantidades: object }>}
 */
export function clasesAutomaticas(proyectos = [], necesidades = []) {
  const totales = totalesNecesidades(necesidades);
  const ots = [];
  const vistos = new Set();
  for (const p of proyectos) {
    const ot = String(p?.ot ?? "").trim();
    if (!ot || vistos.has(ot)) continue;
    vistos.add(ot);
    const cantidades = cantidadesOt(p, totales);
    if (cantidades) ots.push({ ot, tipo: tipoDeOt(p).id || "otros", cantidades });
  }
  const orden = (k) => ots.map((o) => o.cantidades[k]).filter((v) => v != null).sort((a, b) => a - b);
  const ord = { componentes: orden("componentes"), placas: orden("placas"), canto: orden("canto") };
  for (const o of ots) {
    // Sin componentes (OT con solo el Plan): el puntaje sale de lo que hay
    let suma = 0, pesos = 0;
    for (const [k, w] of Object.entries(PESOS)) {
      const v = o.cantidades[k];
      if (v == null) continue;
      suma += w * percentil(ord[k], v);
      pesos += w;
    }
    o.puntaje = pesos ? suma / pesos : 0;
  }
  const claseEnLista = (lista) => {
    const ordenada = [...lista].sort((a, b) => b.puntaje - a.puntaje || a.ot.localeCompare(b.ot));
    const n = ordenada.length;
    const m = new Map();
    ordenada.forEach((o, i) => m.set(o.ot, i < n * CORTE_A ? "A" : i < n * CORTE_B ? "B" : "C"));
    return m;
  };
  const global = claseEnLista(ots);
  // Puntaje mínimo de A y de B en todas las OT, para los tipos con pocas OT
  const minimo = (c) => Math.min(...ots.filter((o) => global.get(o.ot) === c).map((o) => o.puntaje));
  const cortesGlobales = { A: minimo("A"), B: minimo("B") };
  const porTipo = new Map();
  for (const o of ots) porTipo.set(o.tipo, [...(porTipo.get(o.tipo) || []), o]);
  const out = new Map();
  for (const lista of porTipo.values()) {
    const enTipo = lista.length >= MIN_OT_POR_TIPO ? claseEnLista(lista) : null;
    for (const o of lista) {
      const clase = enTipo ? enTipo.get(o.ot)
        : o.puntaje >= cortesGlobales.A ? "A" : o.puntaje >= cortesGlobales.B ? "B" : "C";
      out.set(o.ot, { clase, puntaje: Math.round(o.puntaje * 1000) / 1000, tipo: o.tipo, cantidades: o.cantidades });
    }
  }
  return out;
}

export const esClase = (c) => CLASES.includes(c);

/** { clase, manual, sinDatos }: la elegida a mano, la automática, o B si no hay datos. */
export function claseDeOt(proyecto) {
  if (esClase(proyecto?.clase_complejidad)) return { clase: proyecto.clase_complejidad, manual: true, sinDatos: false };
  if (esClase(proyecto?.clase_auto)) return { clase: proyecto.clase_auto, manual: false, sinDatos: false };
  return { clase: CLASE_SIN_DATOS, manual: false, sinDatos: true };
}

/** Lo que hay que guardar: grupos { clase → OT } con la clase automática que cambió (null = sin datos). */
export function cambiosClase(proyectos = [], clases) {
  const grupos = new Map();
  for (const p of proyectos) {
    const ot = String(p?.ot ?? "").trim();
    if (!ot) continue;
    const nueva = clases.get(ot)?.clase ?? null;
    if ((p.clase_auto ?? null) === nueva) continue;
    const k = nueva ?? "";
    grupos.set(k, [...(grupos.get(k) || []), ot]);
  }
  return grupos;
}
