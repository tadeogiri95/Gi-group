// GET  /api/empleados        — listar empleados activos de la empresa (sin campos sensibles)
// POST /api/empleados        — crear empleado + validar legajo único + email de invitación
// PATCH /api/empleados?id=X  — actualizar empleado (rol solo para gerencial)
// DELETE /api/empleados?id=X — soft delete (activo=false)
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { passwordInicial } from "../../lib/passwords";
import { PLANES } from "../../lib/plans";
import { sendInvitacionEmpleado } from "../../lib/email";
import { logAudit } from "../../lib/audit";
import { sbGet, sbPost, sbPatch } from "../../lib/sbHelpers";
import { isUUID } from "../../lib/validate";
import { logEvent, EVT } from "../../lib/analytics";
import { nuevaActivacion, linkActivacion, DIAS_VIGENCIA } from "../../lib/activacion";

import { ipCliente } from "../../lib/ip";
const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";

const CAMPOS_PUBLICOS =
  "id,legajo,nombre,apodo,email,rol,area,division,diagrama,activo,debe_cambiar_password,estado_activacion,created_at";

// ═══ GET ═══
export async function GET(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();

  const { searchParams } = new URL(request.url);
  const soloActivos = searchParams.get("activo") !== "false";
  const filtroActivo = soloActivos ? "&activo=eq.true" : "";

  const rows = await sbGet(
    `empleados?empresa_id=eq.${sesion.empresa_id}${filtroActivo}&select=${CAMPOS_PUBLICOS}&order=legajo.asc`
  );
  return NextResponse.json(rows || [], {
    headers: { "Cache-Control": "private, no-store" },
  });
}

// ═══ POST ═══
export async function POST(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (!["gerencial", "administrativo"].includes(sesion.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await request.json();
  const { legajo, nombre, email, area, division, rol, apodo, pre_cargado } = body;

  if (!legajo || !nombre) {
    return NextResponse.json({ error: "legajo y nombre son requeridos" }, { status: 400 });
  }
  const legajoNum = parseInt(legajo, 10);
  if (isNaN(legajoNum) || legajoNum <= 0) {
    return NextResponse.json({ error: "legajo debe ser un número positivo" }, { status: 400 });
  }
  const emailNorm = typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
  if (emailNorm && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    return NextResponse.json({ error: "Formato de email inválido" }, { status: 400 });
  }

  // Verificar legajo único dentro de la empresa
  const existente = await sbGet(
    `empleados?empresa_id=eq.${sesion.empresa_id}&legajo=eq.${legajoNum}&select=id&limit=1`
  );
  if (existente?.length > 0) {
    return NextResponse.json({ error: `El legajo ${legajoNum} ya existe en esta empresa` }, { status: 409 });
  }

  // Email único dentro de la empresa (no global: la misma persona puede
  // trabajar en dos empresas). Se guarda en minúsculas, igual que lo busca el login.
  if (emailNorm) {
    const conEmail = await sbGet(
      `empleados?empresa_id=eq.${sesion.empresa_id}&email=eq.${encodeURIComponent(emailNorm)}&select=id&limit=1`
    );
    if (conEmail?.length > 0) {
      return NextResponse.json({ error: "Ya hay un empleado con ese email en esta empresa" }, { status: 409 });
    }
  }

  // Verificar límite de plan
  const [empresaData] = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=plan_activo,slug,nombre,nombre_corto`);
  const plan = empresaData?.plan_activo || "free";
  const maxEmpleados = (PLANES[plan] ?? PLANES.free).max_empleados;
  const actuales = await sbGet(
    `empleados?empresa_id=eq.${sesion.empresa_id}&activo=eq.true&select=id`
  );
  if ((actuales?.length ?? 0) >= maxEmpleados) {
    return NextResponse.json({
      error: `Tu plan permite hasta ${maxEmpleados} empleados activos. Actualizá el plan para agregar más.`,
      upgrade: true,
    }, { status: 403 });
  }

  let rolesValidos = ["operativo", "gerencial", "administrativo"];
  if (sesion.rol === "administrativo") rolesValidos = ["operativo", "administrativo"];
  const rolFinal = rolesValidos.includes(rol) ? rol : "operativo";
  const passwordHash = await bcrypt.hash(passwordInicial(), 10);

  // Todo empleado nuevo nace pendiente: activa su cuenta y define su
  // contraseña con un código de un solo uso (ver lib/activacion.js).
  const activacion = nuevaActivacion();
  let nuevo;
  try {
    [nuevo] = await sbPost("empleados", {
      empresa_id: sesion.empresa_id,
      legajo: legajoNum,
      nombre: nombre.trim(),
      apodo: (typeof apodo === "string" && apodo.trim()) || nombre.trim().split(" ")[0],
      email: emailNorm,
      area: area?.trim() || "produccion",
      division: division?.trim() || null,
      rol: rolFinal,
      activo: true,
      password: passwordHash,
      debe_cambiar_password: true,
      pre_cargado: !!pre_cargado,
      estado_activacion: "pendiente_activacion",
      ...activacion.columnas,
    });
  } catch (e) {
    // Carrera entre el chequeo y el insert: el índice único lo frena.
    if (String(e?.message).includes("23505")) {
      return NextResponse.json({ error: "Ya existe un empleado con ese legajo o email en esta empresa" }, { status: 409 });
    }
    throw e;
  }

  logAudit({
    empresa_id: sesion.empresa_id,
    actor_id: sesion.empleado_id,
    actor_legajo: sesion.legajo,
    actor_rol: sesion.rol,
    accion: "crear_empleado",
    entidad: "empleado",
    entidad_id: String(nuevo.id),
    datos_despues: { legajo: legajoNum, nombre: nombre.trim(), rol: rolFinal },
    ip: ipCliente(request),
  });

  // Email de invitación (fire-and-forget, solo si tiene email)
  const link = empresaData?.slug ? linkActivacion(APP_BASE, empresaData.slug, activacion.codigo) : null;
  if (emailNorm && link) {
    sendInvitacionEmpleado({
      to: emailNorm,
      nombre: nombre.trim().split(" ")[0],
      empresa: empresaData.nombre_corto || empresaData.nombre,
      codigo: activacion.codigo,
      link,
      empresaId: sesion.empresa_id,
    });

    // Analytics: detectar la primera vez que la empresa invita a un compañero
    // (excluye al admin con legajo 1, que ya tiene email desde el registro)
    sbGet(`empleados?empresa_id=eq.${sesion.empresa_id}&email=not.is.null&legajo=neq.1&select=id&limit=2`)
      .then((rows) => {
        const esPrimero = Array.isArray(rows) && rows.length <= 1;
        if (esPrimero) {
          logEvent(EVT.PRIMER_INVITE, { empresa_id: sesion.empresa_id, empleado_id: sesion.empleado_id, plan });
        }
      })
      .catch(() => {});
  }

  // Devolver sin password ni hash; el código en texto plano se muestra una sola vez
  const { password: _, activacion_codigo_hash: _h, ...empleadoPublico } = nuevo;
  return NextResponse.json(
    { ...empleadoPublico, activacion: { codigo: activacion.codigo, link, vigencia_dias: DIAS_VIGENCIA } },
    { status: 201 }
  );
}

// ═══ PATCH ═══
export async function PATCH(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (!["gerencial", "administrativo"].includes(sesion.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  if (!isUUID(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  // Verificar que el empleado pertenece a la empresa
  const check = await sbGet(
    `empleados?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=id&limit=1`
  );
  if (!check?.length) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  const body = await request.json();

  // Campos permitidos — rol solo si es gerencial
  const CAMPOS_EDITABLES = ["nombre", "apodo", "email", "area", "division", "diagrama", "activo"];
  if (sesion.rol === "gerencial") CAMPOS_EDITABLES.push("rol");

  const updates = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (body[campo] !== undefined) updates[campo] = body[campo];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Sin campos válidos para actualizar" }, { status: 400 });
  }

  if (typeof updates.email === "string") {
    updates.email = updates.email.trim().toLowerCase() || null;
  }

  let actualizado;
  try {
    [actualizado] = await sbPatch(
      `empleados?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}`,
      updates
    );
  } catch (e) {
    if (String(e?.message).includes("23505")) {
      return NextResponse.json({ error: "Ya hay un empleado con ese email en esta empresa" }, { status: 409 });
    }
    throw e;
  }

  const { password: _, activacion_codigo_hash: _h, ...empleadoPublico } = actualizado;
  return NextResponse.json(empleadoPublico);
}

// ═══ DELETE ═══
export async function DELETE(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (!["gerencial", "administrativo"].includes(sesion.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  if (!isUUID(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  if (id === sesion.empleado_id) {
    return NextResponse.json({ error: "No podés desactivar tu propio perfil" }, { status: 400 });
  }

  const check = await sbGet(
    `empleados?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=id,legajo,nombre&limit=1`
  );
  if (!check?.length) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  await sbPatch(`empleados?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}`, { activo: false });

  logAudit({
    empresa_id: sesion.empresa_id,
    actor_id: sesion.empleado_id,
    actor_legajo: sesion.legajo,
    actor_rol: sesion.rol,
    accion: "desactivar_empleado",
    entidad: "empleado",
    entidad_id: String(id),
    datos_antes: { legajo: check[0].legajo, nombre: check[0].nombre },
    ip: ipCliente(request),
  });

  return NextResponse.json({ ok: true });
}
