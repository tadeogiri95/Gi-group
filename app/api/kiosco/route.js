// app/api/kiosco/route.js — Activar, consultar y desactivar el modo kiosco (D7, ítem 19).
//
// POST   (gerente o administrativo con sesión) → este dispositivo pasa a ser
//        un kiosco de la empresa: recibe la cookie gypi_kiosco.
// GET    → si este dispositivo es un kiosco, datos públicos de la empresa.
// DELETE → desactiva el kiosco de este dispositivo.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { signKioscoToken } from "../../lib/jwt";
import { validarKiosco, registrarKiosco, revocarKiosco, opcionesCookieKiosco } from "../../lib/kiosco";
import { sbGet } from "../../lib/sbHelpers";
import { kioscoActivarBody } from "../../lib/schemas";
import { validateBody } from "../../lib/validate";
import { logAudit } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { ipCliente } from "../../lib/ip";

const ROLES_GESTION = new Set(["gerencial", "administrativo"]);
const CAMPOS_EMPRESA = "nombre,nombre_corto,slug,logo_url,color_primario,color_secundario";

export async function POST(request) {
  const sesion = await validarToken(request);
  if (!sesion) return respuestaNoAutorizado();
  if (!ROLES_GESTION.has(sesion.rol) || sesion.imp) {
    return NextResponse.json({ error: "Solo gestión puede activar un kiosco" }, { status: 403 });
  }
  try {
    const parsed = validateBody(kioscoActivarBody, await request.json().catch(() => ({})));
    if (parsed.response) return parsed.response;
    const nombre = parsed.data.nombre || "Kiosco";
    const { token, jti } = await signKioscoToken({ empresaId: sesion.empresa_id, activadoPor: sesion.empleado_id });
    const ip = ipCliente(request);
    await registrarKiosco({ jti, gerente: sesion, nombre, ip, userAgent: request.headers.get("user-agent")?.slice(0, 150) });
    logAudit({
      empresa_id: sesion.empresa_id,
      actor_id: sesion.empleado_id,
      actor_legajo: sesion.legajo,
      actor_rol: sesion.rol,
      accion: "kiosco_activado",
      entidad: "kiosco",
      datos_despues: { nombre },
      ip,
    });
    const res = NextResponse.json({ ok: true });
    res.cookies.set({ ...opcionesCookieKiosco(), value: token });
    return res;
  } catch (e) {
    logger.error("kiosco: error al activar", e);
    return NextResponse.json({ error: "No se pudo activar el kiosco. Intentá de nuevo." }, { status: 500 });
  }
}

export async function GET(request) {
  const kiosco = await validarKiosco(request);
  if (!kiosco) return NextResponse.json({ activo: false }, { headers: { "Cache-Control": "no-store" } });
  const empresas = await sbGet(`empresa?id=eq.${kiosco.empresa_id}&select=${CAMPOS_EMPRESA}&limit=1`, { silent: true });
  return NextResponse.json({ activo: true, empresa: empresas?.[0] || null }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request) {
  const kiosco = await validarKiosco(request);
  if (kiosco) await revocarKiosco(kiosco.jti).catch((e) => logger.error("kiosco: error al desactivar", e));
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ ...opcionesCookieKiosco(0), value: "" });
  return res;
}
