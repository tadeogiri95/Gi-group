// ═══════════════════════════════════════════════════════════
// /api/unirse — Activación de cuenta con código de un solo uso (público)
//
// El empleado llega desde el link o QR que le entregó su empresa
// (/{slug}/unirse?code=XXXX-XXXX) y define su contraseña. La identidad la
// prueba el código, no el legajo: antes bastaba con slug + legajo y
// cualquiera podía adelantarse y quedarse con la cuenta (auditoría F2-03).
//
// - "verificar": confirma que el código existe y no venció; devuelve el nombre.
// - "activar":  define la contraseña, borra el código (un solo uso) y cierra
//               las sesiones abiertas de esa cuenta. Los operarios pueden
//               elegir un PIN de 4 números en lugar de la contraseña
//               (reforma UX R6): con legajo y PIN entran y fichan en el kiosco.
// Ver app/lib/activacion.js.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { validarPassword } from "../../lib/validators";
import { sbGet, sbPatch } from "../../lib/sbHelpers";
import { unirseBody } from "../../lib/schemas";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { checkRateLimit } from "../../lib/rateLimitMemory";
import { hashCodigo, normalizarCodigo } from "../../lib/activacion";
import { logAudit } from "../../lib/audit";
import { problemaPin } from "../../lib/pin";

import { ipCliente } from "../../lib/ip";
const CODIGO_INVALIDO = "El código no es válido o ya venció. Pedile uno nuevo a tu empresa.";

export async function POST(request) {
  try {
    const ip = ipCliente(request);
    const rl = checkRateLimit(`unirse:${ip}`, 20, 60_000);
    if (rl.limited) {
      return NextResponse.json(
        { error: "Demasiados intentos. Esperá un momento." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } }
      );
    }

    const rawBody = await request.json();
    const parsed = validateBody(unirseBody, rawBody);
    if (parsed.response) return parsed.response;
    const { action, slug, codigo, password, pin } = parsed.data;

    if (normalizarCodigo(codigo).length !== 8) {
      return NextResponse.json({ error: CODIGO_INVALIDO }, { status: 404 });
    }

    const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const emp = await sbGet(`empresa?slug=eq.${encodeURIComponent(slugClean)}&select=id,nombre,nombre_corto,activa&limit=1`, { silent: true });
    if (!emp || emp.length === 0) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    if (emp[0].activa === false) return NextResponse.json({ error: "Empresa inactiva" }, { status: 403 });
    const empresaId = emp[0].id;
    const empresaNombre = emp[0].nombre_corto || emp[0].nombre;

    const hash = hashCodigo(codigo);
    const empleados = await sbGet(
      `empleados?empresa_id=eq.${empresaId}&activacion_codigo_hash=eq.${hash}&activo=eq.true&select=id,nombre,apodo,legajo,rol,activacion_expira&limit=1`,
      { silent: true }
    );
    const empleado = empleados?.[0];
    if (!empleado || !empleado.activacion_expira || new Date(empleado.activacion_expira) < new Date()) {
      return NextResponse.json({ error: CODIGO_INVALIDO }, { status: 404 });
    }

    if (action === "verificar") {
      // rol: la pantalla ofrece PIN a los operarios y contraseña a gestión
      return NextResponse.json({ ok: true, nombre: empleado.nombre, apodo: empleado.apodo, legajo: empleado.legajo, rol: empleado.rol, empresaNombre });
    }

    // ─── activar: con PIN (operarios) o con contraseña ───
    let credencial;
    if (pin !== undefined) {
      if (empleado.rol !== "operativo") {
        return NextResponse.json({ error: "Tu cuenta entra con contraseña. Creá una para continuar." }, { status: 400 });
      }
      const problema = problemaPin(pin);
      if (problema) return NextResponse.json({ error: problema }, { status: 400 });
      credencial = { pin_hash: await bcrypt.hash(pin, 10), pin_intentos: 0, pin_bloqueado_hasta: null };
    } else {
      const pwCheck = validarPassword(password);
      if (!pwCheck.valido) {
        return NextResponse.json({ error: pwCheck.error }, { status: 400 });
      }
      credencial = { password: await bcrypt.hash(password, 10) };
    }

    // Filtrar también por el hash hace el uso único atómico: si dos pedidos
    // llegan a la vez con el mismo código, solo uno actualiza la fila.
    const actualizado = await sbPatch(
      `empleados?id=eq.${empleado.id}&empresa_id=eq.${empresaId}&activacion_codigo_hash=eq.${hash}`,
      {
        ...credencial,
        estado_activacion: "activo",
        debe_cambiar_password: false,
        password_reset_jti: null,
        activacion_codigo_hash: null,
        activacion_expira: null,
      }
    );
    if (!Array.isArray(actualizado) || actualizado.length === 0) {
      return NextResponse.json({ error: CODIGO_INVALIDO }, { status: 404 });
    }

    // Una cuenta que se (re)activa no conserva sesiones abiertas de antes.
    await sbPatch(`sesiones?empleado_id=eq.${empleado.id}&revocada=eq.false`, { revocada: true }, { silent: true });

    logAudit({
      empresa_id: empresaId,
      actor_id: empleado.id,
      actor_legajo: empleado.legajo,
      actor_rol: empleado.rol,
      accion: pin !== undefined ? "activar_cuenta_pin" : "activar_cuenta",
      entidad: "empleado",
      entidad_id: String(empleado.id),
      ip,
    });

    return NextResponse.json({ ok: true, nombre: empleado.nombre, legajo: empleado.legajo, con_pin: pin !== undefined, empresaNombre });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
