// /api/stock/canto — ✂️ Canto usado (pedido de Tadeo, 26/11; migración 210).
// Reglas del cálculo en app/lib/cantoConsumo.js. Solo la oficina.
//
// GET  ?ot=…  → por OT, el canto usado según los escaneos (metros con el
//              desperdicio), lo ya asentado, lo que falta asentar y el
//              artículo del MRP de cada tipo (o las opciones para elegir).
// POST { accion: "asentar", ot, renglones: [{ clave, sku, metros }] } → un
//              consumo por renglón con la OT (movimientos_stock, canto =
//              clave): el script "Gypi" lo lleva a fact_consumos_stock. Se
//              recuerda el artículo de cada tipo.
//      { accion: "elegir", clave, sku } → recuerda el artículo de un tipo.
// Con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { validateBody, safeErrorMessage } from "../../../lib/validate";
import { cantoUsadoBody } from "../../../lib/schemas";
import { sbGet, sbGetAll, sbPost, sbHeaders } from "../../../lib/sbHelpers";
import { broadcastRefresh } from "../../../lib/broadcast";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { requireModuloSesion } from "../../../lib/accesosServidor";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { reglasPieza } from "../../../lib/piezas";
import { CLAVE_PLANIFICACION, normalizarParametros } from "../../../lib/planificacion";
import { cantoUsado, pendientesCanto, elegirArticuloCanto, textoCanto, PCT_DESPERDICIO_DEFECTO } from "../../../lib/cantoConsumo";
import { falta214 } from "../../../lib/cantoLados";
import { fechaDelMovimiento } from "../../../lib/movimientosStock";
import { logger } from "../../../lib/logger";

const LOTE_IDS = 200;
const leer = (sesion, path, maxFilas = 100000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const enLista = (vals) => `in.(${[...new Set(vals)].map((v) => `"${String(v).replace(/["\\]/g, "")}"`).join(",")})`;

/** ¿Falta la migración 210? */
const falta210 = (err) => /cantos|canto_articulos|\bcanto\b/.test(String(err?.message)) && /column|does not exist|could not find|PGRST20[45]|42703|42P01/i.test(String(err?.message));
const AVISO_210 = "Para el canto usado falta correr la migración 210 en Supabase.";

async function permiso(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (!ROLES_GESTION.has(sesion.rol)) return { response: NextResponse.json({ error: "El canto usado lo asienta la oficina" }, { status: 403 }) };
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return { response: sinPlan };
  const sinModulo = await requireModuloSesion(sesion, "stock");
  if (sinModulo) return { response: sinModulo };
  return { sesion };
}

/** Desperdicio de canto de la empresa (Planificación → Parámetros). */
async function pctDesperdicio(sesion) {
  const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${sesion.empresa_id}&clave=eq.${CLAVE_PLANIFICACION}&select=valor&limit=1`, { sesion, silent: true, fallback: [] })) || [];
  const p = normalizarParametros(cfg?.valor || null).pct_desperdicio_canto;
  return p ?? PCT_DESPERDICIO_DEFECTO;
}

/** Artículos de canto del stock (los demás no hacen falta). */
const articulosCanto = (sesion) => leer(sesion, `articulos_stock?empresa_id=eq.${sesion.empresa_id}&nombre=ilike.*CANTO*&select=sku,nombre,color,unidad,activo&order=sku.asc`, 20000);

async function recordados(sesion) {
  const filas = await leer(sesion, `canto_articulos?empresa_id=eq.${sesion.empresa_id}&select=clave,sku`, 5000);
  return new Map(filas.map((f) => [f.clave, f.sku]));
}

export async function GET(request) {
  try {
    const { sesion, response } = await permiso(request);
    if (response) return response;
    const e = sesion.empresa_id;
    const otPedida = new URL(request.url).searchParams.get("ot");
    const filtroOt = otPedida ? `&ot=eq.${encodeURIComponent(otPedida.slice(0, 40))}` : "";

    const etapas = (await sbGet(`etapas?empresa_id=eq.${e}&select=codigo,nombre,orden,activa,por_pieza,columna_pieza`, { sesion })) || [];
    const deCanto = reglasPieza(etapas).filter((r) => r.porLados);
    if (!deCanto.length) return NextResponse.json({ ots: [], sinEtapa: true });
    const codigos = deCanto.map((r) => r.codigo).join(",");

    let lados;
    let pasos;
    try {
      // Con la 214 cada escaneo dice qué lado se pegó; sin ella, solo cuántos
      const ladosDe = (campos) => leer(sesion, `lados_pieza?empresa_id=eq.${e}&etapa=in.(${codigos})${filtroOt}&select=${campos}&order=id.asc`);
      [lados, pasos] = await Promise.all([
        ladosDe("pieza_id,lado").catch((err) => (falta214(err) ? ladosDe("pieza_id") : Promise.reject(err))),
        leer(sesion, `pasos_pieza?empresa_id=eq.${e}&etapa=in.(${codigos})${filtroOt}&select=pieza_id&order=id.asc`),
      ]);
    } catch (err) {
      if (/lados_pieza/.test(String(err?.message))) return NextResponse.json({ error: "Para el canto usado falta correr la migración 209 en Supabase." }, { status: 409 });
      throw err;
    }
    const escaneos = new Map();
    for (const l of lados) {
      const id = Number(l.pieza_id);
      if (!escaneos.has(id)) escaneos.set(id, []);
      escaneos.get(id).push({ lado: l.lado || null });
    }
    const completas = new Set(pasos.map((p) => Number(p.pieza_id)));
    const ids = [...new Set([...escaneos.keys(), ...completas])];

    const piezas = [];
    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      piezas.push(...((await sbGet(`piezas_ot?empresa_id=eq.${e}&id=in.(${ids.slice(i, i + LOTE_IDS).join(",")})&select=id,ot,material,cantos`, { sesion })) || []));
    }
    const pct = await pctDesperdicio(sesion);
    const usado = cantoUsado({ piezas, escaneos, completas, pct });
    const asentados = await leer(sesion, `movimientos_stock?empresa_id=eq.${e}&anulado=eq.false&tipo=eq.consumo&canto=not.is.null${filtroOt}&select=ot,canto,cantidad&order=id.asc`);
    const ots = pendientesCanto(usado, asentados);

    const [articulos, rec, necesidades] = await Promise.all([
      articulosCanto(sesion),
      recordados(sesion),
      ots.length
        ? leer(sesion, `necesidades_stock?empresa_id=eq.${e}&ot=${encodeURIComponent(enLista(ots.map((o) => o.ot)))}&select=ot,sku`).catch(() => [])
        : Promise.resolve([]),
    ]);
    const necPorOt = new Map();
    for (const n of necesidades) {
      const s = necPorOt.get(String(n.ot)) || new Set();
      s.add(n.sku);
      necPorOt.set(String(n.ot), s);
    }
    const resumen = (a) => ({ sku: a.sku, nombre: a.nombre, unidad: a.unidad || null });
    const porSku = new Map(articulos.map((a) => [a.sku, a]));
    const respuesta = ots.map((o) => ({
      ot: o.ot,
      renglones: o.renglones.map((r) => {
        const elegido = elegirArticuloCanto({ clave: r.clave, articulos, necesidadesOt: necPorOt.get(String(o.ot)), recordados: rec });
        return {
          ...r,
          texto: textoCanto(r.clave),
          sku: elegido.sku,
          por: elegido.por,
          articulo: elegido.sku && porSku.get(elegido.sku) ? resumen(porSku.get(elegido.sku)) : null,
          opciones: elegido.opciones.slice(0, 20).map(resumen),
        };
      }),
    }));
    return NextResponse.json({
      ots: respuesta,
      pct,
      // Para elegir a mano cuando no hay opciones parecidas
      cantos: articulos.filter((a) => a.activo !== false).slice(0, 2000).map(resumen),
    });
  } catch (err) {
    if (falta210(err)) return NextResponse.json({ error: AVISO_210 }, { status: 409 });
    logger.error("[stock/canto] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

/** Guarda (o cambia) el artículo de un tipo de canto. */
async function recordar(sesion, filas) {
  if (!filas.length) return;
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/canto_articulos?on_conflict=empresa_id,clave`, {
    method: "POST",
    headers: await sbHeaders({ sesion }, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(filas.map((f) => ({ empresa_id: sesion.empresa_id, clave: f.clave, sku: f.sku, updated_at: new Date().toISOString() }))),
  });
  if (!r.ok) throw new Error(`POST canto_articulos: ${await r.text()}`);
}

export async function POST(request) {
  try {
    const { sesion, response } = await permiso(request);
    if (response) return response;
    let raw;
    try { raw = await request.json(); } catch { return NextResponse.json({ error: "Datos inválidos" }, { status: 400 }); }
    const parsed = validateBody(cantoUsadoBody, raw);
    if (parsed.error) return parsed.response;
    const datos = parsed.data;
    const e = sesion.empresa_id;
    const opts = { sesion };

    const skus = datos.accion === "asentar" ? datos.renglones.map((r) => r.sku) : [datos.sku];
    const articulos = (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=${encodeURIComponent(enLista(skus))}&select=sku,nombre,unidad,division,activo`, opts)) || [];
    const porSku = new Map(articulos.map((a) => [a.sku, a]));
    const falta = skus.find((s) => !porSku.get(s) || porSku.get(s).activo === false);
    if (falta) return NextResponse.json({ error: `El artículo ${falta} no está en el stock. Puede que falte sincronizar la planilla.` }, { status: 404 });

    if (datos.accion === "elegir") {
      await recordar(sesion, [{ clave: datos.clave, sku: datos.sku }]);
      return NextResponse.json({ ok: true });
    }

    const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(datos.ot)}&select=ot&limit=1`, opts)) || [];
    if (!proyecto) return NextResponse.json({ error: `No encontré la OT ${datos.ot}` }, { status: 404 });
    const [empleado] = sesion.empleado_id
      ? (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=nombre&limit=1`, { ...opts, silent: true, fallback: [] })) || []
      : [];
    const { fecha } = fechaDelMovimiento(null);
    const filas = datos.renglones.map((r) => {
      const a = porSku.get(r.sku);
      return {
        empresa_id: e, tipo: "consumo", sku: a.sku, nombre: a.nombre ?? null, unidad: a.unidad ?? null, division: a.division ?? null,
        cantidad: Math.round(r.metros * 1000) / 1000, ot: proyecto.ot, canto: r.clave,
        notas: `Canto escaneado en planta (${textoCanto(r.clave)})`.slice(0, 300),
        empleado_id: sesion.empleado_id || null,
        legajo: Number.isInteger(sesion.legajo) ? sesion.legajo : null,
        empleado_nombre: empleado?.nombre ? String(empleado.nombre).slice(0, 120) : null,
        fecha,
      };
    });
    await sbPost("movimientos_stock", filas, opts);
    // Para la próxima, el mismo artículo para cada tipo (si falla, ya quedó asentado)
    await recordar(sesion, datos.renglones).catch((err) => logger.warn?.("[stock/canto] no se pudo recordar el artículo", { error: err?.message }));
    broadcastRefresh(e, "movimientos_stock");
    return NextResponse.json({ ok: true, cargados: filas.length });
  } catch (err) {
    if (falta210(err)) return NextResponse.json({ error: AVISO_210 }, { status: 409 });
    logger.error("[stock/canto] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
