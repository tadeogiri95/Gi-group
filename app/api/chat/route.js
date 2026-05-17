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
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        system,
        messages,
      }),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[chat] Error:", err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
