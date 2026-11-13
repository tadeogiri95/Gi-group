// /api/finanzas/cuadrar — Finanzas: cuadrar las cajas y bancos con el libro
// (13/11; reglas en app/lib/finanzasCuadrar.js). Sin migración.
//
//   GET → las cajas y bancos y las operaciones vivas que las tocan (todas las
//       fechas). La comparación con el libro la hace la pantalla.
//   POST { accion: "anular", ids } → anula esas operaciones (solo vivas y que
//       toquen una caja o banco). No se borran: quedan anuladas, con quién y
//       cuándo.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { MAX_ANULAR_CUADRAR } from "../../../lib/finanzasCuadrar";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const CAMPOS = "id,fecha,tipo,total,total_ars,moneda,cuenta_debe,cuenta_haber,descripcion,entidad,referencia,origen,origen_id";

/** El filtro "toca alguna de estas cuentas" para PostgREST. */
function tocaCajas(tesoreria) {
  const lista = tesoreria.map((t) => `"${String(t.cuenta).replace(/"/g, "")}"`).join(",");
  return `or=(${encodeURIComponent(`cuenta_debe.in.(${lista}),cuenta_haber.in.(${lista})`)})`;
}

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 100) : null;
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  try {
    const tesoreria = await leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa`);
    const operaciones = tesoreria.length
      ? await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&${tocaCajas(tesoreria)}&select=${CAMPOS}&order=fecha.asc,id.asc`, 200000)
      : [];
    return NextResponse.json({ tesoreria, operaciones });
  } catch (err) {
    return errorFinanzas(err, "cuadrar GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  const e = sesion.empresa_id;
  try {
    if (d?.accion !== "anular") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
    const ids = [...new Set((Array.isArray(d.ids) ? d.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) return NextResponse.json({ error: "No elegiste ninguna operación" }, { status: 400 });
    if (ids.length > MAX_ANULAR_CUADRAR) return NextResponse.json({ error: `Hasta ${MAX_ANULAR_CUADRAR} por vez` }, { status: 400 });
    const tesoreria = await leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta`);
    if (!tesoreria.length) return NextResponse.json({ error: "No hay cajas ni bancos" }, { status: 400 });
    const ahora = new Date().toISOString();
    const quien = `${(await nombreEmpleado(sesion)) || "Dueño"} (cuadrar con el libro)`;
    let anuladas = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const filas = await sbPatch(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&${tocaCajas(tesoreria)}&id=in.(${ids.slice(i, i + 200).join(",")})`, {
        anulada_at: ahora, anulada_por_nombre: quien, updated_at: ahora,
      }, { sesion });
      anuladas += filas?.length || 0;
    }
    broadcastRefresh(e, "fin_operaciones");
    return NextResponse.json({ ok: true, anuladas });
  } catch (err) {
    return errorFinanzas(err, "cuadrar POST");
  }
}
