// app/lib/flotaAlertasServidor.js — El aviso diario de la flota (Mantenimiento,
// parte 30; migración 128). Lo usa /api/cron/flota-alertas con service_role.
import { sbGetAll, sbPatch } from "./sbHelpers";
import { enviarPushGerencia, enviarPushLegajos } from "./pushGerencia";
import { alertasVehiculo, avisoDelDia, textoAvisos } from "./alertasFlota";
import { textoVencimiento } from "./flota";
import { logger } from "./logger";

/** Revisa la flota de una empresa y avisa lo nuevo. Devuelve { vehiculos, avisados, push }. messaging: para pruebas. */
export async function revisarFlota(empresa, hoy, { messaging } = {}) {
  const e = empresa.id;
  const [{ data: vehiculos }, { data: papeles }, { data: checklists }, { data: empleados }] = await Promise.all([
    sbGetAll(`vehiculos?empresa_id=eq.${e}&activo=eq.true&order=id.asc`),
    sbGetAll(`vehiculo_papeles?empresa_id=eq.${e}&order=id.asc`),
    sbGetAll(`vehiculo_checklists?empresa_id=eq.${e}&select=id,vehiculo_id,created_at,km,secciones&order=id.asc`),
    sbGetAll(`empleados?empresa_id=eq.${e}&activo=eq.true&select=id,nombre,legajo,licencia_categoria,licencia_vencimiento&order=id.asc`),
  ]);
  const porId = new Map(empleados.map((x) => [x.id, x]));
  const resumen = [];
  let push = 0;
  for (const v of vehiculos) {
    const responsable = porId.get(v.responsable_id) || null;
    const alertas = alertasVehiculo(v, { papeles: papeles.filter((p) => p.vehiculo_id === v.id), checklists, responsable, hoy });
    const { firma, nuevas, cambio } = avisoDelDia(v, alertas);
    if (nuevas.length) {
      resumen.push({ v, nuevas });
      if (responsable?.legajo != null) {
        push += await enviarPushLegajos(e, [responsable.legajo], {
          title: `🚚 ${v.patente}: revisá tu vehículo`,
          body: textoAvisos(nuevas, textoVencimiento),
          data: { tipo: "flota_alerta", vehiculo_id: v.id, url: `/${empresa.slug}` },
        }, { messaging }).catch((err) => { logger.error(`[flota-alertas] push responsable vehículo ${v.id}`, err); return 0; });
      }
    }
    if (cambio) await sbPatch(`vehiculos?id=eq.${v.id}&empresa_id=eq.${e}`, { aviso_firma: firma || null, aviso_at: new Date().toISOString() });
  }
  if (resumen.length) {
    const vencidos = resumen.filter((r) => r.nuevas.some((a) => a.nivel === "vencido")).length;
    const body = resumen.slice(0, 3).map((r) => `${r.v.patente}: ${textoAvisos(r.nuevas, textoVencimiento, 1)}`).join(" · ")
      + (resumen.length > 3 ? ` · y ${resumen.length - 3} vehículo${resumen.length - 3 === 1 ? "" : "s"} más` : "");
    push += await enviarPushGerencia(e, {
      title: vencidos ? `🚚 Flota: ${vencidos} vehículo${vencidos === 1 ? "" : "s"} con algo vencido` : "🚚 Flota: hay cosas por vencer",
      body,
      data: { tipo: "flota_alertas", url: `/${empresa.slug}` },
    }, { messaging }).catch((err) => { logger.error(`[flota-alertas] push gerencia empresa ${e}`, err); return 0; });
  }
  return { vehiculos: vehiculos.length, avisados: resumen.length, push };
}
