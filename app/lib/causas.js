// app/lib/causas.js — Causas de parada de cada empresa (Órdenes de
// Producción, parte 4; ítem 39). Cada empresa arma su lista con códigos
// propios (hasta 4 letras o números). Sin lista propia se usan las 4 de
// siempre. Se guarda en config_sistema, clave "causas_parada".

export const CLAVE_CAUSAS = "causas_parada";
export const RE_CODIGO_CAUSA = /^[A-Z0-9]{1,4}$/;
export const MAX_CAUSAS = 20;

/** Las 4 de siempre: las usa toda empresa que no armó su lista. */
export const CAUSAS_DEFECTO = [
  { cod: "M", nombre: "Falta material", icon: "📦" },
  { cod: "H", nombre: "Falta herramienta", icon: "🔧" },
  { cod: "I", nombre: "Indicación", icon: "💬" },
  { cod: "O", nombre: "Otro", icon: "❓" },
];

/** Lista de ejemplo para una fábrica (códigos de parada del mapa de procesos). */
export const CAUSAS_FABRICA = [
  { cod: "SP", nombre: "Sin pedido o sin trabajo programado", icon: "📋" },
  { cod: "SM", nombre: "Sin material", icon: "📦" },
  { cod: "MA", nombre: "Mantenimiento o limpieza", icon: "🧹" },
  { cod: "RO", nombre: "Rotura o falla", icon: "⚠️" },
  { cod: "CA", nombre: "Cambio de hoja, rollo o regulación", icon: "🔄" },
  { cod: "OT", nombre: "Operario en otra tarea", icon: "🚶" },
];

const ICONO_CAUSA = "⏸";

/** Limpia una lista guardada: códigos válidos, sin repetidos, con nombre. */
export function normalizarCausas(lista) {
  if (!Array.isArray(lista)) return [];
  const vistos = new Set();
  const out = [];
  for (const c of lista) {
    const cod = String(c?.cod ?? "").trim().toUpperCase();
    const nombre = String(c?.nombre ?? "").trim().slice(0, 60);
    if (!RE_CODIGO_CAUSA.test(cod) || !nombre || vistos.has(cod)) continue;
    vistos.add(cod);
    out.push({ cod, nombre, icon: String(c?.icon || ICONO_CAUSA).slice(0, 8) });
    if (out.length >= MAX_CAUSAS) break;
  }
  return out;
}

/** La lista que ve el operario: la de la empresa o, si no tiene, la de siempre. */
export function causasDe(lista) {
  const propias = normalizarCausas(lista);
  return propias.length ? propias : CAUSAS_DEFECTO;
}

/** Nombre de un código, también para paradas viejas con las causas de siempre. */
export function nombreCausa(lista, cod) {
  if (!cod) return "";
  const c = causasDe(lista).find((x) => x.cod === cod) || CAUSAS_DEFECTO.find((x) => x.cod === cod);
  return c ? c.nombre : cod;
}
