// app/lib/informeProduccionServidor.js — Consultas del informe de producción
// (migración 146). Lo usan /api/reportes/produccion (con el pase del usuario)
// y el cron reporte-diario (con service_role).
import { sbGetAll, sbPost, sbDelete } from "./sbHelpers";
import { calcularInforme, periodoDe, informeVacio, explicacionNota, textoPushInforme } from "./informeProduccion";
import { enviarPushLegajos } from "./pushGerencia";
import { sendInformeProduccion } from "./email";
import { logger } from "./logger";
import { CLAVE_PLANIFICACION, normalizarParametros } from "./planificacion";
import { itemsVigentes, diasExtraVigentes, planVivo, etapasDelPlan, horasSemanaDeGrilla, personalGantt } from "./ganttPlan";
import { modulosPorOt } from "./cargaPlanta";
import { piezasConManual } from "./avanceManual";
import { faltanManual } from "./ajustesTiempo";
import { retrabajoPendiente } from "./retrabajo";
import { hoyArg } from "./dates";

const vacio = () => ({ data: [] });
const DIA = 86400000;

/**
 * @param {string} empresaId
 * @param {"dia"|"semana"|"mes"} tipo
 * @param {string} fecha un día del período (AAAA-MM-DD, Argentina)
 * @param {{ sesion?: object }} [opts]
 */
export async function informeDeEmpresa(empresaId, tipo, fecha, { sesion } = {}) {
  const e = empresaId;
  const opts = { sesion };
  const periodo = periodoDe(tipo, fecha);
  const hoy = hoyArg();
  // Los escaneos desde el primer día del período (los de después corrigen el % al final)
  const desdeTs = encodeURIComponent(new Date(Date.parse(`${periodo.desde}T00:00:00-03:00`)).toISOString());
  const limite = hoyArg(new Date(Date.now() - 183 * DIA));
  const operarios = (extra) => sbGetAll(`empleados?empresa_id=eq.${e}&activo=eq.true&rol=eq.operativo&select=id,rol,division,diagrama,activo${extra}`, { ...opts, maxFilas: 5000 });
  const [proyectos, etapas, divisiones, cfg, planes, emp, piezas, pasos, avance, mods, ajustes, manual, retrabajos] = await Promise.all([
    // También las cerradas: una OT que se terminó en el período cuenta
    sbGetAll(`proyectos?empresa_id=eq.${e}&select=*&order=id.asc`, { ...opts, maxFilas: 20000 }),
    sbGetAll(`etapas?empresa_id=eq.${e}&activa=eq.true&order=orden.asc`, opts).catch(vacio),
    sbGetAll(`divisiones?empresa_id=eq.${e}&activa=eq.true&order=orden.asc`, opts).catch(vacio),
    sbGetAll(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANIFICACION}&select=valor`, opts).catch(vacio),
    // Sin la migración 138 no hay plan: el informe sale sin lo planificado
    sbGetAll(`planes_produccion?empresa_id=eq.${e}&estado=eq.confirmado&hasta=gte.${limite}&select=id,tipo,desde,hasta,division_id,dias_extra,confirmado_at&order=desde.asc`, opts).catch(vacio),
    operarios(",es_instalador,puesto_planta").catch(() => operarios(",es_instalador")).catch(() => operarios("")).catch(vacio),
    sbGetAll(`v_avance_piezas?empresa_id=eq.${e}&select=ot,etapa,total,pasaron,primer_paso,ultimo_paso`, { ...opts, maxFilas: 20000 }).catch(vacio),
    sbGetAll(`pasos_pieza?empresa_id=eq.${e}&requerida=eq.true&created_at=gte.${desdeTs}&select=ot,etapa,created_at&order=id.asc`, { ...opts, maxFilas: 100000 }).catch(vacio),
    sbGetAll(`avance_etapas?empresa_id=eq.${e}&select=ot,etapa,estado,terminada_at,aprobada_at`, opts).catch(vacio),
    sbGetAll(`piezas_ot?empresa_id=eq.${e}&modulo=not.is.null&select=ot,modulo`, { ...opts, maxFilas: 50000 }).catch(vacio),
    // Sin la 145 no hay "Faltan X h"; sin la 146 no hay historial del checkeo manual
    sbGetAll(`ajustes_tiempo_ot?empresa_id=eq.${e}&tipo=eq.faltan&select=ot,etapa,tipo,horas,pendiente,created_at&order=created_at.asc`, { ...opts, maxFilas: 20000 }).catch(vacio),
    sbGetAll(`avance_manual_historial?empresa_id=eq.${e}&select=ot,etapa,pct,created_at&order=created_at.asc`, { ...opts, maxFilas: 50000 }).catch(vacio),
    // Sin la 147 no hay retrabajo
    sbGetAll(`retrabajos_ot?empresa_id=eq.${e}&select=ot,etapa,horas,motivo,detalle,created_at,terminado_at&order=created_at.asc`, { ...opts, maxFilas: 20000 }).catch(vacio),
  ]);
  const ids = planes.data.map((p) => p.id);
  const items = ids.length
    ? (await sbGetAll(`plan_produccion_items?empresa_id=eq.${e}&plan_id=in.(${ids.join(",")})&select=plan_id,ot,etapa,fecha,horas,orden&order=fecha.asc,orden.asc`, { ...opts, maxFilas: 20000 }).catch(vacio)).data
    : [];
  const conItems = planes.data.map((p) => ({ ...p, items: items.filter((i) => i.plan_id === p.id) }));
  const vigentes = itemsVigentes(conItems);
  const cfgValor = cfg.data[0]?.valor || null;
  const etapasCodigo = etapasDelPlan(cfgValor, etapas.data, divisiones.data);
  const todas = new Map(proyectos.data.map((p) => [String(p.ot), p]));
  const abiertas = new Map(proyectos.data.filter((p) => p.estado !== "cerrado").map((p) => [String(p.ot), p]));
  const conManual = piezasConManual(piezas.data, proyectos.data);
  const vivo = planVivo(vigentes, {
    proyectos: abiertas, modulos: modulosPorOt(mods.data), etapasCodigo,
    avance: avance.data, piezas: conManual,
    terminadas: new Set(proyectos.data.filter((p) => p.terminado_planilla).map((p) => String(p.ot))), hoy,
    params: normalizarParametros(cfgValor), horasSemana: horasSemanaDeGrilla(emp.data, divisiones.data, cfgValor),
    personal: personalGantt(emp.data, divisiones.data, cfgValor), diasExtra: diasExtraVigentes(conItems),
    manual: faltanManual(ajustes.data), retrabajo: retrabajoPendiente(retrabajos.data),
  });
  for (const [ot] of vivo) if (!abiertas.has(ot)) vivo.delete(ot);
  return calcularInforme({
    periodo, items: vigentes, etapasCodigo,
    piezas: piezas.data, pasos: pasos.data, manual: manual.data, avance: avance.data,
    proyectos: todas, vivo, retrabajos: retrabajos.data,
  });
}

/**
 * El informe del día al terminar la jornada (cron reporte-diario, 23 h en
 * Argentina): se guarda (Reportes → 🏭 Producción), le llega por email a
 * administración (el email de la empresa) y al celular de gerencia. Si no hubo
 * nada planificado ni hecho, no hace nada.
 * @returns {Promise<{ vacio: boolean, guardado: boolean, avisos: number, email: boolean }>}
 */
export async function enviarInformeDelDia(empresa, fecha, { messaging } = {}) {
  const informe = await informeDeEmpresa(empresa.id, "dia", fecha);
  if (informeVacio(informe)) return { vacio: true, guardado: false, avisos: 0, email: false };
  const e = empresa.id;
  // Sin la migración 146 no se guarda, pero igual sale el aviso y el email
  let guardado = false;
  try {
    await sbDelete(`informes_produccion?empresa_id=eq.${e}&tipo=eq.dia&desde=eq.${fecha}`);
    await sbPost("informes_produccion", { empresa_id: e, tipo: "dia", desde: fecha, hasta: fecha, nota: informe.nota, datos: informe });
    guardado = true;
  } catch (err) {
    logger.warn(`[informe-produccion] empresa ${e}: no se guardó (${err?.message})`);
  }
  const { data: gerencia } = await sbGetAll(`empleados?empresa_id=eq.${e}&rol=eq.gerencial&activo=eq.true&select=legajo&order=legajo.asc`).catch(() => ({ data: [] }));
  const avisos = await enviarPushLegajos(e, gerencia.map((g) => g.legajo), {
    title: "Informe de producción",
    body: textoPushInforme(informe),
    data: { tipo: "informe_produccion", fecha, url: `/${empresa.slug}` },
  }, { messaging }).catch((err) => { logger.error(`[informe-produccion] push empresa ${e}`, err); return 0; });
  let email = false;
  if (empresa.admin_email) {
    const envio = await sendInformeProduccion({
      to: empresa.admin_email, empresa: empresa.nombre_corto || empresa.nombre, slug: empresa.slug,
      informe, explicacion: explicacionNota(informe), empresaId: e,
    }).catch((err) => ({ error: err }));
    email = !!envio && !envio.error;
  }
  return { vacio: false, guardado, avisos, email };
}
