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
  cerrada_faltantes: { id: "cerrada_faltantes", nombre: "Cerrada con faltantes", icono: "🔒" },
  anulada:          { id: "anulada",          nombre: "Anulada",           icono: "✖️" },
};
/** OC que todavía esperan material (el MRP no tiene que volver a sugerirlo). */
export const ESTADOS_OC_ABIERTA = ["borrador", "enviada", "recibida_parcial"];

export const MONEDAS = { ARS: { id: "ARS", simbolo: "$" }, USD: { id: "USD", simbolo: "US$" } };

/**
 * Importe como se escribe en Argentina: "$ 1.500", "1.500,50", "1050", "10,5".
 * Un punto seguido de tres cifras es de miles ("1.050" = mil cincuenta).
 * Vacío, negativo o texto → null.
 */
export function leerImporte(texto) {
  let t = String(texto ?? "").replace(/[$\s]|US/gi, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n >= 1e12) return null;
  return Math.round(n * 10000) / 10000;
}

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
      detalle: [p.faltante_de ? `↩ faltó de la ${p.faltante_de}` : null, p.empleado_nombre, p.para_fecha ? `para el ${p.para_fecha.split("-").reverse().join("/")}` : null, p.notas].filter(Boolean).join(" · "),
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

/**
 * Junta los renglones elegidos por proveedor: [{ proveedor_id, lineas }]. Los
 * que no tienen proveedor van juntos al final con proveedor_id null: son la
 * orden "A cotizar" (125).
 */
export function agruparPorProveedor(lineas) {
  const grupos = new Map();
  const sinProveedor = [];
  for (const l of lineas || []) {
    if (!l.proveedor_id) { sinProveedor.push(l); continue; }
    if (!grupos.has(l.proveedor_id)) grupos.set(l.proveedor_id, []);
    grupos.get(l.proveedor_id).push(l);
  }
  const out = [...grupos.entries()].map(([proveedor_id, ls]) => ({ proveedor_id, lineas: ls }));
  if (sinProveedor.length) out.push({ proveedor_id: null, lineas: sinProveedor });
  return out;
}

/* ─── Orden "A cotizar" y pedidos de cotización (migración 125) ────────── */

/** Nombre que lleva la orden mientras no tiene proveedor. */
export const NOMBRE_A_COTIZAR = "A cotizar";

/** ¿La orden está esperando cotizaciones? (borrador sin proveedor) */
export function ocACotizar(oc) {
  return Boolean(oc) && oc.estado === "borrador" && !oc.proveedor_id;
}

/** Estado para mostrar: una orden a cotizar se ve como tal, no como borrador. */
export function estadoOcVisible(oc) {
  return ocACotizar(oc) ? { id: "a_cotizar", nombre: "A cotizar", icono: "📨" } : ESTADOS_OC[oc?.estado] || ESTADOS_OC.borrador;
}

/** Id de la cotización contestada con el menor total; null si ninguna tiene total. */
export function cotizacionMasBarata(cotizaciones) {
  let mejor = null;
  for (const c of cotizaciones || []) {
    if (c.total === null || c.total === undefined || c.total === "") continue;
    if (!mejor || Number(c.total) < Number(mejor.total)) mejor = c;
  }
  return mejor?.id ?? null;
}

/** Texto del pedido de cotización para WhatsApp o email: artículos y cantidades, sin precios. */
export function textoCotizacion({ empresa, oc, items, proveedor = null }) {
  const saludo = proveedor?.contacto ? `Hola ${proveedor.contacto}` : "Hola";
  const renglones = (items || []).map((it) => {
    const obs = it.observacion ? `\n   Obs.: ${it.observacion}` : "";
    return `• ${cantTexto(it.cantidad)}${it.unidad ? ` ${it.unidad}` : ""} ${it.descripcion}${it.sku ? ` (${it.sku})` : ""}${obs}`;
  });
  return [
    `${saludo}, te pido cotización${empresa ? ` para ${empresa}` : ""} (pedido N° ${oc.numero}):`,
    "",
    ...renglones,
    "",
    oc.fecha_prometida ? `Lo necesitamos para el ${fechaCorta(oc.fecha_prometida)}.` : null,
    oc.notas ? `Notas: ${oc.notas}` : null,
    `Por favor pasame precio sin IVA${oc.moneda === "USD" ? " en dólares" : ""}, plazo de entrega y condición de pago. ¡Gracias!`,
  ].filter((l) => l !== null).join("\n");
}

const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");

/** Texto para mandar por WhatsApp o email (el PDF se adjunta aparte). */
export function textoOrdenCompra({ empresa, oc, items, proveedor = null }) {
  const saludo = proveedor?.contacto ? `Hola ${proveedor.contacto}` : "Hola";
  const renglones = (items || []).map((it) => {
    const precio = it.precio_unitario !== null && it.precio_unitario !== undefined ? ` · ${importeTexto(it.precio_unitario, oc.moneda)} c/u` : "";
    const obs = it.observacion ? `\n   Obs.: ${it.observacion}` : "";
    return `• ${cantTexto(it.cantidad)}${it.unidad ? ` ${it.unidad}` : ""} ${it.descripcion}${it.sku ? ` (${it.sku})` : ""}${precio}${obs}`;
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
export function htmlOrdenCompra({ empresa = {}, oc, items = [], proveedor = null, cotizacion = false }) {
  const titulo = cotizacion ? "Pedido de cotización" : "Orden de compra";
  const logo = urlSegura(empresa?.logo_url);
  const nombreEmpresa = empresa?.razon_social || empresa?.nombre || empresa?.nombre_corto || "";
  const cuitEmpresa = empresa?.cuit ? String(empresa.cuit).replace(/^(\d{2})(\d{8})(\d)$/, "$1-$2-$3") : "";
  const total = cotizacion ? null : totalOrden(items);
  const datosProveedor = [
    ["Proveedor", cotizacion ? proveedor?.nombre : oc.proveedor_nombre],
    ["CUIT", proveedor?.cuit],
    ["Contacto", [proveedor?.contacto, proveedor?.whatsapp, proveedor?.email].filter(Boolean).join(" · ")],
    ["Condición de pago", proveedor?.condicion_pago],
  ].filter(([, v]) => v);
  const filas = items.map((it) => {
    const sub = it.precio_unitario !== null && it.precio_unitario !== undefined ? Number(it.cantidad) * Number(it.precio_unitario) : null;
    return `<tr>
      <td>${esc(it.descripcion)}${it.sku ? `<div class="sku">${esc(it.sku)}</div>` : ""}${it.ot ? `<div class="sku">OT ${esc(it.ot)}</div>` : ""}${it.observacion ? `<div class="obs">Obs.: ${esc(it.observacion)}</div>` : ""}</td>
      <td class="n">${esc(cantTexto(it.cantidad))}</td>
      <td>${esc(it.unidad || "")}</td>
      ${cotizacion ? "" : `<td class="n">${esc(it.precio_unitario !== null && it.precio_unitario !== undefined ? importeTexto(it.precio_unitario, oc.moneda) : "")}</td>
      <td class="n">${esc(sub !== null ? importeTexto(sub, oc.moneda) : "")}</td>`}
    </tr>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo} N° ${esc(oc.numero)} · ${esc(cotizacion ? proveedor?.nombre || "" : oc.proveedor_nombre)}</title>
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
  .obs { font-size: 9pt; font-style: italic; margin-top: .5mm; }
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
      <h1>${titulo} N° ${esc(oc.numero)}</h1>
      <div class="chico" style="text-align:right">Fecha: ${esc(fechaCorta(oc.enviada_at || oc.created_at || new Date().toISOString()))}</div>
      ${oc.fecha_prometida ? `<div class="chico" style="text-align:right">${cotizacion ? "Se necesita" : "Entrega"}: ${esc(fechaCorta(oc.fecha_prometida))}</div>` : ""}
    </div>
  </div>
  <table class="datos">${datosProveedor.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
  <table class="items">
    <thead><tr><th>Artículo</th><th class="n">Cantidad</th><th>Unidad</th>${cotizacion ? "" : `<th class="n">Precio unit. s/IVA</th><th class="n">Subtotal s/IVA</th>`}</tr></thead>
    <tbody>${filas}</tbody>
  </table>
  ${total !== null ? `<div class="total">Total sin IVA: ${esc(importeTexto(total, oc.moneda))}</div>` : ""}
  ${oc.estado === "cerrada_faltantes" ? `<div class="nota"><b>Cerrada con faltantes${oc.cerrada_at ? ` el ${esc(fechaCorta(oc.cerrada_at))}` : ""}.</b> Lo no entregado queda sin efecto.${oc.cerrada_motivo ? ` ${esc(oc.cerrada_motivo)}` : ""}</div>` : ""}
  ${cotizacion
    ? `<div class="nota">Por favor cotizar precio unitario sin IVA${oc.moneda === "USD" ? " en dólares estadounidenses" : ""}, plazo de entrega y condición de pago.${oc.notas ? ` ${esc(oc.notas)}` : ""}</div>`
    : `<div class="nota">Precios sin IVA${oc.moneda === "USD" ? ", en dólares estadounidenses" : ", en pesos"}.${oc.notas ? ` ${esc(oc.notas)}` : ""}</div>`}
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

/* ─── Recepción con remito y factura (parte 22, migración 115) ─────────── */

/** OC en las que se puede anotar lo que llegó. */
export const ESTADOS_OC_RECIBIBLE = ["borrador", "enviada", "recibida_parcial"];

/** Lo que falta llegar de un renglón (nunca negativo). */
export function pendienteItem(it) {
  const p = Number(it?.cantidad) - Number(it?.cantidad_recibida || 0);
  return p > 0 ? Math.round(p * 1000) / 1000 : 0;
}

/** OC que se pueden cerrar con faltantes (123): ya llegó algo y el resto no va a venir. */
export const ESTADOS_OC_CERRABLE = ["recibida_parcial"];

/**
 * Qué pasa con los pedidos de los jefes al cerrar una OC con faltantes (123):
 * - completos: el renglón llegó entero → el pedido queda recibido.
 * - volver: no llegó nada → el mismo pedido vuelve a pendiente (A comprar).
 * - nuevos: llegó una parte → el pedido queda recibido y se crea uno
 *   pendiente por lo que faltó ({ pedido_id, cantidad }).
 * Los renglones sin pedido (sugeridos del MRP) no hacen nada: la planilla los
 * vuelve a sugerir si siguen haciendo falta.
 */
export function pedidosAlCerrar(items) {
  const completos = [];
  const volver = [];
  const nuevos = [];
  for (const it of items || []) {
    if (!it.pedido_id) continue;
    const falta = pendienteItem(it);
    if (falta === 0) completos.push(it.pedido_id);
    else if (Number(it.cantidad_recibida || 0) > 0) nuevos.push({ pedido_id: it.pedido_id, cantidad: falta });
    else volver.push(it.pedido_id);
  }
  return { completos, volver, nuevos };
}

/** Estado de la OC según lo recibido: todo → recibida; algo → recibida_parcial; nada → enviada. */
export function estadoTrasRecepcion(items) {
  const lista = items || [];
  if (lista.length && lista.every((it) => pendienteItem(it) === 0)) return "recibida";
  if (lista.some((it) => Number(it.cantidad_recibida) > 0)) return "recibida_parcial";
  return "enviada";
}

/** Precio del ingreso de stock, en pesos como la planilla: una OC en dólares necesita el tipo de cambio. */
export function precioEnPesos(precio, moneda, tipoCambio) {
  if (precio === null || precio === undefined || precio === "") return null;
  const p = Number(precio);
  if (!Number.isFinite(p)) return null;
  if (moneda !== "USD") return Math.round(p * 100) / 100;
  const tc = Number(tipoCambio);
  return Number.isFinite(tc) && tc > 0 ? Math.round(p * tc * 100) / 100 : null;
}

// ─── Factura de la OC con IVA y otros impuestos (migración 122) ───

/** Alícuotas de IVA que se eligen por renglón; sin elegir es 21. */
export const ALICUOTAS_IVA = [21, 10.5, 27, 0];
export const IVA_POR_DEFECTO = 21;

const centavos = (n) => Math.round(n * 100) / 100;

/** Cantidad facturada que se propone: la guardada, si no lo que llegó, si no lo pedido. */
export function cantidadFacturaInicial(it) {
  if (it.cantidad_facturada !== null && it.cantidad_facturada !== undefined) return Number(it.cantidad_facturada);
  const recibida = Number(it.cantidad_recibida);
  return Number.isFinite(recibida) && recibida > 0 ? recibida : Number(it.cantidad);
}

/** Neto, IVA y total de un renglón de factura; null si falta la cantidad o el precio. */
export function renglonFactura({ cantidad, precio, iva = IVA_POR_DEFECTO }) {
  const q = Number(cantidad);
  const p = Number(precio);
  if (cantidad === null || cantidad === undefined || precio === null || precio === undefined || !Number.isFinite(q) || !Number.isFinite(p)) return null;
  const neto = centavos(q * p);
  const montoIva = centavos(neto * (Number(iva) || 0) / 100);
  return { neto, iva: montoIva, total: centavos(neto + montoIva) };
}

/** Pie de la factura: subtotal neto e IVA (suma de renglones), otros impuestos y total. */
export function totalesFactura(renglones, otros = 0) {
  let neto = 0;
  let iva = 0;
  for (const r of renglones || []) {
    const c = renglonFactura(r);
    if (!c) continue;
    neto += c.neto;
    iva += c.iva;
  }
  const extra = Number(otros) || 0;
  return { neto: centavos(neto), iva: centavos(iva), otros: centavos(extra), total: centavos(neto + iva + extra) };
}
