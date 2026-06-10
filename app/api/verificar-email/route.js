// app/api/verificar-email — GET ?token=xxx&e=empresa_id
// Activa el flag email_verificado en la empresa y redirige al slug.
import { NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const empresaId = searchParams.get("e");

  if (!token || !empresaId) {
    return new NextResponse("Link de verificación inválido.", { status: 400 });
  }

  if (!SB_URL || !SB_KEY) {
    return new NextResponse("Servidor mal configurado.", { status: 500 });
  }

  // Buscar empresa con ese token
  const r = await fetch(
    `${SB_URL}/rest/v1/empresa?id=eq.${empresaId}&email_verify_token=eq.${token}&select=id,slug,email_verificado`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const rows = await r.json();

  if (!Array.isArray(rows) || rows.length === 0) {
    return new NextResponse(
      "Link expirado o inválido. Si ya verificaste tu email, podés ignorar este mensaje.",
      { status: 400 }
    );
  }

  const empresa = rows[0];

  // Activar verificación y limpiar el token (one-time use)
  await fetch(`${SB_URL}/rest/v1/empresa?id=eq.${empresa.id}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email_verificado: true, email_verify_token: null }),
  });

  const appBase = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";
  return NextResponse.redirect(`${appBase}/${empresa.slug}?verificado=1`);
}
