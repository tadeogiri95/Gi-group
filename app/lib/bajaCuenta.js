// app/lib/bajaCuenta.js — Baja de cuenta con 30 días de retención y borrado
// definitivo (F6-01, ítem 28; lo que prometen los términos, sección 8).
import { sbGet, sbPatchOk, sbRpc } from "./sbHelpers";
import { logger } from "./logger";

export const DIAS_RETENCION = 30;
// Buckets de Storage donde cada empresa guarda archivos bajo "{empresa_id}/"
export const BUCKETS_EMPRESA = ["documentos-empleado", "reportes-obra", "logos"];

/** Fecha (ISO) en que se borran los datos de una baja pedida en `baja`. */
export function fechaBorrado(baja) {
  return new Date(Date.parse(baja) + DIAS_RETENCION * 86400000).toISOString();
}

/** Para confirmar hay que escribir el nombre de la empresa (sin importar mayúsculas ni espacios de más). */
export function confirmacionValida(nombreEmpresa, texto) {
  const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
  return norm(nombreEmpresa).length > 0 && norm(nombreEmpresa) === norm(texto);
}

/** ¿Se puede deshacer? Solo la baja vigente y dentro de los 30 días. */
export function puedeReactivar(empresa, bajaDelLink, ahora = Date.now()) {
  if (!empresa?.baja_solicitada_en) return false;
  const t = Date.parse(empresa.baja_solicitada_en);
  if (!Number.isFinite(t) || t !== Date.parse(bajaDelLink)) return false;
  return ahora < t + DIAS_RETENCION * 86400000;
}

/** Revoca todas las sesiones de la empresa (celulares, kioscos). */
export async function revocarSesionesEmpresa(empresaId) {
  const ok = await sbPatchOk(`sesiones?empresa_id=eq.${empresaId}&revocada=eq.false`, { revocada: true });
  if (!ok) throw new Error("No se pudieron cerrar las sesiones");
}

// ─── Storage ───

function headers() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/** Lista recursivamente los archivos bajo `prefijo` (las carpetas vienen con id null). */
export async function listarArchivos(bucket, prefijo, profundidad = 0) {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/list/${bucket}`;
  const archivos = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify({ prefix: prefijo, limit: 1000, offset }) });
    if (r.status === 404 || r.status === 400) return archivos; // bucket inexistente
    if (!r.ok) throw new Error(`storage list ${bucket}/${prefijo}: ${r.status}`);
    const items = await r.json();
    for (const it of items) {
      const ruta = `${prefijo}/${it.name}`;
      if (it.id == null && profundidad < 5) archivos.push(...(await listarArchivos(bucket, ruta, profundidad + 1)));
      else if (it.id != null) archivos.push(ruta);
    }
    if (items.length < 1000) return archivos;
  }
}

/** Borra todos los archivos de la empresa en Storage. Devuelve cuántos borró. */
export async function borrarArchivosEmpresa(empresaId) {
  let total = 0;
  for (const bucket of BUCKETS_EMPRESA) {
    const rutas = await listarArchivos(bucket, empresaId);
    for (let i = 0; i < rutas.length; i += 100) {
      const lote = rutas.slice(i, i + 100);
      const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}`, {
        method: "DELETE", headers: headers(), body: JSON.stringify({ prefixes: lote }),
      });
      if (!r.ok) throw new Error(`storage delete ${bucket}: ${r.status}`);
      total += lote.length;
    }
  }
  return total;
}

/**
 * Borrado definitivo: archivos y después todas las filas (función SQL de la
 * migración 078). Solo para empresas con la baja vencida.
 */
export async function purgarEmpresa(empresaId) {
  const [emp] = (await sbGet(`empresa?id=eq.${empresaId}&select=id,activa,baja_solicitada_en&limit=1`)) || [];
  if (!emp) return { ok: true, yaNoExiste: true };
  if (emp.activa !== false || !emp.baja_solicitada_en || Date.now() < Date.parse(fechaBorrado(emp.baja_solicitada_en))) {
    throw new Error(`purgarEmpresa: ${empresaId} no tiene una baja vencida`);
  }
  const archivos = await borrarArchivosEmpresa(empresaId);
  const filas = await sbRpc("purgar_empresa", { p_empresa: empresaId });
  logger.info?.(`[baja] empresa ${empresaId} purgada: ${archivos} archivos, ${filas} filas`);
  return { ok: true, archivos, filas };
}
