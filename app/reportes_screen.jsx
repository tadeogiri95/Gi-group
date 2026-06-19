import { useState, useEffect, useCallback, useMemo } from "react";
import { sb } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";
import { useToast } from "./components/ui/Toast";
import FotoViewer from "./components/FotoViewer";
import { hoyArg, ahoraArg } from "./lib/dates";

/* ═══════════════════════════════════════════════════════
   REPORTES & CUMPLIMIENTO HORARIO
   Vista gerencial con exportación PDF/Excel
   ═══════════════════════════════════════════════════════ */

const AMBER = "var(--color-empresa-primary, #F97316)";
const GREEN = "#16A34A";
const RED = "#DC2626";
const CYAN = "#0891B2";
const VIOLET = "#7C3AED";
const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIAS_LABEL = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
const DIAS_SEMANA_JS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

import { getDivisionesConTodas } from "./lib/constants";
import { useAuth } from "./context/AuthContext";

/* ─── Helpers ─── */
const parseHora = (str) => { if (!str) return null; const [h, m] = str.split(":").map(Number); return h * 60 + m; };
const fmtHora = (min) => { if (min == null) return "—"; const h = Math.floor(min / 60); const m = min % 60; return `${h}:${String(m).padStart(2, "0")}`; };
const diffMin = (a, b) => (a != null && b != null) ? b - a : null;
const pctColor = (pct) => pct >= 95 ? GREEN : pct >= 80 ? AMBER : RED;

const getWeekDates = (offset = 0) => {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + offset * 7);
  const dates = [];
  for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(d.getDate() + i); dates.push(d); }
  return dates;
};
const getMonthDates = (year, month) => {
  const dates = []; const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d++) dates.push(new Date(year, month, d));
  return dates;
};

/* ─── Estado de cumplimiento por día ─── */
function calcEstado(diagrama, fecha, fichada) {
  const diaKey = DIAS_SEMANA_JS[fecha.getDay()];
  const esperado = diagrama?.[diaKey];
  const hoy = new Date();
  const esFuturo = fecha > hoy;
  if (esFuturo) return { estado: "futuro", color: "var(--color-text-secondary)", icon: "·", detalle: "" };
  if (!esperado) {
    if (fichada) return { estado: "extra", color: CYAN, icon: "★", detalle: `Trabajó en franco: ${fichada.ingreso?.slice(0, 5) || "?"} → ${fichada.egreso?.slice(0, 5) || "?"}` };
    return { estado: "franco", color: "var(--color-text-secondary)", icon: "F", detalle: "Franco" };
  }
  if (!fichada || !fichada.ingreso) return { estado: "ausente", color: RED, icon: "✗", detalle: "Ausente" };

  const inEsperado = parseHora(esperado.in);
  const outEsperado = parseHora(esperado.out);
  const inReal = parseHora(fichada.ingreso?.slice(0, 5));
  const outReal = fichada.egreso ? parseHora(fichada.egreso.slice(0, 5)) : null;
  const tardanza = inReal != null && inEsperado != null ? Math.max(0, inReal - inEsperado) : 0;
  const salidaTemp = outReal != null && outEsperado != null ? Math.max(0, outEsperado - outReal) : 0;
  const minEsperados = diffMin(inEsperado, outEsperado) || 0;
  const minReales = outReal != null ? diffMin(inReal, outReal) : null;

  let estado = "ok", color = GREEN, icon = "✓";
  const detalles = [`${fichada.ingreso?.slice(0, 5)} → ${fichada.egreso?.slice(0, 5) || "en curso"}`];
  if (tardanza > 5) { estado = "tardanza"; color = AMBER; icon = "⏰"; detalles.push(`Tardanza: +${tardanza}min`); }
  if (salidaTemp > 5) { estado = tardanza > 5 ? "tardanza" : "salida_temp"; color = AMBER; icon = tardanza > 5 ? "⏰" : "↗"; detalles.push(`Salió ${salidaTemp}min antes`); }
  if (minReales != null && minEsperados > 0) { const pct = Math.round((minReales / minEsperados) * 100); detalles.push(`${fmtHora(minReales)} de ${fmtHora(minEsperados)} (${pct}%)`); }
  return { estado, color, icon, detalle: detalles.join(" · "), tardanza, salidaTemp, minEsperados, minReales };
}

/* ─── Exportar CSV ─── */
function exportCSV(rows, filename) {
  const BOM = "﻿";
  const csv = BOM + rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

/* ─── Exportar PDF (canvas → PNG) ─── */
function exportPDF(title, headers, rows, meta = "") {
  const W = 842, H = 595;
  const canvas = document.createElement("canvas"); canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext("2d"); ctx.scale(2, 2);
  ctx.fillStyle = "#0C0A09"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#1C1917"; ctx.fillRect(0, 0, W, 56);
  ctx.fillStyle = "#F5F0E8"; ctx.font = "bold 18px system-ui, sans-serif"; ctx.fillText(title, 24, 36);
  ctx.fillStyle = "#8B8680"; ctx.font = "12px system-ui, sans-serif"; ctx.fillText(meta, W - ctx.measureText(meta).width - 24, 36);
  const startY = 76, rowH = 22, colW = Math.min(Math.floor((W - 48) / headers.length), 140), startX = 24;
  ctx.fillStyle = "#292524"; ctx.fillRect(startX, startY, colW * headers.length, rowH + 4);
  ctx.fillStyle = "#D4A843"; ctx.font = "bold 10px system-ui, sans-serif";
  headers.forEach((h, i) => { ctx.fillText(String(h).slice(0, 18), startX + i * colW + 6, startY + 15); });
  const maxRows = Math.floor((H - startY - rowH - 40) / rowH);
  rows.slice(0, maxRows).forEach((row, ri) => {
    const y = startY + rowH + 4 + ri * rowH;
    if (ri % 2 === 0) { ctx.fillStyle = "#1C191710"; ctx.fillRect(startX, y, colW * headers.length, rowH); }
    ctx.strokeStyle = "#292524"; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(startX, y + rowH); ctx.lineTo(startX + colW * headers.length, y + rowH); ctx.stroke();
    ctx.font = "11px system-ui, sans-serif";
    row.forEach((cell, ci) => {
      const val = String(cell ?? "—");
      if (val.includes("✓") || val.includes("100%")) ctx.fillStyle = "#4ADE80";
      else if (val.includes("✗") || val.includes("Ausente")) ctx.fillStyle = "#F87171";
      else if (val.includes("⏰") || val.includes("Tardanza")) ctx.fillStyle = "#D4A843";
      else ctx.fillStyle = "#D6D0C4";
      ctx.fillText(val.slice(0, 20), startX + ci * colW + 6, y + 15);
    });
  });
  if (rows.length > maxRows) { ctx.fillStyle = "#8B8680"; ctx.font = "italic 10px system-ui, sans-serif"; ctx.fillText(`... y ${rows.length - maxRows} filas más (ver Excel para reporte completo)`, startX, H - 20); }
  ctx.fillStyle = "#44403C"; ctx.font = "9px system-ui, sans-serif"; ctx.fillText(`Gypi · Generado ${new Date().toLocaleString("es-AR")}`, startX, H - 8);
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = title.replace(/[^a-zA-Z0-9áéíóúñ ]/g, "").replace(/ /g, "_") + ".png"; a.click(); URL.revokeObjectURL(url);
  }, "image/png");
}

/* ─── Tab de Reporte de Producción ─── */
function ReporteProduccionTab({ fechaDesde, fechaHasta, labelPeriodo, empresaId }) {
  const [datos, setDatos] = useState([]);
  const [proyectos, setProyectos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedOT, setExpandedOT] = useState(null);

  useEffect(() => {
    if (!fechaDesde || !fechaHasta) return;
    (async () => {
      setLoading(true);
      try {
        const [regs, proys] = await Promise.all([
          sb.get(`registro_actividades?empresa_id=eq.${empresaId}&fecha=gte.${fechaDesde}&fecha=lte.${fechaHasta}&etapa=gt.0&select=id,empleado_id,legajo,fecha,hora_inicio,hora_fin,codigo_proyecto,etapa,division,duracion_min,observaciones&order=fecha.desc`),
          sb.get(`proyectos?empresa_id=eq.${empresaId}&estado=eq.activo&select=id,codigo,nombre`),
        ]);
        setDatos(regs || []);
        setProyectos(proys || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [fechaDesde, fechaHasta]);

  const resumen = useMemo(() => {
    const map = {};
    datos.forEach(r => {
      const key = r.codigo_proyecto || "SIN_OT";
      if (!map[key]) map[key] = { ot: key, empleados: {}, totalMin: 0, registros: 0 };
      map[key].registros++;
      const min = parseFloat(r.duracion_min) || 0;
      map[key].totalMin += min;
      const empKey = r.empleado_id || r.legajo;
      if (!map[key].empleados[empKey]) map[key].empleados[empKey] = { legajo: r.legajo, min: 0, registros: 0 };
      map[key].empleados[empKey].min += min;
      map[key].empleados[empKey].registros++;
    });
    return Object.values(map)
      .map(p => ({
        ...p,
        nombre: proyectos.find(pr => pr.codigo === p.ot)?.nombre || "",
        empleadosList: Object.values(p.empleados).sort((a, b) => b.min - a.min),
      }))
      .sort((a, b) => b.totalMin - a.totalMin);
  }, [datos, proyectos]);

  const fmtMin = (min) => {
    if (!min || min <= 0) return "0m";
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const exportarCSV = () => {
    const rows = [["OT", "Proyecto", "Legajo", "Tiempo", "Registros"]];
    resumen.forEach(p => {
      p.empleadosList.forEach(e => {
        rows.push([p.ot, p.nombre, e.legajo, fmtMin(e.min), e.registros]);
      });
    });
    exportCSV(rows, `reporte_produccion_${fechaDesde}_${fechaHasta}.csv`);
  };

  if (loading) return <div className="gypi-dots"><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /></div>;

  if (resumen.length === 0) return (
    <div className="bg-gypi-surface rounded-2xl p-8 text-center border border-gypi-border">
      <div className="text-[32px] mb-2">📦</div>
      <div className="text-sm font-bold text-gypi-text">Sin registros de producción</div>
      <div className="text-xs text-gypi-dim mt-1.5">No hay actividad productiva registrada en este período.</div>
    </div>
  );

  const totalMin = resumen.reduce((a, p) => a + p.totalMin, 0);
  const totalRegs = resumen.reduce((a, p) => a + p.registros, 0);
  const empsUnicos = new Set(datos.map(d => d.empleado_id || d.legajo)).size;

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 mb-3.5">
        <div className="bg-gypi-surface rounded-xl p-3 text-center border border-gypi-border">
          <div className="font-heading text-xl font-bold text-gypi-green">{resumen.length}</div>
          <div className="text-[9px] text-gypi-dim font-bold">Proyectos</div>
        </div>
        <div className="bg-gypi-surface rounded-xl p-3 text-center border border-gypi-border">
          <div className="font-heading text-xl font-bold text-gypi-cyan">{empsUnicos}</div>
          <div className="text-[9px] text-gypi-dim font-bold">Empleados</div>
        </div>
        <div className="bg-gypi-surface rounded-xl p-3 text-center border border-gypi-border">
          <div className="font-heading text-xl font-bold text-gypi-amber">{fmtMin(totalMin)}</div>
          <div className="text-[9px] text-gypi-dim font-bold">Tiempo total</div>
        </div>
      </div>

      {/* Botón exportar */}
      <button onClick={exportarCSV} className="w-full py-2.5 px-4 rounded-xl border border-gypi-border bg-gypi-surface text-xs font-bold text-gypi-text cursor-pointer mb-3.5 font-body">
        📥 Exportar CSV producción
      </button>

      {/* Lista por proyecto */}
      <div className="flex flex-col gap-2">
        {resumen.map(p => {
          const isExpanded = expandedOT === p.ot;
          return (
            <div key={p.ot} className="bg-gypi-surface rounded-xl overflow-hidden border border-gypi-border">
              <button onClick={() => setExpandedOT(isExpanded ? null : p.ot)} className="w-full flex items-center gap-3 p-3 text-left cursor-pointer bg-transparent border-none">
                <div className="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: `${AMBER}15` }}>
                  <span className="text-base">📋</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-gypi-text truncate">OT {p.ot}{p.nombre ? ` — ${p.nombre}` : ""}</div>
                  <div className="text-[10px] text-gypi-dim mt-0.5">{Object.keys(p.empleados).length} empleado{Object.keys(p.empleados).length !== 1 ? "s" : ""} · {p.registros} registro{p.registros !== 1 ? "s" : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-heading text-sm font-bold text-gypi-amber">{fmtMin(p.totalMin)}</div>
                  <div className="text-[9px] text-gypi-dim">{isExpanded ? "▲" : "▼"}</div>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-0 border-t border-gypi-border">
                  <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.06em] mt-2.5 mb-1.5">Detalle por empleado</div>
                  {p.empleadosList.map((e, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-gypi-border last:border-b-0">
                      <div className="text-xs text-gypi-text font-semibold">L-{e.legajo}</div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-gypi-dim">{e.registros} reg.</span>
                        <span className="text-xs font-bold text-gypi-cyan font-heading">{fmtMin(e.min)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ─── Tab de Reportes de Obra ─── */
function ReportesObraTab({ empresaId }) {
  const [reportesObra, setReportesObra] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedReport, setExpandedReport] = useState(null);
  const [fotoViewer, setFotoViewer] = useState(null);
  const [fechaFiltro, setFechaFiltro] = useState(() => hoyArg());

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { const data = await sb.get(`reportes_obra?empresa_id=eq.${empresaId}&fecha=eq.${fechaFiltro}&order=created_at.desc`); setReportesObra(data || []); }
      catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [fechaFiltro]);

  const cambiarFecha = (dir) => { const d = new Date(fechaFiltro + "T12:00:00"); d.setDate(d.getDate() + dir); setFechaFiltro(d.toISOString().slice(0, 10)); };

  return (
    <>
      <div className="flex items-center justify-between mb-3.5 bg-gypi-surface rounded-[14px] py-2.5 px-4 border border-gypi-border">
        <button onClick={() => cambiarFecha(-1)} className="bg-transparent border-none text-gypi-text cursor-pointer text-lg p-1">←</button>
        <span className="font-heading text-sm font-bold text-gypi-text">
          {new Date(fechaFiltro + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}
        </span>
        <button onClick={() => cambiarFecha(1)} className="bg-transparent border-none text-gypi-text cursor-pointer text-lg p-1">→</button>
      </div>

      {loading ? (
        <div className="gypi-dots"><span style={{ background: "var(--color-cyan)" }} /><span style={{ background: "var(--color-cyan)" }} /><span style={{ background: "var(--color-cyan)" }} /></div>
      ) : reportesObra.length === 0 ? (
        <div className="bg-gypi-surface rounded-2xl p-8 text-center border border-gypi-border">
          <div className="text-[32px] mb-2">🏗️</div>
          <div className="text-sm font-bold text-gypi-text">Sin reportes en esta fecha</div>
          <div className="text-xs text-gypi-dim mt-1.5">Los reportes de obra enviados por instaladores aparecerán acá.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Tag color={CYAN} style={{ alignSelf: "flex-start", marginBottom: 4 }}>{reportesObra.length} reportes</Tag>
          {reportesObra.map(r => {
            const isExpanded = expandedReport === r.id;
            const tieneFotos = r.fotos_urls && r.fotos_urls.length > 0;
            return (
              <div key={r.id} className="bg-gypi-surface rounded-xl overflow-hidden transition-all" style={{ border: `1px solid ${isExpanded ? `${CYAN}30` : "var(--color-border)"}` }}>
                <div onClick={() => setExpandedReport(isExpanded ? null : r.id)} className="flex items-center gap-2.5 p-3 cursor-pointer">
                  <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-base shrink-0" style={{ background: `${CYAN}18`, color: CYAN }}>🏗️</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-bold text-gypi-text">{r.nombre}</span>
                      {tieneFotos && <Tag color={CYAN}>📷 {r.fotos_urls.length}</Tag>}
                      {r.faltantes?.length > 0 && <Tag color={RED}>⚠ {r.faltantes.length}</Tag>}
                    </div>
                    <div className="text-[11px] text-gypi-dim mt-0.5 truncate">{r.progreso?.slice(0, 60)}{r.progreso?.length > 60 ? "..." : ""}</div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-[10px] text-gypi-dim">{new Date(r.created_at).toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit' })}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={"var(--color-text-muted)"} strokeWidth="2" style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-3 pb-3.5 border-t border-gypi-border">
                    <div className="py-3 pb-2">
                      <div className="text-[10px] font-bold text-gypi-green uppercase tracking-[0.06em] mb-1.5">✅ Progreso</div>
                      <div className="text-[13px] text-gypi-text leading-relaxed">{r.progreso || "—"}</div>
                    </div>
                    {r.faltantes?.length > 0 && (
                      <div className="py-2 px-2.5 rounded-[10px] mb-2" style={{ background: `${RED}10`, border: `1px solid ${RED}18` }}>
                        <div className="text-[10px] font-bold uppercase tracking-[0.06em] mb-1.5" style={{ color: RED }}>🚫 Faltantes</div>
                        <div className="flex flex-wrap gap-1">
                          {r.faltantes.map((f, i) => <span key={i} className="py-1 px-2.5 rounded-lg text-xs font-semibold" style={{ background: `${RED}20`, color: RED }}>{f}</span>)}
                        </div>
                      </div>
                    )}
                    {r.desvios?.length > 0 && (
                      <div className="py-2 px-2.5 rounded-[10px] mb-2" style={{ background: `${AMBER}10`, border: `1px solid ${AMBER}18` }}>
                        <div className="text-[10px] font-bold uppercase tracking-[0.06em] mb-1.5" style={{ color: AMBER }}>⚠️ Desvíos</div>
                        <div className="flex flex-wrap gap-1">
                          {r.desvios.map((d, i) => <span key={i} className="py-1 px-2.5 rounded-lg text-xs font-semibold" style={{ background: `${AMBER}20`, color: AMBER }}>{d}</span>)}
                        </div>
                      </div>
                    )}
                    {tieneFotos && (
                      <div className="py-2">
                        <div className="text-[10px] font-bold uppercase tracking-[0.06em] mb-2" style={{ color: CYAN }}>📷 Fotos ({r.fotos_urls.length})</div>
                        <div className="gap-2" style={{ display: "grid", gridTemplateColumns: r.fotos_urls.length === 1 ? "1fr" : "repeat(2, 1fr)" }}>
                          {r.fotos_urls.map((url, i) => (
                            <div key={i} onClick={() => setFotoViewer({ fotos: r.fotos_urls, index: i })} className="cursor-pointer rounded-[10px] overflow-hidden bg-gypi-surface border border-gypi-border relative" style={{ aspectRatio: r.fotos_urls.length === 1 ? "16/9" : "1" }}>
                              <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                              <div className="absolute bottom-1.5 right-1.5 py-[3px] px-2 rounded-md bg-black/60 text-white text-[10px] font-semibold">🔍 Ampliar</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {!tieneFotos && r.fotos > 0 && (
                      <div className="py-2 px-2.5 rounded-lg text-[11px] text-gypi-dim" style={{ background: `${"var(--color-text-secondary)"}08` }}>
                        📷 El instalador indicó {r.fotos} foto{r.fotos > 1 ? "s" : ""} pero no se subieron correctamente
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {fotoViewer && <FotoViewer fotos={fotoViewer.fotos} index={fotoViewer.index} onClose={() => setFotoViewer(null)} onNav={(i) => setFotoViewer(prev => ({ ...prev, index: i }))} />}
    </>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function ReportesScreen() {
  const { divisiones: divisionesCtx, usuario } = useAuth();
  const empresaId = usuario?.empresa_id;
  const DIVISIONES = getDivisionesConTodas(divisionesCtx);
  const [tab, setTab] = useState("cumplimiento");
  const [periodo, setPeriodo] = useState("semana");
  const [weekOffset, setWeekOffset] = useState(0);
  const [mesYear, setMesYear] = useState(() => Number(hoyArg().slice(0, 4)));
  const [mesMes, setMesMes] = useState(() => Number(hoyArg().slice(5, 7)) - 1);
  const [division, setDivision] = useState("todas");
  const [expandedEmp, setExpandedEmp] = useState(null);
  const [empleados, setEmpleados] = useState([]);
  const [fichadas, setFichadas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(null);
  const toast = useToast();

  const showToast = (msg, color) => toast.show(msg, color);

  const fechasPeriodo = useMemo(() => {
    if (periodo === "semana") return getWeekDates(weekOffset);
    return getMonthDates(mesYear, mesMes);
  }, [periodo, weekOffset, mesYear, mesMes]);

  const fechaDesde = fechasPeriodo[0]?.toISOString().split("T")[0];
  const fechaHasta = fechasPeriodo[fechasPeriodo.length - 1]?.toISOString().split("T")[0];

  const labelPeriodo = useMemo(() => {
    if (periodo === "semana") {
      const d1 = fechasPeriodo[0], d2 = fechasPeriodo[6];
      return `${d1?.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} – ${d2?.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}`;
    }
    return `${MESES[mesMes]} ${mesYear}`;
  }, [periodo, fechasPeriodo, mesMes, mesYear]);

  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, fichs] = await Promise.all([
        sb.get(`empleados?empresa_id=eq.${empresaId}&activo=eq.true&select=id,nombre,apodo,legajo,division,area,rol,diagrama&order=nombre.asc`),
        sb.get(`fichadas?empresa_id=eq.${empresaId}&fecha=gte.${fechaDesde}&fecha=lte.${fechaHasta}&select=legajo,fecha,ingreso,egreso,horas_trabajadas&order=fecha.asc`),
      ]);
      setEmpleados((emps || []).filter(e => e.rol === "operativo"));
      setFichadas(fichs || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [fechaDesde, fechaHasta, empresaId]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const empsFiltrados = division === "todas" ? empleados : empleados.filter(e => e.division === division);

  const cumplimiento = useMemo(() => {
    return empsFiltrados.map(emp => {
      const diasData = fechasPeriodo.map(fecha => {
        const fechaStr = fecha.toISOString().split("T")[0];
        const fichada = fichadas.find(f => f.legajo === emp.legajo && f.fecha === fechaStr);
        return { fecha, fechaStr, ...calcEstado(emp.diagrama, fecha, fichada) };
      });
      const laborales = diasData.filter(d => d.estado !== "franco" && d.estado !== "futuro" && d.estado !== "extra");
      const presentes = laborales.filter(d => d.estado !== "ausente");
      const tardanzas = laborales.filter(d => d.tardanza > 5);
      const ausencias = laborales.filter(d => d.estado === "ausente");
      const extras = diasData.filter(d => d.estado === "extra");
      const totalMinEsperados = laborales.reduce((a, d) => a + (d.minEsperados || 0), 0);
      const diasConEgreso = presentes.filter(d => d.minReales != null);
      const totalMinReales = diasConEgreso.reduce((a, d) => a + d.minReales, 0);
      const hoy = hoyArg();
      const diasSinEgreso = presentes.filter(d => d.minReales == null);
      const minEstimadosHoy = diasSinEgreso.reduce((a, d) => {
        const f = fichadas.find(f2 => f2.legajo === emp.legajo && f2.fecha === hoy);
        if (f && f.ingreso) { const { hora } = ahoraArg(); const [hh, mm] = hora.split(":").map(Number); const ingMin = parseHora(f.ingreso.slice(0, 5)); const ahoraMin = hh * 60 + mm; return a + Math.max(0, ahoraMin - (ingMin || 0)); }
        return a;
      }, 0);
      const totalMinRealesAjustado = totalMinReales + minEstimadosHoy;
      const pctCumplimiento = laborales.length > 0 ? Math.round((presentes.length / laborales.length) * 100) : 100;
      const pctHoras = totalMinEsperados > 0 ? Math.round((totalMinRealesAjustado / totalMinEsperados) * 100) : 0;
      return { emp, diasData, laborales: laborales.length, presentes: presentes.length, tardanzas: tardanzas.length, ausencias: ausencias.length, extras: extras.length, totalMinEsperados, totalMinReales: totalMinRealesAjustado, pctCumplimiento, pctHoras, totalTardanzaMin: tardanzas.reduce((a, d) => a + (d.tardanza || 0), 0) };
    }).sort((a, b) => a.pctCumplimiento - b.pctCumplimiento);
  }, [empsFiltrados, fechasPeriodo, fichadas]);

  const metricas = useMemo(() => {
    const total = cumplimiento.length;
    const pctPromedio = total > 0 ? Math.round(cumplimiento.reduce((a, c) => a + c.pctCumplimiento, 0) / total) : 0;
    const conHorasEsperadas = cumplimiento.filter(c => c.totalMinEsperados > 0);
    const pctHorasPromedio = conHorasEsperadas.length > 0 ? Math.round(conHorasEsperadas.reduce((a, c) => a + c.pctHoras, 0) / conHorasEsperadas.length) : 0;
    const totalAusencias = cumplimiento.reduce((a, c) => a + c.ausencias, 0);
    const totalTardanzas = cumplimiento.reduce((a, c) => a + c.tardanzas, 0);
    const totalMinTardanzas = cumplimiento.reduce((a, c) => a + (c.totalTardanzaMin || 0), 0);
    const perfectos = cumplimiento.filter(c => c.pctCumplimiento === 100 && c.tardanzas === 0).length;
    return { total, pctPromedio, pctHorasPromedio, totalAusencias, totalTardanzas, totalMinTardanzas, perfectos };
  }, [cumplimiento]);

  const handleExportCSV = () => {
    setExporting("csv");
    const headers = ["Empleado", "Legajo", "División", "Días laborales", "Presentes", "Ausencias", "Tardanzas", "Min. tardanza", "% Asistencia", "Hs esperadas", "Hs reales", "% Horas"];
    const rows = cumplimiento.map(c => [c.emp.nombre, c.emp.legajo, c.emp.division || "—", c.laborales, c.presentes, c.ausencias, c.tardanzas, c.totalTardanzaMin || 0, c.pctCumplimiento + "%", fmtHora(c.totalMinEsperados), fmtHora(c.totalMinReales), c.pctHoras + "%"]);
    exportCSV([headers, ...rows], `Cumplimiento_${labelPeriodo.replace(/ /g, "_")}.csv`);
    showToast("✅ CSV descargado", GREEN); setTimeout(() => setExporting(null), 1000);
  };
  const handleExportPDF = () => {
    setExporting("pdf");
    const headers = ["Empleado", "Legajo", "Div", "Laborales", "Presentes", "Ausencias", "Tard.", "% Asist.", "% Horas"];
    const rows = cumplimiento.map(c => [c.emp.apodo || c.emp.nombre, c.emp.legajo, c.emp.division || "—", c.laborales, c.presentes, c.ausencias, c.tardanzas, c.pctCumplimiento + "%", c.pctHoras + "%"]);
    exportPDF(`Reporte Cumplimiento — ${labelPeriodo}`, headers, rows, `División: ${division === "todas" ? "Todas" : division} · ${new Date().toLocaleDateString("es-AR")}`);
    showToast("✅ Reporte descargado", GREEN); setTimeout(() => setExporting(null), 1000);
  };
  const handleExportDetalleCSV = () => {
    setExporting("detalle");
    const headers = ["Empleado", "Legajo", "Fecha", "Día", "Estado", "Esperado In", "Esperado Out", "Fichó In", "Fichó Out", "Tardanza (min)", "Detalle"];
    const rows = [];
    cumplimiento.forEach(c => {
      c.diasData.filter(d => d.estado !== "futuro").forEach(d => {
        const diaKey = DIAS_SEMANA_JS[d.fecha.getDay()];
        const esperado = c.emp.diagrama?.[diaKey];
        const fichada = fichadas.find(f => f.legajo === c.emp.legajo && f.fecha === d.fechaStr);
        rows.push([c.emp.nombre, c.emp.legajo, d.fechaStr, DIAS_LABEL[diaKey] || diaKey, d.estado, esperado?.in || "Franco", esperado?.out || "—", fichada?.ingreso?.slice(0, 5) || "—", fichada?.egreso?.slice(0, 5) || "—", d.tardanza || 0, d.detalle]);
      });
    });
    exportCSV([headers, ...rows], `Detalle_Fichadas_${labelPeriodo.replace(/ /g, "_")}.csv`);
    showToast("✅ Detalle CSV descargado", GREEN); setTimeout(() => setExporting(null), 1000);
  };

  const navAnterior = () => {
    if (periodo === "semana") setWeekOffset(w => w - 1);
    else { let m = mesMes - 1, y = mesYear; if (m < 0) { m = 11; y--; } setMesMes(m); setMesYear(y); }
  };
  const navSiguiente = () => {
    if (periodo === "semana") setWeekOffset(w => w + 1);
    else { let m = mesMes + 1, y = mesYear; if (m > 11) { m = 0; y++; } setMesMes(m); setMesYear(y); }
  };

  /* ── KPI Card ── */
  const KPI = ({ value, label, color }) => (
    <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border text-center">
      <div className="font-heading text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-[9px] text-gypi-dim font-bold uppercase mt-0.5">{label}</div>
    </div>
  );

  return (
    <div className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px]">


      {/* Tabs */}
      <div className="flex gap-1.5 mb-3.5 overflow-x-auto pb-0.5">
        <Chip active={tab === "cumplimiento"} onClick={() => setTab("cumplimiento")} color={AMBER}>📊 Cumplimiento</Chip>
        <Chip active={tab === "produccion"} onClick={() => setTab("produccion")} color={GREEN}>⚙️ Producción</Chip>
        <Chip active={tab === "obra"} onClick={() => setTab("obra")} color={CYAN}>🏗️ Obra</Chip>
        <Chip active={tab === "reportes"} onClick={() => setTab("reportes")} color={VIOLET}>📥 Exportar</Chip>
      </div>

      {/* Periodo */}
      <div className="flex gap-1.5 mb-2.5">
        <Chip active={periodo === "semana"} onClick={() => setPeriodo("semana")} color={CYAN}>Semanal</Chip>
        <Chip active={periodo === "mes"} onClick={() => setPeriodo("mes")} color={CYAN}>Mensual</Chip>
      </div>

      {/* Nav periodo */}
      <div className="flex items-center justify-between py-2.5 px-3.5 bg-gypi-surface rounded-[14px] border border-gypi-border mb-3.5">
        <button onClick={navAnterior} className="bg-transparent border-none text-gypi-text cursor-pointer text-lg py-1 px-2">←</button>
        <div className="text-center">
          <div className="text-sm font-bold text-gypi-text font-heading">{labelPeriodo}</div>
        </div>
        <button onClick={navSiguiente} className="bg-transparent border-none text-gypi-text cursor-pointer text-lg py-1 px-2">→</button>
      </div>

      {/* Filtro división */}
      <div className="flex gap-[5px] mb-3.5 overflow-x-auto pb-1">
        {DIVISIONES.map(d => <Chip key={d.id} active={division === d.id} onClick={() => setDivision(d.id)} color={d.color || AMBER}>{d.label}</Chip>)}
      </div>

      {loading ? (
        <div className="gypi-dots"><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /></div>
      ) : tab === "produccion" ? (
        <ReporteProduccionTab fechaDesde={fechaDesde} fechaHasta={fechaHasta} labelPeriodo={labelPeriodo} empresaId={empresaId} />
      ) : tab === "obra" ? (
        <ReportesObraTab empresaId={empresaId} />
      ) : tab === "cumplimiento" ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <KPI value={`${metricas.pctPromedio}%`} label="Asistencia" color={pctColor(metricas.pctPromedio)} />
            <KPI value={metricas.totalAusencias} label="Ausencias" color={RED} />
            <KPI value={metricas.totalTardanzas} label="Tardanzas" color={AMBER} />
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <KPI value={`${metricas.pctHorasPromedio}%`} label="Cumpl. horas" color={pctColor(metricas.pctHorasPromedio)} />
            <KPI value={metricas.perfectos} label="Sin falta ni tard." color={GREEN} />
            <KPI value={metricas.totalMinTardanzas > 0 ? fmtHora(metricas.totalMinTardanzas) : "0m"} label="Tiempo perdido" color={metricas.totalMinTardanzas > 0 ? AMBER : GREEN} />
          </div>

          <div className="mb-2"><div className="text-xs font-bold text-gypi-text font-heading">Detalle por empleado</div></div>

          {cumplimiento.length === 0 ? (
            <div className="bg-gypi-surface rounded-2xl p-8 text-center border border-gypi-border">
              <div className="text-[28px] mb-2">👥</div>
              <div className="text-sm font-bold text-gypi-text">Sin empleados en esta división</div>
              <div className="text-xs text-gypi-dim mt-1.5">Seleccioná otra división o verificá que haya empleados asignados.</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {cumplimiento.map(c => {
                const isExpanded = expandedEmp === c.emp.id;
                return (
                  <div key={c.emp.id} className="bg-gypi-surface rounded-[14px] overflow-hidden" style={{ border: `1px solid ${c.ausencias > 0 ? `${RED}30` : c.tardanzas > 0 ? `${AMBER}30` : "var(--color-border)"}` }}>
                    <div onClick={() => setExpandedEmp(isExpanded ? null : c.emp.id)} className="p-3.5 cursor-pointer flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-[10px] flex items-center justify-center font-heading text-[13px] font-bold" style={{ background: `${pctColor(c.pctCumplimiento)}15`, color: pctColor(c.pctCumplimiento) }}>{c.pctCumplimiento}%</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold text-gypi-text truncate">{c.emp.apodo || c.emp.nombre}</div>
                        <div className="text-[11px] text-gypi-dim mt-[1px]">
                          L-{c.emp.legajo}
                          {c.ausencias > 0 && <span style={{ color: RED }}> · {c.ausencias} falta{c.ausencias > 1 ? "s" : ""}</span>}
                          {c.tardanzas > 0 && <span style={{ color: AMBER }}> · {c.tardanzas} tard.</span>}
                          {c.extras > 0 && <span style={{ color: CYAN }}> · {c.extras} extra</span>}
                        </div>
                      </div>
                      {periodo === "semana" && (
                        <div className="flex gap-[3px]">
                          {c.diasData.map((d, i) => (
                            <div key={i} className="w-[18px] h-[18px] rounded text-[9px] font-bold flex items-center justify-center" style={{ background: `${d.color}22`, color: d.color }}>{d.icon}</div>
                          ))}
                        </div>
                      )}
                      <span className="text-gypi-dim text-xs" style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
                    </div>
                    {isExpanded && (
                      <div className="px-3.5 pb-3.5 border-t border-gypi-border">
                        <div className="flex gap-2 mt-3 mb-3">
                          <div className="flex-1 py-2 text-center rounded-lg" style={{ background: `${GREEN}12` }}>
                            <div className="font-mono text-sm font-bold text-gypi-green">{c.presentes}/{c.laborales}</div>
                            <div className="text-[9px] text-gypi-dim">Presentes</div>
                          </div>
                          <div className="flex-1 py-2 text-center rounded-lg" style={{ background: `${pctColor(c.pctHoras)}12` }}>
                            <div className="font-mono text-sm font-bold" style={{ color: pctColor(c.pctHoras) }}>{c.pctHoras}%</div>
                            <div className="text-[9px] text-gypi-dim">Horas</div>
                          </div>
                          {c.totalTardanzaMin > 0 && (
                            <div className="flex-1 py-2 text-center rounded-lg" style={{ background: `${AMBER}12` }}>
                              <div className="font-mono text-sm font-bold text-gypi-amber">{c.totalTardanzaMin}m</div>
                              <div className="text-[9px] text-gypi-dim">Tard. total</div>
                            </div>
                          )}
                        </div>
                        {c.diasData.filter(d => d.estado !== "futuro").map((d, i) => (
                          <div key={i} className="flex items-center gap-2 py-[7px]" style={{ borderBottom: i < c.diasData.filter(x => x.estado !== "futuro").length - 1 ? `1px solid ${"var(--color-border)"}` : "none" }}>
                            <div className="w-[22px] h-[22px] rounded-md text-[10px] font-bold flex items-center justify-center" style={{ background: `${d.color}22`, color: d.color }}>{d.icon}</div>
                            <div className="w-10 text-[11px] font-semibold text-gypi-text">{d.fecha.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit" })}</div>
                            <div className="flex-1 text-[11px] text-gypi-dim truncate">{d.detalle || d.estado}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ═══ TAB EXPORTAR ═══ */
        <>
          <div className="rounded-2xl p-[18px] border border-gypi-border mb-4" style={{ background: `linear-gradient(135deg, ${VIOLET}12, ${"var(--color-surface)"})` }}>
            <div className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: VIOLET }}>EXPORTAR REPORTES</div>
            <div className="text-[13px] text-gypi-text mt-1.5 leading-normal">Generá reportes del periodo <strong style={{ color: AMBER }}>{labelPeriodo}</strong> para la división <strong style={{ color: AMBER }}>{division === "todas" ? "Todas" : division}</strong>.</div>
          </div>

          {/* Resumen cumplimiento */}
          <div className="bg-gypi-surface rounded-2xl p-4 border border-gypi-border mb-3">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: `${GREEN}22`, color: GREEN }}>📊</div>
              <div className="flex-1">
                <div className="text-[13px] font-bold text-gypi-text">Resumen de cumplimiento</div>
                <div className="text-[11px] text-gypi-dim mt-0.5">Asistencia, ausencias, tardanzas y horas por empleado</div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleExportCSV} disabled={exporting === "csv"} className="flex-1 py-3 rounded-xl text-xs font-bold font-body cursor-pointer flex items-center justify-center gap-1.5" style={{ border: `1px solid ${GREEN}30`, background: `${GREEN}12`, color: GREEN }}>{exporting === "csv" ? "⏳" : "📄"} CSV / Excel</button>
              <button onClick={handleExportPDF} disabled={exporting === "pdf"} className="flex-1 py-3 rounded-xl text-xs font-bold font-body cursor-pointer flex items-center justify-center gap-1.5" style={{ border: `1px solid ${RED}30`, background: `${RED}12`, color: RED }}>{exporting === "pdf" ? "⏳" : "🖼"} Reporte visual</button>
            </div>
          </div>

          {/* Detalle fichadas */}
          <div className="bg-gypi-surface rounded-2xl p-4 border border-gypi-border mb-3">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: `${CYAN}22`, color: CYAN }}>🕐</div>
              <div className="flex-1">
                <div className="text-[13px] font-bold text-gypi-text">Detalle de fichadas</div>
                <div className="text-[11px] text-gypi-dim mt-0.5">Cada día de cada empleado: horario esperado vs real, tardanza</div>
              </div>
            </div>
            <button onClick={handleExportDetalleCSV} disabled={exporting === "detalle"} className="w-full py-3 rounded-xl text-xs font-bold font-body cursor-pointer flex items-center justify-center gap-1.5" style={{ border: `1px solid ${CYAN}30`, background: `${CYAN}12`, color: CYAN }}>{exporting === "detalle" ? "⏳ Generando..." : "📄 Exportar detalle completo (CSV)"}</button>
          </div>

          {/* Preview */}
          <div className="bg-gypi-surface rounded-2xl p-4 border border-gypi-border mb-3">
            <div className="text-xs font-bold text-gypi-text font-heading mb-3">Preview del periodo</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="py-2.5 text-center rounded-[10px]" style={{ background: `${GREEN}10` }}>
                <div className="font-heading text-[22px] font-bold text-gypi-green">{metricas.pctPromedio}%</div>
                <div className="text-[10px] text-gypi-dim mt-0.5">Asistencia prom.</div>
              </div>
              <div className="py-2.5 text-center rounded-[10px]" style={{ background: `${pctColor(metricas.pctHorasPromedio)}10` }}>
                <div className="font-heading text-[22px] font-bold" style={{ color: pctColor(metricas.pctHorasPromedio) }}>{metricas.pctHorasPromedio}%</div>
                <div className="text-[10px] text-gypi-dim mt-0.5">Cumpl. horas</div>
              </div>
              <div className="py-2.5 text-center rounded-[10px]" style={{ background: `${RED}10` }}>
                <div className="font-heading text-[22px] font-bold text-gypi-red">{metricas.totalAusencias}</div>
                <div className="text-[10px] text-gypi-dim mt-0.5">Ausencias totales</div>
              </div>
              <div className="py-2.5 text-center rounded-[10px]" style={{ background: `${AMBER}10` }}>
                <div className="font-heading text-[22px] font-bold text-gypi-amber">{metricas.totalTardanzas}</div>
                <div className="text-[10px] text-gypi-dim mt-0.5">Tardanzas totales</div>
              </div>
            </div>
            <div className="mt-3 text-[11px] text-gypi-dim text-center">{metricas.total} empleados · {metricas.perfectos} con asistencia perfecta</div>
          </div>
        </>
      )}
    </div>
  );
}
