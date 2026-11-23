// app/lib/inicioGerencia.js — Cuentas del Inicio de gerencia (Panel de control, 23/11):
// las OT que están de verdad en producción y los escaneos de piezas del día.
import { avancePorOt } from "./piezas";

/**
 * OT en curso en producción, según el avance real: piezas escaneadas o el %
 * cargado a mano (checkeo manual, 141). Entra la OT abierta que tiene algo de
 * avance y no llegó al 100 %. Las terminadas en la planilla no entran.
 * @param {object[]} proyectos OT abiertas (estado distinto de cerrado)
 * @param {object[]} piezas filas de v_avance_piezas con el manual encima (leerAvanceYHoras().piezas)
 * @returns {{ proyecto: object, porcentaje: number }[]} la más avanzada primero
 */
export function otEnProduccion(proyectos = [], piezas = []) {
  const avance = avancePorOt(piezas || []);
  const out = [];
  for (const p of proyectos || []) {
    if (!p || p.estado === "cerrado" || p.terminado_planilla) continue;
    const porcentaje = avance.get(String(p.ot))?.porcentaje;
    if (porcentaje == null || !(porcentaje > 0) || porcentaje >= 100) continue;
    out.push({ proyecto: p, porcentaje });
  }
  return out.sort((a, b) => b.porcentaje - a.porcentaje || String(a.proyecto.ot).localeCompare(String(b.proyecto.ot), "es", { numeric: true }));
}

/** Desde cuándo se leen los escaneos de hoy: la medianoche de Argentina del día dado. */
export function inicioDelDiaArg(hoy) {
  return `${hoy}T00:00:00-03:00`;
}

/**
 * Escaneos del día listos para mostrar, el último primero.
 * @param {object[]} filas pasos_pieza con piezas_ot(nombre,modulo) y empleados(nombre)
 * @param {object[]} etapas etapas de la empresa ({ codigo, nombre })
 * @returns {{ id: any, ot: string, pieza: string, modulo: string|null, proceso: string, quien: string|null, hora: string }[]}
 */
export function escaneosDelDia(filas = [], etapas = []) {
  const nombres = new Map((etapas || []).filter((e) => e && e.codigo != null).map((e) => [Number(e.codigo), e.nombre]));
  return (filas || [])
    .filter((f) => f && f.created_at)
    .map((f) => ({
      id: f.id,
      ot: String(f.ot ?? ""),
      pieza: f.piezas_ot?.nombre || "Pieza",
      modulo: f.piezas_ot?.modulo || null,
      proceso: nombres.get(Number(f.etapa)) || `Etapa ${f.etapa}`,
      quien: f.empleados?.nombre || null,
      hora: f.created_at,
    }))
    .sort((a, b) => String(b.hora).localeCompare(String(a.hora)) || Number(b.id) - Number(a.id));
}

/** Escaneos por OT (para el resumen de arriba): [{ ot, cantidad }], la de más escaneos primero. */
export function escaneosPorOt(escaneos = []) {
  const cuenta = new Map();
  for (const e of escaneos || []) cuenta.set(e.ot, (cuenta.get(e.ot) || 0) + 1);
  return [...cuenta].map(([ot, cantidad]) => ({ ot, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad || a.ot.localeCompare(b.ot, "es", { numeric: true }));
}
