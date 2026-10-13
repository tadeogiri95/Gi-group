// app/lib/detalleOp.js — Resumen de una orden de producción (Órdenes de
// Producción, parte 3; ítem 39): horas por etapa, quién trabajó y retrabajos,
// a partir de las tareas que ya se registran (registro_actividades).
import { rutaDe } from "./rutas";
import { nombreCausa } from "./causas";

export const TIPOS_RETRABAJO = {
  R: "Retrabajo",
  E: "Corrige un error previo",
  C: "Cambio pedido por el cliente",
};
const NOMBRE_RETRABAJO = new Map(Object.entries(TIPOS_RETRABAJO));

/** Minutos de una tarea: los guardados al cerrarla, o hasta ahora si sigue abierta. */
export function minutosDe(tarea, ahora = Date.now()) {
  if (tarea.hora_fin) return Math.max(0, Number(tarea.duracion_min) || 0);
  const inicio = Date.parse(tarea.hora_inicio);
  return Number.isFinite(inicio) ? Math.max(0, (ahora - inicio) / 60000) : 0;
}

/** 95 → "1 h 35 min"; 40 → "40 min"; 0 → "0 min". */
export function fmtHoras(min) {
  const total = Math.round(Number(min) || 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * @param {object[]} tareas registro_actividades de la OT (tareas y paradas)
 * @param {{ etapas?: object[], division?: object|null, empleados?: object[], causas?: object[], ahora?: number }} ctx
 * @returns resumen con totales, etapas (en el orden de la ruta, después las que
 *   están fuera de ella, con la cantidad hecha si la etapa tiene unidad),
 *   personas, retrabajos y paradas por causa.
 */
function nuevaEtapa(codigo, info) {
  return {
    codigo, nombre: info?.nombre || `Etapa ${codigo}`, icon: info?.icon || "🔨", unidad: info?.unidad || null,
    min: 0, retrabajoMin: 0, personas: new Set(), cantidad: 0, minConCantidad: 0,
  };
}

export function resumirOp(tareas, { etapas = [], division = null, empleados = [], causas = [], ahora = Date.now() } = {}) {
  const productivas = (tareas || []).filter((t) => Number(t.etapa) > 0);
  // Desde la 099 una parada puede llevar la OT en la que se estaba
  const paradasMap = new Map();
  for (const t of tareas || []) {
    if (Number(t.etapa) !== 0) continue;
    const cod = t.causa || "?";
    const p = paradasMap.get(cod) || { causa: cod, nombre: nombreCausa(causas, cod) || "Sin causa", veces: 0, min: 0 };
    p.veces++;
    p.min += minutosDe(t, ahora);
    paradasMap.set(cod, p);
  }
  const porCodigo = new Map(etapas.map((e) => [Number(e.codigo), e]));
  const nombreDe = new Map();
  for (const e of empleados) {
    const nombre = e.apodo || e.nombre || `Legajo ${e.legajo}`;
    if (e.id) nombreDe.set(`id:${e.id}`, nombre);
    if (e.legajo != null) nombreDe.set(`legajo:${e.legajo}`, nombre);
  }
  const persona = (t) => nombreDe.get(`id:${t.empleado_id}`) || nombreDe.get(`legajo:${t.legajo}`) || `Legajo ${t.legajo ?? "?"}`;

  const etapasMap = new Map();
  const personasMap = new Map();
  const retrabajos = new Map();
  const fechas = new Set();
  const ahoraTrabajando = new Set();
  let totalMin = 0;

  for (const t of productivas) {
    const min = minutosDe(t, ahora);
    const codigo = Number(t.etapa);
    const quien = persona(t);
    totalMin += min;
    if (t.fecha) fechas.add(t.fecha);
    if (!t.hora_fin) ahoraTrabajando.add(quien);

    if (!etapasMap.has(codigo)) {
      const info = porCodigo.get(codigo);
      etapasMap.set(codigo, nuevaEtapa(codigo, info));
    }
    const et = etapasMap.get(codigo);
    et.min += min;
    if (t.cantidad != null && Number.isFinite(Number(t.cantidad))) {
      et.cantidad += Number(t.cantidad);
      et.minConCantidad += min;
    }
    et.personas.add(quien);

    const p = personasMap.get(quien) || { nombre: quien, min: 0, etapas: new Set() };
    p.min += min;
    p.etapas.add(et.nombre);
    personasMap.set(quien, p);

    const tipo = t.tipo && t.tipo !== "N" ? t.tipo : null;
    if (tipo) {
      et.retrabajoMin += min;
      const r = retrabajos.get(tipo) || { tipo, nombre: NOMBRE_RETRABAJO.get(tipo) || tipo, veces: 0, min: 0 };
      r.veces++;
      r.min += min;
      retrabajos.set(tipo, r);
    }
  }

  // Orden: primero las etapas de la ruta (aunque todavía no tengan horas),
  // después las que se trabajaron fuera de la ruta.
  const ruta = rutaDe(division);
  const ordenadas = [];
  for (const c of ruta) {
    const et = etapasMap.get(c) || (porCodigo.has(c) ? nuevaEtapa(c, porCodigo.get(c)) : null);
    if (et) ordenadas.push({ ...et, enRuta: true });
    etapasMap.delete(c);
  }
  const fuera = [...etapasMap.values()].sort((a, b) => b.min - a.min).map((et) => ({ ...et, enRuta: !ruta.length }));

  const dias = [...fechas].sort();
  return {
    totalMin,
    tareas: productivas.length,
    dias: dias.length,
    desde: dias[0] || null,
    hasta: dias.at(-1) || null,
    ahoraTrabajando: [...ahoraTrabajando],
    tieneRuta: ruta.length > 0,
    etapas: [...ordenadas, ...fuera].map(({ minConCantidad, ...et }) => ({
      ...et,
      personas: [...et.personas],
      // Minutos por unidad: solo con las tareas que tienen la cantidad anotada
      minPorUnidad: et.unidad && et.cantidad > 0 ? minConCantidad / et.cantidad : null,
    })),
    personas: [...personasMap.values()].sort((a, b) => b.min - a.min).map((p) => ({ ...p, etapas: [...p.etapas] })),
    retrabajos: [...retrabajos.values()].sort((a, b) => b.min - a.min),
    retrabajoMin: [...retrabajos.values()].reduce((s, r) => s + r.min, 0),
    paradas: [...paradasMap.values()].sort((a, b) => b.min - a.min),
    paradaMin: [...paradasMap.values()].reduce((s, p) => s + p.min, 0),
  };
}
