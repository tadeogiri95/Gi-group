// app/lib/finProcesoServidor.js — Avisos de fin de proceso del cron
// fin-proceso (cada 15 minutos; migración 149). Arma el plan vivo de hoy,
// busca los procesos que ya tenían que terminar y no terminaron, y avisa al
// celular de gerencia y del supervisor de la división de la OT. Cada aviso
// sale una sola vez (avisos_fin_proceso): si alguien anota "⏱ Faltan X h",
// el fin se corre y, cuando llega la nueva hora, vuelve a avisar.
import { sbGetAll, sbPost } from "./sbHelpers";
import { cargarPlanVivo } from "./informeProduccionServidor";
import { ventanasDeGrilla } from "./leadTimeHoras";
import { finesVencidos, minutosArg, textoAvisoFin } from "./finProceso";
import { enviarPushLegajos } from "./pushGerencia";
import { buscarDivision } from "./rutas";
import { hoyArg } from "./dates";
import { logger } from "./logger";

/**
 * @param {{ id: string, slug: string }} empresa
 * @param {{ ahora?: Date, messaging?: { send: Function } }} [opts]
 * @returns {Promise<{ vencidos: number, nuevos: number, push: number, sinTabla?: boolean }>}
 */
export async function revisarFinProcesos(empresa, { ahora = new Date(), messaging } = {}) {
  const e = empresa.id;
  const hoy = hoyArg(ahora);
  const base = await cargarPlanVivo(e, { hoy });
  if (!base.vivo.size) return { vencidos: 0, nuevos: 0, push: 0 };
  const vencidos = finesVencidos(base.vivo, { hoy, proyectos: base.abiertas, ahoraMin: minutosArg(ahora), ventanas: ventanasDeGrilla(base.empleados, base.divisiones, base.cfgValor) });
  if (!vencidos.length) return { vencidos: 0, nuevos: 0, push: 0 };
  // Sin la migración 149 no se sabe qué ya se avisó: mejor no avisar que avisar cada 15 minutos
  let ya;
  try {
    ya = new Set((await sbGetAll(`avisos_fin_proceso?empresa_id=eq.${e}&fecha=eq.${hoy}&select=clave`)).data.map((r) => r.clave));
  } catch (err) {
    logger.warn(`[fin-proceso] empresa ${e}: sin avisos_fin_proceso (${err?.message})`);
    return { vencidos: vencidos.length, nuevos: 0, push: 0, sinTabla: true };
  }
  const nuevos = vencidos.filter((v) => !ya.has(v.clave));
  if (!nuevos.length) return { vencidos: vencidos.length, nuevos: 0, push: 0 };
  // Primero se anota (si falla, no se avisa: así nunca se repite)
  await sbPost("avisos_fin_proceso?on_conflict=empresa_id,clave", nuevos.map((v) => ({ empresa_id: e, clave: v.clave, fecha: hoy, ot: v.ot, etapa: v.etapa })));

  // A quién: gerencia, y el supervisor de la división de cada OT
  const [ger, sup] = await Promise.all([
    sbGetAll(`empleados?empresa_id=eq.${e}&rol=eq.gerencial&activo=eq.true&select=legajo&order=legajo.asc`).catch(() => ({ data: [] })),
    // Sin la 075 no hay supervisores de división
    sbGetAll(`empleados?empresa_id=eq.${e}&rol=eq.administrativo&solo_su_division=eq.true&activo=eq.true&select=legajo,division&order=legajo.asc`).catch(() => ({ data: [] })),
  ]);
  const gerencia = ger.data.map((g) => String(g.legajo));
  const porLegajo = new Map();
  const sumar = (legajo, v) => {
    if (!porLegajo.has(legajo)) porLegajo.set(legajo, []);
    porLegajo.get(legajo).push(v);
  };
  for (const v of nuevos) {
    for (const l of gerencia) sumar(l, v);
    const div = buscarDivision(base.divisiones, base.abiertas.get(v.ot)?.division);
    for (const s of sup.data) {
      if (div && buscarDivision(base.divisiones, s.division)?.id === div.id) sumar(String(s.legajo), v);
    }
  }
  // Los que reciben lo mismo van juntos
  const grupos = new Map();
  for (const [legajo, lista] of porLegajo) {
    const k = lista.map((v) => v.clave).join(",");
    if (!grupos.has(k)) grupos.set(k, { lista, legajos: [] });
    grupos.get(k).legajos.push(legajo);
  }
  let push = 0;
  for (const { lista, legajos } of grupos.values()) {
    push += await enviarPushLegajos(e, legajos, {
      title: lista.length === 1 ? "⏰ Fin de proceso" : "⏰ Procesos por terminar",
      body: textoAvisoFin(lista),
      data: { tipo: "fin_proceso", fecha: hoy, url: `/${empresa.slug}` },
    }, { messaging }).catch((err) => { logger.error(`[fin-proceso] push empresa ${e}`, err); return 0; });
  }
  return { vencidos: vencidos.length, nuevos: nuevos.length, push };
}
