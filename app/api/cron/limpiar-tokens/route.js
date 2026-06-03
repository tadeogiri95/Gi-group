// ═══════════════════════════════════════════════════════════
// /api/cron/limpiar-tokens — Purga tokens push viejos (>60 días)
// Se ejecuta semanalmente vía Vercel CRON
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: "Config faltante" }, { status: 500 });
  }

  try {
    const corte = new Date();
    corte.setDate(corte.getDate() - 60);
    const corteStr = corte.toISOString();

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/push_tokens?updated_at=lt.${corteStr}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "return=representation",
        },
      }
    );

    const deleted = res.ok ? await res.json() : [];
    console.log(`[CRON limpiar-tokens] Eliminados ${deleted.length} tokens viejos`);

    return NextResponse.json({
      ok: true,
      eliminados: deleted.length,
      corte: corteStr,
    });
  } catch (err) {
    console.error("[CRON limpiar-tokens] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}