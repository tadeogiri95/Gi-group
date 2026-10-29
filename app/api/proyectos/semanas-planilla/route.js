// /api/proyectos/semanas-planilla — SEMANA cambiada en Gypi para el Plan de
// trabajo (Tadeo, 29/10; migración 144; app/lib/planillaPlan.js).
//
// GET   → lo llama el script del Plan de trabajo cada 15 minutos, con la clave
//         privada de la empresa (Authorization: Bearer gyp_…). Devuelve las
//         OT con semana cambiada en Gypi que todavía no llegaron a la planilla.
//         Sin sesión de usuario: va con service_role, filtrado por la empresa
//         de la clave (como /api/stock/planilla).
// PATCH → el script avisa qué semanas ya están en la planilla:
//         { escritas: [{ ot, semana }] }. Dejan de estar pendientes.
// POST  → gestión genera una clave nueva (la anterior deja de andar) y recibe
//         el código para pegar en Apps Script. La clave se muestra una sola vez.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { safeErrorMessage } from "../../../lib/validate";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { sbGet, sbPost, sbPatch } from "../../../lib/sbHelpers";
import { requireModulo } from "../../../lib/planEnforcement";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { CLAVE_PLANILLA_PLAN, generarClave, empresaDeClave, claveValida, semanasParaPlanilla, scriptPlanPlanilla } from "../../../lib/planillaPlan";
import { broadcastRefresh } from "../../../lib/broadcast";
import { logger } from "../../../lib/logger";

const noAutorizado = () => NextResponse.json({ error: "Clave inválida" }, { status: 401 });

/** Empresa y config de la clave del script, o la respuesta de error. */
async function autenticar(request) {
  const auth = request.headers.get("authorization") || "";
  const clave = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const e = empresaDeClave(clave);
  if (!e) return { respuesta: noAutorizado() };
  const rl = checkRateLimit(`semanas-planilla:${e}`, 60, 60_000);
  if (rl.limited) return { respuesta: NextResponse.json({ error: "Demasiados pedidos" }, { status: 429 }) };
  const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANILLA_PLAN}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  if (!claveValida(clave, cfg?.valor?.hash)) return { respuesta: noAutorizado() };
  return { e, cfg };
}

export async function GET(request) {
  try {
    const { e, cfg, respuesta } = await autenticar(request);
    if (respuesta) return respuesta;
    // Sin la migración 144 no hay semanas cambiadas
    const filas = await sbGet(
      `proyectos?empresa_id=eq.${e}&semana_app=not.is.null&select=ot,semana_app,semana_planilla&order=id.asc&limit=2000`,
      { silent: true, fallback: [] }
    );
    sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANILLA_PLAN}`, {
      valor: { ...cfg.valor, ultima_lectura: new Date().toISOString() },
    }, { silent: true }).catch(() => {});
    return NextResponse.json({ semanas: semanasParaPlanilla(Array.isArray(filas) ? filas : []) });
  } catch (err) {
    logger.error("[proyectos/semanas-planilla] GET error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { e, respuesta } = await autenticar(request);
    if (respuesta) return respuesta;
    const body = await request.json().catch(() => null);
    const lista = Array.isArray(body?.escritas) ? body.escritas.slice(0, 2000) : null;
    if (!lista) return NextResponse.json({ error: "Faltan las semanas" }, { status: 400 });
    let listas = 0;
    for (const x of lista) {
      const ot = String(x?.ot ?? "").trim();
      const semana = Number(x?.semana);
      if (!ot || !Number.isInteger(semana) || semana < 1) continue;
      // Solo si sigue siendo esa la semana pendiente (no la volvieron a cambiar en Gypi)
      await sbPatch(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&semana_app=eq.${semana}`,
        { semana_app: null, semana_app_at: null, semana_planilla: semana });
      listas++;
    }
    if (listas) broadcastRefresh(e, "proyectos");
    return NextResponse.json({ ok: true, listas });
  } catch (err) {
    logger.error("[proyectos/semanas-planilla] PATCH error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_GESTION.has(sesion.rol)) {
      return NextResponse.json({ error: "Solo el encargado puede conectar la planilla" }, { status: 403 });
    }
    const sinModulo = await requireModulo(sesion.empresa_id, "proyectos");
    if (sinModulo) return sinModulo;

    const e = sesion.empresa_id;
    const opts = { sesion };
    const { clave, hash } = generarClave(e);
    const valor = { hash, creada_at: new Date().toISOString(), ultima_lectura: null };
    const filtro = `config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANILLA_PLAN}`;
    const [previa] = (await sbGet(`${filtro}&select=clave&limit=1`, opts)) || [];
    if (previa) await sbPatch(filtro, { valor }, opts);
    else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_PLANILLA_PLAN, valor }, opts);

    const url = `${new URL(request.url).origin}/api/proyectos/semanas-planilla`;
    return NextResponse.json({ ok: true, script: scriptPlanPlanilla({ url, clave }), creada_at: valor.creada_at });
  } catch (err) {
    logger.error("[proyectos/semanas-planilla] POST error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
