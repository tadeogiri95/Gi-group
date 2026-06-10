// POST /api/resetear-password
// Body: { token, nueva_password }
// Valida el JWT de reset, actualiza la contraseña del empleado.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { verifyPasswordResetToken } from "../../lib/jwt";
import { validarPassword } from "../../lib/validators";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function POST(req) {
  try {
    const { token, nueva_password } = await req.json();

    if (!token || !nueva_password) {
      return NextResponse.json({ error: "Token y nueva contraseña son requeridos" }, { status: 400 });
    }

    // Verificar JWT de reset
    const resetData = await verifyPasswordResetToken(token);
    if (!resetData) {
      return NextResponse.json(
        { error: "El link expiró o ya fue usado. Solicitá uno nuevo." },
        { status: 401 }
      );
    }

    // Validar política de contraseña
    const pwCheck = validarPassword(nueva_password);
    if (!pwCheck.valido) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    // Verificar que el empleado sigue activo
    const r = await fetch(
      `${SB_URL}/rest/v1/empleados?id=eq.${resetData.empleadoId}&empresa_id=eq.${resetData.empresaId}&activo=eq.true&select=id&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "Empleado no encontrado o inactivo" }, { status: 404 });
    }

    // Actualizar contraseña
    const hashed = await bcrypt.hash(nueva_password, 10);
    const patch = await fetch(
      `${SB_URL}/rest/v1/empleados?id=eq.${resetData.empleadoId}&empresa_id=eq.${resetData.empresaId}`,
      {
        method: "PATCH",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ password: hashed, debe_cambiar_password: false }),
      }
    );

    if (!patch.ok) {
      return NextResponse.json({ error: "No se pudo actualizar la contraseña" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[resetear-password]", err.message);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
