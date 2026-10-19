// app/lib/reporteDiario.js — Reporte del día de producción e instalación
// (seguimiento de OT por escaneo, parte 26).
//
// Por cada OT que tuvo movimiento ese día: piezas escaneadas en cada etapa y
// el % de producción al empezar y al terminar el día (mismo cálculo que la
// parte 25: piezas escaneadas sobre el total). Además: OT que llegaron al
// 100%, etapas marcadas o firmadas, OT atrasadas contra su fecha de entrega
// y los reportes de instalación del día con su % y pendientes nuevos.
//
// Se calcula con lo que hay en la base, así que sirve para cualquier día:
// el "antes" y el "después" salen de restar los escaneos de ese día y los de
// después a lo que suma hoy la vista v_avance_piezas.
import { pct, porcentajeOt } from "./piezas";
import { hoyArg } from "./dates";

// Argentina no tiene horario de verano: el día va de 00:00 a 24:00 en -03:00.
export function limitesDia(fecha) {
  const inicio = new Date(`${fecha}T00:00:00-03:00`);
  return { inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 86400000).toISOString() };
}

/** Día que reporta el cron: 4 horas antes de que corra (Vercel puede demorarlo, sigue siendo el mismo día). */
export const fechaDelReporte = (ahora = new Date()) => hoyArg(new Date(ahora.getTime() - 4 * 3600000));

const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * @param {{
 *   fecha: string,
 *   proyectos: object[],      // ot, cliente, obra, proyecto, fecha_entrega, estado
 *   etapas: object[],         // codigo, nombre, orden
 *   avancePiezas: object[],   // filas de v_avance_piezas: ot, etapa, total, pasaron
 *   pasos: object[],          // pasos_pieza desde el inicio del día: ot, etapa, created_at
 *   avanceEtapas?: object[],  // avance_etapas: ot, etapa, estado, terminada_at, aprobada_at
 *   instalacion?: object[],   // reportes_instalacion del día (con empleado y pendientes)
 * }} datos
 */
export function armarReporteDiario({ fecha, proyectos = [], etapas = [], avancePiezas = [], pasos = [], avanceEtapas = [], instalacion = [] }) {
  const { inicio, fin } = limitesDia(fecha);
  const nombre = new Map(etapas.map((e) => [Number(e.codigo), e.nombre]));
  const orden = new Map(etapas.map((e) => [Number(e.codigo), e.orden ?? Number(e.codigo)]));
  const proy = new Map(proyectos.map((p) => [String(p.ot), p]));
  const k = (ot, etapa) => `${ot}|${Number(etapa)}`;

  // Escaneos del día y de después, por OT y etapa
  const hoy = new Map(), despues = new Map();
  for (const s of pasos) {
    const t = Date.parse(s.created_at);
    if (t < Date.parse(inicio)) continue;
    const m = t < Date.parse(fin) ? hoy : despues;
    m.set(k(s.ot, s.etapa), (m.get(k(s.ot, s.etapa)) || 0) + 1);
  }

  const porOt = new Map();
  for (const f of avancePiezas) {
    const total = Number(f.total) || 0;
    if (total <= 0) continue;
    const ot = String(f.ot);
    const pasaron = Math.min(Number(f.pasaron) || 0, total);
    const alFinal = Math.max(0, pasaron - (despues.get(k(ot, f.etapa)) || 0));
    const delDia = Math.min(alFinal, hoy.get(k(ot, f.etapa)) || 0);
    if (!porOt.has(ot)) porOt.set(ot, []);
    porOt.get(ot).push({ codigo: Number(f.etapa), total, alInicio: alFinal - delDia, alFinal, hoy: delDia });
  }

  const resumenOt = (ot, filas) => {
    const p = proy.get(ot) || {};
    return {
      ot,
      cliente: p.cliente || p.proyecto || null,
      antes: porcentajeOt(filas.map((e) => ({ total: e.total, pasaron: e.alInicio }))),
      despues: porcentajeOt(filas.map((e) => ({ total: e.total, pasaron: e.alFinal }))),
      piezasHoy: filas.reduce((s, e) => s + e.hoy, 0),
      etapas: filas
        .sort((a, b) => (orden.get(a.codigo) ?? 999) - (orden.get(b.codigo) ?? 999) || a.codigo - b.codigo)
        .map((e) => ({ codigo: e.codigo, nombre: nombre.get(e.codigo) || `Etapa ${e.codigo}`, hoy: e.hoy, pasaron: e.alFinal, total: e.total, porcentaje: pct(e.alFinal, e.total) })),
    };
  };
  const todas = new Map([...porOt].map(([ot, filas]) => [ot, resumenOt(ot, filas)]));

  const produccion = [...todas.values()]
    .filter((o) => o.piezasHoy > 0)
    .sort((a, b) => b.piezasHoy - a.piezasHoy || a.ot.localeCompare(b.ot, "es", { numeric: true }));
  const completadas = produccion.filter((o) => o.despues === 100 && o.antes < 100).map((o) => ({ ot: o.ot, cliente: o.cliente }));

  const enElDia = (ts) => ts && Date.parse(ts) >= Date.parse(inicio) && Date.parse(ts) < Date.parse(fin);
  const etapasCerradas = avanceEtapas
    .flatMap((a) => [
      enElDia(a.terminada_at) && { ot: String(a.ot), codigo: Number(a.etapa), que: "terminada" },
      enElDia(a.aprobada_at) && { ot: String(a.ot), codigo: Number(a.etapa), que: "firmada" },
    ])
    .filter(Boolean)
    .map((x) => ({ ...x, nombre: nombre.get(x.codigo) || `Etapa ${x.codigo}`, cliente: proy.get(x.ot)?.cliente || null }))
    .sort((a, b) => a.ot.localeCompare(b.ot, "es", { numeric: true }) || (orden.get(a.codigo) ?? 999) - (orden.get(b.codigo) ?? 999));

  // Atrasadas: abiertas, con entrega antes de ese día y producción sin terminar
  const atrasadas = proyectos
    .filter((p) => p.estado !== "cerrado" && p.fecha_entrega && p.fecha_entrega < fecha && todas.get(String(p.ot))?.despues !== 100)
    .map((p) => ({ ot: String(p.ot), cliente: p.cliente || p.proyecto || null, entrega: p.fecha_entrega, dias: diasEntre(p.fecha_entrega, fecha), porcentaje: todas.get(String(p.ot))?.despues ?? null }))
    .sort((a, b) => b.dias - a.dias);

  const instalaciones = instalacion.map((r) => ({
    ot: String(r.ot),
    cliente: proy.get(String(r.ot))?.cliente || null,
    quien: r.empleado || null,
    modulos: (r.modulos || []).length,
    avance: r.avance ?? null,
    comentario: r.comentario || null,
    pendientes: (r.pendientes || []).map((p) => p.descripcion),
  }));

  return {
    fecha,
    piezasHoy: produccion.reduce((s, o) => s + o.piezasHoy, 0),
    produccion,
    completadas,
    etapasCerradas,
    atrasadas,
    instalaciones,
  };
}

/** Sin escaneos, sin etapas cerradas y sin reportes de instalación: no se avisa. */
export function reporteVacio(r) {
  return !r || (r.piezasHoy === 0 && r.etapasCerradas.length === 0 && r.instalaciones.length === 0);
}
