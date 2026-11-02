// app/lib/nombreOt.js — Cómo se nombra una OT en toda la app (Tadeo, 02/11):
// siempre Código · Cliente · Proyecto · Descripción, para reconocerla a la
// primera. Del Plan de trabajo: Código = columna A (ot), Cliente = D
// (cliente), Proyecto = E (obra) y Descripción = F (descripcion). Nunca la
// columna C (PROYECTO / OBRA), que no le sirve (27/10).
//
// Todas las pantallas arman el nombre de la OT con estas funciones (o con el
// componente NombreOt): si mañana cambia el orden o se suma un dato, se cambia
// acá solo.

const limpio = (v) => String(v ?? "").trim();
const igual = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * Los cuatro datos de la OT, sin vacíos ni repetidos (si la obra o la
 * descripción dicen lo mismo que el cliente, no se repiten).
 * @param {{ot?: any, cliente?: string, obra?: string, descripcion?: string} | null | undefined} p
 * @returns {{ codigo: string, cliente: string, proyecto: string, descripcion: string }}
 */
export function partesOt(p) {
  const codigo = limpio(p?.ot);
  const cliente = limpio(p?.cliente);
  let proyecto = limpio(p?.obra);
  let descripcion = limpio(p?.descripcion);
  if (proyecto && cliente && igual(proyecto, cliente)) proyecto = "";
  if (descripcion && ((cliente && igual(descripcion, cliente)) || (proyecto && igual(descripcion, proyecto)))) descripcion = "";
  return { codigo, cliente, proyecto, descripcion };
}

/** "RIOFRIO IVAN · EDIFICIO MAIPU · COCINA": todo menos el código. */
export function detalleOt(p, sep = " · ") {
  const { cliente, proyecto, descripcion } = partesOt(p);
  return [cliente, proyecto, descripcion].filter(Boolean).join(sep);
}

/** "OT 7961 · RIOFRIO IVAN · EDIFICIO MAIPU · COCINA". Sin código, solo el detalle. */
export function textoOt(p, sep = " · ") {
  const { codigo } = partesOt(p);
  const detalle = detalleOt(p, sep);
  return [codigo ? `OT ${codigo}` : "", detalle].filter(Boolean).join(sep);
}

/** Mapa de OT por código (texto), para buscar los datos de una OT que solo trae el número. */
export function mapaOts(proyectos = []) {
  return new Map((proyectos || []).filter((p) => p?.ot != null && p.ot !== "").map((p) => [String(p.ot).trim(), p]));
}

/**
 * Datos de una OT para nombrarla: los de la lista de OT si está; si no, lo
 * que traiga el renglón (cliente, obra, descripción). Así un pedido de
 * compras, un movimiento o un renglón de la minuta que guardó solo el
 * número también se ven completos.
 * @param {any} ot código de la OT
 * @param {Map<string, any> | null | undefined} mapa de mapaOts()
 * @param {object} [respaldo] datos propios del renglón
 */
export function otCompleta(ot, mapa, respaldo = {}) {
  const codigo = limpio(ot);
  if (!codigo) return null;
  const p = mapa?.get?.(codigo);
  return p ? { ...respaldo, ...p, ot: p.ot } : { ...respaldo, ot: codigo };
}

/**
 * Nombre de la OT de un renglón que guardó una copia de sus datos (minuta:
 * ot, cliente y "proyecto" = lo que se hace). Con la lista de OT a mano usa
 * los datos de la OT; si no, lo guardado. Sin OT (diseño, presupuesto):
 * proyecto · cliente.
 */
export function textoRenglonOt(it, mapa = null) {
  if (!it) return "";
  if (limpio(it.ot)) return textoOt(otCompleta(it.ot, mapa, { cliente: it.cliente, descripcion: it.proyecto }));
  return [limpio(it.proyecto), limpio(it.cliente)].filter(Boolean).join(" · ");
}
