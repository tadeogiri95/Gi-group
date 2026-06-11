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

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const CAMPOS_PUBLICOS =
  "id,legajo,nombre,apodo,email,rol,area,division,diagrama,activo,debe_cambiar_password,estado_activacion,created_at";

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPost(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

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
  return NextResponse.json(rows || []);
}

// ═══ POST ═══
export async function POST(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (!["gerencial", "administrativo"].includes(sesion.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await request.json();
  const { legajo, nombre, email, area, division, rol } = body;

  if (!legajo || !nombre) {
    return NextResponse.json({ error: "legajo y nombre son requeridos" }, { status: 400 });
  }
  const legajoNum = parseInt(legajo, 10);
  if (isNaN(legajoNum) || legajoNum <= 0) {
    return NextResponse.json({ error: "legajo debe ser un número positivo" }, { status: 400 });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Formato de email inválido" }, { status: 400 });
  }

  // Verificar legajo único dentro de la empresa
  const existente = await sbGet(
    `empleados?empresa_id=eq.${sesion.empresa_id}&legajo=eq.${legajoNum}&select=id&limit=1`
  );
  if (existente?.length > 0) {
    return NextResponse.json({ error: `El legajo ${legajoNum} ya existe en esta empresa` }, { status: 409 });
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

  const rolesValidos = ["operativo", "gerencial", "administrativo"];
  const rolFinal = rolesValidos.includes(rol) ? rol : "operativo";
  const passwordHash = await bcrypt.hash(passwordInicial(), 10);

  const [nuevo] = await sbPost("empleados", {
    empresa_id: sesion.empresa_id,
    legajo: legajoNum,
    nombre: nombre.trim(),
    apodo: nombre.trim().split(" ")[0],
    email: email?.trim() || null,
    area: area?.trim() || "produccion",
    division: division?.trim() || null,
    rol: rolFinal,
    activo: true,
    password: passwordHash,
    debe_cambiar_password: true,
    estado_activacion: email ? "pendiente_activacion" : "activo",
  });

  logAudit({
    empresa_id: sesion.empresa_id,
    actor_id: sesion.empleado_id,
    actor_legajo: sesion.legajo,
    actor_rol: sesion.rol,
    accion: "crear_empleado",
    entidad: "empleado",
    entidad_id: String(nuevo.id),
    datos_despues: { legajo: legajoNum, nombre: nombre.trim(), rol: rolFinal },
    ip: request.headers.get("x-forwarded-for") || "unknown",
  });

  // Email de invitación (fire-and-forget, solo si tiene email)
  if (email && empresaData?.slug) {
    sendInvitacionEmpleado({
      to: email,
      nombre: nombre.trim().split(" ")[0],
      empresa: empresaData.nombre_corto || empresaData.nombre,
      slug: empresaData.slug,
      legajo: legajoNum,
    });
  }

  // Devolver sin password
  const { password: _, ...empleadoPublico } = nuevo;
  return NextResponse.json(empleadoPublico, { status: 201 });
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

  const [actualizado] = await sbPatch(
    `empleados?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}`,
    updates
  );

  const { password: _, ...empleadoPublico } = actualizado;
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
    ip: request.headers.get("x-forwarded-for") || "unknown",
  });

  return NextResponse.json({ ok: true });
}
