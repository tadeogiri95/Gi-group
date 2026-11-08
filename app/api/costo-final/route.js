// /api/costo-final — Costo final de una OT al cerrarse, con constancia
// (costo de OT, parte C; migración 167; app/lib/costoFinal.js).
//
//   GET  ?ot=M-7471 → { cerrada, vigente, historial }. Si la OT se cerró y
//        el costo sigue pendiente, lo calcula en el momento.
//   POST { accion: "calcular" | "recalcular", ot } → para una OT cerrada:
//        calcula el costo (las que ya estaban cerradas antes de la 167) o lo
//        vuelve a calcular; el de antes queda anulado en el historial.
//
// Solo el Dueño y el Supervisor (comoDueno). Lee y escribe con la clave del
// servidor después de verificarlo acá, filtrando siempre por su empresa.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { safeErrorMessage } from "../../lib/validate";
import { sbGet } from "../../lib/sbHelpers";
import { comoDueno } from "../../lib/alcance";
import { logger } from "../../lib/logger";
import { separarCostos } from "../../lib/costoFinal";
import { faltaMigracionCosto } from "../../lib/costoMaterialesServidor";
import { FALTA_167, calcularAMano, completarPendiente, costosDeOt, faltaMigracionCostoFinal } from "../../lib/costoFinalServidor";

const OT_VALIDA = /^[^"',()\\]{1,40}$/;

const faltaMigracion = (err) => (faltaMigracionCostoFinal(err) ? FALTA_167 : faltaMigracionCosto(err));

async function sesionDueno(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (!(await comoDueno(sesion))) {
    return { response: NextResponse.json({ error: "Solo el dueño y los supervisores ven el costo de las OT" }, { status: 403 }) };
  }
  return { sesion };
}

async function proyecto(e, ot) {
  const [p] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&select=ot,estado&limit=1`)) || [];
  return p || null;
}

async function nombreDe(sesion) {
  if (!sesion.empleado_id) return sesion.rol === "gerencial" ? "Dueño" : "Supervisor";
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { silent: true, fallback: [] })) || [];
  return emp?.nombre || (sesion.rol === "gerencial" ? "Dueño" : "Supervisor");
}

async function respuesta(e, ot, p) {
  const { vigente, historial } = separarCostos(await costosDeOt(e, ot));
  return { ok: true, ot, cerrada: p.estado === "cerrado", vigente, historial };
}

export async function GET(request) {
  try {
    const { sesion, response } = await sesionDueno(request);
    if (response) return response;
    const ot = new URL(request.url).searchParams.get("ot") || "";
    if (!OT_VALIDA.test(ot)) return NextResponse.json({ error: "OT inválida" }, { status: 400 });
    const e = sesion.empresa_id;
    try {
      const p = await proyecto(e, ot);
      if (!p) return NextResponse.json({ error: "No encontré esa OT" }, { status: 404 });
      const { pendiente } = separarCostos(await costosDeOt(e, ot));
      if (pendiente) await completarPendiente(e, pendiente, { nombre: "Automático" });
      return NextResponse.json(await respuesta(e, ot, p));
    } catch (err) {
      const falta = faltaMigracion(err);
      if (falta) return NextResponse.json({ ok: false, falta_migracion: falta });
      throw err;
    }
  } catch (err) {
    logger.error("[costo-final] GET", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { sesion, response } = await sesionDueno(request);
    if (response) return response;
    const d = await request.json().catch(() => null);
    const accion = d?.accion;
    const ot = String(d?.ot ?? "");
    if (!["calcular", "recalcular"].includes(accion)) return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
    if (!OT_VALIDA.test(ot)) return NextResponse.json({ error: "OT inválida" }, { status: 400 });
    const e = sesion.empresa_id;
    try {
      const p = await proyecto(e, ot);
      if (!p) return NextResponse.json({ error: "No encontré esa OT" }, { status: 404 });
      if (p.estado !== "cerrado") return NextResponse.json({ error: "El costo final se calcula cuando la OT está cerrada." }, { status: 409 });
      await calcularAMano(e, ot, { nombre: await nombreDe(sesion), recalcular: accion === "recalcular" });
      return NextResponse.json(await respuesta(e, ot, p));
    } catch (err) {
      const falta = faltaMigracion(err);
      if (falta) return NextResponse.json({ error: falta }, { status: 409 });
      throw err;
    }
  } catch (err) {
    logger.error("[costo-final] POST", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
