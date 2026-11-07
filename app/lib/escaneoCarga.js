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
//   - La etiqueta de cada pieza (🧩 Piezas): "OT M-7495 - PIEZA - 1234". Se
//     busca el suelto que se llama igual que la pieza (código = PANEL).
//   - El QR para el cliente (04/11): el link .../ot/<código> trae la OT
//     adentro (la firma la controla el servidor; acá solo se lee la OT).
//   - Cualquiera de esos metido en un link de Gypi (?qr=, app/lib/linkQr.js).
//   - El código de barras de la pieza (06/11): "M7819-GB2P-11" (OT-Módulo-
//     Pieza, app/lib/codigoBarras.js). Con sub-OT trae otras lecturas posibles.
//   - El código de barras del módulo (07/11): "M7819-GB2P" (OT-Módulo). El
//     módulo armado es el bulto ("Módulo GB2P"). Un bulto armado a mano
//     lleva "M7819-BULTO3".
// Un suelto se carga entero con un escaneo (una lectura por renglón).
import { textoDeQr } from "./linkQr";
import { leerBarrasPieza, textoBarrasPieza } from "./codigoBarras";

const OT_VALIDA = /^[\w.-]{1,40}$/;

/** "m-7495 " → "M-7495"; para comparar OT sin importar mayúsculas ni espacios. */
export const normalizarOt = (ot) => String(ot ?? "").trim().toUpperCase();

const normalizarTexto = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Qué dice un QR escaneado.
 * @returns {null | { ot: string, bulto?: number, sueltoId?: number, suelto?: string, piezaId?: number, piezaNombre?: string }}
 *   Sin bulto ni suelto, es el QR de la OT.
 */
export function leerQr(texto) {
  // Link de Gypi con el QR adentro (?qr=): vale el texto de adentro
  const s = textoDeQr(texto);
  if (!s || s.length > 500) return null;

  // Link de la app (rótulo de bulto o etiqueta de suelto)
  if (/^https?:\/\//i.test(s)) {
    let url;
    try { url = new URL(s); } catch { return null; }
    const delCliente = otDeLinkCliente(url.pathname);
    if (delCliente) return { ot: delCliente };
    const ot = url.searchParams.get("carga");
    if (!ot || !OT_VALIDA.test(ot)) return null;
    const lectura = { ot };
    const bulto = Number(url.searchParams.get("bulto"));
    if (Number.isInteger(bulto) && bulto > 0) lectura.bulto = bulto;
    const suelto = Number(url.searchParams.get("suelto"));
    if (Number.isInteger(suelto) && suelto > 0) lectura.sueltoId = suelto;
    return lectura;
  }

  // Etiqueta de pieza (🧩 Piezas)
  let m = s.match(/^OT\s+(\S+)\s+-\s+PIEZA\s+-\s+(\d{1,15})$/i);
  if (m && OT_VALIDA.test(m[1])) return { ot: m[1], piezaId: Number(m[2]) };
  // Etiqueta de pieza armada en la planilla: "OT M-7495 - PIEZA - 11 - 2 DE 4"
  // (o "OT M-7495 - PIEZA - 11", el mismo QR para todas las unidades)
  m = s.match(/^OT\s+(\S+)\s+-\s+PIEZA\s+-\s+(\S.{0,119}?)(?:\s+-\s+\d{1,4}\s+DE\s+\d{1,4})?$/i);
  if (m && OT_VALIDA.test(m[1])) return { ot: m[1], piezaNombre: m[2].replace(/\s+/g, " ").trim() };

  // Hoja CARGA de la planilla
  m = s.match(/^OT\s+(\S+)\s+-\s+BULTO\s+(\d+)\b/i);
  if (m && OT_VALIDA.test(m[1])) return { ot: m[1], bulto: Number(m[2]) };
  m = s.match(/^OT\s+(\S+)\s+-\s+SUELTO\s+-\s+(.+)$/i);
  if (m && OT_VALIDA.test(m[1])) return { ot: m[1], suelto: m[2].trim() };
  m = s.match(/^OT\s+(\S+)$/i);
  if (m && OT_VALIDA.test(m[1])) return { ot: m[1] };

  // Código de barras de la pieza: "M7819-GB2P-11" (antes que la OT sola,
  // porque "M7819-GB2P-11" también parece el código de una OT)
  const barras = leerBarrasPieza(s);
  if (barras) {
    const [primera, ...otras] = barras.map((b) => ({ ot: b.ot, piezaNombre: b.nombre }));
    return otras.length ? { ...primera, otras } : primera;
  }

  // QR de la OT en la planilla: el número solo
  return OT_VALIDA.test(s) ? { ot: s } : null;
}

/** "/ot/<base64url de empresa|OT>.<firma>" → la OT, o null. */
function otDeLinkCliente(ruta) {
  const m = String(ruta || "").match(/^\/ot\/([A-Za-z0-9_-]{10,160})\.[A-Za-z0-9_-]{22}\/?$/);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const [, ot, ...resto] = new TextDecoder().decode(bytes).split("|");
    return !resto.length && ot && OT_VALIDA.test(ot) ? ot : null;
  } catch {
    return null;
  }
}

/** La OT de la lista que corresponde a un QR, o null. */
export function otDelQr(texto, ots = []) {
  const lectura = leerQr(texto);
  if (!lectura) return null;
  for (const l of [lectura, ...(lectura.otras || [])]) {
    const buscada = normalizarOt(l.ot);
    const p = ots.find((x) => normalizarOt(x.ot) === buscada);
    if (p) return String(p.ot);
  }
  return null;
}

/** El suelto que se llama así (por código, o por descripción si no tiene); primero el que falta cargar. */
function sueltoLlamado(nombre, sueltos) {
  const buscado = normalizarTexto(nombre);
  const iguales = sueltos.filter((x) => normalizarTexto(x.codigo || x.descripcion) === buscado
    || (x.codigo && normalizarTexto(x.descripcion) === buscado));
  return iguales.find((x) => !x.carga) || iguales[0];
}

/** El bulto del módulo (contenido "Módulo M1", app/lib/destinosPiezas.js). */
function bultoDeModulo(modulo, bultos) {
  const buscado = normalizarTexto(`Módulo ${modulo}`);
  return bultos.find((b) => normalizarTexto(b.contenido) === buscado) || null;
}

/** Código de barras del rótulo de un bulto: el del módulo, (OT)-(Módulo), o (OT)-BULTO3 si se armó a mano. */
export function textoBarrasBulto(ot, bulto) {
  const m = String(bulto?.contenido ?? "").match(/^Módulo (.+)$/);
  return textoBarrasPieza(ot, m ? m[1] : `BULTO${bulto?.numero}`);
}

/**
 * Coteja un QR contra lo que lleva la OT abierta.
 * @param {string} texto lo que leyó la cámara
 * @param {{ ot: string, bultos: object[], sueltos: object[], piezas?: object[] }} datos
 *   piezas: las piezas de la OT leídas para este QR ({ id, nombre, modulo })
 * @returns {{ tipo: "bulto"|"suelto", item: object, yaCargado: boolean, nombre: string }
 *   | { error: string } | { tipo: "ot" }}
 */
export function cotejarQr(texto, { ot, bultos = [], sueltos = [], piezas = [] }) {
  const leida = leerQr(texto);
  if (!leida) return { error: "Ese código no es de Gypi ni de la planilla." };
  // Con sub-OT, el código de barras puede leerse de dos maneras: vale la de esta OT
  const lectura = [leida, ...(leida.otras || [])].find((l) => normalizarOt(l.ot) === normalizarOt(ot)) || leida;
  if (normalizarOt(lectura.ot) !== normalizarOt(ot)) return { error: `Ese código es de la OT ${lectura.ot}, no de esta.` };

  if (lectura.bulto) {
    const b = bultos.find((x) => x.numero === lectura.bulto);
    if (!b) return { error: `La OT no tiene el bulto ${lectura.bulto}. Revisá la lista de bultos.` };
    return { tipo: "bulto", item: b, yaCargado: !!b.cargado, nombre: `Bulto ${b.numero} de ${bultos.length}` };
  }
  if (lectura.piezaId) {
    const p = piezas.find((x) => Number(x.id) === lectura.piezaId);
    // "OT X - PIEZA - 11" puede ser la pieza que se llama "11" (QR de la planilla)
    const porNombre = p ? null : sueltoLlamado(String(lectura.piezaId), sueltos);
    if (porNombre) return { tipo: "suelto", item: porNombre, yaCargado: !!porNombre.carga, nombre: [porNombre.codigo, porNombre.descripcion].filter(Boolean).join(" · ") || "Suelto" };
    if (!p) return { error: "Esa pieza no está en la lista de piezas de la OT." };
    // "11 (2)" es el segundo renglón llamado "11" en 🧩 Piezas
    const nombrePieza = String(p.nombre ?? "").replace(/\s+\(\d+\)$/, "");
    const s = sueltoLlamado(nombrePieza, sueltos);
    if (!s) return { error: `La pieza ${nombrePieza} no está en la lista de sueltos. Si va dentro de un módulo armado, escaneá la etiqueta del módulo.` };
    const nombre = [s.codigo, s.descripcion].filter(Boolean).join(" · ") || "Suelto";
    return { tipo: "suelto", item: s, yaCargado: !!s.carga, nombre };
  }
  if (lectura.piezaNombre) {
    const s = sueltoLlamado(lectura.piezaNombre, sueltos);
    // Código de barras del módulo, (OT)-(Módulo): es su bulto (07/11)
    const b = s ? null : bultoDeModulo(lectura.piezaNombre, bultos);
    if (b) return { tipo: "bulto", item: b, yaCargado: !!b.cargado, nombre: `Bulto ${b.numero} de ${bultos.length} · ${b.contenido}` };
    // Rótulo de un bulto armado a mano: (OT)-BULTO3
    const n = Number(lectura.piezaNombre.match(/^BULTO(\d{1,3})$/i)?.[1]);
    if (n) {
      const porNumero = bultos.find((x) => x.numero === n);
      if (!porNumero) return { error: `La OT no tiene el bulto ${n}. Revisá la lista de bultos.` };
      return { tipo: "bulto", item: porNumero, yaCargado: !!porNumero.cargado, nombre: `Bulto ${porNumero.numero} de ${bultos.length}` };
    }
    if (!s) return { error: `La pieza ${lectura.piezaNombre} no está en la lista de sueltos. Si va dentro de un módulo armado, escaneá la etiqueta del módulo.` };
    const nombre = [s.codigo, s.descripcion].filter(Boolean).join(" · ") || "Suelto";
    return { tipo: "suelto", item: s, yaCargado: !!s.carga, nombre };
  }
  if (lectura.sueltoId || lectura.suelto) {
    const s = lectura.sueltoId ? sueltos.find((x) => Number(x.id) === lectura.sueltoId) : sueltoLlamado(lectura.suelto, sueltos);
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
