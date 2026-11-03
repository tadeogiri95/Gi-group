// app/lib/flotaArchivos.js — PDF de los papeles de la flota (la póliza del
// seguro; migración 156) en el bucket privado flota-documentos. Se suben y se
// firman con la clave de servicio desde las rutas, que antes revisan que el
// usuario sea de la empresa (igual que documentos-empleado, migración 059).
import { randomBytes } from "node:crypto";

export const BUCKET_FLOTA = "flota-documentos";
// 4 MB: Vercel no deja pasar pedidos de más de 4,5 MB
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
const VENCE_LINK = 120; // segundos

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY;

/** Lugar del PDF de una empresa: "<empresa>/polizas/<fecha>-<azar>.pdf". */
export function rutaPoliza(empresaId) {
  return `${empresaId}/polizas/${Date.now()}-${randomBytes(6).toString("hex")}.pdf`;
}

/** ¿Es un archivo subido por /api/flota/poliza para esta empresa? */
export function esRutaDeLaEmpresa(path, empresaId) {
  return typeof path === "string" && path.startsWith(`${empresaId}/polizas/`) && /^[0-9a-f-]{36}\/polizas\/\d{10,16}-[0-9a-f]{12}\.pdf$/.test(path);
}

export async function subirPdf(path, buffer) {
  const r = await fetch(`${SB_URL()}/storage/v1/object/${BUCKET_FLOTA}/${path}`, {
    method: "POST",
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/pdf", "x-upsert": "false" },
    body: buffer,
  });
  if (!r.ok) throw new Error(`storage ${BUCKET_FLOTA}: ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
}

/** Link de descarga que vence en dos minutos. */
export async function linkPdf(path, nombre) {
  const r = await fetch(`${SB_URL()}/storage/v1/object/sign/${BUCKET_FLOTA}/${path}`, {
    method: "POST",
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: VENCE_LINK }),
  });
  if (!r.ok) throw new Error(`storage sign ${BUCKET_FLOTA}: ${r.status}`);
  const { signedURL } = await r.json();
  const descarga = nombre ? `&download=${encodeURIComponent(nombre)}` : "";
  return `${SB_URL()}/storage/v1${signedURL}${descarga}`;
}

/** Nombre del archivo para guardar: sin carpetas ni caracteres raros, termina en .pdf. */
export function nombrePdf(nombre) {
  const base = String(nombre || "").split(/[\\/]/).pop().replace(/[^\w .()-]/g, "").trim().slice(0, 180);
  if (!base) return "poliza.pdf";
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}
