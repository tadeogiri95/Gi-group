// app/lib/historialCambios.js — Qué cambió, quién y cuándo (punto 12 del
// plan del 19/11; migración 199). Lo usan las operaciones de Finanzas y los
// movimientos de Materiales.
//
// historial = [{ at, por, accion, cambios: [{ campo, antes, despues }], nota? }]
// La anulación no se guarda acá: sale de anulada_at (o anulado_at) y quién,
// como siempre, y se muestra junto con lo demás (historialDe).

export const MAX_HISTORIAL = 200;

/** ¿Falta la columna historial (migración 199)? */
export const falta199 = (err) => /historial/.test(String(err?.message)) && /42703|does not exist|PGRST204|schema cache/.test(String(err?.message));

export const AVISO_FALTA_199 = "Se corrigió como antes (quedó anulada y se cargó otra). Para corregir en el lugar, con historial, falta correr la migración 199 en Supabase.";

const mismo = (a, b) => {
  const va = a ?? "";
  const vb = b ?? "";
  if (typeof va === "number" || typeof vb === "number") {
    const na = Number(va);
    const nb = Number(vb);
    if (Number.isFinite(na) && Number.isFinite(nb) && va !== "" && vb !== "") return Math.abs(na - nb) < 0.005;
  }
  return String(va) === String(vb);
};

/**
 * Los campos que cambiaron entre antes y después.
 * @param {string[]} campos
 * @returns {{ campo: string, antes: any, despues: any }[]}
 */
export function diferencias(antes = {}, despues = {}, campos = []) {
  return campos
    .filter((c) => c in despues && !mismo(antes[c], despues[c]))
    .map((c) => ({ campo: c, antes: antes[c] ?? null, despues: despues[c] ?? null }));
}

/** El historial con una entrada más al final (se queda con las últimas MAX_HISTORIAL). */
export function conEntrada(historial, entrada) {
  const lista = Array.isArray(historial) ? historial : [];
  return [...lista, entrada].slice(-MAX_HISTORIAL);
}

/** Una entrada de corrección. */
export function entradaCorreccion({ por = null, at = new Date().toISOString(), cambios = [], nota = null } = {}) {
  return { at, por: por ? String(por).slice(0, 120) : null, accion: "corregida", cambios, ...(nota ? { nota: String(nota).slice(0, 200) } : {}) };
}

/**
 * Todo lo que le pasó, del más viejo al más nuevo: lo cargado, cada
 * corrección y, si está anulada, la anulación.
 * @param {object} fila operación o movimiento
 * @param {{ anuladaAt?: string|null, anuladaPor?: string|null, cargadaPor?: string|null }} [opts]
 */
export function historialDe(fila, { anuladaAt = null, anuladaPor = null, cargadaPor = null } = {}) {
  if (!fila) return [];
  const lista = (Array.isArray(fila.historial) ? fila.historial : []).filter((h) => h && typeof h === "object");
  const out = [];
  if (fila.created_at) out.push({ at: fila.created_at, por: cargadaPor, accion: "cargada", cambios: [] });
  out.push(...lista);
  if (anuladaAt) out.push({ at: anuladaAt, por: anuladaPor, accion: "anulada", cambios: [] });
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

const fechaDma = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v)) ? `${String(v).slice(8, 10)}/${String(v).slice(5, 7)}/${String(v).slice(0, 4)}` : String(v));
const numero = (v) => Number(v).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

/**
 * "Importe: 1.000 → 1.200". etiquetas = { campo: nombre visible }; formato =
 * { campo: (v) => texto } para mostrar una cuenta por su nombre, por ejemplo.
 */
export function textoCambio(c, { etiquetas = {}, formato = {} } = {}) {
  const ver = (v) => {
    if (v === null || v === undefined || v === "") return "(vacío)";
    if (formato[c.campo]) return formato[c.campo](v);
    if (c.campo === "fecha") return fechaDma(v);
    if (typeof v === "number") return numero(v);
    return String(v);
  };
  return `${etiquetas[c.campo] || c.campo}: ${ver(c.antes)} → ${ver(c.despues)}`;
}

/** "19/11/2026 14:05" en la hora de Argentina. */
export function cuandoCambio(at) {
  const t = Date.parse(at || "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t - 3 * 3600 * 1000).toISOString();
  return `${fechaDma(d)} ${d.slice(11, 16)}`;
}
