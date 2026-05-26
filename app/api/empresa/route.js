// app/api/empresa/route.js
// Devuelve la configuración de la empresa (nombre, colores, prompts)
import { NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function GET() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/empresa?select=*&limit=1`, {
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
      },
      next: { revalidate: 300 }, // Cache 5 minutos
    });
    const data = await res.json();
    if (!data || data.length === 0) {
      return NextResponse.json({
        nombre: "Gypi",
        nombre_corto: "Gypi",
        color_primario: "#F97316",
        color_secundario: "#8B5CF6",
        rubro: "general",
        prompt_ia_obra: "",
        prompt_ia_chat: "",
      });
    }
    return NextResponse.json(data[0]);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
