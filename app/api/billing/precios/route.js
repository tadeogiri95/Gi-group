// GET /api/billing/precios — Lo que la pantalla de Facturación necesita para
// armar el precio (ítem 25): cotización del día, operarios activos y el tramo
// mínimo de cada línea. Los precios en USD salen de app/lib/plans.js.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { sbGet } from "../../../lib/sbHelpers";
import { LINEAS, planParaOperarios, PLANES } from "../../../lib/plans";
import { cotizacionVigente } from "../../../lib/cotizacion";
import { logger } from "../../../lib/logger";

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!["gerencial", "administrativo"].includes(sesion.rol)) {
      return NextResponse.json({ error: "Solo el administrador puede ver los precios" }, { status: 403 });
    }
    const [activos, cot] = await Promise.all([
      sbGet(`empleados?empresa_id=eq.${sesion.empresa_id}&activo=eq.true&select=id`, { silent: true, fallback: [] }),
      cotizacionVigente(),
    ]);
    const operarios = (activos || []).length;
    const tramo_minimo = Object.fromEntries(
      Object.keys(LINEAS).map((l) => [l, PLANES[planParaOperarios(l, operarios)]?.tramo ?? null])
    );
    return NextResponse.json(
      { operarios, tramo_minimo, cotizacion: cot },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    logger.error("GET /api/billing/precios", err);
    return NextResponse.json({ error: "No se pudieron calcular los precios" }, { status: 500 });
  }
}
