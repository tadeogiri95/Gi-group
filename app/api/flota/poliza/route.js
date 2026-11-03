// /api/flota/poliza — Sube la póliza del seguro en PDF y lee sus datos
// (Tadeo, 03/11; migración 156). Sin IA: se saca el texto del PDF y se buscan
// los títulos de siempre (app/lib/polizaTexto.js). El PDF queda en el bucket
// privado flota-documentos; la ruta que devuelve se guarda con el papel del
// seguro al guardar el vehículo o el papel (/api/flota).
//
// POST multipart { file } (gerencia, Administración y responsables de
// mantenimiento) → { ok, archivo: { path, nombre }, datos: { vehiculo, seguro,
// encontrados }, sin_texto }
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { safeErrorMessage } from "../../../lib/validate";
import { rechazarSiSinPlan, requireModulo } from "../../../lib/planEnforcement";
import { puedeEditarFlota } from "../../../lib/flota";
import { esResponsableMantenimiento } from "../../../lib/mantenimientoServidor";
import { contenidoCoincide } from "../../../lib/fileSignature";
import { MAX_PDF_BYTES, nombrePdf, rutaPoliza, subirPdf } from "../../../lib/flotaArchivos";
import { leerPoliza } from "../../../lib/polizaTexto";
import { logger } from "../../../lib/logger";

export const runtime = "nodejs";

// Las primeras páginas: ahí están el frente de la póliza y el certificado;
// después vienen las condiciones generales, que confunden
const PAGINAS = 4;

async function textoDelPdf(buffer) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).slice(0, PAGINAS).join("\n");
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!puedeEditarFlota(sesion.rol) && !(await esResponsableMantenimiento(sesion))) {
      return NextResponse.json({ error: "Eso lo hacen gerencia, Administración y los responsables de mantenimiento" }, { status: 403 });
    }
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const sinModulo = await requireModulo(sesion.empresa_id, "flota");
    if (sinModulo) return sinModulo;

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "Elegí el PDF de la póliza" }, { status: 400 });
    if (file.size > MAX_PDF_BYTES) return NextResponse.json({ error: "El PDF pesa más de 4 MB" }, { status: 413 });
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!contenidoCoincide(buffer, "application/pdf")) return NextResponse.json({ error: "El archivo no es un PDF" }, { status: 400 });

    // Si no se puede leer, el PDF se guarda igual y los datos se cargan a mano
    let texto = "";
    try {
      texto = await textoDelPdf(buffer);
    } catch (err) {
      logger.warn("[flota/poliza] no se pudo leer el texto del PDF", { error: String(err?.message || err).slice(0, 200) });
    }
    const path = rutaPoliza(sesion.empresa_id);
    try {
      await subirPdf(path, buffer);
    } catch (err) {
      if (/ 404 |Bucket not found/i.test(String(err?.message))) {
        return NextResponse.json({ error: "Para guardar la póliza falta correr la migración 156 en Supabase." }, { status: 409 });
      }
      throw err;
    }
    const sinTexto = texto.replace(/\s/g, "").length < 20;
    const datos = sinTexto ? { vehiculo: {}, seguro: {}, encontrados: [] } : leerPoliza(texto);
    return NextResponse.json({ ok: true, archivo: { path, nombre: nombrePdf(file.name) }, datos, sin_texto: sinTexto });
  } catch (err) {
    logger.error("[flota/poliza] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
