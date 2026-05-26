// app/api/registro-empresa/route.js
// Registra una nueva empresa y su usuario admin
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function sbFetch(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : undefined,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, opts);
  return res.json();
}

function generarSlug(nombre) {
  return nombre
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

export async function POST(req) {
  try {
    const { nombre_empresa, nombre_admin, email, password, rubro } = await req.json();

    // Validaciones
    if (!nombre_empresa || !nombre_admin || !email || !password) {
      return NextResponse.json({ error: "Completá todos los campos" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
    }

    // Verificar email no repetido
    const existente = await sbFetch(`empresa?admin_email=eq.${encodeURIComponent(email)}&select=id`);
    if (existente && existente.length > 0) {
      return NextResponse.json({ error: "Ya existe una empresa con ese email" }, { status: 400 });
    }

    // Generar slug único
    let slug = generarSlug(nombre_empresa);
    const slugCheck = await sbFetch(`empresa?slug=eq.${slug}&select=id`);
    if (slugCheck && slugCheck.length > 0) {
      slug = slug + "-" + Date.now().toString(36).slice(-4);
    }

    // Hash de contraseña
    const hashed = await bcrypt.hash(password, 10);

    // Crear empresa
    const empresa = await sbFetch("empresa", "POST", {
      nombre: nombre_empresa,
      nombre_corto: nombre_empresa.length > 12 ? nombre_empresa.slice(0, 12) : nombre_empresa,
      admin_email: email,
      admin_password: hashed,
      rubro: rubro || "general",
      slug,
      plan: "free",
      max_empleados: 10,
      activa: true,
    });

    if (!empresa || empresa.length === 0 || empresa.code) {
      return NextResponse.json({ error: "Error al crear la empresa: " + (empresa.message || JSON.stringify(empresa)) }, { status: 500 });
    }

    const emp = empresa[0];

    // Crear empleado admin
    const adminEmp = await sbFetch("empleados", "POST", {
      nombre: nombre_admin,
      apodo: nombre_admin.split(" ")[0],
      legajo: "1",
      email,
      password: hashed,
      rol: "gerencial",
      area: "administración",
      division: "general",
      activo: true,
      empresa_id: emp.id,
      debe_cambiar_password: false,
    });

    if (!adminEmp || adminEmp.length === 0 || adminEmp.code) {
      // Si falla el empleado, borrar la empresa creada
      await sbFetch(`empresa?id=eq.${emp.id}`, "DELETE");
      return NextResponse.json({ error: "Error al crear el usuario admin: " + (adminEmp.message || JSON.stringify(adminEmp)) }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      empresa: { id: emp.id, nombre: emp.nombre, slug: emp.slug },
      usuario: adminEmp[0],
    });

  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
