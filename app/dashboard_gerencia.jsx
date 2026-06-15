import { useState, useEffect, useCallback, useMemo } from "react";
import { C, fH, fB, fM, fmtTime, fmtDate, DIAS_KEY } from "./lib/theme";
import { sb } from "./lib/supabase";
import TrialBanner from "./components/TrialBanner";
import BillingScreen from "./components/BillingScreen";
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
      <div className="card-hover" style={{
        background: C.surface, borderRadius: "var(--radius-lg)", padding: "var(--sp-4)", border: `1px solid ${C.border}`, marginBottom: "var(--sp-4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ font: "var(--text-caption)", fontWeight: 700, color: C.text, fontFamily: fH }}>Reportes de Obra (Hoy)</div>
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
export default function DashboardGerencia({ goto, ctx, reload, logout, empresa }) {
  const DIVISIONES = getDivisionesConTodas();
  const [division, setDivision] = useState("todas");
  const [tab, setTab] = useState("resumen"); // resumen | asistencia | produccion | solicitudes
  const [resumenProd, setResumenProd] = useState([]);
  const [fichadasSemana, setFichadasSemana] = useState([]);
  const [fichadasMes, setFichadasMes] = useState([]);
  const [solsAprobadas, setSolsAprobadas] = useState([]);
  const [reportesObra, setReportesObra] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [showBilling, setShowBilling] = useState(false);
  const [scoreDetail, setScoreDetail] = useState(null);
  const [showFullRanking, setShowFullRanking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const _now = new Date();
  const hoy = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,"0")}-${String(_now.getDate()).padStart(2,"0")}`;
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
      const mesInicio = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-01`;

      const [prodData, fichadasSem, fichadasMesData, solsApData, repObra] = await Promise.all([
        sb.get(`v_resumen_diario?fecha=eq.${hoy}&select=*`),
        sb.get(`fichadas?select=legajo,fecha,ingreso,egreso,horas_trabajadas,llegada_tarde,minutos_tarde,empleados(nombre,division)&fecha=gte.${monStr}&order=fecha.asc`),
        sb.get(`fichadas?select=empleado_id,legajo,fecha,horas_trabajadas,llegada_tarde,minutos_tarde&fecha=gte.${mesInicio}&order=fecha.asc`),
        sb.get(`solicitudes?select=empleado_id,legajo,tipo,estado,created_at&estado=eq.aprobado&created_at=gte.${mesInicio}&limit=500`),
        sb.get(`reportes_obra?fecha=eq.${hoy}&order=created_at.desc`),
      ]);
      setResumenProd(prodData || []);
      setFichadasSemana(fichadasSem || []);
      setFichadasMes(fichadasMesData || []);
      setSolsAprobadas(solsApData || []);
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

  // Tardanzas semana
  const tardesEstaSemana = fichadasSemana.filter(f => f.llegada_tarde).length;

  // Promedio horas trabajadas por día esta semana (solo fichadas con egreso registrado)
  const fichadasConHoras = fichadasSemana.filter(f => f.horas_trabajadas && parseFloat(f.horas_trabajadas) > 0);
  const promedioHorasDia = fichadasConHoras.length > 0
    ? (fichadasConHoras.reduce((a, f) => a + parseFloat(f.horas_trabajadas), 0) / fichadasConHoras.length)
    : 0;

  // Ranking mensual de empleados operativos
  const ranking = useMemo(() => {
    const operativos = empleados.filter(e => e.rol === "operativo" && e.area === "produccion" && e.activo !== false);
    if (!operativos.length) return [];

    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = ahora.getMonth();
    const DIAS_SEM = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

    const diasTranscurridos = (() => {
      const dias = [];
      const d = new Date(anio, mes, 1);
      const hoyDate = new Date(anio, mes, ahora.getDate());
      while (d <= hoyDate) { dias.push(new Date(d)); d.setDate(d.getDate() + 1); }
      return dias;
    })();

    return operativos.map(emp => {
      const diag = emp.diagrama || {};
      const horasSemanales = emp.horas_semanales || 45;

      const diasProgramados = diasTranscurridos.filter(d => {
        const key = DIAS_SEM[d.getDay()];
        return diag[key] && diag[key].in;
      }).length;

      const horasDiarias = horasSemanales / Math.max(1, Object.keys(diag).filter(k => diag[k]).length || 5);
      const horasEsperadas = diasProgramados * horasDiarias;

      const fichasEmp = fichadasMes.filter(f => f.empleado_id === emp.id || f.legajo === emp.legajo);
      const diasTrabajados = fichasEmp.length;
      const tardanzas = fichasEmp.filter(f => f.llegada_tarde).length;
      const horasTrabajadas = fichasEmp.reduce((a, f) => a + (parseFloat(f.horas_trabajadas) || 0), 0);
      const horasExtra = Math.max(0, horasTrabajadas - horasEsperadas);

      const solsEmp = solsAprobadas.filter(s =>
        (s.empleado_id === emp.id || s.legajo === emp.legajo) &&
        ["permiso", "vacaciones", "ausencia"].includes(s.tipo)
      );
      const diasPermiso = solsEmp.length;
      const horasPermiso = diasPermiso * horasDiarias;

      const pAsistencia = diasProgramados > 0 ? Math.min(1, diasTrabajados / diasProgramados) : 0;
      const pPuntualidad = diasTrabajados > 0 ? Math.max(0, 1 - (tardanzas / diasTrabajados)) : 0;
      const pDisponibilidad = horasEsperadas > 0 ? Math.max(0, 1 - (horasPermiso / horasEsperadas)) : 1;
      const pEsfuerzo = horasTrabajadas > 0 ? Math.min(1, horasExtra / horasTrabajadas) : 0;

      const score = Math.round(
        (pAsistencia * 40 + pPuntualidad * 25 + pDisponibilidad * 20 + pEsfuerzo * 15)
      );

      return {
        id: emp.id, nombre: emp.nombre, apodo: emp.apodo, legajo: emp.legajo, division: emp.division,
        score: Math.min(100, Math.max(0, score)),
        diasProgramados, diasTrabajados, tardanzas, horasTrabajadas: +horasTrabajadas.toFixed(1),
        horasExtra: +horasExtra.toFixed(1), diasPermiso, horasPermiso: +horasPermiso.toFixed(1),
        horasEsperadas: +horasEsperadas.toFixed(1),
        pAsistencia: Math.round(pAsistencia * 100),
        pPuntualidad: Math.round(pPuntualidad * 100),
        pDisponibilidad: Math.round(pDisponibilidad * 100),
        pEsfuerzo: Math.round(pEsfuerzo * 100),
      };
    }).sort((a, b) => b.score - a.score);
  }, [empleados, fichadasMes, solsAprobadas]);

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
    const urgentes = notificaciones.filter(n => {
      if (n.urgencia !== "alta") return false;
      // Si la notificación tiene solicitud_id, verificar que siga pendiente
      if (n.solicitud_id) {
        const sol = solicitudes.find(s => s.id === n.solicitud_id);
        if (sol && sol.estado !== "pendiente") return false;
      }
      // Si es notificación de permiso/ingreso, verificar que haya solicitudes pendientes relacionadas
      if (n.asunto?.includes("permiso") || n.asunto?.includes("ingreso") || n.asunto?.includes("INGRESO")) {
        if (pendientes.filter(s => s.motivo?.includes("🔓") || s.motivo?.toLowerCase().includes("permiso de ingreso")).length === 0) return false;
      }
      return true;
    });
    urgentes.slice(0, 2).forEach(n => {
      items.push({ icon: "🔴", text: n.asunto, color: C.red, urgencia: "alta", target: n.asunto.includes("BLOQUEADO") || n.asunto.includes("permiso") || n.asunto.includes("ingreso") ? "solicitudes" : null });
    });
    return items;
  }, [ausentes, enEspera, pendientes, notificaciones, permisosIngreso, solicitudes]);

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
  // Instalador = cualquier empleado que hoy hizo un reporte de obra (la tarea es "instalación")
  const legajosConObra = new Set(reportesObra.map(r => r.legajo).filter(Boolean));
  const instaladoresActivos = empActivos.filter(e => legajosConObra.has(e.legajo));
  const instaladoresPresentes = fichadasHoy.filter(f => legajosConObra.has(f.legajo));
  // Taller: el resto (producción sin reporte de obra hoy)
  const tallerProd = resumenProd.filter(r => !legajosConObra.has(r.legajo));
  const obrasHoy = reportesObra.length;
  const obrasConFotos = reportesObra.filter(r => r.fotos_urls && r.fotos_urls.length > 0).length;
  const obrasConFaltantes = reportesObra.filter(r => r.faltantes && r.faltantes.length > 0).length;
  const obrasConDesvios = reportesObra.filter(r => r.desvios && r.desvios.length > 0).length;

  /* ─── Estado expandido de paneles ─── */
  const [panelExpanded, setPanelExpanded] = useState(null); // "taller" | "instalaciones" | null

  /* ═══ RENDER ═══ */
  return (
    <div className="g-fade-in safe-top" style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 16px 110px" }}>

      {/* ─── Header con fecha/hora ─── */}
      <div style={{ marginBottom: 20, paddingTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {empresa?.logo_url&&<img src={empresa.logo_url} alt="" style={{width:44,height:44,borderRadius:14,objectFit:"contain",boxShadow:"0 2px 8px rgba(0,0,0,0.08)"}}/>}
            <div>
            <div style={{ fontSize: 13, color: C.dim, fontWeight: 500 }}>{fmtDate(now)} · {fmtTime(now)}</div>
            <h2 style={{ margin: "2px 0 0", fontFamily: fH, fontSize: 28, fontWeight: 800, color: C.text, letterSpacing: "-0.03em", lineHeight: 1.1 }}>Panel de control</h2>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20, background: `${C.green}10`, border: `1px solid ${C.green}20` }}>
              <PulseDot color={C.green} />
              <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>En vivo</span>
            </div>
            <button onClick={async()=>{setRefreshing(true);try{await Promise.all([reload?.(),cargarDatos()])}finally{setNow(new Date());setRefreshing(false)}}} aria-label="Actualizar datos" style={{width:40,height:40,borderRadius:12,background:C.surface,color:C.dim,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",transition:"transform 0.3s ease",transform:refreshing?"rotate(360deg)":"none"}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={refreshing?C.amber:"currentColor"} strokeWidth="2.5" style={{animation:refreshing?"spin 0.8s linear infinite":"none"}}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
            <button onClick={logout} aria-label="Cerrar sesión" className="show-mobile-only" style={{width:40,height:40,borderRadius:12,background:C.surface,color:C.dim,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* ─── Banner de trial / vencimiento ─── */}
      <TrialBanner onUpgrade={() => setShowBilling(true)} />

      {/* Modal de billing */}
      {showBilling && <BillingScreen onClose={() => setShowBilling(false)} />}

      {/* ─── Alertas activas ─── */}
      {alertas.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {alertas.map((a, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
              background: `${a.color}08`, borderRadius: 14, border: `1.5px solid ${a.color}20`,
              marginBottom: 8, cursor: "pointer",
              boxShadow: `0 2px 8px ${a.color}10`,
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
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

      {/* ─── Solicitudes pendientes ─── */}
      {pendientes.length > 0 && (
      <div style={{
        background: C.surface, borderRadius: "var(--radius-lg)", padding: "var(--sp-4)", border: `1px solid ${C.amber}30`, marginBottom: "var(--sp-4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ font: "var(--text-caption)", fontWeight: 700, color: C.text, fontFamily: fH }}>Solicitudes pendientes</div>
          <Tag color={C.amber}>{pendientes.length} pendientes</Tag>
        </div>

        {/* Últimas pendientes */}
        {pendientes.slice(0, 5).map(s => (
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

        <button onClick={() => goto?.("solicitudes")} style={{
          width: "100%", marginTop: "var(--sp-3)", padding: "var(--sp-3)", borderRadius: "var(--radius-md)",
          background: `${C.violet}12`, border: `1px solid ${C.violet}25`, color: C.violet,
          fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
          📋 Gestionar solicitudes →
        </button>
      </div>
      )}

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
          background: C.surface, borderRadius: "var(--radius-lg)", padding: "var(--sp-4)", border: `1px solid ${C.amber}30`, marginBottom: "var(--sp-4)",
          animation: "fadeIn 0.2s ease",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ font: "var(--text-caption)", fontWeight: 700, color: C.text, fontFamily: fH }}>Producción en vivo</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PulseDot color={enActividad > 0 ? C.green : C.mute} size={6} />
              <span style={{ fontSize: 11, color: C.dim }}>{enActividad} activos</span>
            </div>
          </div>

          {/* Métricas de producción */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.green}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.green }}>{enActividad}</div>
              <div style={{ font: "var(--text-overline)", color: C.dim, textTransform: "uppercase", marginTop: 2 }}>Trabajando</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.amber}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.amber }}>{enEspera}</div>
              <div style={{ font: "var(--text-overline)", color: C.dim, textTransform: "uppercase", marginTop: 2 }}>En espera</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.red}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.red }}>{sinTarea}</div>
              <div style={{ font: "var(--text-overline)", color: C.dim, textTransform: "uppercase", marginTop: 2 }}>Sin tarea</div>
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
              <div style={{ font: "var(--text-label)", color: C.dim, marginBottom: "var(--sp-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Top rendimiento</div>
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
            width: "100%", marginTop: "var(--sp-3)", padding: "var(--sp-3)", borderRadius: "var(--radius-md)",
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
          background: C.surface, borderRadius: "var(--radius-lg)", padding: "var(--sp-4)", border: `1px solid ${C.cyan}30`, marginBottom: "var(--sp-4)",
          animation: "fadeIn 0.2s ease",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ font: "var(--text-caption)", fontWeight: 700, color: C.text, fontFamily: fH }}>Instalaciones hoy</div>
            <Tag color={C.cyan}>{obrasHoy} reportes</Tag>
          </div>

          {/* KPIs de instalaciones */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.cyan}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.cyan }}>{obrasHoy}</div>
              <div style={{ font: "var(--text-overline)", color: C.dim, textTransform: "uppercase", marginTop: 2 }}>Obras reportadas</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.green}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: C.green }}>{obrasConFotos}</div>
              <div style={{ font: "var(--text-overline)", color: C.dim, textTransform: "uppercase", marginTop: 2 }}>Con fotos</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.red}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: obrasConFaltantes > 0 ? C.red : C.green }}>{obrasConFaltantes}</div>
              <div style={{ font: "var(--text-overline)", color: C.dim, textTransform: "uppercase", marginTop: 2 }}>Con faltantes</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.amber}12`, borderRadius: 10 }}>
              <div style={{ fontFamily: fM, fontSize: 16, fontWeight: 700, color: obrasConDesvios > 0 ? C.amber : C.green }}>{obrasConDesvios}</div>
              <div style={{ font: "var(--text-overline)", color: C.dim, textTransform: "uppercase", marginTop: 2 }}>Con desvíos</div>
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
      <div className="card-hover" style={{
        background: C.surface, borderRadius: "var(--radius-lg)", padding: "var(--sp-4)", border: `1px solid ${C.border}`, marginBottom: "var(--sp-4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ font: "var(--text-caption)", fontWeight: 700, color: C.text, fontFamily: fH }}>Asistencia</div>
          <Tag color={C.green}>{presentes}/{programados} hoy</Tag>
        </div>

        {/* Asistencia diaria */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
          <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.green}10`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.green }}>{presentes}</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Presentes</div>
          </div>
          <div style={{ textAlign: "center", padding: "10px 6px", background: `${C.red}10`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: ausentes > 0 ? C.red : C.green }}>{ausentes}</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Ausentes</div>
          </div>
          <div style={{ textAlign: "center", padding: "10px 6px", background: `${pctColor(pctAsist)}10`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: pctColor(pctAsist) }}>{pctAsist}%</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Cumplim.</div>
          </div>
          <div style={{ textAlign: "center", padding: "10px 6px", background: tardesEstaSemana > 0 ? `${C.amber}10` : `${C.green}05`, borderRadius: 10 }}>
            <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: tardesEstaSemana > 0 ? C.amber : C.green }}>{tardesEstaSemana}</div>
            <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, marginTop: 2 }}>Tardes sem.</div>
          </div>
        </div>

        {/* Asistencia semanal bar chart */}
        <div style={{ font: "var(--text-label)", color: C.dim, marginBottom: "var(--sp-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Asistencia semanal</div>
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

        {/* Promedio horas / día semana */}
        {promedioHorasDia > 0 && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: `${C.cyan}10`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: C.dim, fontWeight: 600 }}>Prom. horas/día semana</span>
            <span style={{ fontFamily: fH, fontSize: 14, fontWeight: 700, color: C.cyan }}>{promedioHorasDia.toFixed(1)}h</span>
          </div>
        )}
      </div>

      {/* ─── Ranking de empleados ─── */}
      {ranking.length > 0 && (() => {
        const top3 = ranking.slice(0, 3);
        const medals = ["🥇", "🥈", "🥉"];
        return (
          <button onClick={() => setShowFullRanking(true)} className="card-hover" style={{
            background: C.surface, borderRadius: "var(--radius-lg)", padding: "var(--sp-4)",
            border: `1px solid ${C.amber}30`, marginBottom: "var(--sp-4)", width: "100%",
            cursor: "pointer", textAlign: "left", display: "block",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 16 }}>🏆</span>
                <div style={{ font: "var(--text-caption)", fontWeight: 700, color: C.text, fontFamily: fH }}>Ranking de empleados</div>
              </div>
              <Tag color={C.amber}>Este mes</Tag>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {top3.map((e, i) => (
                <div key={e.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "6px 4px", borderRadius: 8,
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{medals[i]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.nombre}
                    </div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>
                      {e.division || "Sin división"} · {e.diasTrabajados}d · {e.horasTrabajadas}h · {e.tardanzas === 0 ? "puntual" : `${e.tardanzas} tard.`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.green, fontFamily: fH }}>{e.score}</div>
                    <div style={{ fontSize: 9, color: C.dim, fontWeight: 600 }}>pts</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, textAlign: "center", fontSize: 11, color: C.amber, fontWeight: 600 }}>
              Ver ranking completo ({ranking.length})
            </div>
          </button>
        );
      })()}

      {/* ─── Productividad divisional/general ─── */}
      <div className="card-hover" style={{
        background: C.surface, borderRadius: "var(--radius-lg)", padding: "var(--sp-4)", border: `1px solid ${C.border}`, marginBottom: "var(--sp-4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ font: "var(--text-caption)", fontWeight: 700, color: C.text, fontFamily: fH }}>Productividad</div>
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
      <div className="card-hover" style={{
        background: C.surface, borderRadius: "var(--radius-lg)", padding: "var(--sp-4)", border: `1px solid ${C.border}`, marginBottom: "var(--sp-4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ font: "var(--text-caption)", fontWeight: 700, color: C.text, fontFamily: fH }}>Equipo</div>
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

      </div>

      {/* ─── Jornadas hoy ─── */}
      <div className="card-hover" style={{
        background: C.surface, borderRadius: "var(--radius-lg)", padding: "var(--sp-4)", border: `1px solid ${C.border}`, marginBottom: "var(--sp-4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ font: "var(--text-caption)", fontWeight: 700, color: C.text, fontFamily: fH }}>Jornadas hoy</div>
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

      {/* ─── Full Ranking Modal ─── */}
      {showFullRanking && ranking.length > 0 && (() => {
        const len = ranking.length;
        const rowColor = (i) => {
          if (i === 0) return { bg: `${C.green}18`, border: `${C.green}35` };
          if (i === 1) return { bg: `${C.green}12`, border: `${C.green}25` };
          if (i === 2) return { bg: `${C.green}08`, border: `${C.green}18` };
          if (i === len - 1) return { bg: `${C.red}18`, border: `${C.red}35` };
          if (i === len - 2) return { bg: `${C.red}12`, border: `${C.red}25` };
          if (i === len - 3) return { bg: `${C.red}08`, border: `${C.red}18` };
          return { bg: "transparent", border: `${C.border}` };
        };
        const medals = ["🥇", "🥈", "🥉"];
        return (
          <div onClick={() => setShowFullRanking(false)} style={{
            position: "fixed", inset: 0, zIndex: 999,
            background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, animation: "fadeIn 0.2s ease",
          }}>
            <div onClick={ev => ev.stopPropagation()} style={{
              background: C.surface, borderRadius: 20, width: "100%", maxWidth: 400,
              maxHeight: "80vh", display: "flex", flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
            }}>
              <div style={{ padding: "20px 20px 14px", flexShrink: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, color: C.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Este mes</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.text, fontFamily: fH, marginTop: 2 }}>Ranking de empleados</div>
                  </div>
                  <button onClick={() => setShowFullRanking(false)} style={{
                    width: 32, height: 32, borderRadius: 10, border: "none", background: C.surfHi,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, color: C.dim,
                  }}>✕</button>
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {[
                    { label: "Asistencia", w: "40%", color: C.green },
                    { label: "Puntualidad", w: "25%", color: C.cyan },
                    { label: "Disponibilidad", w: "20%", color: C.violet },
                    { label: "Esfuerzo Extra", w: "15%", color: C.amber },
                  ].map(c => (
                    <span key={c.label} style={{
                      fontSize: 9, fontWeight: 700, padding: "3px 7px", borderRadius: 6,
                      background: `${c.color}12`, color: c.color,
                    }}>{c.label} {c.w}</span>
                  ))}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px", scrollbarWidth: "none" }}>
                {ranking.map((e, i) => {
                  const rc = rowColor(i);
                  return (
                    <button key={e.id} onClick={() => setScoreDetail(e)} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 10px",
                      borderRadius: 10, marginBottom: 4, width: "100%", textAlign: "left",
                      background: rc.bg, border: `1px solid ${rc.border}`,
                      cursor: "pointer", transition: "background 0.15s",
                    }}>
                      <div style={{ width: 24, textAlign: "center", flexShrink: 0, fontSize: i < 3 ? 16 : 12, fontWeight: 700, color: C.dim }}>
                        {i < 3 ? medals[i] : `${i + 1}`}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {e.nombre}
                        </div>
                        <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>
                          {e.division || "Sin división"} · {e.diasTrabajados}d · {e.horasTrabajadas}h · {e.tardanzas === 0 ? "puntual" : `${e.tardanzas} tard.`}{e.diasPermiso > 0 ? ` · ${e.diasPermiso} perm.` : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: i < 3 ? C.green : i >= len - 3 ? C.red : C.text, fontFamily: fH }}>{e.score}</div>
                        <div style={{ fontSize: 9, color: C.dim, fontWeight: 600 }}>pts</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Score Detail Modal ─── */}
      {scoreDetail && (() => {
        const d = scoreDetail;
        const rows = [
          { label: "Asistencia", pct: d.pAsistencia, weight: "40%", detail: `${d.diasTrabajados} / ${d.diasProgramados} días`, color: C.green },
          { label: "Puntualidad", pct: d.pPuntualidad, weight: "25%", detail: d.tardanzas === 0 ? "Sin tardanzas" : `${d.tardanzas} tardanza${d.tardanzas > 1 ? "s" : ""}`, color: C.cyan },
          { label: "Disponibilidad", pct: d.pDisponibilidad, weight: "20%", detail: d.diasPermiso === 0 ? "Sin permisos" : `${d.diasPermiso} permiso${d.diasPermiso > 1 ? "s" : ""}`, color: C.violet },
          { label: "Esfuerzo Extra", pct: d.pEsfuerzo, weight: "15%", detail: `${d.horasExtra}h extra de ${d.horasTrabajadas}h`, color: C.amber },
        ];
        return (
          <div onClick={() => setScoreDetail(null)} style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20, animation: "fadeIn 0.2s ease",
          }}>
            <div onClick={ev => ev.stopPropagation()} style={{
              background: C.surface, borderRadius: 20, padding: 24, width: "100%", maxWidth: 360,
              boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 11, color: C.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Desglose</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.text, fontFamily: fH, marginTop: 2 }}>{d.nombre}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{d.division || "Sin división"} · L-{d.legajo}</div>
                </div>
                <div style={{
                  width: 48, height: 48, borderRadius: 14, background: `${C.amber}12`,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.amber, fontFamily: fH, lineHeight: 1 }}>{d.score}</div>
                  <div style={{ fontSize: 8, color: C.dim, fontWeight: 700 }}>pts</div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rows.map((r) => (
                  <div key={r.label} style={{
                    padding: "10px 12px", background: `${r.color}08`, borderRadius: 10, border: `1px solid ${r.color}15`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{r.label} <span style={{ fontWeight: 500, color: C.dim }}>({r.weight})</span></span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: r.color, fontFamily: fH }}>{r.pct}%</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: `${r.color}15`, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${r.pct}%`, background: r.color, borderRadius: 2, transition: "width 0.4s ease" }} />
                    </div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{r.detail}</div>
                  </div>
                ))}
              </div>

              <div style={{
                marginTop: 14, padding: "10px 12px", background: `${C.amber}08`, borderRadius: 10,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                border: `1.5px solid ${C.amber}25`,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Score total (0–100)</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: C.amber, fontFamily: fH }}>{d.score} pts</span>
              </div>

              <div style={{ fontSize: 10, color: C.mute, marginTop: 12, lineHeight: 1.4, textAlign: "center" }}>
                Asist. 40% + Punt. 25% + Disp. 20% + Esfuerzo 15%
              </div>

              <button onClick={() => setScoreDetail(null)} style={{
                marginTop: 16, width: "100%", padding: 12, borderRadius: 12, border: "none",
                background: C.surfHi, color: C.text, fontSize: 14, fontWeight: 700,
                cursor: "pointer", fontFamily: fB,
              }}>Cerrar</button>
            </div>
          </div>
        );
      })()}

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
