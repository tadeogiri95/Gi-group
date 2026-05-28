// ═══════════════════════════════════════════════════════════
// /api/fichar/route.js — ETAPA 3: Fichaje server-side
//
// El frontend solo manda "quiero fichar ingreso/egreso" + geo
// TODA la lógica de validación corre en funciones SQL del servidor
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// ─── Validar sesión contra la DB ───
async function validarToken(token) {
  if (!token || token.length < 20) return null;
  const url = `${SUPABASE_URL}/rest/v1/rpc/validar_sesion`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.length > 0 ? data[0] : null;
}

// ─── Llamar función SQL ───
async function rpc(fnName, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`RPC ${fnName} error: ${err}`);
  }
  return res.json();
}

export async function POST(request) {
  try {
    // ─── Autenticación ───
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: "Token faltante" }, { status: 401 });
    }
    const sesion = await validarToken(token);
    if (!sesion) {
      return NextResponse.json({ error: "Sesión inválida o expirada" }, { status: 401 });
    }

    const { accion, geo_lat, geo_lng, geo_distancia, forzar_cierre_tarea } = await request.json();

    if (!accion || !["ingreso", "egreso"].includes(accion)) {
      return NextResponse.json({ error: "Acción inválida. Usar 'ingreso' o 'egreso'" }, { status: 400 });
    }

    let resultado;

    if (accion === "ingreso") {
      resultado = await rpc("fichar_ingreso", {
        p_empleado_id: sesion.empleado_id,
        p_legajo: String(sesion.legajo),
        p_empresa_id: sesion.empresa_id,
        p_geo_lat: geo_lat || null,
        p_geo_lng: geo_lng || null,
        p_geo_distancia: geo_distancia || null,
      });
    } else {
      resultado = await rpc("fichar_egreso", {
        p_empleado_id: sesion.empleado_id,
        p_legajo: String(sesion.legajo),
        p_empresa_id: sesion.empresa_id,
        p_forzar_cierre_tarea: forzar_cierre_tarea || false,
        p_geo_lat: geo_lat || null,
        p_geo_lng: geo_lng || null,
        p_geo_distancia: geo_distancia || null,
      });
    }

    return NextResponse.json(resultado);
  } catch (err) {
    console.error("[fichar] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
