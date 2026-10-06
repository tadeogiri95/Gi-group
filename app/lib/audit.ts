import type { AuditEntry } from "../types";
import { logger } from "./logger";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Registra una acción en audit_log. Se puede llamar sin await (no bloquea la
// respuesta), pero ya no falla en silencio (F2-13): si la base rechaza el
// registro, queda un error en el log (y en Sentry). Devuelve true si se guardó.
export async function logAudit(entry: AuditEntry): Promise<boolean> {
  if (!SB_URL || !SB_KEY) return false;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/audit_log`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(entry),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(() => "");
      logger.error(`[audit] No se pudo registrar "${entry.accion}" [${r.status}]`, new Error(detalle));
      return false;
    }
    return true;
  } catch (e) {
    logger.error(`[audit] Error de red registrando "${entry.accion}"`, e);
    return false;
  }
}
