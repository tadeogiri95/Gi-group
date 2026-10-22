// /api/stock/planilla — Movimientos de stock para la planilla MRP (Stock,
// parte 15; ítem 40).
//
// GET  → lo llama el script de la planilla cada hora, con la clave privada de
//        la empresa (Authorization: Bearer gyp_…). ?desde=<último id traído>.
//        Devuelve los movimientos siguientes (de a LOTE) y los ya traídos que
//        se anularon en los últimos días, para que la planilla borre su fila.
//        Con ?ordenes=1 suma las OC abiertas para fact_ordenes_compra (Compras,
//        parte 23); si la tabla todavía no está (migraciones 114/115), no van.
//        Siempre suma los artículos nuevos cargados en Gypi que la planilla
//        todavía no anotó (articulos, migración 124), para que el script los
//        agregue a ARTICULOS antes de los movimientos.
//        Sin sesión de usuario: va con service_role, filtrado por la empresa
//        de la clave (como los crons).
// PATCH → el script avisa qué artículos nuevos ya anotó y con qué SKU los
//        armó la fórmula de ARTICULOS: { articulos: [{ alta, sku }] }. Si el
//        SKU es otro que el provisorio de Gypi, se cambia en el stock, los
//        movimientos, los pedidos y las órdenes de compra.
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
import { articuloParaPlanilla, TABLAS_CON_SKU } from "../../../lib/articulosNuevos";
import { SKU_VALIDO } from "../../../lib/stock";
import { broadcastRefresh } from "../../../lib/broadcast";
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

/** Artículos nuevos de Gypi que la planilla todavía no anotó; [] si falta la migración 124. */
async function articulosPendientes(e) {
  const altas = await sbGet(
    `articulos_alta?empresa_id=eq.${e}&en_planilla_at=is.null&order=id.asc&limit=200&select=*`,
    { silent: true, fallback: [] }
  );
  return (Array.isArray(altas) ? altas : []).map(articuloParaPlanilla).filter(Boolean);
}

const noAutorizado = () => NextResponse.json({ error: "Clave inválida" }, { status: 401 });

/** Empresa y config de la clave del script, o la respuesta de error. */
async function autenticar(request) {
  const auth = request.headers.get("authorization") || "";
  const clave = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const e = empresaDeClave(clave);
  if (!e) return { respuesta: noAutorizado() };
  const rl = checkRateLimit(`stock-planilla:${e}`, 60, 60_000);
  if (rl.limited) return { respuesta: NextResponse.json({ error: "Demasiados pedidos" }, { status: 429 }) };
  const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANILLA_MRP}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  if (!claveValida(clave, cfg?.valor?.hash)) return { respuesta: noAutorizado() };
  return { e, cfg };
}

export async function GET(request) {
  try {
    const { e, cfg, respuesta } = await autenticar(request);
    if (respuesta) return respuesta;

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
    const articulos = await articulosPendientes(e);

    sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANILLA_MRP}`, {
      valor: { ...cfg.valor, ultima_lectura: new Date().toISOString() },
    }, { silent: true }).catch(() => {});

    return NextResponse.json({
      movimientos: lote.map((m) => movimientoParaPlanilla(m, empresa?.timezone)).filter(Boolean),
      anulados: anulados.map((a) => `GY-${a.id}`),
      hasta: lote.length ? lote[lote.length - 1].id : desde,
      hayMas,
      articulos,
      ...(ordenes ? { ordenes } : {}),
    });
  } catch (err) {
    logger.error("[stock/planilla] GET error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

/** Un artículo nuevo ya está en ARTICULOS: se anota y, si la fórmula le dio otro SKU, se cambia en Gypi. */
async function confirmarArticulo(e, altaId, skuPlanilla) {
  const [alta] = (await sbGet(`articulos_alta?empresa_id=eq.${e}&id=eq.${altaId}&select=id,sku,en_planilla_at&limit=1`)) || [];
  if (!alta || alta.en_planilla_at) return null;
  const sku = SKU_VALIDO.test(skuPlanilla) ? skuPlanilla : null;
  const cambia = Boolean(sku && sku !== alta.sku);
  if (cambia) {
    const viejo = encodeURIComponent(alta.sku);
    const [yaEsta] = (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=eq.${encodeURIComponent(sku)}&select=sku&limit=1`)) || [];
    if (yaEsta) await sbPatch(`articulos_stock?empresa_id=eq.${e}&sku=eq.${viejo}`, { activo: false });
    else await sbPatch(`articulos_stock?empresa_id=eq.${e}&sku=eq.${viejo}`, { sku });
    for (const tabla of TABLAS_CON_SKU) {
      await sbPatch(`${tabla}?empresa_id=eq.${e}&sku=eq.${viejo}`, { sku }, { silent: true });
    }
  }
  await sbPatch(`articulos_alta?empresa_id=eq.${e}&id=eq.${alta.id}`, {
    en_planilla_at: new Date().toISOString(),
    sku_planilla: sku,
    aviso_planilla: sku ? null : "La fórmula de la planilla no armó el SKU: revisá la fila (quedó en amarillo).",
  });
  return { alta: alta.id, antes: alta.sku, sku: sku || alta.sku, cambia };
}

export async function PATCH(request) {
  try {
    const { e, respuesta } = await autenticar(request);
    if (respuesta) return respuesta;
    const body = await request.json().catch(() => null);
    const lista = Array.isArray(body?.articulos) ? body.articulos.slice(0, 200) : null;
    if (!lista) return NextResponse.json({ error: "Faltan los artículos" }, { status: 400 });
    const confirmados = [];
    for (const a of lista) {
      const id = Number(a?.alta);
      if (!Number.isInteger(id) || id <= 0) continue;
      const r = await confirmarArticulo(e, id, String(a?.sku ?? "").trim());
      if (r) confirmados.push(r);
    }
    if (confirmados.some((c) => c.cambia)) broadcastRefresh(e, "articulos_stock");
    return NextResponse.json({ ok: true, confirmados });
  } catch (err) {
    logger.error("[stock/planilla] PATCH error", err);
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
