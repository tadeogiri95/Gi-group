// app/lib/ordenesCompra.js — Órdenes de compra (Compras, parte 21; ítem 41;
// migración 114; diseño en notes/diseno-compras.md).
//
// Administración junta en "A comprar" los pedidos pendientes de los jefes de
// taller y lo que la planilla MRP marca para comprar (semáforo rojo o
// amarillo con cantidad sugerida). Elige el proveedor de cada renglón y Gypi
// arma una OC por proveedor, con el último precio sin IVA y la cantidad
// redondeada al múltiplo. La OC se manda en PDF (imprimir → Guardar como
// PDF) y por WhatsApp o email con el texto armado.
import { nivelSemaforo } from "./stock";

export const ESTADOS_OC = {
  borrador:         { id: "borrador",         nombre: "Borrador",          icono: "📝" },
  enviada:          { id: "enviada",          nombre: "Enviada",           icono: "📤" },
  recibida_parcial: { id: "recibida_parcial", nombre: "Recibida en parte", icono: "📦" },
  recibida:         { id: "recibida",         nombre: "Recibida",          icono: "✅" },
  anulada:          { id: "anulada",          nombre: "Anulada",           icono: "✖️" },
};
/** OC que todavía esperan material (el MRP no tiene que volver a sugerirlo). */
export const ESTADOS_OC_ABIERTA = ["borrador", "enviada", "recibida_parcial"];

export const MONEDAS = { ARS: { id: "ARS", simbolo: "$" }, USD: { id: "USD", simbolo: "US$" } };

/** 7 con múltiplo 5 → 10. Sin múltiplo (o 1) queda igual. */
export function redondearMultiplo(cantidad, multiplo) {
  const q = Number(cantidad);
  const m = Number(multiplo);
  if (!Number.isFinite(q) || q <= 0) return null;
  if (!Number.isFinite(m) || m <= 0) return Math.round(q * 1000) / 1000;
  return Math.round(Math.ceil(q / m - 1e-9) * m * 1000) / 1000;
}

/** "$ 1.234,50" / "US$ 10" con hasta 2 decimales. */
export function importeTexto(n, moneda = "ARS") {
  const v = Number(n);
  if (n === null || n === undefined || n === "" || !Number.isFinite(v)) return "—";
  return `${MONEDAS[moneda]?.simbolo || "$"} ${v.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

const cantTexto = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 3 });

/** Total sin IVA de la OC; null si ningún renglón tiene precio. */
export function totalOrden(items) {
  let total = 0;
  let conPrecio = false;
  for (const it of items || []) {
    if (it.precio_unitario === null || it.precio_unitario === undefined || it.precio_unitario === "") continue;
    conPrecio = true;
    total += Number(it.cantidad) * Number(it.precio_unitario);
  }
  return conPrecio ? Math.round(total * 100) / 100 : null;
}

/** ¿La OC está enviada y ya pasó la fecha que prometió el proveedor? hoy = "YYYY-MM-DD". */
export function ocAtrasada(oc, hoy = new Date().toISOString().slice(0, 10)) {
  return ["enviada", "recibida_parcial"].includes(oc?.estado) && Boolean(oc.fecha_prometida) && oc.fecha_prometida < hoy;
}

/**
 * Proveedor sugerido para un artículo: el principal de la planilla (si está
 * cargado en Gypi con ese nombre) o el de la última OC de ese SKU.
 * @param {object} articulo
 * @param {object[]} proveedores activos
 * @param {Map<string, number>} ultimoPorSku sku → proveedor_id de la última OC
 */
export function proveedorSugerido(articulo, proveedores, ultimoPorSku = new Map()) {
  const principal = String(articulo?.proveedor_principal ?? "").trim().toLowerCase();
  if (principal) {
    const p = (proveedores || []).find((x) => String(x.nombre).trim().toLowerCase() === principal);
    if (p) return p.id;
  }
  const ultimo = articulo?.sku ? ultimoPorSku.get(articulo.sku) : null;
  return ultimo && (proveedores || []).some((x) => x.id === ultimo) ? ultimo : null;
}

/**
 * Renglones de "A comprar": primero los pedidos pendientes de los jefes de
 * taller y después lo que la planilla sugiere comprar (rojo o amarillo con
 * cantidad sugerida), salvo los SKU que ya están en un pedido pendiente o en
 * una OC abierta.
 * @returns {object[]} { clave, origen: "pedido"|"mrp", sku, descripcion, unidad, cantidad, precio_unitario, proveedor_id, pedido_id, ot, detalle, nivel }
 */
export function lineasAComprar({ pedidos = [], articulos = [], proveedores = [], skusEnOc = new Set(), ultimoPorSku = new Map() }) {
  const porSku = new Map((articulos || []).map((a) => [a.sku, a]));
  const out = [];
  const skusPedidos = new Set();
  for (const p of pedidos || []) {
    if (p.estado !== "pendiente") continue;
    const a = p.sku ? porSku.get(p.sku) : null;
    if (p.sku) skusPedidos.add(p.sku);
    out.push({
      clave: `p${p.id}`,
      origen: "pedido",
      sku: p.sku || null,
      descripcion: p.descripcion,
      unidad: p.unidad || a?.unidad || null,
      cantidad: redondearMultiplo(p.cantidad, a?.multiplo),
      precio_unitario: a?.ultimo_precio ?? null,
      proveedor_id: proveedorSugerido(a || { sku: p.sku }, proveedores, ultimoPorSku),
      pedido_id: p.id,
      ot: p.ot || null,
      detalle: [p.empleado_nombre, p.para_fecha ? `para el ${p.para_fecha.split("-").reverse().join("/")}` : null, p.notas].filter(Boolean).join(" · "),
      nivel: null,
    });
  }
  const mrp = (articulos || [])
    .filter((a) => a && a.activo !== false && Number(a.sugerido) > 0)
    .map((a) => ({ a, nivel: nivelSemaforo(a.semaforo) }))
    .filter(({ a, nivel }) => (nivel === "rojo" || nivel === "amarillo") && !skusPedidos.has(a.sku) && !skusEnOc.has(a.sku))
    .sort((x, y) => (x.nivel === y.nivel ? String(x.a.nombre || x.a.sku).localeCompare(String(y.a.nombre || y.a.sku), "es") : x.nivel === "rojo" ? -1 : 1));
  for (const { a, nivel } of mrp) {
    out.push({
      clave: `m${a.sku}`,
      origen: "mrp",
      sku: a.sku,
      descripcion: a.nombre || a.sku,
      unidad: a.unidad || null,
      cantidad: redondearMultiplo(a.sugerido, a.multiplo),
      precio_unitario: a.ultimo_precio ?? null,
      proveedor_id: proveedorSugerido(a, proveedores, ultimoPorSku),
      pedido_id: null,
      ot: null,
      detalle: [a.semaforo, a.proxima_necesidad ? `se necesita el ${a.proxima_necesidad.split("-").reverse().join("/")}` : null].filter(Boolean).join(" · "),
      nivel,
    });
  }
  return out;
}

/** Junta los renglones elegidos por proveedor: [{ proveedor_id, lineas }]. Los que no tienen proveedor quedan afuera. */
export function agruparPorProveedor(lineas) {
  const grupos = new Map();
  for (const l of lineas || []) {
    if (!l.proveedor_id) continue;
    if (!grupos.has(l.proveedor_id)) grupos.set(l.proveedor_id, []);
    grupos.get(l.proveedor_id).push(l);
  }
  return [...grupos.entries()].map(([proveedor_id, ls]) => ({ proveedor_id, lineas: ls }));
}

const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");

/** Texto para mandar por WhatsApp o email (el PDF se adjunta aparte). */
export function textoOrdenCompra({ empresa, oc, items, proveedor = null }) {
  const saludo = proveedor?.contacto ? `Hola ${proveedor.contacto}` : "Hola";
  const renglones = (items || []).map((it) => {
    const precio = it.precio_unitario !== null && it.precio_unitario !== undefined ? ` · ${importeTexto(it.precio_unitario, oc.moneda)} c/u` : "";
    return `• ${cantTexto(it.cantidad)}${it.unidad ? ` ${it.unidad}` : ""} ${it.descripcion}${it.sku ? ` (${it.sku})` : ""}${precio}`;
  });
  const total = totalOrden(items);
  return [
    `${saludo}, te paso la orden de compra N° ${oc.numero}${empresa ? ` de ${empresa}` : ""}:`,
    "",
    ...renglones,
    "",
    total !== null ? `Total sin IVA: ${importeTexto(total, oc.moneda)}` : null,
    oc.fecha_prometida ? `Entrega: ${fechaCorta(oc.fecha_prometida)}` : null,
    oc.notas ? `Notas: ${oc.notas}` : null,
    "Por favor confirmame fecha de entrega. ¡Gracias!",
  ].filter((l) => l !== null).join("\n");
}

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));
/** Solo se muestran imágenes por https (el logo subido por la app). */
const urlSegura = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);

/**
 * La OC lista para imprimir o guardar en PDF (hoja A4).
 * @param {{ empresa: object, oc: object, items: object[], proveedor?: object }} datos
 */
export function htmlOrdenCompra({ empresa = {}, oc, items = [], proveedor = null }) {
  const logo = urlSegura(empresa?.logo_url);
  const nombreEmpresa = empresa?.razon_social || empresa?.nombre || empresa?.nombre_corto || "";
  const cuitEmpresa = empresa?.cuit ? String(empresa.cuit).replace(/^(\d{2})(\d{8})(\d)$/, "$1-$2-$3") : "";
  const total = totalOrden(items);
  const datosProveedor = [
    ["Proveedor", oc.proveedor_nombre],
    ["CUIT", proveedor?.cuit],
    ["Contacto", [proveedor?.contacto, proveedor?.whatsapp, proveedor?.email].filter(Boolean).join(" · ")],
    ["Condición de pago", proveedor?.condicion_pago],
  ].filter(([, v]) => v);
  const filas = items.map((it) => {
    const sub = it.precio_unitario !== null && it.precio_unitario !== undefined ? Number(it.cantidad) * Number(it.precio_unitario) : null;
    return `<tr>
      <td>${esc(it.descripcion)}${it.sku ? `<div class="sku">${esc(it.sku)}</div>` : ""}${it.ot ? `<div class="sku">OT ${esc(it.ot)}</div>` : ""}</td>
      <td class="n">${esc(cantTexto(it.cantidad))}</td>
      <td>${esc(it.unidad || "")}</td>
      <td class="n">${esc(it.precio_unitario !== null && it.precio_unitario !== undefined ? importeTexto(it.precio_unitario, oc.moneda) : "")}</td>
      <td class="n">${esc(sub !== null ? importeTexto(sub, oc.moneda) : "")}</td>
    </tr>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Orden de compra N° ${esc(oc.numero)} · ${esc(oc.proveedor_nombre)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #000; font-size: 10.5pt; }
  .cabecera { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; margin-bottom: 6mm; }
  .cabecera img { max-height: 20mm; max-width: 50mm; object-fit: contain; display: block; margin-bottom: 2mm; }
  .empresa { font-weight: 700; }
  .chico { font-size: 9pt; color: #333; }
  h1 { font-size: 16pt; margin: 0; text-align: right; }
  table { border-collapse: collapse; width: 100%; }
  .datos td { padding: .8mm 0; vertical-align: top; }
  .datos td.k { width: 38mm; font-weight: 700; }
  .items { margin-top: 6mm; }
  .items th { text-align: left; border-bottom: .4mm solid #000; padding: 1.5mm 1mm; font-size: 9pt; }
  .items td { border-bottom: .2mm solid #999; padding: 1.5mm 1mm; vertical-align: top; }
  .items .n { text-align: right; white-space: nowrap; }
  .sku { font-size: 8pt; color: #444; font-family: ui-monospace, monospace; }
  .total { margin-top: 3mm; text-align: right; font-size: 12pt; font-weight: 800; }
  .nota { margin-top: 5mm; font-size: 9.5pt; }
</style></head><body>
  <div class="cabecera">
    <div>
      ${logo ? `<img src="${esc(logo)}" alt="">` : ""}
      <div class="empresa">${esc(nombreEmpresa)}</div>
      ${cuitEmpresa ? `<div class="chico">CUIT ${esc(cuitEmpresa)}</div>` : ""}
      ${empresa?.domicilio_fiscal ? `<div class="chico">${esc(empresa.domicilio_fiscal)}</div>` : ""}
    </div>
    <div>
      <h1>Orden de compra N° ${esc(oc.numero)}</h1>
      <div class="chico" style="text-align:right">Fecha: ${esc(fechaCorta(oc.enviada_at || oc.created_at || new Date().toISOString()))}</div>
      ${oc.fecha_prometida ? `<div class="chico" style="text-align:right">Entrega: ${esc(fechaCorta(oc.fecha_prometida))}</div>` : ""}
    </div>
  </div>
  <table class="datos">${datosProveedor.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
  <table class="items">
    <thead><tr><th>Artículo</th><th class="n">Cantidad</th><th>Unidad</th><th class="n">Precio unit. s/IVA</th><th class="n">Subtotal s/IVA</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>
  ${total !== null ? `<div class="total">Total sin IVA: ${esc(importeTexto(total, oc.moneda))}</div>` : ""}
  <div class="nota">Precios sin IVA${oc.moneda === "USD" ? ", en dólares estadounidenses" : ", en pesos"}.${oc.notas ? ` ${esc(oc.notas)}` : ""}</div>
</body></html>`;
}

/** Abre la OC en una pestaña nueva con el diálogo de impresión (ahí se elige "Guardar como PDF"). */
export function imprimirOrdenCompra(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(htmlOrdenCompra(datos));
  ventana.document.close();
  ventana.focus();
  // Espera el logo antes de imprimir
  setTimeout(() => ventana.print(), 600);
}
