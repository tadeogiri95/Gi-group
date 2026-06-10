const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export function broadcastRefresh(empresa_id: string, tabla: string): void {
  if (!SB_URL || !SB_KEY || !empresa_id) return;
  fetch(`${SB_URL}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SB_KEY}`,
      apikey: SB_KEY,
    },
    body: JSON.stringify({
      messages: [{ topic: `realtime:empresa_${empresa_id}`, event: "refresh", payload: { tabla } }],
    }),
  }).catch(() => {});
}
