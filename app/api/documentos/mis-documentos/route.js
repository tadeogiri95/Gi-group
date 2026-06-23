// app/api/documentos/mis-documentos — Documentos exigidos/cargados del empleado logueado.
//
// empleado_id se deriva SIEMPRE del token, nunca de un parámetro del cliente —
// a diferencia de /api/data (que solo escopea por empresa_id), esta ruta
// garantiza que un operativo no pueda leer documentos de otro empleado.
import { NextResponse } from "next/server";
import { validarToken } from "../../../lib/auth";
import { sbGet } from "../../../lib/sbHelpers";
import { safeErrorMessage } from "../../../lib/validate";
import { logger } from "../../../lib/logger";

export async function GET(req) {
  try {
    const sesion = await validarToken(req);
    if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const [exigidos, cargados] = await Promise.all([
      sbGet(`documentos_exigidos_empleado?empresa_id=eq.${sesion.empresa_id}&empleado_id=eq.${sesion.empleado_id}&select=tipo_documento_id,tipos_documento_requerido(id,nombre,formatos_aceptados,admite_multiples,tipo_carga)`),
      sbGet(`documentos_empleado?empresa_id=eq.${sesion.empresa_id}&empleado_id=eq.${sesion.empleado_id}&order=fecha_carga.desc&select=id,tipo_documento_id,nombre_archivo,mime_type,estado,fecha_carga`),
    ]);

    const exigidosConDetalle = (exigidos || [])
      .filter((e) => e.tipos_documento_requerido)
      .map((e) => ({
        ...e.tipos_documento_requerido,
        documentos: (cargados || []).filter((c) => c.tipo_documento_id === e.tipo_documento_id),
      }));

    return NextResponse.json({ ok: true, exigidos: exigidosConDetalle });
  } catch (err) {
    logger.error("[documentos/mis-documentos] Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
