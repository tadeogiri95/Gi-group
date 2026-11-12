// /api/finanzas/inicio — Finanzas → 🏠 Inicio (parte 10 del plan del 11/11;
// reglas en app/lib/finanzasInicio.js). Sin migración.
//
//   GET → la plata en cajas y bancos (pesos y dólares), lo que entró y salió
//       en el mes y lo que hay que hacer: cheques que se debitan esta semana,
//       cheques para depositar, órdenes de pago para aprobar o pagar, plazos
//       fijos vencidos, Mi caja y operaciones para revisar, y costos de Flota
//       y Maquinaria para pasar a Finanzas, y órdenes de compra recibidas
//       sin factura (11/11). Lo que falla (una tabla de un
//       módulo que la empresa no tiene) queda en cero.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll } from "../../../lib/sbHelpers";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr, inicioMes } from "../../../lib/finanzasOperaciones";
import { feriadosFinanzas } from "../../../lib/finanzasDiasHabiles";
import { CLAVE_PLANIFICACION } from "../../../lib/planificacion";
import { saldosTesoreria, totalesTesoreria } from "../../../lib/finanzasTesoreria";
import { cajasPorMoneda, deltaCaja } from "../../../lib/finanzasFlujo";
import { ORIGEN_GASTO } from "../../../lib/finanzasGastos";
import { costosMantenimiento } from "../../../lib/finanzasIntegracion";
import { CLAVE_PLAZOS_FIJOS, leerGuardados, pathOpsPlazos, vencidosPendientes } from "../../../lib/finanzasPlazosFijos";
import { pendientesFinanzas } from "../../../lib/finanzasInicio";
import { ESTADOS_OC_RECIBIDA, faltaFacturaOc } from "../../../lib/ordenesCompra";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const leerSiHay = (sesion, path, maxFilas) => leer(sesion, path, maxFilas).catch(() => []);
const config = async (e, clave) => (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${clave}&select=valor&limit=1`, { silent: true, fallback: [] }))?.[0]?.valor || null;

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const hoy = hoyAr();
  const desdeMes = inicioMes(hoy);
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 12);
  const haceUnAnio = d.toISOString().slice(0, 10);
  try {
    const tesoreria = await leer(sesion, `fin_tesoreria?empresa_id=eq.${e}&select=cuenta,nombre,tipo,moneda,activa`);
    const lista = encodeURIComponent(tesoreria.map((t) => `"${String(t.cuenta).replace(/"/g, "")}"`).join(","));
    const cuentasPf = tesoreria.filter((t) => t.tipo === "plazo_fijo").map((t) => t.cuenta);
    const [ops, revisar, ordenes, cheques, planificacion, mantenimientos, fallas, gastos, plazos, opsPlazos, recibidas] = await Promise.all([
      tesoreria.length ? leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&or=(cuenta_debe.in.(${lista}),cuenta_haber.in.(${lista}))&select=fecha,total,total_ars,cuenta_debe,cuenta_haber,estado&order=fecha.asc`, 100000) : [],
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&estado=eq.para_revisar&anulada_at=is.null&select=id,origen`, 2000),
      leerSiHay(sesion, `fin_ordenes_pago?empresa_id=eq.${e}&estado=in.(para_aprobar,aprobada)&select=id,estado,total`),
      leerSiHay(sesion, `fin_cheques?empresa_id=eq.${e}&estado=in.(pendiente,en_cartera)&select=id,clase,estado,fecha_pago,importe`, 20000),
      config(e, CLAVE_PLANIFICACION),
      leerSiHay(sesion, `vehiculo_mantenimientos?empresa_id=eq.${e}&fecha=gte.${haceUnAnio}&costo=gt.0&select=id,vehiculo_id,tipo,fecha,costo`),
      leerSiHay(sesion, `maquina_fallas?empresa_id=eq.${e}&estado=eq.resuelta&cerrado_at=gte.${haceUnAnio}&costo=gt.0&select=id,maquina_id,estado,costo,cerrado_at,created_at`),
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_GASTO}&anulada_at=is.null&or=(origen_id.like.ga*,origen_id.like.gb*)&select=origen_id,total,anulada_at`, 20000),
      config(e, CLAVE_PLAZOS_FIJOS),
      cuentasPf.length ? leerSiHay(sesion, pathOpsPlazos(e, cuentasPf, hoy), 20000) : [],
      // Órdenes de compra con mercadería recibida y sin factura (sin el módulo Compras queda vacío)
      leerSiHay(sesion, `ordenes_compra?empresa_id=eq.${e}&estado=in.(${ESTADOS_OC_RECIBIDA.join(",")})&select=id,estado,factura_numero,factura_fecha`, 2000),
    ]);
    const confirmadas = ops.filter((o) => o.estado !== "para_revisar");
    const totales = totalesTesoreria(saldosTesoreria(confirmadas, tesoreria));
    // Lo que entró y salió de cajas y bancos en el mes (entre cajas propias no cuenta)
    const cajas = cajasPorMoneda(tesoreria);
    let entro = 0;
    let salio = 0;
    for (const o of confirmadas) {
      if (o.fecha < desdeMes || o.fecha > hoy) continue;
      const v = deltaCaja(o, cajas).ARS;
      if (v > 0) entro += v; else salio -= v;
    }
    const costos = costosMantenimiento({ mantenimientos, fallas, ops: gastos }).pendientes;
    const guardados = leerGuardados(plazos);
    const pendientes = pendientesFinanzas({
      hoy, revisar, ordenes, cheques, feriados: feriadosFinanzas(planificacion),
      costos: costos.length, costosTotal: costos.reduce((s, c) => s + c.costo, 0),
      sinFactura: recibidas.filter(faltaFacturaOc).length,
      plazosVencidos: guardados.length ? vencidosPendientes(guardados, opsPlazos, cuentasPf, hoy).length : 0,
    });
    return NextResponse.json({
      hoy, saldo: totales, mes: { desde: desdeMes, entro: Math.round(entro * 100) / 100, salio: Math.round(salio * 100) / 100 },
      pendientes, cajas: tesoreria.length,
    });
  } catch (err) {
    return errorFinanzas(err, "inicio GET");
  }
}
