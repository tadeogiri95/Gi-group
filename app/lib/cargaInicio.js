// Qué datos pide el inicio según el rol (app liviana). Antes el operario
// bajaba la lista entera de empleados, las fichadas de toda la empresa y los
// pedidos de todos; y el dueño bajaba "su" fichada y "sus" tareas, que no usa.
// Cada consulta es un viaje al servidor: con muchos a la vez la app se sentía lenta.

/** @returns {boolean} si el usuario entra a la app de gestión */
export const esGestion = (usuario) => usuario?.rol === "gerencial" || usuario?.rol === "administrativo";

/**
 * Consultas del inicio. `todas: true` = traer todas las páginas (sbGetAll).
 * @param {{ usuario: object, hoy: string, lunes: string, ayer: string }} p
 * @returns {Record<string, { path: string, todas?: boolean }>}
 */
export function consultasInicio({ usuario, hoy, lunes, ayer }) {
  if (esGestion(usuario)) {
    return {
      // Todas las páginas: con más de 500 empleados (o 200 fichadas en el día) se cortaba sin avisar (F3-03)
      empleados: { todas: true, path: "empleados?select=id,legajo,nombre,apodo,email,rol,area,division,diagrama,activo,debe_cambiar_password,estado_activacion,created_at&activo=eq.true&order=legajo.asc,id.asc" },
      fichadasHoy: { todas: true, path: `fichadas?select=legajo,ingreso,egreso,horas_trabajadas,llegada_tarde,minutos_tarde,empleados(nombre,division)&fecha=eq.${hoy}&order=legajo.asc,id.asc` },
      solicitudes: { path: "solicitudes?select=*&order=created_at.desc&limit=50" },
      reglas: { path: "reglas_bot?activa=eq.true&order=id.asc" },
      notificaciones: { path: "notificaciones?destinatario_rol=eq.gerencial&order=created_at.desc&limit=10" },
    };
  }
  const leg = usuario.legajo;
  return {
    miFichada: { path: `fichadas?legajo=eq.${leg}&fecha=eq.${hoy}` },
    fichadasSemana: { path: `fichadas?legajo=eq.${leg}&fecha=gte.${lunes}&order=fecha.asc` },
    misSolicitudes: { path: `solicitudes?legajo=eq.${leg}&order=created_at.desc&limit=20` },
    notificaciones: { path: `notificaciones?destinatario_rol=eq.${leg}&order=created_at.desc&limit=10` },
    // Turno noche: si ingresó ayer y todavía no fichó la salida, el botón grande ofrece "Fichar salida"
    miAbierta: { path: `fichadas?legajo=eq.${leg}&fecha=gte.${ayer}&fecha=lt.${hoy}&ingreso=not.is.null&egreso=is.null&order=fecha.desc&limit=1` },
  };
}
