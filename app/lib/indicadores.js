// app/lib/indicadores.js — Indicadores de producción de un período (Órdenes
// de Producción, parte 7; ítem 39). Se calculan con lo que ya se registra:
// tareas (horas, cantidades, tipo), paradas con su causa, no conformidades y
// las OT. Miden el proceso (etapas, causas, OT), no a las personas.
import { minutosDe, TIPOS_RETRABAJO } from "./detalleOp";
import { nombreCausa } from "./causas";
import { esEtapaDeModulos, nombreDefecto, DECISIONES } from "./calidad";

const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 1000) / 10 : 0);

/**
 * @param {{ tareas: object[], etapas?: object[], causas?: object[], defectos?: object[],
 *   noConformidades?: object[], proyectos?: object[], hoy: string, ahora?: number }} datos
 *   tareas: registro_actividades del período (productivas y paradas)
 *   noConformidades: las registradas en el período
 *   proyectos: todas las OT (para nombres, total de módulos y atrasos)
 */
export function calcularIndicadores({ tareas = [], etapas = [], causas = [], defectos = [], noConformidades = [], proyectos = [], hoy, ahora = Date.now() }) {
  const porCodigo = new Map(etapas.filter((e) => e.codigo > 0).map((e) => [Number(e.codigo), e]));
  const porOt = new Map(proyectos.map((p) => [String(p.ot), p]));

  // ─── Minutos por unidad de cada etapa ───
  const etapasMap = new Map();
  const otsMap = new Map();
  const paradasMap = new Map();
  let productivoMin = 0;
  let paradoMin = 0;
  let retrabajoMin = 0;
  const retrabajos = new Map();

  for (const t of tareas) {
    const min = minutosDe(t, ahora);
    const codigo = Number(t.etapa);
    if (codigo === 0) {
      paradoMin += min;
      const cod = t.causa || "?";
      const p = paradasMap.get(cod) || { causa: cod, nombre: t.causa ? nombreCausa(causas, cod) : "Sin causa", min: 0, veces: 0 };
      p.min += min;
      p.veces++;
      paradasMap.set(cod, p);
      continue;
    }
    if (!(codigo > 0)) continue;
    productivoMin += min;

    const info = porCodigo.get(codigo);
    const et = etapasMap.get(codigo) || {
      codigo, nombre: info?.nombre || `Etapa ${codigo}`, icon: info?.icon || "", unidad: info?.unidad || null,
      orden: info?.orden ?? codigo, min: 0, cantidad: 0, minConCantidad: 0,
    };
    et.min += min;
    const n = Number(t.cantidad);
    if (t.cantidad != null && Number.isFinite(n) && n > 0) {
      et.cantidad += n;
      et.minConCantidad += min;
    }
    etapasMap.set(codigo, et);

    const tipo = t.tipo && t.tipo !== "N" ? t.tipo : null;
    if (tipo) {
      retrabajoMin += min;
      const r = retrabajos.get(tipo) || { tipo, nombre: TIPOS_RETRABAJO[tipo] || tipo, min: 0, veces: 0 };
      r.min += min;
      r.veces++;
      retrabajos.set(tipo, r);
    }

    if (t.codigo_proyecto) {
      const k = String(t.codigo_proyecto);
      const o = otsMap.get(k) || { ot: k, min: 0, modulosHechos: 0 };
      o.min += min;
      if (info && esEtapaDeModulos(info) && Number.isFinite(n) && n > 0) o.modulosHechos += n;
      otsMap.set(k, o);
    }
  }

  const etapasRes = [...etapasMap.values()]
    .map((e) => ({
      ...e,
      modulos: esEtapaDeModulos(e),
      // Solo con las tareas que anotaron cantidad: si no, el promedio miente
      minPorUnidad: e.unidad && e.cantidad > 0 ? e.minConCantidad / e.cantidad : null,
      sinCantidadPct: e.unidad ? Math.round(pct(e.min - e.minConCantidad, e.min)) : null,
    }))
    .sort((a, b) => a.orden - b.orden || a.codigo - b.codigo);

  // ─── Tiempo parado por causa ───
  const totalMin = productivoMin + paradoMin;
  const paradas = [...paradasMap.values()]
    .map((p) => ({ ...p, pct: pct(p.min, totalMin) }))
    .sort((a, b) => b.min - a.min);

  // ─── No conformidades ───
  const piezas = noConformidades.reduce((s, n) => s + (Number(n.cantidad) || 1), 0);
  const ncMin = noConformidades.reduce((s, n) => s + (Number(n.minutos_retrabajo) || 0), 0);
  const agrupar = (clave, nombre) => {
    const m = new Map();
    for (const n of noConformidades) {
      const k = clave(n);
      if (k == null) continue;
      const g = m.get(k) || { clave: k, nombre: nombre(k), piezas: 0 };
      g.piezas += Number(n.cantidad) || 1;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.piezas - a.piezas || String(a.clave).localeCompare(String(b.clave)));
  };
  const nombreEtapa = (c) => porCodigo.get(Number(c))?.nombre || `Etapa ${c}`;
  const calidad = {
    registros: noConformidades.length,
    piezas,
    sinDecidir: noConformidades.filter((n) => !n.decision).length,
    minutosRetrabajo: ncMin,
    porDefecto: agrupar((n) => n.defecto, (k) => nombreDefecto(defectos, k)),
    porOrigen: agrupar((n) => n.etapa_origen ?? null, nombreEtapa),
    porDecision: DECISIONES.map((d) => ({ ...d, piezas: noConformidades.filter((n) => n.decision === d.cod).reduce((s, n) => s + (Number(n.cantidad) || 1), 0) })).filter((d) => d.piezas > 0),
  };

  // ─── Tiempo de cada OT en el período ───
  const ots = [...otsMap.values()]
    .map((o) => {
      const p = porOt.get(o.ot);
      return {
        ...o,
        cliente: p?.cliente || p?.proyecto || "",
        totalModulos: p?.total_modulos || null,
        // Horas por módulo: las del período sobre el total de la OT
        minPorModulo: p?.total_modulos ? o.min / p.total_modulos : null,
      };
    })
    .sort((a, b) => b.min - a.min);

  // ─── OT atrasadas (abiertas, con entrega vencida) ───
  const atrasadas = proyectos
    .filter((p) => p.estado !== "cerrado" && !p.terminado_planilla && p.fecha_entrega && p.fecha_entrega < hoy)
    .map((p) => ({ ot: String(p.ot), cliente: p.cliente || p.proyecto || "", fecha_entrega: p.fecha_entrega, dias: Math.round((Date.parse(hoy) - Date.parse(p.fecha_entrega)) / 86400000) }))
    .sort((a, b) => b.dias - a.dias);

  return {
    productivoMin,
    paradoMin,
    paradoPct: pct(paradoMin, totalMin),
    retrabajoMin,
    retrabajoPct: pct(retrabajoMin, productivoMin),
    retrabajos: [...retrabajos.values()].sort((a, b) => b.min - a.min),
    etapas: etapasRes,
    paradas,
    calidad,
    ots,
    atrasadas,
  };
}

/** "placas" → "placa", "metros" → "metro", "unidades" → "unidad" (para "6 min por placa"). */
export function singular(unidad) {
  const u = String(unidad || "").trim();
  if (/[^aeiou]es$/i.test(u) && /(d|l|n|r)es$/i.test(u)) return u.slice(0, -2);
  return u.endsWith("s") ? u.slice(0, -1) : u;
}

/** 4.5 → "4,5 min"; 95 → "1 h 35 min". */
export function fmtPorUnidad(min) {
  if (min == null) return "—";
  if (min < 60) return `${Number(min.toFixed(1)).toLocaleString("es-AR")} min`;
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
