// app/lib/consumoOt.js — Consumir en tanda los herrajes y accesorios de una OT
// (pedido de Tadeo, 27/11): se elige la OT, Gypi trae lo que necesita según
// la planilla MRP (necesidades_stock, 108) con lo que ya se retiró, y se
// registra todo junto. El retiro de a uno (escanear, OT, cantidad) sigue igual.
//
// Reglas de Tadeo:
//  - entra todo menos placas, fondos y cantos (esos se descuentan por otro
//    lado: el canto con los escaneos de piezas, las placas al cortar);
//  - la cantidad a consumir y también la necesidad se pueden cambiar ("por si
//    se decide hacer un cambio de último momento o por conveniencia"); cada
//    cambio de necesidad queda asentado con quién, fecha y hora
//    (necesidades_cambios, 213). Para cada OT y artículo vale el último
//    cambio; si no hay, lo que dice la planilla MRP.
import { claseMaterialMrp } from "./materialMrp";
import { leerCantidadMovimiento } from "./movimientosStock";

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const r3 = (n) => Math.round(n * 1000) / 1000;
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** La necesidad escrita (puede ser 0: ese artículo ya no va), o null si no es un número. */
export function leerNecesidad(texto) {
  const t = String(texto ?? "").trim();
  if (/^0+([.,]0*)?$/.test(t)) return 0;
  return leerCantidadMovimiento(t);
}

/** Número para mostrar en un campo ("12,5"). */
export const numeroCampo = (n) => (n == null ? "" : String(r3(n)).replace(".", ","));

/**
 * Si el artículo va en la lista de la OT: todo menos placas, fondos y cantos.
 * Las chapas, mallas y paneles (familia de las placas) tampoco: se cortan.
 * @param {{ nombre?: string, familia?: string, division?: string }} articulo
 */
export function esHerrajeOAccesorio(articulo) {
  if (claseMaterialMrp(articulo)) return false;
  if (/PLACA|CHAPA|MALLA|PANEL/.test(sinTildes(articulo?.familia))) return false;
  return true;
}

/**
 * La necesidad que vale para cada artículo de la OT: el último cambio hecho en
 * Gypi o, si no hay, la de la planilla MRP.
 * @param {object[]} necesidades renglones de necesidades_stock (sku, nombre, cantidad)
 * @param {object[]} cambios renglones de necesidades_cambios (sku, cantidad, empleado_nombre, created_at, motivo)
 * @returns {Map<string, { mrp: number|null, cantidad: number, cambio: object|null, nombre: string|null }>}
 */
export function necesidadVigente(necesidades = [], cambios = []) {
  const out = new Map();
  for (const n of necesidades || []) {
    const sku = String(n?.sku ?? "");
    if (!sku) continue;
    const prev = out.get(sku);
    const q = num(n.cantidad) || 0;
    out.set(sku, { mrp: r3((prev?.mrp || 0) + q), cantidad: r3((prev?.mrp || 0) + q), cambio: null, nombre: prev?.nombre || n.nombre || null });
  }
  const ordenados = [...(cambios || [])].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || (Number(a.id) || 0) - (Number(b.id) || 0));
  for (const c of ordenados) {
    const sku = String(c?.sku ?? "");
    const q = num(c?.cantidad);
    if (!sku || q == null) continue;
    const prev = out.get(sku) || { mrp: null, nombre: c.nombre || null };
    out.set(sku, { ...prev, cantidad: r3(q), cambio: c });
  }
  return out;
}

/** Lo ya retirado de cada artículo para la OT (retiros menos devoluciones). */
export function retiradoPorSku(movimientos = []) {
  const out = new Map();
  for (const m of movimientos || []) {
    if (m?.anulado || (m.tipo !== "consumo" && m.tipo !== "devolucion")) continue;
    const q = (m.tipo === "devolucion" ? -1 : 1) * (num(m.cantidad) || 0);
    out.set(String(m.sku), r3((out.get(String(m.sku)) || 0) + q));
  }
  return out;
}

/**
 * Renglones para la pantalla: un herraje o accesorio por renglón, con la
 * necesidad (editable), lo ya retirado y la cantidad a consumir, que arranca
 * en lo que falta. Los que ya están completos vienen sin marcar.
 * @returns {object[]} { sku, nombre, unidad, mrp, necesidadAntes, necesidad, retirado, cantidad, incluir, cambio, extra }
 */
export function renglonesConsumoOt({ necesidades = [], cambios = [], movimientos = [], articulos = [] } = {}) {
  const porSku = new Map((articulos || []).map((a) => [String(a.sku), a]));
  const vigente = necesidadVigente(necesidades, cambios);
  const retirado = retiradoPorSku(movimientos);
  const filas = [];
  for (const [sku, v] of vigente) {
    const art = porSku.get(sku) || { sku, nombre: v.nombre };
    if (!esHerrajeOAccesorio({ ...art, nombre: art.nombre || v.nombre })) continue;
    const ret = retirado.get(sku) || 0;
    const falta = Math.max(0, r3(v.cantidad - ret));
    filas.push({
      sku,
      nombre: art.nombre || v.nombre || sku,
      unidad: art.unidad || null,
      disponible: art.disponible ?? art.stock ?? null,
      mrp: v.mrp,
      necesidadAntes: v.cantidad,
      necesidad: numeroCampo(v.cantidad),
      retirado: ret,
      cantidad: falta > 0 ? numeroCampo(falta) : "",
      cantidadTocada: false,
      incluir: falta > 0,
      cambio: v.cambio,
      extra: false,
    });
  }
  return filas.sort((a, b) => (b.incluir - a.incluir) || String(a.nombre).localeCompare(String(b.nombre), "es"));
}

/** Renglón para un artículo que no estaba en la lista (algo no previsto). */
export function renglonExtra(articulo) {
  return {
    sku: String(articulo.sku), nombre: articulo.nombre || articulo.sku, unidad: articulo.unidad || null,
    disponible: articulo.disponible ?? articulo.stock ?? null,
    mrp: null, necesidadAntes: null, necesidad: "", retirado: 0, cantidad: "", cantidadTocada: false,
    incluir: true, cambio: null, extra: true,
  };
}

/**
 * Cambia la necesidad de un renglón. Si la cantidad a consumir no la tocó
 * nadie, pasa a ser lo que falta con la necesidad nueva.
 */
export function cambiarNecesidad(fila, texto) {
  const nueva = { ...fila, necesidad: texto };
  if (fila.cantidadTocada) return nueva;
  const n = texto.trim() === "" ? null : leerNecesidad(texto);
  if (n == null) return nueva;
  const falta = Math.max(0, r3(n - fila.retirado));
  return { ...nueva, cantidad: falta > 0 ? numeroCampo(falta) : "", incluir: falta > 0 };
}

/** Si la necesidad del renglón quedó distinta de la que valía. */
export function necesidadCambiada(fila) {
  if (String(fila.necesidad ?? "").trim() === "") return false;
  const n = leerNecesidad(fila.necesidad);
  return n != null && n !== (fila.necesidadAntes ?? null);
}

/**
 * Lo que se manda a guardar: los consumos (renglones marcados con cantidad) y
 * los cambios de necesidad (de cualquier renglón, marcado o no).
 * @returns {{ renglones: { sku, cantidad }[], necesidades: { sku, cantidad }[], error?: string }}
 */
export function consumoOtParaGuardar(filas = []) {
  const renglones = [];
  const necesidades = [];
  for (const f of filas) {
    const nec = String(f.necesidad ?? "").trim();
    if (nec !== "") {
      const n = leerNecesidad(nec);
      if (n == null) return { renglones: [], necesidades: [], error: `Revisá la necesidad de ${f.nombre}` };
      if (n !== (f.necesidadAntes ?? null)) necesidades.push({ sku: f.sku, cantidad: n });
    }
    if (!f.incluir) continue;
    const c = leerCantidadMovimiento(f.cantidad);
    if (!c) return { renglones: [], necesidades: [], error: `Poné la cantidad de ${f.nombre} (o desmarcalo)` };
    renglones.push({ sku: f.sku, cantidad: c });
  }
  if (!renglones.length && !necesidades.length) return { renglones, necesidades, error: "Marcá al menos un artículo para consumir" };
  return { renglones, necesidades };
}
