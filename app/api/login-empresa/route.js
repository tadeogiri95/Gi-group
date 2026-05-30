// ═══════════════════════════════════════════════════════════
// /api/login-empresa/route.js — VERSIÓN SEGURA
//
// CAMBIOS DE SEGURIDAD:
// 1. NUNCA compara contraseñas en texto plano. Si una contraseña
//    guardada no está hasheada (no empieza con $2), se rechaza el
//    login y se obliga a resetearla. Esto evita el agujero anterior.
// 2. La nueva contraseña al cambiarla exige un mínimo de seguridad.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  return res.json();
}

async function sbRpc(fnName, params) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function POST(req) {
  try {
    if (!SB_URL || !SB_KEY) {
      return NextResponse.json({ error: "Servidor mal configurado" }, { status: 500 });
    }

    const body = await req.json();

    // ─── Cambiar contraseña ───
    if (body.action === "cambiar_password") {
      const { userId, nuevaPassword, token } = body;
      if (!token) {
        return NextResponse.json({ error: "Token requerido" }, { status: 401 });
      }
      if (!nuevaPassword || nuevaPassword.length < 6) {
        return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
      }

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

    let query = `empleados?legajo=eq.${encodeURIComponent(legajo.trim())}&activo=eq.true&select=*`;
    if (empresa_id) query += `&empresa_id=eq.${empresa_id}`;
    const empleados = await sbGet(query);

    if (!empleados || empleados.length === 0) {
      return NextResponse.json({ error: "Legajo no encontrado" }, { status: 401 });
    }

    let usuario = null;
    let necesitaReset = false;

    for (const emp of empleados) {
      if (emp.password && emp.password.startsWith("$2")) {
        // Contraseña hasheada → comparación segura
        const match = await bcrypt.compare(password, emp.password);
        if (match) { usuario = emp; break; }
      } else {
        // Contraseña NO hasheada en la DB → NO comparamos en texto plano.
        // Marcamos que ese legajo necesita resetear su clave.
        necesitaReset = true;
      }
    }

    if (!usuario) {
      if (necesitaReset) {
        return NextResponse.json(
          { error: "Tu cuenta necesita restablecer la contraseña. Contactá a gerencia." },
          { status: 401 }
        );
      }
      return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
    }

    // ─── Crear sesión con token ───
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";

    const sesionData = await sbRpc("crear_sesion", {
      p_empleado_id: usuario.id,
      p_empresa_id: usuario.empresa_id,
      p_ip: ip,
      p_user_agent: userAgent.substring(0, 200),
    });
    const tokenInfo = Array.isArray(sesionData) ? sesionData[0] : sesionData;

    const empresaData = await sbGet(
      `empresa?id=eq.${usuario.empresa_id}&select=id,nombre,nombre_corto,slug,color_primario,color_secundario,logo_url,plan,max_empleados`
    );

    const safe = { ...usuario };
    delete safe.password;
    safe.empresa = empresaData?.[0] || null;

    return NextResponse.json({
      usuario: safe,
      token: tokenInfo?.out_token || null,
      expires_at: tokenInfo?.out_expires_at || null,
    });
  } catch (err) {
    console.error("[login] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
