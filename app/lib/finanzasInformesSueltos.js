// app/lib/finanzasInformesSueltos.js — Finanzas: cada informe por separado en
// PDF o Excel (pedido de Tadeo del 19/11). Sin migración.
//
// Arma { titulo, html, hojas } de lo mismo que se ve en cada pantalla, sin
// volver a pedir nada al servidor:
//   📊 Resultados (filas de estadoResultados), 💵 Flujo de caja (flujoReal),
//   ⚖️ Situación patrimonial, 🏦 Flujo de cheques (calendarioCheques y la
//   lista de cheques vivos). Cuentas a cobrar y a pagar están en
//   finanzasCuentasPagarCobrar.js (informeCuentas).
import { efectoDe, importeVisible, nombreMes } from "./finanzasResultados";
import { $, B, F, N, NB, T, dma, esc, hojaInforme } from "./finanzasInformes";
import { ESTILO } from "./xlsxSimple";

const miles = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");
const pctTxt = (n) => (n == null ? "" : `${String(n).replace(".", ",")} %`);
const rojo = (n) => (Number(n) < 0 ? " rojo" : "");
const CLASE = { seccion: "sec", resultado: "tot", grupo: "", linea: "sub", pct: "sub", cuenta: "sub" };

/**
 * Una tabla por mes (Resultados o Flujo): concepto, un valor por mes y el total.
 * @param {{ meses: string[], filas: { tipo: string, nombre: string, valores: number[], total: number|null }[] }} t
 */
function tablaMensual({ meses, filas }) {
  const celda = (f, v) => (f.tipo === "pct" ? esc(pctTxt(v)) : v ? miles(v) : "–");
  return `<table><thead><tr><th>Concepto</th>${meses.map((m) => `<th class="n">${esc(nombreMes(m))}</th>`).join("")}<th class="n">Total</th></tr></thead><tbody>
${filas.map((f) => `<tr class="${CLASE[f.tipo] ?? "sub"}"><td>${esc(f.nombre)}</td>${f.valores.map((v) => `<td class="n${f.tipo === "pct" ? "" : rojo(v)}">${celda(f, v)}</td>`).join("")}<td class="n${f.tipo === "pct" ? "" : rojo(f.total)}"><b>${f.total == null ? "" : celda(f, f.total)}</b></td></tr>`).join("\n")}
</tbody></table>`;
}

function hojaMensual(nombre, titulo, subtitulo, { meses, filas }) {
  const fuerte = (f) => f.tipo === "seccion" || f.tipo === "resultado";
  const val = (f, v) => (f.tipo === "pct" ? (v == null ? "" : `${String(v).replace(".", ",")} %`) : fuerte(f) ? NB(v) : N(v));
  return [{
    nombre,
    anchos: [44, ...meses.map(() => 14), 16],
    filas: [
      [T(titulo)], [subtitulo], [],
      [B("Concepto"), ...meses.map((m) => B(nombreMes(m))), B("Total")],
      ...filas.map((f) => [fuerte(f) ? B(f.nombre) : `${f.tipo === "linea" || f.tipo === "cuenta" || f.tipo === "pct" ? "    " : "  "}${f.nombre}`, ...f.valores.map((v) => val(f, v)), f.total == null ? "" : val(f, f.total)]),
    ],
  }];
}

const deMes = (meses) => (meses.length ? `${nombreMes(meses[0])} a ${nombreMes(meses[meses.length - 1])}` : "");

/** Las filas del cuadro resumido: secciones, resultados y sus % (26/11). */
const RESUMIDO = new Set(["seccion", "resultado", "pct"]);

/** El cuadro del Estado de Resultados con los colores de la pantalla (26/11): verde suma, rojo resta. */
function tablaResultados({ meses, filas }) {
  const celda = (f, v) => {
    if (v == null) return "";
    if (f.tipo === "pct") return esc(pctTxt(v));
    const ver = importeVisible(f, v);
    return Math.abs(ver) >= 0.5 ? miles(ver) : "–";
  };
  const clase = (f, v) => ({ suma: " verde", resta: " rojo" })[efectoDe(f, v)] || "";
  return `<table><thead><tr><th>Concepto</th>${meses.map((m) => `<th class="n">${esc(nombreMes(m))}</th>`).join("")}<th class="n">Total</th></tr></thead><tbody>
${filas.map((f) => `<tr class="${CLASE[f.tipo] ?? "sub"}"><td>${esc(f.nombre)}</td>${f.valores.map((v) => `<td class="n${clase(f, v)}">${celda(f, v)}</td>`).join("")}<td class="n${clase(f, f.total)}"><b>${celda(f, f.total)}</b></td></tr>`).join("\n")}
</tbody></table>`;
}

function hojaResultados(nombre, titulo, subtitulo, { meses, filas }) {
  const fuerte = (f) => f.tipo === "seccion" || f.tipo === "resultado";
  const val = (f, v) => {
    if (v == null) return "";
    if (f.tipo === "pct") return `${String(v).replace(".", ",")} %`;
    const efecto = efectoDe(f, v);
    const estilo = efecto === "suma" ? (fuerte(f) ? ESTILO.numeroVerdeNegrita : ESTILO.numeroVerde)
      : efecto === "resta" ? (fuerte(f) ? ESTILO.numeroRojoNegrita : ESTILO.numeroRojo)
        : fuerte(f) ? ESTILO.numeroNegrita : ESTILO.numero;
    return { v: Math.round((Number(importeVisible(f, v)) || 0) * 100) / 100, estilo };
  };
  return {
    nombre,
    anchos: [44, ...meses.map(() => 14), 16],
    filas: [
      [T(titulo)], [subtitulo], ["Verde: suma al resultado · Rojo: resta"], [],
      [B("Concepto"), ...meses.map((m) => B(nombreMes(m))), B("Total")],
      ...filas.map((f) => [fuerte(f) ? B(f.nombre) : `${f.tipo === "linea" || f.tipo === "pct" ? "    " : "  "}${f.nombre}`, ...f.valores.map((v) => val(f, v)), val(f, f.total)]),
    ],
  };
}

/**
 * 📊 Estado de Resultados, con lo que se ve en la pantalla (respuesta de
 * /api/finanzas/resultados), del lapso elegido con Desde/Hasta. 26/11
 * (pedido de Tadeo): el PDF trae primero el cuadro resumido y después el
 * completo, cada uno entero en su propia hoja (si no entra en una A4, la
 * hoja se alarga en vez de cortarlo); el Excel, una hoja de cada uno.
 */
export function informeResultados(d, { empresa = "" } = {}) {
  const titulo = `Estado de Resultados${d.division ? ` · ${d.division}` : ""}`;
  const subtitulo = `${deMes(d.meses || [])} · devengado, en pesos y sin IVA`;
  const filas = (d.filas || []).map((f) => ({ tipo: f.tipo, id: f.id, seccion: f.seccion, nombre: `${f.nombre}${f.entrega_estimada ? " (estimado)" : ""}`, valores: f.valores || [], total: f.total }));
  const completo = { meses: d.meses || [], filas };
  const resumido = { meses: d.meses || [], filas: filas.filter((f) => RESUMIDO.has(f.tipo)) };
  const nota = '<p class="dim">Verde: suma al resultado · Rojo: resta. Los resultados van con su signo (negativo = pérdida).</p>';
  return {
    titulo: `${titulo} - ${deMes(d.meses || [])}`,
    apaisado: true,
    paginaPorBloque: ".pagina",
    html: () => hojaInforme({
      titulo, subtitulo, empresa,
      // El concepto no se aprieta: si hay muchos meses, el PDF achica todo para que entre de costado
      cuerpo: `<style>.pagina th:first-child,.pagina td:first-child{min-width:240px}.pagina td.rojo{color:#c62828}.pagina td.verde{color:#15803d}</style><section class="pagina"><h2>Vista resumida</h2>${tablaResultados(resumido)}${nota}</section>`
        + `<section class="pagina"><h2>Vista completa</h2>${tablaResultados(completo)}${d.materiales_estimados ? '<p class="dim">* Materiales estimados: no hay costo real cargado.</p>' : ""}</section>`,
    }),
    hojas: () => [hojaResultados("Resumido", titulo, subtitulo, resumido), hojaResultados("Completo", titulo, subtitulo, completo)],
  };
}

/** 💵 Flujo de caja de una moneda (respuesta de /api/finanzas/flujo). */
export function informeFlujo(d, moneda = "ARS", { empresa = "" } = {}) {
  const m = d.monedas?.[moneda];
  const meses = d.meses || [];
  if (!m) return null;
  const neto = m.neto || [];
  const filas = [
    { tipo: "grupo", nombre: "Saldo al empezar el mes", valores: meses.map((_, i) => (i ? m.cierre[i - 1] : m.apertura)), total: null },
    ...(m.filas || []).map((f) => ({ tipo: f.tipo === "seccion" ? "seccion" : f.tipo === "linea" ? "grupo" : "cuenta", nombre: f.nombre, valores: f.valores || [], total: f.total })),
    { tipo: "resultado", nombre: "Flujo neto del mes", valores: neto, total: Math.round(neto.reduce((s, v) => s + v, 0) * 100) / 100 },
    { tipo: "grupo", nombre: "Saldo al cerrar el mes", valores: m.cierre || [], total: null },
  ];
  const titulo = `Flujo de caja${moneda === "USD" ? " en dólares" : ""}`;
  const subtitulo = `${deMes(meses)} · lo que entró y salió de cajas y bancos`;
  const t = { meses, filas };
  return {
    titulo: `${titulo} - ${deMes(meses)}`,
    apaisado: true,
    html: () => hojaInforme({ titulo, subtitulo, empresa, cuerpo: `<section>${tablaMensual(t)}</section>` }),
    hojas: () => hojaMensual("Flujo de caja", titulo, subtitulo, t),
  };
}

/** ⚖️ Situación patrimonial al día (datos.situacion de /api/finanzas/patrimonio). */
export function informePatrimonio(sit, hasta, { empresa = "" } = {}) {
  if (!sit) return null;
  const sec = (id) => sit.secciones.find((s) => s.id === id) || { nombre: "", total: 0, rubros: [] };
  const bloques = [
    { nombre: "Activo", secciones: [sec("AC"), sec("ANC")], total: ["Total del activo", sit.activo] },
    { nombre: "Pasivo", secciones: [sec("PC"), sec("PNC")], total: ["Total del pasivo", sit.pasivo] },
    { nombre: "Patrimonio neto", secciones: [sec("PN")], total: ["Pasivo + patrimonio neto", Math.round((sit.pasivo + sit.patrimonio) * 100) / 100] },
  ];
  const titulo = `Situación patrimonial al ${dma(hasta)}`;
  return {
    titulo,
    html: () => hojaInforme({
      titulo, empresa, subtitulo: "En pesos, del libro de Gypi",
      cuerpo: bloques.map((b) => `<section><h2>${esc(b.nombre)}</h2><table><tbody>
${b.secciones.map((s) => `<tr class="sec"><td>${esc(s.nombre)}</td><td class="n${rojo(s.total)}">${$(s.total)}</td></tr>
${s.rubros.map((r) => `<tr class="sub"><td>${esc(r.nombre)}</td><td class="n${rojo(r.saldo)}">${$(r.saldo)}</td></tr>`).join("\n")}`).join("\n")}
<tr class="tot"><td>${esc(b.total[0])}</td><td class="n">${$(b.total[1])}</td></tr>
</tbody></table></section>`).join("\n")
        + (sit.cuadra ? '<p class="dim">✓ El activo es igual al pasivo más el patrimonio.</p>' : `<p class="rojo">⚠ No cuadra por ${$(sit.diferencia)}.</p>`),
    }),
    hojas: () => [{
      nombre: "Situación patrimonial",
      anchos: [50, 18],
      filas: [
        [T(titulo)], empresa ? [empresa] : [], [],
        ...bloques.flatMap((b) => [
          [B(b.nombre.toUpperCase())],
          ...b.secciones.flatMap((s) => [[B(s.nombre), NB(s.total)], ...s.rubros.map((r) => [`    ${r.nombre}`, N(r.saldo)])]),
          [B(b.total[0]), NB(b.total[1])],
          [],
        ]),
      ],
    }],
  };
}

/**
 * 🏦 Flujo de cheques: por semana lo que se debita y lo que se acredita, y la
 * lista de los cheques vivos (propios por debitar y de terceros en cartera).
 * @param {{ calendario: ReturnType<import("./finanzasCheques").calendarioCheques>, cheques: object[], hoy: string, quien?: (c) => string }} d
 */
export function informeCheques({ calendario = [], cheques = [], hoy, quien = (c) => c.beneficiario || c.librador || "" }, { empresa = "" } = {}) {
  const vivos = cheques
    .filter((c) => (c.clase === "propio" && c.estado === "pendiente") || (c.clase === "tercero" && c.estado === "en_cartera"))
    .sort((a, b) => String(a.fecha_pago).localeCompare(String(b.fecha_pago)));
  const tramos = calendario.filter((t) => t.cantidad);
  const suma = (k) => Math.round(calendario.reduce((s, t) => s + t[k], 0) * 100) / 100;
  const titulo = `Flujo de cheques al ${dma(hoy)}`;
  const tipo = (c) => (c.clase === "propio" ? "Propio (se debita)" : "De terceros (en cartera)");
  return {
    titulo,
    html: () => hojaInforme({
      titulo, empresa, subtitulo: "Cheques propios por debitar y de terceros en cartera",
      cuerpo: `<div class="kpis"><div class="kpi"><span>Se debita</span><b>${$(suma("debitar"))}</b></div><div class="kpi"><span>Se acredita</span><b>${$(suma("cobrar"))}</b></div><div class="kpi"><span>Neto</span><b class="${suma("cobrar") - suma("debitar") < 0 ? "rojo" : "verde"}">${$(Math.round((suma("cobrar") - suma("debitar")) * 100) / 100)}</b></div></div>
<section><h2>Por semana</h2><table><thead><tr><th>Cuándo</th><th class="n">Cheques</th><th class="n">Se debita</th><th class="n">Se acredita</th><th class="n">Neto</th></tr></thead><tbody>
${tramos.map((t) => `<tr${t.etiqueta === "Vencidos" ? ' class="rojo"' : ""}><td>${esc(t.etiqueta)}</td><td class="n">${t.cantidad}</td><td class="n">${t.debitar ? $(t.debitar) : "–"}</td><td class="n">${t.cobrar ? $(t.cobrar) : "–"}</td><td class="n${rojo(t.cobrar - t.debitar)}">${$(Math.round((t.cobrar - t.debitar) * 100) / 100)}</td></tr>`).join("\n")}
<tr class="tot"><td>Total</td><td class="n">${vivos.length}</td><td class="n">${$(suma("debitar"))}</td><td class="n">${$(suma("cobrar"))}</td><td class="n">${$(Math.round((suma("cobrar") - suma("debitar")) * 100) / 100)}</td></tr>
</tbody></table></section>
<section><h2>Cada cheque</h2><table><thead><tr><th>Vence</th><th>Tipo</th><th>Banco y número</th><th>De / para</th><th class="n">Importe</th></tr></thead><tbody>
${vivos.map((c) => `<tr${c.fecha_pago < hoy ? ' class="rojo"' : ""}><td>${esc(dma(c.fecha_pago))}</td><td>${esc(tipo(c))}</td><td>${esc([c.banco, c.numero ? `N° ${c.numero}` : ""].filter(Boolean).join(" "))}</td><td>${esc(quien(c))}</td><td class="n">${$(c.importe)}</td></tr>`).join("\n")}
</tbody></table></section>`,
    }),
    hojas: () => [
      {
        nombre: "Por semana",
        anchos: [22, 10, 18, 18, 18],
        filas: [
          [T(titulo)], empresa ? [empresa] : [], [],
          [B("Cuándo"), B("Cheques"), B("Se debita"), B("Se acredita"), B("Neto")],
          ...tramos.map((t) => [t.etiqueta, t.cantidad, N(t.debitar), N(t.cobrar), N(t.cobrar - t.debitar)]),
          [B("Total"), vivos.length, NB(suma("debitar")), NB(suma("cobrar")), NB(suma("cobrar") - suma("debitar"))],
        ],
      },
      {
        nombre: "Cheques",
        anchos: [12, 24, 26, 34, 16],
        filas: [
          [B("Vence"), B("Tipo"), B("Banco y número"), B("De / para"), B("Importe")],
          ...vivos.map((c) => [F(c.fecha_pago), tipo(c), [c.banco, c.numero ? `N° ${c.numero}` : ""].filter(Boolean).join(" "), quien(c), N(c.importe)]),
        ],
      },
    ],
  };
}
