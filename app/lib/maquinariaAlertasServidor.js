// app/lib/maquinariaAlertasServidor.js — El aviso diario de la maquinaria
// (Mantenimiento, parte 34; migración 133). Lo usa /api/cron/flota-alertas
// con service_role, junto con el de la flota. Avisa al celular del
// responsable de mantenimiento de cada máquina y del suplente lo nuevo vencido
// o para pronto, y a gerencia y Administración un resumen. Lo que ya se avisó
// no se repite (maquinas.aviso_firma). Solo avisa: no bloquea nada.
import { sbGetAll, sbPatch } from "./sbHelpers";
import { enviarPushGerencia, enviarPushLegajos } from "./pushGerencia";
import { alertasMaquinaria, avisoDelDiaMaquina } from "./maquinaria";
import { CAMPOS_MAQUINA, destinatarios } from "./mantenimiento";
import { logger } from "./logger";

const textoAvisos = (alertas, max = 3) => alertas.slice(0, max).map((a) => a.texto).join(" · ") + (alertas.length > max ? ` · y ${alertas.length - max} más` : "");

/** Revisa las máquinas de una empresa y avisa lo nuevo. Devuelve { maquinas, avisados, push }. messaging: para pruebas. */
export async function revisarMaquinaria(empresa, hoy, { messaging } = {}) {
  const e = empresa.id;
  const [{ data: maquinas }, { data: tareas }, { data: empleados }] = await Promise.all([
    sbGetAll(`maquinas?empresa_id=eq.${e}&activo=eq.true&order=id.asc`),
    sbGetAll(`maquina_tareas?empresa_id=eq.${e}&activa=eq.true&order=id.asc`),
    sbGetAll(`empleados?empresa_id=eq.${e}&activo=eq.true&select=id,legajo&order=id.asc`),
  ]);
  // Sin la 133 no hay dónde anotar lo avisado: no se avisa (se repetiría todos los días)
  if (!maquinas.length || maquinas[0].aviso_firma === undefined) return { maquinas: 0, avisados: 0, push: 0 };
  const legajo = new Map(empleados.map((x) => [x.id, x.legajo]));
  const resumen = [];
  let push = 0;
  for (const m of maquinas) {
    const alertas = alertasMaquinaria([m], tareas, hoy);
    const { firma, nuevas, cambio } = avisoDelDiaMaquina(m, alertas);
    if (nuevas.length) {
      resumen.push({ m, nuevas });
      const legajos = destinatarios(m, CAMPOS_MAQUINA).map((id) => legajo.get(id)).filter((l) => l != null);
      if (legajos.length) {
        push += await enviarPushLegajos(e, legajos, {
          title: `🔧 ${m.codigo}: le toca mantenimiento`,
          body: textoAvisos(nuevas),
          data: { tipo: "maquina_alerta", maquina_id: m.id, url: `/${empresa.slug}` },
        }, { messaging }).catch((err) => { logger.error(`[maquinaria-alertas] push responsable máquina ${m.id}`, err); return 0; });
      }
    }
    if (cambio) await sbPatch(`maquinas?id=eq.${m.id}&empresa_id=eq.${e}`, { aviso_firma: firma || null, aviso_at: new Date().toISOString() });
  }
  if (resumen.length) {
    const vencidas = resumen.filter((r) => r.nuevas.some((a) => a.nivel === "vencido")).length;
    const body = resumen.slice(0, 3).map((r) => `${r.m.codigo}: ${textoAvisos(r.nuevas, 1)}`).join(" · ")
      + (resumen.length > 3 ? ` · y ${resumen.length - 3} máquina${resumen.length - 3 === 1 ? "" : "s"} más` : "");
    push += await enviarPushGerencia(e, {
      title: vencidas ? `🔧 Maquinaria: ${vencidas} máquina${vencidas === 1 ? "" : "s"} con algo vencido` : "🔧 Maquinaria: hay tareas para pronto",
      body,
      data: { tipo: "maquinaria_alertas", url: `/${empresa.slug}` },
    }, { messaging }).catch((err) => { logger.error(`[maquinaria-alertas] push gerencia empresa ${e}`, err); return 0; });
  }
  return { maquinas: maquinas.length, avisados: resumen.length, push };
}
