// app/lib/pedidoPegado.js — Pedir material pegando renglones de la planilla
// (Compras, ítem 41). Desde la compu se copian renglones de la hoja
// INVENTARIO del libro MRP (filtrada, por ejemplo, por 🔴 URGENTE) y Gypi arma
// un pedido por artículo de una sola vez.
//
// Se acepta:
//   - renglones de INVENTARIO con la fila de títulos: se usan SKU, ARTICULO y
//     CANTIDAD SUGERIDA (o una columna "A COMPRAR" / "CANTIDAD", si la hay);
//   - renglones enteros de INVENTARIO sin títulos (desde la columna A): la
//     cantidad es la columna T (CANTIDAD SUGERIDA);
//   - dos columnas: código o nombre del artículo, y cantidad.
// El artículo se reconoce por SKU o por el nombre (el nombre normalizado de
// la planilla). Renglones sin cantidad o en 0 se saltean; el mismo artículo
// dos veces se suma.
import { filasTsv } from "./sueltos";
import { normalizarTitulo, numeroPlanilla } from "./stock";

export const MAX_PEGADO = 200;

// Columna T de INVENTARIO (CANTIDAD SUGERIDA), contando desde A = 0
const COL_SUGERIDA = 19;

const TITULOS_SKU = ["sku", "id_sku", "codigo", "código"].map(normalizarTitulo);
const TITULOS_NOMBRE = ["articulo", "nombre normalizado", "nombre articulo", "descripcion articulo", "material"];
// En orden de preferencia: si hay una columna propia de "a comprar" gana a la sugerida
const TITULOS_CANTIDAD = ["a comprar", "cantidad a comprar", "cantidad a pedir", "pedir", "cantidad sug*", "cantidad"];

function buscarColumna(titulos, patrones) {
  for (const p of patrones) {
    const i = p.endsWith("*") ? titulos.findIndex((t) => t.startsWith(p.slice(0, -1))) : titulos.indexOf(p);
    if (i !== -1) return i;
  }
  return -1;
}

/** Cantidad mayor a cero o null ("24", "15,7", "1.234", "" → null). */
function cantidadDe(celda) {
  const n = numeroPlanilla(celda);
  return n !== null && n > 0 ? n : null;
}

/**
 * Lee lo pegado y lo cruza con los artículos del stock.
 * @param {string} texto lo copiado de la planilla (celdas separadas por tabulación)
 * @param {Array<{sku: string, nombre?: string, unidad?: string}>} articulos
 * @returns {{
 *   reconocidos: Array<{sku: string, nombre: string, unidad: string|null, cantidad: number}>,
 *   noEncontrados: Array<{texto: string, cantidad: number|null}>,
 *   sinCantidad: Array<{texto: string}>,
 *   demasiados: boolean,
 * }}
 */
export function leerPedidoPegado(texto, articulos = []) {
  const porSku = new Map();
  const porNombre = new Map();
  for (const a of Array.isArray(articulos) ? articulos : []) {
    if (!a?.sku) continue;
    porSku.set(String(a.sku).trim(), a);
    if (a.nombre) porNombre.set(normalizarTitulo(a.nombre), a);
  }
  const buscar = (celda) => {
    const t = String(celda ?? "").trim();
    if (!t) return null;
    return porSku.get(t) || porNombre.get(normalizarTitulo(t)) || null;
  };

  const filas = filasTsv(texto).map((f) => f.map((c) => String(c ?? "").trim())).filter((f) => f.some(Boolean));
  const iTitulos = filas.findIndex((f) => f.some((c) => TITULOS_SKU.includes(normalizarTitulo(c))));
  let cols = null;
  if (iTitulos !== -1) {
    const titulos = filas[iTitulos].map(normalizarTitulo);
    cols = {
      sku: titulos.findIndex((t) => TITULOS_SKU.includes(t)),
      nombre: buscarColumna(titulos, TITULOS_NOMBRE),
      cantidad: buscarColumna(titulos, TITULOS_CANTIDAD),
    };
  }
  const renglones = iTitulos === -1 ? filas : filas.slice(iTitulos + 1);

  const juntos = new Map();
  const noEncontrados = [];
  const sinCantidad = [];
  let leidos = 0;
  for (const f of renglones) {
    // La fila de títulos repetida (al pegar dos tandas) no es un artículo
    if (f.some((c) => TITULOS_SKU.includes(normalizarTitulo(c)))) continue;
    if (++leidos > MAX_PEGADO) break;
    let articulo = null;
    let usada = -1;
    let cantidad = null;
    if (cols) {
      articulo = buscar(f[cols.sku]) || (cols.nombre !== -1 ? buscar(f[cols.nombre]) : null);
      cantidad = cols.cantidad !== -1 ? cantidadDe(f[cols.cantidad]) : null;
    } else {
      usada = f.findIndex((c) => buscar(c));
      articulo = usada !== -1 ? buscar(f[usada]) : null;
      if (usada === 0 && f.length > COL_SUGERIDA) {
        // Renglón entero de INVENTARIO, sin títulos
        cantidad = cantidadDe(f[COL_SUGERIDA]);
      } else {
        // La última celda con número, sin contar la del artículo
        for (let i = f.length - 1; i >= 0; i--) {
          if (i === usada) continue;
          cantidad = cantidadDe(f[i]);
          if (cantidad !== null) break;
        }
      }
    }
    if (!articulo) {
      // Lo que se pegó, sin los números, para que se reconozca el renglón
      const textoFila = cols
        ? [f[cols.sku], cols.nombre !== -1 ? f[cols.nombre] : ""].filter(Boolean).join(" · ")
        : f.filter((c) => c && cantidadDe(c) === null).slice(0, 2).join(" · ");
      noEncontrados.push({ texto: (textoFila || f.filter(Boolean).join(" · ")).slice(0, 200), cantidad });
      continue;
    }
    if (cantidad === null) {
      sinCantidad.push({ texto: articulo.nombre || articulo.sku });
      continue;
    }
    const previo = juntos.get(articulo.sku);
    if (previo) previo.cantidad = Math.round((previo.cantidad + cantidad) * 1000) / 1000;
    else juntos.set(articulo.sku, { sku: articulo.sku, nombre: articulo.nombre || articulo.sku, unidad: articulo.unidad || null, cantidad });
  }
  return { reconocidos: [...juntos.values()], noEncontrados, sinCantidad, demasiados: leidos > MAX_PEGADO };
}
