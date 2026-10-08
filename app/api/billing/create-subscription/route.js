// ═══════════════════════════════════════════════════════════
// POST /api/billing/create-subscription
// Body: { linea: "asistencia" | "planta", tramo?: 15 | 40 | 80,
//         addons?: ["ia", "campo"], periodo?: "mensual" | "anual" }
//
// Precios en USD por tramos de operarios activos + add-ons, cobrados en
// pesos al tipo de cambio de referencia del día (D16, D18, ítem 25).
// El tramo no puede ser menor que la cantidad de operarios activos de hoy;
// si no se elige, se usa el que alcanza.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { crearPreapproval, getPreapproval } from "../../../lib/mercadopago";
import { PLANES, LINEAS, TRAMOS, ADDONS, addonsValidos, planParaOperarios, precioUsd, aPesos } from "../../../lib/plans";
import { cotizacionVigente } from "../../../lib/cotizacion";
import { perfilCompleto } from "../../../lib/perfilFiscal";
import { sbGet, sbPost, sbPatchOk } from "../../../lib/sbHelpers";
import { logEvent, EVT } from "../../../lib/analytics";
import { logger } from "../../../lib/logger";
import { safeErrorMessage } from "../../../lib/validate";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";

const mismosAddons = (a = [], b = []) => [...a].sort().join(",") === [...b].sort().join(",");

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (sesion.rol !== "gerencial") {
      return NextResponse.json({ error: "Solo el dueño de la cuenta puede cambiar el plan" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { linea, tramo, periodo = "mensual" } = body || {};
    if (!LINEAS[linea]) {
      return NextResponse.json({ error: "Plan inválido. Elegí Asistencia o Planta." }, { status: 400 });
    }
    if (!["mensual", "anual"].includes(periodo)) {
      return NextResponse.json({ error: "Periodo inválido. Usá 'mensual' o 'anual'." }, { status: 400 });
    }
    if (tramo != null && !TRAMOS.includes(Number(tramo))) {
      return NextResponse.json({ error: `Tramo inválido. Usá ${TRAMOS.join(", ")}.` }, { status: 400 });
    }
    if (body.addons != null && (!Array.isArray(body.addons) || body.addons.some((a) => !ADDONS[a]))) {
      return NextResponse.json({ error: "Hay un add-on que no existe." }, { status: 400 });
    }
    const addons = addonsValidos(body.addons);

    // Factura C al CUIT del cliente (ítem 26): sin datos fiscales no se contrata.
    // Si la migración 081 no corrió (no se pueden leer), no se bloquea el pago.
    const fiscal = await sbGet(
      `empresa?id=eq.${sesion.empresa_id}&select=razon_social,cuit,condicion_iva,domicilio_fiscal&limit=1`,
      { silent: true, fallback: null }
    );
    if (Array.isArray(fiscal) && !perfilCompleto(fiscal[0])) {
      return NextResponse.json({
        error: "Antes de elegir un plan completá los datos de facturación (razón social, CUIT, condición frente al IVA y domicilio).",
        falta_perfil_fiscal: true,
      }, { status: 409 });
    }

    // El tramo tiene que alcanzar para los operarios activos de hoy
    const activos = (await sbGet(`empleados?empresa_id=eq.${sesion.empresa_id}&activo=eq.true&select=id`, { silent: true, fallback: [] })) || [];
    const minimo = planParaOperarios(linea, activos.length);
    if (!minimo) {
      return NextResponse.json({
        error: `Tenés ${activos.length} operarios activos: más de ${TRAMOS.at(-1)} es un plan a medida. Escribinos y lo armamos.`,
        tipo: "enterprise",
      }, { status: 400 });
    }
    const plan = tramo != null ? `${linea}_${Number(tramo)}` : minimo;
    if (PLANES[plan].tramo < PLANES[minimo].tramo) {
      return NextResponse.json({
        error: `Tenés ${activos.length} operarios activos: el tramo mínimo es hasta ${PLANES[minimo].tramo}.`,
        tramo_minimo: PLANES[minimo].tramo,
      }, { status: 400 });
    }

    const usd = precioUsd({ plan, addons, periodo });
    const cot = await cotizacionVigente();
    const precioMensual = aPesos(usd, cot?.usd_ars);
    if (!precioMensual) {
      return NextResponse.json({ error: "No pudimos calcular el precio en pesos en este momento. Probá de nuevo en unos minutos." }, { status: 503 });
    }

    // ═══ P6: Dedup — reusar suscripción pendiente reciente (< 5 min) con lo mismo ═══
    const recientes = await sbGet(
      `suscripciones?empresa_id=eq.${sesion.empresa_id}&plan=eq.${plan}&periodo=eq.${periodo}&estado=eq.suspendida&gateway_subscription_id=not.is.null&order=created_at.desc&limit=1&select=id,gateway_subscription_id,created_at,addons,precio`,
      { silent: true, fallback: [] }
    );
    const reciente = recientes?.[0];
    if (reciente && mismosAddons(reciente.addons, addons) && Number(reciente.precio) === precioMensual
        && Date.now() - new Date(reciente.created_at).getTime() < 5 * 60 * 1000) {
      try {
        const mp = await getPreapproval(reciente.gateway_subscription_id);
        if (mp.init_point && mp.status === "pending") {
          return NextResponse.json({
            ok: true,
            init_point: mp.init_point,
            suscripcion_id: reciente.id,
            mp_preapproval_id: reciente.gateway_subscription_id,
            dedup: true,
          });
        }
      } catch {}
    }

    const emp = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=admin_email,nombre,slug`);
    if (!emp?.[0]) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    const empresa = emp[0];
    const payerEmail = empresa.admin_email;
    if (!payerEmail) return NextResponse.json({ error: "La empresa no tiene email de admin configurado" }, { status: 400 });

    const localSusc = await sbPost("suscripciones", {
      empresa_id: sesion.empresa_id,
      plan,
      estado: "suspendida",
      precio: precioMensual,
      precio_usd: usd,
      cotizacion: cot.usd_ars,
      addons,
      moneda: "ARS",
      gateway: "mercadopago",
      periodo,
    });
    const suscId = localSusc[0].id;

    const externalRef = `gypi-${sesion.empresa_id}-${suscId}`;
    const backUrl = `${APP_URL}/${empresa.slug || ""}?billing=ok`;
    const nombrePlan = [PLANES[plan].nombre, ...addons.map((a) => ADDONS[a].nombre)].join(" + ");

    let mp;
    try {
      mp = await crearPreapproval({
        payerEmail,
        monto: precioMensual,
        plan: nombrePlan,
        empresaId: sesion.empresa_id,
        externalReference: externalRef,
        backUrl,
        periodo,
      });
    } catch (err) {
      logger.error("[create-subscription] Error MP", err, { body: err.body });
      return NextResponse.json({ error: "Error de Mercado Pago. Intentá de nuevo en unos minutos." }, { status: 500 });
    }

    await sbPatchOk(`suscripciones?id=eq.${suscId}`, { gateway_subscription_id: mp.id });

    // Limpiar override manual: el usuario está eligiendo plan vía MP
    await sbPatchOk(`empresa?id=eq.${sesion.empresa_id}`, {
      plan_override_manual: false,
    });

    logEvent(EVT.UPGRADE_INIT, {
      empresa_id: sesion.empresa_id,
      plan,
      meta: { periodo, precio: precioMensual, precio_usd: usd, cotizacion: cot.usd_ars, addons },
    });

    return NextResponse.json({
      ok: true,
      init_point: mp.init_point,
      suscripcion_id: suscId,
      mp_preapproval_id: mp.id,
      plan,
      precio: precioMensual,
      precio_usd: usd,
      cotizacion: cot.usd_ars,
    });
  } catch (err) {
    logger.error("[create-subscription] Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
