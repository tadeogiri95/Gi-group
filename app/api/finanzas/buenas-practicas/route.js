// /api/finanzas/buenas-practicas — Finanzas, parte 7 del plan del 11/11:
// revisión contable (reglas en app/lib/finanzasBuenasPracticas.js). Sin migración.
//
//   GET → qué mirar: operaciones del último año contra Ajuste De Capital (por
//       tipo), tipos sin cuentas, tipos con otra cuenta que la recomendada (con
//       el motivo) y cuentas que conviene agregar al plan.
//   POST { accion: "aplicar", codigos } → a esos tipos les pone las cuentas
//       recomendadas. Solo cambia las cuentas por defecto: las operaciones ya
//       cargadas no se tocan.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGetAll, sbPatch } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { cuentasRecomendadas, revisionContable } from "../../../lib/finanzasBuenasPracticas";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);

async function leerBase(sesion) {
  const e = sesion.empresa_id;
  const [cuentas, tipos] = await Promise.all([
    leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
    leer(sesion, `fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,cuenta_debe,cuenta_haber,activo&order=codigo.asc`),
  ]);
  return { cuentas, tipos };
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  try {
    const hoy = hoyAr();
    const desde = `${Number(hoy.slice(0, 4)) - 1}${hoy.slice(4)}`;
    const [base, operaciones] = await Promise.all([
      leerBase(sesion),
      leer(sesion, `fin_operaciones?empresa_id=eq.${sesion.empresa_id}&fecha=gte.${desde}&anulada_at=is.null&select=id,tipo,cuenta_debe,cuenta_haber,total,total_ars,origen&order=id.asc`, 100000),
    ]);
    const revision = revisionContable({ ...base, operaciones });
    // Los nombres de las cuentas que se muestran (actual → recomendada)
    const usadas = new Set(revision.recomendadas.flatMap((r) => [r.actual.debe, r.actual.haber, r.recomendada.debe, r.recomendada.haber]).filter(Boolean));
    const nombres = Object.fromEntries(base.cuentas.filter((c) => usadas.has(c.codigo)).map((c) => [c.codigo, c.nombre]));
    return NextResponse.json({ desde, ...revision, nombres });
  } catch (err) {
    return errorFinanzas(err, "buenas-practicas GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (d?.accion !== "aplicar") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  const codigos = new Set((Array.isArray(d.codigos) ? d.codigos : []).map(String).slice(0, 200));
  if (!codigos.size) return NextResponse.json({ error: "Elegí al menos un tipo" }, { status: 400 });
  try {
    const e = sesion.empresa_id;
    const ahora = new Date().toISOString();
    const { tipos, cuentas } = await leerBase(sesion);
    const cambios = cuentasRecomendadas(tipos, cuentas).filter((c) => codigos.has(c.codigo));
    for (const c of cambios) {
      await sbPatch(`fin_tipos_operacion?empresa_id=eq.${e}&codigo=eq.${encodeURIComponent(c.codigo)}`, {
        cuenta_debe: c.recomendada.debe, cuenta_haber: c.recomendada.haber, updated_at: ahora,
      }, { sesion });
    }
    broadcastRefresh(e, "finanzas");
    return NextResponse.json({ ok: true, cambiados: cambios.map((c) => c.codigo) });
  } catch (err) {
    return errorFinanzas(err, "buenas-practicas POST");
  }
}
