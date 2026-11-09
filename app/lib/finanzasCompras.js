// app/lib/finanzasCompras.js — Finanzas, parte F2a: la compra sale sola de la
// factura (migración 172; tabla fin_operaciones de la 171).
//
// Cuando Administración carga la factura de una orden de compra (Compras →
// Órdenes → Factura) o una factura suelta, Gypi crea la compra en Finanzas:
// material o gasto por el neto, IVA crédito fiscal y otros impuestos contra
// Proveedores por el total (el asiento lo arma asientoDe, F1b). Si se corrige
// la factura, la compra se corrige; si se anula la factura o la OC, la compra
// se anula. Administración no ve nada de esto. Lo que facturó otro proveedor
// en una OC (173, "＋ Otra factura") es otra compra, de ese proveedor.
//
// Qué tipo de compra es: el que tiene el proveedor (proveedores.fin_tipo, se
// guarda cuando el dueño lo cambia en Finanzas). Si no tiene, COMPRA MP (o el
// primer tipo del grupo COMPRAS) y la compra queda "para revisar".
// Las cuentas corrientes van en pesos: una factura en dólares se pasa a pesos
// con su tipo de cambio; sin tipo de cambio no se crea la compra todavía.
//
// Escribe con la llave del servidor (quien carga la factura no ve Finanzas) y
// nunca hace fallar el guardado de la factura: si algo sale mal, lo anota en
// el log y sigue.
import { sbGet, sbPatch, sbPost } from "./sbHelpers";
import { getModulosEmpresa } from "./planEnforcement";
import { totalesFactura } from "./ordenesCompra";
import { logger } from "./logger";

export const TIPO_COMPRA_DEFECTO = "COMPRA MP";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const conCuentas = (t) => t && t.activo !== false && t.cuenta_debe && t.cuenta_haber;

/** El tipo de compra para un proveedor: el suyo, o COMPRA MP, o el primero de COMPRAS. */
export function tipoDeCompra(tipos, proveedor) {
  const suyo = tipos.find((t) => t.codigo === proveedor?.fin_tipo);
  if (conCuentas(suyo)) return { tipo: suyo, revisar: false };
  const defecto = tipos.find((t) => t.codigo === TIPO_COMPRA_DEFECTO);
  if (conCuentas(defecto)) return { tipo: defecto, revisar: true };
  const compras = tipos.find((t) => /compra/i.test(String(t.grupo || "")) && conCuentas(t));
  return compras ? { tipo: compras, revisar: true } : { tipo: null, revisar: true };
}

/**
 * Importes de la factura de una OC, en pesos, o null si todavía no hay factura
 * (sin número ni fecha, sin importes, en dólares sin tipo de cambio) o la OC
 * está anulada.
 */
export function importesFacturaOc(oc, items) {
  if (!oc || oc.estado === "anulada") return null;
  if (!oc.factura_numero && !oc.factura_fecha) return null;
  const t = totalesFactura((items || []).map((it) => ({
    cantidad: it.cantidad_facturada ?? it.cantidad_recibida ?? it.cantidad,
    precio: it.precio_unitario,
    iva: it.iva_alicuota ?? 21,
  })), Number(oc.factura_otros_impuestos) || 0);
  if (!(t.total > 0)) return null;
  const tc = oc.moneda === "USD" ? Number(oc.tipo_cambio) : 1;
  if (!(tc > 0)) return null;
  const ots = [...new Set((items || []).map((it) => String(it.ot || "").trim()))];
  return {
    fecha: oc.factura_fecha || null,
    numero: oc.factura_numero || null,
    neto: centavos(t.neto * tc), iva: centavos(t.iva * tc), otros: centavos(t.otros * tc), total: centavos(t.total * tc),
    usd: oc.moneda === "USD" ? { total: t.total, tc } : null,
    ot: ots.length === 1 && ots[0] ? ots[0] : null,
    descripcion: `Factura${oc.factura_numero ? ` ${oc.factura_numero}` : ""} · OC ${oc.numero}`,
  };
}

/**
 * Importes de otra factura de una OC (173: la facturó otro proveedor), en
 * pesos, o null si está anulada, la OC está anulada, no tiene importe o es en
 * dólares sin tipo de cambio. Los renglones traen su cantidad, precio e IVA.
 */
export function importesOtraFactura(f, oc, items = []) {
  if (!f || f.anulada_at || !oc || oc.estado === "anulada") return null;
  const renglones = Array.isArray(f.renglones) ? f.renglones : [];
  const t = totalesFactura(renglones.map((r) => ({ cantidad: r.cantidad, precio: r.precio, iva: r.iva ?? 21 })), Number(f.otros_impuestos) || 0);
  if (!(t.total > 0)) return null;
  const tc = oc.moneda === "USD" ? Number(f.tipo_cambio) : 1;
  if (!(tc > 0)) return null;
  const porId = new Map((items || []).map((it) => [Number(it.id), it]));
  const ots = [...new Set(renglones.map((r) => String(porId.get(Number(r.item_id))?.ot || "").trim()))];
  return {
    fecha: f.fecha || null,
    numero: f.numero || null,
    neto: centavos(t.neto * tc), iva: centavos(t.iva * tc), otros: centavos(t.otros * tc), total: centavos(t.total * tc),
    usd: oc.moneda === "USD" ? { total: t.total, tc } : null,
    ot: ots.length === 1 && ots[0] ? ots[0] : null,
    descripcion: `Factura${f.numero ? ` ${f.numero}` : ""} · OC ${oc.numero} (otro proveedor)`,
  };
}

/** Importes de una factura suelta, en pesos, o null si está anulada, es una lista de precios o no tiene importe. */
export function importesFacturaSuelta(f, renglones) {
  if (!f || f.anulada_at || (f.tipo && f.tipo !== "factura")) return null;
  const neto = centavos((renglones || []).reduce((s, r) => s + (Number(r.cantidad) || 0) * (Number(r.precio) || 0), 0));
  const iva = centavos(f.iva);
  const otros = centavos(f.otros_impuestos);
  const total = centavos(neto + iva + otros);
  if (!(total > 0)) return null;
  const tc = f.moneda === "USD" ? Number(f.tipo_cambio) : 1;
  if (!(tc > 0)) return null;
  return {
    fecha: f.fecha || null,
    numero: f.numero || null,
    neto: centavos(neto * tc), iva: centavos(iva * tc), otros: centavos(otros * tc), total: centavos(total * tc),
    usd: f.moneda === "USD" ? { total, tc } : null,
    ot: null,
    descripcion: `Factura suelta${f.numero ? ` ${f.numero}` : ""}`,
  };
}

const usdTexto = (usd) => (usd ? ` · USD ${usd.total.toLocaleString("es-AR", { minimumFractionDigits: 2 })} a $${usd.tc.toLocaleString("es-AR")}` : "");

/**
 * La compra en Finanzas de una factura: crea, corrige o anula la operación.
 * @param {string} empresaId
 * @param {{ origen: "factura_oc" | "factura_oc_otra" | "factura_suelta", id: number|string }} factura
 * @returns {Promise<{ accion: string }>} creada | corregida | anulada | nada | omitida
 */
export async function sincronizarCompra(empresaId, { origen, id }) {
  const e = empresaId;
  try {
    const { modulos } = await getModulosEmpresa(e);
    if (!modulos.includes("finanzas")) return { accion: "omitida" };

    const origenId = String(id);
    const [viva] = (await sbGet(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${origen}&origen_id=eq.${encodeURIComponent(origenId)}&anulada_at=is.null&select=*&limit=1`)) || [];

    let importes = null;
    let proveedorId = null;
    let proveedorNombre = null;
    if (origen === "factura_oc") {
      const [oc] = (await sbGet(`ordenes_compra?id=eq.${Number(id)}&empresa_id=eq.${e}&select=*&limit=1`)) || [];
      const items = oc ? (await sbGet(`ordenes_compra_items?orden_id=eq.${oc.id}&empresa_id=eq.${e}&select=*`)) || [] : [];
      importes = importesFacturaOc(oc, items);
      proveedorId = oc?.proveedor_id || null;
      proveedorNombre = oc?.proveedor_nombre || null;
    } else if (origen === "factura_oc_otra") {
      const [f] = (await sbGet(`ordenes_compra_facturas?id=eq.${Number(id)}&empresa_id=eq.${e}&select=*&limit=1`)) || [];
      const [oc] = f ? (await sbGet(`ordenes_compra?id=eq.${f.orden_id}&empresa_id=eq.${e}&select=id,numero,estado,moneda&limit=1`)) || [] : [];
      const items = oc ? (await sbGet(`ordenes_compra_items?orden_id=eq.${oc.id}&empresa_id=eq.${e}&select=id,ot`)) || [] : [];
      importes = importesOtraFactura(f, oc, items);
      proveedorId = f?.proveedor_id || null;
      proveedorNombre = f?.proveedor_nombre || null;
    } else {
      const [f] = (await sbGet(`facturas_sueltas?id=eq.${Number(id)}&empresa_id=eq.${e}&select=*&limit=1`)) || [];
      const renglones = f ? (await sbGet(`facturas_sueltas_renglones?factura_id=eq.${f.id}&empresa_id=eq.${e}&select=cantidad,precio`)) || [] : [];
      importes = importesFacturaSuelta(f, renglones);
      proveedorId = f?.proveedor_id || null;
      proveedorNombre = f?.proveedor || null;
    }

    const ahora = new Date().toISOString();
    if (!importes) {
      if (!viva) return { accion: "nada" };
      await sbPatch(`fin_operaciones?id=eq.${viva.id}&empresa_id=eq.${e}`, { anulada_at: ahora, anulada_por_nombre: "Gypi (se anuló o se borró la factura)", updated_at: ahora });
      return { accion: "anulada" };
    }

    let proyectoId = null;
    if (importes.ot) {
      const [p] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(importes.ot)}&select=id&limit=1`)) || [];
      proyectoId = p?.id || null;
    }
    const comun = {
      fecha: importes.fecha || ahora.slice(0, 10),
      proveedor_id: proveedorId,
      entidad: proveedorId ? null : proveedorNombre,
      proyecto_id: proyectoId,
      neto: importes.neto, iva: importes.iva, otros_impuestos: importes.otros, total: importes.total,
      moneda: "ARS", tipo_cambio: null, total_ars: importes.total,
      descripcion: `${importes.descripcion}${usdTexto(importes.usd)}`.slice(0, 500),
      referencia: importes.numero ? String(importes.numero).slice(0, 120) : null,
      updated_at: ahora,
    };

    if (viva) {
      // El tipo y las cuentas no se tocan: el dueño pudo haberlos cambiado
      await sbPatch(`fin_operaciones?id=eq.${viva.id}&empresa_id=eq.${e}`, comun);
      return { accion: "corregida" };
    }

    const [tipos, proveedores] = await Promise.all([
      sbGet(`fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,grupo,cuenta_debe,cuenta_haber,activo`),
      proveedorId ? sbGet(`proveedores?id=eq.${proveedorId}&empresa_id=eq.${e}&select=id,fin_tipo&limit=1`) : Promise.resolve([]),
    ]);
    const { tipo, revisar } = tipoDeCompra(tipos || [], (proveedores || [])[0]);
    if (!tipo) {
      logger.warn(`[finanzas] sin tipo de compra con cuentas: no se creó la compra de ${origen} ${origenId}`);
      return { accion: "omitida" };
    }
    await sbPost("fin_operaciones", {
      ...comun, empresa_id: e, tipo: tipo.codigo, cuenta_debe: tipo.cuenta_debe, cuenta_haber: tipo.cuenta_haber,
      origen, origen_id: origenId, estado: revisar ? "para_revisar" : "confirmada", cargada_por_nombre: "Gypi", created_at: ahora,
    });
    return { accion: "creada" };
  } catch (err) {
    // Sin Finanzas (migraciones 171/172 sin correr) o la base no respondió: la factura igual se guardó
    logger.warn(`[finanzas] no se pudo pasar la compra de ${origen} ${id}`, err);
    return { accion: "omitida" };
  }
}
