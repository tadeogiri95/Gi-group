// GET /api/cron/actualizar-precios — Todos los días 12:00 UTC (9:00 en Argentina).
// Guarda la cotización del día y mantiene el precio en pesos de los planes
// en USD: avisa con 30 días cuando el dólar se movió y, cumplido el plazo,
// cambia el monto en Mercado Pago (D18, ítem 25). Ver app/lib/actualizarPrecios.js.
import { NextResponse } from "next/server";
import { sbGet, sbPatch } from "../../../lib/sbHelpers";
import { cotizacionVigente } from "../../../lib/cotizacion";
import { decidirPrecio } from "../../../lib/actualizarPrecios";
import { actualizarMontoPreapproval } from "../../../lib/mercadopago";
import { montoCobro, PLANES } from "../../../lib/plans";
import { sendAvisoPrecio } from "../../../lib/email";
import { logger } from "../../../lib/logger";
import { conMonitoreoCron } from "../../../lib/cronMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ejecutar(request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const cot = await cotizacionVigente();
  const suscs = (await sbGet(
    "suscripciones?estado=eq.activa&gateway=eq.mercadopago&precio_usd=not.is.null&gateway_subscription_id=not.is.null" +
    "&select=id,empresa_id,plan,precio,precio_usd,periodo,gateway_subscription_id,precio_nuevo,precio_nuevo_desde,cotizacion_nueva&limit=500"
  )) || [];

  let avisadas = 0, aplicadas = 0;
  const errores = [];
  for (const s of suscs) {
    const d = decidirPrecio(s, cot?.usd_ars);
    try {
      if (d.accion === "aplicar") {
        await actualizarMontoPreapproval(s.gateway_subscription_id, montoCobro(d.precio, s.periodo));
        await sbPatch(`suscripciones?id=eq.${s.id}`, {
          precio: d.precio,
          cotizacion: s.cotizacion_nueva,
          precio_nuevo: null,
          precio_nuevo_desde: null,
          cotizacion_nueva: null,
        });
        aplicadas++;
      } else if (d.accion === "avisar") {
        // Condicionado a que no haya otro aviso en curso (dos corridas juntas no avisan dos veces)
        const marcada = await sbPatch(`suscripciones?id=eq.${s.id}&precio_nuevo=is.null`, {
          precio_nuevo: d.precio,
          precio_nuevo_desde: d.desde,
          cotizacion_nueva: cot.usd_ars,
        });
        if (!Array.isArray(marcada) || marcada.length === 0) continue;
        avisadas++;
        const [emp] = (await sbGet(`empresa?id=eq.${s.empresa_id}&select=admin_email,nombre,nombre_corto,slug&limit=1`, { silent: true, fallback: [] })) || [];
        if (emp?.admin_email) {
          await sendAvisoPrecio({
            to: emp.admin_email,
            nombre: emp.nombre_corto || emp.nombre,
            empresa: emp.nombre_corto || emp.nombre,
            slug: emp.slug,
            precioActual: s.precio,
            precioNuevo: d.precio,
            desde: d.desde,
            precioUsd: s.precio_usd,
            cotizacion: cot.usd_ars,
            periodo: s.periodo,
            empresaId: s.empresa_id,
          });
        }
        logger.info(`[actualizar-precios] aviso ${s.id}: ${s.precio} → ${d.precio} (${PLANES[s.plan]?.nombre || s.plan})`);
      }
    } catch (e) {
      errores.push(s.id);
      logger.error(`[actualizar-precios] ${s.id}`, e);
    }
  }

  // Sin cotización no se pueden detectar cambios: se avisa en el monitoreo
  const ok = errores.length === 0 && !!cot;
  return NextResponse.json(
    { ok, cotizacion: cot?.usd_ars ?? null, revisadas: suscs.length, avisadas, aplicadas, errores },
    { status: ok ? 200 : 500 }
  );
}

export const GET = conMonitoreoCron("actualizar-precios", ejecutar);
