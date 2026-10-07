// app/api/me/route.js — Quién soy (F1-03).
//
// La app instalada perdía la sesión al cerrarse: el usuario vivía en
// sessionStorage aunque las cookies de sesión duran 30 días. Al abrir la app,
// AuthContext pide este endpoint (autenticado por la cookie httpOnly) y
// restaura el usuario sin volver a pedir la contraseña. Devuelve lo mismo que
// el login.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { sbGet } from "../../lib/sbHelpers";
import { logger } from "../../lib/logger";
import { usuarioSeguro } from "../../lib/usuarioSeguro";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const sesion = await validarToken(request);
  if (!sesion) return respuestaNoAutorizado();
  try {
    const [empleados, empresas] = await Promise.all([
      sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&activo=eq.true&select=*&limit=1`),
      sbGet(`empresa?id=eq.${sesion.empresa_id}&select=id,nombre,nombre_corto,slug,color_primario,color_secundario,logo_url,plan_activo,max_empleados&limit=1`),
    ]);
    const emp = empleados?.[0];
    if (!emp) return respuestaNoAutorizado("Usuario inactivo. Contactá a tu administrador.");
    const usuario = usuarioSeguro(emp);
    usuario.empresa = empresas?.[0] || null;
    return NextResponse.json({ usuario }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    logger.error("me: error", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
