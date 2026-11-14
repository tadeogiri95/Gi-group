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
//   - Desde el 12/11 (auditoría, parte 4) el Dueño puede elegir el costo real
//     de materiales de cada OT entregada (MRP + retirado de más + compras sin
//     stock; app/lib/costoReal.js) en lugar del %: a cada entrega le toca la
//     parte de los materiales de su OT. Las entregas de OT sin materiales
//     en Gypi siguen con el %.
//   - Entregas con valor estimado (13/11): las OT terminadas que no tienen
//     PRECIO en el Plan no tienen entrega anotada. Se suman en un renglón
//     aparte de Entregas (por división, marcado como estimado) con el mismo
//     valor que la cuenta corriente de clientes: materiales de sus
//     necesidades ÷ 0,3 (app/lib/finanzasOtClientes.js). El mes es el día en
//     que Gypi la vio terminada (como una entrega con precio). Cuentan como
//     entregas para el costo de materiales.
//   - Asiento de consumo (etapa 5, 14/11; finanzasConsumoOt.js): cuando la OT
//     se entrega, Gypi anota su costo real de materiales (Costo de Mercadería
//     Vendida contra Materias Primas). Ese asiento es el costo de materiales
//     de la OT: sus entregas ya no van al % ni al costo calculado aparte.
//   - IMP_IVA (IVA a pagar / a favor) va aparte y no entra en el resultado.
//   - Ordenado según NIIF (NIC 1, gastos por función), 10/11: el ingreso son
//     SOLO las entregas (ING_ENT, menos descuentos y notas de crédito), para
//     comparar lo producido y entregado contra los costos. Las ventas (OT
//     cargadas en el Plan, todavía sin entregar) se muestran aparte y no
//     entran. Después: costo de ventas → ganancia bruta → gastos de
//     comercialización (incluye logística, diseño, IIBB y comercio e
//     industria) → gastos de administración (incluye los demás impuestos y
//     tasas) → otros ingresos y gastos (alquileres, multas) → resultado
//     operativo → resultados financieros → resultado antes del impuesto a las
//     ganancias → impuesto a las ganancias → resultado del período.
//   - Las operaciones anuladas no cuentan; las "para revisar" tampoco (se
//     avisa cuántas hay).
//   - Por división: cada operación es de la división de su OT o, si no tiene,
//     de la de su centro de costo (dim_cc). Lo que no es de ninguna de las
//     divisiones del ponderador es compartido y se reparte con el % que el
//     Dueño le pone a cada una (config_sistema "finanzas_resultados",
//     ponderador). Como el libro, los % deben sumar 100.
export const CLAVE_RESULTADOS = "finanzas_resultados";
/** finanzasConsumoOt.ORIGEN_CONSUMO (acá sin importar el lado del servidor). */
export const ORIGEN_CONSUMO_OT = "consumo_ot";
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

/**
 * Las secciones del estado según NIIF, en orden. Cada renglón del libro
 * (sección y grupo de su clasificacion_eerr) va a una de estas con niifDe.
 * "ingreso": se muestra haber − debe (positivo = gana).
 */
export const SECCIONES_NIIF = [
  { id: "ING", nombre: "Ingresos por entregas", ingreso: true },
  { id: "CMV", nombre: "Costo de ventas" },
  { id: "COM", nombre: "Gastos de comercialización" },
  { id: "ADM", nombre: "Gastos de administración" },
  { id: "OTR", nombre: "Otros ingresos y gastos", ingreso: true },
  { id: "FIN", nombre: "Resultados financieros (costo neto)" },
  { id: "GAN", nombre: "Impuesto a las ganancias" },
  { id: "VTA", nombre: "Ventas del período (OT cargadas, sin entregar: no entran, el ingreso es la entrega)", ingreso: true, aparte: true },
  { id: "IVA", nombre: "Impuestos de traslado (IVA, no entra en el resultado)", aparte: true },
];

/** De la sección y el grupo del libro a la sección NIIF. */
export function niifDe(seccion, grupo) {
  const g = String(grupo || "").toUpperCase();
  if (seccion === "ING") return g === "VTA" ? "VTA" : g === "ENT" || g === "NC" ? "ING" : "OTR";
  if (seccion === "CMV") return "CMV";
  if (seccion === "GO") return ["COM", "LOG", "DIS"].includes(g) ? "COM" : g === "MUL" ? "OTR" : "ADM";
  if (seccion === "FIN") return "FIN";
  if (seccion === "IMP") return g === "GAN" ? "GAN" : ["IIBB", "CI"].includes(g) ? "COM" : "ADM";
  return seccion === "IVA" ? "IVA" : null;
}

/** El nombre del grupo (en Administración, "Impuestos: Débitos y créditos"…). */
function nombreGrupo(seccion, grupo) {
  const sec = SECCIONES.find((x) => x.id === seccion);
  const n = sec?.grupos?.[grupo];
  if (!n) return null;
  return seccion === "IMP" ? `Impuestos: ${n.charAt(0).toLowerCase()}${n.slice(1)}` : n;
}

/** El orden de los grupos dentro de cada sección NIIF. */
const ORDEN_GRUPOS = [
  "ING_ENT", "ING_NC", "CMV_MAT", "CMV_TER", "CMV_MOD", "CMV_CIF",
  "GO_COM", "GO_LOG", "GO_DIS", "IMP_IIBB", "IMP_CI",
  "GO_ADM", "GO_REM", "GO_HON", "GO_SER", "GO_SEG", "GO_MAN", "GO_LEA", "IMP_DEB", "IMP_INM", "IMP_AUT", "IMP_OTR",
  "ING_ALQ", "GO_MUL", "FIN_COM", "FIN_INT", "FIN_DIF", "IMP_GAN", "ING_VTA",
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
 * @param {{ ops: object[], cuentas: object[], proyectos?: object[], hasta: string, materialesPct?: number, entregasEstimadas?: { proyecto_id: number, fecha: string, valor: number }[] }} d
 * @returns {{ meses: string[], filas: object[], sin_linea: object[], para_revisar: number, clasificado: boolean, materiales_estimados: boolean }}
 */
export function estadoResultados({ ops = [], cuentas = [], proyectos = [], centros = [], hasta, materialesPct = MATERIALES_PCT, ponderador = {}, division = "", materialesOt = null, entregasEstimadas = [] }) {
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
  // Entregas de cada OT por mes (para el costo real de materiales)
  const entregaOt = new Map();
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
    const niif = niifDe(ubic.seccion.id, ubic.grupo);
    const secNiif = SECCIONES_NIIF.find((x) => x.id === niif);
    const div = ubic.seccion.ingreso && op.proyecto_id ? divisionOt.get(Number(op.proyecto_id)) || "" : "";
    const k = `${codigo}|${div}`;
    let l = lineas.get(k);
    if (!l) {
      l = { cuenta: codigo, linea: c.linea_eerr, division: div, nombre: div ? `${c.nombre} · ${div}` : c.nombre, seccion: niif, origen: ubic.seccion.id, grupo: ubic.grupo, valores: cero() };
      lineas.set(k, l);
    }
    // Ingresos: haber − debe; el resto: debe − haber
    l.valores[i] += secNiif.ingreso ? -v : v;
    if (ubic.seccion.id === "ING" && ubic.grupo === "ENT" && op.proyecto_id) {
      const pid = Number(op.proyecto_id);
      if (!entregaOt.has(pid)) entregaOt.set(pid, cero());
      entregaOt.get(pid)[i] += -v;
    }
  };

  // Consumo de materiales de cada OT entregada (etapa 5, 14/11): por OT y mes
  const consumoOt = new Map();
  for (const op of ops) {
    if (op.anulada_at) continue;
    if (!idx.has(String(op.fecha || "").slice(0, 7))) continue;
    if (op.estado === "para_revisar") { paraRevisar += 1; continue; }
    const f = factor(op);
    if (!f) continue;
    if (op.origen === ORIGEN_CONSUMO_OT) {
      const pid = Number(op.proyecto_id) || 0;
      if (!consumoOt.has(pid)) consumoOt.set(pid, cero());
      consumoOt.get(pid)[idx.get(String(op.fecha).slice(0, 7))] += importeResultado(op) * f;
      continue;
    }
    sumar(op.cuenta_debe, op, 1, f);
    sumar(op.cuenta_haber, op, -1, f);
  }

  // Entregas sin precio en el Plan, con su valor estimado: renglón aparte por división
  let estimadasOt = 0;
  for (const x of entregasEstimadas) {
    const i = idx.get(String(x.fecha || "").slice(0, 7));
    const valor = Number(x.valor) || 0;
    if (i === undefined || !(valor > 0) || !x.proyecto_id) continue;
    const pid = Number(x.proyecto_id);
    // Si ya tiene su entrega de verdad (le pusieron precio), no se cuenta dos veces
    if (entregaOt.has(pid)) continue;
    const f = factor({ proyecto_id: pid });
    if (!f) continue;
    const div = divisionOt.get(pid) || "";
    const k = `entregas|estimadas|${div}`;
    let l = lineas.get(k);
    if (!l) {
      const nombre = "Entregas con valor estimado (OT sin precio en el Plan)";
      l = { cuenta: null, linea: "ING_ENT_EST", division: div, nombre: div ? `${nombre} · ${div}` : nombre, seccion: "ING", origen: "ING", grupo: "ENT", estimado: true, entregaEstimada: true, valores: cero() };
      lineas.set(k, l);
    }
    l.valores[i] += valor * f;
    if (!entregaOt.has(pid)) entregaOt.set(pid, cero());
    entregaOt.get(pid)[i] += valor * f;
    estimadasOt += 1;
  }

  // Materiales estimados: un % de las entregas en lugar de las cuentas CMV_MAT
  const pct = Math.max(0, Math.min(100, Number(materialesPct) || 0));
  let estimados = false;
  const conConsumo = [...consumoOt.values()].some((vals) => vals.some((v) => Math.abs(v) >= 0.01));
  if (pct > 0 || materialesOt || conConsumo) {
    for (const [k, l] of lineas) if (l.origen === "CMV" && l.grupo === "MAT") lineas.delete(k);
    // El asiento de consumo de cada OT es su costo de materiales: sus entregas no van al %
    const consumo = cero();
    const conAsiento = cero();
    for (const vals of consumoOt.values()) vals.forEach((v, i) => { consumo[i] += v; });
    for (const [pid, vals] of entregaOt) if (consumoOt.has(pid)) vals.forEach((v, i) => { conAsiento[i] += v; });
    if (conConsumo) {
      lineas.set("materiales|consumo", {
        cuenta: null, linea: "CMV_MAT", division: "", nombre: "Costo de materiales (asiento de consumo de cada OT entregada)",
        seccion: "CMV", origen: "CMV", grupo: "MAT", valores: consumo,
      });
    }
    const entregas = cero();
    for (const l of lineas.values()) if (l.origen === "ING" && l.grupo === "ENT") l.valores.forEach((v, i) => { entregas[i] += v; });
    entregas.forEach((v, i) => { entregas[i] = v - conAsiento[i]; });
    if (entregas.some((v) => Math.abs(v) >= 0.01)) {
      estimados = true;
      // Con el costo real: cada entrega de una OT con materiales lleva su parte; las demás, el %
      const real = cero();
      const conReal = cero();
      if (materialesOt) {
        for (const [pid, vals] of entregaOt) {
          if (consumoOt.has(pid)) continue;
          const mat = Number(materialesOt.get(pid)) || 0;
          const tot = vals.reduce((a, b) => a + b, 0);
          if (mat <= 0 || tot <= 0.01) continue;
          vals.forEach((v, i) => { real[i] += mat * (v / tot); conReal[i] += v; });
        }
      }
      const porPct = entregas.map((v, i) => (v - conReal[i]) * pct / 100);
      if (materialesOt && real.some((v) => Math.abs(v) >= 0.01)) {
        lineas.set("materiales|real", {
          cuenta: null, linea: "CMV_MAT", division: "", nombre: "Costo de materiales (real de cada OT entregada)",
          seccion: "CMV", origen: "CMV", grupo: "MAT", estimado: true, valores: real,
        });
      }
      if (porPct.some((v) => Math.abs(v) >= 0.01)) {
        lineas.set("materiales|estimado", {
          cuenta: null, linea: "CMV_MAT", division: "", nombre: materialesOt ? `Costo de materiales (estimado ${String(pct).replace(".", ",")} % de las entregas sin costo en Gypi)` : `Costo de materiales (estimado ${String(pct).replace(".", ",")} % de las entregas)`,
          seccion: "CMV", origen: "CMV", grupo: "MAT", estimado: true, valores: porPct,
        });
      }
    }
  }

  const redondear = (vals) => vals.map(centavos);
  const total = (vals) => centavos(vals.reduce((s, v) => s + v, 0));
  const sumaDe = (lista) => { const t = cero(); for (const l of lista) l.valores.forEach((v, i) => { t[i] += v; }); return t; };
  const filas = [];
  const totales = {};
  const cero12 = cero();
  for (const sec of SECCIONES_NIIF) {
    const deSec = [...lineas.values()].filter((l) => l.seccion === sec.id);
    if (sec.aparte && !deSec.length) continue;
    const tSec = sumaDe(deSec);
    totales[sec.id] = tSec;
    filas.push({ tipo: "seccion", id: sec.id, nombre: sec.nombre, aparte: !!sec.aparte, valores: redondear(tSec), total: total(tSec) });
    const claveG = (l) => `${l.origen}_${l.grupo}`;
    const grupos = [...new Set(deSec.map(claveG))].sort((a, b) => {
      const ia = ORDEN_GRUPOS.indexOf(a); const ib = ORDEN_GRUPOS.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    for (const g of grupos) {
      const deG = deSec.filter((l) => claveG(l) === g).sort((a, b) => Number(!!a.entregaEstimada) - Number(!!b.entregaEstimada) || a.linea.localeCompare(b.linea) || String(a.cuenta).localeCompare(String(b.cuenta)) || a.division.localeCompare(b.division));
      const conNombre = nombreGrupo(deG[0].origen, deG[0].grupo);
      if (conNombre || deG.length > 1) {
        const tG = sumaDe(deG);
        filas.push({ tipo: "grupo", id: `${sec.id}_${g}`, seccion: sec.id, nombre: conNombre || deG[0].grupo || "Otros", valores: redondear(tG), total: total(tG) });
      }
      for (const l of deG) {
        filas.push({ tipo: "linea", id: `${l.cuenta || l.linea}|${l.division}`, seccion: sec.id, grupo: l.grupo, cuenta: l.cuenta, nombre: l.nombre, estimado: !!l.estimado, ...(l.entregaEstimada ? { entrega_estimada: true } : {}), valores: redondear(l.valores), total: total(l.valores) });
      }
    }
    const resultado = (id, nombre, vals, base) => {
      filas.push({ tipo: "resultado", id, nombre, valores: redondear(vals), total: total(vals) });
      filas.push({ tipo: "pct", id: `${id}_PCT`, nombre: "% sobre ingresos", valores: vals.map((v, i) => (Math.abs(base[i]) >= 0.01 ? Math.round((v / base[i]) * 1000) / 10 : null)), total: Math.abs(total(base)) >= 0.01 ? Math.round((total(vals) / total(base)) * 1000) / 10 : null });
    };
    const t = (id) => totales[id] || cero12;
    const ing = t("ING");
    const bruta = () => ing.map((v, i) => v - t("CMV")[i]);
    const operativo = () => bruta().map((v, i) => v - t("COM")[i] - t("ADM")[i] + t("OTR")[i]);
    const antes = () => operativo().map((v, i) => v - t("FIN")[i]);
    if (sec.id === "CMV") resultado("UTIL_BRU", "Ganancia bruta", bruta(), ing);
    if (sec.id === "OTR") resultado("EBIT", "Resultado operativo", operativo(), ing);
    if (sec.id === "FIN") resultado("RAI", "Resultado antes del impuesto a las ganancias", antes(), ing);
    if (sec.id === "GAN") resultado("RDO_NETO", "Resultado del período", antes().map((v, i) => v - t("GAN")[i]), ing);
  }
  return {
    meses, filas,
    sin_linea: [...sinLinea.values()].filter((s) => Math.abs(s.total) >= 0.01).sort((a, b) => a.codigo.localeCompare(b.codigo)),
    para_revisar: paraRevisar,
    clasificado: cuentas.some((c) => c.linea_eerr),
    materiales_estimados: estimados,
    entregas_estimadas: estimadasOt,
    hay_entregas: [...lineas.values()].some((l) => l.origen === "ING" && l.grupo === "ENT" && l.valores.some((v) => Math.abs(v) >= 0.01)),
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
  return { materiales_pct: Number.isFinite(n) && n >= 0 && n <= 100 ? n : MATERIALES_PCT, ponderador: p.ponderador || {}, ...(valor?.materiales_real === true ? { materiales_real: true } : {}) };
}

/**
 * El total de 12 meses de cada división (con su parte de lo compartido) y lo
 * de toda la empresa, para el resumen de arriba.
 */
export function resumenDivisiones(d) {
  const de = (r) => {
    const t = (id) => r.filas.find((f) => f.id === id)?.total || 0;
    return { ingresos: t("ING"), cmv: t("CMV"), gastos: centavos(t("COM") + t("ADM") - t("OTR")), financiero: t("FIN"), impuestos: t("GAN"), resultado: t("RDO_NETO") };
  };
  const divisiones = Object.keys(d.ponderador || {});
  return [
    ...divisiones.map((division) => ({ division, pct: d.ponderador[division], ...de(estadoResultados({ ...d, division })) })),
    { division: "", pct: 100, ...de(estadoResultados({ ...d, division: "" })) },
  ];
}
