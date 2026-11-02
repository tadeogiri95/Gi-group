// app/lib/otOrdenar.js — Ordenar las OT (auditoría 01/11, PR 6): las OT
// activas que hace rato no se mueven, para avisarlas y cerrarlas en lote con
// vista previa. En GI había ~300 OT "activas", muchas viejas, que ensucian la
// planificación, el Gantt y los avisos de atraso.
//
// "Movimiento" = la última pieza escaneada de la OT o la última carga manual
// de avance (Checkeo manual de OT, proyectos.avance_manual.at), lo que sea más
// nuevo (Tadeo, 01/11: una OT con cargas manuales también está activa). Si no
// tiene ninguna de las dos, cuenta desde el alta. Cerrar una OT solo cambia su estado
// en Gypi: la planilla del Plan de trabajo no se toca, y la sincronización
// nunca reabre una OT cerrada.

const DIA = 86400000;
export const DIAS_SIN_MOVIMIENTO = 30;
export const OPCIONES_DIAS = [30, 60, 90, 180];

const fecha = (ts) => (ts ? String(ts).slice(0, 10) : null);
const corta = (f) => (f ? `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}/${f.slice(2, 4)}` : "");

/** Última pieza escaneada por OT (de v_avance_piezas: ultimo_paso por etapa). */
export function ultimosPasos(piezas = []) {
  const m = new Map();
  for (const f of piezas) {
    if (!f?.ultimo_paso) continue;
    const ot = String(f.ot);
    if (!m.has(ot) || f.ultimo_paso > m.get(ot)) m.set(ot, f.ultimo_paso);
  }
  return m;
}

/** Avance por escaneo de cada OT (0-100), sumando las piezas de todas las etapas. */
function avancePorOt(piezas = []) {
  const m = new Map();
  for (const f of piezas) {
    const ot = String(f.ot);
    const x = m.get(ot) || { total: 0, pasaron: 0 };
    x.total += Number(f.total) || 0;
    x.pasaron += Number(f.pasaron) || 0;
    m.set(ot, x);
  }
  return new Map([...m].map(([ot, x]) => [ot, x.total ? Math.round((x.pasaron / x.total) * 100) : null]));
}

/**
 * OT activas sin movimiento hace más de `dias` días, la más quieta primero.
 * @param {object[]} proyectos   ot, estado, created_at, terminado_planilla, cliente, proyecto
 * @param {object[]} piezas      filas de v_avance_piezas (ot, total, pasaron, ultimo_paso)
 * @param {{ hoy: string, dias?: number }} opciones
 * @returns {{ p: object, ultimo: string|null, dias: number|null, motivo: string, avance: number|null }[]}
 */
export function otSinMovimiento(proyectos = [], piezas = [], { hoy, dias = DIAS_SIN_MOVIMIENTO } = {}) {
  const ultimo = ultimosPasos(piezas);
  const avance = avancePorOt(piezas);
  const limite = Date.parse(`${hoy}T12:00:00Z`) - dias * DIA;
  const out = [];
  for (const p of proyectos) {
    if (!p || p.estado === "cerrado") continue;
    const ot = String(p.ot);
    const paso = fecha(ultimo.get(ot));
    const manual = fecha(p.avance_manual?.at);
    const alta = fecha(p.created_at);
    const mov = [paso, manual].filter(Boolean).sort().pop() || null;
    const desde = mov || alta;
    // Sin escaneos ni fecha de alta no hay cómo saberlo: no se propone
    if (!desde || Date.parse(`${desde}T12:00:00Z`) > limite) continue;
    const quieta = Math.floor((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / DIA);
    const pct = avance.get(ot) ?? null;
    const motivo = [
      p.terminado_planilla ? "Terminada en la planilla" : pct === 100 ? "Producción al 100 %" : "",
      mov
        ? (mov === manual && manual !== paso ? `última carga manual el ${corta(manual)}` : `último escaneo el ${corta(paso)}`)
        : `sin escaneos ni cargas manuales, alta el ${corta(alta)}`,
    ].filter(Boolean).join(" · ");
    out.push({ p, ultimo: mov, dias: quieta, motivo, avance: pct });
  }
  return out.sort((a, b) => b.dias - a.dias || String(a.p.ot).localeCompare(String(b.p.ot), "es", { numeric: true }));
}

/** Ids en tandas, para no armar una URL enorme al cerrar muchas juntas. */
export function enTandas(ids, tam = 80) {
  const out = [];
  for (let i = 0; i < ids.length; i += tam) out.push(ids.slice(i, i + tam));
  return out;
}
