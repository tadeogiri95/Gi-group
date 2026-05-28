// ═══════════════════════════════════════════════════════════
// /api/send-push/route.js — ETAPA 4: Push filtrado por empresa
//
// Ahora el frontend manda empresa_id en data.empresa_id
// y este endpoint solo envía a tokens de esa empresa
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY;

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) return [];
  return res.json();
}

async function sendFCM(token, title, body, data = {}) {
  if (!FCM_SERVER_KEY) return { ok: false, error: "FCM_SERVER_KEY no configurada" };
  try {
    const res = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        Authorization: `key=${FCM_SERVER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: token,
        notification: { title, body, icon: "/icon-192x192.png" },
        data,
      }),
    });
    return res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function POST(request) {
  try {
    const { legajo, rol, title, body, data = {} } = await request.json();

    if (!title || !body) {
      return NextResponse.json({ error: "title y body requeridos" }, { status: 400 });
    }

    // Extraer empresa_id del data (enviado por el frontend)
    const empresaId = data.empresa_id || null;

    let tokens = [];

    if (legajo) {
      // Buscar tokens del legajo, filtrado por empresa si viene
      let query = `push_tokens?legajo=eq.${legajo}&select=token`;
      if (empresaId) query += `&empresa_id=eq.${empresaId}`;
      tokens = await sbGet(query);
    } else if (rol) {
      // Buscar empleados del rol + empresa, luego sus tokens
      let empQuery = `empleados?rol=eq.${rol}&activo=eq.true&select=legajo`;
      if (empresaId) empQuery += `&empresa_id=eq.${empresaId}`;
      const empleados = await sbGet(empQuery);
      const legajos = empleados.map(e => e.legajo);
      if (legajos.length > 0) {
        let tokQuery = `push_tokens?legajo=in.(${legajos.join(",")})&select=token`;
        if (empresaId) tokQuery += `&empresa_id=eq.${empresaId}`;
        tokens = await sbGet(tokQuery);
      }
    }

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, message: "Sin tokens registrados" });
    }

    // Enviar a todos los tokens encontrados
    const results = await Promise.allSettled(
      tokens.map(t => sendFCM(t.token, title, body, data))
    );

    const sent = results.filter(r => r.status === "fulfilled").length;
    return NextResponse.json({ ok: true, sent, total: tokens.length });
  } catch (err) {
    console.error("[send-push] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
