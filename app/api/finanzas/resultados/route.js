// /api/finanzas/resultados — Finanzas, parte F6a (migración 179): el estado
// de resultados (reglas en app/lib/finanzasResultados.js).
//
//   GET ?hasta=AAAA-MM[&division=X] → los 12 meses que terminan en ese mes
//       (por defecto, el mes en curso), ya calculados; con division, lo de esa
//       división y su % de lo compartido. Trae el resumen por división.
//   POST { accion: "config", materiales_pct?, ponderador? } → el % de las
//       entregas con que se estima el costo de materiales (0 = no estimar) y
//       el % de lo compartido que va a cada división (suman 100).
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige). La
// configuración va en config_sistema.
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { CLAVE_RESULTADOS, configResultados, estadoResultados, finDeMes, mesesHasta, resumenDivisiones, validarPonderador } from "../../../lib/finanzasResultados";

const FALTA_179 = "Para el estado de resultados falta correr la migración 179 en Supabase.";
const falta179 = (err) => /linea_eerr|atribucion/.test(String(err?.message)) && /does not exist|42703|PGRST20[045]|schema cache/.test(String(err?.message));
const COLUMNAS = "id,fecha,cuenta_debe,cuenta_haber,neto,total,total_ars,proyecto_id,centro_costo,estado,anulada_at";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data);

async function leerConfig(e) {
  const cfg = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_RESULTADOS}&select=valor&limit=1`, { silent: true, fallback: [] });
  return configResultados(cfg?.[0]?.valor);
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const q = new URL(request.url).searchParams;
  const pedido = q.get("hasta");
  const hasta = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(pedido || "")) ? pedido : hoyAr().slice(0, 7);
  const meses = mesesHasta(hasta);
  try {
    const [cuentas, ops, proyectos, config, centros] = await Promise.all([
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,rubro,linea_eerr,atribucion&order=codigo.asc`),
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&fecha=gte.${meses[0]}-01&fecha=lte.${finDeMes(hasta)}&select=${COLUMNAS}&order=fecha.asc,id.asc`, 200000),
      leer(sesion, `proyectos?empresa_id=eq.${e}&select=id,division`, 20000),
      leerConfig(e),
      leer(sesion, `fin_centros_costo?empresa_id=eq.${e}&select=codigo,division`).catch(() => []),
    ]);
    const base = { ops: ops || [], cuentas: cuentas || [], proyectos: proyectos || [], centros: centros || [], hasta, materialesPct: config.materiales_pct, ponderador: config.ponderador };
    const pedida = q.get("division") || "";
    const division = Object.keys(config.ponderador).includes(pedida) ? pedida : "";
    const estado = estadoResultados({ ...base, division });
    // Las divisiones de las OT, para armar el ponderador
    const divisiones = [...new Set([...(proyectos || []).map((p) => String(p.division || "").trim()).filter(Boolean), ...Object.keys(config.ponderador)])].sort((a, b) => a.localeCompare(b));
    const por_division = Object.keys(config.ponderador).length ? resumenDivisiones(base) : [];
    return NextResponse.json({ hasta, config, division, divisiones, por_division, ...estado });
  } catch (err) {
    if (falta179(err)) return NextResponse.json({ error: FALTA_179, falta_migracion: 179 }, { status: 409 });
    return errorFinanzas(err, "resultados GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (d?.accion !== "config") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  const e = sesion.empresa_id;
  const cambios = {};
  if ("materiales_pct" in d) {
    const n = Number(String(d.materiales_pct ?? "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100) return NextResponse.json({ error: "El % de materiales va de 0 a 100" }, { status: 400 });
    cambios.materiales_pct = Math.round(n * 10) / 10;
  }
  if ("ponderador" in d) {
    const p = validarPonderador(d.ponderador);
    if (p.error) return NextResponse.json({ error: p.error }, { status: 400 });
    cambios.ponderador = p.ponderador;
  }
  if (!Object.keys(cambios).length) return NextResponse.json({ error: "No vino nada para guardar" }, { status: 400 });
  try {
    // Lo que no vino queda como estaba
    const valor = { ...(await leerConfig(e)), ...cambios };
    const ya = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_RESULTADOS}&select=clave&limit=1`, { silent: true, fallback: [] });
    if (ya?.length) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_RESULTADOS}`, { valor });
    else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_RESULTADOS, valor });
    return NextResponse.json({ ok: true, config: valor });
  } catch (err) {
    return errorFinanzas(err, "resultados config");
  }
}
