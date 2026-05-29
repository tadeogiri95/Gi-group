import { useState, useEffect, useCallback, useMemo } from "react";
import { C, fH, fB, fM, fmtTime, fmtDate, DIAS_KEY } from "./lib/theme";
import { sb } from "./lib/supabase";

/* ═══════════════════════════════════════════════════════
   REPORTES & CUMPLIMIENTO HORARIO
   Vista gerencial con exportación PDF/Excel
   ═══════════════════════════════════════════════════════ */

const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIAS_LABEL = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
const DIAS_SEMANA_JS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

import { DIVISIONES_CON_TODOS as DIVISIONES } from "./lib/constants";

/* ─── Primitivas UI ─── */
const Tag = ({ color = C.amber, children, style = {} }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: `${color}22`, color, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: fB, ...style }}>{children}</span>
);
const Chip = ({ active, onClick, children, color = C.amber }) => (
  <button onClick={onClick} style={{
    padding: "7px 12px", borderRadius: 20, border: "none", cursor: "pointer",
    background: active ? `${color}22` : C.surface, color: active ? color : C.dim,
    fontSize: 11, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap", transition: "all 0.15s",
  }}>{children}</button>
);

/* ─── Helpers ─── */
const parseHora = (str) => {
  if (!str) return null;
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
};
const fmtHora = (min) => {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
};
const diffMin = (a, b) => (a != null && b != null) ? b - a : null;
const pctColor = (pct) => pct >= 95 ? C.green : pct >= 80 ? C.amber : C.red;

const getWeekDates = (offset = 0) => {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + offset * 7);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
};

const getMonthDates = (year, month) => {
  const dates = [];
  const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    dates.push(new Date(year, month, d));
  }
  return dates;
};

/* ─── Estado de cumplimiento por día ─── */
function calcEstado(diagrama, fecha, fichada) {
  const diaKey = DIAS_SEMANA_JS[fecha.getDay()];
  const esperado = diagrama?.[diaKey];
  const hoy = new Date();
  const esFuturo = fecha > hoy;

  if (esFuturo) return { estado: "futuro", color: C.mute, icon: "·", detalle: "" };

  // Franco programado
  if (!esperado) {
    if (fichada) return { estado: "extra", color: C.cyan, icon: "★", detalle: `Trabajó en franco: ${fichada.ingreso?.slice(0, 5) || "?"} → ${fichada.egreso?.slice(0, 5) || "?"}` };
    return { estado: "franco", color: C.mute, icon: "F", detalle: "Franco" };
  }

  // Día laboral sin fichada
  if (!fichada || !fichada.ingreso) {
    return { estado: "ausente", color: C.red, icon: "✗", detalle: "Ausente" };
  }

  // Calcular desvíos
  const inEsperado = parseHora(esperado.in);
  const outEsperado = parseHora(esperado.out);
  const inReal = parseHora(fichada.ingreso?.slice(0, 5));
  const outReal = fichada.egreso ? parseHora(fichada.egreso.slice(0, 5)) : null;

  const tardanza = inReal != null && inEsperado != null ? Math.max(0, inReal - inEsperado) : 0;
  const salidaTemp = outReal != null && outEsperado != null ? Math.max(0, outEsperado - outReal) : 0;

  const minEsperados = diffMin(inEsperado, outEsperado) || 0;
  const minReales = outReal != null ? diffMin(inReal, outReal) : null;

  let estado = "ok";
  let color = C.green;
  let icon = "✓";
  const detalles = [];

  detalles.push(`${fichada.ingreso?.slice(0, 5)} → ${fichada.egreso?.slice(0, 5) || "en curso"}`);

  if (tardanza > 5) {
    estado = "tardanza";
    color = C.amber;
    icon = "⏰";
    detalles.push(`Tardanza: +${tardanza}min`);
  }
  if (salidaTemp > 5) {
    estado = tardanza > 5 ? "tardanza" : "salida_temp";
    color = C.amber;
    icon = tardanza > 5 ? "⏰" : "↗";
    detalles.push(`Salió ${salidaTemp}min antes`);
  }

  if (minReales != null && minEsperados > 0) {
    const pct = Math.round((minReales / minEsperados) * 100);
    detalles.push(`${fmtHora(minReales)} de ${fmtHora(minEsperados)} (${pct}%)`);
  }

  return { estado, color, icon, detalle: detalles.join(" · "), tardanza, salidaTemp, minEsperados, minReales };
}


/* ─── Exportar CSV (descarga automática) ─── */
function exportCSV(rows, filename) {
  const BOM = "\uFEFF";
  const csv = BOM + rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ─── Exportar PDF (canvas → imagen → descarga) ─── */
function exportPDF(title, headers, rows, meta = "") {
  const W = 842, H = 595; // A4 landscape
  const canvas = document.createElement("canvas");
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);

  // Background
  ctx.fillStyle = "#0C0A09";
  ctx.fillRect(0, 0, W, H);

  // Header bar
  ctx.fillStyle = "#1C1917";
  ctx.fillRect(0, 0, W, 56);

  // Title
  ctx.fillStyle = "#F5F0E8";
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.fillText(title, 24, 36);

  // Meta (fecha, filtro)
  ctx.fillStyle = "#8B8680";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(meta, W - ctx.measureText(meta).width - 24, 36);

  // Table config
  const startY = 76;
  const rowH = 22;
  const colW = Math.min(Math.floor((W - 48) / headers.length), 140);
  const startX = 24;

  // Table headers
  ctx.fillStyle = "#292524";
  ctx.fillRect(startX, startY, colW * headers.length, rowH + 4);
  ctx.fillStyle = "#D4A843";
  ctx.font = "bold 10px system-ui, sans-serif";
  headers.forEach((h, i) => {
    ctx.fillText(String(h).slice(0, 18), startX + i * colW + 6, startY + 15);
  });

  // Table rows
  const maxRows = Math.floor((H - startY - rowH - 40) / rowH);
  rows.slice(0, maxRows).forEach((row, ri) => {
    const y = startY + rowH + 4 + ri * rowH;
    // Alternating bg
    if (ri % 2 === 0) { ctx.fillStyle = "#1C191710"; ctx.fillRect(startX, y, colW * headers.length, rowH); }
    // Row separator
    ctx.strokeStyle = "#292524"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(startX, y + rowH); ctx.lineTo(startX + colW * headers.length, y + rowH); ctx.stroke();

    ctx.font = "11px system-ui, sans-serif";
    row.forEach((cell, ci) => {
      const val = String(cell ?? "—");
      // Color code based on content
      if (val.includes("✓") || val.includes("100%")) ctx.fillStyle = "#4ADE80";
      else if (val.includes("✗") || val.includes("Ausente")) ctx.fillStyle = "#F87171";
      else if (val.includes("⏰") || val.includes("Tardanza")) ctx.fillStyle = "#D4A843";
      else ctx.fillStyle = "#D6D0C4";
      ctx.fillText(val.slice(0, 20), startX + ci * colW + 6, y + 15);
    });
  });

  if (rows.length > maxRows) {
    ctx.fillStyle = "#8B8680";
    ctx.font = "italic 10px system-ui, sans-serif";
    ctx.fillText(`... y ${rows.length - maxRows} filas más (ver Excel para reporte completo)`, startX, H - 20);
  }

  // Footer
  ctx.fillStyle = "#44403C";
  ctx.font = "9px system-ui, sans-serif";
  ctx.fillText(`Gypi · Generado ${new Date().toLocaleString("es-AR")}`, startX, H - 8);

  // Download
  canvas.toBlob(blob => {
    // Convert to PDF-like download (actually high-res PNG, named .pdf won't open as PDF)
    // Better: download as PNG for now, true PDF needs jsPDF
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = title.replace(/[^a-zA-Z0-9áéíóúñ ]/g, "").replace(/ /g, "_") + ".png";
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}


/* ─── Visor de fotos fullscreen ─── */
function FotoViewer({ fotos, index, onClose, onNav }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, width: 40, height: 40, borderRadius: 20, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 20, fontWeight: 700, cursor: "pointer", zIndex: 301 }}>✕</button>
      <div style={{ position: "relative", maxWidth: "92vw", maxHeight: "80vh" }} onClick={e => e.stopPropagation()}>
        <img src={fotos[index]} alt={`Foto ${index + 1}`} style={{ maxWidth: "92vw", maxHeight: "80vh", objectFit: "contain", borderRadius: 12 }} />
      </div>
      {fotos.length > 1 && (
        <div style={{ display: "flex", gap: 12, marginTop: 16 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => onNav(Math.max(0, index - 1))} disabled={index === 0} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: index === 0 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.15)", color: index === 0 ? "#555" : "#fff", fontSize: 16, fontWeight: 700, cursor: index === 0 ? "default" : "pointer" }}>‹ Anterior</button>
          <span style={{ color: "#999", fontSize: 14, display: "flex", alignItems: "center" }}>{index + 1} / {fotos.length}</span>
          <button onClick={() => onNav(Math.min(fotos.length - 1, index + 1))} disabled={index === fotos.length - 1} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: index === fotos.length - 1 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.15)", color: index === fotos.length - 1 ? "#555" : "#fff", fontSize: 16, fontWeight: 700, cursor: index === fotos.length - 1 ? "default" : "pointer" }}>Siguiente ›</button>
        </div>
      )}
    </div>
  );
}

/* ─── Tab de Reportes de Obra ─── */
function ReportesObraTab() {
  const [reportesObra, setReportesObra] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedReport, setExpandedReport] = useState(null);
  const [fotoViewer, setFotoViewer] = useState(null);
  const [fechaFiltro, setFechaFiltro] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await sb.get(`reportes_obra?fecha=eq.${fechaFiltro}&order=created_at.desc`);
        setReportesObra(data || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [fechaFiltro]);

  const cambiarFecha = (dir) => {
    const d = new Date(fechaFiltro + "T12:00:00");
    d.setDate(d.getDate() + dir);
    setFechaFiltro(d.toISOString().slice(0, 10));
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, background: C.surface, borderRadius: 14, padding: "10px 16px", border: `1px solid ${C.border}` }}>
        <button onClick={() => cambiarFecha(-1)} style={{ background: "none", border: "none", color: C.text, cursor: "pointer", fontSize: 18, padding: 4 }}>←</button>
        <span style={{ fontFamily: fH, fontSize: 14, fontWeight: 700, color: C.text }}>
          {new Date(fechaFiltro + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}
        </span>
        <button onClick={() => cambiarFecha(1)} style={{ background: "none", border: "none", color: C.text, cursor: "pointer", fontSize: 18, padding: 4 }}>→</button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: C.dim, fontSize: 13 }}>Cargando reportes...</div>
      ) : reportesObra.length === 0 ? (
        <div style={{ background: C.surface, borderRadius: 14, padding: 40, textAlign: "center", border: `1px solid ${C.border}`, color: C.dim, fontSize: 13 }}>Sin reportes de obra en esta fecha</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Tag color={C.cyan} style={{ alignSelf: "flex-start", marginBottom: 4 }}>{reportesObra.length} reportes</Tag>
          {reportesObra.map(r => {
            const isExpanded = expandedReport === r.id;
            const tieneFotos = r.fotos_urls && r.fotos_urls.length > 0;
            return (
              <div key={r.id} style={{ background: C.surface, borderRadius: 12, border: `1px solid ${isExpanded ? `${C.cyan}30` : C.border}`, overflow: "hidden", transition: "all 0.2s" }}>
                <div onClick={() => setExpandedReport(isExpanded ? null : r.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, cursor: "pointer" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `${C.cyan}18`, color: C.cyan, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🏗️</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.nombre}</span>
                      {tieneFotos && <Tag color={C.cyan}>📷 {r.fotos_urls.length}</Tag>}
                      {r.faltantes?.length > 0 && <Tag color={C.red}>⚠ {r.faltantes.length}</Tag>}
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.progreso?.slice(0, 60)}{r.progreso?.length > 60 ? "..." : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <span style={{ fontSize: 10, color: C.dim }}>
                      {new Date(r.created_at).toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="2" style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ padding: "0 12px 14px", borderTop: `1px solid ${C.border}` }}>
                    <div style={{ padding: "12px 0 8px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>✅ Progreso</div>
                      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{r.progreso || "—"}</div>
                    </div>
                    {r.faltantes?.length > 0 && (
                      <div style={{ padding: "8px 10px", background: `${C.red}10`, borderRadius: 10, border: `1px solid ${C.red}18`, marginBottom: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>🚫 Faltantes</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {r.faltantes.map((f, i) => (
                            <span key={i} style={{ padding: "4px 10px", borderRadius: 8, background: `${C.red}20`, color: C.red, fontSize: 12, fontWeight: 600 }}>{f}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {r.desvios?.length > 0 && (
                      <div style={{ padding: "8px 10px", background: `${C.amber}10`, borderRadius: 10, border: `1px solid ${C.amber}18`, marginBottom: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>⚠️ Desvíos</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {r.desvios.map((d, i) => (
                            <span key={i} style={{ padding: "4px 10px", borderRadius: 8, background: `${C.amber}20`, color: C.amber, fontSize: 12, fontWeight: 600 }}>{d}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {tieneFotos && (
                      <div style={{ padding: "8px 0" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>📷 Fotos ({r.fotos_urls.length})</div>
                        <div style={{ display: "grid", gridTemplateColumns: r.fotos_urls.length === 1 ? "1fr" : "repeat(2, 1fr)", gap: 8 }}>
                          {r.fotos_urls.map((url, i) => (
                            <div key={i} onClick={() => setFotoViewer({ fotos: r.fotos_urls, index: i })} style={{ cursor: "pointer", borderRadius: 10, overflow: "hidden", aspectRatio: r.fotos_urls.length === 1 ? "16/9" : "1", background: C.surface, border: `1px solid ${C.border}`, position: "relative" }}>
                              <img src={url} alt={`Foto ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
                              <div style={{ position: "absolute", bottom: 6, right: 6, padding: "3px 8px", borderRadius: 6, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, fontWeight: 600 }}>🔍 Ampliar</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {!tieneFotos && r.fotos > 0 && (
                      <div style={{ padding: "8px 10px", background: `${C.mute}08`, borderRadius: 8, fontSize: 11, color: C.dim }}>
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

/* ═══════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL
   ═══════════════════════════════════════════════════════ */
export default function ReportesScreen() {
  const [tab, setTab] = useState("cumplimiento"); // cumplimiento | reportes (sin obra)
  const [periodo, setPeriodo] = useState("semana"); // semana | mes
  const [weekOffset, setWeekOffset] = useState(0);
  const [mesYear, setMesYear] = useState(new Date().getFullYear());
  const [mesMes, setMesMes] = useState(new Date().getMonth());
  const [division, setDivision] = useState("todas");
  const [expandedEmp, setExpandedEmp] = useState(null);
  const [empleados, setEmpleados] = useState([]);
  const [fichadas, setFichadas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000); };

  /* ─── Fechas del periodo ─── */
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

  /* ─── Cargar datos ─── */
  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, fichs] = await Promise.all([
        sb.get("empleados?activo=eq.true&select=id,nombre,apodo,legajo,division,area,rol,diagrama&order=nombre.asc"),
        sb.get(`fichadas?fecha=gte.${fechaDesde}&fecha=lte.${fechaHasta}&select=legajo,fecha,ingreso,egreso,horas_trabajadas&order=fecha.asc`),
      ]);
      setEmpleados((emps || []).filter(e => e.rol === "operativo"));
      setFichadas(fichs || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [fechaDesde, fechaHasta]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  /* ─── Filtrar por división ─── */
  const empsFiltrados = division === "todas" ? empleados : empleados.filter(e => e.division === division);

  /* ─── Calcular cumplimiento por empleado ─── */
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
      /* Solo sumar minReales de días con egreso registrado (minReales != null) */
      const diasConEgreso = presentes.filter(d => d.minReales != null);
      const totalMinReales = diasConEgreso.reduce((a, d) => a + d.minReales, 0);
      /* Para días sin egreso, estimar con tiempo transcurrido hasta ahora si es hoy */
      const hoy = new Date().toISOString().slice(0, 10);
      const diasSinEgreso = presentes.filter(d => d.minReales == null);
      const minEstimadosHoy = diasSinEgreso.reduce((a, d) => {
        const f = fichadas.find(f2 => f2.empleado_id === emp.id && f2.fecha === hoy);
        if (f && f.ingreso) {
          const ahora = new Date();
          const ingMin = parseHora(f.ingreso.slice(0, 5));
          const ahoraMin = ahora.getHours() * 60 + ahora.getMinutes();
          return a + Math.max(0, ahoraMin - (ingMin || 0));
        }
        return a;
      }, 0);
      const totalMinRealesAjustado = totalMinReales + minEstimadosHoy;
      const pctCumplimiento = laborales.length > 0 ? Math.round((presentes.length / laborales.length) * 100) : 100;
      const pctHoras = totalMinEsperados > 0 ? Math.round((totalMinRealesAjustado / totalMinEsperados) * 100) : 0;

      return {
        emp,
        diasData,
        laborales: laborales.length,
        presentes: presentes.length,
        tardanzas: tardanzas.length,
        ausencias: ausencias.length,
        extras: extras.length,
        totalMinEsperados,
        totalMinReales: totalMinRealesAjustado,
        pctCumplimiento,
        pctHoras,
        totalTardanzaMin: tardanzas.reduce((a, d) => a + (d.tardanza || 0), 0),
      };
    }).sort((a, b) => a.pctCumplimiento - b.pctCumplimiento);
  }, [empsFiltrados, fechasPeriodo, fichadas]);

  /* ─── Métricas globales ─── */
  const metricas = useMemo(() => {
    const total = cumplimiento.length;
    const pctPromedio = total > 0 ? Math.round(cumplimiento.reduce((a, c) => a + c.pctCumplimiento, 0) / total) : 0;
    /* Solo promediar empleados que tienen horas esperadas > 0 */
    const conHorasEsperadas = cumplimiento.filter(c => c.totalMinEsperados > 0);
    const pctHorasPromedio = conHorasEsperadas.length > 0 ? Math.round(conHorasEsperadas.reduce((a, c) => a + c.pctHoras, 0) / conHorasEsperadas.length) : 0;
    const totalAusencias = cumplimiento.reduce((a, c) => a + c.ausencias, 0);
    const totalTardanzas = cumplimiento.reduce((a, c) => a + c.tardanzas, 0);
    const perfectos = cumplimiento.filter(c => c.pctCumplimiento === 100 && c.tardanzas === 0).length;
    return { total, pctPromedio, pctHorasPromedio, totalAusencias, totalTardanzas, perfectos };
  }, [cumplimiento]);

  /* ─── Exportar ─── */
  const handleExportCSV = () => {
    setExporting("csv");
    const headers = ["Empleado", "Legajo", "División", "Días laborales", "Presentes", "Ausencias", "Tardanzas", "% Asistencia", "Hs esperadas", "Hs reales", "% Horas"];
    const rows = cumplimiento.map(c => [
      c.emp.nombre, c.emp.legajo, c.emp.division || "—",
      c.laborales, c.presentes, c.ausencias, c.tardanzas,
      c.pctCumplimiento + "%", fmtHora(c.totalMinEsperados), fmtHora(c.totalMinReales), c.pctHoras + "%",
    ]);
    exportCSV([headers, ...rows], `Cumplimiento_${labelPeriodo.replace(/ /g, "_")}.csv`);
    showToast("✅ CSV descargado", C.green);
    setTimeout(() => setExporting(null), 1000);
  };

  const handleExportPDF = () => {
    setExporting("pdf");
    const headers = ["Empleado", "Legajo", "Div", "Laborales", "Presentes", "Ausencias", "Tard.", "% Asist.", "% Horas"];
    const rows = cumplimiento.map(c => [
      c.emp.apodo || c.emp.nombre, c.emp.legajo, c.emp.division || "—",
      c.laborales, c.presentes, c.ausencias, c.tardanzas,
      c.pctCumplimiento + "%", c.pctHoras + "%",
    ]);
    exportPDF(`Reporte Cumplimiento — ${labelPeriodo}`, headers, rows, `División: ${division === "todas" ? "Todas" : division} · ${new Date().toLocaleDateString("es-AR")}`);
    showToast("✅ Reporte descargado", C.green);
    setTimeout(() => setExporting(null), 1000);
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
        rows.push([
          c.emp.nombre, c.emp.legajo, d.fechaStr,
          DIAS_LABEL[diaKey] || diaKey, d.estado,
          esperado?.in || "Franco", esperado?.out || "—",
          fichada?.ingreso?.slice(0, 5) || "—", fichada?.egreso?.slice(0, 5) || "—",
          d.tardanza || 0, d.detalle,
        ]);
      });
    });
    exportCSV([headers, ...rows], `Detalle_Fichadas_${labelPeriodo.replace(/ /g, "_")}.csv`);
    showToast("✅ Detalle CSV descargado", C.green);
    setTimeout(() => setExporting(null), 1000);
  };

  /* ─── Nav periodo ─── */
  const navAnterior = () => {
    if (periodo === "semana") setWeekOffset(w => w - 1);
    else { let m = mesMes - 1, y = mesYear; if (m < 0) { m = 11; y--; } setMesMes(m); setMesYear(y); }
  };
  const navSiguiente = () => {
    if (periodo === "semana") setWeekOffset(w => w + 1);
    else { let m = mesMes + 1, y = mesYear; if (m > 11) { m = 0; y++; } setMesMes(m); setMesYear(y); }
  };


  /* ═══ RENDER ═══ */
  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 999,
          padding: "10px 20px", borderRadius: 12, background: toast.color || C.green,
          color: "#000", fontSize: 13, fontWeight: 700, fontFamily: fB,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)", animation: "fadeIn 0.2s ease",
        }}>{toast.msg}</div>
      )}

      {/* Tabs: Cumplimiento / Obra / Exportar */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <Chip active={tab === "cumplimiento"} onClick={() => setTab("cumplimiento")} color={C.amber}>📊 Cumplimiento</Chip>
        <Chip active={tab === "obra"} onClick={() => setTab("obra")} color={C.cyan}>🏗️ Obra</Chip>
        <Chip active={tab === "reportes"} onClick={() => setTab("reportes")} color={C.violet}>📥 Exportar</Chip>
      </div>

      {/* Periodo selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <Chip active={periodo === "semana"} onClick={() => setPeriodo("semana")} color={C.cyan}>Semanal</Chip>
        <Chip active={periodo === "mes"} onClick={() => setPeriodo("mes")} color={C.cyan}>Mensual</Chip>
      </div>

      {/* Nav periodo */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`,
        marginBottom: 14,
      }}>
        <button onClick={navAnterior} style={{ background: "none", border: "none", color: C.text, cursor: "pointer", fontSize: 18, padding: "4px 8px" }}>←</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: fH }}>{labelPeriodo}</div>
        </div>
        <button onClick={navSiguiente} style={{ background: "none", border: "none", color: C.text, cursor: "pointer", fontSize: 18, padding: "4px 8px" }}>→</button>
      </div>

      {/* Filtro división */}
      <div style={{ display: "flex", gap: 5, marginBottom: 14, overflowX: "auto", paddingBottom: 4 }}>
        {DIVISIONES.map(d => (
          <Chip key={d.id} active={division === d.id} onClick={() => setDivision(d.id)} color={d.color || C.amber}>
            {d.label}
          </Chip>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: C.dim, fontSize: 13 }}>Cargando datos...</div>
      ) : tab === "obra" ? (
        <ReportesObraTab />
      ) : tab === "cumplimiento" ? (
        /* ═══ TAB: CUMPLIMIENTO ═══ */
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
            <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, textAlign: "center" }}>
              <div style={{ fontFamily: fH, fontSize: 24, fontWeight: 700, color: pctColor(metricas.pctPromedio) }}>{metricas.pctPromedio}%</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Asistencia</div>
            </div>
            <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, textAlign: "center" }}>
              <div style={{ fontFamily: fH, fontSize: 24, fontWeight: 700, color: C.red }}>{metricas.totalAusencias}</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Ausencias</div>
            </div>
            <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, textAlign: "center" }}>
              <div style={{ fontFamily: fH, fontSize: 24, fontWeight: 700, color: C.amber }}>{metricas.totalTardanzas}</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Tardanzas</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, textAlign: "center" }}>
              <div style={{ fontFamily: fH, fontSize: 20, fontWeight: 700, color: pctColor(metricas.pctHorasPromedio) }}>{metricas.pctHorasPromedio}%</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Cumpl. horas</div>
            </div>
            <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, textAlign: "center" }}>
              <div style={{ fontFamily: fH, fontSize: 20, fontWeight: 700, color: C.green }}>{metricas.perfectos}</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Sin falta ni tard.</div>
            </div>
          </div>

          {/* Tabla de cumplimiento por empleado */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: fH }}>Detalle por empleado</div>
          </div>

          {cumplimiento.length === 0 ? (
            <div style={{ background: C.surface, borderRadius: 14, padding: 30, textAlign: "center", border: `1px solid ${C.border}`, color: C.dim, fontSize: 13 }}>Sin empleados en esta división</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cumplimiento.map(c => {
                const isExpanded = expandedEmp === c.emp.id;
                return (
                  <div key={c.emp.id} style={{
                    background: C.surface, borderRadius: 14, border: `1px solid ${c.ausencias > 0 ? `${C.red}30` : c.tardanzas > 0 ? `${C.amber}30` : C.border}`,
                    overflow: "hidden",
                  }}>
                    {/* Row principal */}
                    <div onClick={() => setExpandedEmp(isExpanded ? null : c.emp.id)} style={{
                      padding: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: `${pctColor(c.pctCumplimiento)}15`,
                        color: pctColor(c.pctCumplimiento),
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: fH, fontSize: 13, fontWeight: 700,
                      }}>{c.pctCumplimiento}%</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.emp.apodo || c.emp.nombre}
                        </div>
                        <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>
                          L-{c.emp.legajo}
                          {c.ausencias > 0 && <span style={{ color: C.red }}> · {c.ausencias} falta{c.ausencias > 1 ? "s" : ""}</span>}
                          {c.tardanzas > 0 && <span style={{ color: C.amber }}> · {c.tardanzas} tard.</span>}
                          {c.extras > 0 && <span style={{ color: C.cyan }}> · {c.extras} extra</span>}
                        </div>
                      </div>
                      {/* Mini grilla semanal (solo en vista semanal) */}
                      {periodo === "semana" && (
                        <div style={{ display: "flex", gap: 3 }}>
                          {c.diasData.map((d, i) => (
                            <div key={i} style={{
                              width: 18, height: 18, borderRadius: 4, fontSize: 9, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              background: `${d.color}22`, color: d.color,
                            }}>{d.icon}</div>
                          ))}
                        </div>
                      )}
                      <span style={{ color: C.dim, fontSize: 12, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
                    </div>

                    {/* Detalle expandido */}
                    {isExpanded && (
                      <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.border}` }}>
                        {/* Métricas del empleado */}
                        <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 12 }}>
                          <div style={{ flex: 1, padding: "8px 0", textAlign: "center", background: `${C.green}12`, borderRadius: 8 }}>
                            <div style={{ fontFamily: fM, fontSize: 14, fontWeight: 700, color: C.green }}>{c.presentes}/{c.laborales}</div>
                            <div style={{ fontSize: 9, color: C.dim }}>Presentes</div>
                          </div>
                          <div style={{ flex: 1, padding: "8px 0", textAlign: "center", background: `${pctColor(c.pctHoras)}12`, borderRadius: 8 }}>
                            <div style={{ fontFamily: fM, fontSize: 14, fontWeight: 700, color: pctColor(c.pctHoras) }}>{c.pctHoras}%</div>
                            <div style={{ fontSize: 9, color: C.dim }}>Horas</div>
                          </div>
                          {c.totalTardanzaMin > 0 && (
                            <div style={{ flex: 1, padding: "8px 0", textAlign: "center", background: `${C.amber}12`, borderRadius: 8 }}>
                              <div style={{ fontFamily: fM, fontSize: 14, fontWeight: 700, color: C.amber }}>{c.totalTardanzaMin}m</div>
                              <div style={{ fontSize: 9, color: C.dim }}>Tard. total</div>
                            </div>
                          )}
                        </div>

                        {/* Lista de días */}
                        {c.diasData.filter(d => d.estado !== "futuro").map((d, i) => (
                          <div key={i} style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "7px 0",
                            borderBottom: i < c.diasData.filter(x => x.estado !== "futuro").length - 1 ? `1px solid ${C.border}` : "none",
                          }}>
                            <div style={{
                              width: 22, height: 22, borderRadius: 6, fontSize: 10, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              background: `${d.color}22`, color: d.color,
                            }}>{d.icon}</div>
                            <div style={{ width: 40, fontSize: 11, fontWeight: 600, color: C.text }}>
                              {d.fecha.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit" })}
                            </div>
                            <div style={{ flex: 1, fontSize: 11, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {d.detalle || d.estado}
                            </div>
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
        <>
          <div style={{
            background: `linear-gradient(135deg, ${C.violet}12, ${C.surface})`,
            borderRadius: 16, padding: 18, border: `1px solid ${C.border}`, marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, color: C.violet, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>EXPORTAR REPORTES</div>
            <div style={{ fontSize: 13, color: C.text, marginTop: 6, lineHeight: 1.5 }}>
              Generá reportes del periodo <strong style={{ color: C.amber }}>{labelPeriodo}</strong> para la división <strong style={{ color: C.amber }}>{division === "todas" ? "Todas" : division}</strong>.
            </div>
          </div>

          {/* Reporte 1: Resumen cumplimiento */}
          <div style={{
            background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: `${C.green}22`, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📊</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Resumen de cumplimiento</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Asistencia, ausencias, tardanzas y horas por empleado</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleExportCSV} disabled={exporting === "csv"} style={{
                flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${C.green}30`,
                background: `${C.green}12`, color: C.green, fontSize: 12, fontWeight: 700,
                fontFamily: fB, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>{exporting === "csv" ? "⏳" : "📄"} CSV / Excel</button>
              <button onClick={handleExportPDF} disabled={exporting === "pdf"} style={{
                flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${C.red}30`,
                background: `${C.red}12`, color: C.red, fontSize: 12, fontWeight: 700,
                fontFamily: fB, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>{exporting === "pdf" ? "⏳" : "🖼"} Reporte visual</button>
            </div>
          </div>

          {/* Reporte 2: Detalle fichadas */}
          <div style={{
            background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: `${C.cyan}22`, color: C.cyan, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🕐</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Detalle de fichadas</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Cada día de cada empleado: horario esperado vs real, tardanza</div>
              </div>
            </div>
            <button onClick={handleExportDetalleCSV} disabled={exporting === "detalle"} style={{
              width: "100%", padding: 12, borderRadius: 12, border: `1px solid ${C.cyan}30`,
              background: `${C.cyan}12`, color: C.cyan, fontSize: 12, fontWeight: 700,
              fontFamily: fB, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>{exporting === "detalle" ? "⏳ Generando..." : "📄 Exportar detalle completo (CSV)"}</button>
          </div>

          {/* Reporte 3: Resumen rápido en pantalla */}
          <div style={{
            background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 12,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: fH, marginBottom: 12 }}>Preview del periodo</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ padding: "10px 0", textAlign: "center", background: `${C.green}10`, borderRadius: 10 }}>
                <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.green }}>{metricas.pctPromedio}%</div>
                <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>Asistencia prom.</div>
              </div>
              <div style={{ padding: "10px 0", textAlign: "center", background: `${pctColor(metricas.pctHorasPromedio)}10`, borderRadius: 10 }}>
                <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: pctColor(metricas.pctHorasPromedio) }}>{metricas.pctHorasPromedio}%</div>
                <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>Cumpl. horas</div>
              </div>
              <div style={{ padding: "10px 0", textAlign: "center", background: `${C.red}10`, borderRadius: 10 }}>
                <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.red }}>{metricas.totalAusencias}</div>
                <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>Ausencias totales</div>
              </div>
              <div style={{ padding: "10px 0", textAlign: "center", background: `${C.amber}10`, borderRadius: 10 }}>
                <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.amber }}>{metricas.totalTardanzas}</div>
                <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>Tardanzas totales</div>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: C.dim, textAlign: "center" }}>
              {metricas.total} empleados · {empsFiltrados.length > 0 ? `${metricas.perfectos} con asistencia perfecta` : ""}
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
