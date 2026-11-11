// app/lib/finanzasSos.js — Finanzas, parte 4 del plan del 09/11: importar el
// CSV de compras del S.O.S Contador sin duplicar. Sin migración.
//
// El CSV (separado por ";", con títulos) trae un comprobante por renglón:
// fecha, CUIT, proveedor, comprobante ("A-00006-00039368", "NC A-…", "ND A-…"),
// neto, IVA, percepciones, total y una "Cuenta" del S.O.S que no es confiable.
//
//   - Cada comprobante tiene su clave (CUIT + clase + letra + punto de venta +
//     número): el mismo CSV cargado dos veces no duplica nada (origen "sos").
//   - El mismo número del mismo proveedor ya cargado por otro camino (Mi caja,
//     Cargar un gasto, una factura de OC) queda "ya está" (finanzasComprobantes).
//   - Lo que ya está cargado de otra forma (el libro, una factura de OC, una
//     compra a mano) se reconoce por proveedor, importe con signo (la nota de
//     crédito resta) y fecha cerca (15 días). Si coincide solo el importe y la
//     fecha, con otro nombre, queda como "¿ya está?" y se decide a mano.
//   - La cuenta sale del proveedor (parte 3); si no tiene, la del S.O.S si
//     existe en el plan, y queda "para revisar".
//   - Los proveedores que no están en la lista se suman con su CUIT.
import { claveNombre, efectoDeuda, emparejarProveedor } from "./finanzasProveedores";
import { comprobanteRepetido, mismoNombre } from "./finanzasComprobantes";

export const ORIGEN_SOS = "sos";
export const TIPO_COMPRA_SOS = "COMPRAS";
export const DIAS_CERCA = 15;
const MAX_FILAS = 5000;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** "1.234,56" o "-127685,95" → número (NaN si no es). */
export function numeroSos(v) {
  const s = String(v ?? "").trim().replace(/\s/g, "");
  if (!s) return 0;
  const t = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** "&#237;" y "&amp;" del S.O.S → letras. Van antes de separar: el ";" de "&#237;" corre las columnas. */
function sinEntidades(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** "01/10/2026" → "2026-10-01" (o "" si no es fecha). */
function fechaSos(s) {
  const m = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}

/** "NC A-00003-00000312" → { clase: "NC", letra: "A", pv: 3, numero: 312 } */
export function comprobanteSos(s) {
  const m = String(s || "").trim().toUpperCase().match(/^(NC|ND|FC|FA)?\s*([A-Z])\s*-\s*(\d{1,5})\s*-\s*(\d{1,8})$/);
  if (!m) return null;
  return { clase: m[1] === "NC" || m[1] === "ND" ? m[1] : "FC", letra: m[2], pv: Number(m[3]), numero: Number(m[4]) };
}

const NOMBRES_CLASE = { FC: "Factura", NC: "Nota de crédito", ND: "Nota de débito" };

/**
 * Lee el CSV del S.O.S.
 * @returns {{ filas: object[], errores: string[] }}
 */
export function leerCsvSos(texto) {
  const lineas = sinEntidades(String(texto || "").replace(/^﻿/, "")).split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return { filas: [], errores: ["El archivo está vacío"] };
  const titulos = lineas[0].split(";").map((t) => t.trim().toLowerCase());
  const col = (n) => titulos.indexOf(n.toLowerCase());
  const c = {
    fecha: col("Fecha Comprobante"), cuit: col("CUIT"), proveedor: col("Proveedor"), comprobante: col("Comprobante"),
    neto: col("Neto"), ivaComp: col("IVA COMPUTABLE"), iva: col("IVA"), noGravado: col("No Gravado"), exento: col("Exento"),
    total: col("Total"), cuenta: col("Cuenta"), moneda: col("Moneda"), tc: col("Tipo Cambio"),
  };
  const falta = ["fecha", "proveedor", "comprobante", "neto", "total"].filter((k) => c[k] < 0);
  if (falta.length) return { filas: [], errores: ["No es el CSV de compras del S.O.S Contador: faltan las columnas Fecha Comprobante, Proveedor, Comprobante, Neto o Total"] };

  const filas = [];
  const errores = [];
  const vistas = new Set();
  for (let i = 1; i < lineas.length && filas.length < MAX_FILAS; i++) {
    const x = lineas[i].split(";");
    const v = (k) => (c[k] >= 0 ? String(x[c[k]] ?? "").trim() : "");
    const n = i + 1;
    const fecha = fechaSos(v("fecha"));
    const comp = comprobanteSos(v("comprobante"));
    if (!fecha || !comp) { errores.push(`Renglón ${n}: no se entiende la fecha o el comprobante`); continue; }
    const total = numeroSos(v("total"));
    const neto = numeroSos(v("neto"));
    const ivaRaw = c.ivaComp >= 0 ? v("ivaComp") : v("iva");
    const iva = numeroSos(ivaRaw);
    const extra = numeroSos(v("noGravado")) + numeroSos(v("exento"));
    if ([total, neto, iva, extra].some(Number.isNaN)) { errores.push(`Renglón ${n}: el importe no es un número`); continue; }
    if (!total) { errores.push(`Renglón ${n} (${comp.letra}-${comp.pv}-${comp.numero}): el total es cero, no se carga`); continue; }
    const cuit = v("cuit").replace(/\D/g, "").slice(0, 11);
    const nombre = v("proveedor").replace(/\s+/g, " ").slice(0, 120);
    const clave = `sos${cuit || claveNombre(nombre).slice(0, 11)}${comp.clase}${comp.letra}${String(comp.pv).padStart(5, "0")}${String(comp.numero).padStart(8, "0")}`;
    if (vistas.has(clave)) continue; // repetido en el mismo archivo
    vistas.add(clave);
    const moneda = /^USD|DOL/i.test(v("moneda")) ? "USD" : "ARS";
    const tc = moneda === "USD" ? numeroSos(v("tc")) || null : null;
    // Todo en positivo; la clase dice para qué lado va (la nota de crédito resta)
    const signo = comp.clase === "NC" || total < 0 ? -1 : 1;
    const t = centavos(Math.abs(total));
    const i2 = centavos(Math.min(Math.abs(iva), t));
    let nt = centavos(Math.abs(neto) + Math.abs(extra));
    if (nt + i2 > t) nt = centavos(t - i2);
    filas.push({
      clave, renglon: n, fecha, cuit, nombre,
      clase: signo < 0 ? "NC" : comp.clase, letra: comp.letra, pv: comp.pv, numero: comp.numero,
      comprobante: `${comp.letra}-${String(comp.pv).padStart(5, "0")}-${String(comp.numero).padStart(8, "0")}`,
      neto: nt, iva: i2, otros: Math.max(0, centavos(t - nt - i2)) || 0, total: t, signo,
      moneda, tipo_cambio: tc, cuenta_sos: v("cuenta").slice(0, 120),
    });
  }
  return { filas, errores };
}

export { mismoNombre };

/** El proveedor de la lista: por CUIT, si no por nombre. */
export function proveedorDeSos(fila, proveedores = []) {
  if (fila.cuit) {
    const p = proveedores.find((x) => String(x.cuit || "").replace(/\D/g, "") === fila.cuit);
    if (p) return p;
  }
  return emparejarProveedor(fila.nombre, proveedores) || proveedores.find((x) => mismoNombre(x.nombre, fila.nombre)) || null;
}

const dias = (a, b) => Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const esCaja = (c, cajas) => cajas.has(c) || String(c || "").startsWith("01.01.01.");

/**
 * Qué pasa con cada renglón del CSV.
 *   importada: ya se cargó este mismo comprobante desde el S.O.S
 *   ya_esta:   hay una compra del mismo proveedor, mismo importe y fecha cerca (se saltea)
 *   dudosa:    hay una compra con el mismo importe y fecha cerca, de otro nombre (se elige)
 *   nueva:     no está (se carga)
 * @param {object[]} filas de leerCsvSos
 * @param {{ operaciones: object[], proveedores: object[], cuentasProv: Set<string>, cajas?: Set<string>, conComprobante?: object[] }} ctx
 *   conComprobante: las que no tocan Proveedores pero tienen número (Mi caja, un gasto pagado)
 */
export function compararSos(filas, { operaciones = [], proveedores = [], cuentasProv, cajas = new Set(), conComprobante = [] }) {
  const nombreProv = new Map(proveedores.map((p) => [Number(p.id), p.nombre]));
  const importadas = new Map();
  const libres = [];
  for (const op of operaciones) {
    if (op.anulada_at) continue;
    if (op.origen === ORIGEN_SOS && op.origen_id) { importadas.set(op.origen_id, op); continue; }
    const efecto = efectoDeuda(op, cuentasProv);
    if (!efecto) continue;
    // Un pago (Proveedores contra una caja o un banco) no es una nota de crédito
    if (efecto < 0 && esCaja(op.cuenta_haber, cajas)) continue;
    if (efecto > 0 && esCaja(op.cuenta_debe, cajas)) continue;
    libres.push({ op, efecto, nombre: op.proveedor_id ? nombreProv.get(Number(op.proveedor_id)) || op.entidad : op.entidad });
  }
  const usadas = new Set();
  const out = filas.map((f) => {
    const p = proveedorDeSos(f, proveedores);
    return { ...f, proveedor_id: p ? Number(p.id) : null, proveedor_nombre: p?.nombre || null };
  });

  const importe = (f) => centavos(f.signo * f.total * (f.moneda === "USD" ? f.tipo_cambio || 0 : 1));
  const cerca = (f, l) => Math.abs(l.efecto - importe(f)) <= 1 && dias(l.op.fecha, f.fecha) <= DIAS_CERCA;
  const masCerca = (f, cands) => cands.sort((a, b) => dias(a.op.fecha, f.fecha) - dias(b.op.fecha, f.fecha))[0];

  // 1. El mismo comprobante ya importado
  for (const f of out) if (importadas.has(f.clave)) { f.estado = "importada"; f.op_id = importadas.get(f.clave).id; }
  // 1b. El mismo número del mismo proveedor, cargado por otro camino (Mi caja,
  // Cargar un gasto, una factura de OC): aunque no toque Proveedores
  const conNumero = [...operaciones, ...conComprobante].filter((op) => op.referencia && op.origen !== ORIGEN_SOS && !op.anulada_at);
  for (const f of out) {
    if (f.estado) continue;
    const op = comprobanteRepetido({ referencia: `${f.clase} ${f.comprobante}`, proveedor_id: f.proveedor_id, entidad: f.nombre }, conNumero, proveedores);
    if (op && !usadas.has(op.id)) { usadas.add(op.id); Object.assign(f, { estado: "ya_esta", op_id: op.id, op_nombre: op.proveedor_id ? nombreProv.get(Number(op.proveedor_id)) || op.entidad : op.entidad, op_fecha: op.fecha }); }
  }
  // 2. Mismo proveedor, importe y fecha cerca
  for (const f of out) {
    if (f.estado) continue;
    const l = masCerca(f, libres.filter((x) => !usadas.has(x.op.id) && cerca(f, x)
      && ((f.proveedor_id && Number(x.op.proveedor_id) === f.proveedor_id) || mismoNombre(x.nombre, f.nombre) || (f.proveedor_nombre && mismoNombre(x.nombre, f.proveedor_nombre)))));
    if (l) { usadas.add(l.op.id); Object.assign(f, { estado: "ya_esta", op_id: l.op.id, op_nombre: l.nombre, op_fecha: l.op.fecha }); }
  }
  // 3. Solo importe y fecha: se decide a mano
  for (const f of out) {
    if (f.estado) continue;
    const l = masCerca(f, libres.filter((x) => !usadas.has(x.op.id) && cerca(f, x)));
    if (l) { usadas.add(l.op.id); Object.assign(f, { estado: "dudosa", op_id: l.op.id, op_nombre: l.nombre, op_fecha: l.op.fecha }); }
    else f.estado = "nueva";
  }
  return out;
}

/**
 * La operación de un renglón del CSV.
 * @param {object} f renglón de compararSos (con proveedor_id ya resuelto)
 * @param {{ cuentaProveedores: string, cuenta: string|null, deProveedor: boolean }} ctx
 *   cuenta: la del proveedor (deProveedor true) o la del S.O.S en el plan
 */
export function operacionSos(f, { cuentaProveedores, cuenta, deProveedor }) {
  const nc = f.signo < 0;
  const tc = f.moneda === "USD" ? f.tipo_cambio : null;
  return {
    fecha: f.fecha, tipo: TIPO_COMPRA_SOS, proveedor_id: f.proveedor_id || null, entidad: f.proveedor_id ? null : f.nombre || null,
    neto: f.neto, iva: f.iva, otros_impuestos: f.otros, total: f.total, moneda: f.moneda, tipo_cambio: tc,
    total_ars: f.moneda === "USD" ? centavos(f.total * (tc || 0)) : f.total,
    cuenta_debe: nc ? cuentaProveedores : cuenta, cuenta_haber: nc ? cuenta : cuentaProveedores,
    descripcion: `${NOMBRES_CLASE[f.clase] || "Factura"} ${f.comprobante} (S.O.S)${!deProveedor && f.cuenta_sos ? ` · Cuenta del S.O.S: ${f.cuenta_sos}` : ""}`.slice(0, 500),
    referencia: `${f.clase} ${f.comprobante}`.slice(0, 120),
    origen: ORIGEN_SOS, origen_id: f.clave, estado: deProveedor ? "confirmada" : "para_revisar",
  };
}
