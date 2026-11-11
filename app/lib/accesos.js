// app/lib/accesos.js — Accesos por persona (migración 181, pedido del 11/11).
//
// El titular de la cuenta (el Dueño que dio de alta la empresa) elige, para
// cada persona de la oficina (Dueños, Supervisores y Administración):
//   • qué módulos ve: lo que tiene oculto no le aparece en ningún lado y el
//     servidor no se lo da (como un módulo apagado, pero solo para esa persona);
//   • si puede cambiar las configuraciones (Más → Cómo trabaja la planta y
//     Empresa, el ⚙ de cada módulo y prender o apagar módulos).
// Sin elegir nada, la persona ve todo lo de la empresa menos Finanzas y mira
// la configuración en solo lectura. Los operarios no cambian: ven lo suyo.
// Solo el titular da accesos y puede nombrar a otro titular.
//
// Este archivo no habla con la base (lo usa también la app); el servidor lee
// la tabla en app/lib/accesosServidor.js.
import { MODULOS } from "./modulos";

/** Lo que no ve una persona de la oficina hasta que el titular se lo habilite. */
export const OCULTOS_POR_DEFECTO = ["finanzas"];

/** Finanzas es solo para el rol Dueño (la base lo exige, RLS de la 171). */
export const MODULOS_SOLO_DUENO = ["finanzas"];

export const MENSAJE_SIN_CONFIGURAR = "Solo el titular de la cuenta o quien él designe puede cambiar la configuración.";

export const esOficina = (rol) => rol === "gerencial" || rol === "administrativo";

/** Los módulos que el titular puede mostrar u ocultar, en el orden del catálogo. */
export function modulosElegibles() {
  return Object.values(MODULOS).filter((m) => m.disponible).map((m) => m.id);
}

/** Limpia la lista de ocultos: solo ids del catálogo, sin repetidos. */
export function limpiarOcultos(lista) {
  const validos = new Set(modulosElegibles());
  return [...new Set((Array.isArray(lista) ? lista : []).filter((m) => typeof m === "string" && validos.has(m)))];
}

/**
 * Acceso de una persona.
 * @param {{ rol?: string, fila?: { es_titular?: boolean, puede_configurar?: boolean, modulos_ocultos?: string[] } | null, titular?: boolean }} p
 * @returns {{ titular: boolean, puede_configurar: boolean, ocultos: string[] }}
 */
export function accesoDe({ rol, fila = null, titular = false }) {
  if (titular || fila?.es_titular) return { titular: true, puede_configurar: true, ocultos: [] };
  if (!esOficina(rol)) return { titular: false, puede_configurar: false, ocultos: [] };
  if (!fila) return { titular: false, puede_configurar: false, ocultos: [...OCULTOS_POR_DEFECTO] };
  return { titular: false, puede_configurar: !!fila.puede_configurar, ocultos: limpiarOcultos(fila.modulos_ocultos) };
}

/** Sin la migración 181 todo queda como antes: nada oculto y la configuración la cambia la gestión. */
export function accesoSinMigracion(rol) {
  return { titular: rol === "gerencial", puede_configurar: esOficina(rol), ocultos: [], sin_migracion: true };
}

/**
 * Módulos de la empresa como los ve esta persona: lo oculto sale de los
 * módulos y pasa a "apagados" (no se ve, ni con candado).
 */
export function modulosDePersona({ modulos = [], apagados = [] }, ocultos = []) {
  const fuera = new Set(ocultos);
  return {
    modulos: modulos.filter((m) => !fuera.has(m)),
    modulos_apagados: [...new Set([...apagados, ...modulos.filter((m) => fuera.has(m))])],
  };
}

// ─── En la app ──────────────────────────────────────────────────────────────
// /api/empresa manda empresa.acceso = { titular, puede_configurar }. Si no vino
// (demo, versión vieja en caché), se comporta como antes: el servidor es el
// que bloquea de verdad.

/** ¿Puede cambiar la configuración? */
export function puedeConfigurar(empresa, usuario) {
  if (empresa?.acceso) return !!empresa.acceso.puede_configurar;
  return esOficina(usuario?.rol);
}

/** ¿Es el titular de la cuenta (da los accesos)? */
export function esTitular(empresa) {
  return !!empresa?.acceso?.titular;
}
