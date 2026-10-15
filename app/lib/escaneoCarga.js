// app/lib/escaneoCarga.js — Carga de la OT escaneando QR (Órdenes de
// Producción, a pedido de Tadeo): se elige la OT con el QR de la planilla y
// después se escanea cada bulto o suelto que sube al camión. La app coteja
// contra lo que lleva la OT: verde lo cargado, amarillo lo que falta.
//
// QR que se entienden:
//   - El de la OT en la planilla: el número solo ("M-7495").
//   - Los rótulos que imprime la app: el link ...?carga=OT, con &bulto=N o
//     &suelto=ID para cada etiqueta.
//   - Los de la hoja CARGA de la planilla:
//       "OT M-7495 - BULTO 3 DE 4 - M.izq"
//       "OT M-7495 - SUELTO - EST-11" (código, o la descripción si no tiene)
// Un suelto se carga entero con un escaneo (una lectura por renglón).

const OT_VALIDA = /^[\w.-]{1,40}$/;

/** "m-7495 " → "M-7495"; para comparar OT sin importar mayúsculas ni espacios. */
export const normalizarOt = (ot) => String(ot ?? "").trim().toUpperCase();

const normalizarTexto = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Qué dice un QR escaneado.
 * @returns {null | { ot: string, bulto?: number, sueltoId?: number, suelto?: string }}
 *   Sin bulto ni suelto, es el QR de la OT.
 */
export function leerQr(texto) {
  const s = String(texto ?? "").trim();
  if (!s || s.length > 500) return null;

  // Link de la app (rótulo de bulto o etiqueta de suelto)
  if (/^https?:\/\//i.test(s)) {
    let url;
    try { url = new URL(s); } catch { return null; }
    const ot = url.searchParams.get("carga");
    if (!ot || !OT_VALIDA.test(ot)) return null;
    const lectura = { ot };
    const bulto = Number(url.searchParams.get("bulto"));
    if (Number.isInteger(bulto) && bulto > 0) lectura.bulto = bulto;
    const suelto = Number(url.searchParams.get("suelto"));
    if (Number.isInteger(suelto) && suelto > 0) lectura.sueltoId = suelto;
    return lectura;
  }

  // Hoja CARGA de la planilla
  let m = s.match(/^OT\s+(\S+)\s+-\s+BULTO\s+(\d+)\b/i);
  if (m && OT_VALIDA.test(m[1])) return { ot: m[1], bulto: Number(m[2]) };
  m = s.match(/^OT\s+(\S+)\s+-\s+SUELTO\s+-\s+(.+)$/i);
  if (m && OT_VALIDA.test(m[1])) return { ot: m[1], suelto: m[2].trim() };
  m = s.match(/^OT\s+(\S+)$/i);
  if (m && OT_VALIDA.test(m[1])) return { ot: m[1] };

  // QR de la OT en la planilla: el número solo
  return OT_VALIDA.test(s) ? { ot: s } : null;
}

/** La OT de la lista que corresponde a un QR, o null. */
export function otDelQr(texto, ots = []) {
  const lectura = leerQr(texto);
  if (!lectura) return null;
  const buscada = normalizarOt(lectura.ot);
  const p = ots.find((x) => normalizarOt(x.ot) === buscada);
  return p ? String(p.ot) : null;
}

/**
 * Coteja un QR contra lo que lleva la OT abierta.
 * @param {string} texto lo que leyó la cámara
 * @param {{ ot: string, bultos: object[], sueltos: object[] }} datos
 * @returns {{ tipo: "bulto"|"suelto", item: object, yaCargado: boolean, nombre: string }
 *   | { error: string } | { tipo: "ot" }}
 */
export function cotejarQr(texto, { ot, bultos = [], sueltos = [] }) {
  const lectura = leerQr(texto);
  if (!lectura) return { error: "Ese código no es de Gypi ni de la planilla." };
  if (normalizarOt(lectura.ot) !== normalizarOt(ot)) return { error: `Ese código es de la OT ${lectura.ot}, no de esta.` };

  if (lectura.bulto) {
    const b = bultos.find((x) => x.numero === lectura.bulto);
    if (!b) return { error: `La OT no tiene el bulto ${lectura.bulto}. Revisá la lista de bultos.` };
    return { tipo: "bulto", item: b, yaCargado: !!b.cargado, nombre: `Bulto ${b.numero} de ${bultos.length}` };
  }
  if (lectura.sueltoId || lectura.suelto) {
    let s;
    if (lectura.sueltoId) s = sueltos.find((x) => Number(x.id) === lectura.sueltoId);
    else {
      const buscado = normalizarTexto(lectura.suelto);
      const iguales = sueltos.filter((x) => normalizarTexto(x.codigo || x.descripcion) === buscado
        || (x.codigo && normalizarTexto(x.descripcion) === buscado));
      // Si hay dos renglones con el mismo código, primero el que falta cargar
      s = iguales.find((x) => !x.carga) || iguales[0];
    }
    if (!s) return { error: "Ese suelto no está en la lista de la OT." };
    const nombre = [s.codigo, s.descripcion].filter(Boolean).join(" · ") || "Suelto";
    return { tipo: "suelto", item: s, yaCargado: !!s.carga, nombre };
  }
  return { tipo: "ot" };
}

/**
 * Lo pegado de la columna ETIQUETA (hoja CARGA, parte 2) → contenido de cada
 * bulto, en orden. Ignora el título y los renglones vacíos.
 */
export function bultosPegados(texto, max = 999) {
  return String(texto ?? "")
    .split(/\r?\n/)
    .map((l) => l.split("\t")[0].replace(/\s+/g, " ").trim())
    .filter((l) => l && !/^etiqueta\b/i.test(l))
    .slice(0, max)
    .map((l) => l.slice(0, 300));
}
