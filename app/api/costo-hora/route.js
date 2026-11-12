// /api/costo-hora — Costo de la hora de mano de obra (Órdenes de Producción,
// parte 8; ítem 39; migración 102). Un solo valor para toda la empresa.
//
//   GET  → { costo_hora, desglose } (null si todavía no se cargó)
//   POST → { desglose: { mano_obra, burden, gac } } guarda las tres partes y
//          el costo de la hora = la suma (auditoría 12/11, parte 10; las
//          partes van en config_sistema, sin migración). { costo_hora } solo
//          sigue andando y borra el desglose.
//
// Solo el dueño (rol gerencial) y, desde el 05/11, el Supervisor; el
// administrativo no ve costos. Con RLS_RUTAS=on el dueño va con su pase
// ({ sesion }) y la base exige el rol gerencial (migración 102). El pase no
// sabe si un administrativo es Supervisor, así que para el Supervisor la
// lectura y escritura van con la clave del servidor, después de que
// comoDueno() lo verificó acá (filtrando siempre por su empresa).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { costoHoraBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch } from "../../lib/sbHelpers";
import { logger } from "../../lib/logger";
import { comoDueno } from "../../lib/alcance";
import { CLAVE_DESGLOSE, leerDesglose, totalDesglose } from "../../lib/costoHoraDesglose";

const FALTA_MIGRACION = "Para guardar el costo de la hora falta correr la migración 102 en Supabase.";

function faltaMigracion(err) {
  return String(err?.message).includes("costos_empresa");
}

async function sesionDueno(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (!(await comoDueno(sesion))) {
    return { response: NextResponse.json({ error: "Solo el dueño y los supervisores pueden ver y cambiar los costos" }, { status: 403 }) };
  }
  return { sesion };
}

const opcionesBase = (sesion) => (sesion.rol === "gerencial" ? { sesion } : {});

async function leerDesgloseDe(e) {
  const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_DESGLOSE}&select=valor&limit=1`, { silent: true, fallback: [] }).catch(() => [])) || [];
  return leerDesglose(cfg?.valor);
}

export async function GET(request) {
  try {
    const { sesion, response } = await sesionDueno(request);
    if (response) return response;
    try {
      const [fila] = (await sbGet(`costos_empresa?empresa_id=eq.${sesion.empresa_id}&select=costo_hora&limit=1`, opcionesBase(sesion))) || [];
      const desglose = await leerDesgloseDe(sesion.empresa_id);
      return NextResponse.json({ costo_hora: fila ? Number(fila.costo_hora) : null, desglose });
    } catch (err) {
      // Sin la migración no hay costo cargado: la app sigue, sin costos
      if (faltaMigracion(err)) return NextResponse.json({ costo_hora: null, falta_migracion: true });
      throw err;
    }
  } catch (err) {
    logger.error("[costo-hora] GET", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { sesion, response } = await sesionDueno(request);
    if (response) return response;
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(costoHoraBody, raw);
    if (parsed.response) return parsed.response;

    const e = sesion.empresa_id;
    const opts = opcionesBase(sesion);
    const desglose = parsed.data.desglose || null;
    const costoHora = desglose ? totalDesglose(desglose) : parsed.data.costo_hora;
    if (costoHora > 99999999) return NextResponse.json({ error: "La hora completa es demasiado grande" }, { status: 400 });
    const cambios = { costo_hora: costoHora, actualizado_por: sesion.empleado_id || null, updated_at: new Date().toISOString() };
    try {
      const filtro = `costos_empresa?empresa_id=eq.${e}`;
      const [actual] = (await sbGet(`${filtro}&select=empresa_id&limit=1`, opts)) || [];
      if (actual) await sbPatch(filtro, cambios, opts);
      else await sbPost("costos_empresa", { empresa_id: e, ...cambios }, opts);
    } catch (err) {
      if (faltaMigracion(err)) return NextResponse.json({ error: FALTA_MIGRACION }, { status: 409 });
      throw err;
    }
    // Las tres partes (con la clave del servidor: config_sistema es de la empresa y ya se verificó el rol)
    const filtroCfg = `config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_DESGLOSE}`;
    try {
      const [cfg] = (await sbGet(`${filtroCfg}&select=clave&limit=1`, { silent: true, fallback: [] })) || [];
      const valor = desglose ? { ...desglose, actualizado_at: new Date().toISOString() } : {};
      if (cfg) await sbPatch(filtroCfg, { valor });
      else if (desglose) await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_DESGLOSE, valor });
    } catch (err) {
      // La hora completa ya quedó guardada: solo falta el detalle de las partes
      logger.warn("[costo-hora] no se guardó el desglose", err);
      if (desglose) return NextResponse.json({ error: "Se guardó la hora completa pero no sus tres partes. Probá de nuevo." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, costo_hora: costoHora, desglose: desglose ? leerDesglose(desglose) : null });
  } catch (err) {
    logger.error("[costo-hora] POST", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
