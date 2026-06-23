// app/api/documentos/asignar — Asignación masiva/selectiva de un tipo de
// documento exigido a empleados. Solo gerencial/administrativo.
import { NextResponse } from "next/server";
import { validarToken } from "../../../lib/auth";
import { isUUID, safeErrorMessage } from "../../../lib/validate";
import { sbGet, sbPost, sbDelete } from "../../../lib/sbHelpers";
import { logger } from "../../../lib/logger";

const ROLES_OK = new Set(["gerencial", "administrativo"]);

export async function POST(req) {
  try {
    const sesion = await validarToken(req);
    if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (!ROLES_OK.has(sesion.rol)) {
      return NextResponse.json({ error: "Solo gerencial o administrativo puede asignar documentos" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const tipoDocumentoId = body?.tipo_documento_id;
    const empleadoIds = Array.isArray(body?.empleado_ids) ? body.empleado_ids.filter(isUUID) : [];

    if (!isUUID(tipoDocumentoId) || empleadoIds.length === 0) {
      return NextResponse.json({ error: "tipo_documento_id y empleado_ids[] son requeridos" }, { status: 400 });
    }
    if (empleadoIds.length > 500) {
      return NextResponse.json({ error: "Máximo 500 empleados por asignación" }, { status: 400 });
    }

    const tipo = await sbGet(`tipos_documento_requerido?id=eq.${tipoDocumentoId}&empresa_id=eq.${sesion.empresa_id}&select=id`);
    if (!tipo?.length) return NextResponse.json({ error: "Tipo de documento no encontrado" }, { status: 404 });

    const empleadosValidos = await sbGet(`empleados?empresa_id=eq.${sesion.empresa_id}&id=in.(${empleadoIds.join(",")})&select=id`);
    const idsValidos = (empleadosValidos || []).map((e) => e.id);
    if (idsValidos.length === 0) return NextResponse.json({ error: "Ningún empleado válido" }, { status: 400 });

    const yaAsignados = await sbGet(`documentos_exigidos_empleado?tipo_documento_id=eq.${tipoDocumentoId}&empleado_id=in.(${idsValidos.join(",")})&select=empleado_id`);
    const yaAsignadosSet = new Set((yaAsignados || []).map((a) => a.empleado_id));
    const nuevos = idsValidos.filter((id) => !yaAsignadosSet.has(id));

    if (nuevos.length > 0) {
      await sbPost("documentos_exigidos_empleado", nuevos.map((empleado_id) => ({
        empresa_id: sesion.empresa_id,
        empleado_id,
        tipo_documento_id: tipoDocumentoId,
      })));
    }

    return NextResponse.json({ ok: true, asignados: nuevos.length, ya_asignados: yaAsignadosSet.size });
  } catch (err) {
    logger.error("[documentos/asignar] POST Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const sesion = await validarToken(req);
    if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (!ROLES_OK.has(sesion.rol)) {
      return NextResponse.json({ error: "Solo gerencial o administrativo puede desasignar documentos" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const tipoDocumentoId = body?.tipo_documento_id;
    const empleadoIds = Array.isArray(body?.empleado_ids)
      ? body.empleado_ids.filter(isUUID)
      : isUUID(body?.empleado_id) ? [body.empleado_id] : [];

    if (!isUUID(tipoDocumentoId) || empleadoIds.length === 0) {
      return NextResponse.json({ error: "tipo_documento_id y empleado_id(s) son requeridos" }, { status: 400 });
    }
    if (empleadoIds.length > 500) {
      return NextResponse.json({ error: "Máximo 500 empleados por desasignación" }, { status: 400 });
    }

    await sbDelete(`documentos_exigidos_empleado?empresa_id=eq.${sesion.empresa_id}&empleado_id=in.(${empleadoIds.join(",")})&tipo_documento_id=eq.${tipoDocumentoId}`);
    return NextResponse.json({ ok: true, desasignados: empleadoIds.length });
  } catch (err) {
    logger.error("[documentos/asignar] DELETE Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
