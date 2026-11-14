// /api/finanzas/patrimonio — Finanzas → ⚖ Situación patrimonial (etapa 6 de
// la auditoría de Finanzas integrada, 14/11; reglas en
// app/lib/finanzasPatrimonio.js). Sin migración: sale de fin_operaciones.
//
//   GET [?hasta=AAAA-MM-DD&desde=AAAA-MM-DD] → la situación patrimonial y la
//       posición de liquidez a "hasta" (por defecto, hoy) y los orígenes y
//       aplicaciones de fondos entre "desde" (por defecto, el 1 de enero de
//       ese año) y "hasta".
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGetAll } from "../../../lib/sbHelpers";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { FECHA, hoyAr } from "../../../lib/finanzasOperaciones";
import { listasFinanzas } from "../../../lib/finanzasListas";
import { diaAnterior } from "../../../lib/finanzasMayor";
import { origenesAplicaciones, posicionLiquidez, saldosHasta, situacionPatrimonial } from "../../../lib/finanzasPatrimonio";

export const maxDuration = 60;

const COLUMNAS = "id,fecha,tipo,neto,iva,otros_impuestos,total,total_ars,moneda,tipo_cambio,cuenta_debe,cuenta_haber,anulada_at";

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const q = new URL(request.url).searchParams;
  const hasta = FECHA.test(q.get("hasta") || "") ? q.get("hasta") : hoyAr();
  const desde = FECHA.test(q.get("desde") || "") ? q.get("desde") : `${hasta.slice(0, 4)}-01-01`;
  if (desde > hasta) return NextResponse.json({ error: "La fecha desde es posterior a la fecha hasta" }, { status: 400 });
  try {
    const [ops, listas] = await Promise.all([
      sbGetAll(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&fecha=lte.${hasta}&select=${COLUMNAS}&order=fecha.asc,id.asc`, { sesion, maxFilas: 200000 }),
      listasFinanzas(sesion),
    ]);
    const ctx = { cuentas: listas.cuentas || [], tipos: listas.tipos || [] };
    const filas = ops.data || [];
    const fin = saldosHasta(filas, hasta, ctx);
    const situacion = situacionPatrimonial(fin);
    return NextResponse.json({
      hasta, desde, truncado: !!ops.truncado, operaciones: filas.length,
      situacion,
      liquidez: posicionLiquidez(situacion),
      origenes: origenesAplicaciones(saldosHasta(filas, diaAnterior(desde), ctx), fin),
    });
  } catch (err) {
    return errorFinanzas(err, "patrimonio GET");
  }
}
