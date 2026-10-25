// app/lib/mantenimiento.js — Responsables de mantenimiento (Mantenimiento,
// parte 34; ítem 43; migración 133; diseño en
// notes/diseno-menu-y-mantenimiento.md).
//
// Cada vehículo y cada máquina tiene su responsable de mantenimiento y un
// suplente (opcional). Los dos ven en su Inicio "🔧 Mi mantenimiento" con lo
// que tienen a cargo y lo hacen desde el celular. El checklist de un vehículo
// pasa a ser solo de ellos (Tadeo, 25/10); el "responsable" de antes del
// vehículo queda como chofer habitual (para el aviso de su licencia). Sin la
// migración 133 las columnas no vienen y todo sigue como antes: el chofer hace
// el checklist de su vehículo.
import { urgentes as urgentesVehiculo, alertasVehiculo } from "./alertasFlota";
import { peorNivel } from "./flota";
import { estadoMaquina } from "./maquinaria";

// Cómo se llaman las columnas en cada tabla
export const CAMPOS_VEHICULO = { responsable: "mant_responsable_id", suplente: "mant_suplente_id" };
export const CAMPOS_MAQUINA = { responsable: "responsable_id", suplente: "suplente_id" };

/** ¿La fila ya tiene las columnas de la migración 133? */
export function conResponsables(fila, campos) {
  return Boolean(fila) && fila[campos.responsable] !== undefined;
}

/** ¿El empleado es el responsable o el suplente de este vehículo o máquina? */
export function aCargoDe(fila, empleadoId, campos) {
  if (!fila || !empleadoId) return false;
  return fila[campos.responsable] === empleadoId || fila[campos.suplente] === empleadoId;
}

/**
 * ¿Puede hacer el checklist de este vehículo? La oficina (gestión) siempre.
 * Con la 133: solo su responsable de mantenimiento o el suplente. Sin la 133:
 * el chofer, como antes.
 */
export function puedeChecklistVehiculo(vehiculo, { empleadoId, gestion = false }) {
  if (gestion) return true;
  if (!vehiculo || !empleadoId) return false;
  if (conResponsables(vehiculo, CAMPOS_VEHICULO)) return aCargoDe(vehiculo, empleadoId, CAMPOS_VEHICULO);
  return vehiculo.responsable_id === empleadoId;
}

/**
 * Los empleados que se pueden elegir como responsable o suplente: los
 * marcados "Responsable de mantenimiento", más los que ya están asignados
 * (para no perderlos si se les sacó la casilla).
 */
export function opcionesResponsable(empleados = [], actuales = []) {
  const fijos = new Set(actuales.filter(Boolean));
  return empleados.filter((e) => e.es_mantenimiento || fijos.has(e.id));
}

/** Qué tiene a cargo un empleado, en una línea: ["SEC-01", "CNC-01", "AB123CD"]. */
export function leToca(empleadoId, { vehiculos = [], maquinas = [] } = {}) {
  return [
    ...maquinas.filter((m) => m.activo !== false && aCargoDe(m, empleadoId, CAMPOS_MAQUINA)).map((m) => m.codigo),
    ...vehiculos.filter((v) => v.activo !== false && aCargoDe(v, empleadoId, CAMPOS_VEHICULO)).map((v) => v.patente),
  ];
}

/** "suplente" si es el suplente, "responsable" si es el titular. */
export function rolEn(fila, empleadoId, campos) {
  if (fila?.[campos.responsable] === empleadoId) return "responsable";
  if (fila?.[campos.suplente] === empleadoId) return "suplente";
  return null;
}

const ORDEN = { vencido: 0, pronto: 1, ok: 2, fuera: 3 };

/**
 * Lo que le toca a un responsable, para "🔧 Mi mantenimiento": sus vehículos
 * (con el semáforo de la flota) y sus máquinas (con cada tarea del plan), lo
 * vencido y lo de hoy arriba. Cada cosa:
 *   { tipo: "vehiculo", id, vehiculo, nivel, urgentes, rol }
 *   { tipo: "maquina", id, maquina, nivel, tareas: [{ tarea, nivel, ... }], rol }
 */
export function miMantenimiento(empleadoId, { vehiculos = [], maquinas = [], tareas = [], papeles = [], checklists = [], arreglos = [], hoy }) {
  const out = [];
  for (const v of vehiculos) {
    if (v.activo === false || !aCargoDe(v, empleadoId, CAMPOS_VEHICULO)) continue;
    const alertas = alertasVehiculo(v, { papeles: papeles.filter((p) => p.vehiculo_id === v.id), checklists, arreglos, hoy })
      // Los papeles y la licencia los ve la oficina; acá, lo que se revisa
      .filter((a) => a.tipo === "revision" || a.tipo === "arreglo");
    out.push({ tipo: "vehiculo", id: `v-${v.id}`, vehiculo: v, nivel: peorNivel(alertas), urgentes: urgentesVehiculo(alertas), rol: rolEn(v, empleadoId, CAMPOS_VEHICULO) });
  }
  for (const m of maquinas) {
    if (m.activo === false || !aCargoDe(m, empleadoId, CAMPOS_MAQUINA)) continue;
    const e = estadoMaquina(m, tareas, hoy);
    out.push({ tipo: "maquina", id: `m-${m.id}`, maquina: m, nivel: e.nivel, tareas: e.tareas, rol: rolEn(m, empleadoId, CAMPOS_MAQUINA) });
  }
  const nombre = (x) => (x.tipo === "maquina" ? x.maquina.codigo : x.vehiculo.patente);
  return out.sort((a, b) => (ORDEN[a.nivel] ?? 2) - (ORDEN[b.nivel] ?? 2) || nombre(a).localeCompare(nombre(b)));
}

/** Cuántas cosas suyas están vencidas o tocan pronto (para el detalle del botón). */
export function resumenMiMantenimiento(items = []) {
  const vencidas = items.filter((x) => x.nivel === "vencido").length;
  const pronto = items.filter((x) => x.nivel === "pronto").length;
  return { total: items.length, vencidas, pronto };
}

/** Texto del botón "🔧 Mi mantenimiento". */
export function detalleMiMantenimiento(items = []) {
  const { total, vencidas, pronto } = resumenMiMantenimiento(items);
  if (!total) return "Todavía no tenés vehículos ni máquinas a cargo";
  const partes = [];
  if (vencidas) partes.push(`🔴 ${vencidas} vencida${vencidas === 1 ? "" : "s"}`);
  if (pronto) partes.push(`🟡 ${pronto} para pronto`);
  if (!partes.length) partes.push("✅ Todo al día");
  return `${total} a cargo · ${partes.join(" · ")}`;
}

/**
 * A quién se le avisa al celular lo de un vehículo o máquina (aviso diario):
 * su responsable y su suplente. Un vehículo sin responsables de mantenimiento
 * (o sin la 133) le sigue avisando al chofer, como antes.
 */
export function destinatarios(fila, campos, { choferId = null } = {}) {
  const ids = [fila?.[campos.responsable], fila?.[campos.suplente]].filter(Boolean);
  if (!ids.length && choferId) ids.push(choferId);
  return [...new Set(ids)];
}
