// ═══════════════════════════════════════════════════════════
// /api/cron/auto-fichaje/route.js
// CRON inteligente: revisa CADA empleado individualmente
// en vez de fichar a una hora fija para todos.
//
// Vercel CRON lo llama una vez al día a las 3am UTC (ver vercel.json).
// Llama a la función de Supabase que hace el trabajo pesado.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  // Verificar que viene del CRON de Vercel (no de un usuario random)
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: "Config faltante" }, { status: 500 });
  }

  try {
    // Llamar a la función SQL que revisa cada empleado
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/auto_fichar_egresos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({}),
    });

    const data = await res.json();

    // También limpiar sesiones expiradas
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/limpiar_sesiones_expiradas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({}),
    });

    console.log("[CRON] Auto-fichaje resultado:", JSON.stringify(data));
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      resultado: data,
    });
  } catch (err) {
    console.error("[CRON] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
