// /api/costo-ot — Costo de materiales de una OT (costo de OT, parte B;
// migraciones 164 y 165; app/lib/costoMateriales.js).
//
//   GET  ?ot=M-7471 → renglones del costo (artículo, cantidad, retirado,
//        precio, fecha, origen, subtotal) y total. Los artículos que todavía
//        no tienen precio fijo en la OT lo buscan y, si lo encuentran, queda
//        guardado en precios_fijos_ot.
//   POST { accion: "rebuscar", ot, sku } → vuelve a buscar el precio de un
//        artículo con la misma regla y anota quién lo hizo y el de antes.
//
// Solo el Dueño y el Supervisor (comoDueno). Como el pase no sabe si un
// administrativo es Supervisor, lee y escribe con la clave del servidor
// después de verificarlo acá, filtrando siempre por su empresa.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { safeErrorMessage } from "../../lib/validate";
import { sbGet, sbGetAll, sbHeaders, sbPatch } from "../../lib/sbHelpers";
import { comoDueno } from "../../lib/alcance";
import { SKU_VALIDO } from "../../lib/stock";
import { logger } from "../../lib/logger";
import { costoMaterialesOt, elegirPrecio, fechaCargaOt, filaPrecioFijo } from "../../lib/costoMateriales";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const OT_VALIDA = /^[^"',()\\]{1,40}$/;
const MAX_SKUS = 500;

const FALTA_164 = "Para el costo de materiales falta correr la migración 164 en Supabase.";
const FALTA_165 = "Para el costo de materiales falta correr la migración 165 en Supabase.";

function faltaMigracion(err) {
  const m = String(err?.message);
  if (m.includes("precios_fijos_ot")) return FALTA_165;
  if (m.includes("v_precios_articulos") || m.includes("precios_articulos")) return FALTA_164;
  return null;
}

async function sesionDueno(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (!(await comoDueno(sesion))) {
    return { response: NextResponse.json({ error: "Solo el dueño y los supervisores ven el costo de las OT" }, { status: 403 }) };
  }
  return { sesion };
}

const lista = (skus) => skus.map((s) => `%22${encodeURIComponent(s)}%22`).join(",");

/** Precios de la vista para esos artículos (con precio en pesos). */
async function preciosDe(e, skus) {
  if (!skus.length) return new Map();
  const { data } = await sbGetAll(
    `v_precios_articulos?empresa_id=eq.${e}&sku=in.(${lista(skus)})&precio_ars=not.is.null&select=sku,fecha,precio,moneda,tipo_cambio,precio_ars,origen,referencia,proveedor,comprobante&order=sku.asc,fecha.asc,referencia.asc`,
    { maxFilas: 50000 }
  );
  const porSku = new Map();
  for (const p of data || []) {
    if (!porSku.has(p.sku)) porSku.set(p.sku, []);
    porSku.get(p.sku).push(p);
  }
  return porSku;
}

async function proyectoDe(e, ot) {
  const [p] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&select=ot,created_at&limit=1`)) || [];
  return p || null;
}

async function guardarFijos(filas) {
  if (!filas.length) return;
  const r = await fetch(`${SB_URL}/rest/v1/precios_fijos_ot?on_conflict=empresa_id,ot,sku`, {
    method: "POST",
    headers: await sbHeaders({}, { Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify(filas),
  });
  if (!r.ok) throw new Error(`POST precios_fijos_ot: ${await r.text()}`);
}

export async function GET(request) {
  try {
    const { sesion, response } = await sesionDueno(request);
    if (response) return response;
    const ot = new URL(request.url).searchParams.get("ot") || "";
    if (!OT_VALIDA.test(ot)) return NextResponse.json({ error: "OT inválida" }, { status: 400 });
    const e = sesion.empresa_id;
    const o = encodeURIComponent(ot);
    try {
      const [proyecto, necesidades, fijosAntes, movimientos] = await Promise.all([
        proyectoDe(e, ot),
        sbGet(`necesidades_stock?empresa_id=eq.${e}&ot=eq.${o}&select=sku,nombre,cantidad`).catch(() => []),
        sbGet(`precios_fijos_ot?empresa_id=eq.${e}&ot=eq.${o}&select=*`),
        sbGet(`movimientos_stock?empresa_id=eq.${e}&ot=eq.${o}&anulado=eq.false&tipo=in.(consumo,devolucion)&select=sku,cantidad,tipo,anulado`).catch(() => []),
      ]);
      const fechaOt = fechaCargaOt(proyecto);
      const yaFijos = new Set((fijosAntes || []).map((f) => f.sku));
      const skus = [...new Set((necesidades || []).filter((n) => Number(n.cantidad) > 0).map((n) => n.sku))].slice(0, MAX_SKUS);
      const faltan = skus.filter((s) => !yaFijos.has(s));

      // Los que no tienen precio fijo lo buscan; si lo encuentran, queda fijo
      const precios = await preciosDe(e, faltan);
      const nuevos = [];
      for (const sku of faltan) {
        const p = elegirPrecio(precios.get(sku) || [], fechaOt);
        if (p) nuevos.push(filaPrecioFijo(e, ot, sku, p));
      }
      await guardarFijos(nuevos);
      const fijos = nuevos.length ? (await sbGet(`precios_fijos_ot?empresa_id=eq.${e}&ot=eq.${o}&select=*`)) || [] : fijosAntes || [];

      const articulos = skus.length
        ? (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=in.(${lista(skus)})&select=sku,nombre,unidad`).catch(() => [])) || []
        : [];
      const costo = costoMaterialesOt({ necesidades: necesidades || [], fijos, articulos, movimientos: movimientos || [] });
      return NextResponse.json({ ok: true, ot, fecha_ot: fechaOt, ...costo });
    } catch (err) {
      const falta = faltaMigracion(err);
      if (falta) return NextResponse.json({ ok: false, falta_migracion: falta });
      throw err;
    }
  } catch (err) {
    logger.error("[costo-ot] GET", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { sesion, response } = await sesionDueno(request);
    if (response) return response;
    const d = await request.json().catch(() => null);
    if (d?.accion !== "rebuscar") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
    const ot = String(d.ot ?? "");
    const sku = String(d.sku ?? "");
    if (!OT_VALIDA.test(ot) || !SKU_VALIDO.test(sku)) return NextResponse.json({ error: "OT o artículo inválido" }, { status: 400 });
    const e = sesion.empresa_id;
    const filtro = `precios_fijos_ot?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&sku=eq.${encodeURIComponent(sku)}`;
    try {
      const [proyecto, [actual]] = await Promise.all([proyectoDe(e, ot), sbGet(`${filtro}&select=*&limit=1`).then((r) => r || [])]);
      const p = elegirPrecio((await preciosDe(e, [sku])).get(sku) || [], fechaCargaOt(proyecto));
      if (!p) return NextResponse.json({ error: "Este artículo todavía no tiene ningún precio cargado." }, { status: 404 });
      const nueva = filaPrecioFijo(e, ot, sku, p);
      if (!actual) {
        await guardarFijos([nueva]);
        return NextResponse.json({ ok: true, cambio: true });
      }
      const igual = actual.fecha === nueva.fecha && Number(actual.precio_ars) === nueva.precio_ars && actual.origen === nueva.origen && (actual.referencia || null) === nueva.referencia;
      if (igual) return NextResponse.json({ ok: true, cambio: false });
      const [empleado] = sesion.empleado_id
        ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre&limit=1`, { silent: true, fallback: [] })) || []
        : [];
      const { empresa_id: _e, ot: _o, sku: _s, ...cambios } = nueva;
      await sbPatch(filtro, {
        ...cambios,
        cambiado_at: new Date().toISOString(),
        cambiado_por_nombre: empleado?.nombre ? String(empleado.nombre).slice(0, 120) : "Dueño",
        anterior: { fecha: actual.fecha, precio_ars: Number(actual.precio_ars), origen: actual.origen, proveedor: actual.proveedor, comprobante: actual.comprobante },
      });
      return NextResponse.json({ ok: true, cambio: true });
    } catch (err) {
      const falta = faltaMigracion(err);
      if (falta) return NextResponse.json({ error: falta }, { status: 409 });
      throw err;
    }
  } catch (err) {
    logger.error("[costo-ot] POST", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
