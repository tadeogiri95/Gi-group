// app/lib/finanzasAdjuntos.js — Finanzas (13/11, parte 4 del plan de
// Tesorería; migración 187): varios comprobantes (PDF o fotos) por movimiento.
//
// Cada operación lleva fin_operaciones.comprobantes = [{ url, nombre, tipo }]
// (hasta 10). Lo que ya tenía una foto de Mi caja (comprobante_url, 176)
// también se ve: comprobantesDe junta los dos sin repetir. Al guardar la
// lista, comprobante_url queda como el primero.
import { comprobanteValido } from "./finanzasMiCaja";

export const MAX_COMPROBANTES = 10;
export const TIPOS_COMPROBANTE = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const esPdf = (url) => /\.pdf$/i.test(String(url || ""));

/** Los comprobantes de una operación: la lista nueva y, si no está ahí, la foto vieja. */
export function comprobantesDe(op) {
  const lista = Array.isArray(op?.comprobantes) ? op.comprobantes.filter((c) => c && typeof c.url === "string") : [];
  const urls = new Set(lista.map((c) => c.url));
  if (op?.comprobante_url && !urls.has(op.comprobante_url)) {
    lista.unshift({ url: op.comprobante_url, nombre: esPdf(op.comprobante_url) ? "Comprobante.pdf" : "Foto del ticket", tipo: esPdf(op.comprobante_url) ? "pdf" : "foto" });
  }
  return lista;
}

/**
 * Revisa la lista que manda la pantalla: solo archivos subidos por Gypi a la
 * carpeta de la empresa, sin repetir, hasta 10.
 * @returns {{ lista: { url: string, nombre: string, tipo: "pdf"|"foto" }[], error: string|null }}
 */
export function validarComprobantes(entrada, { supabaseUrl, empresaId } = {}) {
  if (entrada == null) return { lista: [], error: null };
  if (!Array.isArray(entrada)) return { lista: [], error: "Los comprobantes no son válidos" };
  const lista = [];
  const vistas = new Set();
  for (const c of entrada) {
    const url = typeof c === "string" ? c : c?.url;
    if (!url || !comprobanteValido(url, { supabaseUrl, empresaId })) return { lista: [], error: "Un comprobante no es válido: subilo de nuevo" };
    if (vistas.has(url)) continue;
    vistas.add(url);
    const tipo = esPdf(url) ? "pdf" : "foto";
    lista.push({ url, nombre: txt(typeof c === "object" ? c.nombre : "", 120) || (tipo === "pdf" ? "Comprobante.pdf" : "Foto"), tipo });
  }
  if (lista.length > MAX_COMPROBANTES) return { lista: [], error: `Hasta ${MAX_COMPROBANTES} comprobantes por movimiento` };
  return { lista, error: null };
}

/** Lo que se guarda en la operación: la lista y el primero como comprobante_url. */
export function columnasComprobantes(lista = []) {
  return { comprobantes: lista, comprobante_url: lista[0]?.url || null };
}

/** ¿Falta la 187? (la columna comprobantes todavía no existe) */
export const falta187 = (err) => /comprobantes/.test(String(err?.message)) && /does not exist|42703|PGRST20[045]|schema cache|column/.test(String(err?.message));
