// POST /api/empleados/pin — Administración le da un PIN nuevo a un operario
// (reforma UX R6). Body: { empleado_id }
//
// Para el operario sin celular o que no puede crear una contraseña: con su
// legajo y este PIN ficha en el kiosco desde el primer día, o entra desde
// cualquier celular. También sirve si se olvidó el PIN o se le bloqueó.
// El PIN lo genera el servidor (4 números, sin repetidos ni escaleras), se
// muestra una sola vez y se guarda solo el hash. El PIN anterior deja de servir.
//
// Permisos: gestión, solo para operarios activos de la empresa; el supervisor
// de división, solo para los de su división.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { sbGet, sbPatch } from "../../../lib/sbHelpers";
import { isUUID } from "../../../lib/validate";
import { logAudit } from "../../../lib/audit";
import { pinAleatorio } from "../../../lib/pinServidor";
import { alcanceDe, dentroDelAlcance, respuestaFueraDeAlcance } from "../../../lib/alcance";
import { ipCliente } from "../../../lib/ip";

export async function POST(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (!["gerencial", "administrativo"].includes(sesion.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (sesion.imp) return NextResponse.json({ error: "No disponible en modo soporte" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const id = body?.empleado_id;
  if (!id || !isUUID(id)) return NextResponse.json({ error: "empleado_id inválido" }, { status: 400 });

  const [empleado] = await sbGet(
    `empleados?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&activo=eq.true&select=id,legajo,nombre,rol&limit=1`
  ) || [];
  if (!empleado) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  if (!dentroDelAlcance(await alcanceDe(sesion), { id: empleado.id })) return respuestaFueraDeAlcance();
  if (empleado.rol !== "operativo") {
    return NextResponse.json({ error: "El PIN es solo para operarios; gestión entra con contraseña." }, { status: 400 });
  }

  const pin = pinAleatorio();
  const filas = await sbPatch(`empleados?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}`, {
    pin_hash: await bcrypt.hash(pin, 10),
    pin_intentos: 0,
    pin_bloqueado_hasta: null,
    // Con el PIN ya puede entrar: la cuenta queda activa y sin pedirle contraseña
    estado_activacion: "activo",
    debe_cambiar_password: false,
    activacion_codigo_hash: null,
    activacion_expira: null,
  });
  if (!filas?.length) return NextResponse.json({ error: "No se pudo guardar. Probá de nuevo." }, { status: 500 });

  logAudit({
    empresa_id: sesion.empresa_id,
    actor_id: sesion.empleado_id,
    actor_legajo: sesion.legajo,
    actor_rol: sesion.rol,
    accion: "pin_asignado",
    entidad: "empleado",
    entidad_id: String(id),
    datos_despues: { legajo: empleado.legajo },
    ip: ipCliente(request),
  });

  return NextResponse.json(
    { ok: true, pin, nombre: empleado.nombre, legajo: empleado.legajo },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
