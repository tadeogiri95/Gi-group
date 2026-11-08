// /api/horas-ot — Horas-persona presupuestadas contra reales de una OT
// (costo de OT, parte E; migración 166; app/lib/horasOt.js).
//
//   GET  ?ot=M-7471 → tabla por proceso y total, con cada número automático
//        o a mano.
//   POST { ot, etapa, campo: "presupuestadas"|"reales", valor: número|null }
//        → escribe ese número a mano (null vuelve al automático) y anota quién.
//
// Dueño y Administración (gestión). Lee y escribe con la clave del servidor
// después de verificar el rol, filtrando siempre por su empresa.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { safeErrorMessage } from "../../lib/validate";
import { sbGet, sbHeaders } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { logger } from "../../lib/logger";
import { esEtapaHoras } from "../../lib/horasOt";
import { horasDeOt, faltaMigracionHoras } from "../../lib/horasOtServidor";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const OT_VALIDA = /^[^"',()\\]{1,40}$/;
const FALTA = "Para las horas presupuestadas falta correr la migración 166 en Supabase.";

async function sesionGestion(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (!ROLES_GESTION.has(sesion.rol)) {
    return { response: NextResponse.json({ error: "Solo el dueño y la oficina ven las horas presupuestadas" }, { status: 403 }) };
  }
  return { sesion };
}

export async function GET(request) {
  try {
    const { sesion, response } = await sesionGestion(request);
    if (response) return response;
    const ot = new URL(request.url).searchParams.get("ot") || "";
    if (!OT_VALIDA.test(ot)) return NextResponse.json({ error: "OT inválida" }, { status: 400 });
    try {
      const datos = await horasDeOt(sesion.empresa_id, ot);
      if (!datos) return NextResponse.json({ error: "No encontré esa OT" }, { status: 404 });
      return NextResponse.json({ ok: true, ...datos });
    } catch (err) {
      if (faltaMigracionHoras(err)) return NextResponse.json({ ok: false, falta_migracion: FALTA });
      throw err;
    }
  } catch (err) {
    logger.error("[horas-ot] GET", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { sesion, response } = await sesionGestion(request);
    if (response) return response;
    const d = await request.json().catch(() => null);
    const ot = String(d?.ot ?? "");
    const etapa = String(d?.etapa ?? "");
    const campo = d?.campo;
    const valor = d?.valor;
    if (!OT_VALIDA.test(ot) || !esEtapaHoras(etapa) || !["presupuestadas", "reales"].includes(campo)) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    if (valor !== null && !(typeof valor === "number" && Number.isFinite(valor) && valor >= 0 && valor < 100000)) {
      return NextResponse.json({ error: "Las horas tienen que ser un número entre 0 y 99.999" }, { status: 400 });
    }
    const e = sesion.empresa_id;
    const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&select=ot&limit=1`)) || [];
    if (!proyecto) return NextResponse.json({ error: "No encontré esa OT" }, { status: 404 });
    const [empleado] = sesion.empleado_id
      ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre&limit=1`, { silent: true, fallback: [] })) || []
      : [];
    const fila = {
      empresa_id: e, ot, etapa,
      [campo]: valor === null ? null : Math.round(valor * 10) / 10,
      cambiado_por_nombre: empleado?.nombre ? String(empleado.nombre).slice(0, 120) : null,
      updated_at: new Date().toISOString(),
    };
    try {
      const r = await fetch(`${SB_URL}/rest/v1/horas_ot?on_conflict=empresa_id,ot,etapa`, {
        method: "POST",
        headers: await sbHeaders({}, { Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(fila),
      });
      if (!r.ok) throw new Error(`POST horas_ot: ${await r.text()}`);
    } catch (err) {
      if (faltaMigracionHoras(err)) return NextResponse.json({ error: FALTA }, { status: 409 });
      throw err;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("[horas-ot] POST", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
