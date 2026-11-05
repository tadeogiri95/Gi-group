// app/lib/informePdf.js — Informe de producción en PDF (Tadeo, 29/10): el
// mismo informe que sale solo cada noche, con lo que hay hasta el momento,
// en una sola hoja A4 con gráficos (Tadeo, 30/10: claro y conciso). Se abre
// en una pestaña con la ventana de imprimir ("Guardar como PDF"), como las
// órdenes de compra. Con el informe del día va una línea con el reporte del
// día (piezas escaneadas, etapas terminadas o firmadas, instalación y OT
// atrasadas). Tadeo, 05/11: salía cortado; ahora las OT van cortas en "Lo
// importante", Por OT es una tabla de un renglón y nada se esconde (si un
// día no entra, sigue en la segunda hoja sin partir renglones).
import { ETAPAS_PLAN } from "./planificacion";
import { partesNota } from "./informeProduccion";
import { fechaCorta } from "./ot";
import { partesOt, textoOt } from "./nombreOt";

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));
const coma = (n) => (n == null ? "—" : String(Math.round(Number(n) * 10) / 10).replace(".", ","));
const urlSegura = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);
const lim = (x) => Math.max(0, Math.min(100, Number(x) || 0));
const MAX_OT = 14;

const NOMBRE_PERIODO = { dia: "del día", semana: "de la semana", mes: "del mes" };
const tono = (n) => (n == null ? "neutro" : n >= 7 ? "bien" : n >= 5 ? "medio" : "mal");

/** Medio círculo con la nota (de 0 a 10). */
export function svgNota(nota) {
  const pct = nota == null ? 0 : lim(nota * 10);
  return `<svg class="gauge" viewBox="0 0 120 70" role="img" aria-label="Nota ${coma(nota)} sobre 10">
    <path d="M10 62 A50 50 0 0 1 110 62" pathLength="100" class="g-fondo" />
    <path d="M10 62 A50 50 0 0 1 110 62" pathLength="100" class="g-valor gv-${tono(nota)}" stroke-dasharray="${pct} 100" />
    <text x="60" y="56" text-anchor="middle" class="g-num gn-${tono(nota)}">${nota == null ? "—" : coma(nota)}</text>
    <text x="60" y="68" text-anchor="middle" class="g-sub">sobre 10</text>
  </svg>`;
}

/** Barras de los puntos que suma cada parte de la nota (hasta 7, 2 y 1). */
function svgPartes(s) {
  const filas = partesNota(s);
  const alto = 22, ancho = 330;
  return `<svg class="partes" viewBox="0 0 400 ${filas.length * alto}" role="img" aria-label="Partes de la nota">
    ${filas.map((p, i) => `
      <text x="0" y="${i * alto + 9}" class="t-label">${esc(p.label)}: ${p.pct == null ? "—" : `${coma(p.pct)} %`}</text>
      <rect x="0" y="${i * alto + 12}" width="${(ancho * p.max) / 7}" height="7" rx="3.5" class="b-fondo" />
      <rect x="0" y="${i * alto + 12}" width="${(ancho * (p.puntos || 0)) / 7}" height="7" rx="3.5" class="b-hecho" />
      <text x="400" y="${i * alto + 19}" text-anchor="end" class="t-num">+${p.puntos == null ? "—" : coma(p.puntos)} de ${p.max}</text>`).join("")}
  </svg>`;
}

/** Las OT que entran en la hoja: las más atrasadas y, al final, las de fuera del plan (hasta 4). */
export function otsDeLaHoja(ots) {
  const fuera = ots.filter((o) => o.fueraDelPlan).slice(0, 4);
  const plan = ots.filter((o) => !o.fueraDelPlan).slice(0, MAX_OT - fuera.length);
  return [...plan, ...ots.filter((o) => o.fueraDelPlan).slice(0, MAX_OT - plan.length)];
}

/** Lo que va a la derecha de cada OT: fuera del plan, tarde, corrida y retrabajo. */
const marcasOt = (o) => [o.fueraDelPlan ? "🆕 fuera del plan" : [o.tarde && (o.diasTarde > 0 ? `⚠ ${o.diasTarde} d tarde` : "⚠ tarde"), o.diasCorrido > 0 && `↪ ${o.diasCorrido} d`].filter(Boolean).join(" "),
  o.retrabajo > 0 && `🔁 ${coma(o.retrabajo)} h`].filter(Boolean).join(" ");

/** Tabla por OT, un renglón cada una: planificado (gris) y hecho (naranja), "hecho de planificado" y las marcas. */
export function svgPorOt(ots) {
  const filas = otsDeLaHoja(ots);
  if (!filas.length) return "";
  const barra = (o) => `<svg class="mini" viewBox="0 0 100 12" aria-hidden="true">
    <rect x="0" y="0" width="${lim(o.planificado)}" height="5" rx="1.5" class="b-plan" /><rect x="0" y="6.5" width="${lim(o.hecho)}" height="5" rx="1.5" class="b-hecho" /></svg>`;
  return `<table class="porot" aria-label="Planificado y hecho por OT"><thead><tr><th>OT</th><th>Obra · descripción</th><th class="c-barra">Avance</th><th class="num">Hecho</th><th>Marcas</th></tr></thead><tbody>
    ${filas.map((o) => { const { proyecto, descripcion } = partesOt(o); return `<tr>
      <td class="c-ot">${esc(otCorta(o))}</td>
      <td class="c-obra">${esc(corto([proyecto, descripcion].filter(Boolean).join(" · "), 46))}</td>
      <td class="c-barra">${barra(o)}</td>
      <td class="num ${o.fueraDelPlan ? "" : o.hecho < o.planificado ? "mal" : "bien"}">${o.fueraDelPlan ? `${coma(o.hecho)} %` : `${coma(o.hecho)} de ${coma(o.planificado)} %`}</td>
      <td class="c-marca">${esc(marcasOt(o))}</td></tr>`; }).join("")}
  </tbody></table>`;
}

/** Avance de cada proceso: promedio de lo planificado y de lo hecho en las OT que lo tienen. */
export function avancePorProceso(ots) {
  return ETAPAS_PLAN.map(({ id, nombre }) => {
    const qs = ots.flatMap((o) => o.procesos.filter((q) => q.etapa === id));
    const prom = (campo) => (qs.length ? qs.reduce((t, q) => t + (Number(q[campo]) || 0), 0) / qs.length : 0);
    return { id, nombre, ots: qs.length, plan: prom("planificado"), hecho: prom("hecho") };
  }).filter((p) => p.ots > 0);
}

/** Barras por proceso: % de avance planificado y hecho (promedio de sus OT). */
function svgPorProceso(ots) {
  const procs = avancePorProceso(ots);
  if (!procs.length) return "";
  const alto = 22, x0 = 58, ancho = 82;
  return `<svg class="porproc" viewBox="0 0 200 ${procs.length * alto}" role="img" aria-label="Avance por proceso">
    ${procs.map((p, i) => `
      <text x="0" y="${i * alto + 9}" class="t-label">${esc(p.nombre)}</text>
      <text x="0" y="${i * alto + 17}" class="t-cli">${p.ots} OT</text>
      <rect x="${x0}" y="${i * alto + 3}" width="${(ancho * lim(p.plan)) / 100}" height="7" rx="2" class="b-plan" />
      <rect x="${x0}" y="${i * alto + 11}" width="${(ancho * lim(p.hecho)) / 100}" height="7" rx="2" class="b-hecho" />
      <text x="200" y="${i * alto + 14}" text-anchor="end" class="t-num ${p.hecho < p.plan ? "mal" : "bien"}">${coma(p.hecho)} de ${coma(p.plan)} %</text>`).join("")}
  </svg>`;
}

// Cada OT completa: Código · Cliente · Proyecto · Descripción (Tadeo, 02/11)
const corto = (t, n) => (t = String(t ?? ""), t.length > n ? `${t.slice(0, n - 1)}…` : t);
// En la hoja la OT va corta (código · cliente): el detalle completo está en Gypi y en la tabla Por OT
export const otCorta = (o) => { const { codigo, cliente } = partesOt(o); return [codigo ? `OT ${codigo}` : "", corto(cliente, 22)].filter(Boolean).join(" · ") || textoOt(o); };
const mas = (total, n) => (total > n ? ` y ${total - n} más` : "");
const lista = (ots, n = 2, f = otCorta) => ots.slice(0, n).map(f).join(", ") + mas(ots.length, n);

/** Lo importante en pocas líneas (Tadeo, 30/10: claro y conciso, en una hoja). */
export function puntosClave(r, reporteDia = null) {
  const s = r.resumen;
  const puntos = [];
  const hayPlan = s.cumplimiento != null;
  if (hayPlan) puntos.push({ tono: tono(r.nota), texto: `Cumplimiento ${coma(s.cumplimiento)} %: se hizo ese % del avance planificado. ${s.procesosCumplidos} de ${s.procesosPlanificados} procesos planificados llegaron a lo previsto.` });
  else puntos.push({ tono: "neutro", texto: "No había nada planificado en el período." });
  const atrasadas = r.ots.filter((o) => !o.fueraDelPlan && !o.enPausa && o.desvio <= -10);
  if (atrasadas.length) puntos.push({ tono: "mal", texto: `Más atrasadas contra el plan: ${lista(atrasadas, 2, (o) => `${otCorta(o)} (hizo ${coma(o.hecho)} % de ${coma(o.planificado)} %)`)}.` });
  const fuera = r.ots.filter((o) => o.fueraDelPlan);
  if (fuera.length) puntos.push({ tono: "medio", texto: `Producción fuera del plan: ${lista(fuera)} (no cuenta en el cumplimiento).` });
  const tarde = r.ots.filter((o) => o.tarde);
  if (s.otsTarde) puntos.push({ tono: "mal", texto: `${s.otsTarde} de ${s.otsAbiertas} OT terminan después de su fecha límite${tarde.length ? `: ${lista(tarde)}` : ""}.` });
  // OT en pausa (151): lo planificado esos días no cuenta en la nota
  const pausa = r.enPausa || [];
  if (pausa.length) puntos.push({ tono: "neutro", texto: `⏸ En pausa: ${lista(pausa, 2, (p) => `${otCorta(p)} (${corto(p.motivo, 30)})`)}. Lo planificado en la pausa no cuenta en la nota.` });
  const rt = r.retrabajos || [];
  if (rt.length) {
    // Retrabajo (147): por OT y proceso, con el motivo
    const grupos = new Map();
    for (const x of rt) {
      const k = `${x.ot}|${x.etapa}`;
      const g = grupos.get(k) || { ot: x.ot, cliente: x.cliente, obra: x.obra, descripcion: x.descripcion, nombre: x.nombre, horas: 0, motivos: new Set() };
      g.horas += x.horas;
      g.motivos.add(x.motivo);
      grupos.set(k, g);
    }
    const gs = [...grupos.values()].sort((a, b) => b.horas - a.horas);
    puntos.push({ tono: "mal", texto: `🔁 Retrabajo: ${coma(s.horasRetrabajo)} h. ${gs.slice(0, 2).map((g) => `${otCorta(g)}: ${g.nombre} ${coma(g.horas)} h (${corto([...g.motivos].join(", "), 40)})`).join("; ")}${mas(gs.length, 2)}.` });
  }
  const lt = r.leadTime;
  if (lt?.promedios?.length) {
    // Lead time en horas de trabajo de lo que terminó en el período
    const terminadas = lt.ots.filter((o) => o.horas != null);
    const procs = lt.promedios.filter((x) => x.etapa !== "ot").map((x) => `${x.nombre} ${coma(x.promedio)} h`);
    puntos.push({ tono: "neutro", texto: `⏱ Lead time en horas de trabajo: ${procs.join(", ")}.${terminadas.length ? ` OT terminadas: ${lista(terminadas, 2, (o) => `${otCorta(o)} en ${coma(o.horas)} h`)}.` : ""}` });
  }
  if (s.procesosCorridos) puntos.push({ tono: "medio", texto: `${s.procesosCorridos} de ${s.procesosAbiertos} procesos se corrieron del plan confirmado.` });
  if (reporteDia) {
    const d = reporteDia;
    puntos.push({ tono: "neutro", texto: `Hoy: ${d.piezasHoy} pieza${d.piezasHoy === 1 ? "" : "s"} escaneada${d.piezasHoy === 1 ? "" : "s"}, ${d.etapasCerradas.length} etapa${d.etapasCerradas.length === 1 ? "" : "s"} terminada${d.etapasCerradas.length === 1 ? "" : "s"} o firmada${d.etapasCerradas.length === 1 ? "" : "s"}, ${d.instalaciones.length} reporte${d.instalaciones.length === 1 ? "" : "s"} de instalación${d.atrasadas.length ? `, ${d.atrasadas.length} OT atrasada${d.atrasadas.length === 1 ? "" : "s"} contra la entrega` : ""}.` });
  }
  if (puntos.length === 1 && hayPlan && !atrasadas.length) puntos.push({ tono: "bien", texto: "Ninguna OT atrasada contra el plan." });
  return puntos;
}

/**
 * La hoja A4 del informe (una sola), lista para imprimir o guardar en PDF.
 * @param {{ empresa?: object, informe: object, reporteDia?: object|null, ahora?: Date, guardado?: string|null }} datos
 */
export function htmlInformePdf({ empresa = {}, informe: r, reporteDia = null, ahora = new Date(), guardado = null }) {
  const s = r.resumen;
  const logo = urlSegura(empresa?.logo_url);
  const nombreEmpresa = empresa?.razon_social || empresa?.nombre || empresa?.nombre_corto || "";
  const p = r.periodo;
  const periodo = p.tipo === "dia" ? fechaCorta(p.desde) : `del ${fechaCorta(p.desde)} al ${fechaCorta(p.hasta)}`;
  const tz = { timeZone: "America/Argentina/Buenos_Aires" };
  const hora = `${ahora.toLocaleDateString("es-AR", { ...tz, day: "2-digit", month: "2-digit", year: "numeric" })} a las ${ahora.toLocaleTimeString("es-AR", { ...tz, hour: "2-digit", minute: "2-digit", hour12: false })}`;
  const cuando = guardado ? "Informe guardado al cerrar el día" : `Parcial: con lo que hay hasta el ${hora}`;
  const resto = r.ots.length - otsDeLaHoja(r.ots).length;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de producción ${esc(NOMBRE_PERIODO[p.tipo] || "")} ${esc(periodo)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #1c1917; font-size: 10pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Entra en una hoja; si hay mucho, sigue en la segunda sin cortar renglones (Tadeo, 05/11: nada a medias) */
  .resumen, .puntos li, .porot tr, .porproc { break-inside: avoid; }
  thead { display: table-header-group; }
  .cabecera { display: flex; justify-content: space-between; align-items: center; gap: 6mm; border-bottom: .6mm solid #e8a33c; padding-bottom: 2mm; margin-bottom: 3mm; }
  .cabecera img { max-height: 11mm; max-width: 35mm; object-fit: contain; display: block; }
  .quien { display: flex; align-items: center; gap: 3mm; }
  .empresa { font-weight: 700; }
  h1 { font-size: 15pt; margin: 0; text-align: right; }
  h2 { font-size: 11pt; margin: 4mm 0 1.5mm; color: #9a3412; }
  .chico { font-size: 8pt; color: #57534e; }
  .derecha { text-align: right; }
  .resumen { display: grid; grid-template-columns: 38mm 1fr; gap: 5mm; align-items: center; background: #faf7f2; border: .3mm solid #e7e5e4; border-radius: 3mm; padding: 3mm 4mm; }
  .gauge { width: 36mm; display: block; }
  .g-fondo { fill: none; stroke: #e7e5e4; stroke-width: 10; stroke-linecap: round; }
  .g-valor { fill: none; stroke-width: 10; stroke-linecap: round; }
  .gv-bien { stroke: #16a34a; } .gv-medio { stroke: #d97706; } .gv-mal { stroke: #dc2626; } .gv-neutro { stroke: #a8a29e; }
  .g-num { font-size: 22px; font-weight: 800; fill: #1c1917; } .gn-bien { fill: #16a34a; } .gn-medio { fill: #d97706; } .gn-mal { fill: #dc2626; }
  .g-sub { font-size: 7px; fill: #78716c; }
  .partes, .porproc { width: 100%; display: block; }
  table.porot { width: 100%; border-collapse: collapse; font-size: 8pt; table-layout: fixed; }
  .porot th { text-align: left; font-size: 7pt; font-weight: 600; color: #78716c; border-bottom: .3mm solid #d6d3d1; padding: .6mm 1mm; }
  .porot td { padding: .7mm 1mm; border-bottom: .2mm solid #f0eeec; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
  .porot th:nth-child(1) { width: 46mm; } .porot th:nth-child(3) { width: 28mm; } .porot th:nth-child(4) { width: 22mm; } .porot th:nth-child(5) { width: 32mm; }
  .c-ot { font-weight: 700; } .c-obra { color: #78716c; font-size: 7pt; } .c-marca { color: #b45309; font-size: 7pt; }
  .num { text-align: right; font-weight: 700; } td.mal { color: #dc2626; } td.bien { color: #16a34a; }
  .mini { width: 100%; height: 3mm; display: block; }
  .b-fondo { fill: #e7e5e4; } .b-plan { fill: #a8a29e; } .b-hecho { fill: #e8a33c; }
  .grilla { stroke: #e7e5e4; stroke-width: .5; }
  .t-label { font-size: 8px; fill: #44403c; } .t-num { font-size: 8px; font-weight: 700; fill: #1c1917; } .t-eje { font-size: 6.5px; fill: #78716c; }
  .t-ot { font-size: 8px; font-weight: 700; fill: #1c1917; } .t-cli { font-size: 6.5px; fill: #78716c; } .t-marca { font-size: 7px; fill: #b45309; }
  text.mal { fill: #dc2626; } text.bien { fill: #16a34a; }
  .formula { margin-top: 1mm; font-size: 7.5pt; color: #78716c; }
  ul.puntos { list-style: none; margin: 0; padding: 0; }
  .puntos li { padding: .6mm 0 .6mm 2.5mm; border-left: 1.2mm solid #a8a29e; margin-bottom: 1mm; font-size: 8.5pt; line-height: 1.28; }
  .puntos li.mal { border-color: #dc2626; } .puntos li.medio { border-color: #d97706; } .puntos li.bien { border-color: #16a34a; }
  .dos { display: grid; grid-template-columns: 1.6fr 1fr; gap: 6mm; align-items: start; }
  .leyenda { font-size: 7.5pt; color: #57534e; margin-bottom: 1mm; }
  .leyenda i { display: inline-block; width: 3mm; height: 2mm; border-radius: .5mm; margin: 0 1mm 0 2mm; vertical-align: middle; }
  .l-plan { background: #a8a29e; } .l-hecho { background: #e8a33c; }
  .pie { margin-top: 3mm; font-size: 7pt; color: #78716c; }
</style></head><body><div class="hoja">
  <div class="cabecera">
    <div class="quien">
      ${logo ? `<img src="${esc(logo)}" alt="">` : ""}
      <div><div class="empresa">${esc(nombreEmpresa)}</div><div class="chico">${esc(cuando)}</div></div>
    </div>
    <div class="derecha">
      <h1>Informe de producción</h1>
      <div>${esc(NOMBRE_PERIODO[p.tipo] || "")} ${esc(periodo)}</div>
    </div>
  </div>

  <div class="resumen">
    ${svgNota(r.nota)}
    <div>
      ${svgPartes(s)}
      <div class="formula">La nota parte de 0 y suma: hasta 7 puntos por cumplimiento, hasta 2 por OT a tiempo y hasta 1 por procesos sin correrse.</div>
    </div>
  </div>

  <div class="dos">
    <div><h2>Lo importante</h2>
      <ul class="puntos">${puntosClave(r, reporteDia).map((x) => `<li class="${x.tono}">${esc(x.texto)}</li>`).join("")}</ul></div>
    ${r.ots.length ? `<div><h2>Avance por proceso</h2><div class="leyenda"><i class="l-plan"></i>planificado <i class="l-hecho"></i>hecho · promedio de sus OT</div>${svgPorProceso(r.ots)}</div>` : ""}
  </div>

  ${r.ots.length ? `
  <h2>Por OT · ${r.ots.length}</h2>
  <div class="leyenda"><i class="l-plan"></i>planificado <i class="l-hecho"></i>hecho · a la derecha: % hecho de lo planificado · primero las más atrasadas${resto > 0 ? ` · las otras ${resto} están en Gypi` : ""}</div>
  ${svgPorOt(r.ots)}` : ""}

  <div class="pie">Planificado: % de avance de cada proceso que el plan confirmado ponía en el período. Hecho: piezas escaneadas, checkeo manual o etapa firmada. El detalle por proceso de cada OT está en Gypi, en Reportes → Producción.</div>
</div></body></html>`;
}

/** Abre el informe en una pestaña nueva con la ventana de imprimir (ahí se elige "Guardar como PDF"). */
export function imprimirInforme(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(htmlInformePdf(datos));
  ventana.document.close();
  ventana.focus();
  // Espera el logo antes de imprimir
  setTimeout(() => ventana.print(), 600);
}
