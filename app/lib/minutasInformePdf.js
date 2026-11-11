// app/lib/minutasInformePdf.js — Hoja para imprimir (o guardar en PDF) y
// texto para WhatsApp del informe consolidado de las minutas (Tadeo, 02/11).
// Recibe lo que arma informeMinutas (app/lib/minutasReporte.js).
import { fmtPesos } from "./costo";
import { HORA_REUNION } from "./minutasReporte";
import { textoRevision, tipoRevision } from "./minutasRevision";
import { textoRenglonOt } from "./nombreOt";
import { descargarPdfDeHtml } from "./pdfDeHtml";

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));
const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : "");
const fmtDias = (d) => (d == null ? "—" : `${String(d).replace(".", ",")} ${d === 1 ? "día" : "días"}`);
// La OT completa (Código · Cliente · Proyecto · Descripción, 02/11): con las OT
// del período (inf.porOt) si vinieron; si no, lo que guardó el renglón.
const nombreOtDe = (x, porOt) => textoRenglonOt(x, porOt);
const PUNTO = { verde: "🟢", amarillo: "🟡", rojo: "🔴" };
const pct = (v, max) => (max > 0 ? Math.round((v / max) * 1000) / 10 : 0);

/** Barra horizontal de colores: partes [{ valor, clase }]. */
function barra(partes, max) {
  return `<div class="barra">${partes.filter((p) => p.valor > 0).map((p) => `<i class="${p.clase}" style="width:${pct(p.valor, max)}%"></i>`).join("")}</div>`;
}

function columnas(serie, partes) {
  const max = Math.max(1, ...serie.map((p) => partes.reduce((s, c) => s + (p[c.clave] || 0), 0)));
  return `<div class="cols">${serie.map((p) => `<div class="col"><div class="pila">${partes.map((c) => (p[c.clave] ? `<i class="${c.clase}" style="height:${pct(p[c.clave], max)}%"></i>` : "")).join("")}</div><span>${esc(p.etiqueta)}</span></div>`).join("")}</div>
  <div class="leyenda">${partes.map((c) => `<i class="${c.clase}"></i>${esc(c.label)}`).join(" ")}</div>`;
}

const kpi = (valor, label, tono = "") => `<div class="kpi ${tono}"><b>${esc(valor)}</b><span>${esc(label)}</span></div>`;

/**
 * La hoja A4 del informe.
 * @param {{ informe: object, titulo: string, empresa?: string }} datos
 */
export function htmlInformeMinutas({ informe: inf, titulo, empresa = "" }) {
  const nombreOt = (x) => nombreOtDe(x, inf.porOt);
  const dia = inf.modo === "dia";
  const { reunion, foco, terminado, enCurso, pendientes, feedback, compras, serie } = inf;
  const r0 = reunion.dias[0];
  const problemas = enCurso.items.filter((x) => x.semaforo !== "verde");
  const verdes = enCurso.items.filter((x) => x.semaforo === "verde");
  const abiertos = pendientes.items.filter((p) => !p.resuelto);
  const maxValor = Math.max(1, ...terminado.items.map((t) => t.valor || 0));
  const maxDias = Math.max(1, ...abiertos.map((p) => p.dias || 0));
  const maxTipo = Math.max(1, ...feedback.porTipo.map((t) => t.n));
  const maxFoco = Math.max(1, ...foco.porOt.map((f) => f.dias));
  const claseTipo = { Error: "rojo", "Falta de dato": "violeta", Mejora: "cyan", Reconocimiento: "verde" };

  const reunionHtml = dia
    ? `<div class="kpis">${kpi(r0?.inicio ? `${r0.inicio}${r0.cierre ? ` – ${r0.cierre}` : ""}` : "—", `Horario (empieza ${HORA_REUNION})`, r0?.aHorario === false ? "at" : "ok")}${kpi(r0?.duracion == null ? "—" : `${r0.duracion} min`, "Duración", r0?.duracion > 20 ? "at" : "")}${kpi(r0?.asistentes.length ?? 0, "Presentes")}</div>
      <p class="chico">${esc([r0?.modera && `Modera ${r0.modera}`, r0?.registra && `registra ${r0.registra}`, r0?.asistentes.length && `Estuvieron: ${r0.asistentes.join(", ")}`].filter(Boolean).join(" · "))}</p>`
    : `<div class="kpis">${kpi(reunion.cantidad, reunion.cantidad === 1 ? "Reunión" : "Reuniones")}${kpi(reunion.conInicio ? `${reunion.aHorario} de ${reunion.conInicio}` : "—", `A horario (${HORA_REUNION})`, reunion.conInicio && reunion.aHorario < reunion.conInicio ? "at" : "ok")}${kpi(reunion.duracionPromedio == null ? "—" : `${reunion.duracionPromedio} min`, "Duración promedio")}${kpi(String(reunion.presentesPromedio).replace(".", ","), "Presentes en promedio")}</div>
      <table class="filas">${reunion.asistencia.map((a) => `<tr><td class="n">${esc(a.nombre)}</td><td>${barra([{ valor: a.veces, clase: a.pct >= 80 ? "verde" : a.pct >= 50 ? "amarillo" : "rojo" }], reunion.cantidad)}</td><td class="v">${a.veces}/${reunion.cantidad}</td></tr>`).join("")}</table>`;

  const focoHtml = !foco.items.length ? `<p class="chico">No se anotó foco.</p>` : dia
    ? `<ol class="lista">${foco.items.map((f) => `<li><b>${esc(nombreOt(f) || "Sin OT")}</b>${f.texto ? ` — ${esc(f.texto)}` : ""}</li>`).join("")}</ol>`
    : `<table class="filas">${foco.porOt.slice(0, 8).map((f) => `<tr><td class="n">${esc(nombreOt(f) || f.texto)}</td><td>${barra([{ valor: f.dias, clase: "marca" }], maxFoco)}</td><td class="v">${fmtDias(f.dias)}</td></tr>`).join("")}</table>`;

  const terminadasHtml = `<div class="kpis">${kpi(terminado.produccion.cantidad, `En producción${terminado.produccion.valor ? ` · ${fmtPesos(terminado.produccion.valor)}` : ""}`, terminado.produccion.cantidad ? "ok" : "")}${kpi(terminado.instalacion.cantidad, `Instaladas${terminado.instalacion.valor ? ` · ${fmtPesos(terminado.instalacion.valor)}` : ""}`, terminado.instalacion.cantidad ? "ok" : "")}</div>
    ${terminado.items.length ? `<table class="tabla"><tr><th>OT</th><th>Dónde</th>${dia ? "" : "<th>Día</th>"}<th>Observación</th><th class="dias">Valor</th></tr>${terminado.items.map((t) => `<tr><td><b>${esc(nombreOt(t))}</b></td><td>${t.seccion === "prod_terminada" ? "Producción" : "Instalación"}</td>${dia ? "" : `<td>${ddmm(t.fecha)}</td>`}<td>${esc(t.texto)}</td><td class="dias">${t.valor == null ? "" : barra([{ valor: t.valor, clase: "verde" }], maxValor)}${t.valor == null ? "sin precio" : esc(fmtPesos(t.valor))}</td></tr>`).join("")}</table>` : ""}`;

  const totalCurso = enCurso.verde + enCurso.amarillo + enCurso.rojo;
  const semaforoHtml = totalCurso ? `<div class="semaforo">${[["verde", enCurso.verde], ["amarillo", enCurso.amarillo], ["rojo", enCurso.rojo]].filter(([, n]) => n).map(([c, n]) => `<i class="${c}" style="width:${pct(n, totalCurso)}%">${n}</i>`).join("")}</div>
    <div class="leyenda"><i class="verde"></i>Verde ${pct(enCurso.verde, totalCurso)} % <i class="amarillo"></i>Amarillo ${pct(enCurso.amarillo, totalCurso)} % <i class="rojo"></i>Rojo ${pct(enCurso.rojo, totalCurso)} %</div>` : "";
  const enCursoHtml = `<div class="kpis">${kpi(enCurso.verde, "🟢 Verde", "ok")}${kpi(enCurso.amarillo, "🟡 Amarillo", enCurso.amarillo ? "at" : "")}${kpi(enCurso.rojo, "🔴 Rojo", enCurso.rojo ? "ma" : "")}</div>
    ${semaforoHtml}
    ${!dia && serie.length > 1 ? columnas(serie, [{ clave: "verde", clase: "verde", label: "Verde" }, { clave: "amarillo", clase: "amarillo", label: "Amarillo" }, { clave: "rojo", clase: "rojo", label: "Rojo" }]) : ""}
    ${problemas.length ? `<table class="tabla"><tr><th>OT</th><th>Contingencia / observación</th><th>Responsable</th><th>Fecha</th>${dia ? "" : "<th class=\"v\">Días</th>"}</tr>${problemas.map((x) => `<tr><td>${PUNTO[x.semaforo]} <b>${esc(nombreOt(x))}</b></td><td>${esc(x.texto)}${x.instaladores?.length ? `<div class="chico">🔧 ${esc(x.instaladores.join(", "))}</div>` : ""}</td><td>${esc(x.responsable || "")}</td><td>${ddmm(x.fecha_objetivo)}</td>${dia ? "" : `<td class="v">${x.diasProblema || ""}</td>`}</tr>`).join("")}</table>` : ""}
    ${verdes.length ? `<p class="chico">🟢 En verde: ${esc(verdes.map((x) => `${x.texto ? `${nombreOt(x)} (${x.texto})` : nombreOt(x)}${x.instaladores?.length ? ` 🔧 ${x.instaladores.join(", ")}` : ""}`).join(" · "))}</p>` : ""}`;

  const pendHtml = `<div class="kpis">${kpi(pendientes.abiertos, "Abiertos", pendientes.abiertos ? "at" : "ok")}${kpi(pendientes.vencidos, "Vencidos", pendientes.vencidos ? "ma" : "ok")}${kpi(pendientes.diasPromedioAbiertos == null ? "—" : fmtDias(pendientes.diasPromedioAbiertos), "Abiertos hace (promedio)")}${kpi(pendientes.resueltos, "Resueltos", "ok")}</div>
    ${abiertos.length ? `<table class="tabla"><tr><th>Pendiente</th><th>OT</th><th>Responsable</th><th>Surgió</th><th>Fecha objetivo</th><th class="dias">Días abierto</th></tr>${abiertos.map((p) => `<tr class="${p.vencido || p.gerencia || (p.dias || 0) >= 3 ? "fila-mal" : ""}"><td>${esc(p.texto)}</td><td>${esc(nombreOt(p))}</td><td>${esc(p.responsable)}</td><td>${ddmm(p.desde)}</td><td>${ddmm(p.fecha_objetivo)}${p.vencido ? " ⏰" : ""}</td><td class="dias">${barra([{ valor: p.dias || 0, clase: p.vencido || p.gerencia || (p.dias || 0) >= 3 ? "rojo" : "amarillo" }], maxDias)}<b>${p.dias ?? "—"}</b></td></tr>`).join("")}</table>` : `<p class="chico">No quedaron pendientes abiertos.</p>`}`;

  const fbHtml = feedback.total === 0 ? `<p class="chico">No hubo feedback.</p>`
    : `<table class="filas">${feedback.porTipo.map((t) => `<tr><td class="n">${esc(t.tipo)}</td><td>${barra([{ valor: t.n, clase: claseTipo[t.tipo] || "marca" }], maxTipo)}</td><td class="v">${t.n}</td></tr>`).join("")}</table>
      <p class="chico">${feedback.total} en total · por área: ${esc(feedback.porArea.map((a) => `${a.area} ${a.total}`).join(" · "))}</p>
      ${feedback.analisis?.length ? `<div class="analisis"><b>🔎 Análisis</b><ul>${feedback.analisis.map((f) => `<li class="t-${f.tono}">${esc(f.texto)}</li>`).join("")}</ul></div>` : ""}
      ${feedback.items?.length ? `<table class="tabla"><tr>${dia ? "" : "<th>Día</th>"}<th>Tipo</th><th>Para</th><th>OT</th><th>Qué pasó</th><th>Lo trajo</th></tr>${feedback.items.map((f) => `<tr>${dia ? "" : `<td>${ddmm(f.fecha)}</td>`}<td><i class="punto ${claseTipo[f.tipo] || "marca"}"></i>${esc(f.tipo)}</td><td>${esc(f.area)}</td><td>${esc(f.ot ? `OT ${f.ot}` : "")}</td><td>${esc(f.texto)}</td><td>${esc(f.trae || "")}${f.revisado ? " ✓" : ""}</td></tr>`).join("")}</table>` : ""}`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de minutas · ${esc(titulo)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, Arial, sans-serif; color: #1c1917; font-size: 9.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cabecera { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: .6mm solid #e8a33c; padding-bottom: 2mm; margin-bottom: 2mm; }
  h1 { font-size: 15pt; margin: 0; } .empresa { font-weight: 700; } .chico { font-size: 8pt; color: #57534e; margin: 1mm 0; }
  h2 { font-size: 11pt; margin: 3.5mm 0 1.5mm; color: #9a3412; break-after: avoid; }
  section { break-inside: avoid; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin-bottom: 1.5mm; }
  .kpi { border: .3mm solid #e7e5e4; border-left: 1.2mm solid #a8a29e; border-radius: 2mm; padding: 1.5mm 2mm; background: #faf7f2; }
  .kpi b { display: block; font-size: 13pt; } .kpi span { font-size: 7.5pt; color: #57534e; }
  .kpi.ok { border-left-color: #16a34a; } .kpi.at { border-left-color: #d97706; } .kpi.ma { border-left-color: #dc2626; }
  table { width: 100%; border-collapse: collapse; }
  .filas td { padding: .6mm 1mm; } .filas td.n { width: 45mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45mm; }
  td.v, th.v { text-align: right; width: 22mm; white-space: nowrap; }
  .tabla th { text-align: left; font-size: 7pt; text-transform: uppercase; color: #78716c; border-bottom: .3mm solid #a8a29e; padding: .8mm 1mm; }
  .tabla td { border-bottom: .2mm solid #e7e5e4; padding: 1mm; vertical-align: top; }
  .fila-mal td { background: #fef2f2; }
  .analisis { border: .3mm solid #e7e5e4; border-radius: 2mm; background: #faf7f2; padding: 1.5mm 3mm; margin: 1.5mm 0; }
  .analisis ul { margin: 1mm 0 0; padding-left: 4mm; } .analisis li { margin-bottom: .6mm; }
  .t-bien { color: #15803d; } .t-atencion { color: #b45309; } .t-mal { color: #b91c1c; }
  i.punto { display: inline-block; width: 2.2mm; height: 2.2mm; border-radius: 50%; margin-right: 1.2mm; vertical-align: middle; }
  td.dias, th.dias { width: 42mm; text-align: right; white-space: nowrap; }
  td.dias .barra { display: inline-flex; width: 22mm; vertical-align: middle; margin-right: 1.5mm; }
  .semaforo { display: flex; height: 7mm; border-radius: 1.5mm; overflow: hidden; margin: 1mm 0; }
  .semaforo i { display: flex; align-items: center; justify-content: center; font-style: normal; font-weight: 700; color: #fff; font-size: 9pt; }
  .semaforo i.amarillo { color: #1c1917; }
  .barra { display: flex; height: 3mm; background: #f5f5f4; border-radius: .8mm; overflow: hidden; }
  .barra i, .pila i, .leyenda i { display: block; }
  .verde { background: #16a34a; } .amarillo { background: #facc15; } .rojo { background: #dc2626; } .marca { background: #e8a33c; } .violeta { background: #7c3aed; } .cyan { background: #0891b2; }
  .cols { display: flex; gap: 2mm; height: 24mm; align-items: flex-end; border-bottom: .3mm solid #d6d3d1; margin-top: 1mm; }
  .col { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; }
  .col span { font-size: 6.5pt; color: #78716c; text-align: center; margin-top: .5mm; }
  .pila { flex: 1; display: flex; flex-direction: column-reverse; }
  .leyenda { font-size: 7pt; color: #57534e; margin: 1.5mm 0 1mm; } .leyenda i { display: inline-block; width: 3mm; height: 2mm; margin: 0 1mm 0 2mm; vertical-align: middle; }
  ol.lista { margin: 0; padding-left: 5mm; } ol.lista li { margin-bottom: .8mm; }
  .pie { margin-top: 3mm; font-size: 7pt; color: #78716c; }
</style></head><body>
  <div class="cabecera">
    <div><div class="empresa">${esc(empresa)}</div><div class="chico">Reunión de Buenos Días</div></div>
    <div style="text-align:right"><h1>Informe de minutas</h1><div class="chico">${esc(titulo)}</div></div>
  </div>
  <section><h2>⏱ Reunión</h2>${reunionHtml}</section>
  ${inf.revision?.total ? `<section><h2>🔁 Revisión de lo del día anterior</h2><div class="kpis">${inf.revision.porTipo.filter((t) => t.total).map((t) => kpi(t.pct == null ? "—" : `${t.pct} %`, `${t.id === "alerta" ? "Alertas mitigadas" : t.id === "fecha" ? "Fechas cumplidas" : "Compras hechas"} (${t.si} de ${t.si + t.no})`, t.pct == null ? "" : t.pct >= 80 ? "ok" : t.pct >= 50 ? "at" : "ma")).join("")}</div>
    ${inf.revision.no.length ? `<table class="tabla"><tr>${dia ? "" : "<th>Día</th>"}<th>Resultado</th><th>Qué</th><th>Responsable</th></tr>${inf.revision.no.map((it) => `<tr class="fila-mal">${dia ? "" : `<td>${ddmm(it.fecha)}</td>`}<td>${esc(tipoRevision(it.tipo).no)}</td><td>${esc(textoRevision(it))}</td><td>${esc(it.responsable || "")}</td></tr>`).join("")}</table>` : ""}</section>` : ""}
  <section><h2>🎯 Foco del día</h2>${focoHtml}</section>
  <section><h2>✅ OT terminadas</h2>${terminadasHtml}</section>
  <section><h2>🚦 OT en curso</h2>${enCursoHtml}</section>
  <section><h2>📌 Pendientes a resolver</h2>${pendHtml}</section>
  <section><h2>💬 Feedback</h2>${fbHtml}</section>
  ${compras.total ? `<section><h2>🛒 Compras disparadas</h2><p>${compras.total} compras · ${compras.urgentes} urgentes · ${compras.conPedido} con pedido en Compras</p></section>` : ""}
  <div class="pie">Gypi · ${dia ? "Informe del día" : "Suma de las minutas de cada día del período"}. El valor de las OT sale de la columna PRECIO del Plan de trabajo.</div>
</body></html>`;
}

/** Abre la hoja con el diálogo de impresión ("Guardar como PDF"). */
export function imprimirInformeMinutas(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(htmlInformeMinutas(datos));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 400);
}

// ─── PDF a color, descargado directo ────────────────────────────────────────
// "Guardar como PDF" desde imprimir puede salir en blanco y negro (según la
// impresora elegida o si "Gráficos de fondo" está apagado). Acá se dibuja la
// hoja como imagen y se arma el PDF en el navegador: sale siempre a color.

export { cortesDePagina } from "./pdfDeHtml";

const nombreArchivo = (titulo) => `Informe de minutas - ${String(titulo || "").replace(/[\\/:*?"<>|]+/g, "-")}.pdf`;

/** Arma el PDF a color de la hoja y lo descarga. */
export function descargarPdfInformeMinutas(datos) {
  return descargarPdfDeHtml(htmlInformeMinutas(datos), { archivo: nombreArchivo(datos.titulo) });
}

/** Resumen corto para mandar por WhatsApp. */
export function textoInformeMinutas(inf, titulo) {
  const nombreOt = (x) => nombreOtDe(x, inf.porOt);
  const { reunion, foco, terminado, enCurso, pendientes, feedback } = inf;
  const dia = inf.modo === "dia";
  const r0 = reunion.dias[0];
  const l = [`*Informe de minutas · ${titulo}*`];
  l.push(dia
    ? `⏱ Reunión ${r0?.inicio || "—"}${r0?.cierre ? ` a ${r0.cierre}` : ""}${r0?.duracion != null ? ` (${r0.duracion} min)` : ""} · ${r0?.asistentes.length || 0} presentes`
    : `⏱ ${reunion.cantidad} reuniones · ${reunion.aHorario} de ${reunion.conInicio} a horario · ${reunion.duracionPromedio ?? "—"} min promedio`);
  if (foco.items.length) l.push(`🎯 Foco: ${(dia ? foco.items : foco.porOt.slice(0, 5)).map((f) => (f.ot ? nombreOt(f) : f.texto)).join("; ")}`);
  const valor = terminado.produccion.valor + terminado.instalacion.valor;
  l.push(`✅ Terminadas: ${terminado.produccion.cantidad} en producción, ${terminado.instalacion.cantidad} instaladas${valor ? ` · ${fmtPesos(valor)}` : ""}`);
  l.push(`🚦 En curso: 🟢 ${enCurso.verde} · 🟡 ${enCurso.amarillo} · 🔴 ${enCurso.rojo}`);
  for (const x of enCurso.items.filter((y) => y.semaforo !== "verde").slice(0, 6)) l.push(`   ${PUNTO[x.semaforo]} ${x.ot ? nombreOt(x) : "Sin OT"}${x.texto ? `: ${x.texto}` : ""}${x.responsable ? ` (${x.responsable})` : ""}`);
  l.push(`📌 Pendientes: ${pendientes.abiertos} abiertos${pendientes.vencidos ? `, ${pendientes.vencidos} vencidos` : ""}`);
  for (const p of pendientes.items.filter((y) => !y.resuelto).slice(0, 6)) l.push(`   • ${p.texto || nombreOt(p)} · ${p.responsable} · ${fmtDias(p.dias)}`);
  if (feedback.total) {
    l.push(`💬 Feedback: ${feedback.porTipo.map((t) => `${t.tipo} ${t.n}`).join(" · ")}`);
    for (const f of (feedback.analisis || []).slice(0, 3)) l.push(`   ${f.texto}`);
  }
  return l.join("\n");
}
