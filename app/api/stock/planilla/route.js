// /api/stock/planilla — Movimientos de stock para la planilla MRP (Stock,
// parte 15; ítem 40).
//
// GET  → lo llama el script de la planilla cada hora, con la clave privada de
//        la empresa (Authorization: Bearer gyp_…). ?desde=<último id traído>.
//        Devuelve los movimientos siguientes (de a LOTE) y los ya traídos que
//        se anularon en los últimos días, para que la planilla borre su fila.
//        Con ?ordenes=1 suma las OC abiertas para fact_ordenes_compra (Compras,
//        parte 23); si la tabla todavía no está (migraciones 114/115), no van.
//        Sin sesión de usuario: va con service_role, filtrado por la empresa
//        de la clave (como los crons).
// POST → gestión genera una clave nueva (la anterior deja de andar) y recibe
//        el código para pegar en Apps Script. La clave se muestra una sola vez.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { safeErrorMessage } from "../../../lib/validate";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { sbGet, sbPost, sbPatch } from "../../../lib/sbHelpers";
import { requireModulo } from "../../../lib/planEnforcement";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import {
  CLAVE_PLANILLA_MRP, generarClave, empresaDeClave, claveValida, movimientoParaPlanilla, ordenesParaPlanilla, scriptPlanilla,
} from "../../../lib/planillaMrp";
import { ESTADOS_OC_ABIERTA } from "../../../lib/ordenesCompra";
import { logger } from "../../../lib/logger";

const LOTE = 500;
const DIAS_ANULADOS = 60;

/**
 * OC abiertas de la empresa como van a la planilla; null si no se pudieron leer (así la planilla no borra las suyas).
 * Las que están "A cotizar" (sin proveedor, 125) todavía no son una compra: no van como EN TRÁNSITO.
 */
async function ordenesAbiertas(e, timezone) {
  const ocs = await sbGet(
    `ordenes_compra?empresa_id=eq.${e}&estado=in.(${ESTADOS_OC_ABIERTA.join(",")})&proveedor_id=not.is.null` +
    "&select=id,numero,proveedor_nombre,estado,fecha_prometida,enviada_at,created_at&order=numero.asc&limit=1000",
    { silent: true, fallback: null }
  );
  if (!Array.isArray(ocs)) return null;
  if (!ocs.length) return [];
  const items = await sbGet(
    `ordenes_compra_items?empresa_id=eq.${e}&orden_id=in.(${ocs.map((o) => o.id).join(",")})` +
    "&select=orden_id,sku,descripcion,cantidad,cantidad_recibida&order=id.asc&limit=10000",
    { silent: true, fallback: null }
  );
  if (!Array.isArray(items)) return null;
  return ordenesParaPlanilla(ocs, items, timezone);
}

const noAutorizado = () => NextResponse.json({ error: "Clave inválida" }, { status: 401 });

export async function GET(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const clave = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const e = empresaDeClave(clave);
    if (!e) return noAutorizado();
    const rl = checkRateLimit(`stock-planilla:${e}`, 60, 60_000);
    if (rl.limited) return NextResponse.json({ error: "Demasiados pedidos" }, { status: 429 });

    const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANILLA_MRP}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
    if (!claveValida(clave, cfg?.valor?.hash)) return noAutorizado();

    const params = new URL(request.url).searchParams;
    const desdeTxt = params.get("desde") || "0";
    const desde = /^\d{1,15}$/.test(desdeTxt) ? Number(desdeTxt) : 0;
    const [empresa] = (await sbGet(`empresa?id=eq.${e}&select=timezone&limit=1`, { silent: true, fallback: [] })) || [];
    const filas = (await sbGet(
      `movimientos_stock?empresa_id=eq.${e}&id=gt.${desde}&order=id.asc&limit=${LOTE + 1}` +
      "&select=id,tipo,sku,nombre,cantidad,ot,proveedor,comprobante,precio_unitario,empleado_nombre,legajo,anulado,created_at"
    )) || [];
    const hayMas = filas.length > LOTE;
    const lote = filas.slice(0, LOTE);
    const hace = new Date(Date.now() - DIAS_ANULADOS * 86400e3).toISOString();
    const anulados = desde > 0
      ? (await sbGet(`movimientos_stock?empresa_id=eq.${e}&anulado=eq.true&id=lte.${desde}&anulado_at=gte.${hace}&select=id&order=id.asc&limit=2000`)) || []
      : [];

    const ordenes = params.get("ordenes") === "1" ? await ordenesAbiertas(e, empresa?.timezone) : null;

    sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANILLA_MRP}`, {
      valor: { ...cfg.valor, ultima_lectura: new Date().toISOString() },
    }, { silent: true }).catch(() => {});

    return NextResponse.json({
      movimientos: lote.map((m) => movimientoParaPlanilla(m, empresa?.timezone)).filter(Boolean),
      anulados: anulados.map((a) => `GY-${a.id}`),
      hasta: lote.length ? lote[lote.length - 1].id : desde,
      hayMas,
      ...(ordenes ? { ordenes } : {}),
    });
  } catch (err) {
    logger.error("[stock/planilla] GET error", err);
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
    const filtro = `config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANILLA_MRP}`;
    const [previa] = (await sbGet(`${filtro}&select=clave&limit=1`, opts)) || [];
    if (previa) await sbPatch(filtro, { valor }, opts);
    else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_PLANILLA_MRP, valor }, opts);

    const url = `${new URL(request.url).origin}/api/stock/planilla`;
    return NextResponse.json({ ok: true, script: scriptPlanilla({ url, clave }), creada_at: valor.creada_at });
  } catch (err) {
    logger.error("[stock/planilla] POST error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
