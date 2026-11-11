// app/lib/finanzasReporte.js — Finanzas → 📑 Reporte financiero (mejoras del
// 09/11, parte E). Sin migración: se arma en el momento con lo que ya está.
//
// Un reporte de una semana (lunes a domingo) o de un mes, que el Dueño genera
// con un botón y puede imprimir o guardar en PDF:
//   1. Resultados del período: el estado de resultados NIIF (ingresos =
//      entregas) solo con lo devengado entre "desde" y "hasta".
//   2. Flujo de caja del período: saldo al empezar, lo que entró y salió por
//      línea (con su detalle) y saldo al terminar, en pesos y en dólares.
//   3. Posición de fondos: el saldo de cada caja, banco, FCI y plazo fijo al
//      último día del período.
//   4. Valores a cobrar y a pagar: los cheques de terceros en cartera y los
//      cheques y e-cheq propios por debitar (como están hoy: el estado de un
//      cheque no guarda historia).
//   5. Cuentas a cobrar y a pagar: el saldo de cada cliente y cada proveedor
//      al último día del período.
// Las operaciones anuladas y las "para revisar" no cuentan (se avisa cuántas
// hay en el período).
import { estadoResultados } from "./finanzasResultados";
import { flujoReal, cajasPorMoneda, deltaCaja, lunesDe } from "./finanzasFlujo";
import { saldosTesoreria, totalesTesoreria, NOMBRE_GRUPO, ORDEN_TIPOS } from "./finanzasTesoreria";
import { saldosClientes, cuentasDeudores } from "./finanzasClientes";
import { saldosProveedores, cuentasProveedores } from "./finanzasProveedores";
import { TIPOS_CHEQUE } from "./finanzasCheques";
import { plata } from "./finanzasOperaciones";
import { descargarPdfDeHtml } from "./pdfDeHtml";

export const TIPOS_REPORTE = { semana: "Semanal", mes: "Mensual", rango: "Entre fechas" };
/** Entre fechas: hasta 12 meses (lo que muestra el estado de resultados). */
export const MAX_MESES_RANGO = 12;
export const MAX_RENGLONES = 25;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const dma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");
const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const fechaReal = (f) => FECHA.test(String(f || "")) && !Number.isNaN(Date.parse(`${f}T12:00:00Z`)) && new Date(`${f}T12:00:00Z`).toISOString().slice(0, 10) === f;

/** Los meses (AAAA-MM) entre dos fechas, del más viejo al más nuevo. */
export function mesesEntre(desde, hasta) {
  const out = [];
  let [a, m] = desde.slice(0, 7).split("-").map(Number);
  const fin = hasta.slice(0, 7);
  for (let i = 0; i < 240; i++) {
    const mes = `${a}-${String(m).padStart(2, "0")}`;
    if (mes > fin) break;
    out.push(mes);
    m += 1;
    if (m === 13) { m = 1; a += 1; }
  }
  return out;
}

/**
 * La semana (lunes a domingo) o el mes de una fecha, o entre dos fechas
 * (tipo "rango": fecha = desde): { tipo, desde, hasta, titulo } o null.
 */
export function periodoReporte(tipo, fecha, hastaRango) {
  if (!TIPOS_REPORTE[tipo] || !FECHA.test(String(fecha || ""))) return null;
  if (tipo === "rango") {
    if (!fechaReal(fecha) || !fechaReal(hastaRango) || hastaRango < fecha) return null;
    if (mesesEntre(fecha, hastaRango).length > MAX_MESES_RANGO) return null;
    return { tipo, desde: fecha, hasta: hastaRango, titulo: `Del ${dma(fecha)} al ${dma(hastaRango)}` };
  }
  if (tipo === "semana") {
    const desde = lunesDe(fecha);
    const hasta = sumarDias(desde, 6);
    return { tipo, desde, hasta, titulo: `Semana del ${dma(desde)} al ${dma(hasta)}` };
  }
  const [a, m] = fecha.split("-").map(Number);
  const desde = `${fecha.slice(0, 7)}-01`;
  const hasta = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { tipo, desde, hasta, titulo: `${MESES[m - 1].charAt(0).toUpperCase()}${MESES[m - 1].slice(1)} ${a}` };
}

/** Por qué no vale un período entre fechas (para decirlo en la pantalla), o "". */
export function errorPeriodo(desde, hasta) {
  if (!fechaReal(desde) || !fechaReal(hasta)) return "Elegí las dos fechas";
  if (hasta < desde) return "La fecha hasta es anterior a la fecha desde";
  if (mesesEntre(desde, hasta).length > MAX_MESES_RANGO) return `Elegí hasta ${MAX_MESES_RANGO} meses`;
  return "";
}

const DIAS_CORTOS = ["do", "lu", "ma", "mi", "ju", "vi", "sá"];
const MESES_CORTOS = MESES.map((m) => m.slice(0, 3));
const diasEntre = (desde, hasta) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 864e5) + 1;

/** De a cuánto se agrupa el gráfico de plata: día (semana), semana (mes) o según el largo del rango. */
export function tramoDe(tipo, desde, hasta) {
  if (tipo === "semana") return "dia";
  if (tipo === "mes") return "semana";
  const n = diasEntre(desde, hasta);
  return n <= 14 ? "dia" : n <= 98 ? "semana" : "mes";
}

/**
 * Lo que entró y salió de cajas y bancos (pesos) por día, semana o mes, y el
 * saldo al final de cada tramo. Los pases entre cajas propias no cuentan.
 */
export function serieFlujo({ ops = [], cajas, desde, hasta, tramo, apertura = 0 }) {
  const clave = (f) => (tramo === "dia" ? f : tramo === "semana" ? (lunesDe(f) < desde ? desde : lunesDe(f)) : f.slice(0, 7));
  const orden = [];
  if (tramo === "mes") orden.push(...mesesEntre(desde, hasta));
  else {
    for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
      const k = clave(f);
      if (orden[orden.length - 1] !== k) orden.push(k);
    }
  }
  const tramos = new Map(orden.map((k) => [k, { clave: k, entro: 0, salio: 0 }]));
  for (const op of ops) {
    if (op.fecha < desde || op.fecha > hasta) continue;
    const v = deltaCaja(op, cajas).ARS;
    const t = tramos.get(clave(op.fecha));
    if (!t || !v) continue;
    if (v > 0) t.entro += v; else t.salio -= v;
  }
  let saldo = apertura;
  return orden.map((k) => {
    const t = tramos.get(k);
    saldo += t.entro - t.salio;
    const d = new Date(`${tramo === "mes" ? `${k}-01` : k}T12:00:00Z`);
    const etiqueta = tramo === "dia" ? `${DIAS_CORTOS[d.getUTCDay()]} ${k.slice(8, 10)}` : tramo === "semana" ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : `${MESES_CORTOS[d.getUTCMonth()]} ${k.slice(2, 4)}`;
    return { clave: k, etiqueta, entro: centavos(t.entro), salio: centavos(t.salio), saldo: centavos(saldo) };
  });
}

/**
 * El reporte completo.
 * @returns {object|null} null si el período no vale
 */
export function reporteFinanciero({
  tipo, fecha, hasta: hastaRango, ops = [], cuentas = [], tesoreria = [], proyectos = [], centros = [], lineas = {},
  materialesPct, cheques = [], clientes = [], proveedores = [], hoy = "",
}) {
  const periodo = periodoReporte(tipo, fecha, hastaRango);
  if (!periodo) return null;
  const { desde, hasta } = periodo;
  const vivas = ops.filter((o) => !o.anulada_at);
  const confirmadas = vivas.filter((o) => o.estado !== "para_revisar");
  const enPeriodo = confirmadas.filter((o) => o.fecha >= desde && o.fecha <= hasta);
  const hastaFin = confirmadas.filter((o) => o.fecha <= hasta);
  const paraRevisar = vivas.filter((o) => o.estado === "para_revisar" && o.fecha >= desde && o.fecha <= hasta).length;

  // 1. Resultados: solo lo del período (el estado suma por mes; el total es el período)
  const er = estadoResultados({ ops: enPeriodo, cuentas, proyectos, centros, hasta: hasta.slice(0, 7), materialesPct });
  const resultados = er.filas
    .filter((f) => ["seccion", "grupo", "resultado"].includes(f.tipo))
    .filter((f) => f.tipo !== "seccion" || !f.aparte || Math.abs(f.total) >= 0.01)
    .map((f) => ({ tipo: f.tipo, id: f.id, nombre: f.nombre, total: f.total, aparte: !!f.aparte, pct: er.filas.find((x) => x.id === `${f.id}_PCT`)?.total ?? null }))
    .filter((f) => f.tipo !== "grupo" || Math.abs(f.total) >= 0.01);
  const total = (id) => er.filas.find((f) => f.id === id)?.total || 0;

  // 2. Flujo: apertura = todo lo de antes; después, lo del período
  const cajas = cajasPorMoneda(tesoreria);
  const apertura = { ARS: 0, USD: 0 };
  for (const op of confirmadas) {
    if (op.fecha >= desde) continue;
    const d = deltaCaja(op, cajas);
    apertura.ARS += d.ARS;
    apertura.USD += d.USD;
  }
  const fr = flujoReal({ ops: enPeriodo, tesoreria, cuentas, lineas, meses: mesesEntre(desde, hasta) });
  const flujo = {};
  for (const mon of ["ARS", "USD"]) {
    const m = fr.monedas[mon];
    const neto = centavos(m.neto.reduce((s, v) => s + v, 0));
    const ap = centavos(apertura[mon]);
    flujo[mon] = {
      apertura: ap, neto, cierre: centavos(ap + neto),
      filas: m.filas.map((f) => ({ tipo: f.tipo, id: f.id, nombre: f.nombre, total: f.total })).filter((f) => Math.abs(f.total) >= 0.01),
      hay: Math.abs(ap) >= 0.01 || m.filas.length > 0,
    };
  }

  // 3. Posición de fondos al último día
  const saldos = saldosTesoreria(hastaFin, tesoreria).filter((s) => s.activa !== false || Math.abs(s.saldo) >= 0.01);
  const fondos = ORDEN_TIPOS.map((t) => {
    const deTipo = saldos.filter((s) => (s.tipo || "otro") === t).sort((a, b) => a.nombre.localeCompare(b.nombre));
    return { tipo: t, nombre: NOMBRE_GRUPO[t], cajas: deTipo.map((s) => ({ nombre: s.nombre, moneda: s.moneda === "USD" ? "USD" : "ARS", saldo: s.saldo })), totales: totalesTesoreria(deTipo) };
  }).filter((g) => g.cajas.length);
  const totalFondos = totalesTesoreria(saldos);

  // 4. Valores (cheques) como están hoy
  const vivo = (c) => (c.clase === "tercero" ? c.estado === "en_cartera" : c.estado === "pendiente");
  const valor = (c) => ({
    fecha_pago: c.fecha_pago || "", importe: centavos(c.importe), tipo: TIPOS_CHEQUE[c.tipo] || c.tipo || "",
    numero: c.numero || "", banco: c.banco || "", quien: c.clase === "tercero" ? c.librador || "" : c.beneficiario || "",
    vencido: Boolean(hoy && c.fecha_pago && c.fecha_pago < hoy),
  });
  const lista = (clase) => {
    const xs = cheques.filter((c) => c.clase === clase && vivo(c)).map(valor).sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago));
    return { cantidad: xs.length, total: centavos(xs.reduce((s, x) => s + x.importe, 0)), vencidos: xs.filter((x) => x.vencido).length, cheques: xs };
  };
  const valores = { a_cobrar: lista("tercero"), a_pagar: lista("propio") };

  // 5. Cuentas a cobrar y a pagar al último día
  const cli = saldosClientes(hastaFin, cuentasDeudores(cuentas), clientes);
  const prov = saldosProveedores(hastaFin, cuentasProveedores(cuentas), proveedores);
  const resumen = (xs, campo) => {
    const deben = xs.filter((x) => x[campo] >= 0.01);
    const favor = xs.filter((x) => x[campo] <= -0.01);
    return {
      total: centavos(deben.reduce((s, x) => s + x[campo], 0)),
      cantidad: deben.length,
      a_favor: centavos(-favor.reduce((s, x) => s + x[campo], 0)),
      renglones: deben.slice(0, MAX_RENGLONES).map((x) => ({ nombre: x.nombre || "Sin nombre", saldo: x[campo], ultimo: x.ultimo })),
      mas: Math.max(0, deben.length - MAX_RENGLONES),
    };
  };
  const cuentasACobrar = resumen(cli, "saldo");
  const cuentasAPagar = resumen(prov, "deuda");

  // Para los gráficos
  const tramo = tramoDe(tipo, desde, hasta);
  const serie = serieFlujo({ ops: enPeriodo, cajas, desde, hasta, tramo, apertura: apertura.ARS });
  const graficoResultados = [
    { id: "ING", nombre: "Ingresos por entregas", total: total("ING"), tono: "verde" },
    { id: "CMV", nombre: "Costo de ventas", total: -total("CMV"), tono: "rojo" },
    { id: "GAS", nombre: "Gastos de comercialización y administración", total: -centavos(total("COM") + total("ADM")), tono: "ambar" },
    { id: "OTR", nombre: "Otros ingresos y gastos", total: total("OTR"), tono: "violeta" },
    { id: "FIN", nombre: "Resultados financieros", total: -total("FIN"), tono: "rojo" },
    { id: "GAN", nombre: "Impuesto a las ganancias", total: -total("GAN"), tono: "gris" },
    { id: "RDO_NETO", nombre: "Resultado del período", total: total("RDO_NETO"), tono: total("RDO_NETO") < 0 ? "rojo" : "verde", resultado: true },
  ].filter((g) => g.resultado || Math.abs(g.total) >= 0.01);

  return {
    ...periodo,
    para_revisar: paraRevisar,
    tramo, serie, grafico_resultados: graficoResultados,
    resumen: {
      entregas: total("ING"), resultado: total("RDO_NETO"), resultado_operativo: total("EBIT"),
      flujo_neto: flujo.ARS.neto, fondos_ars: totalFondos.ARS, fondos_usd: totalFondos.USD,
      a_cobrar: centavos(cuentasACobrar.total + valores.a_cobrar.total), a_pagar: centavos(cuentasAPagar.total + valores.a_pagar.total),
    },
    resultados, materiales_estimados: er.materiales_estimados, hay_entregas: er.hay_entregas,
    flujo, fondos, total_fondos: totalFondos, valores,
    cuentas_a_cobrar: cuentasACobrar, cuentas_a_pagar: cuentasAPagar,
  };
}

/* ─── Hoja para imprimir o guardar en PDF ─────────────────────────────── */

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));
const $ = (n, m = "ARS") => esc(plata(n, m));
const pct = (n) => (n == null ? "" : `${String(n).replace(".", ",")} %`);
const kpi = (label, valor, tono = "") => `<div class="kpi ${tono}"><span>${esc(label)}</span><b>${valor}</b></div>`;
const tonoDe = (n) => (n < 0 ? "rojo" : n > 0 ? "verde" : "");

/* Gráficos en SVG (se ven igual en la pantalla, al imprimir y en el PDF) */
// Los colores de la hoja impresa (no son de la app: van fijos para que el PDF salga igual)
const hex = (h) => `#${h}`;
const COLOR = { verde: hex("15803d"), rojo: hex("c62828"), ambar: hex("b45309"), violeta: hex("6d28d9"), cyan: hex("0e7490"), gris: hex("6b7280"), fondo: hex("eef1f4"), linea: hex("cfd6dd") };
const COLOR_FONDOS = { caja: hex("0e7490"), banco: hex("1d4ed8"), fci: hex("6d28d9"), plazo_fijo: hex("b45309"), otro: hex("6b7280") };
const compacto = (n) => {
  const a = Math.abs(n);
  const t = a >= 1e9 ? `${(a / 1e9).toFixed(1)} mil M` : a >= 1e6 ? `${(a / 1e6).toFixed(1)} M` : a >= 1e3 ? `${Math.round(a / 1e3)} mil` : String(Math.round(a));
  return `${n < 0 ? "−" : ""}$ ${t.replace(".", ",")}`;
};

/** Columnas de lo que entró (verde) y salió (rojo) por tramo, con el saldo como línea. */
export function svgFlujo(serie = []) {
  if (!serie.length) return "";
  const W = 700, H = 230, izq = 8, der = 8, arriba = 14, abajo = 34;
  const alto = H - arriba - abajo;
  const max = Math.max(1, ...serie.map((t) => Math.max(t.entro, t.salio)));
  const ancho = (W - izq - der) / serie.length;
  const barra = Math.max(2, Math.min(26, ancho * 0.36));
  const y = (v) => arriba + alto - (v / max) * alto;
  const saldos = serie.map((t) => t.saldo);
  const sMin = Math.min(0, ...saldos), sMax = Math.max(1, ...saldos);
  const ys = (v) => arriba + alto - ((v - sMin) / (sMax - sMin || 1)) * alto;
  const cada = Math.ceil(serie.length / 16);
  const cols = serie.map((t, i) => {
    const x = izq + i * ancho + ancho / 2;
    return `<rect x="${(x - barra - 1).toFixed(1)}" y="${y(t.entro).toFixed(1)}" width="${barra.toFixed(1)}" height="${(arriba + alto - y(t.entro)).toFixed(1)}" rx="2" fill="${COLOR.verde}"><title>${esc(t.etiqueta)} · entró ${esc(plata(t.entro))}</title></rect>`
      + `<rect x="${(x + 1).toFixed(1)}" y="${y(t.salio).toFixed(1)}" width="${barra.toFixed(1)}" height="${(arriba + alto - y(t.salio)).toFixed(1)}" rx="2" fill="${COLOR.rojo}"><title>${esc(t.etiqueta)} · salió ${esc(plata(t.salio))}</title></rect>`
      + (i % cada === 0 ? `<text x="${x.toFixed(1)}" y="${H - abajo + 14}" text-anchor="middle" font-size="10" fill="#444">${esc(t.etiqueta)}</text>` : "");
  }).join("");
  const puntos = serie.map((t, i) => `${(izq + i * ancho + ancho / 2).toFixed(1)},${ys(t.saldo).toFixed(1)}`).join(" ");
  return `<svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lo que entró y salió por ${serie.length > 1 ? "tramo" : "período"}">
  <line x1="${izq}" x2="${W - der}" y1="${arriba + alto}" y2="${arriba + alto}" stroke="${COLOR.linea}"/>
  ${cols}
  <polyline points="${puntos}" fill="none" stroke="${COLOR.cyan}" stroke-width="2.5" stroke-linejoin="round"/>
  ${serie.map((t, i) => `<circle cx="${(izq + i * ancho + ancho / 2).toFixed(1)}" cy="${ys(t.saldo).toFixed(1)}" r="3" fill="${COLOR.cyan}"><title>${esc(t.etiqueta)} · saldo ${esc(plata(t.saldo))}</title></circle>`).join("")}
</svg>
<div class="leyenda"><i style="background:${COLOR.verde}"></i>Entró <i style="background:${COLOR.rojo}"></i>Salió <i class="raya" style="background:${COLOR.cyan}"></i>Saldo en cajas y bancos (escala propia: de ${esc(compacto(sMin))} a ${esc(compacto(sMax))})</div>`;
}

/** Barras horizontales: [{ nombre, valor, color }] con el importe a la derecha. */
export function svgBarras(items = [], { moneda = "ARS" } = {}) {
  if (!items.length) return "";
  const W = 700, fila = 24, nombre = 250, valor = 120;
  const H = items.length * fila + 4;
  const max = Math.max(1, ...items.map((x) => Math.abs(x.valor)));
  const negativos = items.some((x) => x.valor < 0);
  const ancho = W - nombre - valor - 12;
  const cero = nombre + 6 + (negativos ? ancho / 2 : 0);
  const escala = negativos ? ancho / 2 : ancho;
  return `<svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras">
  ${items.map((x, i) => {
    const yb = i * fila + 4;
    const w = Math.max(1, (Math.abs(x.valor) / max) * escala);
    const xb = x.valor < 0 ? cero - w : cero;
    const corto = x.nombre.length > 38 ? `${x.nombre.slice(0, 37)}…` : x.nombre;
    return `<text x="${nombre}" y="${yb + 14}" text-anchor="end" font-size="11" fill="#222"${x.fuerte ? ' font-weight="700"' : ""}>${esc(corto)}</text>`
      + `<rect x="${xb.toFixed(1)}" y="${yb + 3}" width="${w.toFixed(1)}" height="${fila - 8}" rx="3" fill="${x.color}"><title>${esc(x.nombre)} · ${esc(plata(x.valor, moneda))}</title></rect>`
      + `<text x="${W - 2}" y="${yb + 14}" text-anchor="end" font-size="11" fill="${x.valor < 0 ? COLOR.rojo : "#222"}"${x.fuerte ? ' font-weight="700"' : ""}>${esc(plata(x.valor, moneda))}</text>`;
  }).join("")}
  ${negativos ? `<line x1="${cero}" x2="${cero}" y1="0" y2="${H}" stroke="${COLOR.linea}"/>` : ""}
</svg>`;
}

/** Barra fina para una celda (cuentas a cobrar y a pagar). */
const miniBarra = (v, max, color) => `<svg viewBox="0 0 100 8" preserveAspectRatio="none" class="mini" aria-hidden="true"><rect width="100" height="8" rx="4" fill="${COLOR.fondo}"/><rect width="${Math.max(1, Math.round((v / Math.max(1, max)) * 100))}" height="8" rx="4" fill="${color}"/></svg>`;

function tablaResultados(r) {
  const filas = r.resultados.map((f) => {
    const clase = f.tipo === "resultado" ? "res" : f.tipo === "seccion" ? `sec${f.aparte ? " aparte" : ""}` : "grp";
    return `<tr class="${clase}"><td>${esc(f.nombre)}</td><td class="n${f.total < 0 ? " rojo" : ""}">${$(f.total)}</td><td class="n pc">${f.tipo === "resultado" ? pct(f.pct) : ""}</td></tr>`;
  }).join("");
  return `<table><thead><tr><th>Concepto</th><th class="n">Importe</th><th class="n">% s/ ingresos</th></tr></thead><tbody>${filas}</tbody></table>`;
}

function tablaFlujo(f, mon) {
  const filas = f.filas.map((x) => {
    const clase = x.tipo === "seccion" ? "sec" : x.tipo === "linea" ? "lin" : "det";
    return `<tr class="${clase}"><td>${esc(x.nombre)}</td><td class="n${x.total < 0 ? " rojo" : ""}">${$(x.total, mon)}</td></tr>`;
  }).join("");
  return `<table><tbody>
    <tr class="res"><td>Saldo al empezar</td><td class="n">${$(f.apertura, mon)}</td></tr>
    ${filas}
    <tr class="res"><td>Flujo neto del período</td><td class="n${f.neto < 0 ? " rojo" : ""}">${$(f.neto, mon)}</td></tr>
    <tr class="res"><td>Saldo al terminar</td><td class="n${f.cierre < 0 ? " rojo" : ""}">${$(f.cierre, mon)}</td></tr>
  </tbody></table>`;
}

function tablaFondos(r) {
  const filas = r.fondos.map((g) => `<tr class="sec"><td colspan="2">${esc(g.nombre)}</td></tr>${g.cajas.map((c) => `<tr><td>${esc(c.nombre)}</td><td class="n${c.saldo < 0 ? " rojo" : ""}">${$(c.saldo, c.moneda)}</td></tr>`).join("")}`).join("");
  return `<table><tbody>${filas}
    <tr class="res"><td>Total en pesos</td><td class="n">${$(r.total_fondos.ARS)}</td></tr>
    ${Math.abs(r.total_fondos.USD) >= 0.01 ? `<tr class="res"><td>Total en dólares</td><td class="n">${$(r.total_fondos.USD, "USD")}</td></tr>` : ""}
  </tbody></table>`;
}

function tablaValores(v, titulo) {
  if (!v.cantidad) return `<h3>${esc(titulo)}</h3><p class="vacio">No hay.</p>`;
  const filas = v.cheques.map((c) => `<tr${c.vencido ? ' class="vencido"' : ""}><td>${esc(dma(c.fecha_pago))}</td><td>${esc(c.tipo)}${c.numero ? ` N° ${esc(c.numero)}` : ""}${c.banco ? ` · ${esc(c.banco)}` : ""}</td><td>${esc(c.quien)}</td><td class="n">${$(c.importe)}</td></tr>`).join("");
  return `<h3>${esc(titulo)}: ${v.cantidad} · ${$(v.total)}${v.vencidos ? ` · <span class="rojo">${v.vencidos} vencidos</span>` : ""}</h3>
  <table><thead><tr><th>Vence</th><th>Cheque</th><th>De / para</th><th class="n">Importe</th></tr></thead><tbody>${filas}</tbody></table>`;
}

function tablaCuentas(c, titulo, quien) {
  if (!c.cantidad) return `<h3>${esc(titulo)}</h3><p class="vacio">Nadie ${quien === "clientes" ? "nos debe" : "a quien le debamos"}.</p>`;
  const max = Math.max(1, ...c.renglones.map((x) => x.saldo));
  const color = quien === "clientes" ? COLOR.verde : COLOR.rojo;
  const filas = c.renglones.map((x) => `<tr><td>${esc(x.nombre)}</td><td>${esc(dma(x.ultimo))}</td><td class="bar">${miniBarra(x.saldo, max, color)}</td><td class="n">${$(x.saldo)}</td></tr>`).join("");
  return `<h3>${esc(titulo)}: ${$(c.total)} (${c.cantidad} ${esc(c.cantidad === 1 ? (quien === "clientes" ? "cliente" : "proveedor") : quien)})</h3>
  <table><thead><tr><th>${quien === "clientes" ? "Cliente" : "Proveedor"}</th><th>Último movimiento</th><th></th><th class="n">Saldo</th></tr></thead><tbody>${filas}</tbody></table>
  ${c.mas ? `<p class="nota">Y ${c.mas} más.</p>` : ""}${c.a_favor ? `<p class="nota">Saldo a favor ${quien === "clientes" ? "de clientes (anticipos)" : "nuestro con proveedores"}: ${$(c.a_favor)}.</p>` : ""}`;
}

const TITULO_TIPO = { semana: " semanal", mes: " mensual", rango: "" };
const NOMBRE_TRAMO = { dia: "por día", semana: "por semana", mes: "por mes" };

/** El reporte como página HTML a color, con gráficos (para verlo, imprimirlo o bajarlo en PDF). */
export function htmlReporte(r, { empresa = "" } = {}) {
  const s = r.resumen;
  const neto = s.a_cobrar - s.a_pagar;
  const resultados = (r.grafico_resultados || []).map((g) => ({ nombre: g.nombre, valor: g.total, color: COLOR[g.tono] || COLOR.gris, fuerte: !!g.resultado }));
  const fondosArs = r.fondos.flatMap((g) => g.cajas.filter((c) => c.moneda === "ARS" && Math.abs(c.saldo) >= 0.01).map((c) => ({ nombre: c.nombre, valor: c.saldo, color: COLOR_FONDOS[g.tipo] || COLOR.gris })))
    .sort((a, b) => b.valor - a.valor).slice(0, 12);
  const serie = r.serie || [];
  const totalEntro = centavos(serie.reduce((t, x) => t + x.entro, 0));
  const totalSalio = centavos(serie.reduce((t, x) => t + x.salio, 0));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte financiero · ${esc(r.titulo)}</title>
<style>
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;margin:24px;font-size:12px;background:#fff}
  .cabecera{background:linear-gradient(90deg,#0e7490,#1d4ed8);color:#fff;border-radius:10px;padding:14px 16px;margin-bottom:12px}
  .cabecera h1{font-size:20px;margin:0}.cabecera p{margin:4px 0 0;opacity:.9}
  h2{font-size:15px;margin:0 0 8px;padding:6px 10px;border-radius:6px;background:#eef6f8;border-left:5px solid #0e7490}
  section{margin:18px 0 0}section.s2 h2{border-color:#15803d;background:#eef7f0}section.s3 h2{border-color:#1d4ed8;background:#eef2fb}
  section.s4 h2{border-color:#b45309;background:#fbf4ec}section.s5 h2{border-color:#6d28d9;background:#f3effb}
  h3{font-size:13px;margin:12px 0 4px}.sub{color:#555;margin:2px 0 12px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .kpi{border:1px solid #dde3e8;border-left:5px solid #0e7490;border-radius:8px;padding:7px 9px;background:#f7fafb}.kpi span{display:block;color:#555;font-size:11px}.kpi b{font-size:15px}
  .kpi.verde{border-left-color:#15803d;background:#f0f8f2}.kpi.verde b{color:#15803d}.kpi.rojo{border-left-color:#c62828;background:#fcf0f0}.kpi.rojo b{color:#c62828}
  table{width:100%;border-collapse:collapse;margin-top:6px}td,th{padding:3px 6px;border-bottom:1px solid #e6e9ec;text-align:left;vertical-align:top}
  th{color:#555;font-weight:600}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .sec td{font-weight:700;background:#f2f5f7}.grp td:first-child,.lin td:first-child{padding-left:16px}.det td{color:#555;font-size:11px}.det td:first-child{padding-left:30px}
  .res td{font-weight:700;border-top:2px solid #1a1a1a}.aparte td{font-style:italic;font-weight:400;color:#555}.pc{color:#555}
  .rojo{color:#c62828}.verde{color:#15803d}.vencido td{color:#c62828}.vacio,.nota{color:#555;margin:2px 0}.aviso{color:#8a5a00;background:#fdf6e7;border-radius:6px;padding:6px 8px}
  .dos{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .graf{width:100%;height:auto;display:block;margin:6px 0 2px}
  .leyenda{color:#444;font-size:11px;margin:2px 0 6px}.leyenda i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:-1px}.leyenda i:first-child{margin-left:0}.leyenda i.raya{height:3px;width:14px;vertical-align:2px}
  .mini{width:100%;height:8px;display:block;margin-top:4px}td.bar{width:28%}
  .totales{display:flex;gap:14px;flex-wrap:wrap;margin:2px 0}.totales b{font-variant-numeric:tabular-nums}
  @media print{body{margin:10mm}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}.graf{break-inside:avoid}}
  @media (max-width:700px){.kpis,.dos{grid-template-columns:1fr 1fr}}
</style></head><body>
<div class="cabecera"><h1>Reporte financiero${TITULO_TIPO[r.tipo] ?? ""}${empresa ? ` · ${esc(empresa)}` : ""}</h1>
<p>${esc(r.titulo)} (del ${esc(dma(r.desde))} al ${esc(dma(r.hasta))}). En pesos y sin IVA salvo que diga dólares.</p></div>
${r.para_revisar ? `<p class="aviso">⚠ Hay ${r.para_revisar} operaciones para revisar en el período que no cuentan. Confirmalas en Movimientos.</p>` : ""}
<div class="kpis">
  ${kpi("Entregas del período", $(s.entregas))}
  ${kpi("Resultado del período", $(s.resultado), tonoDe(s.resultado))}
  ${kpi("Flujo neto (pesos)", $(s.flujo_neto), tonoDe(s.flujo_neto))}
  ${kpi("Fondos al cierre", `${$(s.fondos_ars)}${Math.abs(s.fondos_usd) >= 0.01 ? `<br>${$(s.fondos_usd, "USD")}` : ""}`, s.fondos_ars < 0 ? "rojo" : "")}
  ${kpi("A cobrar (cuentas + cheques)", $(s.a_cobrar))}
  ${kpi("A pagar (cuentas + cheques)", $(s.a_pagar))}
  ${kpi("Neto a cobrar − a pagar", $(neto), tonoDe(neto))}
  ${kpi("Resultado operativo", $(s.resultado_operativo), tonoDe(s.resultado_operativo))}
</div>

<section class="s1">
<h2>1. Resultados (NIIF, devengado; ingresos = entregas)</h2>
${r.hay_entregas ? "" : '<p class="aviso">⚠ No hay entregas en el período.</p>'}
${resultados.length > 1 ? svgBarras(resultados) : ""}
${tablaResultados(r)}
${r.materiales_estimados ? '<p class="nota">El costo de materiales es estimado (un % de las entregas).</p>' : ""}
</section>

<section class="s2">
<h2>2. Flujo de caja</h2>
${serie.length && (totalEntro || totalSalio) ? `<h3>Lo que entró y salió ${esc(NOMBRE_TRAMO[r.tramo] || "")} (pesos, sin los pases entre cajas propias)</h3>
<div class="totales"><span>Entró <b class="verde">${$(totalEntro)}</b></span><span>Salió <b class="rojo">${$(totalSalio)}</b></span><span>Diferencia <b class="${totalEntro - totalSalio < 0 ? "rojo" : "verde"}">${$(totalEntro - totalSalio)}</b></span></div>
${svgFlujo(serie)}` : ""}
${r.flujo.ARS.hay ? tablaFlujo(r.flujo.ARS, "ARS") : '<p class="vacio">Sin movimientos en pesos.</p>'}
${r.flujo.USD.hay ? `<h3>En dólares</h3>${tablaFlujo(r.flujo.USD, "USD")}` : ""}
</section>

<section class="s3">
<h2>3. Posición de fondos al ${esc(dma(r.hasta))}</h2>
${fondosArs.length > 1 ? svgBarras(fondosArs) : ""}
${r.fondos.length ? tablaFondos(r) : '<p class="vacio">No hay cajas ni bancos cargados.</p>'}
</section>

<section class="s4">
<h2>4. Valores a cobrar y a pagar (cheques, como están hoy)</h2>
${r.valores.a_cobrar.cantidad || r.valores.a_pagar.cantidad ? svgBarras([
    { nombre: "Cheques de terceros en cartera", valor: r.valores.a_cobrar.total, color: COLOR.verde },
    { nombre: "Cheques y e-cheq propios por debitar", valor: -r.valores.a_pagar.total, color: COLOR.rojo },
  ]) : ""}
<div class="dos"><div>${tablaValores(r.valores.a_cobrar, "Cheques de terceros en cartera")}</div><div>${tablaValores(r.valores.a_pagar, "Cheques y e-cheq propios por debitar")}</div></div>
</section>

<section class="s5">
<h2>5. Cuentas a cobrar y a pagar al ${esc(dma(r.hasta))}</h2>
<div class="dos"><div>${tablaCuentas(r.cuentas_a_cobrar, "Cuentas a cobrar", "clientes")}</div><div>${tablaCuentas(r.cuentas_a_pagar, "Cuentas a pagar", "proveedores")}</div></div>
</section>
</body></html>`;
}

/** Baja el reporte en PDF a color (sin pasar por imprimir). */
export function descargarPdfReporte(r, opciones) {
  const nombre = `Reporte financiero - ${String(r.titulo || "").replace(/[\\/:*?"<>|]+/g, "-")}.pdf`;
  return descargarPdfDeHtml(htmlReporte(r, opciones), { archivo: nombre });
}

/** Abre el reporte en una pestaña nueva con el diálogo de impresión (ahí se elige "Guardar como PDF"). */
export function imprimirReporte(r, opciones) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(htmlReporte(r, opciones));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 600);
}
