// app/api/documentos/upload — Sube un documento de empleado a Storage privado
// y registra la fila en documentos_empleado. Valida tipo MIME y tamaño
// server-side (no confía en el input del cliente).
//
// operativo: solo puede subir para sí mismo (empleado_id se fuerza desde el token).
// gerencial/administrativo: puede subir para cualquier empleado de su empresa.
import { NextResponse } from "next/server";
import { validarToken } from "../../../lib/auth";
import { isUUID } from "../../../lib/validate";
import { sbGet, sbPost, sbDelete } from "../../../lib/sbHelpers";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = "documentos-empleado";
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ROLES_GERENCIA = new Set(["gerencial", "administrativo"]);

const MIME_GRUPOS = {
  pdf: ["application/pdf"],
  image: ["image/png", "image/jpeg", "image/webp"],
  word: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};
const EXT_POR_MIME = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export async function POST(req) {
  try {
    const sesion = await validarToken(req);
    if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file");
    const tipoDocumentoId = formData.get("tipo_documento_id");
    const empleadoIdSolicitado = formData.get("empleado_id");

    if (!file || typeof file === "string") return NextResponse.json({ error: "file requerido" }, { status: 400 });
    if (!isUUID(tipoDocumentoId)) return NextResponse.json({ error: "tipo_documento_id inválido" }, { status: 400 });

    // ─── Resolver empleado destino ───
    let empleadoId = sesion.empleado_id;
    if (ROLES_GERENCIA.has(sesion.rol) && empleadoIdSolicitado && isUUID(empleadoIdSolicitado)) {
      const empleado = await sbGet(`empleados?id=eq.${empleadoIdSolicitado}&empresa_id=eq.${sesion.empresa_id}&select=id`);
      if (!empleado?.length) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
      empleadoId = empleadoIdSolicitado;
    }

    // ─── Validar tipo de documento (pertenece a la empresa, formatos aceptados) ───
    const tipos = await sbGet(`tipos_documento_requerido?id=eq.${tipoDocumentoId}&empresa_id=eq.${sesion.empresa_id}&select=id,formatos_aceptados,admite_multiples`);
    const tipo = tipos?.[0];
    if (!tipo) return NextResponse.json({ error: "Tipo de documento no encontrado" }, { status: 404 });

    const mimesPermitidos = (tipo.formatos_aceptados || []).flatMap((f) => MIME_GRUPOS[f] || []);
    if (!mimesPermitidos.includes(file.type)) {
      return NextResponse.json({ error: `Formato no permitido para este documento. Aceptados: ${tipo.formatos_aceptados.join(", ")}` }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "Archivo demasiado grande. Máximo 5 MB." }, { status: 413 });
    }

    // ─── Si no admite múltiples, reemplazar: borrar archivo(s) + fila(s) previas ───
    if (!tipo.admite_multiples) {
      const previos = await sbGet(`documentos_empleado?empresa_id=eq.${sesion.empresa_id}&empleado_id=eq.${empleadoId}&tipo_documento_id=eq.${tipoDocumentoId}&select=id,storage_path`);
      if (previos?.length) {
        try {
          await fetch(`${SB_URL}/storage/v1/object/remove/${BUCKET}`, {
            method: "POST",
            headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ prefixes: previos.map((p) => p.storage_path) }),
          });
        } catch { /* si falla el borrado del storage, seguimos: no debe bloquear el reemplazo */ }
        const ids = previos.map((p) => p.id).join(",");
        await sbDelete(`documentos_empleado?id=in.(${ids})`, { silent: true });
      }
    }

    // ─── Subir archivo ───
    const ext = EXT_POR_MIME[file.type] || "bin";
    const storagePath = `${sesion.empresa_id}/${empleadoId}/${tipoDocumentoId}-${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const uploadRes = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": file.type, "x-upsert": "true" },
      body: buffer,
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return NextResponse.json({ error: `Error subiendo archivo: ${errText}` }, { status: 500 });
    }

    // ─── Registrar fila ───
    const fileName = typeof file.name === "string" ? file.name.slice(0, 200) : null;
    const created = await sbPost("documentos_empleado", {
      empresa_id: sesion.empresa_id,
      empleado_id: empleadoId,
      tipo_documento_id: tipoDocumentoId,
      storage_path: storagePath,
      nombre_archivo: fileName,
      mime_type: file.type,
      tamano_bytes: file.size,
      estado: "cargado",
    });

    return NextResponse.json({ ok: true, documento: created?.[0] || null });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
