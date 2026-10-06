// ═══════════════════════════════════════════════════════════
// app/lib/claude.js — Cliente de la IA (lado navegador)
//
// El prompt de sistema ya NO se arma acá: lo arma el servidor en
// /api/chat a partir del tipo de uso (ver app/lib/iaPrompts.js).
// Las acciones que propone el modelo pasan por una lista blanca y las que
// registran algo se confirman con un botón antes de ejecutarse (F2-06).
// ═══════════════════════════════════════════════════════════

/** Acciones que la IA puede proponer. Cualquier otra se ignora. */
export const ACCIONES_IA = new Set([
  "FICHAR_INGRESO", "FICHAR_EGRESO",
  "SOLICITAR_PERMISO", "AVISAR_TARDANZA", "AVISAR_AUSENCIA",
  "NOTIFICAR_GERENCIA", "CONSULTAR_DATOS",
]);

/** Acciones que escriben algo: requieren que el usuario confirme. */
export const ACCIONES_CON_EFECTO = new Set([
  "FICHAR_INGRESO", "FICHAR_EGRESO",
  "SOLICITAR_PERMISO", "AVISAR_TARDANZA", "AVISAR_AUSENCIA",
  "NOTIFICAR_GERENCIA",
]);

const DESCRIPCION_ACCION = {
  FICHAR_INGRESO: "registrar tu ingreso",
  FICHAR_EGRESO: "registrar tu salida",
  SOLICITAR_PERMISO: "enviar la solicitud de permiso",
  AVISAR_TARDANZA: "avisar la llegada tarde",
  AVISAR_AUSENCIA: "avisar la ausencia",
  NOTIFICAR_GERENCIA: "enviar el aviso a gerencia",
};

export function descripcionAccion(action) {
  return DESCRIPCION_ACCION[action?.type] || "ejecutar la acción";
}

/**
 * @param {Array<{from: string, text: string}>} messages
 * @param {"chat"|"reporte_obra"} [tipo]
 * @returns {Promise<string>} texto de la IA o un mensaje de error para mostrar
 */
export async function callClaude(messages, tipo = "chat") {
  try {
    const { getCsrfToken } = await import("./supabase");
    const hdrs = { "Content-Type": "application/json" };
    const csrf = getCsrfToken();
    if (csrf) hdrs["x-csrf-token"] = csrf;
    // La API exige que el historial empiece con un mensaje del usuario.
    let hist = messages.map(m => ({ role: m.from === "user" ? "user" : "assistant", content: String(m.text || "").slice(0, 8000) }))
      .filter(m => m.content);
    while (hist.length && hist[0].role !== "user") hist = hist.slice(1);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ tipo, messages: hist.slice(-30) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Cupo agotado o plan sin la función: el servidor manda un mensaje para el usuario.
      if (data.cupo_agotado || data.upgrade) return data.error;
      return "Disculpá, tuve un problema con la IA. Intentá de nuevo.";
    }
    return data.texto || "Disculpá, tuve un problema.";
  } catch {
    return "Perdón, problemas de conexión.";
  }
}

export function parseAction(text) {
  const m = text.match(/```action\s*\n?([\s\S]*?)\n?```/);
  if (!m) return { clean: text.trim(), action: null };
  const clean = text.replace(/```action[\s\S]*?```/, "").trim();
  try {
    const action = JSON.parse(m[1].trim());
    if (!action || typeof action !== "object" || !ACCIONES_IA.has(action.type)) return { clean, action: null };
    return { clean, action };
  } catch { return { clean: text.trim(), action: null }; }
}
