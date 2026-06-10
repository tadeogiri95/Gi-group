// ═══════════════════════════════════════════════════════════
// /api/chat/route.js — Proxy a Claude (Anthropic API)
//
// Rate limiting persistido en Supabase (rpc_check_rate_limit).
// Reemplaza el Map in-memory que se reseteaba en cold starts.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { logAudit } from "../../lib/audit";

const RATE_LIMIT = 20;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function checkRateLimit(empresaId) {
  const ventana = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/rpc_check_rate_limit`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_empresa_id: empresaId, p_ventana: ventana, p_limite: RATE_LIMIT }),
      signal: AbortSignal.timeout(3000),
    });
    // fail-closed: si la DB no responde, bloqueamos para evitar costos descontrolados en Anthropic
    if (!res.ok) return false;
    const count = await res.json();
    return typeof count === "number" ? count <= RATE_LIMIT : false;
  } catch {
    // timeout o error de red — fail-closed intencional
    return false;
  }
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion) return respuestaNoAutorizado();

    const allowed = await checkRateLimit(sesion.empresa_id);
    if (!allowed) {
      return NextResponse.json(
        { error: "Demasiadas consultas. Esperá un momento antes de preguntar de nuevo." },
        { status: 429 }
      );
    }

    const { system, messages } = await request.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("[chat] ANTHROPIC_API_KEY no configurada");
      return NextResponse.json({ error: "API key no configurada" }, { status: 500 });
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: system || "",
        messages: messages || [],
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[chat] Anthropic error:", res.status, JSON.stringify(data));
      return NextResponse.json({
        content: [{ type: "text", text: JSON.stringify({
          progreso: "Error al procesar con IA. Revisá la consola del servidor.",
          faltantes: [],
          desvios: [],
          mensaje_doble_check: "Hubo un error con la IA. Intentá de nuevo o contactá soporte."
        })}]
      });
    }

    // Auditoría de uso del chatbot
    logAudit({
      empresa_id: sesion.empresa_id,
      actor_id: sesion.empleado_id,
      actor_legajo: sesion.legajo,
      actor_rol: sesion.rol,
      accion: "chat_ia",
      entidad: "chat",
      datos_despues: {
        tokens_input: data.usage?.input_tokens,
        tokens_output: data.usage?.output_tokens,
        model: data.model,
      },
      ip: request.headers.get("x-forwarded-for") || "unknown",
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[chat] Error:", err);
    return NextResponse.json(
      { content: [{ type: "text", text: JSON.stringify({
        progreso: "Error de conexión con el servidor.",
        faltantes: [],
        desvios: [],
        mensaje_doble_check: "No se pudo conectar con la IA. Intentá de nuevo."
      })}]},
      { status: 200 }
    );
  }
}
