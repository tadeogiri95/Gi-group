// app/api/modulos/route.js — Más → Módulos: la empresa prende o apaga los
// módulos que contrató (migración 131, empresa_modulos.apagado).
//
// Lo apagado no se ve en la app (ni con candado) y el servidor lo bloquea igual
// que lo no contratado. Lo no contratado no se puede prender desde acá: eso es
// del plan (Facturación) o de un ajuste a mano. Los datos nunca se borran.
// empresa_modulos solo la usa el servidor con la service key (083).
import { NextResponse } from "next/server";
import { validarToken } from "../../lib/auth";
import { rechazarSiSupervisor } from "../../lib/alcance";
import { getModulosEmpresa, invalidarCachePlan } from "../../lib/planEnforcement";
import { MODULOS, SIEMPRE_PRENDIDOS } from "../../lib/modulos";
import { logAudit } from "../../lib/audit";
import { ipCliente } from "../../lib/ip";
import { safeErrorMessage } from "../../lib/validate";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sesionDeGestion(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { respuesta: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!["gerencial", "administrativo"].includes(sesion.rol)) {
    return { respuesta: NextResponse.json({ error: "Sin permisos" }, { status: 403 }) };
  }
  const supervisor = await rechazarSiSupervisor(sesion);
  if (supervisor) return { respuesta: supervisor };
  return { sesion };
}

/** Catálogo con el estado de cada módulo para esta empresa. */
async function estado(empresaId) {
  const { modulos, contratados, apagados } = await getModulosEmpresa(empresaId);
  const lista = Object.values(MODULOS)
    .filter((m) => m.disponible)
    .map((m) => ({
      id: m.id,
      nombre: m.nombre,
      descripcion: m.descripcion,
      contratado: contratados.includes(m.id),
      prendido: modulos.includes(m.id),
      fijo: SIEMPRE_PRENDIDOS.includes(m.id),
    }));
  return { lista, modulos, modulos_apagados: apagados };
}

export async function GET(request) {
  try {
    const { sesion, respuesta } = await sesionDeGestion(request);
    if (respuesta) return respuesta;
    return NextResponse.json(await estado(sesion.empresa_id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { sesion, respuesta } = await sesionDeGestion(request);
    if (respuesta) return respuesta;

    const body = await request.json().catch(() => ({}));
    const modulo = typeof body?.modulo === "string" ? body.modulo : "";
    if (typeof body?.prendido !== "boolean" || !MODULOS[modulo]?.disponible) {
      return NextResponse.json({ error: "Módulo inválido" }, { status: 400 });
    }
    if (SIEMPRE_PRENDIDOS.includes(modulo)) {
      return NextResponse.json({ error: `${MODULOS[modulo].nombre} no se puede apagar.` }, { status: 400 });
    }
    const e = sesion.empresa_id;
    const { contratados } = await getModulosEmpresa(e);
    if (!contratados.includes(modulo)) {
      return NextResponse.json({ error: `${MODULOS[modulo].nombre} no está en tu plan.` }, { status: 403 });
    }

    // Upsert solo de "apagado": si la fila ya existía (un ajuste a mano), su
    // activo y su config quedan como estaban
    const res = await fetch(`${SB_URL}/rest/v1/empresa_modulos?on_conflict=empresa_id,modulo`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ empresa_id: e, modulo, apagado: !body.prendido, actualizado_en: new Date().toISOString() }),
    });
    if (!res.ok) {
      const texto = await res.text().catch(() => "");
      if (texto.includes("apagado")) {
        return NextResponse.json({ error: "Para prender y apagar módulos falta correr la migración 131 en Supabase." }, { status: 409 });
      }
      return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
    }
    invalidarCachePlan(e);

    logAudit({
      empresa_id: e,
      actor_id: sesion.empleado_id,
      actor_legajo: sesion.legajo,
      actor_rol: sesion.rol,
      accion: body.prendido ? "prender_modulo" : "apagar_modulo",
      entidad: "empresa_modulos",
      entidad_id: e,
      datos_despues: { modulo, prendido: body.prendido },
      ip: ipCliente(request),
    });
    return NextResponse.json({ ok: true, ...(await estado(e)) });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
