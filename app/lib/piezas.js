// app/lib/piezas.js — Piezas de la OT con etiqueta QR (Órdenes de Producción,
// parte 17; diseño en notes/diseno-qr-piezas.md). Técnica pega la planilla
// técnica de la OT (hoja PLANILLA o CUT RITE) y Gypi arma una pieza por cada
// unidad física: un renglón con CANT 4 son 4 piezas, "1 de 4" … "4 de 4",
// cada una con su QR. En cada etapa (parte 18) se escanea la pieza.
import { filasTsv } from "./sueltos";
import { svgQR } from "./tarjetasQR";

/**
 * Las etapas que se escanean pieza por pieza son las de cada empresa: en
 * Configuración → Etapas se marca "Se escanea por pieza" y, si no pasan
 * todas las piezas, en qué columnas de la planilla técnica se fija Gypi
 * (migración 112). Una pieza guarda la lista de códigos de etapa por los que
 * pasa, en el orden de las etapas.
 */
export const MAX_COLUMNAS_REGLA = 12;

/** "Canto, L1A; L1B" → ["Canto", "L1A", "L1B"]. */
export function columnasDeTexto(texto) {
  return String(texto ?? "").split(/[,;\n]/).map((t) => t.trim()).filter(Boolean).slice(0, MAX_COLUMNAS_REGLA);
}

/**
 * Las etapas de la empresa que se escanean por pieza, en orden:
 * { codigo, nombre, icon, color, columnas } (columnas vacía = pasan todas).
 */
export function reglasPieza(etapas = []) {
  return (etapas || [])
    .filter((e) => e && e.por_pieza && e.activa !== false && Number(e.codigo) > 0)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.codigo - b.codigo)
    .map((e) => ({
      codigo: Number(e.codigo),
      nombre: e.nombre,
      // Etapas viejas guardan el nombre de un dibujo ("Hammer"): no se muestra
      icon: e.icon && !/^[A-Za-z]/.test(e.icon) ? e.icon : null,
      color: e.color || null,
      columnas: columnasDeTexto(e.columna_pieza),
    }));
}

/** código de etapa → nombre ("2" → "Canteado"), de todas las etapas de la empresa. */
export function nombresEtapas(etapas = []) {
  return Object.fromEntries((etapas || []).filter((e) => e && e.codigo != null).map((e) => [Number(e.codigo), e.nombre]));
}

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

function buscarColumnas(cols) {
  const primera = (f, desde = 0) => cols.findIndex((c, i) => i >= desde && f(c));
  const nombre = primera((c) => c.propios.some((p) => NOMBRE.has(p)));
  const material = primera((c) => c.propios.some((p) => MATERIAL.has(p)));
  const cantidad = primera((c) => c.propios.some((p) => CANTIDAD.has(p)));
  const l1 = primera((c) => c.propios.some((p) => p === "l1" || p === "largo") && !c.partes.some((p) => p.includes("skp")));
  const l2 = primera((c) => c.propios.some((p) => p === "l2" || p === "ancho") && !c.partes.some((p) => p.includes("skp")), l1 + 1);
  return { nombre, material, cantidad, l1, l2 };
}

/**
 * Columnas de la planilla que corresponden a los nombres que la empresa
 * escribió para una etapa. Una columna cuenta si su título, o el del grupo
 * de arriba, es uno de esos nombres (o empieza así, para nombres de 4 letras
 * o más: "Canto" toma "CANTOS"). Las columnas de totales y agregados no
 * cuentan: resumen lo de otras columnas.
 */
function columnasDeRegla(cols, columnas) {
  const terminos = columnas.map(norm).filter(Boolean);
  if (!terminos.length) return [];
  const coincide = (p, t) => p === t || (t.length >= 4 && p.startsWith(t));
  return cols.map((c, i) => {
    if (!c.hoja || c.partes.some((p) => p.includes("total") || p.includes("agregad"))) return -1;
    return terminos.some((t) => c.hoja === t || c.partes.some((p) => coincide(p, t))) ? i : -1;
  }).filter((i) => i >= 0);
}

/**
 * Lo pegado de la planilla técnica (hoja PLANILLA desde la fila PANEL, o la
 * hoja CUT RITE) → renglones de piezas.
 * Por qué etapas pasa cada pieza (reglas = reglasPieza(etapas)):
 *   - Etapa sin columnas: todas las piezas.
 *   - Etapa con columnas: las piezas que tienen algo en alguna de ellas. Si
 *     lo pegado no tiene ninguna de esas columnas, ninguna pieza (y avisa).
 * Se puede corregir a mano por renglón.
 * @param {string} texto
 * @param {object[]} reglas
 * @returns {{ renglones: object[], errores: { fila: number, motivo: string }[], avisos: string[],
 *   faltaColumnas: string[], sinColumna: object[] }}
 */
export function leerPiezas(texto, reglas = []) {
  const filas = filasTsv(texto).map((celdas, i) => ({ celdas, linea: i + 1 })).filter((f) => f.celdas.some((c) => c.trim()));
  const titulos = [];
  while (filas.length && !esFilaDatos(filas[0].celdas) && titulos.length < 6) {
    const { celdas } = filas.shift();
    if (!esFilaColumnaN(celdas)) titulos.push(celdas);
  }
  const vacio = { renglones: [], errores: [], avisos: [], sinColumna: [] };
  if (!titulos.length) return { ...vacio, faltaColumnas: ["títulos (copiá también la fila de PANEL, MATERIAL, L1…)"] };
  const cols = columnas(titulos);
  const col = buscarColumnas(cols);
  const faltaColumnas = [];
  if (col.nombre < 0) faltaColumnas.push("PANEL");
  if (col.cantidad < 0) faltaColumnas.push("CANT.");
  if (faltaColumnas.length) return { ...vacio, faltaColumnas };

  const porRegla = reglas.map((r) => ({ regla: r, indices: r.columnas.length ? columnasDeRegla(cols, r.columnas) : null }));
  const sinColumna = porRegla.filter((x) => x.indices && !x.indices.length).map((x) => x.regla);
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
    const etapas = porRegla.filter((x) => !x.indices || algunaCon(celdas, x.indices)).map((x) => x.regla.codigo);
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
  return { renglones, errores, avisos, faltaColumnas, sinColumna };
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

/**
 * Página con una etiqueta por pieza, del tamaño del rollo de la impresora de
 * etiquetas (una por página): OT, pieza, "2 de 4", medidas, material, módulo,
 * las etapas que le tocan y el QR.
 * @param {{ empresa?: string, ot: string, piezas: object[], tamano: { ancho: number, alto: number }, nombres?: Record<number, string> }} datos
 */
export async function htmlEtiquetasPiezas({ empresa = "", ot, piezas, tamano, nombres = {} }) {
  const qrMm = Math.min(tamano.alto - 6, tamano.ancho * 0.45);
  const escala = Math.max(0.6, Math.min(1.4, tamano.alto / 50));
  const pt = (n) => `${Math.round(n * escala * 10) / 10}pt`;
  const items = [];
  for (const p of piezas) {
    const qr = await svgQR(textoQrPieza(ot, p.id));
    const ruta = (p.etapas || []).map((c) => nombres[c] || `Etapa ${c}`).join(" › ");
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

/** Etapas de la pieza anteriores a `etapa` (en su ruta) que todavía no tienen escaneo. */
export function etapasSalteadas(pieza, etapa, pasosDeLaPieza = []) {
  const hechas = new Set(pasosDeLaPieza.map((p) => Number(p.etapa)));
  const ruta = (pieza?.etapas || []).map(Number);
  const i = ruta.indexOf(Number(etapa));
  return i <= 0 ? [] : ruta.slice(0, i).filter((e) => !hechas.has(e));
}

/**
 * Avance de las piezas de una OT por etapa: cuántas piezas llevan esa etapa,
 * cuántas ya pasaron y cuáles faltan. En el orden de `orden` (códigos); las
 * etapas que no están ahí van al final.
 * @returns {{ codigo: number, total: number, pasaron: number, faltan: object[] }[]}
 */
export function avancePiezas(piezas = [], pasos = [], orden = []) {
  const hechos = new Set(pasos.map((p) => `${p.pieza_id}|${Number(p.etapa)}`));
  const codigos = [...orden.map(Number)];
  for (const p of piezas) for (const e of p.etapas || []) if (!codigos.includes(Number(e))) codigos.push(Number(e));
  return codigos.map((codigo) => {
    const llevan = piezas.filter((p) => (p.etapas || []).map(Number).includes(codigo));
    const faltan = llevan.filter((p) => !hechos.has(`${p.id}|${codigo}`));
    return { codigo, total: llevan.length, pasaron: llevan.length - faltan.length, faltan };
  }).filter((a) => a.total > 0);
}

/** "Corte 120 de 218 · Canto 80 de 190". */
export function textoAvancePiezas(avance, nombres = {}) {
  return avance.map((a) => `${nombres[a.codigo] || `Etapa ${a.codigo}`} ${a.pasaron} de ${a.total}`).join(" · ");
}

/**
 * Lo que se le muestra al operario después de escanear, a partir de la
 * respuesta de /api/piezas/paso.
 * @returns {{ tono: "verde"|"amarillo"|"rojo", texto: string, detalle: string|null }}
 */
export function mensajeEscaneo(r, nombres = {}) {
  const nombreEtapa = (c) => nombres[c] || (Number(c) === Number(r?.etapa) && r?.etapaNombre) || `Etapa ${c}`;
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
