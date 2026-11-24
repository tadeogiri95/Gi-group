// /api/finanzas/resultados — Finanzas, parte F6a (migración 179): el estado
// de resultados (reglas en app/lib/finanzasResultados.js).
//
//   GET ?solo=config → solo la configuración (el % de materiales, 30 % por
//       defecto; uno solo para toda Finanzas desde el 19/11).
//   GET ?hasta=AAAA-MM[&division=X] → los 12 meses que terminan en ese mes
//       (por defecto, el mes en curso), ya calculados; con division, lo de esa
//       división y su % de lo compartido. Trae el resumen por división.
//   POST { accion: "config", materiales_pct?, ponderador? } → el % de las
//       entregas con que se estima el costo de materiales (0 = no estimar) y
//       el % de lo compartido que va a cada división (suman 100).
//       materiales_real?: true usa el costo real de materiales de cada OT
//       entregada (auditoría 12/11, parte 4); las demás entregas, el %.
//
// Entregas con valor estimado (13/11): las OT terminadas sin PRECIO en el
// Plan valen materiales de sus necesidades ÷ el % de materiales, como en la cuenta corriente
// de clientes. El mes: el día que la sync de ventas la vio terminada
// (config_sistema "finanzas_entregas_estimadas") o, si no la anotó (cargada
// antes del "desde"), su fecha de entrega del Plan o, si ENTREGA no es una
// fecha, el último día de su SEMANA. Van en un renglón aparte de Entregas.
//
// Entregas del Plan (24/11): las OT terminadas CON precio que no tienen
// entrega anotada (entraron a Gypi antes de la fecha de inicio de Ventas)
// suman su PRECIO en el mes de su ENTREGA del Plan, en un renglón aparte;
// las que ya figuran en una entrega del libro se saltean y se listan
// (plan_ot y plan_en_libro_ot). Ver app/lib/finanzasEntregasPlan.js.
//
// 20/11: trae plazos_sin_interes { cantidad, importe, certificados }: los
// plazos fijos vencidos cuyo interés todavía no está registrado (aviso).
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige). La
// configuración va en config_sistema.
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { logger } from "../../../lib/logger";
import { materialesRealesDeOts } from "../../../lib/costoRealServidor";
import { entregasEstimadas, MOTIVOS_NO_ESTIMADA } from "../../../lib/finanzasEntregasEstimadas";
import { entregasDelPlan } from "../../../lib/finanzasEntregasPlan";
import { plazosSinInteres } from "../../../lib/finanzasPlazosFijosServidor";
import { CLAVE_RESULTADOS, configResultados, estadoResultados, finDeMes, mesesHasta, resumenDivisiones, validarPonderador } from "../../../lib/finanzasResultados";

export const maxDuration = 60;

const FALTA_179 = "Para el estado de resultados falta correr la migración 179 en Supabase.";
const falta179 = (err) => /linea_eerr|atribucion/.test(String(err?.message)) && /does not exist|42703|PGRST20[045]|schema cache/.test(String(err?.message));
const COLUMNAS = "id,fecha,cuenta_debe,cuenta_haber,neto,total,total_ars,proyecto_id,centro_costo,estado,origen,anulada_at";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data);

/** Materiales reales (MRP + de más + compras sin stock) de las OT con entregas en la ventana, por id de OT. */
async function materialesDeEntregas(e, ops, cuentas, otrasIds = []) {
  const ent = new Set(cuentas.filter((c) => /^ING_ENT/i.test(String(c.linea_eerr || ""))).map((c) => c.codigo));
  const ids = [...new Set([...ops.filter((o) => o.proyecto_id && (ent.has(o.cuenta_haber) || ent.has(o.cuenta_debe))).map((o) => Number(o.proyecto_id)), ...otrasIds])].slice(0, 400);
  if (!ids.length) return new Map();
  try {
    const proyectos = [];
    for (let i = 0; i < ids.length; i += 150) proyectos.push(...((await sbGetAll(`proyectos?empresa_id=eq.${e}&id=in.(${ids.slice(i, i + 150).join(",")})&select=*`, { maxFilas: 1000 })).data || []));
    const reales = await materialesRealesDeOts(e, proyectos);
    return new Map(proyectos.map((p) => [Number(p.id), reales.get(String(p.ot)) || 0]));
  } catch (err) {
    // Sin las migraciones del costo o la base no respondió: queda el %
    logger.warn(`[finanzas] resultados: materiales reales ${err?.message}`);
    return null;
  }
}

async function leerConfig(e) {
  const cfg = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_RESULTADOS}&select=valor&limit=1`, { silent: true, fallback: [] });
  return configResultados(cfg?.[0]?.valor);
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const q = new URL(request.url).searchParams;
  // 19/11 (punto 9): solo el % de materiales, para Finanzas → Configuración
  if (q.get("solo") === "config") return NextResponse.json({ config: await leerConfig(e) });
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
    // Las OT terminadas sin precio en el Plan, con su valor estimado (13/11)
    const [{ estimadas, noEstimadas }, plan] = await Promise.all([
      entregasEstimadas(sesion, `${meses[0]}-01`, finDeMes(hasta)),
      // Las OT terminadas con precio sin entrega anotada (24/11)
      entregasDelPlan(sesion, `${meses[0]}-01`, finDeMes(hasta)),
    ]);
    // Costo real de materiales de cada OT entregada (auditoría 12/11, parte 4), si el Dueño lo eligió
    const materialesOt = config.materiales_real ? await materialesDeEntregas(e, ops || [], cuentas || [], [...estimadas, ...plan.entregas].map((x) => x.proyecto_id)) : null;
    const base = { ops: ops || [], cuentas: cuentas || [], proyectos: proyectos || [], centros: centros || [], hasta, materialesPct: config.materiales_pct, ponderador: config.ponderador, materialesOt, entregasEstimadas: estimadas, entregasPlan: plan.entregas };
    const pedida = q.get("division") || "";
    const division = Object.keys(config.ponderador).includes(pedida) ? pedida : "";
    const estado = estadoResultados({ ...base, division });
    // Las divisiones de las OT, para armar el ponderador
    const divisiones = [...new Set([...(proyectos || []).map((p) => String(p.division || "").trim()).filter(Boolean), ...Object.keys(config.ponderador)])].sort((a, b) => a.localeCompare(b));
    const por_division = Object.keys(config.ponderador).length ? resumenDivisiones(base) : [];
    const estimadas_ot = estimadas.map(({ ot, fecha, valor }) => ({ ot, fecha, valor })).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ot.localeCompare(b.ot));
    const no_estimadas_ot = noEstimadas
      .map((x) => ({ ...x, motivo_texto: MOTIVOS_NO_ESTIMADA[x.motivo] }))
      .sort((a, b) => a.motivo.localeCompare(b.motivo) || (a.fecha || "").localeCompare(b.fecha || "") || a.ot.localeCompare(b.ot));
    // 20/11: plazos fijos vencidos sin el interés registrado (no entran en el resultado)
    const plazos_sin_interes = await plazosSinInteres(sesion).catch(() => null);
    const plan_ot = plan.entregas.map(({ ot, cliente, fecha, valor }) => ({ ot, cliente, fecha, valor }));
    return NextResponse.json({ hasta, config, division, divisiones, por_division, estimadas_ot, no_estimadas_ot, plan_ot, plan_en_libro_ot: plan.enLibro, plazos_sin_interes, ...estado });
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
  if ("materiales_real" in d) cambios.materiales_real = d.materiales_real === true;
  if ("ponderador" in d) {
    const p = validarPonderador(d.ponderador);
    if (p.error) return NextResponse.json({ error: p.error }, { status: 400 });
    cambios.ponderador = p.ponderador;
  }
  if (!Object.keys(cambios).length) return NextResponse.json({ error: "No vino nada para guardar" }, { status: 400 });
  try {
    // Lo que no vino queda como estaba
    const valor = { ...(await leerConfig(e)), ...cambios };
    if (!valor.materiales_real) delete valor.materiales_real;
    const ya = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_RESULTADOS}&select=clave&limit=1`, { silent: true, fallback: [] });
    if (ya?.length) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_RESULTADOS}`, { valor });
    else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_RESULTADOS, valor });
    return NextResponse.json({ ok: true, config: valor });
  } catch (err) {
    return errorFinanzas(err, "resultados config");
  }
}
