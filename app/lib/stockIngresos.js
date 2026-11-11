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

/** La marca en notas de los ingresos de una factura sin OC. */
export const marcaFacturaSuelta = (id) => `Factura sin OC N° ${Number(id)}`;

const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "");

/** "Ya entró al stock el comprobante 0001-123 de ALUAR (OC N° 12, el 10/11/26)." */
export function avisoIngresoRepetido(m) {
  const de = m.notas ? String(m.notas) : "cargado a mano";
  return `Ya entró al stock el comprobante ${m.comprobante} de ${m.proveedor} (${de}${m.created_at ? `, el ${fechaCorta(m.created_at)}` : ""}).`;
}

/** Filtro de PostgREST para un texto exacto sin importar mayúsculas (sin comodines). */
const exacto = (s) => encodeURIComponent(String(s).trim().replace(/[%_*,()]/g, ""));

/**
 * El ingreso que ya entró con ese comprobante de ese proveedor, o null.
 * @param {(path: string, opts?: object) => Promise<object[]>} sbGet
 */
export async function buscarIngresoRepetido(sbGet, empresaId, { proveedor, comprobante }, opts = {}) {
  const c = String(comprobante || "").trim();
  const p = String(proveedor || "").trim();
  if (!c || !p) return null;
  const filas = await sbGet(
    `movimientos_stock?empresa_id=eq.${empresaId}&tipo=eq.ingreso&anulado=eq.false&comprobante=ilike.${exacto(c)}&proveedor=ilike.${exacto(p)}&select=id,proveedor,comprobante,notas,created_at&order=id.desc&limit=1`,
    { ...opts, silent: true, fallback: [] },
  );
  return filas?.[0] || null;
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
