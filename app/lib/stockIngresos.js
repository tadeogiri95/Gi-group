// app/lib/stockIngresos.js — Ingresos al stock que vienen de una factura y el
// aviso de ingreso repetido (parte 6 del plan Finanzas e Inventario, 11/11).
//
// Una factura que no pasó por una orden de compra (Compras → Facturas sin
// OC) puede mandar sus materiales al stock: un ingreso por cada renglón
// asociado a un artículo del MRP, con el proveedor, el número y el precio en
// pesos sin IVA. Quedan marcados con "Factura sin OC N° <id>" (en notas) para
// saber que ya entraron y anularlos si se anula la factura.
//
// Antes de cargar un ingreso se mira si ya entró el mismo comprobante del
// mismo proveedor (una recepción de OC, otro ingreso a mano u otra factura):
// se avisa, y solo se carga igual si la persona lo confirma.
import { precioArs } from "./facturasSueltas";
import { claveComprobante, mismoNombre } from "./finanzasComprobantes";
import { mismoNumero } from "./facturaUnica";

/** La marca en notas de los ingresos de una factura sin OC. */
export const marcaFacturaSuelta = (id) => `Factura sin OC N° ${Number(id)}`;

const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "");

/** "Ya entró al stock el comprobante 0001-123 de ALUAR (OC N° 12, el 10/11/26)." */
export function avisoIngresoRepetido(m) {
  const de = m.notas ? String(m.notas) : "cargado a mano";
  return `Ya entró al stock el comprobante ${m.comprobante} de ${m.proveedor} (${de}${m.created_at ? `, el ${fechaCorta(m.created_at)}` : ""}).`;
}

/** Lo que se busca en la base: el número sin ceros ni letras ("0003-00012" → "12"), o el texto si no tiene números. */
const buscable = (c) => {
  const k = claveComprobante(c);
  return encodeURIComponent(k ? String(k.numero) : String(c).trim().replace(/[%_*,()]/g, ""));
};

/** ¿Es el mismo comprobante? Escrito distinto ("0003-00012" = "3-12") o igual letra por letra. */
const mismoComp = (a, b) => mismoNumero(a, b) || String(a).trim().toUpperCase() === String(b || "").trim().toUpperCase();

/**
 * El ingreso que ya entró con ese comprobante de ese proveedor, o null.
 * Mira los ingresos de stock y, desde el 12/11 (auditoría, parte 2), los
 * remitos de las recepciones de OC: la recepción guarda en el ingreso el N° de
 * factura si ya estaba, y el remito quedaba sin ver. El número y el nombre
 * pueden estar escritos distinto ("0003-00012" = "3-12"; "MADERAS CÓRDOBA
 * S.A." = "MADERAS CORDOBA SA").
 * @param {(path: string, opts?: object) => Promise<object[]>} sbGet
 * @param {{ proveedor, comprobante, excluirNotas? }} buscado excluirNotas: no contar los ingresos con esas notas (la misma OC)
 */
export async function buscarIngresoRepetido(sbGet, empresaId, { proveedor, comprobante, excluirNotas = null }, opts = {}) {
  const c = String(comprobante || "").trim();
  const p = String(proveedor || "").trim();
  if (!c || !p) return null;
  const q = buscable(c);
  if (!q) return null;
  const o = { ...opts, silent: true, fallback: [] };
  const [movs, recepciones] = await Promise.all([
    sbGet(`movimientos_stock?empresa_id=eq.${empresaId}&tipo=eq.ingreso&anulado=eq.false&comprobante=ilike.*${q}*&select=id,proveedor,comprobante,notas,created_at&order=id.desc&limit=100`, o),
    sbGet(`recepciones_compra?empresa_id=eq.${empresaId}&anulada=eq.false&remito=ilike.*${q}*&select=id,remito,created_at,ordenes_compra(numero,proveedor_nombre)&order=id.desc&limit=100`, o),
  ]);
  const mov = (movs || []).find((m) => m.notas !== excluirNotas && mismoComp(c, m.comprobante) && mismoNombre(p, m.proveedor));
  if (mov) return mov;
  const rec = (recepciones || []).find((r) => r.ordenes_compra && `OC N° ${r.ordenes_compra.numero}` !== excluirNotas
    && mismoComp(c, r.remito) && mismoNombre(p, r.ordenes_compra.proveedor_nombre));
  return rec ? { id: null, proveedor: rec.ordenes_compra.proveedor_nombre, comprobante: rec.remito, notas: `remito de la OC N° ${rec.ordenes_compra.numero}`, created_at: rec.created_at } : null;
}

/**
 * Los ingresos de una factura sin OC: uno por renglón con artículo.
 * @returns {{ filas: object[], sinArticulo: number }}
 */
export function ingresosDeFactura(factura, renglones = [], articulos = [], quien = {}) {
  const porSku = new Map(articulos.map((a) => [a.sku, a]));
  const conSku = renglones.filter((r) => r.sku && Number(r.cantidad) > 0);
  const filas = conSku.map((r) => {
    const a = porSku.get(r.sku) || {};
    return {
      empresa_id: factura.empresa_id,
      tipo: "ingreso",
      sku: r.sku,
      nombre: (a.nombre || r.descripcion || "").slice(0, 200) || null,
      unidad: a.unidad ?? null,
      division: a.division ?? null,
      cantidad: Number(r.cantidad),
      ot: null,
      proveedor: String(factura.proveedor).slice(0, 120),
      comprobante: factura.numero ? String(factura.numero).slice(0, 60) : null,
      precio_unitario: precioArs(r.precio, factura.moneda, factura.tipo_cambio),
      notas: marcaFacturaSuelta(factura.id),
      empleado_id: quien.empleado_id || null,
      legajo: Number.isInteger(quien.legajo) ? quien.legajo : null,
      empleado_nombre: quien.empleado_nombre || null,
    };
  });
  const sinArticulo = renglones.filter((r) => !r.sku && r.asociado_como !== "descartado").length;
  return { filas, sinArticulo };
}
