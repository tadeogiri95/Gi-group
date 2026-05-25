import { NextResponse } from "next/server";

// ─── Supabase server-side (usa env vars, no keys hardcodeadas) ───
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getKey() {
  return SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
}

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: getKey(),
      Authorization: `Bearer ${getKey()}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

async function supabasePatch(path, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: getKey(),
      Authorization: `Bearer ${getKey()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// ─── POST /api/login ───
export async function POST(request) {
  try {
    const { legajo, password, action, nuevaPassword, userId } = await request.json();

    // ═══ CAMBIO DE CONTRASEÑA ═══
    if (action === "cambiar_password") {
      if (!nuevaPassword || !userId) {
        return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
      }
      if (nuevaPassword.length < 4) {
        return NextResponse.json({ error: "Mínimo 4 caracteres" }, { status: 400 });
      }

      const updated = await supabasePatch(`empleados?id=eq.${userId}`, {
        password: nuevaPassword,
        debe_cambiar_password: false,
      });

      if (!updated || !updated.length) {
        return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
      }

      const { password: _, ...safe } = updated[0];
      return NextResponse.json({ ok: true, usuario: safe });
    }

    // ═══ LOGIN ═══
    if (!legajo || !password) {
      return NextResponse.json({ error: "Faltan credenciales" }, { status: 400 });
    }

    const empleados = await supabaseGet(
      `empleados?legajo=eq.${encodeURIComponent(legajo.trim())}&select=*`
    );

    if (!empleados || !empleados.length) {
      return NextResponse.json({ error: "Legajo no encontrado" }, { status: 401 });
    }

    const emp = empleados[0];

    if (emp.password !== password) {
      return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
    }

    const { password: _, ...usuarioSeguro } = emp;
    return NextResponse.json({ ok: true, usuario: usuarioSeguro });
  } catch (err) {
    console.error("[login] Error:", err);
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}
