// app/lib/finanzasSueldos.js — Finanzas, parte F5b (migración 178): las
// liquidaciones de sueldos. Los sueldos se calculan afuera; acá se pasa la
// liquidación (Tadeo, 09/11).
//
//   - Conceptos: Sueldo básico, Presentismo, Horas Extra, Bonos, Horas
//     trabajadas, Horas Extra trabajadas, Vacaciones, S.A.C y los que se
//     sumen. Cada uno es un importe (va al libro) o una cantidad de horas
//     (queda como dato). Cada importe tiene su cuenta; los que "van a la
//     cuenta del área" (básico, presentismo) usan la cuenta de sueldo de cada
//     empleado (Producción, Administración, Diseño…).
//   - Confirmar: cada importe de cada empleado es un DEVENG SUELDO en su
//     cuenta contra Sueldos A Pagar (un importe negativo, un descuento, va al
//     revés). origen "liquidacion", origen_id "l<id>:<empleado>:<concepto>".
//   - Pagar: PAGO SUELDO, Sueldos A Pagar contra la caja o el banco, por
//     empleado. origen "pago_sueldo", origen_id "l<id>:<empleado>:<n>".
// La configuración va en config_sistema ("finanzas_sueldos"):
//   { conceptos: [{ codigo, nombre, clase, cuenta, usa_area, activo }], areas: { <empleado_id>: <cuenta> } }
import { claveNombre } from "./finanzasProveedores";

export const CLAVE_SUELDOS = "finanzas_sueldos";
export const ORIGEN_LIQUIDACION = "liquidacion";
export const ORIGEN_PAGO_SUELDO = "pago_sueldo";
export const TIPO_DEVENGADO = "DEVENG SUELDO";
export const TIPO_PAGO = "PAGO SUELDO";
export const CUENTA_SUELDOS_A_PAGAR = /^sueldos a pagar$/i;
export const CUENTA_AREA = /^sueldos,? jornales/i;
export const MAX_CONCEPTOS = 40;
export const MAX_RENGLONES = 1000;
export const CLASES = { importe: "Importe ($)", horas: "Horas (dato)" };

/** Los conceptos de siempre, con la cuenta que se busca por nombre en el plan. */
export const CONCEPTOS_BASE = [
  { codigo: "basico", nombre: "Sueldo básico", clase: "importe", usa_area: true, busca: /^sueldos,? jornales y contribuciones$|^sueldos y jornales$/i },
  { codigo: "presentismo", nombre: "Presentismo", clase: "importe", usa_area: true, busca: /^sueldos,? jornales y contribuciones$|^sueldos y jornales$/i },
  { codigo: "horas_extra", nombre: "Horas Extra", clase: "importe", busca: /^horas extras?/i },
  { codigo: "bonos", nombre: "Bonos", clase: "importe", busca: /^bonos/i },
  { codigo: "horas_trabajadas", nombre: "Horas trabajadas", clase: "horas" },
  { codigo: "horas_extra_trabajadas", nombre: "Horas Extra trabajadas", clase: "horas" },
  { codigo: "vacaciones", nombre: "Vacaciones", clase: "importe", busca: /^vacaciones/i },
  { codigo: "sac", nombre: "S.A.C", clase: "importe", busca: /^s\.?\s?a\.?\s?c\.?$|aguinaldo/i },
];

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** "Bonos por producción" → "bonos_por_produccion". */
export function codigoConcepto(nombre) {
  return String(nombre || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
}

/** La primera cuenta activa del plan cuyo nombre cumple. */
const buscarCuenta = (cuentas, re) => (re ? cuentas.find((c) => c.activa !== false && re.test(String(c.nombre || "").trim()))?.codigo || null : null);

/** Las cuentas de sueldo de las áreas ("Sueldos, Jornales y Contribuciones Administración"…). */
export function cuentasDeArea(cuentas = []) {
  return cuentas.filter((c) => c.activa !== false && CUENTA_AREA.test(String(c.nombre || "").trim()));
}

/** La cuenta Sueldos A Pagar. */
export const cuentaSueldosAPagar = (cuentas = []) => buscarCuenta(cuentas, CUENTA_SUELDOS_A_PAGAR);

/**
 * Los conceptos de la empresa: los de siempre (con la cuenta guardada o la
 * que se encuentra por nombre) y los que se sumaron, en el orden guardado.
 */
export function leerConfigSueldos(valor, cuentas = []) {
  const guardados = Array.isArray(valor?.conceptos) ? valor.conceptos : [];
  const porCodigo = new Map(guardados.map((c) => [c.codigo, c]));
  const base = CONCEPTOS_BASE.map((b) => {
    const g = porCodigo.get(b.codigo) || {};
    return { codigo: b.codigo, nombre: txt(g.nombre, 60) || b.nombre, clase: b.clase, usa_area: g.usa_area ?? Boolean(b.usa_area), cuenta: g.cuenta || buscarCuenta(cuentas, b.busca), activo: g.activo !== false, base: true };
  });
  const extra = guardados.filter((c) => c?.codigo && !CONCEPTOS_BASE.some((b) => b.codigo === c.codigo)).map((c) => ({
    codigo: c.codigo, nombre: txt(c.nombre, 60) || c.codigo, clase: c.clase === "horas" ? "horas" : "importe", usa_area: Boolean(c.usa_area), cuenta: c.cuenta || null, activo: c.activo !== false, base: false,
  }));
  // El orden guardado manda; los nuevos de siempre van al final de los suyos
  const orden = new Map(guardados.map((c, i) => [c.codigo, i]));
  const todos = [...base, ...extra].sort((a, b) => (orden.get(a.codigo) ?? 1000 + CONCEPTOS_BASE.findIndex((x) => x.codigo === a.codigo)) - (orden.get(b.codigo) ?? 1000 + CONCEPTOS_BASE.findIndex((x) => x.codigo === b.codigo)));
  const areas = valor?.areas && typeof valor.areas === "object" ? valor.areas : {};
  return { conceptos: todos, areas };
}

/** Valida la configuración que manda la pantalla. */
export function validarConfigSueldos(d = {}, cuentas = []) {
  const errores = [];
  const hay = new Set(cuentas.filter((c) => c.activa !== false).map((c) => c.codigo));
  const conceptos = [];
  const vistos = new Set();
  for (const [i, c] of (Array.isArray(d.conceptos) ? d.conceptos : []).slice(0, MAX_CONCEPTOS + 1).entries()) {
    const nombre = txt(c?.nombre, 60);
    const codigo = c?.codigo && /^[a-z0-9_]{1,40}$/.test(c.codigo) ? c.codigo : codigoConcepto(nombre);
    if (!nombre || !codigo) { errores.push(`Concepto ${i + 1}: falta el nombre`); continue; }
    if (vistos.has(codigo)) { errores.push(`"${nombre}" está repetido`); continue; }
    vistos.add(codigo);
    const clase = c.clase === "horas" ? "horas" : "importe";
    const cuenta = c.cuenta ? String(c.cuenta) : null;
    if (cuenta && !hay.has(cuenta)) errores.push(`"${nombre}": esa cuenta no está en el plan`);
    conceptos.push({ codigo, nombre, clase, cuenta: clase === "horas" ? null : cuenta, usa_area: clase === "importe" && Boolean(c.usa_area), activo: c.activo !== false });
  }
  if (conceptos.length > MAX_CONCEPTOS) errores.push(`Hasta ${MAX_CONCEPTOS} conceptos`);
  const areas = {};
  for (const [emp, cuenta] of Object.entries(d.areas && typeof d.areas === "object" ? d.areas : {}).slice(0, 2000)) {
    if (!/^[0-9a-f-]{1,40}$/i.test(emp) || !cuenta) continue;
    if (!hay.has(String(cuenta))) { errores.push("La cuenta del área de un empleado no está en el plan"); break; }
    areas[emp] = String(cuenta);
  }
  return { valor: { conceptos, areas }, errores };
}

/** Un número escrito a la argentina ("1.234,50") o con punto ("1234.5"); null si está vacío o no es un número. */
export function numeroSueldo(v) {
  if (typeof v === "number") return Number.isFinite(v) ? centavos(v) : null;
  let s = String(v ?? "").replace(/\$|\s/g, "");
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? centavos(n) : null;
}

/** Busca al empleado por legajo o por nombre (sin mayúsculas, acentos ni puntos; también "Apellido Nombre"). */
export function emparejarEmpleado(texto, empleados = []) {
  const s = txt(texto);
  if (!s) return null;
  if (/^\d{1,8}$/.test(s)) {
    const porLegajo = empleados.find((e) => String(e.legajo) === s);
    if (porLegajo) return porLegajo;
  }
  const k = claveNombre(s);
  const palabras = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).sort().join(" ");
  const kp = palabras(s);
  return empleados.find((e) => claveNombre(e.nombre) === k) || empleados.find((e) => palabras(e.nombre) === kp) || null;
}

/**
 * Lo pegado desde Excel: la primera fila con el nombre (o legajo) y los
 * conceptos como títulos; cada fila, un empleado.
 * @returns {{ renglones: object[], sin_empleado: string[], sin_concepto: string[], error?: string }}
 */
export function renglonesDePegado(texto, conceptos = [], empleados = []) {
  const filas = String(texto || "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim()).map((l) => l.split("\t"));
  if (filas.length < 2) return { renglones: [], sin_empleado: [], sin_concepto: [], error: "Pegá la tabla con los títulos en la primera fila" };
  const titulos = filas[0].map((t) => claveNombre(t));
  const colEmp = titulos.findIndex((t) => /^(EMPLEADO|NOMBRE|APELLIDOYNOMBRE|NOMBREYAPELLIDO|LEGAJO)$/.test(t));
  const iEmp = colEmp >= 0 ? colEmp : 0;
  const porTitulo = new Map();
  const sinConcepto = [];
  filas[0].forEach((t, j) => {
    if (j === iEmp || !String(t).trim()) return;
    const c = conceptos.find((x) => claveNombre(x.nombre) === claveNombre(t) || claveNombre(x.codigo) === claveNombre(t));
    if (c) porTitulo.set(j, c.codigo);
    else if (!/^(LEGAJO|CUIL|CUIT|DNI|TOTAL|NETO|NETOAPAGAR)$/.test(claveNombre(t))) sinConcepto.push(txt(t, 60));
  });
  const renglones = [];
  const sinEmpleado = [];
  for (const f of filas.slice(1)) {
    const e = emparejarEmpleado(f[iEmp], empleados) || (colEmp < 0 ? null : emparejarEmpleado(f[titulos.indexOf("LEGAJO")], empleados));
    if (!e) { if (txt(f[iEmp])) sinEmpleado.push(txt(f[iEmp])); continue; }
    const valores = {};
    for (const [j, codigo] of porTitulo) {
      const n = numeroSueldo(f[j]);
      if (n != null && n !== 0) valores[codigo] = n;
    }
    renglones.push({ empleado_id: String(e.id), nombre: e.nombre, valores });
  }
  return { renglones, sin_empleado: sinEmpleado, sin_concepto: sinConcepto };
}

/** Valida una liquidación: período, fecha y renglones de empleados de la empresa. */
export function validarLiquidacion(d = {}, { conceptos = [], empleados = [] } = {}) {
  const errores = [];
  const periodo = txt(d.periodo, 60);
  if (!periodo) errores.push("Falta el período (por ejemplo, Octubre 2026)");
  const fecha = String(d.fecha || "");
  if (!FECHA.test(fecha)) errores.push("Falta la fecha");
  const codigos = new Set(conceptos.map((c) => c.codigo));
  const porId = new Map(empleados.map((e) => [String(e.id), e]));
  const renglones = [];
  const vistos = new Set();
  const lista = Array.isArray(d.renglones) ? d.renglones : [];
  if (lista.length > MAX_RENGLONES) errores.push(`Hasta ${MAX_RENGLONES} empleados`);
  for (const r of lista.slice(0, MAX_RENGLONES)) {
    const e = porId.get(String(r?.empleado_id));
    if (!e) { errores.push("Hay un empleado que no es de la empresa"); break; }
    if (vistos.has(String(e.id))) { errores.push(`${e.nombre} está dos veces`); continue; }
    vistos.add(String(e.id));
    const valores = {};
    for (const [k, v] of Object.entries(r.valores || {})) {
      if (!codigos.has(k)) continue;
      const n = numeroSueldo(v);
      if (n == null || n === 0) continue;
      if (Math.abs(n) >= 1e12) { errores.push(`${e.nombre}: un importe es demasiado grande`); continue; }
      valores[k] = n;
    }
    if (Object.keys(valores).length) renglones.push({ empleado_id: String(e.id), nombre: txt(e.nombre), valores });
  }
  return { liquidacion: { periodo, fecha, renglones }, errores };
}

/** La cuenta de un concepto para un empleado: la de su área si el concepto va al área. */
export function cuentaDe(concepto, empleadoId, areas = {}) {
  if (concepto.usa_area && areas[String(empleadoId)]) return areas[String(empleadoId)];
  return concepto.cuenta || null;
}

/** Lo que se le debe a cada empleado (suma de importes) y las horas, más los totales. */
export function totalesLiquidacion(liq, conceptos = []) {
  const importes = conceptos.filter((c) => c.clase !== "horas").map((c) => c.codigo);
  const horas = conceptos.filter((c) => c.clase === "horas").map((c) => c.codigo);
  const porEmpleado = (liq?.renglones || []).map((r) => ({
    empleado_id: String(r.empleado_id), nombre: r.nombre,
    total: centavos(importes.reduce((s, k) => s + (Number(r.valores?.[k]) || 0), 0)),
    horas: centavos(horas.reduce((s, k) => s + (Number(r.valores?.[k]) || 0), 0)),
  }));
  const porConcepto = Object.fromEntries(conceptos.map((c) => [c.codigo, centavos((liq?.renglones || []).reduce((s, r) => s + (Number(r.valores?.[c.codigo]) || 0), 0))]));
  return { porEmpleado, porConcepto, total: centavos(porEmpleado.reduce((s, e) => s + e.total, 0)) };
}

/**
 * Las operaciones del devengado de una liquidación confirmada.
 * @returns {{ ops: object[], errores: string[] }}
 */
export function operacionesLiquidacion(liq, { conceptos = [], areas = {}, cuentaAPagar }) {
  const errores = [];
  if (!cuentaAPagar) errores.push("Falta la cuenta \"Sueldos A Pagar\" en el plan de cuentas");
  const ops = [];
  for (const r of liq.renglones || []) {
    for (const c of conceptos) {
      if (c.clase === "horas") continue;
      const v = Number(r.valores?.[c.codigo]) || 0;
      if (!v) continue;
      const cuenta = cuentaDe(c, r.empleado_id, areas);
      if (!cuenta) { errores.push(`"${c.nombre}" no tiene cuenta: elegila en ⚙ Conceptos`); continue; }
      const total = centavos(Math.abs(v));
      ops.push({
        fecha: liq.fecha, tipo: TIPO_DEVENGADO, proveedor_id: null, entidad: txt(r.nombre),
        neto: total, iva: 0, otros_impuestos: 0, total, moneda: "ARS", tipo_cambio: null, total_ars: total,
        cuenta_debe: v > 0 ? cuenta : cuentaAPagar, cuenta_haber: v > 0 ? cuentaAPagar : cuenta,
        descripcion: `${c.nombre} · ${liq.periodo} · ${txt(r.nombre)}`.slice(0, 500),
        origen: ORIGEN_LIQUIDACION, origen_id: `l${liq.id}:${r.empleado_id}:${c.codigo}`.slice(0, 60), estado: "confirmada",
      });
    }
  }
  return { ops, errores: [...new Set(errores)] };
}

/** Lo pagado a cada empleado de una liquidación (operaciones PAGO SUELDO vivas). */
export function pagadoPorEmpleado(liqId, ops = []) {
  const pre = `l${liqId}:`;
  const por = {};
  for (const o of ops) {
    if (o.anulada_at || o.origen !== ORIGEN_PAGO_SUELDO || !String(o.origen_id || "").startsWith(pre)) continue;
    const emp = String(o.origen_id).slice(pre.length).split(":")[0];
    por[emp] = centavos((por[emp] || 0) + (Number(o.total_ars ?? o.total) || 0));
  }
  return por;
}

/** La operación de un pago de sueldo. */
export function operacionPagoSueldo({ liq, renglon, caja, importe, fecha, n }, cuentaAPagar) {
  const total = centavos(importe);
  return {
    fecha, tipo: TIPO_PAGO, proveedor_id: null, entidad: txt(renglon.nombre),
    neto: total, iva: 0, otros_impuestos: 0, total, moneda: "ARS", tipo_cambio: null, total_ars: total,
    cuenta_debe: cuentaAPagar, cuenta_haber: caja.cuenta,
    descripcion: `Sueldo ${liq.periodo} · ${txt(renglon.nombre)}`.slice(0, 500),
    origen: ORIGEN_PAGO_SUELDO, origen_id: `l${liq.id}:${renglon.empleado_id}:${n}`.slice(0, 60), estado: "confirmada",
  };
}
