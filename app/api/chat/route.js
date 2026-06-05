// ═══════════════════════════════════════════════════════════
// /api/chat/route.js — Proxy a Claude (Anthropic API)
//
// ENTREGA 1C: Protegido con auth + rate limiting.
// Antes: cualquiera podía hacer POST y consumir la API key.
// Ahora: requiere sesión válida + max 20 req/min por empresa.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";

// ─── Rate limiting in-memory (por empresa, 20 req/min) ───
const rateLimitMap = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;

function checkRateLimit(empresaId) {
  const now = Date.now();
  const entry = rateLimitMap.get(empresaId);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(empresaId, { windowStart: now, count: 1 });
    return true;
  }

  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Limpiar entries viejas cada 5 minutos para no leakear memoria
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_WINDOW_MS * 2) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

export async function POST(request) {
  try {
    // ═══ CAMBIO 1C: Auth obligatoria ═══
    const sesion = await validarToken(request);
    if (!sesion) return respuestaNoAutorizado();

    // ═══ CAMBIO 1C: Rate limiting por empresa ═══
    if (!checkRateLimit(sesion.empresa_id)) {
      return NextResponse.json(
        { error: "Demasiadas consultas. Esperá un momento antes de preguntar de nuevo." },
        { status: 429 }
      );
    }

    const { system, messages } = await request.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("[chat] ANTHROPIC_API_KEY no configurada");
      return NextResponse.json(
        { error: "API key no configurada" },
        { status: 500 }
      );
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
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
