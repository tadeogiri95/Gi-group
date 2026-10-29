// app/lib/informePdf.js — Informe de producción en PDF (Tadeo, 29/10): el
// mismo informe que sale solo cada noche, con lo que hay hasta el momento,
// en una hoja A4 con gráficos. Se abre en una pestaña con la ventana de
// imprimir ("Guardar como PDF"), como las órdenes de compra.
// Con el informe del día van también las secciones del reporte del día
// (piezas escaneadas, etapas terminadas o firmadas, instalación y OT atrasadas).
import { ETAPAS_PLAN } from "./planificacion";
import { explicacionNota, PESOS_NOTA } from "./informeProduccion";
import { fechaCorta } from "./ot";

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));
const coma = (n) => (n == null ? "—" : String(Math.round(Number(n) * 10) / 10).replace(".", ","));
const urlSegura = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);
const lim = (x) => Math.max(0, Math.min(100, Number(x) || 0));
const MAX_OT = 25;

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

/** Barras horizontales de las tres partes de la nota. */
function svgPartes(s) {
  const filas = [
    ["Cumplimiento de lo planificado", s.cumplimiento, PESOS_NOTA.cumplimiento],
    ["OT que llegan a su semana", s.enSemana, PESOS_NOTA.enSemana],
    ["Procesos sin correrse del plan", s.sinCorrimiento, PESOS_NOTA.sinCorrimiento],
  ];
  const alto = 22;
  return `<svg class="partes" viewBox="0 0 400 ${filas.length * alto}" role="img" aria-label="Partes de la nota">
    ${filas.map(([label, v, peso], i) => `
      <text x="0" y="${i * alto + 9}" class="t-label">${esc(label)} · pesa ${Math.round(peso * 100)} %</text>
      <rect x="0" y="${i * alto + 12}" width="340" height="7" rx="3.5" class="b-fondo" />
      <rect x="0" y="${i * alto + 12}" width="${3.4 * lim(v)}" height="7" rx="3.5" class="b-hecho" />
      <text x="400" y="${i * alto + 19}" text-anchor="end" class="t-num">${v == null ? "—" : `${coma(v)} %`}</text>`).join("")}
  </svg>`;
}

/** Planificado (gris) y hecho (naranja) por OT, con el desvío a la derecha. */
export function svgPorOt(ots) {
  const lista = ots.slice(0, MAX_OT);
  if (!lista.length) return "";
  const alto = 24, x0 = 110, ancho = 230;
  return `<svg class="porot" viewBox="0 0 400 ${lista.length * alto + 14}" role="img" aria-label="Planificado y hecho por OT">
    ${[0, 25, 50, 75, 100].map((p) => `<line x1="${x0 + (ancho * p) / 100}" x2="${x0 + (ancho * p) / 100}" y1="0" y2="${lista.length * alto}" class="grilla" />
      <text x="${x0 + (ancho * p) / 100}" y="${lista.length * alto + 11}" text-anchor="middle" class="t-eje">${p} %</text>`).join("")}
    ${lista.map((o, i) => `
      <text x="0" y="${i * alto + 10}" class="t-ot">OT ${esc(o.ot)}</text>
      <text x="0" y="${i * alto + 20}" class="t-cli">${esc(String(o.cliente || "").slice(0, 22))}</text>
      <rect x="${x0}" y="${i * alto + 3}" width="${(ancho * lim(o.planificado)) / 100}" height="7" rx="2" class="b-plan" />
      <rect x="${x0}" y="${i * alto + 12}" width="${(ancho * lim(o.hecho)) / 100}" height="7" rx="2" class="b-hecho" />
      <text x="400" y="${i * alto + 15}" text-anchor="end" class="t-num ${o.desvio < 0 ? "mal" : "bien"}">${o.desvio > 0 ? "+" : ""}${coma(o.desvio)} pts</text>`).join("")}
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

/** Columnas por proceso: horas planificadas y hechas. */
function svgPorProceso(ots) {
  const procs = horasPorProceso(ots);
  if (!procs.length) return "";
  const max = Math.max(1, ...procs.flatMap((p) => [p.plan, p.hecho]));
  const alto = 150, col = 400 / procs.length;
  return `<svg class="porproc" viewBox="0 0 400 ${alto + 42}" role="img" aria-label="Horas por proceso">
    <line x1="0" x2="400" y1="${alto}" y2="${alto}" class="grilla" />
    ${procs.map((p, i) => {
      const cx = i * col + col / 2;
      const hp = (alto - 14) * (p.plan / max), hh = (alto - 14) * (p.hecho / max);
      return `
      <rect x="${cx - 32}" y="${alto - hp}" width="30" height="${hp}" rx="2" class="b-plan" />
      <rect x="${cx + 2}" y="${alto - hh}" width="30" height="${hh}" rx="2" class="b-hecho" />
      <text x="${cx - 17}" y="${alto - hp - 4}" text-anchor="middle" class="t-eje">${coma(p.plan)}</text>
      <text x="${cx + 17}" y="${alto - hh - 4}" text-anchor="middle" class="t-eje">${coma(p.hecho)}</text>
      <text x="${cx}" y="${alto + 17}" text-anchor="middle" class="t-label">${esc(p.nombre)}</text>`;
    }).join("")}
    <text x="0" y="${alto + 36}" class="t-eje">Horas · gris: planificadas · naranja: hechas</text>
  </svg>`;
}

/** Desvío de cada OT: a la izquierda lo atrasado, a la derecha lo adelantado. */
function svgDesvios(ots) {
  const lista = ots.slice(0, MAX_OT);
  if (!lista.length) return "";
  const alto = 24, medio = 230, escala = 160 / Math.max(10, ...lista.map((o) => Math.abs(o.desvio)));
  return `<svg class="desvios" viewBox="0 0 400 ${lista.length * alto + 4}" role="img" aria-label="Desvío por OT">
    <line x1="${medio}" x2="${medio}" y1="0" y2="${lista.length * alto}" class="eje" />
    ${lista.map((o, i) => {
      const w = Math.abs(o.desvio) * escala;
      return `<text x="0" y="${i * alto + 15}" class="t-cli">OT ${esc(o.ot)}</text>
      <rect x="${o.desvio < 0 ? medio - w : medio}" y="${i * alto + 4}" width="${w}" height="14" rx="2" class="${o.desvio < 0 ? "b-mal" : "b-bien"}" />
      <text x="${o.desvio < 0 ? medio + 4 : medio - 4}" y="${i * alto + 15}" text-anchor="${o.desvio < 0 ? "start" : "end"}" class="t-eje">${o.desvio > 0 ? "+" : ""}${coma(o.desvio)}</text>`;
    }).join("")}
  </svg>`;
}

function tablaOts(ots) {
  return `<table class="tabla">
    <thead><tr><th>OT</th><th>Proceso</th><th class="n">Planificado</th><th class="n">Hecho</th><th class="n">Desvío</th><th class="n">Va</th></tr></thead>
    <tbody>${ots.map((o) => o.procesos.map((q, i) => `<tr${i === 0 ? ' class="primera"' : ""}>
      <td>${i === 0 ? `<b>OT ${esc(o.ot)}</b>${o.cliente ? `<div class="chico">${esc(o.cliente)}</div>` : ""}${o.tarde ? `<div class="chico mal">⚠ ${o.diasTarde} d después de su semana</div>` : ""}${o.diasCorrido > 0 ? `<div class="chico medio">↪ se corrió ${o.diasCorrido} d</div>` : ""}${o.fueraDelPlan ? `<div class="chico medio">🆕 fuera del plan</div>` : ""}` : ""}</td>
      <td>${esc(q.nombre)}${q.fueraDelPlan ? ` <span class="chico medio">· fuera del plan</span>` : ""}${q.fuente === "manual" ? ` <span class="chico">· a mano</span>` : ""}</td>
      <td class="n">${coma(q.planificado)} %</td>
      <td class="n">${coma(q.hecho)} %</td>
      <td class="n ${q.desvio < 0 ? "mal" : "bien"}">${q.desvio > 0 ? "+" : ""}${coma(q.desvio)}</td>
      <td class="n">${coma(q.alFinal)} %</td>
    </tr>`).join("")).join("")}</tbody>
  </table>`;
}

/** OT que avanzaron sin estar planificadas en el período (Tadeo, 29/10). */
function seccionFueraDelPlan(ots) {
  const fuera = ots.filter((o) => o.fueraDelPlan);
  if (!fuera.length) return "";
  return `<h2>🆕 Producción fuera del plan · ${fuera.length}</h2>
  <div class="leyenda">OT que avanzaron sin nada planificado en el período; no cuentan en el cumplimiento</div>
  <table class="tabla">
    <thead><tr><th>OT</th><th>Procesos que avanzaron</th><th class="n">Va</th></tr></thead>
    <tbody>${fuera.map((o) => `<tr>
      <td><b>OT ${esc(o.ot)}</b>${o.cliente ? `<div class="chico">${esc(o.cliente)}</div>` : ""}${o.enOtroPlan ? `<div class="chico">planificada otro día</div>` : ""}</td>
      <td>${o.procesos.filter((q) => q.hecho > 0).map((q) => `${esc(q.nombre)} +${coma(q.hecho)} %`).join(" · ")}</td>
      <td class="n">${coma(o.alFinal)} %</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

/** Lo del reporte del día (el que llega cada noche), si hay. */
function seccionesDia(r) {
  if (!r) return "";
  const ot = (o) => `<b>OT ${esc(o.ot)}</b>${o.cliente ? ` <span class="chico">· ${esc(o.cliente)}</span>` : ""}`;
  const nada = (t) => `<p class="chico">${t}</p>`;
  return `
  <h2>Reporte del día</h2>
  <div class="tiles">
    <div class="tile"><div class="tn">${r.piezasHoy}</div><div class="tl">piezas escaneadas</div></div>
    <div class="tile"><div class="tn">${r.completadas.length}</div><div class="tl">OT con producción terminada</div></div>
    <div class="tile"><div class="tn">${r.etapasCerradas.length}</div><div class="tl">etapas terminadas o firmadas</div></div>
    <div class="tile"><div class="tn">${r.instalaciones.length}</div><div class="tl">reportes de instalación</div></div>
  </div>
  <h3>Producción (% al empezar → ahora)</h3>
  ${r.produccion.length ? `<table class="tabla"><tbody>${r.produccion.map((o) => `<tr><td>${ot(o)}<div class="chico">${o.etapas.filter((e) => e.hoy > 0).map((e) => `${esc(e.nombre)}: ${e.hoy} pieza${e.hoy === 1 ? "" : "s"} (${e.pasaron} de ${e.total})`).join(" · ")}</div></td><td class="n">${o.antes ?? 0} % → <b>${o.despues ?? 0} %</b></td></tr>`).join("")}</tbody></table>` : nada("No se escanearon piezas.")}
  <h3>Etapas terminadas o firmadas</h3>
  ${r.etapasCerradas.length ? `<table class="tabla"><tbody>${r.etapasCerradas.map((x) => `<tr><td>${ot(x)} · ${esc(x.nombre)}</td><td class="n">${x.que === "firmada" ? "Firmada" : "Terminada, falta la firma"}</td></tr>`).join("")}</tbody></table>` : nada("Ninguna etapa se marcó ni se firmó.")}
  <h3>Instalación</h3>
  ${r.instalaciones.length ? `<table class="tabla"><tbody>${r.instalaciones.map((i) => `<tr><td>${ot(i)}<div class="chico">${[i.quien && esc(i.quien), `${i.modulos} módulo${i.modulos === 1 ? "" : "s"} colocado${i.modulos === 1 ? "" : "s"}`, i.pendientes?.length && `Pendientes: ${i.pendientes.map(esc).join("; ")}`, i.comentario && esc(i.comentario)].filter(Boolean).join(" · ")}</div></td><td class="n">${i.avance != null ? `${i.avance} %` : "—"}</td></tr>`).join("")}</tbody></table>` : nada("No hubo reportes de instalación.")}
  <h3>Atrasadas contra la fecha de entrega</h3>
  ${r.atrasadas.length ? `<table class="tabla"><tbody>${r.atrasadas.map((a) => `<tr><td>${ot(a)}</td><td class="n mal">${a.dias} día${a.dias === 1 ? "" : "s"}${a.porcentaje != null ? ` · ${a.porcentaje} %` : ""}</td></tr>`).join("")}</tbody></table>` : nada("Ninguna OT atrasada.")}`;
}

/**
 * La hoja A4 del informe, lista para imprimir o guardar en PDF.
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
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de producción ${esc(NOMBRE_PERIODO[p.tipo] || "")} ${esc(periodo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #1c1917; font-size: 10pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cabecera { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; border-bottom: .6mm solid #e8a33c; padding-bottom: 3mm; margin-bottom: 4mm; }
  .cabecera img { max-height: 16mm; max-width: 45mm; object-fit: contain; display: block; margin-bottom: 1.5mm; }
  .empresa { font-weight: 700; }
  h1 { font-size: 17pt; margin: 0; text-align: right; }
  h2 { font-size: 12.5pt; margin: 6mm 0 2mm; color: #9a3412; break-after: avoid; }
  h3 { font-size: 10.5pt; margin: 4mm 0 1.5mm; break-after: avoid; }
  .chico { font-size: 8.5pt; color: #57534e; }
  .derecha { text-align: right; }
  .resumen { display: grid; grid-template-columns: 48mm 1fr; gap: 6mm; align-items: center; background: #faf7f2; border: .3mm solid #e7e5e4; border-radius: 3mm; padding: 4mm; break-inside: avoid; }
  .gauge { width: 46mm; display: block; }
  .g-fondo { fill: none; stroke: #e7e5e4; stroke-width: 10; stroke-linecap: round; }
  .g-valor { fill: none; stroke-width: 10; stroke-linecap: round; }
  .gv-bien { stroke: #16a34a; } .gv-medio { stroke: #d97706; } .gv-mal { stroke: #dc2626; } .gv-neutro { stroke: #a8a29e; }
  .g-num { font-size: 22px; font-weight: 800; fill: #1c1917; } .gn-bien { fill: #16a34a; } .gn-medio { fill: #d97706; } .gn-mal { fill: #dc2626; }
  .g-sub { font-size: 7px; fill: #78716c; }
  .partes, .porot, .porproc, .desvios { width: 100%; display: block; }
  .b-fondo { fill: #e7e5e4; } .b-plan { fill: #a8a29e; } .b-hecho { fill: #e8a33c; } .b-mal { fill: #dc2626; } .b-bien { fill: #16a34a; }
  .grilla { stroke: #e7e5e4; stroke-width: .5; } .eje { stroke: #78716c; stroke-width: .7; }
  .t-label { font-size: 8px; fill: #44403c; } .t-num { font-size: 8.5px; font-weight: 700; fill: #1c1917; } .t-eje { font-size: 7px; fill: #78716c; }
  .t-ot { font-size: 8.5px; font-weight: 700; fill: #1c1917; } .t-cli { font-size: 7px; fill: #78716c; }
  text.mal { fill: #dc2626; } text.bien { fill: #16a34a; }
  .mal { color: #dc2626; } .bien { color: #16a34a; } .medio { color: #b45309; }
  .mitad .t-eje, .mitad .t-cli { font-size: 12px; } .mitad .t-label { font-size: 13px; }
  .explicacion { margin-top: 2mm; font-size: 8.5pt; color: #57534e; line-height: 1.4; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 3mm 0; break-inside: avoid; }
  .tile { border: .3mm solid #e7e5e4; border-radius: 2.5mm; padding: 2.5mm; }
  .tn { font-size: 15pt; font-weight: 800; } .tl { font-size: 8pt; color: #57534e; }
  .dos { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; break-inside: avoid; }
  .leyenda { font-size: 8pt; color: #57534e; margin-bottom: 1.5mm; }
  .leyenda i { display: inline-block; width: 3mm; height: 2mm; border-radius: .5mm; margin: 0 1mm 0 2mm; vertical-align: middle; }
  .l-plan { background: #a8a29e; } .l-hecho { background: #e8a33c; }
  table.tabla { border-collapse: collapse; width: 100%; font-size: 9pt; }
  .tabla th { text-align: left; border-bottom: .4mm solid #1c1917; padding: 1.2mm 1mm; font-size: 8.5pt; }
  .tabla th.n { text-align: right; }
  .tabla td { border-bottom: .2mm solid #e7e5e4; padding: 1.2mm 1mm; vertical-align: top; }
  .tabla tr.primera td { border-top: .3mm solid #a8a29e; }
  .tabla tr { break-inside: avoid; }
  .n { text-align: right; white-space: nowrap; }
  .pie { margin-top: 6mm; font-size: 8pt; color: #78716c; }
</style></head><body>
  <div class="cabecera">
    <div>
      ${logo ? `<img src="${esc(logo)}" alt="">` : ""}
      <div class="empresa">${esc(nombreEmpresa)}</div>
      <div class="chico">${esc(cuando)}</div>
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
      <div class="explicacion">${esc(explicacionNota(r))}</div>
    </div>
  </div>

  <div class="tiles">
    <div class="tile"><div class="tn">${s.ots}</div><div class="tl">OT trabajadas o planificadas</div></div>
    <div class="tile"><div class="tn">${coma(s.horasHechas)} / ${coma(s.horasPlan)} h</div><div class="tl">horas hechas / planificadas</div></div>
    <div class="tile"><div class="tn ${s.otsTarde ? "mal" : ""}">${s.otsTarde} de ${s.otsAbiertas}</div><div class="tl">OT que terminan después de su semana</div></div>
    <div class="tile"><div class="tn ${s.procesosCorridos ? "medio" : ""}">${s.procesosCorridos} de ${s.procesosAbiertos}</div><div class="tl">procesos corridos del plan</div></div>
  </div>

  ${r.ots.length ? `
  <h2>Planificado y hecho por OT</h2>
  <div class="leyenda"><i class="l-plan"></i>planificado en el período <i class="l-hecho"></i>hecho · primero las más atrasadas${r.ots.length > MAX_OT ? ` · las ${MAX_OT} primeras` : ""}</div>
  ${svgPorOt(r.ots)}
  <div class="dos">
    <div class="mitad"><h3>Horas por proceso</h3>${svgPorProceso(r.ots)}</div>
    <div class="mitad"><h3>Desvío por OT</h3><div class="leyenda">rojo: atrasada contra lo planificado · verde: adelantada</div>${svgDesvios(r.ots)}</div>
  </div>
  <h2>Detalle por OT y proceso</h2>
  ${tablaOts(r.ots)}
  ${seccionFueraDelPlan(r.ots)}` : `<p>No hubo nada planificado ni hecho en el período.</p>`}

  ${seccionesDia(reporteDia)}

  <div class="pie">Planificado: horas del plan confirmado en el período sobre las horas del proceso. Hecho: piezas escaneadas o lo que subió el checkeo manual en el período. Va: % del proceso al final del período. Las OT que llegan a su semana y los corrimientos son los del plan vivo a la hora del informe.</div>
</body></html>`;
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
