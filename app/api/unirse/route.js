// ═══════════════════════════════════════════════════════════
// /api/unirse — Activación de empleado pre-cargado (público)
//
// ENTREGA 1C: Este endpoint es público por diseño (el empleado
// aún no tiene sesión). El mecanismo de "auth" es:
//   slug + legajo + estado_activacion === "pendiente_activacion"
// Solo puede activar cuentas que el admin pre-cargó.
//
// CAMBIO: password policy reforzada (min 8 chars, complejidad).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { validarPassword } from "../../lib/validators";
import { sbGet, sbPatch } from "../../lib/sbHelpers";
import { unirseBody } from "../../lib/schemas";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { checkRateLimit } from "../../lib/rateLimitMemory";

export async function POST(request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
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
    const { action, slug, legajo, password } = parsed.data;

    const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const emp = await sbGet(`empresa?slug=eq.${encodeURIComponent(slugClean)}&select=id,nombre,nombre_corto,activa&limit=1`, { silent: true });
    if (!emp || emp.length === 0) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    if (emp[0].activa === false) return NextResponse.json({ error: "Empresa inactiva" }, { status: 403 });
    const empresaId = emp[0].id;

    const legajoNum = String(legajo).trim();
    const empleados = await sbGet(`empleados?empresa_id=eq.${empresaId}&legajo=eq.${encodeURIComponent(legajoNum)}&activo=eq.true&select=id,nombre,apodo,estado_activacion&limit=1`, { silent: true });
    if (!empleados || empleados.length === 0) {
      return NextResponse.json({ error: "Legajo no encontrado en esta empresa. Pedile a tu administrador que te dé de alta." }, { status: 404 });
    }
    const empleado = empleados[0];
    if (empleado.estado_activacion !== "pendiente_activacion") {
      return NextResponse.json({ error: "Esta cuenta ya está activada. Iniciá sesión normalmente." }, { status: 409 });
    }

    if (action === "verificar") {
      return NextResponse.json({
        ok: true,
        nombre: empleado.nombre,
        apodo: empleado.apodo,
        empresaNombre: emp[0].nombre_corto || emp[0].nombre,
      });
    }

    if (action === "activar") {
      // ═══ CAMBIO 1C/1B: Password policy reforzada ═══
      const pwCheck = validarPassword(password);
      if (!pwCheck.valido) {
        return NextResponse.json({ error: pwCheck.error }, { status: 400 });
      }

      const hashed = await bcrypt.hash(password, 10);
      await sbPatch(`empleados?id=eq.${empleado.id}`, {
        password: hashed,
        estado_activacion: "activo",
        debe_cambiar_password: false,
      });
      return NextResponse.json({
        ok: true,
        nombre: empleado.nombre,
        empresaNombre: emp[0].nombre_corto || emp[0].nombre,
      });
    }

    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
