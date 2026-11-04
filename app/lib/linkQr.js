// app/lib/linkQr.js — QR de Gypi como link (04/11, Tadeo): el mismo texto de
// siempre ("M-7961", "OT M-7961 - MODULO - 2.AL1P", "OT M-7961 - PIEZA -
// 2.AL1P-11 - 1 DE 2"…) metido en un link de la empresa:
//   https://gypi.app/<slug>?qr=<texto>
// Leído con la cámara del celular abre Gypi en esa OT, módulo o pieza; leído
// desde adentro de Gypi (Escanear piezas, Carga, Ver PDF) vale lo mismo que el
// texto solo. Se arma en la planilla de Excel con ENCODEURL. Sin dependencias,
// para que lo usen piezas.js y escaneoCarga.js sin importarse entre sí.

export const MAX_TEXTO_QR = 300;

/** El texto que trae un QR: el de adentro si es un link con ?qr=, si no el mismo. */
export function textoDeQr(texto) {
  const s = String(texto ?? "").trim();
  if (!/^https?:\/\//i.test(s) || s.length > 1000) return s;
  let url;
  try { url = new URL(s); } catch { return s; }
  const qr = url.searchParams.get("qr");
  return qr && qr.trim() && qr.length <= MAX_TEXTO_QR ? qr.trim() : s;
}

/** Link que abre Gypi con ese QR. */
export function linkQr(origen, slug, texto) {
  return `${String(origen).replace(/\/$/, "")}/${encodeURIComponent(slug)}?qr=${encodeURIComponent(String(texto))}`;
}
