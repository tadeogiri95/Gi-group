// app/lib/avance.js — Avance de cada etapa por OT, liberación y tablero
// (Órdenes de Producción, parte 5; ítem 39).
//
// Una etapa de una OT está:
//   pendiente  → nadie la marcó y no tiene horas
//   en curso   → tiene horas cargadas pero nadie la marcó
//   terminada  → la marcó quien la completó; espera la firma del responsable
//   aprobada   → firmó el responsable (la OT puede pasar a la siguiente)
//   no_aplica  → esa etapa no corresponde a esta OT (ej. corte especial)
import { buscarDivision, rutaDe } from "./rutas";

export const CLAVE_CHECKLIST = "checklist_liberacion";
export const MAX_ITEMS_CHECKLIST = 20;

export const ESTADO_INFO = {
  pendiente: { nombre: "Pendiente", corto: "—" },
  en_curso: { nombre: "En curso", corto: "…" },
  terminada: { nombre: "Terminada, falta la firma", corto: "✓" },
  aprobada: { nombre: "Firmada", corto: "✓✓" },
  no_aplica: { nombre: "No aplica", corto: "n/a" },
};

/** Checklist de ejemplo para una fábrica (liberación de la OT del mapa de procesos). */
export const CHECKLIST_FABRICA = [
  "Planilla técnica completa, revisada y firmada",
  "Total de módulos y hoja de sueltos cargados",
  "Placas y cantos disponibles en depósito",
  "Herrajes, perfiles y accesorios disponibles o pedidos con fecha",
  "Puntos críticos marcados",
  "Fecha de entrega e instalación confirmada",
];

/** Limpia una lista de textos: sin vacíos ni repetidos, hasta 20. */
export function normalizarChecklist(lista) {
  if (!Array.isArray(lista)) return [];
  const out = [];
  for (const t of lista) {
    const s = String(t ?? "").trim().slice(0, 200);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_ITEMS_CHECKLIST) break;
  }
  return out;
}

/** Estado de una etapa de una OT a partir de su fila de avance y si tiene horas. */
export function estadoEtapa(fila, tieneHoras) {
  if (fila?.estado === "aprobada" || fila?.estado === "terminada" || fila?.estado === "no_aplica") return fila.estado;
  return tieneHoras ? "en_curso" : "pendiente";
}

/** Semáforo de entrega: rojo si ya pasó, amarillo si faltan 7 días o menos. */
export function semaforoEntrega(fechaEntrega, hoy) {
  if (!fechaEntrega) return null;
  const dias = Math.round((Date.parse(fechaEntrega) - Date.parse(hoy)) / 86400000);
  if (!Number.isFinite(dias)) return null;
  if (dias < 0) return "rojo";
  if (dias <= 7) return "amarillo";
  return "verde";
}

/**
 * Filas del tablero: una por OT, ordenadas por fecha de entrega (sin fecha al
 * final). Las columnas son la ruta de la división de la OT; sin ruta, las
 * etapas en las que se trabajó o se marcó algo.
 * @param {object[]} proyectos OT abiertas
 * @param {{ etapas: object[], divisiones: object[], avance: object[], horas: Set<string>, hoy: string }} ctx
 *   horas: claves "OT|etapa" con horas cargadas
 */
export function filasTablero(proyectos, { etapas = [], divisiones = [], avance = [], horas = new Set(), hoy }) {
  const porCodigo = new Map(etapas.filter((e) => e.codigo > 0).map((e) => [Number(e.codigo), e]));
  const avancePorOt = new Map();
  for (const a of avance) {
    const k = String(a.ot);
    if (!avancePorOt.has(k)) avancePorOt.set(k, new Map());
    avancePorOt.get(k).set(Number(a.etapa), a);
  }
  const filas = (proyectos || []).map((p) => {
    const ot = String(p.ot);
    const filasOt = avancePorOt.get(ot) || new Map();
    let codigos = rutaDe(buscarDivision(divisiones, p.division)).filter((c) => porCodigo.has(c));
    if (!codigos.length) {
      const usados = new Set([...filasOt.keys()]);
      for (const k of horas) {
        const [o, c] = k.split("|");
        if (o === ot) usados.add(Number(c));
      }
      codigos = [...usados].filter((c) => porCodigo.has(c)).sort((a, b) => (porCodigo.get(a).orden ?? a) - (porCodigo.get(b).orden ?? b) || a - b);
    }
    const celdas = codigos.map((c) => {
      const fila = filasOt.get(c) || null;
      return { codigo: c, etapa: porCodigo.get(c), fila, estado: estadoEtapa(fila, horas.has(`${ot}|${c}`)) };
    });
    const cerradas = celdas.filter((x) => x.estado === "aprobada" || x.estado === "no_aplica").length;
    return {
      proyecto: p,
      liberada: !!p.liberada_at,
      semaforo: semaforoEntrega(p.fecha_entrega, hoy),
      celdas,
      cerradas,
      porFirmar: celdas.filter((x) => x.estado === "terminada").length,
    };
  });
  return filas.sort((a, b) => {
    const fa = a.proyecto.fecha_entrega || "9999-12-31";
    const fb = b.proyecto.fecha_entrega || "9999-12-31";
    return fa.localeCompare(fb) || String(a.proyecto.ot).localeCompare(String(b.proyecto.ot), "es", { numeric: true });
  });
}
