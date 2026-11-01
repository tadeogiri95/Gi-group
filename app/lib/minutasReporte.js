// app/lib/minutasReporte.js — Reportes consolidados de las minutas y tarjeta
// del Panel (Minuta, parte M5; diseño en notes/diseno-minuta-buenos-dias.md).
//
// Con las minutas de un período (semana o mes) arma:
//   - Reunión: cuántas, duración promedio, cuántas empezaron a horario (8:45,
//     con 5 minutos de tolerancia) y la asistencia de cada uno.
//   - OT con contingencias: los días que estuvieron en amarillo o rojo (en
//     curso de producción e instalación) y las OT que se repiten en el foco.
//   - Pendientes por responsable: abiertos, resueltos y días promedio hasta
//     resolverlos (desde el día en que aparecieron por primera vez).
//   - Feedback por área y por tipo.
//   - Compras disparadas desde la minuta: cuántas, urgentes y con pedido.
// No escribe nada: solo cuenta.
import { SECCIONES_SEGUIMIENTO } from "./minutas";

export const HORA_REUNION = "08:45";
const TOLERANCIA_MIN = 5;
const DIA = 86400000;

const minutos = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const dias = (desde, hasta) => Math.max(0, Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / DIA));
const fechaDeTs = (ts) => (ts ? new Date(Date.parse(ts) - 3 * 3600000).toISOString().slice(0, 10) : null);
const contar = (lista, clave) => {
  const m = new Map();
  for (const x of lista) { const k = clave(x); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return m;
};
const ordenar = (m) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "es", { numeric: true }));
const redondear = (n) => Math.round(n * 10) / 10;

// Los pendientes con responsable (el en curso se sigue en "OT con contingencias")
const PENDIENTES = SECCIONES_SEGUIMIENTO.filter((s) => s !== "prod_en_curso" && s !== "inst_en_curso");

/**
 * @param {{ minutas: object[], items: object[], hoy: string }} datos
 *   minutas: id, fecha, inicio, cierre, asistentes, estado
 *   items: minuta_items de esas minutas (con seccion, ot, semaforo, responsable, tipo, area, datos, viene_de, resuelto_at)
 */
export function resumenMinutas({ minutas = [], items = [], hoy }) {
  const fechaDe = new Map(minutas.map((m) => [m.id, m.fecha]));
  const conFecha = items.map((it) => ({ ...it, fecha: it.fecha || fechaDe.get(it.minuta_id) || null }));

  // Reunión
  const duraciones = minutas.map((m) => {
    const a = minutos(m.inicio), b = minutos(m.cierre);
    return a != null && b != null && b >= a ? b - a : null;
  }).filter((x) => x != null);
  const conInicio = minutas.filter((m) => minutos(m.inicio) != null);
  const aHorario = conInicio.filter((m) => minutos(m.inicio) <= minutos(HORA_REUNION) + TOLERANCIA_MIN).length;
  const asistencia = ordenar(contar(minutas.flatMap((m) => (Array.isArray(m.asistentes) ? m.asistentes : [])), (n) => n))
    .map(([nombre, veces]) => ({ nombre, veces, pct: minutas.length ? Math.round((veces / minutas.length) * 100) : 0 }));
  const reunion = {
    cantidad: minutas.length,
    duracionPromedio: duraciones.length ? Math.round(duraciones.reduce((s, x) => s + x, 0) / duraciones.length) : null,
    aHorario, conInicio: conInicio.length, asistencia,
  };

  // OT con contingencias: días distintos en amarillo o rojo
  const contingencias = new Map();
  for (const it of conFecha) {
    if (!it.ot || !["prod_en_curso", "inst_en_curso"].includes(it.seccion) || !["amarillo", "rojo"].includes(it.semaforo)) continue;
    if (!contingencias.has(it.ot)) contingencias.set(it.ot, { ot: it.ot, proyecto: it.proyecto || null, cliente: it.cliente || null, dias: new Set(), rojo: new Set() });
    const c = contingencias.get(it.ot);
    c.dias.add(it.fecha);
    if (it.semaforo === "rojo") c.rojo.add(it.fecha);
  }
  const otContingencias = [...contingencias.values()]
    .map((c) => ({ ot: c.ot, proyecto: c.proyecto, cliente: c.cliente, dias: c.dias.size, diasRojo: c.rojo.size }))
    .sort((a, b) => b.dias - a.dias || b.diasRojo - a.diasRojo || a.ot.localeCompare(b.ot, "es", { numeric: true }));
  const focoPorOt = new Map();
  for (const it of conFecha) {
    if (it.seccion !== "foco" || !it.ot) continue;
    if (!focoPorOt.has(it.ot)) focoPorOt.set(it.ot, { ot: it.ot, proyecto: it.proyecto || null, dias: new Set() });
    focoPorOt.get(it.ot).dias.add(it.fecha);
  }
  const otFoco = [...focoPorOt.values()].map((f) => ({ ot: f.ot, proyecto: f.proyecto, veces: f.dias.size }))
    .filter((f) => f.veces > 1).sort((a, b) => b.veces - a.veces || a.ot.localeCompare(b.ot, "es", { numeric: true }));

  // Pendientes por responsable: el último renglón de cada cadena dice cómo está
  const pend = conFecha.filter((it) => PENDIENTES.includes(it.seccion));
  const siguieron = new Set(pend.map((it) => it.viene_de).filter(Boolean));
  const porResp = new Map();
  for (const it of pend.filter((x) => !siguieron.has(x.id))) {
    const r = String(it.responsable || "").trim() || "Sin responsable";
    if (!porResp.has(r)) porResp.set(r, { responsable: r, abiertos: 0, resueltos: 0, vencidos: 0, diasResolver: [] });
    const x = porResp.get(r);
    const inicio = /^\d{4}-\d{2}-\d{2}$/.test(String(it.datos?.desde || "")) ? it.datos.desde : it.fecha;
    if (it.resuelto_at) {
      x.resueltos += 1;
      if (inicio) x.diasResolver.push(dias(inicio, fechaDeTs(it.resuelto_at)));
    } else {
      x.abiertos += 1;
      if (it.fecha_objetivo && hoy && it.fecha_objetivo < hoy) x.vencidos += 1;
    }
  }
  const pendientes = [...porResp.values()]
    .map(({ diasResolver, ...x }) => ({ ...x, diasPromedio: diasResolver.length ? redondear(diasResolver.reduce((s, d) => s + d, 0) / diasResolver.length) : null }))
    .sort((a, b) => b.abiertos - a.abiertos || b.vencidos - a.vencidos || a.responsable.localeCompare(b.responsable, "es"));

  // Feedback por área y por tipo
  const fb = conFecha.filter((it) => it.seccion === "feedback");
  const areas = new Map();
  for (const it of fb) {
    const a = it.area || "Sin área";
    if (!areas.has(a)) areas.set(a, { area: a, total: 0, tipos: {} });
    const x = areas.get(a);
    x.total += 1;
    const t = it.tipo || "Sin tipo";
    x.tipos[t] = (x.tipos[t] || 0) + 1;
  }
  const feedback = {
    total: fb.length,
    porArea: [...areas.values()].sort((a, b) => b.total - a.total || a.area.localeCompare(b.area, "es")),
    porTipo: ordenar(contar(fb, (it) => it.tipo || "Sin tipo")).map(([tipo, n]) => ({ tipo, n })),
  };

  // Compras
  const comp = conFecha.filter((it) => it.seccion === "compra");
  const compras = {
    total: comp.length,
    urgentes: comp.filter((it) => it.tipo === "urgente").length,
    conPedido: comp.filter((it) => it.datos?.pedido_id).length,
  };

  return { reunion, otContingencias, otFoco, pendientes, feedback, compras };
}

/**
 * Tarjeta "📝 Minuta de hoy" del Panel: si ya se empezó o se cerró, y los
 * pendientes abiertos que vencen hoy o ya vencieron.
 * @param {{ minuta: object|null, items?: object[], abiertos: object[], hoy: string }} datos
 *   items = renglones de la minuta de hoy; abiertos = GET ?seguimiento (lo abierto de días anteriores)
 */
export function tarjetaMinuta({ minuta, items = [], abiertos = [], hoy }) {
  // Lo de días anteriores que ya pasó a la de hoy cuenta con el renglón de hoy
  const pasaron = new Set(items.map((it) => it.viene_de).filter(Boolean));
  const pend = [...abiertos.filter((it) => !pasaron.has(it.id)), ...items.filter((it) => !it.resuelto_at)]
    .filter((it) => PENDIENTES.includes(it.seccion));
  return {
    estado: !minuta ? "sin_empezar" : minuta.estado === "cerrada" ? "cerrada" : "abierta",
    venceHoy: pend.filter((it) => it.fecha_objetivo === hoy).length,
    vencidos: pend.filter((it) => it.fecha_objetivo && it.fecha_objetivo < hoy).length,
    abiertos: pend.length,
    gerencia: pend.filter((it) => it.datos?.gerencia).length,
  };
}
