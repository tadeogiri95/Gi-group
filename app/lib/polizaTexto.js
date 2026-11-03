// app/lib/polizaTexto.js — Lee los datos del vehículo y del seguro del texto
// de una póliza en PDF (Tadeo, 03/11; migración 156). Sin IA, a propósito: no
// tiene costo. Busca los títulos de siempre de las pólizas argentinas
// (Dominio, Marca, Modelo, Año, Motor, Chasis, Vigencia desde/hasta, N° de
// póliza, Cobertura) y las aseguradoras conocidas. Lo que no encuentra queda
// vacío. Anda con pólizas digitales (con texto); una escaneada no tiene texto.

// Se quitan los acentos letra por letra para que los índices sigan sirviendo
const SIN_ACENTO = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n", Á: "A", É: "E", Í: "I", Ó: "O", Ú: "U", Ü: "U", Ñ: "N", º: "°" };
const normalizar = (t) => t.replace(/[áéíóúüñÁÉÍÓÚÜÑº]/g, (c) => SIN_ACENTO[c]);

// Títulos que cortan el valor de otro título en la misma línea
const TITULOS = [
  "dominio", "patente", "marca", "modelo", "version", "ano", "anio", "motor", "chasis", "chassis", "carroceria", "color", "uso",
  "tipo", "combustible", "suma asegurada", "cobertura", "vigencia", "desde", "hasta", "poliza", "endoso", "asegurado", "productor",
  "cuit", "cuil", "dni", "domicilio", "localidad", "provincia", "cp", "codigo", "accesorios", "gnc", "km", "plan", "franquicia",
  "valor", "prima", "premio", "infoauto", "codia", "okm", "0km", "fecha", "vencimiento", "nro", "numero", "n°", "categoria", "zona",
];
const CORTE = new RegExp(`\\s{2,}|\\s\\|\\s|\\s(?:${TITULOS.map((t) => t.replace(/\s/g, "\\s+")).join("|")})\\b\\s*[:.]`, "i");

export const ASEGURADORAS = [
  ["sancor", "Sancor Seguros"], ["la segunda", "La Segunda"], ["federacion patronal", "Federación Patronal"],
  ["rivadavia", "Seguros Rivadavia"], ["mercantil andina", "Mercantil Andina"], ["allianz", "Allianz"], ["zurich", "Zurich"],
  ["san cristobal", "San Cristóbal"], ["mapfre", "Mapfre"], ["la caja", "La Caja"], ["provincia seguros", "Provincia Seguros"],
  ["rio uruguay", "Río Uruguay Seguros"], ["galicia seguros", "Galicia Seguros"], ["orbis", "Orbis Seguros"],
  ["integrity", "Integrity Seguros"], ["meridional", "Meridional Seguros"], ["libra seguros", "Libra Seguros"],
  ["el norte", "El Norte Seguros"], ["atm seguros", "ATM Seguros"], ["cooperacion seguros", "Cooperación Seguros"],
  ["experta", "Experta Seguros"], ["hdi", "HDI Seguros"], ["triunfo", "Triunfo Seguros"], ["nacion seguros", "Nación Seguros"],
  ["smg seguros", "SMG Seguros"], ["berkley", "Berkley"], ["boston", "Boston Seguros"], ["chubb", "Chubb"], ["sura", "Sura"],
  ["qualia", "Qualia Seguros"], ["victoria seguros", "Victoria Seguros"], ["la holando", "La Holando"], ["parana seguros", "Paraná Seguros"],
  ["prudencia", "Prudencia Seguros"], ["equitativa del plata", "La Equitativa del Plata"], ["san patricio", "San Patricio Seguros"],
  ["perseverancia", "La Perseverancia"], ["agrosalta", "Agrosalta Seguros"], ["nativa", "Nativa Seguros"], ["bbva seguros", "BBVA Seguros"],
  ["hamburgo", "Hamburgo Seguros"], ["holando sudamericana", "La Holando"], ["evolucion seguros", "Evolución Seguros"],
];

const COBERTURAS = [
  [/todo\s+riesgo/i, "Todo riesgo"], [/terceros\s+completo\s+premium/i, "Terceros completo premium"],
  [/terceros\s+completos?/i, "Terceros completo"], [/robo\s+(?:e|y)\s+incendio/i, "Robo e incendio"],
  [/responsabilidad\s+civil/i, "Responsabilidad civil"],
];

const PATENTE = /\b([A-Z]{2}\s?-?\s?\d{3}\s?-?\s?[A-Z]{2}|[A-Z]{3}\s?-?\s?\d{3})\b/;
const FECHA = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/;

/** "01/10/26" → "2026-10-01"; null si no es una fecha válida. */
export function fechaISO(texto) {
  const m = FECHA.exec(texto || "");
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  let a = Number(m[3]);
  if (m[3].length === 2) a += 2000;
  if (!(d >= 1 && d <= 31 && mes >= 1 && mes <= 12 && a >= 1990 && a <= 2100)) return null;
  const iso = `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * El valor que sigue a un título: en la misma línea o, si está solo, en la de
 * abajo. Con extraer, sigue buscando hasta que extraer devuelva algo.
 */
function despues(original, norm, titulo, extraer = (x) => x) {
  const re = new RegExp(`(?:^|[^a-z])(?:${titulo})(?![a-z])\\s*(?:n\\s*°|nro\\.?|numero)?\\s*[:.\\-]?[ \\t]*`, "gi");
  let m;
  while ((m = re.exec(norm))) {
    const desde = m.index + m[0].length;
    const finLinea = norm.indexOf("\n", desde);
    let linea = original.slice(desde, finLinea === -1 ? undefined : finLinea);
    if (!linea.trim() && finLinea !== -1) {
      const sig = norm.indexOf("\n", finLinea + 1);
      linea = original.slice(finLinea + 1, sig === -1 ? undefined : sig);
    }
    const corte = CORTE.exec(normalizar(linea));
    const valor = (corte ? linea.slice(0, corte.index) : linea).trim().replace(/^[:.\-\s]+|[,;:.\s]+$/g, "");
    const x = valor ? extraer(valor) : null;
    if (x) return x;
  }
  return null;
}

const recortar = (v, max) => (v ? v.slice(0, max).trim() || null : null);
const token = (re) => (v) => {
  const m = re.exec(String(v || "").toUpperCase());
  return m ? m[0] : null;
};
// Motor y chasis: un código con al menos un número
const CODIGO = (min) => new RegExp(`\\b(?=[A-Z0-9-]*\\d)[A-Z0-9][A-Z0-9-]{${min - 1},}\\b`);

function tipoVehiculo(norm) {
  if (/\b(pick[\s-]?up|camioneta|suv|4x4)\b/i.test(norm)) return "camioneta";
  if (/\b(acoplado|semirremolque|semi\s?remolque|trailer)\b/i.test(norm)) return "acoplado";
  if (/\bcamion\b/i.test(norm)) return "camion";
  if (/\b(furgon|furgoneta|utilitario)\b/i.test(norm)) return "utilitario";
  if (/\b(sedan|hatchback|hatch|coupe|rural|automovil)\b/i.test(norm)) return "auto";
  return null;
}

function combustible(norm) {
  if (/\b(diesel|gasoil|gas\s?oil)\b/i.test(norm)) return "gasoil";
  if (/\bgnc\b/i.test(norm) && /\b(con|equipo)\s+gnc\b/i.test(norm)) return "gnc";
  if (/\bnafta\b/i.test(norm)) return "nafta";
  if (/\belectrico\b/i.test(norm)) return "electrico";
  return null;
}

function vigencia(original, norm) {
  // "desde (las 12 hs del) 01/10/2026 hasta (las 12 hs del) 01/04/2027"
  const par = /desde[^\n\d]{0,30}(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})[\s\S]{0,40}?hasta[^\n\d]{0,30}(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i.exec(norm);
  if (par) return { fecha: fechaISO(par[1]), vencimiento: fechaISO(par[2]) };
  // "Vigencia: 01/10/2026 al 01/04/2027" o las dos fechas que siguen a Vigencia
  const vig = /vigencia[\s\S]{0,60}?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})[\s\S]{0,40}?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i.exec(norm);
  if (vig) return { fecha: fechaISO(vig[1]), vencimiento: fechaISO(vig[2]) };
  const ini = despues(original, norm, "inicio\\s+de\\s+vigencia|vigente\\s+desde|fecha\\s+de\\s+inicio", fechaISO);
  const fin = despues(original, norm, "fin\\s+de\\s+vigencia|vencimiento|vigente\\s+hasta|fecha\\s+de\\s+vencimiento", fechaISO);
  return { fecha: ini, vencimiento: fin };
}

/**
 * Datos de la póliza a partir de su texto.
 * @param {string} texto el texto del PDF (las primeras páginas)
 * @returns {{ vehiculo: object, seguro: object, encontrados: string[] }}
 *   encontrados: los campos que se completaron ("patente", "marca", …, "seguro.compania", …)
 */
export function leerPoliza(texto) {
  const original = String(texto || "").replace(/\r/g, "").replace(/[ \t ]+/g, " ");
  const norm = normalizar(original);
  const v = {};
  const s = {};

  const pat = despues(original, norm, "dominio|patente", token(PATENTE));
  if (pat) v.patente = pat.replace(/[\s-]/g, "");
  else {
    // Sin título: una sola patente del formato nuevo en todo el texto
    const sueltas = [...new Set((norm.toUpperCase().match(/\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b/g) || []).map((p) => p.replace(/\s/g, "")))];
    if (sueltas.length === 1) v.patente = sueltas[0];
  }

  // "Marca/Modelo: TOYOTA HILUX 2.8" → marca la primera palabra, modelo el resto
  const marcaModelo = despues(original, norm, "marca\\s*/\\s*modelo|marca\\s+y\\s+modelo", (x) => (/^[a-z]/i.test(x) ? x : null));
  if (marcaModelo) {
    const [primera, ...resto] = marcaModelo.split(" ");
    v.marca = recortar(primera, 60);
    v.modelo = recortar(resto.join(" "), 80);
  } else {
    v.marca = recortar(despues(original, norm, "marca", (x) => (/^[a-z]/i.test(x) ? x : null)), 60);
    v.modelo = recortar(despues(original, norm, "modelo"), 80);
  }
  // "Modelo: 2021" es el año, no el modelo
  if (v.modelo && /^(19|20)\d{2}$/.test(v.modelo)) { v.anio = Number(v.modelo); v.modelo = null; }
  const anio = despues(original, norm, "ano\\s+de\\s+fabricacion|ano\\s+modelo|modelo\\s+ano|ano|anio", token(/^(19[5-9]\d|20\d{2})\b/));
  if (anio) v.anio = Number(anio);
  v.motor = recortar(despues(original, norm, "motor", token(CODIGO(5))), 40);
  v.chasis = recortar(despues(original, norm, "chasis|chassis|vin", token(CODIGO(8))), 40);
  v.color = recortar(despues(original, norm, "color"), 40);
  v.tipo = tipoVehiculo(norm);
  v.combustible = combustible(norm);

  s.numero = recortar(despues(original, norm, "poliza|certificado", token(/^\d[\d./-]{2,}\d\b/)), 60);
  const { fecha, vencimiento } = vigencia(original, norm);
  s.fecha = fecha;
  s.vencimiento = vencimiento && (!fecha || vencimiento > fecha) ? vencimiento : null;
  const minus = norm.toLowerCase();
  const aseg = ASEGURADORAS.find(([clave]) => new RegExp(`\\b${clave}\\b`).test(minus));
  s.compania = aseg ? aseg[1] : null;
  const cob = COBERTURAS.find(([re]) => re.test(norm));
  s.cobertura = cob ? cob[1] : recortar(despues(original, norm, "cobertura"), 120);

  const limpio = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null && x !== undefined && x !== ""));
  const vehiculo = limpio(v);
  const seguro = limpio(s);
  return { vehiculo, seguro, encontrados: [...Object.keys(vehiculo), ...Object.keys(seguro).map((k) => `seguro.${k}`)] };
}
