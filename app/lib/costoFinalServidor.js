// app/lib/costoFinalServidor.js — Calcula y guarda el costo final de una OT
// cerrada (costo de OT, parte C; migración 167; app/lib/costoFinal.js). Lo
// usan /api/costo-final y el cron costos-ot. Va con la clave del servidor:
// quien lo llama ya verificó el permiso, y todo se filtra por la empresa.
import { sbGet, sbPatch, sbPost } from "./sbHelpers";
import { logger } from "./logger";
import { costoMaterialesDeOt } from "./costoMaterialesServidor";
import { costoHoraDe, costosRealesDeOts } from "./costoRealServidor";
import { fechaCargaOt } from "./costoMateriales";
import { armarConstancia, filaCalculada, separarCostos } from "./costoFinal";

export const FALTA_167 = "Para el costo final falta correr la migración 167 en Supabase.";

/** ¿El error es porque falta la migración 167? */
export const faltaMigracionCostoFinal = (err) => String(err?.message).includes("costos_finales_ot");

const filtroOt = (e, ot) => `costos_finales_ot?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}`;

/** Filas de costo de la OT, la más nueva primero. */
export async function costosDeOt(e, ot) {
  return (await sbGet(`${filtroOt(e, ot)}&select=*&order=created_at.desc,id.desc&limit=50`)) || [];
}

/** Foto de todo lo que entra en el costo final en este momento (el costo real, auditoría 12/11 parte 3). */
export async function constanciaDeOt(e, ot) {
  const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&select=*&limit=1`)) || [];
  if (!proyecto) {
    // La OT ya no está en la lista: queda lo del MRP y nada más
    const materiales = await costoMaterialesDeOt(e, ot);
    return armarConstancia({ materiales, horas: null, costoHora: await costoHoraDe(e) });
  }
  const costoHora = await costoHoraDe(e);
  const r = (await costosRealesDeOts(e, [proyecto], { costoHora })).get(String(proyecto.ot));
  return armarConstancia({ materiales: { fecha_ot: fechaCargaOt(proyecto), ...r.materiales }, horas: r.horas, costoHora, real: { comparativa: r.comparativa, extras: r.extras } });
}

/** Completa un costo pendiente (el que anotó la base al cerrar la OT). */
export async function completarPendiente(e, pendiente, { nombre = null } = {}) {
  const constancia = await constanciaDeOt(e, pendiente.ot);
  // Solo si sigue pendiente: si mientras tanto se reabrió o lo calculó otro, no se pisa
  const [fila] = (await sbPatch(`costos_finales_ot?id=eq.${pendiente.id}&empresa_id=eq.${e}&estado=eq.pendiente`, filaCalculada(constancia, { nombre }))) || [];
  return fila || null;
}

/**
 * Calcula a mano el costo de una OT cerrada. Si había uno vigente y
 * `recalcular`, el de antes queda anulado en el historial.
 * @returns {Promise<object>} la fila nueva
 */
export async function calcularAMano(e, ot, { nombre = null, recalcular = false, ahora = new Date() } = {}) {
  const { vigente, pendiente } = separarCostos(await costosDeOt(e, ot));
  if (pendiente) {
    const fila = await completarPendiente(e, pendiente, { nombre });
    if (fila) return fila;
  }
  if (vigente && !recalcular) return vigente;
  const constancia = await constanciaDeOt(e, ot);
  if (vigente) {
    await sbPatch(`costos_finales_ot?id=eq.${vigente.id}&empresa_id=eq.${e}&estado=eq.calculado`, {
      estado: "anulado", anulado_at: ahora.toISOString(),
      anulado_motivo: `Se volvió a calcular${nombre ? ` (${String(nombre).slice(0, 120)})` : ""}`,
    });
  }
  const [fila] = (await sbPost("costos_finales_ot", {
    empresa_id: e, ot,
    cerrada_at: vigente?.cerrada_at || ahora.toISOString(),
    motivo: vigente ? "recalculo" : "manual",
    ...filaCalculada(constancia, { nombre, ahora }),
  })) || [];
  return fila;
}

/** Calcula los cierres pendientes de todas las empresas (cron de cada mañana). */
export async function procesarPendientes({ limite = 25 } = {}) {
  const pendientes = (await sbGet(`costos_finales_ot?estado=eq.pendiente&select=id,empresa_id,ot&order=created_at.asc&limit=${limite}`)) || [];
  let calculados = 0, errores = 0;
  for (const p of pendientes) {
    try {
      if (await completarPendiente(p.empresa_id, p, { nombre: "Automático" })) calculados++;
    } catch (err) {
      errores++;
      logger.error(`[costo-final] pendiente ${p.id} (${p.ot})`, err);
    }
  }
  return { pendientes: pendientes.length, calculados, errores };
}
