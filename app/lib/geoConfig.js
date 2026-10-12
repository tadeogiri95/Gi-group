// app/lib/geoConfig.js — Control de ubicación de cada empleado al fichar.
//
// geo_config (columna jsonb de empleados) admite tres modos:
//   "empresa"  → ficha dentro de cualquier ubicación de la empresa (o de su
//                planta). Es el modo por defecto, también sin geo_config.
//   "asignada" → ficha solo dentro de su ubicación asignada (activo + ubicacion_id).
//   "libre"    → ficha desde cualquier lugar, sin control (libre: true).
// Antes "desactivar el control" dejaba al empleado en "empresa", pero la
// pantalla y el aviso le decían que podía fichar desde cualquier lugar.

export const MODOS_GEO = [
  { id: "empresa", label: "Ubicaciones de la empresa", detalle: "Ficha dentro de cualquier ubicación cargada" },
  { id: "asignada", label: "Una ubicación", detalle: "Ficha solo dentro de la ubicación que elijas" },
  { id: "libre", label: "Cualquier lugar", detalle: "Ficha sin control de ubicación" },
];

export const RADIO_DEFAULT = 150;

/** @returns {"empresa"|"asignada"|"libre"} */
export function modoGeo(gc) {
  if (gc?.libre === true) return "libre";
  if (gc?.activo) return "asignada";
  return "empresa";
}

/** geo_config que corresponde a un modo, conservando ubicación y radio si siguen valiendo. */
export function configParaModo(modo, gc = {}) {
  const radio = Number(gc?.radio) || RADIO_DEFAULT;
  if (modo === "libre") return { activo: false, libre: true, ubicacion_id: null, radio };
  if (modo === "asignada") return { activo: true, libre: false, ubicacion_id: gc?.ubicacion_id ?? null, radio };
  return { activo: false, libre: false, ubicacion_id: null, radio };
}

/** Resumen corto para la lista de empleados. */
export function resumenGeo(gc, nombreUbicacion) {
  const modo = modoGeo(gc);
  if (modo === "libre") return "Ficha desde cualquier lugar";
  if (modo === "asignada") return `📍 ${nombreUbicacion || "Sin asignar"} · ${Number(gc?.radio) || RADIO_DEFAULT}m`;
  return "Ubicaciones de la empresa";
}

/** Aviso que recibe el empleado cuando cambia su control de ubicación. */
export function avisoGeo(gc, nombreUbicacion) {
  const modo = modoGeo(gc);
  if (modo === "libre") {
    return { asunto: "📍 Podés fichar desde cualquier lugar", detalle: "Ya no se controla tu ubicación al fichar." };
  }
  if (modo === "asignada") {
    return {
      asunto: "📍 Control de ubicación activado",
      detalle: `Fichás solo dentro de ${nombreUbicacion || "tu ubicación asignada"} (radio ${Number(gc?.radio) || RADIO_DEFAULT}m).`,
    };
  }
  return { asunto: "📍 Control de ubicación actualizado", detalle: "Fichás dentro de cualquier ubicación de la empresa." };
}
