// app/lib/informePdf.js — Informe de producción en PDF (Tadeo, 29/10): el
// mismo informe que sale solo cada noche, con lo que hay hasta el momento,
// en una sola hoja A4 con gráficos (Tadeo, 30/10: claro y conciso). Se abre
// en una pestaña con la ventana de imprimir ("Guardar como PDF"), como las
// órdenes de compra. Con el informe del día va una línea con el reporte del
// día (piezas escaneadas, etapas terminadas o firmadas, instalación y OT
// atrasadas).
import { ETAPAS_PLAN } from "./planificacion";
import { partesNota } from "./informeProduccion";
import { fechaCorta } from "./ot";

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

/** Planificado (gris) y hecho (naranja) por OT, con el desvío y las marcas a la derecha. */
export function svgPorOt(ots) {
  const lista = otsDeLaHoja(ots);
  if (!lista.length) return "";
  const alto = 16, x0 = 92, ancho = 190;
  const marcas = (o) => (o.fueraDelPlan ? "🆕 fuera del plan" : [o.tarde && (o.diasTarde > 0 ? `⚠ ${o.diasTarde} d tarde` : "⚠ tarde"), o.diasCorrido > 0 && `↪ ${o.diasCorrido} d`].filter(Boolean).join(" "));
  return `<svg class="porot" viewBox="0 0 400 ${lista.length * alto + 12}" role="img" aria-label="Planificado y hecho por OT">
    ${[0, 50, 100].map((p) => `<line x1="${x0 + (ancho * p) / 100}" x2="${x0 + (ancho * p) / 100}" y1="0" y2="${lista.length * alto}" class="grilla" />
      <text x="${x0 + (ancho * p) / 100}" y="${lista.length * alto + 9}" text-anchor="middle" class="t-eje">${p} %</text>`).join("")}
    ${lista.map((o, i) => `
      <text x="0" y="${i * alto + 7}" class="t-ot">OT ${esc(o.ot)}</text>
      <text x="0" y="${i * alto + 14}" class="t-cli">${esc(String(o.cliente || "").slice(0, 24))}</text>
      <rect x="${x0}" y="${i * alto + 1}" width="${(ancho * lim(o.planificado)) / 100}" height="5.5" rx="2" class="b-plan" />
      <rect x="${x0}" y="${i * alto + 7.5}" width="${(ancho * lim(o.hecho)) / 100}" height="5.5" rx="2" class="b-hecho" />
      <text x="${x0 + ancho + 34}" y="${i * alto + 10}" text-anchor="end" class="t-num ${o.fueraDelPlan ? "" : o.desvio < 0 ? "mal" : "bien"}">${o.fueraDelPlan ? `+${coma(o.hecho)} %` : `${o.desvio > 0 ? "+" : ""}${coma(o.desvio)}`}</text>
      <text x="${x0 + ancho + 40}" y="${i * alto + 10}" class="t-marca">${esc(marcas(o))}</text>`).join("")}
  </svg>`;
}

/** Horas planificadas y hechas de cada proceso, sumando las OT. */
export function horasPorProceso(ots) {
  return ETAPAS_PLAN.map(({ id, nombre }) => {
    const qs = ots.flatMap((o) => o.procesos.filter((q) => q.etapa === id));
    return {
      id, nombre,
      plan: qs.reduce((t, q) => t + (Number(q.horasPlan) || 0), 0),
      hecho: qs.reduce((t, q) => t + ((Number(q.hecho) || 0) / 100) * (Number(q.horas) || 0), 0),
    };
  }).filter((p) => p.plan > 0 || p.hecho > 0);
}

/** Barras por proceso: horas planificadas y hechas. */
function svgPorProceso(ots) {
  const procs = horasPorProceso(ots);
  if (!procs.length) return "";
  const max = Math.max(1, ...procs.flatMap((p) => [p.plan, p.hecho]));
  const alto = 22, x0 = 58, ancho = 82;
  return `<svg class="porproc" viewBox="0 0 200 ${procs.length * alto}" role="img" aria-label="Horas por proceso">
    ${procs.map((p, i) => `
      <text x="0" y="${i * alto + 13}" class="t-label">${esc(p.nombre)}</text>
      <rect x="${x0}" y="${i * alto + 3}" width="${(ancho * p.plan) / max}" height="7" rx="2" class="b-plan" />
      <rect x="${x0}" y="${i * alto + 11}" width="${(ancho * p.hecho) / max}" height="7" rx="2" class="b-hecho" />
      <text x="200" y="${i * alto + 14}" text-anchor="end" class="t-num">${coma(p.hecho)} / ${coma(p.plan)} h</text>`).join("")}
  </svg>`;
}

const lista = (ots, n = 3) => ots.slice(0, n).map((o) => `OT ${o.ot}`).join(", ") + (ots.length > n ? ` y ${ots.length - n} más` : "");

/** Lo importante en pocas líneas (Tadeo, 30/10: claro y conciso, en una hoja). */
export function puntosClave(r, reporteDia = null) {
  const s = r.resumen;
  const puntos = [];
  if (s.horasPlan > 0) {
    // Lo cumplido no cuenta lo adelantado de más en cada proceso; eso va aparte
    const cumplidas = (s.cumplimiento / 100) * s.horasPlan;
    const extra = s.horasHechas - cumplidas >= 0.5 ? ` En total se hicieron ${coma(s.horasHechas)} h.` : "";
    puntos.push({ tono: tono(r.nota), texto: `Cumplimiento ${coma(s.cumplimiento)} %: se cumplieron ${coma(cumplidas)} h de las ${coma(s.horasPlan)} h planificadas.${extra}` });
  }
  else puntos.push({ tono: "neutro", texto: "No había nada planificado en el período." });
  const atrasadas = r.ots.filter((o) => !o.fueraDelPlan && o.desvio <= -10);
  if (atrasadas.length) puntos.push({ tono: "mal", texto: `Atrasadas contra el plan: ${atrasadas.slice(0, 3).map((o) => `OT ${o.ot} (${coma(o.desvio)} %)`).join(", ")}${atrasadas.length > 3 ? ` y ${atrasadas.length - 3} más` : ""}.` });
  const fuera = r.ots.filter((o) => o.fueraDelPlan);
  if (fuera.length) puntos.push({ tono: "medio", texto: `Producción fuera del plan: ${lista(fuera)} (no cuenta en el cumplimiento).` });
  const tarde = r.ots.filter((o) => o.tarde);
  if (s.otsTarde) puntos.push({ tono: "mal", texto: `${s.otsTarde} de ${s.otsAbiertas} OT terminan después de su semana${tarde.length ? `: ${lista(tarde)}` : ""}.` });
  if (s.procesosCorridos) puntos.push({ tono: "medio", texto: `${s.procesosCorridos} de ${s.procesosAbiertos} procesos se corrieron del plan confirmado.` });
  if (reporteDia) {
    const d = reporteDia;
    puntos.push({ tono: "neutro", texto: `Hoy: ${d.piezasHoy} pieza${d.piezasHoy === 1 ? "" : "s"} escaneada${d.piezasHoy === 1 ? "" : "s"}, ${d.etapasCerradas.length} etapa${d.etapasCerradas.length === 1 ? "" : "s"} terminada${d.etapasCerradas.length === 1 ? "" : "s"} o firmada${d.etapasCerradas.length === 1 ? "" : "s"}, ${d.instalaciones.length} reporte${d.instalaciones.length === 1 ? "" : "s"} de instalación${d.atrasadas.length ? `, ${d.atrasadas.length} OT atrasada${d.atrasadas.length === 1 ? "" : "s"} contra la entrega` : ""}.` });
  }
  if (puntos.length === 1 && s.horasPlan > 0 && !atrasadas.length) puntos.push({ tono: "bien", texto: "Ninguna OT atrasada contra el plan." });
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
  .hoja { max-height: 276mm; overflow: hidden; }
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
  .partes, .porot, .porproc { width: 100%; display: block; }
  .b-fondo { fill: #e7e5e4; } .b-plan { fill: #a8a29e; } .b-hecho { fill: #e8a33c; }
  .grilla { stroke: #e7e5e4; stroke-width: .5; }
  .t-label { font-size: 8px; fill: #44403c; } .t-num { font-size: 8px; font-weight: 700; fill: #1c1917; } .t-eje { font-size: 6.5px; fill: #78716c; }
  .t-ot { font-size: 8px; font-weight: 700; fill: #1c1917; } .t-cli { font-size: 6.5px; fill: #78716c; } .t-marca { font-size: 7px; fill: #b45309; }
  text.mal { fill: #dc2626; } text.bien { fill: #16a34a; }
  .formula { margin-top: 1mm; font-size: 7.5pt; color: #78716c; }
  ul.puntos { list-style: none; margin: 0; padding: 0; }
  .puntos li { padding: 1mm 0 1mm 3mm; border-left: 1.2mm solid #a8a29e; margin-bottom: 1.2mm; font-size: 9pt; line-height: 1.3; }
  .puntos li.mal { border-color: #dc2626; } .puntos li.medio { border-color: #d97706; } .puntos li.bien { border-color: #16a34a; }
  .dos { display: grid; grid-template-columns: 1.15fr 1fr; gap: 6mm; align-items: start; }
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
      <div class="formula">La nota parte de 0 y suma: hasta 7 puntos por cumplimiento, hasta 2 por OT en su semana y hasta 1 por procesos sin correrse.</div>
    </div>
  </div>

  <div class="dos">
    <div><h2>Lo importante</h2>
      <ul class="puntos">${puntosClave(r, reporteDia).map((x) => `<li class="${x.tono}">${esc(x.texto)}</li>`).join("")}</ul></div>
    ${r.ots.length ? `<div><h2>Horas por proceso</h2><div class="leyenda"><i class="l-plan"></i>planificadas <i class="l-hecho"></i>hechas</div>${svgPorProceso(r.ots)}</div>` : ""}
  </div>

  ${r.ots.length ? `
  <h2>Por OT · ${r.ots.length}</h2>
  <div class="leyenda"><i class="l-plan"></i>planificado <i class="l-hecho"></i>hecho · número: hecho − planificado, en % · primero las más atrasadas${resto > 0 ? ` · las otras ${resto} están en Gypi` : ""}</div>
  ${svgPorOt(r.ots)}` : ""}

  <div class="pie">Planificado: horas del plan confirmado en el período. Hecho: piezas escaneadas, checkeo manual o etapa firmada. El detalle por proceso de cada OT está en Gypi, en Reportes → Producción.</div>
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
