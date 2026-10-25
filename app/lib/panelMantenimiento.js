// app/lib/panelMantenimiento.js — Las dos tarjetas nuevas del Panel de
// control (Mantenimiento, parte 36; sin migración; diseño en
// notes/diseno-menu-y-mantenimiento.md):
// - 🔧 Mantenimiento (reemplaza a 🚚 Flota): lo vencido y lo próximo de los
//   vehículos y de las máquinas, con las máquinas paradas en rojo arriba.
// - ⏰ OT atrasadas: las que pasaron su fecha de entrega y no están
//   terminadas, la más atrasada arriba, con los días y su % de avance.
import { alertasMaquinaria } from "./maquinaria";
import { fallasPendientes } from "./fallasMaquinaria";
import { textoAlerta } from "./alertasFlota";

const NIVEL = { vencido: 0, pronto: 1 };

/**
 * Una sola lista para la tarjeta: [{ clave, nivel, parada, texto, quien, destino }].
 * Primero las máquinas paradas, después lo vencido y al final lo que toca
 * pronto. Una falla sin arreglar de una máquina que sigue andando es 🟡; la de
 * una máquina parada va en el texto de la parada.
 * @param {{ alertasFlota?: object[]|null, maquinas?: object[], tareas?: object[], fallas?: object[], hoy: string, textoVencimiento?: Function }} datos
 */
export function alertasMantenimiento({ alertasFlota = null, maquinas = [], tareas = [], fallas = [], hoy, textoVencimiento }) {
  const out = [];
  for (const a of alertasFlota || []) {
    out.push({ clave: `v-${a.patente}-${a.clave}`, nivel: a.nivel, parada: false, texto: textoAlerta(a, textoVencimiento), quien: a.patente, destino: "mantenimiento:flota" });
  }
  const pendientes = fallasPendientes(fallas);
  for (const a of alertasMaquinaria(maquinas, tareas, hoy)) {
    let texto = a.texto;
    if (a.parada) {
      const falla = pendientes.find((f) => f.maquina_id === a.maquina.id && f.parada) || pendientes.find((f) => f.maquina_id === a.maquina.id);
      texto = falla ? `Parada: ${falla.descripcion}` : "Máquina parada";
    }
    out.push({ clave: `m-${a.clave}`, nivel: a.nivel, parada: !!a.parada, texto, quien: a.maquina.codigo, destino: "mantenimiento:maquinaria" });
  }
  const paradas = new Set(maquinas.filter((m) => m.estado === "parada").map((m) => m.id));
  const porId = new Map(maquinas.map((m) => [m.id, m]));
  for (const f of pendientes) {
    const m = porId.get(f.maquina_id);
    if (!m || m.activo === false || paradas.has(m.id)) continue;
    out.push({ clave: `f-${f.id}`, nivel: "pronto", parada: false, texto: `Falla: ${f.descripcion}`, quien: m.codigo, destino: "mantenimiento:maquinaria" });
  }
  return out.sort((a, b) => Number(b.parada) - Number(a.parada) || (NIVEL[a.nivel] ?? 2) - (NIVEL[b.nivel] ?? 2));
}

/** Días entre dos fechas "AAAA-MM-DD" (b − a). */
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * OT atrasadas: de las filas del tablero (OT abiertas), las que tienen fecha
 * de entrega anterior a hoy y no tienen todas sus etapas cerradas. La más
 * atrasada primero. El % es el del escaneo de piezas si la OT tiene piezas;
 * si no, etapas cerradas sobre el total de su ruta (null si no tiene ruta).
 * @param {object[]} filas de filasTablero()
 * @param {{ porEscaneo?: Map<string, { porcentaje: number|null }>, hoy: string }} opciones
 * @returns {{ fila: object, dias: number, porcentaje: number|null }[]}
 */
export function otAtrasadas(filas = [], { porEscaneo = new Map(), hoy }) {
  const out = [];
  for (const f of filas || []) {
    const entrega = f.proyecto?.fecha_entrega;
    if (!entrega) continue;
    const dias = diasEntre(String(entrega).slice(0, 10), hoy);
    if (!(dias > 0)) continue;
    if (f.celdas.length && f.cerradas >= f.celdas.length) continue;
    const escaneo = porEscaneo.get(String(f.proyecto.ot))?.porcentaje;
    const porcentaje = escaneo ?? (f.celdas.length ? Math.floor((f.cerradas / f.celdas.length) * 100) : null);
    out.push({ fila: f, dias, porcentaje });
  }
  return out.sort((a, b) => b.dias - a.dias || String(a.fila.proyecto.ot).localeCompare(String(b.fila.proyecto.ot), "es", { numeric: true }));
}

/** "1 día" / "12 días". */
export const textoDias = (n) => `${n} ${n === 1 ? "día" : "días"}`;
