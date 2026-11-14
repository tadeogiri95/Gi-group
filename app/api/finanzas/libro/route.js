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
// POST { accion: "estado", errores, avisos, repetidos, borrados } con la
//        clave del script (12/11): cómo salió la vuelta. Queda en
//        config_sistema para que el Dueño lo vea en Configuración.
// POST { accion: "borrar_repetidos", repetidos: [{ fila, copias, firma }] } →
//        el Dueño confirma qué copias del libro borrar; el script las borra
//        en la próxima vuelta (antes vuelve a mirar que sigan iguales).
// POST { accion: "manuales", grilla } con la clave del script (etapa 7,
//        14/11): los renglones CONFIRMADO de T-OPERACIONES desde la fecha del
//        Histórico (manuales_desde del GET). Gypi deja como pendiente lo
//        cargado a mano que todavía no tiene (app/lib/finanzasLibroManual.js)
//        y le contesta al script qué renglones pintar de amarillo.
import { NextResponse } from "next/server";
import { safeErrorMessage } from "../../../lib/validate";
import { sbGet, sbGetAll, sbPost, sbPatch } from "../../../lib/sbHelpers";
import { getModulosEmpresa } from "../../../lib/planEnforcement";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { sesionDueno } from "../../../lib/finanzasApi";
import { CLAVE_LIBRO_FIN, claveValida, datosParaLibro, empresaDeClave, estadoValido, generarClave, scriptLibro } from "../../../lib/finanzasLibro";
import { logger } from "../../../lib/logger";
import { CLAVE_TIPOS, tiposParaLibro } from "../../../lib/finanzasTipos";
import { cambiosCuentasLibro } from "../../../lib/finanzasLibroCuentas";
import { desdeDeExistentes, leerBaseHistorico, leerDesdeManuales } from "../../../lib/finanzasHistoricoBase";
import { pendientesDelLibro } from "../../../lib/finanzasLibroManual";

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

    const [operaciones, cheques, cuentas, proveedores, proyectos, empresas, cfgTipos, tipos, manualesDesde] = await Promise.all([
      leer(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&origen=not.in.(saldo_inicial,libro)&select=${COLUMNAS_OP}&order=fecha.asc,id.asc`, 50000),
      // Sin la migración 174 no hay cheques
      sbGetAll(`fin_cheques?empresa_id=eq.${e}&select=*&order=id.asc`, { maxFilas: 20000 }).then((r) => r.data || []).catch(() => []),
      leer(`fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre`),
      leer(`proveedores?empresa_id=eq.${e}&select=id,nombre`),
      leer(`proyectos?empresa_id=eq.${e}&select=id,ot`),
      sbGet(`empresa?id=eq.${e}&select=nombre,razon_social&limit=1`, { silent: true, fallback: [] }),
      sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_TIPOS}&select=valor&limit=1`, { silent: true, fallback: [] }),
      // Si falla, el libro igual recibe las operaciones (los cambios de cuentas van sin las recomendadas)
      leer(`fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,cuenta_debe,cuenta_haber,activo`).catch(() => []),
      // Etapa 7: desde cuándo mandar lo cargado a mano (sin Histórico pasado, nada)
      leerDesdeManuales(e).catch(() => null),
    ]);
    await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_LIBRO_FIN}`, {
      valor: { ...cfg.valor, ultima_lectura: new Date().toISOString() },
    }, { silent: true }).catch(() => {});
    const empresa = empresas?.[0]?.razon_social || empresas?.[0]?.nombre || "";
    const tiposNuevos = tiposParaLibro({ reescribir: Boolean(cfgTipos?.[0]?.valor?.pasado_at) });
    // Los 6 cambios de cuentas al libro (aprobados el 11/11): el script los aplica una vez
    const cambiosCuentas = cambiosCuentasLibro({ cuentas, tipos });
    const borrar = Array.isArray(cfg.valor?.borrar) ? cfg.valor.borrar : [];
    return NextResponse.json({
      ...datosParaLibro({ operaciones, cheques, cuentas, proveedores, proyectos, empresa, tiposNuevos, cambiosCuentas }),
      ...(borrar.length ? { borrar_repetidos: borrar } : {}),
      ...(manualesDesde ? { manuales_desde: manualesDesde } : {}),
    });
  } catch (err) {
    logger.error("[finanzas/libro] GET error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

/** El script cuenta cómo salió la vuelta (con su clave, sin sesión). */
async function estadoDelScript(request) {
  try {
    return await guardarEstado(request);
  } catch (err) {
    logger.error("[finanzas/libro] estado error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

async function guardarEstado(request) {
  const clave = (request.headers.get("authorization") || "").slice(7).trim();
  const e = empresaDeClave(clave);
  if (!e) return noAutorizado();
  const rl = checkRateLimit(`finanzas-libro-estado:${e}`, 30, 60_000);
  if (rl.limited) return NextResponse.json({ error: "Demasiados pedidos" }, { status: 429 });
  const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_LIBRO_FIN}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  if (!claveValida(clave, cfg?.valor?.hash)) return noAutorizado();
  const d = await request.json().catch(() => null);
  if (d?.accion === "manuales") return await revisarManuales(e, cfg, d);
  if (d?.accion !== "estado") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  const estado = estadoValido(d);
  const valor = { ...cfg.valor, estado: { ...estado, at: new Date().toISOString() } };
  // Lo que el script ya borró deja de estar pedido, y también lo que ya no
  // aparece igual (si el libro cambió, el Dueño lo vuelve a confirmar)
  if (Array.isArray(cfg.valor?.borrar)) {
    const siguen = new Set(estado.repetidos.map((r) => `${r.fila}|${r.firma}`));
    valor.borrar = cfg.valor.borrar.filter((b) => siguen.has(`${b.fila}|${b.firma}`));
  }
  await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_LIBRO_FIN}`, { valor });
  return NextResponse.json({ ok: true });
}

/**
 * Etapa 7: lo cargado a mano en el libro. Se compara con Gypi como el
 * Histórico (misma clave por renglón) y lo que falta queda pendiente para el
 * Dueño. Al script se le contesta qué renglones marcar "No viene de Gypi".
 */
async function revisarManuales(e, cfg, d) {
  const grilla = Array.isArray(d.grilla) ? d.grilla.slice(0, 100001) : [];
  if (grilla.length < 1 || !Array.isArray(grilla[0])) return NextResponse.json({ error: "Falta la hoja" }, { status: 400 });
  const base = await leerBaseHistorico(e);
  const desde = desdeDeExistentes(base.existentes);
  const ignorados = Array.isArray(cfg.valor?.manuales_ignorados) ? cfg.valor.manuales_ignorados : [];
  const at = new Date().toISOString();
  const r = desde ? pendientesDelLibro({ grilla, desde, base, ignorados }) : { pendientes: [], total: 0, filas: [], faltan_cuentas: [] };
  const manuales = { at, desde, pendientes: r.pendientes, total: r.total, faltan_cuentas: r.faltan_cuentas, ...(r.error ? { error: r.error } : {}) };
  // Se vuelve a leer: el estado de la vuelta pudo cambiar en el medio
  const [actual] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_LIBRO_FIN}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_LIBRO_FIN}`, { valor: { ...(actual?.valor || cfg.valor), manuales } });
  return NextResponse.json({ ok: true, revisado: !!desde && !r.error, desde, pendientes: r.filas, total: r.total });
}

async function borrarRepetidos(sesion, d) {
  const e = sesion.empresa_id;
  const filtro = `config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_LIBRO_FIN}`;
  const [cfg] = (await sbGet(`${filtro}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  if (!cfg?.valor?.hash) return NextResponse.json({ error: "El libro no está conectado" }, { status: 400 });
  const conocidos = new Map((cfg.valor.estado?.repetidos || []).map((r) => [`${r.fila}|${r.firma}`, r]));
  // Solo lo que el script mostró como repetido
  const borrar = (Array.isArray(d.repetidos) ? d.repetidos : [])
    .map((r) => conocidos.get(`${Number(r?.fila)}|${String(r?.firma || "")}`))
    .filter(Boolean)
    .map((r) => ({ fila: r.fila, copias: r.copias, firma: r.firma }));
  if (!borrar.length) return NextResponse.json({ error: "Elegí qué repetidos borrar" }, { status: 400 });
  await sbPatch(filtro, { valor: { ...cfg.valor, borrar } });
  return NextResponse.json({ ok: true, pedidos: borrar.length, copias: borrar.reduce((s, r) => s + r.copias, 0) });
}

export async function POST(request) {
  if ((request.headers.get("authorization") || "").startsWith("Bearer gyp_")) return estadoDelScript(request);
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  try {
    const d = await request.json().catch(() => ({}));
    if (d?.accion === "borrar_repetidos") return await borrarRepetidos(sesion, d);
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
