// app/lib/fileSignature.js — Detecta el tipo real de un archivo por sus
// primeros bytes ("magic bytes"), sin confiar en el tipo que declara el
// navegador (F2-09). Solo reconoce los formatos que la app acepta; SVG no
// está a propósito: puede llevar scripts y se servía desde buckets públicos.

/**
 * @param {Uint8Array} buf
 * @returns {string|null} MIME detectado o null si no es un formato aceptado.
 */
export function detectarMime(buf) {
  if (!buf || buf.length < 4) return null;
  const b = (i) => buf[i];
  const ascii = (desde, hasta) => String.fromCharCode(...buf.subarray(desde, hasta));

  if (b(0) === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  // Word 97-2003 (contenedor OLE)
  if (b(0) === 0xd0 && b(1) === 0xcf && b(2) === 0x11 && b(3) === 0xe0) return "application/msword";
  // .docx es un ZIP; el tipo exacto se confirma por la extensión declarada
  if (b(0) === 0x50 && b(1) === 0x4b && b(2) === 0x03 && b(3) === 0x04) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

/**
 * ¿El contenido coincide con el tipo declarado? Se usa junto con la lista de
 * tipos permitidos de cada endpoint.
 *
 * @param {Uint8Array} buf
 * @param {string} mimeDeclarado
 */
export function contenidoCoincide(buf, mimeDeclarado) {
  return detectarMime(buf) === mimeDeclarado;
}

export const EXT_POR_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};
