// /api/billing/perfil-fiscal — Datos fiscales de la empresa para la Factura C
// (F6-02, F6-11, D15, ítem 26). Solo el dueño de la cuenta.
//   GET → { razon_social, cuit, condicion_iva, domicilio_fiscal, completo }
//   PUT { razon_social, cuit, condicion_iva, domicilio_fiscal } → guarda
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { sbGet, sbPatchOk } from "../../../lib/sbHelpers";
import { validarPerfilFiscal, perfilCompleto } from "../../../lib/perfilFiscal";
import { logAudit } from "../../../lib/audit";

const CAMPOS = "razon_social,cuit,condicion_iva,domicilio_fiscal";

async function sesionDueno(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { error: respuestaNoAutorizado() };
  if (sesion.rol !== "gerencial") {
    return { error: NextResponse.json({ error: "Solo el dueño de la cuenta ve y cambia los datos de facturación" }, { status: 403 }) };
  }
  return { sesion };
}

export async function GET(request) {
  const { sesion, error } = await sesionDueno(request);
  if (error) return error;
  const filas = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=${CAMPOS}&limit=1`, { silent: true, fallback: null });
  if (!Array.isArray(filas)) return NextResponse.json({ error: "Falta actualizar la base (migración 081)." }, { status: 503 });
  const p = filas[0] || {};
  return NextResponse.json({ ...p, completo: perfilCompleto(p) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request) {
  const { sesion, error } = await sesionDueno(request);
  if (error) return error;
  const body = await request.json().catch(() => null);
  const v = validarPerfilFiscal(body || {});
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const ok = await sbPatchOk(`empresa?id=eq.${sesion.empresa_id}`, v.perfil);
  if (!ok) return NextResponse.json({ error: "No se pudieron guardar los datos. Probá de nuevo." }, { status: 500 });
  logAudit({
    empresa_id: sesion.empresa_id, actor_id: sesion.empleado_id, actor_legajo: sesion.legajo, actor_rol: sesion.rol,
    accion: "perfil_fiscal", entidad: "empresa", entidad_id: sesion.empresa_id, datos_despues: { cuit: v.perfil.cuit, condicion_iva: v.perfil.condicion_iva },
  });
  return NextResponse.json({ ok: true, ...v.perfil, completo: true });
}
