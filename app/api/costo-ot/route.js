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
import { sbGet, sbPatch } from "../../lib/sbHelpers";
import { comoDueno } from "../../lib/alcance";
import { SKU_VALIDO } from "../../lib/stock";
import { logger } from "../../lib/logger";
import { elegirPrecio, fechaCargaOt, filaPrecioFijo } from "../../lib/costoMateriales";
import { costoMaterialesDeOt, faltaMigracionCosto as faltaMigracion, guardarFijos, preciosDe, proyectoDe } from "../../lib/costoMaterialesServidor";

const OT_VALIDA = /^[^"',()\\]{1,40}$/;

async function sesionDueno(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (!(await comoDueno(sesion))) {
    return { response: NextResponse.json({ error: "Solo el dueño y los supervisores ven el costo de las OT" }, { status: 403 }) };
  }
  return { sesion };
}

export async function GET(request) {
  try {
    const { sesion, response } = await sesionDueno(request);
    if (response) return response;
    const ot = new URL(request.url).searchParams.get("ot") || "";
    if (!OT_VALIDA.test(ot)) return NextResponse.json({ error: "OT inválida" }, { status: 400 });
    try {
      return NextResponse.json({ ok: true, ...(await costoMaterialesDeOt(sesion.empresa_id, ot)) });
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
