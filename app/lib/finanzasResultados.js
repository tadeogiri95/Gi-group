// app/lib/finanzasResultados.js — Finanzas, parte F6a (migración 179): el
// estado de resultados, como la hoja EERR del libro.
//
//   - Base devengada, por mes, 12 meses hasta el mes elegido.
//   - Cada cuenta va al renglón que dice su "clasificacion_eerr" en el plan de
//     cuentas del libro (fin_cuentas.linea_eerr): ING_* ingresos, CMV_* costo
//     de ventas, GO_* gastos operativos, FIN_* resultado financiero, IMP_*
//     impuestos. La segunda parte del código agrupa (GO_ADM_* = Administración).
//   - El importe de cada operación es el neto (sin IVA ni otros impuestos),
//     en pesos. Ingresos = haber − debe; el resto = debe − haber.
//   - Las entregas y ventas se abren por división de la OT.
//   - Materiales: como el libro, se estima un % de las entregas (40 % por
//     defecto; config_sistema "finanzas_resultados") en lugar de las cuentas
//     CMV_MAT (Materias Primas es stock: la compra no es el consumo). Con 0 %
//     se usan las cuentas.
//   - IMP_IVA (IVA a pagar / a favor) va aparte y no entra en el resultado.
//   - Las operaciones anuladas no cuentan; las "para revisar" tampoco (se
//     avisa cuántas hay).
//   - Por división: cada operación es de la división de su OT o, si no tiene,
//     de la de su centro de costo (dim_cc). Lo que no es de ninguna de las
//     divisiones del ponderador es compartido y se reparte con el % que el
//     Dueño le pone a cada una (config_sistema "finanzas_resultados",
//     ponderador). Como el libro, los % deben sumar 100.
export const CLAVE_RESULTADOS = "finanzas_resultados";
export const MATERIALES_PCT = 40;
export const MESES_VENTANA = 12;

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Las secciones del estado, en orden, con el nombre de cada grupo. */
export const SECCIONES = [
  { id: "ING", nombre: "Ingresos", ingreso: true, grupos: { VTA: "Ventas", ENT: "Entregas", ALQ: "Alquileres", NC: "Descuentos y notas de crédito" } },
  { id: "CMV", nombre: "Costo de ventas (CMV)", grupos: { MAT: "Materiales", TER: "Trabajos de terceros", MOD: "Mano de obra directa", CIF: "Costos indirectos de fabricación" } },
  { id: "GO", nombre: "Gastos operativos", grupos: {
    ADM: "Administración", DIS: "Diseño y arquitectura", LOG: "Logística", REM: "Remuneraciones adicionales", SER: "Servicios", SEG: "Seguros",
    MAN: "Mantenimiento", LEA: "Leasing", HON: "Honorarios profesionales", COM: "Comercialización y representación", MUL: "Multas",
  } },
  { id: "FIN", nombre: "Resultado financiero", grupos: { COM: "Comisiones y gastos bancarios", INT: "Intereses y gastos financieros", DIF: "Diferencia de cambio" } },
  { id: "IMP", nombre: "Impuestos", grupos: {
    CI: "Comercio e industria", INM: "Inmobiliario", AUT: "Automotor", DEB: "Débitos y créditos", IIBB: "Ingresos brutos", GAN: "Ganancias", OTR: "Otros impuestos",
  } },
  // IMP_IVA: impuestos de traslado; se muestran aparte y no entran en el resultado (como el libro)
  { id: "IVA", nombre: "Impuestos de traslado (IVA, no entra en el resultado)", aparte: true, grupos: {} },
];

/** "2026-10" → los 12 meses que terminan ahí, del más viejo al más nuevo. */
export function mesesHasta(hasta, n = MESES_VENTANA) {
  if (!MES.test(String(hasta || ""))) return [];
  let [a, m] = hasta.split("-").map(Number);
  const meses = [];
  for (let i = 0; i < n; i++) {
    meses.unshift(`${a}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; a -= 1; }
  }
  return meses;
}

/** "2026-10" → "Oct 26". */
export const nombreMes = (mes) => (MES.test(String(mes || "")) ? `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(2, 4)}` : String(mes || ""));

/** El último día del mes ("2026-02" → "2026-02-28"). */
export function finDeMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** El neto de la operación en pesos (sin IVA ni otros impuestos); si no tiene neto, el total. */
export function importeResultado(op) {
  const total = Number(op.total) || 0;
  const totalArs = Number(op.total_ars ?? op.total) || 0;
  const neto = Number(op.neto) || 0;
  if (neto > 0 && total > 0 && neto < total) return centavos(neto * (totalArs / total));
  return centavos(totalArs);
}

/** La sección y el grupo de un renglón del libro ("GO_ADM_SUE" → GO / ADM). */
export function seccionDe(linea) {
  const l = String(linea || "").toUpperCase();
  if (/^IMP_IVA/.test(l)) return { seccion: SECCIONES.find((x) => x.id === "IVA"), grupo: "" };
  const [s, g] = l.split("_");
  const sec = SECCIONES.find((x) => x.id === s);
  return sec ? { seccion: sec, grupo: g || "" } : null;
}

/** "Herrería " → "HERRERIA", para comparar divisiones escritas distinto. */
export const claveDivision = (d) => String(d || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * De qué división del ponderador es una operación: la de su OT, si no la de
 * su centro de costo; "" = compartida.
 * @param {Map<string,string>} divisiones clave → nombre, las del ponderador
 */
export function divisionDeOp(op, { divisionOt = new Map(), divisionCentro = new Map(), divisiones = new Map() }) {
  const deOt = op.proyecto_id ? divisiones.get(claveDivision(divisionOt.get(Number(op.proyecto_id)))) : null;
  if (deOt) return deOt;
  const deCc = op.centro_costo ? divisiones.get(claveDivision(divisionCentro.get(claveDivision(op.centro_costo)))) : null;
  return deCc || "";
}

/** ¿Es una cuenta de resultado? (rubro RESULTADO o código 04/05). */
const esDeResultado = (c) => /resultado/i.test(String(c.rubro || "")) || /^0[45]\./.test(String(c.codigo || ""));

/**
 * El estado de resultados.
 * @param {{ ops: object[], cuentas: object[], proyectos?: object[], hasta: string, materialesPct?: number }} d
 * @returns {{ meses: string[], filas: object[], sin_linea: object[], para_revisar: number, clasificado: boolean, materiales_estimados: boolean }}
 */
export function estadoResultados({ ops = [], cuentas = [], proyectos = [], centros = [], hasta, materialesPct = MATERIALES_PCT, ponderador = {}, division = "" }) {
  const meses = mesesHasta(hasta);
  const idx = new Map(meses.map((m, i) => [m, i]));
  const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]));
  const divisionOt = new Map(proyectos.map((p) => [Number(p.id), String(p.division || "").trim()]));
  // Vista de una división: lo suyo entero y su % de lo compartido
  const divisiones = new Map(Object.keys(ponderador || {}).map((d) => [claveDivision(d), d]));
  const divisionCentro = new Map(centros.map((c) => [claveDivision(c.codigo), String(c.division || "")]));
  const parte = division ? (Number(ponderador?.[division]) || 0) / 100 : 1;
  const factor = (op) => {
    if (!division) return 1;
    const d = divisionDeOp(op, { divisionOt, divisionCentro, divisiones });
    return d === division ? 1 : d ? 0 : parte;
  };
  const cero = () => meses.map(() => 0);
  // renglón (cuenta + división) → valores por mes
  const lineas = new Map();
  const sinLinea = new Map();
  let paraRevisar = 0;

  const sumar = (codigo, op, signo, f) => {
    const c = porCodigo.get(codigo);
    if (!c) return;
    const i = idx.get(String(op.fecha).slice(0, 7));
    const v = importeResultado(op) * signo * f;
    const ubic = c.linea_eerr ? seccionDe(c.linea_eerr) : null;
    if (!ubic) {
      if (esDeResultado(c)) {
        const s = sinLinea.get(codigo) || { codigo, nombre: c.nombre, total: 0 };
        s.total = centavos(s.total + v);
        sinLinea.set(codigo, s);
      }
      return;
    }
    const div = ubic.seccion.ingreso && op.proyecto_id ? divisionOt.get(Number(op.proyecto_id)) || "" : "";
    const k = `${codigo}|${div}`;
    let l = lineas.get(k);
    if (!l) {
      l = { cuenta: codigo, linea: c.linea_eerr, division: div, nombre: div ? `${c.nombre} · ${div}` : c.nombre, seccion: ubic.seccion.id, grupo: ubic.grupo, valores: cero() };
      lineas.set(k, l);
    }
    // Ingresos: haber − debe; el resto: debe − haber
    l.valores[i] += ubic.seccion.ingreso ? -v : v;
  };

  for (const op of ops) {
    if (op.anulada_at) continue;
    if (!idx.has(String(op.fecha || "").slice(0, 7))) continue;
    if (op.estado === "para_revisar") { paraRevisar += 1; continue; }
    const f = factor(op);
    if (!f) continue;
    sumar(op.cuenta_debe, op, 1, f);
    sumar(op.cuenta_haber, op, -1, f);
  }

  // Materiales estimados: un % de las entregas en lugar de las cuentas CMV_MAT
  const pct = Math.max(0, Math.min(100, Number(materialesPct) || 0));
  let estimados = false;
  if (pct > 0) {
    for (const [k, l] of lineas) if (l.seccion === "CMV" && l.grupo === "MAT") lineas.delete(k);
    const entregas = cero();
    for (const l of lineas.values()) if (l.seccion === "ING" && l.grupo === "ENT") l.valores.forEach((v, i) => { entregas[i] += v; });
    if (entregas.some((v) => Math.abs(v) >= 0.01)) {
      estimados = true;
      lineas.set("materiales|estimado", {
        cuenta: null, linea: "CMV_MAT", division: "", nombre: `Costo de materiales (estimado ${String(pct).replace(".", ",")} % de las entregas)`,
        seccion: "CMV", grupo: "MAT", estimado: true, valores: entregas.map((v) => v * pct / 100),
      });
    }
  }

  const redondear = (vals) => vals.map(centavos);
  const total = (vals) => centavos(vals.reduce((s, v) => s + v, 0));
  const sumaDe = (lista) => { const t = cero(); for (const l of lista) l.valores.forEach((v, i) => { t[i] += v; }); return t; };
  const filas = [];
  const totales = {};
  for (const sec of SECCIONES) {
    const deSec = [...lineas.values()].filter((l) => l.seccion === sec.id);
    if (sec.aparte && !deSec.length) continue;
    const tSec = sumaDe(deSec);
    totales[sec.id] = tSec;
    filas.push({ tipo: "seccion", id: sec.id, nombre: sec.nombre, valores: redondear(tSec), total: total(tSec) });
    const grupos = [...new Set(deSec.map((l) => l.grupo))].sort((a, b) => {
      const orden = Object.keys(sec.grupos);
      const ia = orden.indexOf(a); const ib = orden.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    for (const g of grupos) {
      const deG = deSec.filter((l) => l.grupo === g).sort((a, b) => a.linea.localeCompare(b.linea) || String(a.cuenta).localeCompare(String(b.cuenta)) || a.division.localeCompare(b.division));
      const conNombre = sec.grupos[g];
      if (conNombre || deG.length > 1) {
        const tG = sumaDe(deG);
        filas.push({ tipo: "grupo", id: `${sec.id}_${g}`, seccion: sec.id, nombre: conNombre || g || "Otros", valores: redondear(tG), total: total(tG) });
      }
      for (const l of deG) {
        filas.push({ tipo: "linea", id: `${l.cuenta || l.linea}|${l.division}`, seccion: sec.id, grupo: g, cuenta: l.cuenta, nombre: l.nombre, estimado: !!l.estimado, valores: redondear(l.valores), total: total(l.valores) });
      }
    }
    const resultado = (id, nombre, vals, base) => {
      filas.push({ tipo: "resultado", id, nombre, valores: redondear(vals), total: total(vals) });
      filas.push({ tipo: "pct", id: `${id}_PCT`, nombre: "% sobre ingresos", valores: vals.map((v, i) => (Math.abs(base[i]) >= 0.01 ? Math.round((v / base[i]) * 1000) / 10 : null)), total: Math.abs(total(base)) >= 0.01 ? Math.round((total(vals) / total(base)) * 1000) / 10 : null });
    };
    const ing = totales.ING;
    if (sec.id === "CMV") resultado("UTIL_BRU", "Utilidad bruta", ing.map((v, i) => v - tSec[i]), ing);
    if (sec.id === "GO") resultado("EBIT", "Resultado operativo (EBIT)", ing.map((v, i) => v - totales.CMV[i] - tSec[i]), ing);
    if (sec.id === "IMP") resultado("RDO_NETO", "Resultado neto", ing.map((v, i) => v - totales.CMV[i] - totales.GO[i] - totales.FIN[i] - tSec[i]), ing);
  }
  return {
    meses, filas,
    sin_linea: [...sinLinea.values()].filter((s) => Math.abs(s.total) >= 0.01).sort((a, b) => a.codigo.localeCompare(b.codigo)),
    para_revisar: paraRevisar,
    clasificado: cuentas.some((c) => c.linea_eerr),
    materiales_estimados: estimados,
  };
}

/**
 * El ponderador como lo manda la pantalla: { "MUEBLES": "80", … } →
 * { ponderador } o { error }. Vacío = sin repartir (se borra).
 */
export function validarPonderador(p) {
  if (p == null) return { ponderador: {} };
  if (typeof p !== "object" || Array.isArray(p)) return { error: "El ponderador no vino bien" };
  const ponderador = {};
  for (const [d, v] of Object.entries(p)) {
    const nombre = String(d || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!nombre) continue;
    const n = Number(String(v ?? "").replace(",", ".").trim() || 0);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { error: `El % de ${nombre} va de 0 a 100` };
    ponderador[nombre] = Math.round(n * 10) / 10;
  }
  if (Object.keys(ponderador).length > 20) return { error: "Son demasiadas divisiones" };
  const suma = Object.values(ponderador).reduce((s, n) => s + n, 0);
  if (Object.keys(ponderador).length && Math.abs(suma - 100) > 0.05) return { error: `Los % tienen que sumar 100 (ahora suman ${String(Math.round(suma * 10) / 10).replace(".", ",")})` };
  return { ponderador };
}

/** La configuración guardada, con el % de materiales por defecto. */
export function configResultados(valor) {
  const n = Number(valor?.materiales_pct);
  const p = validarPonderador(valor?.ponderador);
  return { materiales_pct: Number.isFinite(n) && n >= 0 && n <= 100 ? n : MATERIALES_PCT, ponderador: p.ponderador || {} };
}

/**
 * El total de 12 meses de cada división (con su parte de lo compartido) y lo
 * de toda la empresa, para el resumen de arriba.
 */
export function resumenDivisiones(d) {
  const de = (r) => {
    const t = (id) => r.filas.find((f) => f.id === id)?.total || 0;
    return { ingresos: t("ING"), cmv: t("CMV"), gastos: t("GO"), financiero: t("FIN"), impuestos: t("IMP"), resultado: t("RDO_NETO") };
  };
  const divisiones = Object.keys(d.ponderador || {});
  return [
    ...divisiones.map((division) => ({ division, pct: d.ponderador[division], ...de(estadoResultados({ ...d, division })) })),
    { division: "", pct: 100, ...de(estadoResultados({ ...d, division: "" })) },
  ];
}
