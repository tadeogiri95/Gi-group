// app/lib/operacionesOffline.js — Idempotencia de lo que el celular manda al
// recuperar la conexión (F4-05, ítem 21). Cada operación trae un op_id: si ya
// se procesó, se devuelve la misma respuesta en vez de registrarla dos veces
// (p. ej. se cortó la señal después de que el servidor la guardó).
import { NextResponse } from "next/server";
import { sbGet, sbPost } from "./sbHelpers";
import { logger } from "./logger";

/**
 * Ejecuta `procesar()` una sola vez por op_id. Sin op_id (o sin la tabla de la
 * migración 079) se ejecuta siempre, como antes.
 * @param {{ empresa_id: string, empleado_id: string }} sesion
 * @param {string|undefined} opId
 * @param {string} tipo "fichar" | "actividad"
 * @param {() => Promise<Response>} procesar
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function unaSolaVez(sesion, opId, tipo, procesar) {
  // Un op_id mal formado no se usa en la consulta (lo rechaza la validación del body)
  if (!opId || !UUID.test(opId)) return procesar();
  const previa = await sbGet(
    `operaciones_offline?op_id=eq.${opId}&empresa_id=eq.${sesion.empresa_id}&select=resultado&limit=1`,
    { silent: true, fallback: null }
  );
  if (previa?.[0]) return NextResponse.json({ ...(previa[0].resultado || { ok: true }), duplicado: true });

  const res = await procesar();
  let cuerpo = null;
  try { cuerpo = await res.clone().json(); } catch { /* sin cuerpo JSON */ }
  // Solo se guarda lo que salió bien: un rechazo se puede reintentar
  if (res.ok && cuerpo?.ok) {
    try {
      await sbPost("operaciones_offline", {
        op_id: opId, empresa_id: sesion.empresa_id, empleado_id: sesion.empleado_id, tipo, resultado: cuerpo,
      }, { silent: true });
    } catch (e) {
      logger.warn?.("[operaciones_offline] no se pudo guardar", { op_id: opId, error: e?.message });
    }
  }
  return res;
}
