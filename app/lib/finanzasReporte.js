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

export const TIPOS_REPORTE = { semana: "Semanal", mes: "Mensual" };
export const MAX_RENGLONES = 25;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const dma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");
const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** La semana (lunes a domingo) o el mes de una fecha: { tipo, desde, hasta, titulo } o null. */
export function periodoReporte(tipo, fecha) {
  if (!TIPOS_REPORTE[tipo] || !FECHA.test(String(fecha || ""))) return null;
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

/** Los meses (AAAA-MM) que toca el período, del más viejo al más nuevo. */
const mesesDe = (desde, hasta) => [...new Set([desde.slice(0, 7), hasta.slice(0, 7)])];

/**
 * El reporte completo.
 * @returns {object|null} null si el período no vale
 */
export function reporteFinanciero({
  tipo, fecha, ops = [], cuentas = [], tesoreria = [], proyectos = [], centros = [], lineas = {},
  materialesPct, cheques = [], clientes = [], proveedores = [], hoy = "",
}) {
  const periodo = periodoReporte(tipo, fecha);
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
  const fr = flujoReal({ ops: enPeriodo, tesoreria, cuentas, lineas, meses: mesesDe(desde, hasta) });
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

  return {
    ...periodo,
    para_revisar: paraRevisar,
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
const kpi = (label, valor, rojo = false) => `<div class="kpi${rojo ? " rojo" : ""}"><span>${esc(label)}</span><b>${valor}</b></div>`;

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
  const filas = c.renglones.map((x) => `<tr><td>${esc(x.nombre)}</td><td>${esc(dma(x.ultimo))}</td><td class="n">${$(x.saldo)}</td></tr>`).join("");
  return `<h3>${esc(titulo)}: ${$(c.total)} (${c.cantidad} ${esc(quien)})</h3>
  <table><thead><tr><th>${quien === "clientes" ? "Cliente" : "Proveedor"}</th><th>Último movimiento</th><th class="n">Saldo</th></tr></thead><tbody>${filas}</tbody></table>
  ${c.mas ? `<p class="nota">Y ${c.mas} más.</p>` : ""}${c.a_favor ? `<p class="nota">Saldo a favor ${quien === "clientes" ? "de clientes (anticipos)" : "nuestro con proveedores"}: ${$(c.a_favor)}.</p>` : ""}`;
}

/** El reporte como página HTML (para verlo, imprimirlo o guardarlo en PDF). */
export function htmlReporte(r, { empresa = "" } = {}) {
  const s = r.resumen;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte financiero · ${esc(r.titulo)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px;font-size:12px}
  h1{font-size:20px;margin:0}h2{font-size:15px;margin:22px 0 6px;border-bottom:2px solid #111;padding-bottom:3px}h3{font-size:13px;margin:12px 0 4px}
  .sub{color:#555;margin:2px 0 12px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .kpi{border:1px solid #ccc;border-radius:6px;padding:6px 8px}.kpi span{display:block;color:#555;font-size:11px}.kpi b{font-size:14px}
  table{width:100%;border-collapse:collapse;margin-top:4px}td,th{padding:3px 6px;border-bottom:1px solid #e3e3e3;text-align:left;vertical-align:top}
  th{color:#555;font-weight:600}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .sec td{font-weight:700;background:#f2f2f2}.grp td:first-child,.lin td:first-child{padding-left:16px}.det td{color:#555;font-size:11px}.det td:first-child{padding-left:30px}
  .res td{font-weight:700;border-top:2px solid #111}.aparte td{font-style:italic;font-weight:400;color:#555}.pc{color:#555}
  .rojo{color:#b00020}.vencido td{color:#b00020}.vacio,.nota{color:#555;margin:2px 0}.aviso{color:#8a5a00}
  .dos{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media print{body{margin:10mm}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}
  @media (max-width:700px){.kpis,.dos{grid-template-columns:1fr 1fr}}
</style></head><body>
<h1>Reporte financiero ${esc(TIPOS_REPORTE[r.tipo].toLowerCase())}${empresa ? ` · ${esc(empresa)}` : ""}</h1>
<p class="sub">${esc(r.titulo)} (del ${esc(dma(r.desde))} al ${esc(dma(r.hasta))}). En pesos y sin IVA salvo que diga dólares.</p>
${r.para_revisar ? `<p class="aviso">⚠ Hay ${r.para_revisar} operaciones para revisar en el período que no cuentan. Confirmalas en Movimientos.</p>` : ""}
<div class="kpis">
  ${kpi("Entregas del período", $(s.entregas))}
  ${kpi("Resultado del período", $(s.resultado), s.resultado < 0)}
  ${kpi("Flujo neto (pesos)", $(s.flujo_neto), s.flujo_neto < 0)}
  ${kpi("Fondos al cierre", `${$(s.fondos_ars)}${Math.abs(s.fondos_usd) >= 0.01 ? `<br>${$(s.fondos_usd, "USD")}` : ""}`)}
  ${kpi("A cobrar (cuentas + cheques)", $(s.a_cobrar))}
  ${kpi("A pagar (cuentas + cheques)", $(s.a_pagar))}
  ${kpi("Neto a cobrar − a pagar", $(s.a_cobrar - s.a_pagar), s.a_cobrar - s.a_pagar < 0)}
  ${kpi("Resultado operativo", $(s.resultado_operativo), s.resultado_operativo < 0)}
</div>

<h2>1. Resultados (NIIF, devengado; ingresos = entregas)</h2>
${r.hay_entregas ? "" : '<p class="aviso">⚠ No hay entregas en el período.</p>'}
${tablaResultados(r)}
${r.materiales_estimados ? '<p class="nota">El costo de materiales es estimado (un % de las entregas).</p>' : ""}

<h2>2. Flujo de caja</h2>
${r.flujo.ARS.hay ? tablaFlujo(r.flujo.ARS, "ARS") : '<p class="vacio">Sin movimientos en pesos.</p>'}
${r.flujo.USD.hay ? `<h3>En dólares</h3>${tablaFlujo(r.flujo.USD, "USD")}` : ""}

<h2>3. Posición de fondos al ${esc(dma(r.hasta))}</h2>
${r.fondos.length ? tablaFondos(r) : '<p class="vacio">No hay cajas ni bancos cargados.</p>'}

<h2>4. Valores a cobrar y a pagar (cheques, como están hoy)</h2>
<div class="dos"><div>${tablaValores(r.valores.a_cobrar, "Cheques de terceros en cartera")}</div><div>${tablaValores(r.valores.a_pagar, "Cheques y e-cheq propios por debitar")}</div></div>

<h2>5. Cuentas a cobrar y a pagar al ${esc(dma(r.hasta))}</h2>
<div class="dos"><div>${tablaCuentas(r.cuentas_a_cobrar, "Cuentas a cobrar", "clientes")}</div><div>${tablaCuentas(r.cuentas_a_pagar, "Cuentas a pagar", "proveedores")}</div></div>
</body></html>`;
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
