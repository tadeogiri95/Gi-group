// app/api/documentos/sign-url — Genera una URL firmada de corta duración para
// ver/descargar un documento del bucket privado `documentos-empleado`.
//
// El bucket es privado: esta es la ÚNICA forma de acceder a un archivo.
// Ownership check: gerencial/administrativo de la misma empresa, o el
// empleado dueño del documento.
import { NextResponse } from "next/server";
import { validarToken } from "../../../lib/auth";
import { isUUID } from "../../../lib/validate";
import { sbGet } from "../../../lib/sbHelpers";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = "documentos-empleado";
const ROLES_GERENCIA = new Set(["gerencial", "administrativo"]);
const EXPIRES_IN = 60; // segundos

export async function POST(req) {
  try {
    const sesion = await validarToken(req);
    if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const documentoId = body?.documento_id;
    if (!isUUID(documentoId)) return NextResponse.json({ error: "documento_id inválido" }, { status: 400 });

    const docs = await sbGet(`documentos_empleado?id=eq.${documentoId}&select=empresa_id,empleado_id,storage_path`);
    const doc = docs?.[0];
    if (!doc || doc.empresa_id !== sesion.empresa_id) {
      return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
    }
    const esDueño = doc.empleado_id === sesion.empleado_id;
    if (!esDueño && !ROLES_GERENCIA.has(sesion.rol)) {
      return NextResponse.json({ error: "No autorizado a ver este documento" }, { status: 403 });
    }

    const signRes = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${doc.storage_path}`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: EXPIRES_IN }),
    });
    if (!signRes.ok) {
      return NextResponse.json({ error: "No se pudo generar la URL" }, { status: 500 });
    }
    const { signedURL } = await signRes.json();

    return NextResponse.json({ ok: true, url: `${SB_URL}/storage/v1${signedURL}` });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
