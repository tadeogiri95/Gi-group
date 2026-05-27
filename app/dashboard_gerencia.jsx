import { useState, useEffect, useCallback, useMemo } from "react";
import { C, fH, fB, fM, fmtTime, fmtDate, DIAS_KEY } from "./lib/theme";
import { sb } from "./lib/supabase";

/* ═══════════════════════════════════════════════════════
   DASHBOARD GERENCIAL — Vista en tiempo real
   ═══════════════════════════════════════════════════════ */

/* ─── Constantes ─── */
import { getDivisionesConTodas } from "./lib/constants";

const DIAS_SEMANA = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const DIAS_LABEL_SHORT = ["D", "L", "M", "X", "J", "V", "S"];

import { Tag, Chip } from "./components/ui";

/* ─── Helpers ─── */
const fmtMin = (min) => {
  if (!min || min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const pctColor = (pct) => pct >= 80 ? C.green : pct >= 60 ? C.amber : C.red;

/* ─── Mini SVG Bar Chart ─── */
function MiniBarChart({ data, maxVal, color = C.amber, height = 80, barWidth = 16, labels = [] }) {
  const max = maxVal || Math.max(...data, 1);
  const gap = 4;
  const w = data.length * (barWidth + gap) - gap;

  return (
    <div style={{ position: "relative", height: height + 20 }}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ overflow: "visible" }}>
        {data.map((v, i) => {
          const bh = Math.max(2, (v / max) * (height - 4));
          const x = i * (barWidth + gap);
          const y = height - bh;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barWidth} height={bh} rx={4} fill={`${color}${v > 0 ? "CC" : "33"}`} />
              {v > 0 && (
                <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" fill={C.dim} fontSize="9" fontFamily={fM} fontWeight="600">{Math.round(v)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {labels.length > 0 && (
        <div style={{ display: "flex", marginTop: 4 }}>
          {labels.map((l, i) => (
            <div key={i} style={{ width: barWidth + gap, textAlign: "center", fontSize: 9, color: C.mute, fontFamily: fM, fontWeight: 600 }}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Donut Chart ─── */
function DonutChart({ value, total, color = C.green, size = 72, strokeWidth = 7, label }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`${C.border}`} strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.8s ease" }} />
        <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle"
          fill={color} fontSize="16" fontFamily={fH} fontWeight="700">{pct}%</text>
      </svg>
      {label && <div style={{ fontSize: 10, color: C.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>}
    </div>
  );
}

/* ─── Pulse dot ─── */
const PulseDot = ({ color = C.green, size = 8 }) => (
  <span style={{
    display: "inline-block", width: size, height: size, borderRadius: size / 2,
    background: color, boxShadow: `0 0 ${size}px ${color}88`,
    animation: "pulse 2s ease-in-out infinite",
  }} />
);

/* ─── Timeline Row ─── */
function TimelineRow({ nombre, ingreso, egreso, horasTrabajadas, onClick }) {
  const parseH = (t) => { if (!t) return 0; const [h, m] = t.split(":").map(Number); return h + m / 60; };
  const jStart = 7, jEnd = 19, jLen = jEnd - jStart;
  const inH = parseH(ingreso);
  const outH = egreso ? parseH(egreso) : parseH(fmtTime(new Date()));
  const left = Math.max(0, ((inH - jStart) / jLen) * 100);
  const width = Math.min(100 - left, ((outH - inH) / jLen) * 100);

  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", cursor: onClick ? "pointer" : "default" }}>
      <div style={{ width: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, color: C.text }}>{nombre}</div>
      <div style={{ flex: 1, height: 14, background: C.surfHi, borderRadius: 4, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", top: 1, bottom: 1, left: `${left}%`, width: `${width}%`,
          background: egreso ? `${C.green}88` : `linear-gradient(90deg, ${C.green}88, ${C.amber}66)`,
          borderRadius: 3, minWidth: 4,
        }} />
      </div>
      <div style={{ width: 46, textAlign: "right", fontFamily: fM, fontSize: 11, fontWeight: 700, color: egreso ? C.green : C.amber }}>
        {ingreso?.slice(0, 5)}
      </div>
    </div>
  );
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

/* ─── Panel de Reportes de Obra con fotos y detalle expandible ─── */
function ReportesObraPanel({ reportesObra }) {
  const [expandedReport, setExpandedReport] = useState(null);
  const [fotoViewer, setFotoViewer] = useState(null); // { fotos: [], index: 0 }

  return (
    <>
      <div style={{
        background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: fH }}>Reportes de Obra (Hoy)</div>
          {reportesObra.length > 0 && <Tag color={C.cyan}>{reportesObra.length} reportes</Tag>}
        </div>

        {reportesObra.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: C.dim, fontSize: 12 }}>Sin reportes de obra hoy</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reportesObra.map(r => {
              const isExpanded = expandedReport === r.id;
              const tieneFotos = r.fotos_urls && r.fotos_urls.length > 0;

              return (
                <div key={r.id} style={{ background: C.surfHi, borderRadius: 12, border: `1px solid ${isExpanded ? `${C.cyan}30` : C.borderHi}`, overflow: "hidden", transition: "all 0.2s" }}>
                  {/* Header clickeable */}
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

                  {/* Detalle expandido */}
                  {isExpanded && (
                    <div style={{ padding: "0 12px 14px", borderTop: `1px solid ${C.border}` }}>
                      {/* Progreso */}
                      <div style={{ padding: "12px 0 8px" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>✅ Progreso</div>
                        <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{r.progreso || "—"}</div>
                      </div>

                      {/* Faltantes */}
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

                      {/* Desvíos */}
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



                      {/* Fotos */}
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

                      {/* Sin fotos pero dice que adjuntó */}
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
      </div>

      {/* Visor de fotos fullscreen */}
      {fotoViewer && (
        <FotoViewer
          fotos={fotoViewer.fotos}
          index={fotoViewer.index}
          onClose={() => setFotoViewer(null)}
          onNav={(i) => setFotoViewer(prev => ({ ...prev, index: i }))}
        />
      )}
    </>
  );
}


/* ═══════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL: DashboardGerencia
   ═══════════════════════════════════════════════════════ */
export default function DashboardGerencia({ goto, ctx, reload, logout }) {
  const DIVISIONES = getDivisionesConTodas();
  const [division, setDivision] = useState("todas");
  const [tab, setTab] = useState("resumen"); // resumen | asistencia | produccion | solicitudes
  const [resumenProd, setResumenProd] = useState([]);
  const [fichadasSemana, setFichadasSemana] = useState([]);
  const [reportesObra, setReportesObra] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  const hoy = new Date().toISOString().slice(0, 10);
  const empleados = ctx.empleados || [];
  const fichadasHoy = ctx.fichadasHoy || [];
  const solicitudes = ctx.solicitudes || [];
  const notificaciones = ctx.notificaciones || [];

  /* ─── Timer ─── */
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  /* ─── Cargar datos extra del dashboard ─── */
  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
      const monStr = mon.toISOString().split("T")[0];

      const [prodData, fichadasSem, repObra] = await Promise.all([
        sb.get(`v_resumen_diario?fecha=eq.${hoy}&select=*`),
        sb.get(`fichadas?select=legajo,fecha,ingreso,egreso,horas_trabajadas,empleados(nombre,division)&fecha=gte.${monStr}&order=fecha.asc`),
        sb.get(`reportes_obra?fecha=eq.${hoy}&order=created_at.desc`),
      ]);
      setResumenProd(prodData || []);
      setFichadasSemana(fichadasSem || []);
      setReportesObra(repObra || []);
    } catch (e) {
      console.error("Dashboard error:", e);
    } finally {
      setLoading(false);
    }
  }, [hoy]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);
  useEffect(() => { const t = setInterval(cargarDatos, 60000); return () => clearInterval(t); }, [cargarDatos]);

  /* ─── Datos derivados ─── */
  const empActivos = empleados.filter(e => e.activo !== false);
  const totalEmp = empActivos.length;

  // Filtrar por división
  const filterDiv = (arr, divField = "division") =>
    division === "todas" ? arr : arr.filter(r => r[divField] === division);

  const fichadasHoyF = filterDiv(fichadasHoy, "legajo").length > 0
    ? fichadasHoy 
    : fichadasHoy;

  // Producción
  const prodF = filterDiv(resumenProd);
  const enActividad = prodF.filter(r => r.etapa_actual != null && r.etapa_actual > 0).length;
  const enEspera = prodF.filter(r => r.etapa_actual === 0).length;
  const sinTarea = prodF.filter(r => r.etapa_actual == null).length;
  const totalMinProd = prodF.reduce((a, r) => a + (parseFloat(r.minutos_productivos) || 0), 0);
  const totalMinEspera = prodF.reduce((a, r) => a + (parseFloat(r.minutos_espera) || 0), 0);
  const pctProd = (totalMinProd + totalMinEspera) > 0 ? Math.round(totalMinProd * 100 / (totalMinProd + totalMinEspera)) : 0;

  // Solicitudes
  const pendientes = solicitudes.filter(s => s.estado === "pendiente");
  const aprobadas = solicitudes.filter(s => s.estado === "aprobado");
  const rechazadas = solicitudes.filter(s => s.estado === "rechazado");

  // Asistencia: presentes vs programados
  const presentes = fichadasHoy.length;
  const diaKey = DIAS_KEY[now.getDay()];
  const programados = empActivos.filter(e => e.diagrama && e.diagrama[diaKey]).length;
  const ausentes = Math.max(0, programados - presentes);
  const pctAsist = programados > 0 ? Math.round((presentes / programados) * 100) : 0;

  // Fichadas semana — por día para gráfico
  const fichadasPorDia = useMemo(() => {
    const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const dias = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon); d.setDate(d.getDate() + i);
      const ds = d.toISOString().split("T")[0];
      const count = fichadasSemana.filter(f => f.fecha === ds).length;
      dias.push({ fecha: ds, count, label: DIAS_LABEL_SHORT[d.getDay()] });
    }
    return dias;
  }, [fichadasSemana]);

  // Top empleados productivos
  const topProductivos = useMemo(() => {
    return [...prodF]
      .filter(r => (parseFloat(r.minutos_productivos) || 0) > 0)
      .sort((a, b) => (parseFloat(b.pct_productivo) || 0) - (parseFloat(a.pct_productivo) || 0))
      .slice(0, 5);
  }, [prodF]);

  // Alertas activas
  const permisosIngreso = pendientes.filter(s => s.motivo?.includes("🔓") || s.motivo?.toLowerCase().includes("permiso de ingreso") || s.motivo?.toLowerCase().includes("ingreso por bloqueo"));
  const alertas = useMemo(() => {
    const items = [];
    if (permisosIngreso.length > 0) items.push({ icon: "🔓", text: `${permisosIngreso.length} permiso${permisosIngreso.length > 1 ? "s" : ""} de ingreso pendiente${permisosIngreso.length > 1 ? "s" : ""}`, color: C.red, urgencia: "alta", target: "solicitudes" });
    if (ausentes > 0) items.push({ icon: "⚠️", text: `${ausentes} ausente${ausentes > 1 ? "s" : ""} hoy`, color: C.red, urgencia: "alta" });
    if (enEspera > 0) items.push({ icon: "⏸", text: `${enEspera} operario${enEspera > 1 ? "s" : ""} en espera`, color: C.amber, urgencia: "media", target: "ger-actividad" });
    if (pendientes.length > permisosIngreso.length) items.push({ icon: "📋", text: `${pendientes.length - permisosIngreso.length} solicitud${(pendientes.length - permisosIngreso.length) > 1 ? "es" : ""} pendiente${(pendientes.length - permisosIngreso.length) > 1 ? "s" : ""}`, color: C.violet, urgencia: "normal", target: "solicitudes" });
    const urgentes = notificaciones.filter(n => n.urgencia === "alta");
    urgentes.slice(0, 2).forEach(n => {
      items.push({ icon: "🔴", text: n.asunto, color: C.red, urgencia: "alta", target: n.asunto.includes("BLOQUEADO") || n.asunto.includes("permiso") || n.asunto.includes("ingreso") ? "solicitudes" : null });
    });
    return items;
  }, [ausentes, enEspera, pendientes, notificaciones, permisosIngreso]);

  // Productividad por división
  const prodPorDiv = useMemo(() => {
    const map = {};
    resumenProd.forEach(r => {
      if (!map[r.division]) map[r.division] = { prod: 0, espera: 0, count: 0 };
      map[r.division].prod += parseFloat(r.minutos_productivos) || 0;
      map[r.division].espera += parseFloat(r.minutos_espera) || 0;
      map[r.division].count++;
    });
    return DIVISIONES.filter(d => d.id !== "todas").map(d => {
      const data = map[d.id] || { prod: 0, espera: 0, count: 0 };
      const total = data.prod + data.espera;
      return { ...d, ...data, pct: total > 0 ? Math.round(data.prod * 100 / total) : 0 };
    });
  }, [resumenProd]);


  /* ─── Datos de instalaciones ─── */
  const instaladoresActivos = empActivos.filter(e => e.area === "instalacion" || e.division === "instalaciones" || e.rol === "instalador");
  const instaladoresPresentes = fichadasHoy.filter(f => {
    const emp = empActivos.find(e => e.legajo === f.legajo);
    return emp && (emp.area === "instalacion" || emp.division === "instalaciones" || emp.rol === "instalador");
  });
  const obrasHoy = reportesObra.length;
  const obrasConFotos = reportesObra.filter(r => r.fotos_urls && r.fotos_urls.length > 0).length;
  const obrasConFaltantes = reportesObra.filter(r => r.faltantes && r.faltantes.length > 0).length;
  const obrasConDesvios = reportesObra.filter(r => r.desvios && r.desvios.length > 0).length;

  /* ─── Estado expandido de paneles ─── */
  const [panelExpanded, setPanelExpanded] = useState(null); // "taller" | "instalaciones" | null

  /* ═══ RENDER ═══ */
  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px" }}>

      {/* ─── Header con fecha/hora ─── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, color: C.dim }}>{fmtDate(now)} · {fmtTime(now)}</div>
            <h2 style={{ margin: "4px 0 0", fontFamily: fH, fontSize: 26, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>Panel de control</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <PulseDot color={C.green} />
            <span style={{ fontSize: 11, color: C.dim, fontWeight: 600 }}>En vivo</span>
            <button onClick={()=>{if(reload)reload();}} style={{width:32,height:32,borderRadius:8,background:C.surface,color:C.dim,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginLeft:4}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
            <button onClick={logout} style={{width:32,height:32,borderRadius:8,background:C.surface,color:C.dim,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}} title="Cerrar sesión">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* ─── Alertas activas ─── */}
      {alertas.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {alertas.map((a, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              background: `${a.color}10`, borderRadius: 12, border: `1px solid ${a.color}25`,
              marginBottom: 6, cursor: "pointer",
            }} onClick={() => {
              if (a.target) goto?.(a.target);
              else if (a.text.includes("solicitud")) goto?.("solicitudes");
              else if (a.text.includes("espera")) goto?.("ger-actividad");
              else if (a.text.includes("BLOQUEADO") || a.text.includes("permiso") || a.text.includes("ingreso")) goto?.("solicitudes");
            }}>
              <span style={{ fontSize: 14 }}>{a.icon}</span>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: C.text }}>{a.text}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
            </div>
          ))}
        </div>
      )}

      {/* ─── Solicitudes resumen ─── */}
      <div style={{
        background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: fH }}>Solicitudes</div>
          {pendientes.length > 0 && <Tag color={C.amber}>{pendientes.length} pendientes</Tag>}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, textAlign: "center", padding: "8px 0", background: `${C.amber}12`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.amber }}>{pendientes.length}</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Pendientes</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", padding: "8px 0", background: `${C.green}12`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.green }}>{aprobadas.length}</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Aprobadas</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", padding: "8px 0", background: `${C.red}12`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.red }}>{rechazadas.length}</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Rechazadas</div>
          </div>
        </div>

        {/* Últimas pendientes */}
        {pendientes.slice(0, 3).map(s => (
          <div key={s.id} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: C.amber, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.nombre_empleado}</div>
              <div style={{ fontSize: 11, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.motivo}</div>
            </div>
            <Tag color={C.amber}>{s.tipo}</Tag>
          </div>
        ))}

        {pendientes.length > 0 && (
          <button onClick={() => goto?.("solicitudes")} style={{
            width: "100%", marginTop: 10, padding: 10, borderRadius: 10,
            background: `${C.violet}12`, border: `1px solid ${C.violet}25`, color: C.violet,
            fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            📋 Gestionar solicitudes →
          </button>
        )}
      </div>

      {/* ─── Botones Estado Taller / Estado Instalaciones ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setPanelExpanded(panelExpanded === "taller" ? null : "taller")} style={{
          background: panelExpanded === "taller" ? `${C.amber}18` : C.surface,
          border: `1px solid ${panelExpanded === "taller" ? C.amber + "50" : C.border}`,
          padding: "14px 8px", borderRadius: 14, cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8, fontFamily: fB,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: `${C.amber}22`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>🔥</div>
          <span style={{ fontSize: 11, color: panelExpanded === "taller" ? C.amber : C.text, fontWeight: 600 }}>Estado Taller</span>
        </button>
        <button onClick={() => setPanelExpanded(panelExpanded === "instalaciones" ? null : "instalaciones")} style={{
          background: panelExpanded === "instalaciones" ? `${C.cyan}18` : C.surface,
          border: `1px solid ${panelExpanded === "instalaciones" ? C.cyan + "50" : C.border}`,
          padding: "14px 8px", borderRadius: 14, cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8, fontFamily: fB,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: `${C.cyan}22`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>🏗️</div>
          <span style={{ fontSize: 11, color: panelExpanded === "instalaciones" ? C.cyan : C.text, fontWeight: 600 }}>Estado Instalaciones</span>
        </button>
      </div>

      {/* ─── Panel expandido: Estado Taller ─── */}
      {panelExpanded === "taller" && (
        <div style={{
          background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.amber}30`, marginBottom: 14,
          animation: "fadeIn 0.2s ease",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: fH }}>Producción en vivo</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PulseDot color={enActividad > 0 ? C.green : C.mute} size={6} />
              <span style={{ fontSize: 11, color: C.dim }}>{enActividad} activos</span>
            </div>
          </div>

          {/* Métricas de producción */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.green}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.green }}>{enActividad}</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Trabajando</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.amber}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.amber }}>{enEspera}</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>En espera</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.red}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.red }}>{sinTarea}</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Sin tarea</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1, background: `${C.green}08`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase" }}>T. productivo</div>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.green, marginTop: 2 }}>{fmtMin(totalMinProd)}</div>
            </div>
            <div style={{ flex: 1, background: `${C.red}08`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase" }}>T. espera</div>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.red, marginTop: 2 }}>{fmtMin(totalMinEspera)}</div>
            </div>
            <div style={{ flex: 1, background: `${pctColor(pctProd)}08`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase" }}>% Productivo</div>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: pctColor(pctProd), marginTop: 2 }}>{pctProd}%</div>
            </div>
          </div>

          {/* Top rendimiento */}
          {topProductivos.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: C.dim, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Top rendimiento</div>
              {topProductivos.map((op, i) => {
                const pct = parseFloat(op.pct_productivo) || 0;
                return (
                  <div key={op.empleado_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: i < topProductivos.length - 1 ? `1px solid ${C.border}` : "none" }}>
                    <div style={{ width: 20, height: 20, borderRadius: 6, background: i === 0 ? C.amberS : C.surfHi, color: i === 0 ? C.amber : C.dim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, fontFamily: fM }}>{i + 1}</div>
                    <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{op.empleado_nombre}</div>
                    <div style={{ width: 60 }}>
                      <div style={{ height: 4, borderRadius: 2, background: C.surfHi, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 2, background: pctColor(pct), width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </div>
                    <span style={{ fontFamily: fM, fontSize: 12, fontWeight: 700, color: pctColor(pct), width: 36, textAlign: "right" }}>{Math.round(pct)}%</span>
                  </div>
                );
              })}
            </>
          )}

          <button onClick={() => goto?.("ger-actividad")} style={{
            width: "100%", marginTop: 12, padding: 10, borderRadius: 10,
            background: `${C.amber}12`, border: `1px solid ${C.amber}25`, color: C.amber,
            fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            🔥 Ver detalle por operario →
          </button>
        </div>
      )}

      {/* ─── Panel expandido: Estado Instalaciones ─── */}
      {panelExpanded === "instalaciones" && (
        <div style={{
          background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.cyan}30`, marginBottom: 14,
          animation: "fadeIn 0.2s ease",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: fH }}>Instalaciones hoy</div>
            <Tag color={C.cyan}>{obrasHoy} reportes</Tag>
          </div>

          {/* KPIs de instalaciones */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.cyan}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.cyan }}>{obrasHoy}</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Obras reportadas</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.green}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.green }}>{obrasConFotos}</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Con fotos</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.red}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: obrasConFaltantes > 0 ? C.red : C.green }}>{obrasConFaltantes}</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Con faltantes</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.amber}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: obrasConDesvios > 0 ? C.amber : C.green }}>{obrasConDesvios}</div>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Con desvíos</div>
            </div>
          </div>

          {/* Instaladores presentes */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1, background: `${C.green}08`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase" }}>Instaladores activos</div>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.green, marginTop: 2 }}>{instaladoresPresentes.length}</div>
            </div>
            <div style={{ flex: 1, background: `${C.cyan}08`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase" }}>Total instaladores</div>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.cyan, marginTop: 2 }}>{instaladoresActivos.length}</div>
            </div>
          </div>

          {/* Últimos reportes de obra */}
          <ReportesObraPanel reportesObra={reportesObra} />
        </div>
      )}

      {/* ─── Indicadores: Asistencia diaria/semanal ─── */}
      <div style={{
        background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: fH }}>Asistencia</div>
          <Tag color={C.green}>{presentes}/{programados} hoy</Tag>
        </div>

        {/* Asistencia diaria */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1, textAlign: "center", padding: "10px 6px", background: `${C.green}10`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.green }}>{presentes}</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Presentes</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", padding: "10px 6px", background: `${C.red}10`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: ausentes > 0 ? C.red : C.green }}>{ausentes}</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Ausentes</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", padding: "10px 6px", background: `${pctColor(pctAsist)}10`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: pctColor(pctAsist) }}>{pctAsist}%</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Cumplimiento</div>
          </div>
        </div>

        {/* Asistencia semanal bar chart */}
        <div style={{ fontSize: 11, color: C.dim, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Asistencia semanal</div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <MiniBarChart
            data={fichadasPorDia.map(d => d.count)}
            maxVal={programados || 20}
            color={C.green}
            height={70}
            barWidth={28}
            labels={fichadasPorDia.map(d => d.label)}
          />
        </div>
      </div>

      {/* ─── Productividad divisional/general ─── */}
      <div style={{
        background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: fH }}>Productividad</div>
          <Tag color={pctColor(pctProd)}>{pctProd}% general</Tag>
        </div>

        {/* General */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1, textAlign: "center", padding: "10px 6px", background: `${C.amber}10`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: pctColor(pctProd) }}>{pctProd}%</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>General</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", padding: "10px 6px", background: `${C.green}10`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.green }}>{enActividad}</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Trabajando</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", padding: "10px 6px", background: `${C.red}10`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.amber }}>{enEspera + sinTarea}</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Inactivos</div>
          </div>
        </div>

        {/* Por división (donuts) */}
        <div style={{ fontSize: 11, color: C.dim, fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Por división</div>
        <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 12 }}>
          {prodPorDiv.map(d => (
            <DonutChart key={d.id} value={d.prod} total={d.prod + d.espera} color={d.color} size={64} strokeWidth={6} label={d.label} />
          ))}
        </div>
      </div>

      {/* ─── Equipo ─── */}
      <div style={{
        background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: fH }}>Equipo</div>
          <Tag color={C.cyan}>{totalEmp} activos</Tag>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {DIVISIONES.filter(d => d.id !== "todas").map(d => {
            const count = empActivos.filter(e => e.division === d.id).length;
            return (
              <div key={d.id} style={{ flex: 1, textAlign: "center", padding: "8px 4px", background: `${d.color}10`, borderRadius: 10 }}>
                <div style={{ fontSize: 14 }}>{d.icon}</div>
                <div style={{ fontFamily: fM, fontSize: 14, fontWeight: 700, color: d.color, marginTop: 2 }}>{count}</div>
                <div style={{ fontSize: 8, color: C.dim, fontWeight: 600, marginTop: 1 }}>{d.label}</div>
              </div>
            );
          })}
        </div>

        <button onClick={() => goto?.("equipo")} style={{
          width: "100%", padding: 10, borderRadius: 10,
          background: `${C.cyan}12`, border: `1px solid ${C.cyan}25`, color: C.cyan,
          fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
          👥 Gestión de personal →
        </button>
      </div>

      {/* ─── Jornadas hoy ─── */}
      <div style={{
        background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: fH }}>Jornadas hoy</div>
          <span style={{ fontSize: 10, color: C.mute, fontFamily: fM }}>7:00 ——— 19:00</span>
        </div>
        {fichadasHoy.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: C.dim, fontSize: 12 }}>Sin fichadas hoy</div>
        ) : (
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {fichadasHoy.map((f, i) => (
              <TimelineRow
                key={f.legajo || i}
                nombre={f.nombre || `L-${f.legajo}`}
                ingreso={f.ingreso}
                egreso={f.egreso}
                horasTrabajadas={f.horas_trabajadas}
                onClick={() => goto?.("historial-fichajes", f.legajo)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ─── Footer info ─── */}
      <div style={{ textAlign: "center", padding: "8px 0 12px" }}>
        <div style={{ fontSize: 10, color: C.mute }}>
          Actualización automática cada 60s · Último refresh: {fmtTime(now)}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.5); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
