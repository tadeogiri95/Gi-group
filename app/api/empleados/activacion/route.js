// POST /api/empleados/activacion — genera un código de acceso nuevo para un empleado.
//
// Body: { empleado_id }
// Sirve para: reenviar la activación (el código anterior venció o se perdió)
// y para recuperar el acceso de quien no tiene email (auditoría F4-01).
// El código anterior queda invalidado. La contraseña actual sigue valiendo
// hasta que el empleado use el código nuevo; al usarlo se cierran sus sesiones.
//
// Permisos: gerencial para cualquiera; administrativo solo para operativos
// (si no, podría quedarse con la cuenta de un par o de un superior).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { sbGet, sbPatch } from "../../../lib/sbHelpers";
import { isUUID } from "../../../lib/validate";
import { logAudit } from "../../../lib/audit";
import { nuevaActivacion, linkActivacion, DIAS_VIGENCIA } from "../../../lib/activacion";

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";

export async function POST(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (!["gerencial", "administrativo"].includes(sesion.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const id = body?.empleado_id;
  if (!id || !isUUID(id)) return NextResponse.json({ error: "empleado_id inválido" }, { status: 400 });
  if (id === sesion.empleado_id) {
    return NextResponse.json({ error: "Para tu propia cuenta usá «Cambiar contraseña»" }, { status: 400 });
  }

  const [empleado] = await sbGet(
    `empleados?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&activo=eq.true&select=id,legajo,nombre,rol&limit=1`
  ) || [];
  if (!empleado) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  if (sesion.rol === "administrativo" && empleado.rol !== "operativo") {
    return NextResponse.json({ error: "Solo el dueño puede generar códigos para supervisores o administradores" }, { status: 403 });
  }

  const activacion = nuevaActivacion();
  await sbPatch(`empleados?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}`, activacion.columnas);

  const [empresa] = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=slug&limit=1`) || [];
  const link = empresa?.slug ? linkActivacion(APP_BASE, empresa.slug, activacion.codigo) : null;

  logAudit({
    empresa_id: sesion.empresa_id,
    actor_id: sesion.empleado_id,
    actor_legajo: sesion.legajo,
    actor_rol: sesion.rol,
    accion: "generar_codigo_acceso",
    entidad: "empleado",
    entidad_id: String(id),
    datos_despues: { legajo: empleado.legajo },
  });

  return NextResponse.json({
    ok: true,
    nombre: empleado.nombre,
    legajo: empleado.legajo,
    activacion: { codigo: activacion.codigo, link, vigencia_dias: DIAS_VIGENCIA },
  });
}
