// app/lib/facturasSueltas.js — Facturas que no pasaron por una orden de
// compra (costo de OT, parte D; migración 168; diseño en
// notes/diseno-costo-ot.md). Se cargan a mano o leyendo un PDF o una foto con
// la IA; cada renglón se reconoce con un artículo del MRP y su precio entra a
// la lista de precios (precios_articulos, origen 'factura'). No mueven stock.
//
// Reconocer el artículo de un renglón, en este orden:
//   1. lo que se eligió a mano antes para ese mismo texto de ese proveedor;
//   2. el código del renglón: si es el SKU del MRP, o el código del proveedor
//      que ya se asoció antes;
//   3. la descripción igual al nombre (normalizado) de un único artículo.
// Lo que no se reconoce queda "Sin asociar".
//
// Desde la 169 también se cargan listas de precios de proveedores (tipo
// 'lista', desde un PDF con la IA o un Excel/CSV con app/lib/listasPrecios.js):
// mismo reconocimiento, cantidad 1, y los renglones que no son del MRP se
// marcan "No es del MRP" (asociado_como 'descartado') para que salgan de Sin
// asociar.

export const MAX_RENGLONES = 200;
export const MAX_RENGLONES_LISTA = 5000;
export const TIPOS_DOCUMENTO = { factura: "🧾 Factura", lista: "📋 Lista de precios" };
export const MAX_ARCHIVO_B64 = 4_000_000; // ~3 MB de archivo: entra en el límite de Vercel
export const TIPOS_ARCHIVO = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export const COMO_ASOCIADO = {
  memoria: "🧠 Elegido antes para este proveedor",
  sku: "🏷 Por el código del MRP",
  codigo: "🏷 Por el código del proveedor",
  nombre: "🔤 Por el nombre",
  manual: "✋ Elegido a mano",
  descartado: "🚫 No es del MRP",
};

/** Texto para comparar: minúsculas, sin acentos ni signos, espacios simples. */
export function normalizarTexto(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 200);
}

export const claveProveedor = (p) => normalizarTexto(p).slice(0, 120);

/**
 * Artículo de un renglón.
 * @param {{ descripcion: string, codigo?: string|null }} renglon
 * @param {{ asociaciones?: object[], articulos?: object[] }} datos
 *   asociaciones: asociaciones_articulos del proveedor (tipo, clave, sku)
 *   articulos: articulos_stock (sku, nombre)
 * @returns {{ sku: string, como: string } | null}
 */
export function reconocerRenglon(renglon, { asociaciones = [], articulos = [] } = {}) {
  const texto = normalizarTexto(renglon?.descripcion);
  const codigo = normalizarTexto(renglon?.codigo);
  const ia = indiceArticulos(articulos);
  const mem = indiceMemoria(asociaciones);
  const memoria = (tipo, clave) => {
    const sku = mem.get(`${tipo}|${clave}`);
    return sku && ia.existe.has(sku) ? sku : null;
  };
  const m = texto && memoria("texto", texto);
  if (m) return { sku: m, como: "memoria" };
  if (renglon?.codigo) {
    const porSku = ia.porSku.get(String(renglon.codigo).trim().toLowerCase());
    if (porSku) return { sku: porSku, como: "sku" };
    const mc = codigo && memoria("codigo", codigo);
    if (mc) return { sku: mc, como: "codigo" };
  }
  if (texto) {
    const iguales = ia.porNombre.get(texto);
    if (iguales?.length === 1) return { sku: iguales[0], como: "nombre" };
  }
  return null;
}

// Índices por lista (una lista de precios puede traer miles de renglones):
// se arman una vez por cada arreglo de artículos o de asociaciones.
const cacheArticulos = new WeakMap();
const cacheMemoria = new WeakMap();
function indiceArticulos(articulos) {
  let ix = cacheArticulos.get(articulos);
  if (!ix) {
    ix = { existe: new Set(), porSku: new Map(), porNombre: new Map() };
    for (const a of articulos) {
      ix.existe.add(a.sku);
      const k = String(a.sku).trim().toLowerCase();
      if (!ix.porSku.has(k)) ix.porSku.set(k, a.sku);
      const n = normalizarTexto(a.nombre);
      if (n) ix.porNombre.set(n, [...(ix.porNombre.get(n) || []), a.sku]);
    }
    cacheArticulos.set(articulos, ix);
  }
  return ix;
}
function indiceMemoria(asociaciones) {
  let ix = cacheMemoria.get(asociaciones);
  if (!ix) {
    ix = new Map();
    for (const a of asociaciones) {
      const k = `${a.tipo}|${a.clave}`;
      if (!ix.has(k)) ix.set(k, a.sku);
    }
    cacheMemoria.set(asociaciones, ix);
  }
  return ix;
}

/** Lo que se guarda en asociaciones_articulos al elegir un artículo a mano. */
export function filasAsociacion(empresaId, proveedor, renglon, sku, nombre = null) {
  const prov = claveProveedor(proveedor);
  if (!prov || !sku) return [];
  const base = { empresa_id: empresaId, proveedor_clave: prov, sku, creado_por_nombre: nombre ? String(nombre).slice(0, 120) : null, updated_at: new Date().toISOString() };
  const filas = [];
  const texto = normalizarTexto(renglon?.descripcion);
  if (texto) filas.push({ ...base, tipo: "texto", clave: texto });
  const codigo = normalizarTexto(renglon?.codigo);
  if (codigo) filas.push({ ...base, tipo: "codigo", clave: codigo });
  return filas;
}

const r4 = (n) => Math.round(n * 10000) / 10000;

/** Precio en pesos (en dólares, por el tipo de cambio de la factura). */
export function precioArs(precio, moneda, tipoCambio) {
  const p = Number(precio);
  if (!Number.isFinite(p)) return null;
  if (moneda !== "USD") return r4(p);
  const tc = Number(tipoCambio);
  return tc > 0 ? r4(p * tc) : null;
}

/** El renglón asociado como precio de la lista (precios_articulos). */
export function filaPrecioFactura(empresaId, factura, renglon) {
  return {
    empresa_id: empresaId,
    sku: renglon.sku,
    fecha: factura.fecha,
    precio: Number(renglon.precio),
    moneda: factura.moneda === "USD" ? "USD" : "ARS",
    tipo_cambio: factura.moneda === "USD" ? Number(factura.tipo_cambio) : null,
    precio_ars: precioArs(renglon.precio, factura.moneda, factura.tipo_cambio),
    origen: "factura",
    referencia: `FS-${renglon.id}`,
    proveedor: factura.proveedor ? String(factura.proveedor).slice(0, 120) : null,
    comprobante: factura.numero ? String(factura.numero).slice(0, 60) : null,
    cantidad: Number(renglon.cantidad),
    nombre: renglon.descripcion ? String(renglon.descripcion).slice(0, 200) : null,
    sincronizado_at: new Date().toISOString(),
  };
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v, max) => {
  const t = String(v ?? "").trim();
  return t ? t.slice(0, max) : null;
};
const numero = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v ?? "").trim().replace(/\s/g, "");
  if (!t) return null;
  // "1.234,56" → 1234.56; "1234.56" → 1234.56
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Revisa una factura para guardar.
 * @returns {{ error: string } | { factura: object, renglones: object[] }}
 */
export function validarFactura(d) {
  const tipo = d?.tipo === "lista" ? "lista" : "factura";
  const esLista = tipo === "lista";
  const proveedor = texto(d?.proveedor, 120);
  if (!proveedor) return { error: "Falta el proveedor" };
  const fecha = String(d?.fecha ?? "");
  if (!FECHA.test(fecha) || Number.isNaN(new Date(`${fecha}T12:00:00Z`).getTime())) return { error: esLista ? "Falta la fecha de la lista" : "Falta la fecha de la factura" };
  const moneda = d?.moneda === "USD" ? "USD" : "ARS";
  const tc = numero(d?.tipo_cambio);
  if (moneda === "USD" && !(tc > 0)) return { error: "En dólares hace falta el tipo de cambio" };
  const lista = Array.isArray(d?.renglones) ? d.renglones : [];
  const max = esLista ? MAX_RENGLONES_LISTA : MAX_RENGLONES;
  if (!lista.length) return { error: esLista ? "La lista no tiene renglones" : "La factura no tiene renglones" };
  if (lista.length > max) return { error: esLista ? `Hasta ${max} renglones por lista: partila en dos` : `Hasta ${max} renglones por factura` };
  const renglones = [];
  for (const [i, r] of lista.entries()) {
    const descripcion = texto(r?.descripcion, 200);
    const cantidad = esLista && (r?.cantidad === "" || r?.cantidad == null) ? 1 : numero(r?.cantidad);
    const precio = numero(r?.precio);
    if (!descripcion) return { error: `Renglón ${i + 1}: falta la descripción` };
    if (!(cantidad > 0)) return { error: `Renglón ${i + 1}: la cantidad tiene que ser mayor que 0` };
    if (precio === null || precio < 0 || precio >= 1e10) return { error: `Renglón ${i + 1}: falta el precio unitario sin IVA` };
    renglones.push({
      orden: i,
      descripcion,
      codigo: texto(r?.codigo, 60),
      cantidad: Math.round(cantidad * 1000) / 1000,
      precio: r4(precio),
      sku: texto(r?.sku, 60),
      manual: Boolean(r?.manual),
    });
  }
  return {
    factura: {
      tipo,
      proveedor,
      numero: texto(d?.numero, 60),
      fecha,
      moneda,
      tipo_cambio: moneda === "USD" ? tc : null,
      observacion: texto(d?.observacion, 500),
      carga: ["ia", "planilla"].includes(d?.carga) ? d.carga : "manual",
    },
    renglones,
  };
}

/** Neto (sin IVA) de una factura, en su moneda. */
export function netoFactura(renglones = []) {
  return Math.round(renglones.reduce((s, r) => s + (Number(r.cantidad) || 0) * (Number(r.precio) || 0), 0) * 100) / 100;
}

/* ─── Lectura con IA ──────────────────────────────────────────────────────── */

export const PROMPT_FACTURA = `Leés facturas y listas de precios de proveedores de una fábrica de muebles en Argentina y devolvés sus datos.
- tipo_documento: "factura" si es una factura o comprobante de compra; "lista" si es una lista de precios, catálogo con precios o presupuesto del proveedor.
- proveedor: razón social de quien emite la factura o la lista (no la del cliente que compra).
- numero: punto de venta y número tal como figura (por ejemplo 0003-00012345). Vacío si no se ve.
- fecha: fecha de emisión (o de vigencia de la lista) en formato AAAA-MM-DD. Vacío si no se ve.
- moneda: "USD" si los importes están en dólares, si no "ARS".
- tipo_cambio: el tipo de cambio si la factura lo dice; 0 si no.
- precios_con_iva: true si los precios unitarios incluyen IVA (factura B o C, o lista "con IVA" o "precio final"), false si son sin IVA (factura A, o lista "más IVA" o "neto").
- renglones: uno por cada ítem facturado o cada artículo de la lista, en orden. En una lista, cantidad = 1 y precio_unitario = el precio de la lista (si hay varias columnas de precio, el sin IVA o neto). descripcion tal cual figura; codigo del artículo del proveedor si figura (vacío si no); cantidad; precio_unitario sin bonificaciones aplicadas aparte (si hay descuento por renglón, el precio unitario ya descontado). No incluyas renglones de subtotal, IVA, percepciones ni otros impuestos.
Usá punto como separador decimal en los números. Si algo no se puede leer, dejalo vacío o en 0; no inventes datos.`;

export const ESQUEMA_FACTURA = {
  type: "object",
  additionalProperties: false,
  required: ["tipo_documento", "proveedor", "numero", "fecha", "moneda", "tipo_cambio", "precios_con_iva", "renglones"],
  properties: {
    tipo_documento: { type: "string", enum: ["factura", "lista"] },
    proveedor: { type: "string" },
    numero: { type: "string" },
    fecha: { type: "string" },
    moneda: { type: "string", enum: ["ARS", "USD"] },
    tipo_cambio: { type: "number" },
    precios_con_iva: { type: "boolean" },
    renglones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["descripcion", "codigo", "cantidad", "precio_unitario"],
        properties: {
          descripcion: { type: "string" },
          codigo: { type: "string" },
          cantidad: { type: "number" },
          precio_unitario: { type: "number" },
        },
      },
    },
  },
};

/** Lo que devolvió la IA, como borrador de factura (siempre se revisa antes de guardar). */
export function borradorDeLectura(l) {
  const tipo = l?.tipo_documento === "lista" ? "lista" : "factura";
  const fecha = FECHA.test(String(l?.fecha ?? "")) ? l.fecha : "";
  const renglones = (Array.isArray(l?.renglones) ? l.renglones : []).slice(0, tipo === "lista" ? MAX_RENGLONES_LISTA : MAX_RENGLONES)
    .map((r) => ({
      descripcion: texto(r?.descripcion, 200) || "",
      codigo: texto(r?.codigo, 60) || "",
      cantidad: tipo === "lista" ? 1 : numero(r?.cantidad) ?? "",
      precio: numero(r?.precio_unitario) ?? "",
    }))
    .filter((r) => r.descripcion);
  return {
    tipo,
    proveedor: texto(l?.proveedor, 120) || "",
    numero: texto(l?.numero, 60) || "",
    fecha,
    moneda: l?.moneda === "USD" ? "USD" : "ARS",
    tipo_cambio: Number(l?.tipo_cambio) > 0 ? Number(l.tipo_cambio) : "",
    precios_con_iva: Boolean(l?.precios_con_iva),
    renglones,
  };
}
