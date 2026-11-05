// app/lib/otTabla.js — Tabla de OT en la computadora (Producción → OT, vista
// Lista): ordenar de forma ascendente o descendente y filtrar por cada
// columna (Tadeo, 02/11). Solo cambia lo que se ve: no toca las OT.
import { claseDeOt, CLASES } from "./complejidad";

export const COLUMNAS_OT = [
  { id: "ot", label: "OT", filtro: "texto" },
  { id: "cliente", label: "Cliente / proyecto", filtro: "texto" },
  { id: "estado", label: "Estado", filtro: "lista" },
  { id: "avance", label: "Avance", filtro: "rango" },
  // Clase de complejidad A/B/C dentro del tipo de proyecto (158)
  { id: "clase", label: "Clase", filtro: "clase" },
  { id: "entrega", label: "Entrega", filtro: "texto" },
  { id: "valor", label: "Valor", filtro: "rango_valor", soloPrecios: true },
];

export const RANGOS_AVANCE = [
  { id: "sin", label: "Sin avance", ok: (v) => v == null || v === 0 },
  { id: "empezada", label: "1 a 49 %", ok: (v) => v > 0 && v < 50 },
  { id: "mitad", label: "50 a 99 %", ok: (v) => v >= 50 && v < 100 },
  { id: "completa", label: "100 %", ok: (v) => v >= 100 },
];
export const OPCIONES_CLASE = CLASES.map((c) => ({ id: c, label: c }));
export const RANGOS_VALOR = [
  { id: "con", label: "Con valor", ok: (v) => v != null },
  { id: "sin", label: "Sin valor", ok: (v) => v == null },
];

const normal = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const comparar = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });

/** Lo que se compara al ordenar cada columna. */
function clave(f, col) {
  switch (col) {
    case "ot": return f.p.ot;
    case "cliente": return f.p.cliente || f.p.proyecto || "";
    case "estado": return f.estado?.texto || "";
    case "avance": return f.pct;
    case "clase": return claseDeOt(f.p).clase;
    case "entrega": return f.p.fecha_objetivo || f.p.fecha_entrega || null;
    case "valor": return f.valor;
    default: return null;
  }
}

/** Texto donde busca el filtro de cada columna. */
function textoDe(f, col) {
  if (col === "ot") return f.p.ot;
  if (col === "cliente") return [f.p.cliente, f.p.proyecto, f.p.obra, f.p.descripcion, f.obra].filter(Boolean).join(" ");
  if (col === "entrega") return f.entrega || "";
  return "";
}

/**
 * Filtra y ordena las filas de la tabla.
 * @param {{ p: object, pct: number|null, estado: { texto: string }, entrega: string, obra: string, valor: number|null }[]} filas
 * @param {{ orden?: { col: string, dir: "asc"|"desc" }|null, filtros?: Record<string, string> }} opciones
 */
export function filasTablaOt(filas, { orden = null, filtros = {} } = {}) {
  let out = filas.filter((f) => Object.entries(filtros).every(([col, v]) => {
    if (!v) return true;
    if (col === "estado") return (f.estado?.texto || "") === v;
    if (col === "clase") return claseDeOt(f.p).clase === v;
    if (col === "avance") return RANGOS_AVANCE.find((r) => r.id === v)?.ok(f.pct) ?? true;
    if (col === "valor") return RANGOS_VALOR.find((r) => r.id === v)?.ok(f.valor) ?? true;
    return normal(textoDe(f, col)).includes(normal(v));
  }));
  if (orden?.col) {
    const signo = orden.dir === "desc" ? -1 : 1;
    // Los vacíos van siempre al final, en los dos sentidos
    out = [...out].sort((a, b) => {
      const x = clave(a, orden.col);
      const y = clave(b, orden.col);
      const vx = x === null || x === undefined || x === "";
      const vy = y === null || y === undefined || y === "";
      if (vx || vy) return vx === vy ? 0 : vx ? 1 : -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : comparar(x, y);
      return c * signo;
    });
  }
  return out;
}

/** Tocar el título: primero ascendente, después descendente, después sin ordenar. */
export function siguienteOrden(actual, col) {
  if (!actual || actual.col !== col) return { col, dir: "asc" };
  if (actual.dir === "asc") return { col, dir: "desc" };
  return null;
}

/** Estados que aparecen en la lista, para el filtro de la columna Estado. */
export const estadosPresentes = (filas) => [...new Set(filas.map((f) => f.estado?.texto).filter(Boolean))].sort(comparar);
