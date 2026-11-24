// app/lib/ubicacion.js — Direcciones y puntos del mapa.
//
// Lo usan Geolocalización (zonas de fichaje) y Logística (lugares, obras y
// recorridos, 203): leer un link de Google Maps, coordenadas o un Plus Code, y
// armar los links que abren Google Maps en el celular (gratis, sin clave).

/* ═══ GOOGLE MAPS PARSER ═══ */
/**
 * Acepta cualquiera de estos formatos:
 *  1. Coordenadas crudas:  -34.6037, -58.3816
 *  2. @lat,lng,zoom:        @-34.6037,-58.3816,16z  (con o sin URL)
 *  3. maps.google.com URL:  ?q=lat,lng  /  ?center=lat,lng  /  ll=lat,lng
 *  4. Share desktop Maps:   !3d{lat}!4d{lng}
 *  5. /place/.../@lat,lng   (URL completa de resultado de búsqueda)
 */
export const parseMapsInput = (input) => {
  const s = input?.trim() ?? "";
  if (!s) return null;

  // 1. Coordenadas crudas: "-34.6037, -58.3816" o "-34.6037 -58.3816"
  const rawCoord = s.match(/^(-?\d{1,3}\.?\d*)[,\s]+(-?\d{1,3}\.?\d*)$/);
  if (rawCoord) {
    const lat = parseFloat(rawCoord[1]);
    const lng = parseFloat(rawCoord[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  // 2. @lat,lng (con zoom opcional) — funciona dentro de URLs o como texto
  const atMatch = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  // 3. !3d{lat}!4d{lng} — formato de links "Compartir" de Maps en desktop
  const dataMatch = s.match(/!3d(-?\d+\.?\d*).*?!4d(-?\d+\.?\d*)/);
  if (dataMatch) {
    const lat = parseFloat(dataMatch[1]);
    const lng = parseFloat(dataMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  // 4. ?q=lat,lng / &q=lat,lng
  const qMatch = s.match(/[?&]q=(-?\d+\.?\d*)[,+](-?\d+\.?\d*)/);
  if (qMatch) {
    const lat = parseFloat(qMatch[1]);
    const lng = parseFloat(qMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  // 5. ?center=lat,lng o ll=lat,lng (formatos legacy de Maps)
  const centerMatch = s.match(/(?:[?&]center=|[?&]ll=)(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (centerMatch) {
    const lat = parseFloat(centerMatch[1]);
    const lng = parseFloat(centerMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  return null;
};

/* ═══ PLUS CODE DECODER ═══ */
const PLUS_CODE_CHARS = "23456789CFGHJMPQRVWX";
export const decodePlusCode = (code) => {
  try {
    let cleaned = code.replace(/\s/g, "").toUpperCase();
    if (!cleaned.includes("+")) return null;
    cleaned = cleaned.replace(/0+$/, "");
    const sepIdx = cleaned.indexOf("+");
    const beforeSep = cleaned.slice(0, sepIdx);
    const afterSep = cleaned.slice(sepIdx + 1);
    const all = beforeSep + afterSep;
    if (all.length < 8) return null;
    let lat = 0, lng = 0;
    const pairs = [];
    for (let i = 0; i < all.length - 1; i += 2) {
      pairs.push([all[i], all[i + 1]]);
    }
    const resolutions = [20, 1, 0.05, 0.0025, 0.000125];
    for (let i = 0; i < Math.min(pairs.length, 5); i++) {
      const latIdx = PLUS_CODE_CHARS.indexOf(pairs[i][0]);
      const lngIdx = PLUS_CODE_CHARS.indexOf(pairs[i][1]);
      if (latIdx < 0 || lngIdx < 0) return null;
      lat += latIdx * resolutions[i];
      lng += lngIdx * resolutions[i];
    }
    lat -= 90;
    lng -= 180;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };
  } catch {
    return null;
  }
};

/** ¿Son un punto válido del mapa? (null, vacío o fuera de rango: no) */
export function coordsValidas(lat, lng) {
  if (lat === null || lat === undefined || lat === "" || lng === null || lng === undefined || lng === "") return false;
  const a = Number(lat), o = Number(lng);
  return Number.isFinite(a) && Number.isFinite(o) && a >= -90 && a <= 90 && o >= -180 && o <= 180 && !(a === 0 && o === 0);
}

/** Link que abre el lugar en Google Maps: con pin, el punto exacto; si no, la dirección. */
export function linkGoogleMaps({ lat, lng, direccion } = {}) {
  if (coordsValidas(lat, lng)) return `https://www.google.com/maps/search/?api=1&query=${Number(lat)},${Number(lng)}`;
  const d = String(direccion ?? "").trim();
  return d ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d)}` : null;
}
