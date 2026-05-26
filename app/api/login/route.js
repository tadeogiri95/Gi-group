// app/api/login-empresa/route.js
// Login que identifica a qué empresa pertenece el usuario
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
    },
  });
  return res.json();
}

export async function POST(req) {
  try {
    const body = await req.json();

    // ─── Cambiar contraseña ───
    if (body.action === "cambiar_password") {
      const { userId, nuevaPassword } = body;
      const hashed = await bcrypt.hash(nuevaPassword, 10);
      const res = await fetch(`${SB_URL}/rest/v1/empleados?id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ password: hashed, debe_cambiar_password: false }),
      });
      const updated = await res.json();
      if (!updated || updated.length === 0) {
        return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
      }
      const u = updated[0];
      delete u.password;
      return NextResponse.json({ usuario: u });
    }

    // ─── Login normal ───
    const { legajo, password, empresa_id } = body;
    if (!legajo || !password) {
      return NextResponse.json({ error: "Ingresá legajo y contraseña" }, { status: 400 });
    }

    // Buscar empleado — si viene empresa_id, filtrar por empresa
    let query = `empleados?legajo=eq.${encodeURIComponent(legajo.trim())}&activo=eq.true&select=*`;
    if (empresa_id) {
      query += `&empresa_id=eq.${empresa_id}`;
    }
    const empleados = await sbGet(query);

    if (!empleados || empleados.length === 0) {
      return NextResponse.json({ error: "Legajo no encontrado" }, { status: 401 });
    }

    // Identificar la contraseña correcta (soporta texto plano antiguo y bcrypt nuevo)
    let usuario = null;
    for (const emp of empleados) {
      let match = false;
      
      // Los hashes de bcrypt siempre empiezan con $2a$, $2b$ o $2y$
      if (emp.password && emp.password.startsWith('$2')) {
        match = await bcrypt.compare(password, emp.password);
      } else {
        // Si no está encriptada aún en la base de datos, compara texto normal
        match = (password === emp.password);
      }

      if (match) {
        usuario = emp;
        break;
      }
    }

    if (!usuario) {
      return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
    }

    // Cargar datos de la empresa
    const empresaData = await sbGet(`empresa?id=eq.${usuario.empresa_id}&select=id,nombre,nombre_corto,slug,color_primario,color_secundario,logo_url,plan,max_empleados`);
    
    const safe = { ...usuario };
    delete safe.password;
    safe.empresa = empresaData?.[0] || null;

    return NextResponse.json({ usuario: safe });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}