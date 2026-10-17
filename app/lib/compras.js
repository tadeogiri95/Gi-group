// app/lib/compras.js — Compras (ítem 41; diseño en notes/diseno-compras.md).
//
// Parte 20 (migración 113): proveedores y pedidos de material. Piden los
// jefes de taller (supervisores de división), gerencia, dueños y
// Administración; los operarios no. Administración consolida los pedidos y
// compra (parte 21): "comprador" es gerencia o Administración sin división
// asignada (un supervisor de división pide y recibe, pero no compra).

export const ESTADOS_PEDIDO = {
  pendiente: { id: "pendiente", nombre: "Pendiente", icono: "🕓" },
  en_oc:     { id: "en_oc",     nombre: "En orden de compra", icono: "📄" },
  recibido:  { id: "recibido",  nombre: "Recibido", icono: "✅" },
  anulado:   { id: "anulado",   nombre: "Anulado", icono: "✖️" },
};

/** ¿Puede pedir material? Todos menos los operarios. */
/**
 * Si el error de leer `tabla` es porque la tabla no existe (falta su migración).
 * Otros errores con el nombre de la tabla (permisos, red) no cuentan.
 */
export function faltaTabla(err, tabla) {
  const m = String(err?.message ?? "");
  return m.includes(tabla) && /no existe|does not exist|42P01|PGRST20[05]|schema cache/.test(m);
}

export function puedePedir(rol) {
  return rol === "gerencial" || rol === "administrativo";
}

/** ¿Puede comprar (proveedores, consolidar pedidos)? alcance = el de app/lib/alcance.js (null = ve toda la empresa). */
export function puedeComprar(rol, alcance = null) {
  if (rol === "gerencial") return true;
  return rol === "administrativo" && !alcance;
}

/** ¿Puede anular este pedido? El comprador, cualquiera pendiente; quien lo pidió, el suyo mientras siga pendiente. */
export function puedeAnularPedido(pedido, { comprador = false, empleadoId = null } = {}) {
  if (!pedido || pedido.estado !== "pendiente") return false;
  if (comprador) return true;
  return Boolean(empleadoId) && pedido.empleado_id === empleadoId;
}

/**
 * Lista de proveedores pegada (una columna de la planilla, p. ej. TABLAS →
 * PROVEEDORES): un nombre por renglón, sin el título, sin vacíos ni
 * repetidos (sin importar mayúsculas). Devuelve los nombres limpios.
 */
export function leerListaProveedores(texto, max = 500) {
  const vistos = new Set();
  const out = [];
  for (const linea of String(texto ?? "").split(/\r?\n/)) {
    const nombre = linea.split("\t")[0].replace(/\s+/g, " ").trim().slice(0, 120);
    if (!nombre || /^proveedor(es)?$/i.test(nombre)) continue;
    const clave = nombre.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(nombre);
    if (out.length >= max) break;
  }
  return out;
}

/** "11-22333444-5", "20 22333444 5" → "20-22333444-5"; otra cosa → el texto limpio. */
export function formatoCuit(texto) {
  const t = String(texto ?? "").trim();
  const d = t.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
  return t;
}

/** WhatsApp como lo entiende wa.me: solo dígitos; un celular argentino sin 54 se completa. */
export function numeroWhatsapp(texto) {
  let d = String(texto ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (!d.startsWith("54") && d.length === 10) d = `549${d}`;
  return d.length >= 8 ? d : null;
}

/** "Placa melamina blanca · 4 placas · OT M-7495" para las listas. */
export function textoPedido(p) {
  const cant = Number(p?.cantidad);
  const cantidad = Number.isFinite(cant) ? cant.toLocaleString("es-AR", { maximumFractionDigits: 3 }) : "?";
  return [
    p?.descripcion || p?.sku || "",
    `${cantidad}${p?.unidad ? ` ${p.unidad}` : ""}`,
    p?.ot ? `OT ${p.ot}` : null,
  ].filter(Boolean).join(" · ");
}

/** Filtra pedidos por texto (descripción, SKU, OT, quién pidió) y estado. */
export function filtrarPedidos(pedidos, { texto = "", estado = "" } = {}) {
  const t = String(texto).trim().toLowerCase();
  return (pedidos || []).filter((p) => {
    if (estado && p.estado !== estado) return false;
    if (!t) return true;
    return [p.descripcion, p.sku, p.ot, p.empleado_nombre, p.division].some((v) => String(v ?? "").toLowerCase().includes(t));
  });
}
