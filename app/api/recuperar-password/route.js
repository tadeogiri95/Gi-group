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
    const tStart = Date.now();

    const { email, empresa_id } = await req.json();

    // Respuesta genérica siempre — no revelar si el email existe.
    // returnOk() aplica un retardo mínimo de 300ms para nivelar el tiempo de
    // respuesta entre el camino "email no existe" (rápido) y "email existe"
    // (más lento por las queries extra + JWT signing), evitando timing attacks.
    const ok = NextResponse.json({
      ok: true,
      mensaje: "Si el email está registrado, recibirás un link en minutos.",
    });
    const returnOk = async () => {
      const elapsed = Date.now() - tStart;
      if (elapsed < 300) await new Promise((r) => setTimeout(r, 300 - elapsed));
      return ok;
    };

    if (!email || !empresa_id || !SB_URL || !SB_KEY) return returnOk();

    // Buscar empleado activo por email en esta empresa
    const r = await fetch(
      `${SB_URL}/rest/v1/empleados?email=eq.${encodeURIComponent(email.trim())}&empresa_id=eq.${empresa_id}&activo=eq.true&select=id,nombre,empresa_id&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return returnOk();

    const empleado = rows[0];

    // Obtener nombre de la empresa
    const re = await fetch(
      `${SB_URL}/rest/v1/empresa?id=eq.${empresa_id}&select=nombre,slug&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const empresas = await re.json();
    const empresaNombre = empresas?.[0]?.nombre || "tu empresa";
    const slug = empresas?.[0]?.slug || "";

    // Generar token JWT de reset (1h, un solo uso)
    const { token: resetToken, jti: resetJti } = await signPasswordResetToken({
      empleadoId: empleado.id,
      empresaId: empresa_id,
    });

    // Guardar JTI en la DB — invalida tokens previos y permite uso único
    await fetch(
      `${SB_URL}/rest/v1/empleados?id=eq.${empleado.id}&empresa_id=eq.${empresa_id}`,
      {
        method: "PATCH",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password_reset_jti: resetJti }),
      }
    );

    const appBase = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";
    const resetUrl = `${appBase}/${slug}?screen=reset_password&token=${resetToken}`;

    // Fire-and-forget
    sendRecuperarPassword({
      to: email.trim(),
      nombre: empleado.nombre,
      empresa: empresaNombre,
      resetUrl,
      empresaId: empresa_id,
    });

    return returnOk();
  } catch (err) {
    console.error("[recuperar-password]", err.message);
    return NextResponse.json({ ok: true, mensaje: "Si el email está registrado, recibirás un link en minutos." });
  }
}
