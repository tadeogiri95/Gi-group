// app/lib/plantas.js — Plantas o sedes de la empresa (ítem 36, parte 3).
// Cada empresa tiene una principal (migración 084). Con una sola planta la app
// no muestra nada nuevo: los selectores aparecen recién cuando hay dos o más.

/** Plantas activas, la principal primero y el resto por nombre. */
export function ordenarPlantas(plantas) {
  return (plantas || [])
    .filter((p) => p && p.activa !== false)
    .sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0) || String(a.nombre).localeCompare(String(b.nombre), "es"));
}

export function hayVariasPlantas(plantas) {
  return ordenarPlantas(plantas).length > 1;
}

export function nombrePlanta(plantas, id) {
  return (plantas || []).find((p) => p.id === id)?.nombre || null;
}

/**
 * Puntos donde puede fichar alguien de esa planta: los de su planta y los que
 * no tienen planta. Si su planta no tiene ningún punto propio, valen todos
 * (así agregar una planta nueva no deja a nadie sin poder fichar).
 */
export function zonasDePlanta(zonas, plantaId) {
  const todas = zonas || [];
  if (!plantaId) return todas;
  const propias = todas.filter((z) => z.planta_id === plantaId);
  if (propias.length === 0) return todas;
  return todas.filter((z) => !z.planta_id || z.planta_id === plantaId);
}
