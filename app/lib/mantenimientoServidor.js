// app/lib/mantenimientoServidor.js — Lado servidor de los responsables de
// mantenimiento: ¿el que llama está marcado "Responsable de mantenimiento"
// (empleados.es_mantenimiento, migración 133)? Lo usan /api/flota y
// /api/maquinaria para dejarle cargar vehículos y máquinas.
import { sbGet } from "./sbHelpers";

/** true si el empleado de la sesión es responsable de mantenimiento. Sin la 133, false. */
export async function esResponsableMantenimiento(sesion) {
  if (!sesion?.empleado_id || !sesion?.empresa_id) return false;
  try {
    const [yo] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&activo=eq.true&select=es_mantenimiento&limit=1`, { sesion })) || [];
    return yo?.es_mantenimiento === true;
  } catch {
    return false;
  }
}
