import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { system, messages } = await request.json();

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
        system,
        messages,
      }),
    });

    const data = await res.json();

    // Log si hay error
    if (!res.ok) {
      console.error("[chat] Anthropic error:", res.status, JSON.stringify(data));
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[chat] Error:", err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
