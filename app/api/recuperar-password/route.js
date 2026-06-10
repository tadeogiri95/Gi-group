// POST /api/recuperar-password
// Body: { email, empresa_id }
// Busca el empleado por email dentro de la empresa, genera un JWT de reset (1h)
// y envía el link por email. Siempre responde 200 para no filtrar si el email existe.
import { NextResponse } from "next/server";
import { signPasswordResetToken } from "../../lib/jwt";
import { sendRecuperarPassword } from "../../lib/email";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function POST(req) {
  try {
    const { email, empresa_id } = await req.json();

    // Respuesta genérica siempre — no revelar si el email existe
    const ok = NextResponse.json({
      ok: true,
      mensaje: "Si el email está registrado, recibirás un link en minutos.",
    });

    if (!email || !empresa_id || !SB_URL || !SB_KEY) return ok;

    // Buscar empleado activo por email en esta empresa
    const r = await fetch(
      `${SB_URL}/rest/v1/empleados?email=eq.${encodeURIComponent(email.trim())}&empresa_id=eq.${empresa_id}&activo=eq.true&select=id,nombre,empresa_id&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return ok;

    const empleado = rows[0];

    // Obtener nombre de la empresa
    const re = await fetch(
      `${SB_URL}/rest/v1/empresa?id=eq.${empresa_id}&select=nombre,slug&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const empresas = await re.json();
    const empresaNombre = empresas?.[0]?.nombre || "tu empresa";
    const slug = empresas?.[0]?.slug || "";

    // Generar token JWT de reset (1h, un solo uso por tiempo)
    const resetToken = await signPasswordResetToken({
      empleadoId: empleado.id,
      empresaId: empresa_id,
    });

    const appBase = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";
    const resetUrl = `${appBase}/${slug}?screen=reset_password&token=${resetToken}`;

    // Fire-and-forget
    sendRecuperarPassword({
      to: email.trim(),
      nombre: empleado.nombre,
      empresa: empresaNombre,
      resetUrl,
    });

    return ok;
  } catch (err) {
    console.error("[recuperar-password]", err.message);
    return NextResponse.json({ ok: true, mensaje: "Si el email está registrado, recibirás un link en minutos." });
  }
}
