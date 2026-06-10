import type { AuditEntry } from "../types";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export function logAudit(entry: AuditEntry): void {
  if (!SB_URL || !SB_KEY) return;
  fetch(`${SB_URL}/rest/v1/audit_log`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(entry),
  }).catch(() => {});
}
