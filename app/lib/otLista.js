// app/lib/otLista.js — Lo que muestra cada OT en la lista del celular
// (auditoría 01/11, PR 4): estado con la etapa en curso, avance por escaneo y
// la entrega, para no tener que abrir la OT para saber cómo va.
import { textoObjetivo } from "./semanaObjetivo";
import { fechaCorta } from "./ot";

/** Nombre de la etapa que se está trabajando (la primera empezada y no cerrada). */
export function etapaEnCurso(fila) {
  const celdas = fila?.celdas || [];
  const enCurso = celdas.find((c) => c.estado === "en_curso");
  if (enCurso) return enCurso.etapa?.nombre || null;
  // Una etapa terminada sin aprobar y la siguiente sin empezar: va la siguiente
  const siguiente = celdas.find((c) => c.estado === "pendiente");
  return siguiente && celdas.some((c) => c.estado !== "pendiente" && c.estado !== "no_aplica") ? siguiente.etapa?.nombre || null : null;
}

/**
 * Estado de la OT para la etiqueta de la tarjeta.
 * @param {object} p        la OT
 * @param {{ enCurso?: object|null, porcentaje?: number|null }} datos
 *   enCurso: su fila del tablero si está en curso; porcentaje: avance por escaneo
 * @returns {{ texto: string, tono: "amber"|"green"|"muted" }}
 */
export function estadoOtLista(p, { enCurso = null, porcentaje = null } = {}) {
  if (p?.estado === "cerrado") return { texto: "Cerrada", tono: "muted" };
  if (p?.terminado_planilla) return { texto: "Terminada en planilla", tono: "muted" };
  if (enCurso) {
    const etapa = etapaEnCurso(enCurso);
    return { texto: etapa ? `En curso · ${etapa}` : "En curso", tono: "amber" };
  }
  if (porcentaje != null && porcentaje >= 100) return { texto: "Producción terminada", tono: "green" };
  if (porcentaje != null && porcentaje > 0) return { texto: "En curso", tono: "amber" };
  return { texto: "Sin empezar", tono: "muted" };
}

/** "Entrega S45 (6/11)", "Entrega 31/10/2026" o "" si no tiene. */
export function textoEntrega(p, modo) {
  const t = textoObjetivo(p, modo);
  if (t) return t.startsWith("entrega ") ? `Entrega ${t.slice(8)}` : `Entrega ${t}`;
  return p?.fecha_entrega ? `Entrega ${fechaCorta(p.fecha_entrega)}` : "";
}
