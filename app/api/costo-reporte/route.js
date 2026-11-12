// /api/costo-reporte — Reportes → 💲 Costo por OT (costo de OT, parte F; sin
// migración; app/lib/costoReporte.js).
//
//   GET ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD → una fila por OT que entró a Gypi
//       en esas fechas (hora argentina). Las cerradas con costo final usan su
//       constancia; las demás, el costo real de hoy (provisorio), con su previsto.
//
// Solo el Dueño y el Supervisor (comoDueno). Lee con la clave del servidor
// después de verificarlo acá, filtrando siempre por su empresa.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { safeErrorMessage } from "../../lib/validate";
import { sbGet, sbGetAll } from "../../lib/sbHelpers";
import { comoDueno } from "../../lib/alcance";
import { logger } from "../../lib/logger";
import { fechaCargaOt } from "../../lib/costoMateriales";
import { faltaMigracionCosto } from "../../lib/costoMaterialesServidor";
import { costosRealesDeOts } from "../../lib/costoRealServidor";
import { filaReporte } from "../../lib/costoReporte";

export const maxDuration = 60;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OTS = 200;

function diaSiguiente(f) {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!(await comoDueno(sesion))) return NextResponse.json({ error: "Solo el dueño y los supervisores ven el costo de las OT" }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const desde = params.get("desde") || "";
    const hasta = params.get("hasta") || "";
    if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) return NextResponse.json({ error: "Período inválido" }, { status: 400 });
    const e = sesion.empresa_id;
    const ini = encodeURIComponent(`${desde}T00:00:00-03:00`);
    const fin = encodeURIComponent(`${diaSiguiente(hasta)}T00:00:00-03:00`);
    try {
      const { data: todos } = await sbGetAll(`proyectos?empresa_id=eq.${e}&ot=not.is.null&created_at=gte.${ini}&created_at=lt.${fin}&select=*&order=created_at.asc,id.asc`, { maxFilas: MAX_OTS + 1 });
      const proyectos = (todos || []).slice(0, MAX_OTS);
      if (!proyectos.length) return NextResponse.json({ ok: true, filas: [], truncado: false });
      const lista = proyectos.map((p) => `%22${encodeURIComponent(String(p.ot))}%22`).join(",");
      const [finales, [costo]] = await Promise.all([
        // Sin la 167 no hay costos finales: todo provisorio
        sbGetAll(`costos_finales_ot?empresa_id=eq.${e}&estado=eq.calculado&ot=in.(${lista})&select=*&order=created_at.desc`, { maxFilas: 5000 }).then((r) => r.data).catch(() => []),
        sbGet(`costos_empresa?empresa_id=eq.${e}&select=costo_hora&limit=1`).catch(() => []).then((r) => r || []),
      ]);
      const finalDe = new Map();
      for (const f of finales) if (!finalDe.has(String(f.ot))) finalDe.set(String(f.ot), f);
      const abiertas = proyectos.filter((p) => !finalDe.has(String(p.ot)));
      // El costo real de las abiertas (auditoría 12/11, parte 3): MRP, de más, compras sin stock, horas, retrabajo, instalación y gastos
      const reales = await costosRealesDeOts(e, abiertas, { costoHora: costo?.costo_hora ?? null });
      const filas = proyectos.map((p) => {
        const ot = String(p.ot);
        const r = reales.get(ot);
        return filaReporte({
          proyecto: p, fechaOt: fechaCargaOt(p), final: finalDe.get(ot) || null,
          materiales: r?.materiales || null, horas: r?.horas || null, costoHora: costo?.costo_hora ?? null, comparativa: r?.comparativa || null,
        });
      });
      return NextResponse.json({ ok: true, filas, truncado: (todos || []).length > MAX_OTS });
    } catch (err) {
      const falta = faltaMigracionCosto(err);
      if (falta) return NextResponse.json({ ok: false, falta_migracion: falta });
      throw err;
    }
  } catch (err) {
    logger.error("[costo-reporte] GET", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
