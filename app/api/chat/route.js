// ═══════════════════════════════════════════════════════════
// /api/chat/route.js — IA de Gypi (Anthropic API), cerrada por tipo de uso
//
// Body: { tipo: "chat" | "reporte_obra", messages: [{ role, content }] }
// Respuesta: { texto }
//
// - El prompt de sistema lo arma el servidor (lib/iaPrompts.js) con datos
//   leídos de la base para la sesión; el cliente no puede mandarlo (F2-05).
// - Cada tipo exige su módulo en el plan y tiene max_tokens propio.
// - Cupo mensual de consultas por empresa según plan (PLANES.ia_consultas_mes),
//   contado sobre audit_log (accion "chat_ia").
// - Rate limit por minuto persistido en Supabase (rpc_check_rate_limit).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rechazarSiSinPlan, getAddonsEmpresa } from "../../lib/planEnforcement";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { logAudit } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { sbGet } from "../../lib/sbHelpers";
import { chatBody } from "../../lib/schemas";
import { capacidades } from "../../lib/plans";
import { hoyArg } from "../../lib/dates";
import { TIPOS_IA, MODELO_IA, construirPromptChat, construirPromptObra } from "../../lib/iaPrompts";

import { ipCliente } from "../../lib/ip";
const RATE_LIMIT = 20;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function checkRateLimit(empresaId) {
  const ventana = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/rpc_check_rate_limit`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_empresa_id: empresaId, p_ventana: ventana, p_limite: RATE_LIMIT }),
      signal: AbortSignal.timeout(3000),
    });
    // fail-closed: si la DB no responde, bloqueamos para evitar costos descontrolados en Anthropic
    if (!res.ok) return false;
    const count = await res.json();
    return typeof count === "number" ? count <= RATE_LIMIT : false;
  } catch {
    // timeout o error de red — fail-closed intencional
    return false;
  }
}

/** Consultas a la IA de la empresa en el mes calendario actual. null si no se pudo contar. */
async function consultasDelMes(empresaId) {
  const desde = `${hoyArg().slice(0, 7)}-01T00:00:00-03:00`;
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/audit_log?empresa_id=eq.${empresaId}&accion=eq.chat_ia&created_at=gte.${encodeURIComponent(desde)}&select=id&limit=1`,
      {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "count=exact" },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!res.ok) return null;
    const total = Number(res.headers.get("content-range")?.split("/")[1]);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

/** Contexto del chat leído de la base para la sesión (nunca del cliente). */
async function contextoChat(sesion) {
  const hoy = hoyArg();
  const e = sesion.empresa_id;
  const [usuarios, fichadaHoy, enPlanta, misSolicitudes, reglas] = await Promise.all([
    sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre,apodo,legajo,area,cc,rol,division,diagrama,horas_semanales,geo_config&limit=1`),
    sbGet(`fichadas?empresa_id=eq.${e}&legajo=eq.${sesion.legajo}&fecha=eq.${hoy}&select=ingreso,egreso&limit=1`, { silent: true, fallback: [] }),
    sbGet(`fichadas?empresa_id=eq.${e}&fecha=eq.${hoy}&select=legajo,ingreso,egreso,empleados(nombre)&limit=200`, { silent: true, fallback: [] }),
    sbGet(`solicitudes?empresa_id=eq.${e}&legajo=eq.${sesion.legajo}&select=id,estado,tipo,motivo,fecha,aprobador&order=created_at.desc&limit=20`, { silent: true, fallback: [] }),
    sbGet(`reglas_bot?empresa_id=eq.${e}&activa=eq.true&select=regla&order=id.asc&limit=50`, { silent: true, fallback: [] }),
  ]);
  const usuario = usuarios?.[0];
  if (!usuario) return null;

  let geoZonaNombre = null;
  const gc = usuario.geo_config;
  if (gc?.activo && gc.ubicacion_id) {
    const zonas = await sbGet(
      `geo_zonas?id=eq.${encodeURIComponent(gc.ubicacion_id)}&empresa_id=eq.${e}&select=nombre&limit=1`,
      { silent: true, fallback: [] }
    );
    geoZonaNombre = zonas?.[0]?.nombre || null;
  }

  return {
    usuario,
    fichadaHoy: fichadaHoy?.[0] || null,
    enPlanta: (enPlanta || []).map((f) => ({ ...f, nombre: f.empleados?.nombre || "" })),
    misSolicitudes: misSolicitudes || [],
    reglas: (reglas || []).map((r) => r.regla),
    geoZonaNombre,
  };
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion) return respuestaNoAutorizado();
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;

    const rawBody = await request.text();
    if (rawBody.length > 100_000) {
      return NextResponse.json({ error: "Payload demasiado grande (máximo 100 KB)" }, { status: 413 });
    }
    let body;
    try { body = JSON.parse(rawBody); } catch { body = null; }
    const parsed = chatBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    const { tipo, messages } = parsed.data;
    const conf = TIPOS_IA[tipo];
    if (messages.length > conf.max_mensajes || messages[0].role !== "user") {
      return NextResponse.json({ error: "Historial de mensajes inválido" }, { status: 400 });
    }

    const [empresa] = await sbGet(
      `empresa?id=eq.${sesion.empresa_id}&select=nombre,nombre_corto,rubro,plan_activo,prompt_ia_chat,prompt_ia_obra&limit=1`
    ) || [];
    if (!empresa) return respuestaNoAutorizado();
    // Plan + add-ons (Asistente IA suma cupo; Trabajo en campo, el reporte de obra)
    const plan = capacidades(empresa.plan_activo, await getAddonsEmpresa(sesion.empresa_id));
    if (!plan.modulos.includes(conf.modulo)) {
      return NextResponse.json(
        { error: "Tu plan no incluye esta función.", upgrade: true },
        { status: 402 }
      );
    }

    const allowed = await checkRateLimit(sesion.empresa_id);
    if (!allowed) {
      return NextResponse.json(
        { error: "Demasiadas consultas. Esperá un momento antes de preguntar de nuevo." },
        { status: 429 }
      );
    }

    // Cupo mensual: fail-closed si no se puede contar (igual que el rate limit).
    const usadas = await consultasDelMes(sesion.empresa_id);
    if (usadas === null || usadas >= plan.ia_consultas_mes) {
      return NextResponse.json(
        {
          error: usadas === null
            ? "La IA no está disponible en este momento. Intentá de nuevo en unos segundos."
            : "Tu empresa usó todas las consultas a la IA de este mes. Se renuevan el día 1.",
          cupo_agotado: usadas !== null,
        },
        { status: usadas === null ? 503 : 429 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      logger.error("ANTHROPIC_API_KEY no configurada");
      return NextResponse.json({ error: "La IA no está configurada" }, { status: 500 });
    }

    let system;
    if (tipo === "chat") {
      const ctx = await contextoChat(sesion);
      if (!ctx) return respuestaNoAutorizado();
      system = construirPromptChat({ ...ctx, empresa });
    } else {
      system = construirPromptObra({ empresa });
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODELO_IA, max_tokens: conf.max_tokens, system, messages }),
      signal: AbortSignal.timeout(25000),
    });

    const data = await res.json();

    if (!res.ok) {
      logger.error("Anthropic API error", new Error(`status ${res.status}`), { status: res.status, data });
      return NextResponse.json(
        { error: "La IA no está disponible en este momento. Intentá de nuevo en unos segundos." },
        { status: 502 }
      );
    }

    // Auditoría de uso: también es la base del cupo mensual
    logAudit({
      empresa_id: sesion.empresa_id,
      actor_id: sesion.empleado_id,
      actor_legajo: sesion.legajo,
      actor_rol: sesion.rol,
      accion: "chat_ia",
      entidad: "chat",
      datos_despues: {
        tipo,
        tokens_input: data.usage?.input_tokens,
        tokens_output: data.usage?.output_tokens,
        model: data.model,
      },
      ip: ipCliente(request),
    });

    const texto = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
    return NextResponse.json({ texto });
  } catch (err) {
    logger.error("chat error", err);
    return NextResponse.json(
      { error: "Error interno. Intentá de nuevo en unos segundos." },
      { status: 500 }
    );
  }
}
