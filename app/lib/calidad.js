// app/lib/calidad.js — Módulos por OT y no conformidades (Órdenes de
// Producción, parte 6; ítem 39).
//
// Módulos: la OT tiene un total (columna "Módulos" de la planilla o cargado a
// mano) y cada etapa medida en módulos suma lo que anotan los operarios en
// sus tareas: "3 de 12".
//
// No conformidades: cada empresa arma su lista de defectos con un código
// corto (hasta 4 letras o números) y la etapa donde suele originarse. Se
// guarda en config_sistema, clave "defectos".
import { normalizar } from "./rutas";

export const CLAVE_DEFECTOS = "defectos";
export const RE_CODIGO_DEFECTO = /^[A-Z0-9]{1,4}$/;
export const MAX_DEFECTOS = 30;

/** Los que ve toda empresa que no armó su lista. */
export const DEFECTOS_DEFECTO = [
  { cod: "MED", nombre: "Medida mal", origen: null },
  { cod: "DAN", nombre: "Golpe, rayón o mancha", origen: null },
  { cod: "MAT", nombre: "Material equivocado", origen: null },
  { cod: "OTR", nombre: "Otro defecto", origen: null },
];

/**
 * Lista de ejemplo para una fábrica de muebles (códigos del mapa de
 * procesos). origenNombre se busca entre las etapas de la empresa al
 * cargarla, para proponer la etapa de origen.
 */
export const DEFECTOS_FABRICA = [
  { cod: "C1", nombre: "Medida fuera de tolerancia", origenNombre: "Corte" },
  { cod: "C2", nombre: "Astillado o mal corte", origenNombre: "Corte" },
  { cod: "C3", nombre: "Material, espesor o color equivocado", origenNombre: "Corte" },
  { cod: "K1", nombre: "Canto despegado o con rebaba", origenNombre: "Canto" },
  { cod: "K2", nombre: "Canto en lado equivocado o faltante", origenNombre: "Canto" },
  { cod: "P1", nombre: "Perforación o ranura mal ubicada", origenNombre: "Procesos" },
  { cod: "E1", nombre: "Ángulo o corte manija mal hecho", origenNombre: "Corte especial" },
  { cod: "D1", nombre: "Golpe, rayón o mancha", origenNombre: null },
  { cod: "T1", nombre: "Error de planilla (medida o dato mal)", origenNombre: "Técnica" },
];

/** Las 4 decisiones del encargado sobre una pieza no conforme. */
export const DECISIONES = [
  { cod: "reprocesar", nombre: "Reprocesar", icon: "🔁", ayuda: "Vuelve al puesto que corresponde" },
  { cod: "rehacer", nombre: "Rehacer", icon: "🆕", ayuda: "Se pide una pieza nueva a corte" },
  { cod: "usar_igual", nombre: "Usar igual", icon: "✅", ayuda: "No se ve y no afecta la función" },
  { cod: "descartar", nombre: "Descartar", icon: "🗑", ayuda: "Se tira y se anota el material perdido" },
];

export function nombreDecision(cod) {
  return DECISIONES.find((d) => d.cod === cod)?.nombre || "";
}

/** Limpia una lista guardada: códigos válidos, sin repetidos, con nombre. */
export function normalizarDefectos(lista) {
  if (!Array.isArray(lista)) return [];
  const vistos = new Set();
  const out = [];
  for (const d of lista) {
    const cod = String(d?.cod ?? "").trim().toUpperCase();
    const nombre = String(d?.nombre ?? "").trim().slice(0, 60);
    if (!RE_CODIGO_DEFECTO.test(cod) || !nombre || vistos.has(cod)) continue;
    vistos.add(cod);
    const origen = Number.isInteger(d?.origen) && d.origen >= 1 && d.origen <= 999 ? d.origen : null;
    out.push({ cod, nombre, origen });
    if (out.length >= MAX_DEFECTOS) break;
  }
  return out;
}

/** La lista que ve el operario: la de la empresa o, si no tiene, la de siempre. */
export function defectosDe(lista) {
  const propios = normalizarDefectos(lista);
  return propios.length ? propios : DEFECTOS_DEFECTO;
}

export function nombreDefecto(lista, cod) {
  if (!cod) return "";
  const d = defectosDe(lista).find((x) => x.cod === cod) || DEFECTOS_DEFECTO.find((x) => x.cod === cod);
  return d ? d.nombre : cod;
}

/** La lista de fábrica con la etapa de origen de cada defecto buscada por nombre. */
export function defectosFabricaPara(etapas) {
  const porNombre = new Map((etapas || []).filter((e) => e.codigo > 0).map((e) => [normalizar(e.nombre), e.codigo]));
  return DEFECTOS_FABRICA.map(({ cod, nombre, origenNombre }) => ({
    cod, nombre, origen: origenNombre ? porNombre.get(normalizar(origenNombre)) ?? null : null,
  }));
}

/** ¿La etapa se mide en módulos? ("módulos", "modulo", "Módulos terminados"…) */
export function esEtapaDeModulos(etapa) {
  return normalizar(etapa?.unidad).startsWith("modulo");
}

/**
 * Módulos hechos por etapa en cada OT, con la cantidad que anotan los
 * operarios. @returns Map "OT|etapa" → número
 */
export function modulosHechos(registros) {
  const m = new Map();
  for (const r of registros || []) {
    const n = Number(r.cantidad);
    if (!(r.etapa > 0) || !r.codigo_proyecto || !Number.isFinite(n) || n <= 0) continue;
    const k = `${r.codigo_proyecto}|${r.etapa}`;
    m.set(k, (m.get(k) || 0) + n);
  }
  return m;
}

/** "3 de 12" (o "3" si la OT no tiene total). */
export function textoModulos(hechos, total) {
  const h = Math.round((hechos || 0) * 100) / 100;
  return total ? `${h} de ${total}` : String(h);
}
