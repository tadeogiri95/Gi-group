// app/lib/finanzasMeses.js — Finanzas, cerrar y reabrir meses (parte 9 del
// plan de Tesorería y Devengamiento, 13/11; migración 190; /api/finanzas/meses).
//
// Con el mes cerrado la base no deja cargar, corregir ni anular nada con fecha
// de ese mes (trigger de la migración 190, que tira "MES_CERRADO AAAA-MM").
// Acá: cómo se cierra y se reabre un mes (con el historial) y el texto claro
// del error.

export const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const MAX_MOTIVO = 500;
const MAX_HISTORIAL = 200;

/** "2026-11" → "noviembre de 2026" */
export const nombreMes = (mes) => (MES.test(String(mes || "")) ? `${MESES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}` : String(mes || ""));

/** El mes del error de la base ("MES_CERRADO 2026-10"), o null. */
export function mesCerradoDeError(err) {
  const m = /MES_CERRADO (\d{4}-\d{2})/.exec(String(err?.message ?? err ?? ""));
  return m ? m[1] : null;
}

/** Lo que ve el usuario cuando algo choca con un mes cerrado. */
export const textoMesCerrado = (mes) =>
  `${nombreMes(mes).replace(/^./, (c) => c.toUpperCase())} está cerrado: no se puede cargar, corregir ni anular nada con fecha de ese mes. Si hace falta, reabrilo en Finanzas → Devengamiento.`;

/** El renglón de la base pasado a lo que muestra la pantalla. */
export function estadoMes(mes, fila) {
  return {
    mes,
    nombre: nombreMes(mes),
    cerrado: Boolean(fila?.cerrado),
    cerrado_at: fila?.cerrado_at || null,
    cerrado_por_nombre: fila?.cerrado_por_nombre || null,
    reabierto_at: fila?.reabierto_at || null,
    reabierto_por_nombre: fila?.reabierto_por_nombre || null,
    motivo: fila?.motivo || null,
    historial: Array.isArray(fila?.historial) ? fila.historial : [],
  };
}

const sumar = (historial, paso) => [...(Array.isArray(historial) ? historial : []), paso].slice(-MAX_HISTORIAL);

/**
 * Cerrar un mes. Solo meses que ya empezaron (no se cierra el futuro).
 * @returns {{ error: string } | { cambios: object }}
 */
export function cerrarMes(fila, { mes, hoy, quien, ahora }) {
  if (!MES.test(String(mes || ""))) return { error: "Elegí un mes" };
  if (mes > String(hoy || "").slice(0, 7)) return { error: "No se puede cerrar un mes que todavía no empezó" };
  if (fila?.cerrado) return { error: `${nombreMes(mes)} ya está cerrado` };
  return {
    cambios: {
      cerrado: true,
      cerrado_at: ahora,
      cerrado_por_nombre: quien || null,
      historial: sumar(fila?.historial, { accion: "cerrar", at: ahora, por: quien || null }),
      updated_at: ahora,
    },
  };
}

/**
 * Reabrir un mes: pide el motivo y queda quién y cuándo.
 * @returns {{ error: string } | { cambios: object }}
 */
export function reabrirMes(fila, { mes, motivo, quien, ahora }) {
  if (!MES.test(String(mes || ""))) return { error: "Elegí un mes" };
  if (!fila?.cerrado) return { error: `${nombreMes(mes)} no está cerrado` };
  const m = String(motivo || "").trim();
  if (!m) return { error: "Escribí el motivo para reabrir el mes" };
  if (m.length > MAX_MOTIVO) return { error: `El motivo es muy largo (máximo ${MAX_MOTIVO} letras)` };
  return {
    cambios: {
      cerrado: false,
      reabierto_at: ahora,
      reabierto_por_nombre: quien || null,
      motivo: m,
      historial: sumar(fila.historial, { accion: "reabrir", at: ahora, por: quien || null, motivo: m }),
      updated_at: ahora,
    },
  };
}
