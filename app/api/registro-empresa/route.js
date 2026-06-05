// ═══════════════════════════════════════════════════════════
// app/api/registro-empresa/route.js
// Registra una nueva empresa y su usuario admin
//
// ENTREGA 1B: Password policy reforzada vía validarPassword
// de lib/auth.js (min 8, mayúscula, minúscula, número).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { validarPassword } from "../../lib/auth";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

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
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

export async function POST(req) {
  try {
    const { nombre_empresa, nombre_admin, email, password, rubro } = await req.json();

    if (!nombre_empresa || !nombre_admin || !email || !password) {
      return NextResponse.json({ error: "Completá todos los campos" }, { status: 400 });
    }

    // ═══ CAMBIO 1B: Usar validarPassword compartida ═══
    // (antes: solo chequeaba password.length < 6)
    const pwCheck = validarPassword(password);
    if (!pwCheck.valido) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    const existente = await sbFetch(`empresa?admin_email=eq.${encodeURIComponent(email)}&select=id`);
    if (existente && existente.length > 0) {
      return NextResponse.json({ error: "Ya existe una empresa con ese email" }, { status: 400 });
    }

    let slug = generarSlug(nombre_empresa);
    const slugCheck = await sbFetch(`empresa?slug=eq.${slug}&select=id`);
    if (slugCheck && slugCheck.length > 0) {
      slug = slug + "-" + Date.now().toString(36).slice(-4);
    }

    const hashed = await bcrypt.hash(password, 10);

    const empresa = await sbFetch("empresa", "POST", {
      nombre: nombre_empresa,
      nombre_corto: nombre_empresa.length > 12 ? nombre_empresa.slice(0, 12) : nombre_empresa,
      admin_email: email,
      admin_password: hashed,
      rubro: rubro || "general",
      slug,
      plan_activo: "free",
      trial_usado: false,
      max_empleados: 10,
      activa: true,
    });

    if (!empresa || empresa.length === 0 || empresa.code) {
      return NextResponse.json({ error: "Error al crear la empresa: " + (empresa.message || JSON.stringify(empresa)) }, { status: 500 });
    }

    const emp = empresa[0];

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
      await sbFetch(`empresa?id=eq.${emp.id}`, "DELETE");
      return NextResponse.json({ error: "Error al crear el usuario admin: " + (adminEmp.message || JSON.stringify(adminEmp)) }, { status: 500 });
    }

    try {
      await fetch(`${SB_URL}/rest/v1/rpc/iniciar_trial_pro`, {
        method: "POST",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_empresa_id: emp.id }),
      });
    } catch (e) {
      console.error("[registro] No se pudo iniciar trial:", e.message);
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
