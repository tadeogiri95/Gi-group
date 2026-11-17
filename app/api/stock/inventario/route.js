// GET /api/stock/inventario?fecha=YYYY-MM-DD — Inventario valorizado a una
// fecha (Materiales → 📊 Inventario, pedido de Tadeo 17/11; migración 196).
// Sin fecha, hoy. Solo la oficina (Dueño y administrativos): muestra precios.
// Reglas del cálculo en app/lib/inventarioValorizado.js. Con el pase del
// usuario ({ sesion }); sin la migración 196 funciona igual, sin fotos.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { safeErrorMessage } from "../../../lib/validate";
import { sbGet, sbGetAll } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { requireModuloSesion } from "../../../lib/accesosServidor";
import { logger } from "../../../lib/logger";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { deshacerMovimientos, fechaValida, finDelDia, valorizar } from "../../../lib/inventarioValorizado";

const leer = (sesion, path, maxFilas = 50000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!["gerencial", "administrativo"].includes(sesion.rol)) {
      return NextResponse.json({ error: "El inventario valorizado lo ve la oficina" }, { status: 403 });
    }
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const sinModulo = await requireModuloSesion(sesion, "stock");
    if (sinModulo) return sinModulo;

    const e = sesion.empresa_id;
    const hoy = hoyAr();
    const pedida = new URL(request.url).searchParams.get("fecha") || hoy;
    if (!fechaValida(pedida)) return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
    const fecha = pedida > hoy ? hoy : pedida;

    const articulos = await leer(sesion, `articulos_stock?empresa_id=eq.${e}&select=sku,nombre,unidad,division,familia,stock,ultimo_precio,activo&order=sku.asc`);
    let base = new Map(articulos.filter((a) => a.activo !== false).map((a) => [a.sku, Number(a.stock) || 0]));
    let desde = "hoy";
    let fotoDe = null;
    let sinFotos = false;
    let movimientos = [];

    if (fecha < hoy) {
      // La primera foto del día elegido o posterior (sin la 196, sin fotos)
      let fotos = [];
      try {
        const [primera] = (await sbGet(`stock_fotos?empresa_id=eq.${e}&fecha=gte.${fecha}&select=fecha&order=fecha.asc&limit=1`, { sesion })) || [];
        if (primera) {
          fotoDe = primera.fecha;
          fotos = await leer(sesion, `stock_fotos?empresa_id=eq.${e}&fecha=eq.${fotoDe}&select=sku,stock&order=sku.asc`);
        }
      } catch {
        // Falta la migración 196: se calcula con el stock de hoy
        sinFotos = true;
        fotoDe = null;
      }
      let hasta = "";
      if (fotoDe) {
        base = new Map(fotos.map((f) => [f.sku, Number(f.stock) || 0]));
        desde = "foto";
        if (fotoDe > fecha) hasta = `&created_at=lte.${encodeURIComponent(finDelDia(fotoDe))}`;
      }
      if (!fotoDe || fotoDe > fecha) {
        movimientos = await leer(
          sesion,
          `movimientos_stock?empresa_id=eq.${e}&anulado=eq.false&created_at=gt.${encodeURIComponent(finDelDia(fecha))}${hasta}&select=id,tipo,sku,cantidad,anulado&order=id.asc`
        ).catch(() => []);
      }
    }
    const cantidades = deshacerMovimientos(base, movimientos);

    // Precios con fecha hasta el día elegido (164); sin la vista, el de la planilla
    const precios = await leer(
      sesion,
      `v_precios_articulos?empresa_id=eq.${e}&fecha=lte.${fecha}&precio_ars=not.is.null&select=sku,fecha,precio_ars,origen,proveedor&order=sku.asc,fecha.asc,referencia.asc`,
      200000
    ).catch(() => []);

    const inv = valorizar({ fecha, articulos, cantidades, precios });
    return NextResponse.json({
      ...inv,
      hoy,
      desde,
      foto_de: fotoDe,
      movimientos_deshechos: movimientos.length,
      sin_fotos: sinFotos,
    });
  } catch (err) {
    logger.error("[stock/inventario] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
