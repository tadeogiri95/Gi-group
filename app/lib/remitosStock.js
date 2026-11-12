// app/lib/remitosStock.js — Ingreso al stock por foto del remito (parte 7 del
// plan Finanzas e Inventario, 11/11; migración 182).
//
// Quien recibe la mercadería le saca una foto al remito; la IA lee el
// proveedor, el número, la fecha y los renglones, y Gypi reconoce el artículo
// de cada renglón (lo elegido antes para ese proveedor, el código o el nombre,
// como en las facturas sin OC). Queda "para revisar": la oficina corrige lo
// que haga falta y lo confirma, y recién ahí entra al stock (un ingreso por
// renglón con artículo, marcado "Remito por foto N° <id>").
//
// Para no cargar dos veces lo mismo:
//   - si el proveedor tiene una orden de compra abierta con esos artículos, se
//     avisa que conviene recibir la OC (Compras → Recibir);
//   - si ese comprobante de ese proveedor ya entró, se avisa (stockIngresos).
import { clavePersona } from "./finanzasPersonas";
import { reconocerRenglon } from "./facturasSueltas";

export const MAX_RENGLONES_REMITO = 200;
export const ESTADOS_REMITO = { para_revisar: "🕓 Para revisar", confirmado: "✅ En el stock", descartado: "🗑 Descartado" };

/** La marca en notas de los ingresos de un remito por foto. */
export const marcaRemito = (id) => `Remito por foto N° ${Number(id)}`;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v, max) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : "";
};
const cantidad = (v) => {
  const t = String(v ?? "").trim();
  const n = typeof v === "number" ? v : Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) && n > 0 && n < 1e10 ? Math.round(n * 1000) / 1000 : null;
};

export const PROMPT_REMITO = `Leés remitos de proveedores (o tickets de compra de materiales) de una fábrica de muebles en Argentina y devolvés sus datos.
- proveedor: razón social de quien entrega la mercadería (no la del cliente que la recibe).
- numero: punto de venta y número del remito tal como figura (por ejemplo 0001-00004567). Vacío si no se ve.
- fecha: fecha del remito en formato AAAA-MM-DD. Vacío si no se ve.
- renglones: uno por cada artículo entregado, en orden. descripcion: el nombre o la descripción completa tal cual figura; codigo: el código del artículo del proveedor si figura (vacío si no); cantidad entregada (si hay columnas de pedido y entregado, la entregada).
No incluyas renglones de totales, observaciones ni bultos sin artículo. Usá punto como separador decimal. Si algo no se puede leer, dejalo vacío o en 0; no inventes datos.`;

export const ESQUEMA_REMITO = {
  type: "object",
  additionalProperties: false,
  required: ["proveedor", "numero", "fecha", "renglones"],
  properties: {
    proveedor: { type: "string" },
    numero: { type: "string" },
    fecha: { type: "string" },
    renglones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["descripcion", "codigo", "cantidad"],
        properties: { descripcion: { type: "string" }, codigo: { type: "string" }, cantidad: { type: "number" } },
      },
    },
  },
};

/**
 * Lo que leyó la IA, como borrador con el artículo reconocido de cada renglón.
 * @param {object} lectura
 * @param {{ articulos?: { sku, nombre }[], asociaciones?: object[] }} ctx
 */
export function borradorRemito(lectura, { articulos = [], asociaciones = [] } = {}) {
  const renglones = (Array.isArray(lectura?.renglones) ? lectura.renglones : []).slice(0, MAX_RENGLONES_REMITO)
    .map((r) => {
      const base = { descripcion: texto(r?.descripcion, 200), codigo: texto(r?.codigo, 60), cantidad: cantidad(r?.cantidad) ?? "" };
      const rec = base.descripcion ? reconocerRenglon(base, { articulos, asociaciones }) : null;
      return { ...base, sku: rec?.sku || null, como: rec?.como || null };
    })
    .filter((r) => r.descripcion);
  return {
    proveedor: texto(lectura?.proveedor, 120),
    numero: texto(lectura?.numero, 60),
    fecha: FECHA.test(String(lectura?.fecha ?? "")) ? lectura.fecha : "",
    renglones,
  };
}

/**
 * Lo que manda la pantalla, limpio, con los errores en palabras. Con
 * sinCantidades (ticket de Mi caja) un renglón sin cantidad no es error.
 * @returns {{ remito: object, errores: string[] }}
 */
export function validarRemito(d = {}, { skus = null, sinCantidades = false } = {}) {
  const errores = [];
  const lista = Array.isArray(d.renglones) ? d.renglones : [];
  if (lista.length > MAX_RENGLONES_REMITO) errores.push(`Hasta ${MAX_RENGLONES_REMITO} renglones por remito`);
  const renglones = lista.slice(0, MAX_RENGLONES_REMITO).map((r) => ({
    descripcion: texto(r?.descripcion, 200),
    codigo: texto(r?.codigo, 60) || null,
    cantidad: cantidad(r?.cantidad),
    sku: texto(r?.sku, 60) || null,
  })).filter((r) => r.descripcion || r.sku);
  if (!renglones.length) errores.push("El remito no tiene renglones");
  renglones.forEach((r, i) => {
    // Un ticket de Mi caja queda para revisar aunque la IA no haya leído alguna cantidad: la oficina la pone al confirmar
    if (!r.cantidad && !sinCantidades) errores.push(`Renglón ${i + 1}: poné la cantidad`);
    if (r.sku && skus && !skus.has(r.sku)) errores.push(`Renglón ${i + 1}: ese artículo no está en el stock`);
  });
  const fecha = FECHA.test(String(d.fecha ?? "")) ? d.fecha : null;
  return {
    errores,
    remito: {
      proveedor: texto(d.proveedor, 120) || null,
      numero: texto(d.numero, 60) || null,
      fecha,
      notas: texto(d.notas, 300) || null,
      renglones,
    },
  };
}

/** ¿Ya se puede confirmar? Todos los renglones con artículo (los que no son del stock se sacan). */
export function faltaParaConfirmar(remito) {
  const sinArticulo = (remito.renglones || []).filter((r) => !r.sku).length;
  if (!remito.proveedor) return "Falta el proveedor";
  if (sinArticulo) return `Elegí el artículo de ${sinArticulo === 1 ? "1 renglón" : `${sinArticulo} renglones`} (o sacalo si no va al stock)`;
  return null;
}

/** Los ingresos al stock de un remito confirmado: uno por renglón. */
export function ingresosDeRemito(remito, articulos = [], quien = {}) {
  const porSku = new Map(articulos.map((a) => [a.sku, a]));
  return (remito.renglones || []).filter((r) => r.sku && r.cantidad > 0).map((r) => {
    const a = porSku.get(r.sku) || {};
    return {
      empresa_id: remito.empresa_id,
      tipo: "ingreso",
      sku: r.sku,
      nombre: (a.nombre || r.descripcion || "").slice(0, 200) || null,
      unidad: a.unidad ?? null,
      division: a.division ?? null,
      cantidad: r.cantidad,
      ot: null,
      proveedor: remito.proveedor ? String(remito.proveedor).slice(0, 120) : null,
      comprobante: remito.numero ? String(remito.numero).slice(0, 60) : null,
      precio_unitario: null,
      notas: marcaRemito(remito.id),
      empleado_id: quien.empleado_id || null,
      legajo: Number.isInteger(quien.legajo) ? quien.legajo : null,
      empleado_nombre: quien.empleado_nombre || null,
    };
  });
}

/**
 * La orden de compra abierta del mismo proveedor que trae alguno de esos
 * artículos: conviene recibirla en Compras en vez de cargar el remito suelto.
 * @param {{ proveedor: string, renglones: { sku?: string }[] }} remito
 * @param {{ id, numero, proveedor_nombre }[]} ordenes  abiertas
 * @param {{ orden_id, sku }[]} items
 */
export function ordenParaRecibir(remito, ordenes = [], items = []) {
  const clave = clavePersona(remito.proveedor);
  if (!clave) return null;
  const skus = new Set((remito.renglones || []).map((r) => r.sku).filter(Boolean));
  const delProveedor = ordenes.filter((o) => clavePersona(o.proveedor_nombre) === clave);
  const conArticulos = delProveedor.map((o) => ({ o, n: items.filter((it) => Number(it.orden_id) === Number(o.id) && skus.has(it.sku)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const elegida = conArticulos[0]?.o || null;
  return elegida ? { id: elegida.id, numero: elegida.numero, proveedor: elegida.proveedor_nombre } : null;
}

/** "Este remito parece de la OC N° 40 de FAPLAC: …" */
export const avisoOrden = (oc) => `Este remito parece de la orden de compra N° ${oc.numero} de ${oc.proveedor}. Recibila en Compras → 📦 Recibir: así entra al stock unida a la orden y no se carga dos veces.`;
