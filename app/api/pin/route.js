// app/api/pin/route.js — El operario crea, cambia o borra su PIN (F4-06, D7).
//
// POST   { pin }  → crea o reemplaza el PIN (4 números, ni repetidos ni escaleras)
// DELETE          → borra el PIN (vuelve a entrar solo con contraseña)
//
// Siempre sobre el propio empleado de la sesión; solo operarios.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { sbPatch } from "../../lib/sbHelpers";
import { crearPinBody } from "../../lib/schemas";
import { validateBody } from "../../lib/validate";
import { problemaPin } from "../../lib/pin";
import { logAudit } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { ipCliente } from "../../lib/ip";

async function sesionOperario(request) {
  const sesion = await validarToken(request);
  if (!sesion) return { response: respuestaNoAutorizado() };
  if (sesion.imp) return { response: NextResponse.json({ error: "No disponible en modo soporte" }, { status: 403 }) };
  if (sesion.rol !== "operativo") {
    return { response: NextResponse.json({ error: "El PIN es solo para operarios; gestión entra con contraseña" }, { status: 403 }) };
  }
  return { sesion };
}

async function guardar(sesion, request, cambios, accion) {
  const filas = await sbPatch(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}`, cambios);
  if (!filas?.length) return NextResponse.json({ error: "No se pudo guardar. Intentá de nuevo." }, { status: 500 });
  logAudit({
    empresa_id: sesion.empresa_id,
    actor_id: sesion.empleado_id,
    actor_legajo: sesion.legajo,
    actor_rol: sesion.rol,
    accion,
    entidad: "empleado",
    entidad_id: String(sesion.empleado_id),
    ip: ipCliente(request),
  });
  return NextResponse.json({ ok: true, tiene_pin: !!cambios.pin_hash });
}

export async function POST(request) {
  const { sesion, response } = await sesionOperario(request);
  if (response) return response;
  try {
    const parsed = validateBody(crearPinBody, await request.json().catch(() => ({})));
    if (parsed.response) return parsed.response;
    const problema = problemaPin(parsed.data.pin);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });
    const pin_hash = await bcrypt.hash(parsed.data.pin, 10);
    return await guardar(sesion, request, { pin_hash, pin_intentos: 0, pin_bloqueado_hasta: null }, "pin_creado");
  } catch (e) {
    logger.error("pin: error al guardar", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { sesion, response } = await sesionOperario(request);
  if (response) return response;
  try {
    return await guardar(sesion, request, { pin_hash: null, pin_intentos: 0, pin_bloqueado_hasta: null }, "pin_borrado");
  } catch (e) {
    logger.error("pin: error al borrar", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
