// /api/unirse — Activación de empleado pre-cargado (público, sin auth)
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) return null;
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

export async function POST(request) {
  try {
    const { action, slug, legajo, password } = await request.json();

    if (!slug || !legajo) {
      return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
    }

    // Resolver empresa por slug
    const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const emp = await sbGet(`empresa?slug=eq.${encodeURIComponent(slugClean)}&select=id,nombre,nombre_corto,activa&limit=1`);
    if (!emp || emp.length === 0) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    if (emp[0].activa === false) return NextResponse.json({ error: "Empresa inactiva" }, { status: 403 });
    const empresaId = emp[0].id;

    // Buscar empleado pendiente con ese legajo
    const legajoNum = String(legajo).trim();
    const empleados = await sbGet(`empleados?empresa_id=eq.${empresaId}&legajo=eq.${encodeURIComponent(legajoNum)}&activo=eq.true&select=id,nombre,apodo,estado_activacion&limit=1`);
    if (!empleados || empleados.length === 0) {
      return NextResponse.json({ error: "Legajo no encontrado en esta empresa. Pedile a tu administrador que te dé de alta." }, { status: 404 });
    }
    const empleado = empleados[0];
    if (empleado.estado_activacion !== "pendiente_activacion") {
      return NextResponse.json({ error: "Esta cuenta ya está activada. Iniciá sesión normalmente." }, { status: 409 });
    }

    // ─── action: verificar ───
    if (action === "verificar") {
      return NextResponse.json({
        ok: true,
        nombre: empleado.nombre,
        apodo: empleado.apodo,
        empresaNombre: emp[0].nombre_corto || emp[0].nombre,
      });
    }

    // ─── action: activar ───
    if (action === "activar") {
      if (!password || password.length < 4) {
        return NextResponse.json({ error: "La contraseña debe tener al menos 4 caracteres" }, { status: 400 });
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}