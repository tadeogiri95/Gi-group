import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(request) {
  try {
    const { fileName, fileBase64, fileType } = await request.json();

    if (!fileName || !fileBase64) {
      return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
    }

    // Convertir base64 a buffer
    const buffer = Buffer.from(fileBase64, "base64");

    // Subir via Storage API REST
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/reportes-obra/${fileName}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": fileType || "image/jpeg",
        "x-upsert": "true",
      },
      body: buffer,
    });

    if (res.ok) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/reportes-obra/${fileName}`;
      return NextResponse.json({ ok: true, url: publicUrl });
    }

    const errText = await res.text();
    console.error("[upload] Storage error:", errText);
    return NextResponse.json({ ok: false, error: errText }, { status: 500 });
  } catch (err) {
    console.error("[upload] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
