// app/lib/costoReporte.js — Reportes → 💲 Costo por OT (costo de OT, parte F;
// sin migración). Una fila por OT cargada en el período: costo de materiales,
// horas-persona presupuestadas y reales, mano de obra y costo final. Las OT
// cerradas con costo calculado muestran su constancia (no cambia); las demás,
// el costo de hoy, provisorio.
//
// Desde el 12/11 (auditoría, parte 3) el costo es el real (con lo retirado
// de más, compras sin stock, retrabajo, instalación y gastos de Finanzas) y
// cada fila trae también el previsto.
import { textoOt } from "./nombreOt";
import { resumenReal } from "./costoReal";
import { MARGEN_MINIMO, margen } from "./margenOt";

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * @param {{ proyecto: object, materiales?: object|null, horas?: object|null, costoHora?: number|null, final?: object|null, fechaOt?: string|null, comparativa?: object|null, precio?: number|null, minimo?: number }} d
 *   final: costos_finales_ot vigente (estado calculado) de la OT, si la hay
 *   comparativa: costoPrevistoReal de la OT abierta (app/lib/costoReal.js)
 */
export function filaReporte({ proyecto, materiales = null, horas = null, costoHora = null, final = null, fechaOt = null, comparativa = null, precio = null, minimo = MARGEN_MINIMO }) {
  const base = {
    ot: String(proyecto.ot),
    cliente: proyecto.cliente || null,
    obra: proyecto.obra || null,
    descripcion: proyecto.descripcion || null,
    division: proyecto.division ?? null,
    fecha_ot: fechaOt,
    estado_ot: proyecto.estado || null,
  };
  let fila;
  if (final) {
    const totalHoras = (final.detalle?.horas || []).find((h) => h.etapa === "total");
    fila = {
      ...base,
      costo: "final",
      materiales: num(final.materiales),
      sin_precio: Number(final.sin_precio) || 0,
      horas_presupuestadas: num(totalHoras?.presupuestadas?.valor),
      horas_reales: num(final.horas_persona),
      costo_hora: num(final.costo_hora),
      mano_obra: num(final.mano_obra),
      total: num(final.total),
    };
  } else {
    const ch = num(costoHora);
    const reales = num(horas?.total?.reales?.valor);
    const manoObra = ch != null && reales != null ? r2(ch * reales) : null;
    const mat = materiales ? r2(Number(materiales.total) || 0) : null;
    fila = {
      ...base,
      costo: "provisorio",
      materiales: mat,
      sin_precio: Number(materiales?.sinPrecio) || 0,
      horas_presupuestadas: num(horas?.total?.presupuestadas?.valor),
      horas_reales: reales,
      costo_hora: ch,
      mano_obra: manoObra,
      total: mat != null || manoObra != null ? r2((mat || 0) + (manoObra || 0)) : null,
    };
    if (comparativa) {
      const res = resumenReal(comparativa);
      Object.assign(fila, { materiales: res.materiales, mano_obra: res.mano_obra, total: res.total });
    }
  }
  const cmp = final ? final.detalle?.comparativa || null : comparativa;
  fila.previsto = cmp ? num(cmp.previsto) : null;
  fila.gastos = cmp ? num(cmp.renglones?.find((x) => x.id === "gastos")?.real) || 0 : null;
  fila.desvio = fila.previsto != null && fila.total != null ? r2(fila.total - fila.previsto) : null;
  fila.desvio_pct = fila.previsto > 0 && fila.total != null ? Math.round((fila.total / fila.previsto) * 100) : null;
  // Margen (auditoría 12/11, parte 4): precio del Plan sin IVA contra el costo real
  const m = margen({ precio, costo: fila.total, minimo });
  fila.precio = num(precio);
  fila.ganancia = m ? m.ganancia : null;
  fila.margen = m ? m.pct : null;
  fila.margen_bajo = !!m?.bajo;
  const p = fila.horas_presupuestadas, r = fila.horas_reales;
  fila.diferencia = p != null && r != null ? r1(r - p) : null;
  fila.pct = p > 0 && r != null ? Math.round((r / p) * 100) : null;
  return fila;
}

/** Previsto y desvío de las filas que tienen previsto (las demás no se comparan). */
function previstoTotal(filas) {
  const con = filas.filter((f) => f.previsto != null && f.total != null);
  if (!con.length) return { previsto: null, real_comparado: null, desvio: null, desvio_pct: null };
  const p = r2(con.reduce((s, f) => s + f.previsto, 0));
  const r = r2(con.reduce((s, f) => s + f.total, 0));
  return { previsto: p, real_comparado: r, desvio: r2(r - p), desvio_pct: p > 0 ? Math.round((r / p) * 100) : null };
}

/** Precio, ganancia y margen de las filas con precio; cuántas bajo el mínimo. */
function margenTotal(filas) {
  const con = filas.filter((f) => f.precio > 0 && f.total != null);
  const bajas = filas.filter((f) => f.margen_bajo).length;
  if (!con.length) return { precio: null, ganancia: null, margen: null, con_precio: 0, margen_bajo: bajas };
  const p = r2(con.reduce((s, f) => s + f.precio, 0));
  const g = r2(p - con.reduce((s, f) => s + f.total, 0));
  return { precio: p, ganancia: g, margen: Math.round((g / p) * 1000) / 10, con_precio: con.length, margen_bajo: bajas };
}

/** Totales de las filas (los vacíos no suman). */
export function totalesReporte(filas = []) {
  const suma = (campo) => {
    const vals = filas.map((f) => f[campo]).filter((v) => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  };
  const p = suma("horas_presupuestadas"), r = suma("horas_reales");
  return {
    ots: filas.length,
    finales: filas.filter((f) => f.costo === "final").length,
    materiales: suma("materiales") != null ? r2(suma("materiales")) : null,
    sin_precio: filas.reduce((s, f) => s + (f.sin_precio || 0), 0),
    horas_presupuestadas: p != null ? r1(p) : null,
    horas_reales: r != null ? r1(r) : null,
    diferencia: p != null && r != null ? r1(r - p) : null,
    pct: p > 0 && r != null ? Math.round((r / p) * 100) : null,
    mano_obra: suma("mano_obra") != null ? r2(suma("mano_obra")) : null,
    total: suma("total") != null ? r2(suma("total")) : null,
    ...previstoTotal(filas),
    ...margenTotal(filas),
  };
}

const n = (v, d = 2) => (v === null || v === undefined ? "" : Number(v).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: d, useGrouping: false }));

/** Planilla para Excel (CSV con los números en formato argentino). */
export function planillaReporte(filas = [], { nombreDivision = (d) => d ?? "" } = {}) {
  const t = totalesReporte(filas);
  const enc = ["OT", "División", "Fecha de carga", "Costo", "Materiales", "Artículos sin precio", "Horas presupuestadas", "Horas reales", "Diferencia", "% real/presup.", "Costo de la hora", "Mano de obra", "Gastos de la OT", "Costo final", "Costo previsto", "Desvío", "% real/previsto", "Precio sin IVA", "Ganancia", "Margen %", "Bajo el mínimo"];
  const fila = (f) => [
    textoOt({ ot: f.ot, cliente: f.cliente, obra: f.obra, descripcion: f.descripcion }) || f.ot,
    nombreDivision(f.division), f.fecha_ot ? f.fecha_ot.split("-").reverse().join("/") : "",
    f.costo === "final" ? "Final (OT cerrada)" : "Provisorio",
    n(f.materiales), f.sin_precio || "", n(f.horas_presupuestadas, 1), n(f.horas_reales, 1), n(f.diferencia, 1), f.pct ?? "",
    n(f.costo_hora), n(f.mano_obra), n(f.gastos), n(f.total), n(f.previsto), n(f.desvio), f.desvio_pct ?? "",
    n(f.precio), n(f.ganancia), n(f.margen, 1), f.margen_bajo ? "Sí" : "",
  ];
  return [enc, ...filas.map(fila), ["Total", "", "", `${t.finales} de ${t.ots} finales`, n(t.materiales), t.sin_precio || "", n(t.horas_presupuestadas, 1), n(t.horas_reales, 1), n(t.diferencia, 1), t.pct ?? "", "", n(t.mano_obra), "", n(t.total), n(t.previsto), n(t.desvio), t.desvio_pct ?? "", n(t.precio), n(t.ganancia), n(t.margen, 1), t.margen_bajo || ""]];
}
