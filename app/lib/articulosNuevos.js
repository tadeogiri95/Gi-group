// app/lib/articulosNuevos.js — Artículos nuevos dados de alta desde Gypi
// (Stock, ítem 40; migración 124; diseño en notes/diseno-articulos-nuevos.md).
//
// Los dueños y administradores cargan un artículo que no está en la hoja
// ARTICULOS del libro MRP, con los mismos campos que esa hoja. Gypi le arma
// un SKU provisorio igual que la fórmula de la planilla:
//   centro de costos . familia . tipo . marca . color . medida . pack . número
// con los números de cada lista en la hoja TABLAS (sin ceros a la izquierda)
// y el número siguiente al más alto. El script de la planilla lo anota al
// final de ARTICULOS; si la fórmula le da otro SKU, la app lo cambia.
import { filasCsv } from "./csvProyectos";
import { normalizarTitulo, filtrarArticulos } from "./stock";

/** config_sistema: las listas de TABLAS copiadas al sincronizar. */
export const CLAVE_TABLAS_MRP = "stock_tablas_mrp";

/**
 * Listas de TABLAS que forman el SKU, en el orden del SKU. `titulo` es el de
 * la columna con los nombres; el número está en la columna de al lado que se
 * llama ID (o en `tituloId`).
 */
export const LISTAS_SKU = [
  { campo: "division", nombre: "División", titulo: "centro_de_costos", tituloId: "centro_de_costos_id" },
  { campo: "familia", nombre: "Familia", titulo: "familia" },
  { campo: "tipo", nombre: "Tipo de material", titulo: "tipo" },
  { campo: "marca", nombre: "Marca", titulo: "marca" },
  { campo: "color", nombre: "Color/Acabado", titulo: "color" },
  { campo: "unidad", nombre: "Unidad de medida", titulo: "medida" },
  { campo: "pack", nombre: "Pack/Bulto", titulo: "pack" },
];

export const CATEGORIAS = ["A", "B", "C"];

/** Prefijo de los artículos en el link de la planilla ("GY-ART-12"). */
export const PREFIJO_ALTA = "GY-ART-";

const igual = (a, b) => normalizarTitulo(a) === normalizarTitulo(b);

/**
 * Lee la hoja TABLAS (publicada como CSV): cada lista es una columna con su
 * título (MARCA, FAMILIA…) y al lado otra llamada ID con el número.
 * @returns {{ listas: Record<string, { id: string, nombre: string }[]>, faltan: string[] }}
 */
export function leerTablas(texto) {
  const filas = filasCsv(texto);
  const iTitulos = filas.findIndex((f) => f.some((c) => igual(c, "marca")) && f.some((c) => igual(c, "familia")));
  const listas = {};
  const faltan = [];
  if (iTitulos === -1) return { listas, faltan: LISTAS_SKU.map((l) => l.nombre) };
  const titulos = filas[iTitulos];
  for (const l of LISTAS_SKU) {
    const iNombre = titulos.findIndex((c) => igual(c, l.titulo));
    const iId = l.tituloId ? titulos.findIndex((c) => igual(c, l.tituloId)) : iNombre + 1;
    if (iNombre === -1 || iId < 0 || (!l.tituloId && !igual(titulos[iId], "id"))) { faltan.push(l.nombre); continue; }
    const vistos = new Set();
    const lista = [];
    for (const f of filas.slice(iTitulos + 1)) {
      const nombre = String(f[iNombre] ?? "").replace(/\s+/g, " ").trim();
      const id = String(f[iId] ?? "").trim();
      if (!nombre || !/^\d{1,6}$/.test(id) || vistos.has(normalizarTitulo(nombre))) continue;
      vistos.add(normalizarTitulo(nombre));
      lista.push({ id: String(Number(id)), nombre: nombre.slice(0, 80) });
    }
    if (!lista.length) faltan.push(l.nombre);
    else listas[l.campo] = lista;
  }
  return { listas, faltan };
}

/** El renglón de una lista que tiene ese nombre (sin importar mayúsculas ni acentos). */
export function buscarEnLista(lista, nombre) {
  return (Array.isArray(lista) ? lista : []).find((x) => igual(x.nombre, nombre)) || null;
}

/** El número más alto al final de los SKU ("1.3.2.69.155.5.3.53" → 53), más uno. */
export function siguienteNumero(skus) {
  let max = 0;
  for (const s of skus || []) {
    const m = /\.(\d{1,9})$/.exec(String(s ?? "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Nombre normalizado como la planilla: Nombre-Marca-Color-Pack. */
export function nombreNormalizado({ nombre_articulo, marca, color, pack }) {
  return [nombre_articulo, marca, color, pack].map((s) => String(s ?? "").trim()).join("-").slice(0, 200);
}

/**
 * SKU provisorio y los nombres tal como están en TABLAS.
 * @returns {{ sku: string, valores: Record<string, string> } | { error: string }}
 */
export function armarSku(datos, listas, numero) {
  const ids = [];
  const valores = {};
  for (const l of LISTAS_SKU) {
    const hallado = buscarEnLista(listas?.[l.campo], datos[l.campo]);
    if (!hallado) return { error: `${l.nombre} "${String(datos[l.campo] ?? "").trim()}" no está en la hoja TABLAS. Agregala en la planilla y tocá Sincronizar en Stock.` };
    ids.push(hallado.id);
    valores[l.campo] = hallado.nombre;
  }
  return { sku: [...ids, numero].join("."), valores };
}

/** Artículos con un nombre parecido, para no cargar dos veces el mismo. */
export function parecidos(articulos, nombre, max = 3) {
  const t = String(nombre ?? "").trim();
  if (t.length < 4) return [];
  return filtrarArticulos(articulos, { texto: t }).slice(0, max);
}

/** Valor de cada título de ARTICULOS para un alta (el script escribe solo los que no son fórmula). */
export function articuloParaPlanilla(a) {
  if (!a?.id || !a.sku) return null;
  const num = (n) => (n === null || n === undefined || n === "" ? "" : Number(n));
  return {
    id: `${PREFIJO_ALTA}${a.id}`,
    alta: a.id,
    sku: a.sku,
    columnas: {
      "ID": a.id_planilla,
      "ID_SKU": a.sku,
      "Numero Articulo": a.numero,
      "Categoría": a.categoria || "C",
      "Nombre normalizado": a.nombre,
      "Nombre Articulo": a.nombre_articulo,
      "División": a.division,
      "Familia": a.familia,
      "Tipo de Material": a.tipo,
      "Marca": a.marca,
      "Color/Acabado": a.color,
      "Unidad Medida": a.unidad,
      "Pack/Bulto": a.pack,
      "Stock_de_seguridad": num(a.stock_seguridad),
      "Factor Tiempo": num(a.factor_tiempo),
      "PROVEEDOR PRINCIPAL": a.proveedor_principal || "",
      "LOTE MÍNIMO / MÚLTIPLO": num(a.lote_minimo),
    },
  };
}

/** Tablas de Gypi que guardan el SKU de un artículo (se cambian si la planilla le dio otro). */
export const TABLAS_CON_SKU = ["movimientos_stock", "pedidos_compra", "ordenes_compra_items"];
