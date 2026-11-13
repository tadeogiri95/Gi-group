// /api/finanzas/meses — Finanzas, cerrar y reabrir meses (parte 9 del plan
// de Tesorería y Devengamiento, 13/11; reglas en app/lib/finanzasMeses.js).
// Migración 190.
//
//   GET ?mes=AAAA-MM → el estado de ese mes (cerrado o no, quién, historial).
//       Sin mes: todos los meses que alguna vez se cerraron.
//   POST { accion: "cerrar", mes } → cierra el mes (no el futuro).
//   POST { accion: "reabrir", mes, motivo } → lo reabre; el motivo es obligatorio.
//
// Con el mes cerrado, la base no deja cargar, corregir ni anular nada con fecha
// de ese mes. Solo el rol Dueño.
import { NextResponse } from "next/server";
import { sbGet, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { MES, cerrarMes, estadoMes, reabrirMes } from "../../../lib/finanzasMeses";

const FALTA_190 = "Para cerrar meses falta correr la migración 190 en Supabase.";
const COLUMNAS = "mes,cerrado,cerrado_at,cerrado_por_nombre,reabierto_at,reabierto_por_nombre,motivo,historial";
const falta190 = (err) => /fin_meses_cerrados/.test(String(err?.message)) && /does not exist|42P01|PGRST20[05]|schema cache/.test(String(err?.message));
const respuestaFalta = () => NextResponse.json({ error: FALTA_190, falta_migracion: 190 }, { status: 409 });

async function nombreEmpleado(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

/** El renglón del mes (o null). Tira el error si falta la tabla. */
async function leerMes(sesion, mes) {
  const [fila] = (await sbGet(`fin_meses_cerrados?empresa_id=eq.${sesion.empresa_id}&mes=eq.${mes}&select=${COLUMNAS}&limit=1`, { sesion })) || [];
  return fila || null;
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const mes = new URL(request.url).searchParams.get("mes");
  try {
    if (mes) {
      if (!MES.test(mes)) return NextResponse.json({ error: "Elegí un mes" }, { status: 400 });
      return NextResponse.json({ mes: estadoMes(mes, await leerMes(sesion, mes)) });
    }
    const filas = (await sbGet(`fin_meses_cerrados?empresa_id=eq.${sesion.empresa_id}&select=${COLUMNAS}&order=mes.desc`, { sesion })) || [];
    return NextResponse.json({ meses: filas.map((f) => estadoMes(f.mes, f)) });
  } catch (err) {
    if (falta190(err)) return respuestaFalta();
    return errorFinanzas(err, "meses GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  const mes = String(d?.mes || "");
  if (d?.accion !== "cerrar" && d?.accion !== "reabrir") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  try {
    const fila = MES.test(mes) ? await leerMes(sesion, mes) : null;
    const quien = await nombreEmpleado(sesion);
    const ahora = new Date().toISOString();
    const r = d.accion === "cerrar"
      ? cerrarMes(fila, { mes, hoy: hoyAr(), quien, ahora })
      : reabrirMes(fila, { mes, motivo: d.motivo, quien, ahora });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    if (fila) await sbPatch(`fin_meses_cerrados?empresa_id=eq.${sesion.empresa_id}&mes=eq.${mes}`, r.cambios, { sesion });
    else await sbPost("fin_meses_cerrados", { empresa_id: sesion.empresa_id, mes, ...r.cambios }, { sesion });
    return NextResponse.json({ ok: true, mes: estadoMes(mes, { ...fila, ...r.cambios }) });
  } catch (err) {
    if (falta190(err)) return respuestaFalta();
    return errorFinanzas(err, "meses POST");
  }
}
