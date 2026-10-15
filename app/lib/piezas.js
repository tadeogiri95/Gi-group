// app/lib/piezas.js — Piezas de la OT con etiqueta QR (Órdenes de Producción,
// parte 17; diseño en notes/diseno-qr-piezas.md). Técnica pega la planilla
// técnica de la OT (hoja PLANILLA o CUT RITE) y Gypi arma una pieza por cada
// unidad física: un renglón con CANT 4 son 4 piezas, "1 de 4" … "4 de 4",
// cada una con su QR. En cada etapa (parte 18) se escanea la pieza.
import { filasTsv } from "./sueltos";
import { svgQR } from "./tarjetasQR";

/** Etapas que se escanean pieza por pieza. Armado va por módulo. */
export const ETAPAS_PIEZA = [
  { id: "corte", nombre: "Corte" },
  { id: "canto", nombre: "Canto" },
  { id: "cnc", nombre: "CNC" },
  { id: "especial", nombre: "Corte especial" },
];
export const IDS_ETAPAS_PIEZA = ETAPAS_PIEZA.map((e) => e.id);

export const MAX_RENGLONES = 1000;
export const MAX_POR_RENGLON = 500;
export const MAX_PIEZAS_OT = 3000;
export const LIMITES_PIEZA = { nombre: 80, modulo: 40, material: 120 };

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const esNumero = (s) => /^-?\d+([.,]\d+)?$/.test(String(s ?? "").trim());
const limpiar = (v, max) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return !s || s === "-" || s === "—" || s.startsWith("#") ? null : s.slice(0, max);
};

/** ¿La celda dice algo? "0", "-", "no" y los errores de Excel (#REF!) son vacío. */
export function tieneValor(celda) {
  const s = String(celda ?? "").trim();
  if (!s || s.startsWith("#")) return false;
  if (/^0+([.,]0+)?$/.test(s) || /^0+( 0+)*$/.test(s)) return false;
  return !["-", "—", "no", "false", "falso", "n/a"].includes(s.toLowerCase());
}

/** "1.234,5" / "402" / "402,5" → número; null si no se entiende. */
function leerMedida(texto) {
  const s = String(texto ?? "").trim();
  if (!esNumero(s)) return null;
  const n = Math.round(parseFloat(s.replace(",", ".")) * 10) / 10;
  return n > 0 && n < 100000 ? n : null;
}

/** El módulo de una pieza: lo que va antes del primer guion ("M.izq-11" → "M.izq"). */
export function moduloDe(nombre) {
  const s = String(nombre ?? "");
  const i = s.indexOf("-");
  if (i <= 0) return null;
  return s.slice(0, i).trim().slice(0, LIMITES_PIEZA.modulo) || null;
}

// Una fila es de títulos mientras no tenga 3 números (las de piezas tienen
// medidas y cantidad). Las filas "Columna 1, Columna 2…" de las tablas de
// Excel no cuentan como títulos.
const esFilaDatos = (celdas) => celdas.filter(esNumero).length >= 3;
const esFilaColumnaN = (celdas) => celdas.every((c) => !c.trim() || /^columna\s*\d+$/i.test(c.trim()) || esNumero(c));

/**
 * Títulos de cada columna. Las filas de arriba son grupos (celdas combinadas
 * que se copian vacías a la derecha, por eso se arrastran); la última fila es
 * el título propio de la columna.
 */
function columnas(titulos) {
  const ancho = Math.max(0, ...titulos.map((f) => f.length));
  const arrastre = titulos.map(() => "");
  const cols = [];
  for (let c = 0; c < ancho; c++) {
    const grupos = [];
    const propios = [];
    titulos.forEach((fila, r) => {
      const v = norm(fila[c]);
      if (v) { propios.push(v); arrastre[r] = v; }
      if (r < titulos.length - 1 && arrastre[r]) grupos.push(arrastre[r]);
      else if (r === titulos.length - 1 && v) grupos.push(v);
    });
    cols.push({ propios, partes: grupos, hoja: norm(titulos.at(-1)[c]) });
  }
  return cols;
}

const NOMBRE = new Set(["panel", "pieza", "piezas", "nombre", "n", "na", "no", "nro", "numero"]);
const MATERIAL = new Set(["material", "mat", "materiales"]);
const CANTIDAD = new Set(["cant", "cantidad", "cantidades"]);
const CNC = new Set(["ff", "ran", "ranurado", "cal", "calado", "cnc", "perforado", "perforacion"]);
const ESPECIAL = ["corte45", "45", "diagonal", "diag", "corteespecial"];

function buscarColumnas(cols) {
  const primera = (f, desde = 0) => cols.findIndex((c, i) => i >= desde && f(c));
  const nombre = primera((c) => c.propios.some((p) => NOMBRE.has(p)));
  const material = primera((c) => c.propios.some((p) => MATERIAL.has(p)));
  const cantidad = primera((c) => c.propios.some((p) => CANTIDAD.has(p)));
  const l1 = primera((c) => c.propios.some((p) => p === "l1" || p === "largo") && !c.partes.some((p) => p.includes("skp")));
  const l2 = primera((c) => c.propios.some((p) => p === "l2" || p === "ancho") && !c.partes.some((p) => p.includes("skp")), l1 + 1);
  const indices = (f) => cols.map((c, i) => (f(c) ? i : -1)).filter((i) => i >= 0);
  const canto = indices((c) => !c.partes.some((p) => p.includes("totales"))
    && c.partes.some((p) => p.startsWith("canto") || ["l1a", "l1b", "l2a", "l2b"].includes(p)));
  const cnc = indices((c) => CNC.has(c.hoja));
  const especial = indices((c) => !c.partes.some((p) => p.includes("agregad"))
    && c.partes.some((p) => ESPECIAL.includes(p)) && !!c.hoja);
  return { nombre, material, cantidad, l1, l2, canto, cnc, especial };
}

/**
 * Lo pegado de la planilla técnica (hoja PLANILLA desde la fila PANEL, o la
 * hoja CUT RITE) → renglones de piezas.
 * Qué etapas le tocan a cada pieza:
 *   - Corte: todas.
 *   - Canto: si alguna columna de cantos dice algo. Sin columnas de cantos, todas.
 *   - CNC: si FF, ranurado o calado dicen algo. Sin esas columnas, todas.
 *   - Corte especial: si corte 45° o diagonal dicen algo. Sin esas columnas, ninguna.
 * Se puede corregir a mano por renglón.
 * @returns {{ renglones: object[], errores: { fila: number, motivo: string }[], avisos: string[],
 *   faltaColumnas: string[], encontradas: { canto: boolean, cnc: boolean, especial: boolean } }}
 */
export function leerPiezas(texto) {
  const filas = filasTsv(texto).map((celdas, i) => ({ celdas, linea: i + 1 })).filter((f) => f.celdas.some((c) => c.trim()));
  const titulos = [];
  while (filas.length && !esFilaDatos(filas[0].celdas) && titulos.length < 6) {
    const { celdas } = filas.shift();
    if (!esFilaColumnaN(celdas)) titulos.push(celdas);
  }
  const vacio = { renglones: [], errores: [], avisos: [], encontradas: { canto: false, cnc: false, especial: false } };
  if (!titulos.length) return { ...vacio, faltaColumnas: ["títulos (copiá también la fila de PANEL, MATERIAL, L1…)"] };
  const col = buscarColumnas(columnas(titulos));
  const faltaColumnas = [];
  if (col.nombre < 0) faltaColumnas.push("PANEL");
  if (col.cantidad < 0) faltaColumnas.push("CANT.");
  if (faltaColumnas.length) return { ...vacio, faltaColumnas };

  const encontradas = { canto: col.canto.length > 0, cnc: col.cnc.length > 0, especial: col.especial.length > 0 };
  const algunaCon = (celdas, indices) => indices.some((i) => tieneValor(celdas[i]));
  const renglones = [];
  const errores = [];
  const avisos = [];
  const vistos = new Map();
  let piezas = 0;
  for (const { celdas, linea } of filas) {
    let nombre = limpiar(celdas[col.nombre], LIMITES_PIEZA.nombre);
    // Renglones vacíos de la planilla (fórmulas que dan 0) o filas de abajo
    if (!nombre || nombre === "0") continue;
    const cantTexto = String(celdas[col.cantidad] ?? "").trim();
    if (!tieneValor(cantTexto)) {
      errores.push({ fila: linea, motivo: `"${nombre}" no tiene cantidad` });
      continue;
    }
    const cantidad = Number(cantTexto.replace(",", "."));
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_POR_RENGLON) {
      errores.push({ fila: linea, motivo: `"${nombre}": no entiendo la cantidad "${cantTexto}"` });
      continue;
    }
    if (renglones.length >= MAX_RENGLONES || piezas + cantidad > MAX_PIEZAS_OT) {
      errores.push({ fila: linea, motivo: `Una OT puede tener hasta ${MAX_PIEZAS_OT} piezas` });
      break;
    }
    // Dos renglones con el mismo nombre: el segundo pasa a "nombre (2)"
    const clave = norm(nombre);
    const veces = (vistos.get(clave) || 0) + 1;
    vistos.set(clave, veces);
    if (veces > 1) {
      const nuevo = `${nombre.slice(0, LIMITES_PIEZA.nombre - 5)} (${veces})`;
      avisos.push(`"${nombre}" está repetido: el renglón de la fila ${linea} queda como "${nuevo}".`);
      nombre = nuevo;
    }
    const etapas = ["corte"];
    if (!encontradas.canto || algunaCon(celdas, col.canto)) etapas.push("canto");
    if (!encontradas.cnc || algunaCon(celdas, col.cnc)) etapas.push("cnc");
    if (encontradas.especial && algunaCon(celdas, col.especial)) etapas.push("especial");
    renglones.push({
      nombre,
      modulo: moduloDe(nombre),
      material: col.material >= 0 ? limpiar(celdas[col.material], LIMITES_PIEZA.material) : null,
      l1: col.l1 >= 0 ? leerMedida(celdas[col.l1]) : null,
      l2: col.l2 >= 0 ? leerMedida(celdas[col.l2]) : null,
      cantidad,
      etapas,
    });
    piezas += cantidad;
  }
  return { renglones, errores, avisos, faltaColumnas, encontradas };
}

/** Renglones → una pieza por unidad física ("2 de 4"), en el orden de la planilla. */
export function expandirPiezas(renglones = []) {
  const out = [];
  renglones.forEach((r, i) => {
    for (let u = 1; u <= r.cantidad; u++) {
      out.push({ renglon: i, nombre: r.nombre, modulo: r.modulo ?? null, material: r.material ?? null, l1: r.l1 ?? null, l2: r.l2 ?? null, unidad: u, de: r.cantidad, etapas: r.etapas });
    }
  });
  return out;
}

/** Piezas guardadas → renglones (para la lista), agrupando las unidades. */
export function agruparRenglones(piezas = []) {
  const porNombre = new Map();
  for (const p of piezas) {
    let r = porNombre.get(p.nombre);
    if (!r) {
      r = { nombre: p.nombre, modulo: p.modulo, material: p.material, l1: p.l1, l2: p.l2, renglon: p.renglon, etapas: p.etapas || [], piezas: [] };
      porNombre.set(p.nombre, r);
    }
    r.piezas.push(p);
  }
  const lista = [...porNombre.values()];
  lista.forEach((r) => r.piezas.sort((a, b) => a.unidad - b.unidad));
  return lista.sort((a, b) => (a.renglon ?? 0) - (b.renglon ?? 0));
}

/** Cuántas piezas se suman y cuántas se sacan al volver a pegar la planilla. */
export function cambiosAlReemplazar(actuales = [], nuevas = []) {
  const clave = (p) => `${p.nombre}\u0000${p.unidad}`;
  const viejas = new Set(actuales.map(clave));
  const quedan = new Set(nuevas.map(clave));
  return {
    nuevas: nuevas.filter((p) => !viejas.has(clave(p))).length,
    siguen: nuevas.filter((p) => viejas.has(clave(p))).length,
    salen: actuales.filter((p) => !quedan.has(clave(p))).length,
  };
}

/** "402 × 342" */
export function medidas(p) {
  const f = (n) => (n == null ? null : Number(n).toLocaleString("es-AR"));
  return [f(p.l1), f(p.l2)].filter(Boolean).join(" × ");
}

/** Lo que dice el QR de una pieza: "OT M-7495 - PIEZA - 1234". */
export function textoQrPieza(ot, id) {
  return `OT ${ot} - PIEZA - ${id}`;
}

/** QR de pieza → { ot, id }, o null si no es de una pieza. */
export function leerQrPieza(texto) {
  const m = String(texto ?? "").trim().match(/^OT\s+([\w.-]{1,40})\s+-\s+PIEZA\s+-\s+(\d{1,15})$/i);
  return m ? { ot: m[1], id: Number(m[2]) } : null;
}

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));
const nombreEtapa = (id) => ETAPAS_PIEZA.find((e) => e.id === id)?.nombre || id;

/**
 * Página con una etiqueta por pieza, del tamaño del rollo de la impresora de
 * etiquetas (una por página): OT, pieza, "2 de 4", medidas, material, módulo,
 * las etapas que le tocan y el QR.
 * @param {{ empresa?: string, ot: string, piezas: object[], tamano: { ancho: number, alto: number } }} datos
 */
export async function htmlEtiquetasPiezas({ empresa = "", ot, piezas, tamano }) {
  const qrMm = Math.min(tamano.alto - 6, tamano.ancho * 0.45);
  const escala = Math.max(0.6, Math.min(1.4, tamano.alto / 50));
  const pt = (n) => `${Math.round(n * escala * 10) / 10}pt`;
  const items = [];
  for (const p of piezas) {
    const qr = await svgQR(textoQrPieza(ot, p.id));
    const ruta = (p.etapas || []).map(nombreEtapa).join(" › ");
    items.push(`
  <div class="etiqueta">
    <div class="texto">
      <div class="ot">${empresa ? `${esc(empresa)} · ` : ""}OT ${esc(ot)}</div>
      <div class="pieza">${esc(p.nombre)}</div>
      <div class="unidad">${p.unidad} de ${p.de}${medidas(p) ? ` · ${esc(medidas(p))}` : ""}</div>
      ${p.material ? `<div class="chico">${esc(p.material)}</div>` : ""}
      ${p.modulo ? `<div class="chico">Módulo ${esc(p.modulo)}</div>` : ""}
      ${ruta ? `<div class="ruta">${esc(ruta)} · N° ${p.id}</div>` : `<div class="ruta">N° ${p.id}</div>`}
    </div>
    <div class="qr">${qr}</div>
  </div>`);
  }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Piezas OT ${esc(ot)}</title>
<style>
  @page { size: ${tamano.ancho}mm ${tamano.alto}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #000; }
  .etiqueta { width: ${tamano.ancho}mm; height: ${tamano.alto}mm; padding: 2.5mm; display: flex; gap: 2.5mm; align-items: center; overflow: hidden; page-break-after: always; break-after: page; }
  .texto { flex: 1; min-width: 0; }
  .ot { font-size: ${pt(8)}; font-weight: 700; text-transform: uppercase; }
  .pieza { font-size: ${pt(15)}; font-weight: 800; line-height: 1.1; word-break: break-word; }
  .unidad { font-size: ${pt(10)}; font-weight: 700; margin-top: .5mm; }
  .chico { font-size: ${pt(7)}; margin-top: .3mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ruta { font-size: ${pt(7)}; margin-top: .8mm; border-top: .3mm solid #000; padding-top: .5mm; }
  .qr svg { width: ${qrMm}mm; height: ${qrMm}mm; display: block; }
</style></head><body>${items.join("")}</body></html>`;
}

/** Abre las etiquetas en una pestaña nueva con el diálogo de impresión. */
export async function imprimirEtiquetasPiezas(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(await htmlEtiquetasPiezas(datos));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 300);
}

// ─── Parte 18: escaneo de cada pieza en cada etapa ─────────────────────────

/** Nombre de la etapa de pieza ("canto" → "Canto"). */
export const nombreEtapaPieza = nombreEtapa;

/**
 * A qué etapa de pieza corresponde una etapa de la empresa. Manda lo que se
 * eligió en Configuración → Etapas ("Se escanea por pieza como", migración
 * 111). Si no se eligió nada, se adivina por el nombre: "Corte especial" →
 * especial, "Canto"/"Canteado" → canto, "CNC"/"Procesos"/"Perforado" → cnc,
 * "Corte"/"Seccionado" → corte. Las demás (Armado, …) → null.
 */
export function tipoDeEtapa(etapa) {
  if (IDS_ETAPAS_PIEZA.includes(etapa?.tipo_pieza)) return etapa.tipo_pieza;
  return tipoPorNombre(etapa);
}

function tipoPorNombre(etapa) {
  const n = norm(etapa?.nombre);
  if (!n) return null;
  if (n.includes("especial") || n.includes("diagonal") || n.includes("45")) return "especial";
  if (n.includes("canto") || n.includes("cante")) return "canto";
  if (["cnc", "proceso", "perfor", "mecaniz", "router", "ranur", "calad"].some((p) => n.includes(p))) return "cnc";
  if (n.includes("corte") || n.includes("seccion") || n.includes("escuadr")) return "corte";
  return null;
}

/**
 * Las etapas de la empresa (activas) que se escanean pieza por pieza, una por
 * tipo. Si alguna etapa tiene elegido "Se escanea por pieza como", solo
 * cuentan las elegidas; si ninguna, se adivina por el nombre.
 * @returns {Record<string, object|null>} tipo → etapa de la empresa
 */
export function etapasDePieza(etapas = []) {
  const activas = (etapas || []).filter((e) => e && e.activa !== false);
  const elegidas = activas.some((e) => IDS_ETAPAS_PIEZA.includes(e.tipo_pieza));
  const out = {};
  for (const tipo of IDS_ETAPAS_PIEZA) {
    out[tipo] = (elegidas
      ? activas.find((e) => e.tipo_pieza === tipo)
      : activas.find((e) => tipoPorNombre(e) === tipo)) || null;
  }
  return out;
}

/** La etapa de la empresa (activa) que corresponde a una etapa de pieza, o null. */
export function etapaDeTipo(etapas = [], tipo) {
  return etapasDePieza(etapas)[tipo] || null;
}

/** Tipo de pieza de una etapa de la empresa, mirando todas las etapas. */
export function tipoDeEtapaEn(etapas = [], etapa) {
  if (!etapa) return null;
  const mapa = etapasDePieza(etapas);
  const misma = (x) => x === etapa || (etapa.id != null && x.id === etapa.id) || (etapa.codigo != null && x.codigo === etapa.codigo);
  return IDS_ETAPAS_PIEZA.find((t) => mapa[t] && misma(mapa[t])) || null;
}

/**
 * Los botones del escaneo: los 4 tipos con el nombre, ícono y color de la
 * etapa de la empresa que les corresponde (si hay).
 */
export function botonesEtapasPieza(etapas = []) {
  const mapa = etapasDePieza(etapas);
  // Si la empresa ya eligió sus etapas, solo se muestran las elegidas
  const elegidas = (etapas || []).some((e) => e?.activa !== false && IDS_ETAPAS_PIEZA.includes(e?.tipo_pieza));
  return ETAPAS_PIEZA.filter((e) => !elegidas || mapa[e.id]).map((e) => ({
    id: e.id,
    nombre: mapa[e.id]?.nombre || e.nombre,
    // Etapas viejas guardan el nombre de un dibujo ("Hammer"): no se muestra
    icon: mapa[e.id]?.icon && !/^[A-Za-z]/.test(mapa[e.id].icon) ? mapa[e.id].icon : null,
    color: mapa[e.id]?.color || null,
    etapa: mapa[e.id],
  }));
}

/** tipo → nombre que usa la empresa ("canto" → "Canteado"). */
export function nombresEtapasPieza(etapas = []) {
  const mapa = etapasDePieza(etapas);
  return Object.fromEntries(ETAPAS_PIEZA.map((e) => [e.id, mapa[e.id]?.nombre || e.nombre]));
}

/** Etapas de la pieza anteriores a `etapa` que todavía no tienen escaneo. */
export function etapasSalteadas(pieza, etapa, pasosDeLaPieza = []) {
  const hechas = new Set(pasosDeLaPieza.map((p) => p.etapa));
  const orden = IDS_ETAPAS_PIEZA.filter((e) => (pieza?.etapas || []).includes(e));
  const antes = IDS_ETAPAS_PIEZA.slice(0, IDS_ETAPAS_PIEZA.indexOf(etapa));
  return orden.filter((e) => antes.includes(e) && !hechas.has(e));
}

/**
 * Avance de las piezas de una OT por etapa: cuántas piezas llevan esa etapa,
 * cuántas ya pasaron y cuáles faltan.
 * @returns {Record<string, { total: number, pasaron: number, faltan: object[] }>}
 */
export function avancePiezas(piezas = [], pasos = []) {
  const hechos = new Set(pasos.map((p) => `${p.pieza_id}|${p.etapa}`));
  const out = {};
  for (const e of IDS_ETAPAS_PIEZA) {
    const llevan = piezas.filter((p) => (p.etapas || []).includes(e));
    const faltan = llevan.filter((p) => !hechos.has(`${p.id}|${e}`));
    out[e] = { total: llevan.length, pasaron: llevan.length - faltan.length, faltan };
  }
  return out;
}

/** "Corte 120 de 218 · Canto 80 de 190" (solo las etapas que alguna pieza lleva). */
export function textoAvancePiezas(avance) {
  return IDS_ETAPAS_PIEZA.filter((e) => avance[e]?.total)
    .map((e) => `${nombreEtapa(e)} ${avance[e].pasaron} de ${avance[e].total}`)
    .join(" · ");
}

/**
 * Lo que se le muestra al operario después de escanear, a partir de la
 * respuesta de /api/piezas/paso.
 * @returns {{ tono: "verde"|"amarillo"|"rojo", texto: string, detalle: string|null }}
 */
export function mensajeEscaneo(r, nombres = {}) {
  const nombreEtapa = (id) => nombres[id] || nombreEtapaPieza(id);
  if (!r?.ok) return { tono: "rojo", texto: r?.error || "No se pudo anotar la pieza.", detalle: null };
  const p = r.pieza || {};
  const cual = `${p.nombre}${p.de > 1 ? ` (${p.unidad} de ${p.de})` : ""}`;
  const etapa = nombreEtapa(r.etapa);
  const progreso = r.progreso ? `${etapa}: ${r.progreso.pasaron} de ${r.progreso.total} piezas de la OT ${p.ot}.` : null;
  const terminada = r.etapaTerminada ? ` ✅ Pasaron todas: la etapa ${r.etapaTerminada.nombre} quedó terminada, falta la firma.` : "";
  const detalle = progreso ? `${progreso}${terminada}` : null;
  if (r.ya) return { tono: "amarillo", texto: `${cual} ya estaba escaneada en ${etapa}.`, detalle };
  if (!r.requerida) return { tono: "amarillo", texto: `${cual} quedó anotada en ${etapa}, pero según la planilla no pasa por esa etapa.`, detalle };
  if (r.faltan?.length) {
    return { tono: "amarillo", texto: `${cual} pasó por ${etapa}, pero no tiene escaneo de ${r.faltan.map(nombreEtapa).join(" ni ")}.`, detalle };
  }
  return { tono: "verde", texto: `${cual} pasó por ${etapa}.`, detalle };
}
