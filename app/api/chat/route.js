import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { system, messages } = await request.json();

    // Verificar que la API key existe
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

    // Si Anthropic devuelve error, loguearlo y devolver estructura válida
    if (!res.ok) {
      console.error("[chat] Anthropic error:", res.status, JSON.stringify(data));
      // Devolver un contenido "falso" válido para que el cliente no rompa
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
      { status: 200 } // 200 para que el cliente no rompa
    );
  }
}
