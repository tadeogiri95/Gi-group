// /api/costo-real — Costo previsto y real de una OT (auditoría 12/11, parte 3;
// sin migración; app/lib/costoReal.js).
//
//   GET ?ot=M-7471 → renglones previsto/real (materiales del MRP, retirado de
//       más o fuera del MRP, compras sin stock, mano de obra en planta,
//       retrabajo, instalación, gastos de Finanzas con la OT), totales, avisos
//       y el detalle de lo que suma fuera del MRP. Con el precio de la OT,
//       el margen real y el previsto contra el mínimo (parte 4).
//
// Solo el Dueño y el Supervisor (comoDueno). Lee con la clave del servidor
// después de verificarlo acá, filtrando siempre por su empresa.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { safeErrorMessage } from "../../lib/validate";
import { comoDueno } from "../../lib/alcance";
import { logger } from "../../lib/logger";
import { faltaMigracionCosto } from "../../lib/costoMaterialesServidor";
import { costoRealDeOt, preciosYMinimo } from "../../lib/costoRealServidor";
import { margen } from "../../lib/margenOt";

export const maxDuration = 30;

const OT_VALIDA = /^[^"',()\\]{1,40}$/;

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!(await comoDueno(sesion))) return NextResponse.json({ error: "Solo el dueño y los supervisores ven el costo de las OT" }, { status: 403 });
    const ot = new URL(request.url).searchParams.get("ot") || "";
    if (!OT_VALIDA.test(ot)) return NextResponse.json({ error: "OT inválida" }, { status: 400 });
    try {
      const r = await costoRealDeOt(sesion.empresa_id, ot);
      if (!r) return NextResponse.json({ error: "No se encontró la OT" }, { status: 404 });
      const { fuera, compras, gastos, retrabajo, instalacion } = r.extras;
      // Margen (parte 4): precio del Plan contra el costo real y el previsto
      const { precios, minimo } = await preciosYMinimo(sesion.empresa_id, [ot]);
      const precio = precios.get(ot) ?? null;
      return NextResponse.json({
        ok: true, ot, ...r.comparativa,
        precio, margen_minimo: minimo,
        margen: margen({ precio, costo: r.comparativa.real, minimo }),
        margen_previsto: margen({ precio, costo: r.comparativa.previsto, minimo }),
        fuera: fuera?.filas || [], compras: compras?.filas || [], gastos: gastos?.filas || [],
        retrabajo_horas: retrabajo || 0, instalacion: instalacion || null,
      });
    } catch (err) {
      const falta = faltaMigracionCosto(err);
      if (falta) return NextResponse.json({ ok: false, falta_migracion: falta });
      throw err;
    }
  } catch (err) {
    logger.error("[costo-real] GET", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
