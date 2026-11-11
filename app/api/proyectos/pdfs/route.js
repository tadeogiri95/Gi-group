// /api/proyectos/pdfs — El PDF de cada OT desde una carpeta de Google Drive
// (Tadeo, 04/11; app/lib/pdfOt.js). Sin migración: todo en config_sistema
// (clave CLAVE_PDF_OT): { hash, carpeta, creada_at, ultima_lectura, archivos }.
//
// GET   → cualquiera de la empresa con sesión: la lista de PDF para unirla
//         con las OT ({ conectado, archivos, ultima_lectura }). Nunca el hash.
//         Va con service_role filtrado por la empresa de la sesión, porque
//         config_sistema solo la lee gestión y el PDF lo abre también el
//         operario.
// PATCH → lo llama el script de Apps Script cada 15 minutos, con la clave
//         privada de la empresa (Authorization: Bearer gyp_…):
//         { archivos: [{ nombre, id, fecha }] }. Reemplaza la lista entera.
// POST  → gestión genera una clave nueva (la anterior deja de andar) para la
//         carpeta { carpeta: link o id } y recibe el código para pegar.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { safeErrorMessage } from "../../../lib/validate";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { sbGet, sbPost, sbPatch } from "../../../lib/sbHelpers";
import { requireModuloSesion } from "../../../lib/accesosServidor";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { generarClave, empresaDeClave, claveValida } from "../../../lib/planillaMrp";
import { CLAVE_PDF_OT, MAX_PDFS, idCarpeta, limpiarArchivos, scriptCarpetaPdf } from "../../../lib/pdfOt";
import { logger } from "../../../lib/logger";

const leerConfig = async (e) => {
  const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PDF_OT}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  return cfg?.valor || null;
};

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const sinModulo = await requireModuloSesion(sesion, "proyectos");
    if (sinModulo) return sinModulo;
    const v = await leerConfig(sesion.empresa_id);
    return NextResponse.json({
      conectado: !!v?.hash,
      archivos: Array.isArray(v?.archivos) ? v.archivos : [],
      ultima_lectura: v?.ultima_lectura || null,
    });
  } catch (err) {
    logger.error("[proyectos/pdfs] GET error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const clave = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const e = empresaDeClave(clave);
    const noAutorizado = NextResponse.json({ error: "Clave inválida" }, { status: 401 });
    if (!e) return noAutorizado;
    const rl = checkRateLimit(`pdfs-ot:${e}`, 30, 60_000);
    if (rl.limited) return NextResponse.json({ error: "Demasiados pedidos" }, { status: 429 });
    const v = await leerConfig(e);
    if (!claveValida(clave, v?.hash)) return noAutorizado;

    const body = await request.json().catch(() => null);
    if (!Array.isArray(body?.archivos)) return NextResponse.json({ error: "Falta la lista de PDF" }, { status: 400 });
    const archivos = limpiarArchivos(body.archivos);
    await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PDF_OT}`, {
      valor: { ...v, archivos, ultima_lectura: new Date().toISOString() },
    });
    return NextResponse.json({ ok: true, pdfs: archivos.length, recortado: body.archivos.length > MAX_PDFS });
  } catch (err) {
    logger.error("[proyectos/pdfs] PATCH error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_GESTION.has(sesion.rol)) {
      return NextResponse.json({ error: "Solo el encargado puede conectar la carpeta" }, { status: 403 });
    }
    const sinModulo = await requireModuloSesion(sesion, "proyectos");
    if (sinModulo) return sinModulo;
    const body = await request.json().catch(() => ({}));
    const carpeta = idCarpeta(body?.carpeta);
    if (!carpeta) return NextResponse.json({ error: "Pegá el link de la carpeta de Drive" }, { status: 400 });

    const e = sesion.empresa_id;
    const opts = { sesion };
    const { clave, hash } = generarClave(e);
    const filtro = `config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PDF_OT}`;
    const [previa] = (await sbGet(`${filtro}&select=valor&limit=1`, opts)) || [];
    // La lista que ya había se conserva hasta que el script nuevo mande la suya
    const valor = { ...(previa?.valor || {}), hash, carpeta, creada_at: new Date().toISOString(), ultima_lectura: null };
    if (previa) await sbPatch(filtro, { valor }, opts);
    else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_PDF_OT, valor }, opts);

    const url = `${new URL(request.url).origin}/api/proyectos/pdfs`;
    return NextResponse.json({ ok: true, script: scriptCarpetaPdf({ url, clave, carpeta }), creada_at: valor.creada_at });
  } catch (err) {
    logger.error("[proyectos/pdfs] POST error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
