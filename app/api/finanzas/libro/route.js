// /api/finanzas/libro — Finanzas, parte F2c: Gypi alimenta el libro contable
// (reglas y script en app/lib/finanzasLibro.js). Sin migración.
//
// GET  → lo llama el script del libro cada 15 minutos, con la clave privada
//        de la empresa (Authorization: Bearer gyp_…). Devuelve las
//        operaciones vivas cargadas en Gypi y los cheques, listos para las
//        hojas T-OPERACIONES y R-CHEQUES. Sin sesión de usuario: va con
//        service_role, filtrado por la empresa de la clave (como
//        /api/stock/planilla), y solo si la empresa tiene Finanzas.
// POST → el Dueño genera una clave nueva (la anterior deja de andar) y
//        recibe el código para pegar en Apps Script. Se muestra una sola vez.
import { NextResponse } from "next/server";
import { safeErrorMessage } from "../../../lib/validate";
import { sbGet, sbGetAll, sbPost, sbPatch } from "../../../lib/sbHelpers";
import { getModulosEmpresa } from "../../../lib/planEnforcement";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { sesionDueno } from "../../../lib/finanzasApi";
import { CLAVE_LIBRO_FIN, claveValida, datosParaLibro, empresaDeClave, generarClave, scriptLibro } from "../../../lib/finanzasLibro";
import { logger } from "../../../lib/logger";

const noAutorizado = () => NextResponse.json({ error: "Clave inválida" }, { status: 401 });
const COLUMNAS_OP = "id,fecha,tipo,proveedor_id,entidad,proyecto_id,centro_costo,neto,iva,otros_impuestos,moneda,cuenta_debe,cuenta_haber,descripcion,referencia,origen,estado,cargada_por_nombre,anulada_at,created_at,updated_at";
const leer = (path, maxFilas = 20000) => sbGetAll(path, { maxFilas }).then((r) => r.data || []);

export async function GET(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const clave = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const e = empresaDeClave(clave);
    if (!e) return noAutorizado();
    const rl = checkRateLimit(`finanzas-libro:${e}`, 30, 60_000);
    if (rl.limited) return NextResponse.json({ error: "Demasiados pedidos" }, { status: 429 });
    const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_LIBRO_FIN}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
    if (!claveValida(clave, cfg?.valor?.hash)) return noAutorizado();
    const { modulos } = await getModulosEmpresa(e);
    if (!modulos.includes("finanzas")) return NextResponse.json({ error: "La empresa no tiene Finanzas" }, { status: 402 });

    const [operaciones, cheques, cuentas, proveedores, proyectos, empresas] = await Promise.all([
      leer(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&origen=neq.saldo_inicial&select=${COLUMNAS_OP}&order=fecha.asc,id.asc`, 50000),
      // Sin la migración 174 no hay cheques
      sbGetAll(`fin_cheques?empresa_id=eq.${e}&select=*&order=id.asc`, { maxFilas: 20000 }).then((r) => r.data || []).catch(() => []),
      leer(`fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre`),
      leer(`proveedores?empresa_id=eq.${e}&select=id,nombre`),
      leer(`proyectos?empresa_id=eq.${e}&select=id,ot`),
      sbGet(`empresa?id=eq.${e}&select=nombre,razon_social&limit=1`, { silent: true, fallback: [] }),
    ]);
    sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_LIBRO_FIN}`, {
      valor: { ...cfg.valor, ultima_lectura: new Date().toISOString() },
    }, { silent: true }).catch(() => {});
    const empresa = empresas?.[0]?.razon_social || empresas?.[0]?.nombre || "";
    return NextResponse.json(datosParaLibro({ operaciones, cheques, cuentas, proveedores, proyectos, empresa }));
  } catch (err) {
    logger.error("[finanzas/libro] GET error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  try {
    const e = sesion.empresa_id;
    const { clave, hash } = generarClave(e);
    const valor = { hash, creada_at: new Date().toISOString(), ultima_lectura: null };
    const filtro = `config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_LIBRO_FIN}`;
    const [previa] = (await sbGet(`${filtro}&select=clave&limit=1`, { silent: true, fallback: [] })) || [];
    if (previa) await sbPatch(filtro, { valor });
    else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_LIBRO_FIN, valor });
    const url = `${(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, "")}/api/finanzas/libro`;
    return NextResponse.json({ ok: true, script: scriptLibro({ url, clave }), creada_at: valor.creada_at });
  } catch (err) {
    logger.error("[finanzas/libro] POST error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
