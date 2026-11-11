// /api/finanzas/flujo — Finanzas, parte F6b: el flujo de caja real por mes y
// lo que viene por semana (reglas en app/lib/finanzasFlujo.js). Sin migración.
//
//   GET ?hasta=AAAA-MM → los 12 meses hasta ese mes (por defecto, el mes en
//       curso) en pesos y en dólares, y las próximas 8 semanas en pesos (con
//       los intereses de los plazos fijos al vencer).
//   POST { accion: "lineas", tipos, centros } → las líneas del flujo de cada
//       tipo de operación (y de cada centro de costo de Desarrollismo),
//       copiadas de la hoja dim_flujo del libro.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige). Las
// líneas van en config_sistema.
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { mesesHasta } from "../../../lib/finanzasResultados";
import { feriadosFinanzas } from "../../../lib/finanzasDiasHabiles";
import { CLAVE_PLANIFICACION } from "../../../lib/planificacion";
import { CLAVE_FLUJO, flujoPrevisto, flujoReal, saldoCajas, validarLineasFlujo } from "../../../lib/finanzasFlujo";
import { CLAVE_PLAZOS_FIJOS, interesesPorCobrar, leerGuardados, listaPlazos, pathOpsPlazos } from "../../../lib/finanzasPlazosFijos";
import { CLAVE_SUELDOS, ORIGEN_PAGO_SUELDO, leerConfigSueldos, pagadoPorEmpleado, totalesLiquidacion } from "../../../lib/finanzasSueldos";

const COLUMNAS = "id,fecha,tipo,centro_costo,total,total_ars,cuenta_debe,cuenta_haber,estado,anulada_at,origen,origen_id";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const config = async (e, clave) => (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${clave}&select=valor&limit=1`, { silent: true, fallback: [] }))?.[0]?.valor || null;

/** Lo que falta pagar de cada liquidación confirmada (si la 178 no está, nada). */
async function sueldosPorPagar(sesion, ops, cuentas) {
  const e = sesion.empresa_id;
  const liqs = await leer(sesion, `fin_liquidaciones?empresa_id=eq.${e}&estado=eq.confirmada&select=id,periodo,fecha,renglones`, 500).catch(() => []);
  if (!liqs.length) return [];
  const { conceptos } = leerConfigSueldos(await config(e, CLAVE_SUELDOS), cuentas);
  const pagos = ops.filter((o) => o.origen === ORIGEN_PAGO_SUELDO);
  return liqs.map((l) => {
    const pagado = pagadoPorEmpleado(l.id, pagos);
    const falta = totalesLiquidacion(l, conceptos).porEmpleado.reduce((s, x) => s + Math.max(0, x.total - (pagado[x.empleado_id] || 0)), 0);
    return { fecha: l.fecha, importe: Math.round(falta * 100) / 100, detalle: `Sueldos ${l.periodo}` };
  }).filter((s) => s.importe > 0);
}

/** Los intereses de los plazos fijos que faltan cobrar (parte 8 del 11/11). */
async function interesesPlazos(sesion, tesoreria, hoy) {
  const guardados = leerGuardados(await config(sesion.empresa_id, CLAVE_PLAZOS_FIJOS));
  if (!guardados.length) return [];
  const cuentasPf = tesoreria.filter((t) => t.tipo === "plazo_fijo").map((t) => t.cuenta);
  const ops = await leer(sesion, pathOpsPlazos(sesion.empresa_id, cuentasPf, hoy), 20000);
  return interesesPorCobrar(listaPlazos(guardados, ops, cuentasPf, hoy), hoy);
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const pedido = new URL(request.url).searchParams.get("hasta");
  const hoy = hoyAr();
  const hasta = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(pedido || "")) ? pedido : hoy.slice(0, 7);
  try {
    const [ops, tesoreria, cuentas, lineas, cheques, ordenes, planificacion] = await Promise.all([
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&select=${COLUMNAS}&order=fecha.asc,id.asc`, 300000),
      leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa`),
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa`),
      config(e, CLAVE_FLUJO),
      leer(sesion, `fin_cheques?empresa_id=eq.${e}&estado=in.(pendiente,en_cartera)&select=id,clase,estado,fecha_pago,importe,banco,numero,librador,beneficiario`, 20000).catch(() => []),
      leer(sesion, `fin_ordenes_pago?empresa_id=eq.${e}&estado=in.(aprobada,para_aprobar)&select=id,numero,proveedor_nombre,fecha,estado,total`).catch(() => []),
      config(e, CLAVE_PLANIFICACION),
    ]);
    const lin = validarLineasFlujo(lineas || {});
    const real = flujoReal({ ops, tesoreria, cuentas, lineas: lin, meses: mesesHasta(hasta) });
    const [sueldos, intereses] = await Promise.all([sueldosPorPagar(sesion, ops, cuentas), interesesPlazos(sesion, tesoreria, hoy).catch(() => [])]);
    const previsto = flujoPrevisto({ hoy, saldoHoy: saldoCajas(ops, tesoreria, "ARS"), cheques, ordenes, sueldos, intereses, feriados: feriadosFinanzas(planificacion) });
    return NextResponse.json({ hasta, hoy, ...real, previsto, lineas_cargadas: Object.keys(lin.tipos).length });
  } catch (err) {
    return errorFinanzas(err, "flujo GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (d?.accion !== "lineas") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  const valor = validarLineasFlujo(d);
  if (!Object.keys(valor.tipos).length) return NextResponse.json({ error: "No vino ningún tipo con su línea" }, { status: 400 });
  const e = sesion.empresa_id;
  try {
    const ya = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_FLUJO}&select=clave&limit=1`, { silent: true, fallback: [] });
    if (ya?.length) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_FLUJO}`, { valor });
    else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_FLUJO, valor });
    return NextResponse.json({ ok: true, tipos: Object.keys(valor.tipos).length, centros: Object.keys(valor.centros).length });
  } catch (err) {
    return errorFinanzas(err, "flujo lineas");
  }
}
