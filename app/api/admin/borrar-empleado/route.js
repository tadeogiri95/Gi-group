// POST /api/admin/borrar-empleado
// Body: { empleado_id }
// Ley 25.326 — derecho al olvido: anonimiza los datos personales del empleado.
// No elimina el registro (integridad referencial con fichadas, solicitudes, etc.)
// sino que reemplaza PII con valores anónimos e inactiva al empleado.
import { NextResponse } from "next/server";
import { validarToken } from "../../../lib/auth";
import { logAudit } from "../../../lib/audit";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function POST(req) {
  const sesion = await validarToken(req);
  if (!sesion) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (sesion.rol !== "gerencial" && sesion.rol !== "administrativo") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const { empleado_id } = body;
  if (!empleado_id) return NextResponse.json({ error: "empleado_id requerido" }, { status: 400 });

  // Verificar que el empleado pertenece a la misma empresa que el solicitante
  const checkRes = await fetch(
    `${SB_URL}/rest/v1/empleados?id=eq.${empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=id,legajo,nombre&limit=1`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const rows = await checkRes.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  }

  const emp = rows[0];

  // No permitir auto-borrado ni borrado del solicitante
  if (emp.id === sesion.empleado_id) {
    return NextResponse.json({ error: "No podés borrar tu propio perfil" }, { status: 400 });
  }

  // Anonimizar PII — mantener legajo e id para integridad referencial
  const patch = await fetch(
    `${SB_URL}/rest/v1/empleados?id=eq.${empleado_id}&empresa_id=eq.${sesion.empresa_id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        nombre: `Empleado ${emp.legajo}`,
        email: null,
        telefono: null,
        direccion: null,
        dni: null,
        fecha_nacimiento: null,
        activo: false,
        password: null,
        debe_cambiar_password: false,
      }),
    }
  );

  if (!patch.ok) {
    const err = await patch.text();
    return NextResponse.json({ error: "No se pudo anonimizar el registro", detail: err }, { status: 500 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  logAudit({
    empresa_id: sesion.empresa_id,
    actor_id: sesion.empleado_id,
    actor_legajo: sesion.legajo,
    actor_rol: sesion.rol,
    accion: "borrar_datos_empleado",
    entidad: "empleado",
    entidad_id: String(empleado_id),
    datos_antes: { nombre: emp.nombre, legajo: emp.legajo },
    ip,
  });

  return NextResponse.json({ ok: true, message: "Datos del empleado anonimizados correctamente (Ley 25.326)" });
}
