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
//
// 12/11 (pedido de Tadeo): cada renglón tiene que quedar con un artículo del
// MRP. Si no se reconoce igual, se busca el más parecido por palabras y
// medidas (parecidosArticulo): si uno gana claro se pone solo, marcado
// "parecido" para revisar; si no, se ofrecen los tres más parecidos. El
// remito también se carga a mano, eligiendo los artículos del MRP.
import { clavePersona } from "./finanzasPersonas";
import { normalizarTexto, reconocerRenglon } from "./facturasSueltas";

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

/* ─── El artículo más parecido ───────────────────────────────────────── */

const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "con", "para", "en", "x", "por", "un", "una", "c", "p", "s", "u", "uni", "unid", "unidad", "unidades", "cm", "mm", "mts", "mt", "m", "kg", "gr", "grs", "lt", "lts", "l"]);

/**
 * Las palabras que cuentan de un texto: sin acentos ni palabras vacías, las
 * medidas pegadas a su unidad separadas ("18mm" → "18"), "22x0,45" → "22" y
 * "0.45", y los centímetros también en milímetros ("45 cm" → "45" y "450").
 */
export function palabrasArticulo(textoLibre) {
  let t = String(textoLibre ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  t = t.replace(/(\d),(\d)/g, "$1.$2").replace(/(\d)\s*x\s*(?=\d)/g, "$1 ");
  t = t.replace(/(\d+(?:\.\d+)?)\s*cm\b/g, (_, n) => `${n} ${Math.round(Number(n) * 10 * 100) / 100}`);
  const out = [];
  for (let w of t.split(/[^a-z0-9.]+/)) {
    w = w.replace(/^\.+|\.+$/g, "");
    const u = w.match(/^(\d+(?:\.\d+)?)[a-z]+$/);
    if (u) w = u[1];
    if (w.includes(".") && !/^\d+\.\d+$/.test(w)) { out.push(...w.split(".").filter((x) => x && !VACIAS.has(x))); continue; }
    if (w && !VACIAS.has(w)) out.push(w);
  }
  return [...new Set(out)];
}

const esNumero = (w) => /^\d/.test(w);
/** ¿Una letra tras otra, en orden, empezando igual? ("bca" en "blanca") */
const abrevia = (w, a) => {
  if (w[0] !== a[0]) return false;
  let k = 0;
  for (const ch of a) if (ch === w[k]) k += 1;
  return k === w.length;
};
/** ¿La palabra del remito está en el artículo? 1 igual; 0,7 si empieza igual; 0,5 si es una abreviatura. */
function coincide(w, delArticulo) {
  if (delArticulo.has(w)) return 1;
  if (esNumero(w) || w.length < 3) return 0;
  let mejor = 0;
  for (const a of delArticulo) {
    if (esNumero(a) || a.length < 3) continue;
    if (w.length >= 4 && (a.startsWith(w) || w.startsWith(a) || (w.length >= 5 && a.length >= 5 && w.slice(0, 5) === a.slice(0, 5)))) return 0.7;
    if (w.length < a.length && abrevia(w, a)) mejor = 0.5;
  }
  return mejor;
}

const cacheParecidos = new WeakMap();
function indiceParecidos(articulos) {
  let ix = cacheParecidos.get(articulos);
  if (!ix) {
    ix = articulos.filter((a) => a && a.sku && a.activo !== false).map((a) => ({ a, p: new Set(palabrasArticulo(a.nombre)) }));
    cacheParecidos.set(articulos, ix);
  }
  return ix;
}

/**
 * Los artículos del MRP más parecidos a lo que dice el renglón, con un puntaje
 * de 0 a 1: cuenta lo que coincide de los dos lados, y una medida (18, 450…)
 * que está en uno y no en el otro resta, para no confundir 18 mm con 15 mm.
 * @returns {{ sku: string, nombre: string, puntaje: number }[]}
 */
export function parecidosArticulo(descripcion, articulos = [], max = 3) {
  const del = palabrasArticulo(descripcion);
  if (!del.length) return [];
  const out = [];
  for (const { a, p } of indiceParecidos(articulos)) {
    if (!p.size) continue;
    // Las medidas pesan más; una del remito que no está en el artículo pesa
    // poco (el remito suele traer el largo, el espesor y más), pero una medida
    // del artículo que no está en el remito resta: 18 mm no es 15 mm.
    let suma = 0;
    let pesoRemito = 0;
    for (const w of del) {
      const c = coincide(w, p);
      if (esNumero(w)) { suma += c * 1.5; pesoRemito += c ? 1.5 : 0.5; } else { suma += c; pesoRemito += 1; }
    }
    if (!suma) continue;
    let pesoArticulo = 0;
    let numerosMal = 0;
    for (const w of p) {
      if (!esNumero(w)) pesoArticulo += 1;
      else if (del.includes(w)) pesoArticulo += 1.5;
      else { pesoArticulo += 1.5; numerosMal += 1; }
    }
    const puntaje = (2 * suma) / (pesoRemito + pesoArticulo) - 0.15 * numerosMal;
    if (puntaje > 0.2) out.push({ sku: a.sku, nombre: a.nombre || a.sku, puntaje: Math.round(Math.min(1, puntaje) * 100) / 100 });
  }
  return out.sort((x, y) => y.puntaje - x.puntaje || String(x.nombre).localeCompare(String(y.nombre), "es")).slice(0, max);
}

/** Con cuánto gana el más parecido para ponerlo solo. */
export const PARECIDO_SEGURO = 0.6;
export const PARECIDO_VENTAJA = 0.15;

/**
 * El artículo de un renglón: el reconocido (memoria, código o nombre igual) o,
 * si uno gana claro, el más parecido. Con las opciones para elegir.
 */
export function articuloDeRenglon(renglon, { articulos = [], asociaciones = [] } = {}) {
  const rec = renglon.descripcion || renglon.codigo ? reconocerRenglon(renglon, { articulos, asociaciones }) : null;
  if (rec) return { sku: rec.sku, como: rec.como, opciones: [] };
  const opciones = parecidosArticulo(renglon.descripcion, articulos);
  const [primero, segundo] = opciones;
  if (primero && primero.puntaje >= PARECIDO_SEGURO && primero.puntaje - (segundo?.puntaje || 0) >= PARECIDO_VENTAJA) {
    return { sku: primero.sku, como: "parecido", opciones };
  }
  return { sku: null, como: null, opciones };
}

/** Cómo se eligió el artículo, en palabras (para la pantalla). */
export const COMO_ARTICULO = {
  memoria: "elegido antes para este proveedor",
  sku: "por el código",
  codigo: "por el código del proveedor",
  nombre: "mismo nombre",
  parecido: "el más parecido: revisalo",
  mano: "elegido a mano",
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
      const rec = articuloDeRenglon(base, { articulos, asociaciones });
      return { ...base, sku: rec.sku, como: rec.como, opciones: rec.opciones };
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
    ...(r?.sku && COMO_ARTICULO[r?.como] ? { como: r.como } : {}),
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
      ...(remito.proveedor_id ? { proveedor_id: Number(remito.proveedor_id) } : {}),
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
