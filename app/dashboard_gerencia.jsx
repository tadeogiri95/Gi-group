import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import { fmtTime, fmtDate, DIAS_KEY } from "./lib/theme";

const AMBER = "var(--color-empresa-primary, #F97316)";
const AMBER_S = "rgba(249,115,22,0.10)";
const GREEN = "#16A34A";
const RED = "#DC2626";
const CYAN = "#0891B2";
const VIOLET = "#7C3AED";
const INDIGO = "#4F46E5";
const MUTE = "var(--color-text-muted)";

import { sb } from "./lib/supabase";
import { hoyArg, ahoraArg, lunesDeLaSemana } from "./lib/dates";
import { calcularScoreEmpleado, PESOS_SCORE } from "./lib/calc";
import TrialBanner from "./components/TrialBanner";
import BillingScreen from "./components/BillingScreen";
import FotoViewer from "./components/FotoViewer";
/* ═══════════════════════════════════════════════════════
   DASHBOARD GERENCIAL — Vista en tiempo real
   ═══════════════════════════════════════════════════════ */

/* ─── Constantes ─── */
import { getDivisionesConTodas } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
// getDemoDashboardData se carga dinámicamente (ver cargarDatos) — nunca debe
// formar parte del bundle para empresas reales.

const DIAS_SEMANA = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const DIAS_LABEL_SHORT = ["D", "L", "M", "X", "J", "V", "S"];

import { Tag } from "./components/ui";

/* ─── Helpers ─── */
const fmtMin = (min) => {
  if (!min || min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const pctColor = (pct) => pct >= 80 ? GREEN : pct >= 60 ? AMBER : RED;

/* ─── Mini SVG Bar Chart ─── */
function MiniBarChart({ data, maxVal, color = AMBER, height = 80, barWidth = 16, labels = [] }) {
  const max = maxVal || Math.max(...data, 1);
  const gap = 4;
  const w = data.length * (barWidth + gap) - gap;

  return (
    <div className="relative" style={{ height: height + 20 }}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ overflow: "visible" }}>
        {data.map((v, i) => {
          const bh = Math.max(2, (v / max) * (height - 4));
          const x = i * (barWidth + gap);
          const y = height - bh;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barWidth} height={bh} rx={4} fill={`${color}${v > 0 ? "CC" : "33"}`} />
              {v > 0 && (
                <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" fill="var(--color-text-muted)" fontSize="9" fontFamily="var(--font-mono)" fontWeight="600">{Math.round(v)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {labels.length > 0 && (
        <div className="flex mt-1">
          {labels.map((l, i) => (
            <div key={i} className="text-center text-gypi-mute font-mono font-semibold" style={{ width: barWidth + gap, fontSize: 9 }}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Donut Chart ─── */
function DonutChart({ value, total, color = GREEN, size = 72, strokeWidth = 7, label }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-[stroke-dashoffset] duration-700 ease-out" />
        <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle"
          fill={color} fontSize="16" fontFamily="var(--font-mono)" fontWeight="700">{pct}%</text>
      </svg>
      {label && <div className="g-overline">{label}</div>}
    </div>
  );
}

/* ─── Pulse dot ─── */
const PulseDot = ({ color = GREEN, size = 8 }) => (
  <span className="inline-block rounded-full animate-[pulse_2s_ease-in-out_infinite]" style={{
    width: size, height: size,
    background: color, boxShadow: `0 0 ${size}px ${color}88`,
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
    <div onClick={onClick} className="flex items-center gap-2.5 py-2" style={{ cursor: onClick ? "pointer" : "default" }}>
      <div className="w-20 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold text-gypi-text">{nombre}</div>
      <div className="flex-1 h-3.5 bg-gypi-surf-hi rounded overflow-hidden relative">
        <div className="absolute top-px bottom-px rounded-[3px] min-w-1" style={{
          left: `${left}%`, width: `${width}%`,
          background: egreso ? `${GREEN}88` : `linear-gradient(90deg, ${GREEN}88, ${AMBER}66)`,
        }} />
      </div>
      <div className="w-[46px] text-right font-mono text-[11px] font-bold" style={{ color: egreso ? GREEN : AMBER }}>
        {ingreso?.slice(0, 5)}
      </div>
    </div>
  );
}


/* ─── Panel de Reportes de Obra con fotos y detalle expandible ─── */
function ReportesObraPanel({ reportesObra }) {
  const [expandedReport, setExpandedReport] = useState(null);
  const [fotoViewer, setFotoViewer] = useState(null); // { fotos: [], index: 0 }

  return (
    <>
      <section aria-label="Reportes de obra" className="card-hover g-card mb-4">
        <div className="flex justify-between items-center mb-3">
          <div className="font-heading font-bold text-gypi-text" style={{ font: "var(--text-caption)" }}>Reportes de Obra (Hoy)</div>
          {reportesObra.length > 0 && <Tag color={CYAN}>{reportesObra.length} reportes</Tag>}
        </div>

        {reportesObra.length === 0 ? (
          <div className="py-5 text-center text-gypi-dim text-xs">Sin reportes de obra hoy</div>
        ) : (
          <div className="flex flex-col gap-2">
            {reportesObra.map(r => {
              const isExpanded = expandedReport === r.id;
              const tieneFotos = r.fotos_urls && r.fotos_urls.length > 0;

              return (
                <div key={r.id} className="rounded-xl overflow-hidden transition-all duration-200" style={{ background: "var(--color-surf-hi)", border: `1px solid ${isExpanded ? `${CYAN}30` : "var(--color-border-hi)"}` }}>
                  {/* Header clickeable */}
                  <div onClick={() => setExpandedReport(isExpanded ? null : r.id)} className="flex items-center gap-2.5 p-3 cursor-pointer">
                    <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-base shrink-0" style={{ background: `${CYAN}18`, color: CYAN }}>&#x1F3D7;&#xFE0F;</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-bold text-gypi-text">{r.nombre}</span>
                        {tieneFotos && <Tag color={CYAN}>&#x1F4F7; {r.fotos_urls.length}</Tag>}
                        {r.faltantes?.length > 0 && <Tag color={RED}>&#x26A0; {r.faltantes.length}</Tag>}
                      </div>
                      <div className="text-[11px] text-gypi-dim mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                        {r.progreso?.slice(0, 60)}{r.progreso?.length > 60 ? "..." : ""}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-[10px] text-gypi-dim">
                        {new Date(r.created_at).toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" className="transition-transform duration-200" style={{ transform: isExpanded ? "rotate(180deg)" : "none" }}><polyline points="6 9 12 15 18 9" /></svg>
                    </div>
                  </div>

                  {/* Detalle expandido */}
                  {isExpanded && (
                    <div className="px-3 pb-3.5 border-t border-gypi-border">
                      {/* Progreso */}
                      <div className="pt-3 pb-2">
                        <div className="g-overline text-gypi-green mb-1.5">&#x2705; Progreso</div>
                        <div className="text-[13px] text-gypi-text leading-relaxed">{r.progreso || "—"}</div>
                      </div>

                      {/* Faltantes */}
                      {r.faltantes?.length > 0 && (
                        <div className="p-2 px-2.5 rounded-[10px] mb-2" style={{ background: `${RED}10`, border: `1px solid ${RED}18` }}>
                          <div className="g-overline text-gypi-red mb-1.5">&#x1F6AB; Faltantes</div>
                          <div className="flex flex-wrap gap-1">
                            {r.faltantes.map((f, i) => (
                              <span key={i} className="px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ background: `${RED}20`, color: RED }}>{f}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Desvios */}
                      {r.desvios?.length > 0 && (
                        <div className="p-2 px-2.5 rounded-[10px] mb-2" style={{ background: `${AMBER}10`, border: `1px solid ${AMBER}18` }}>
                          <div className="g-overline text-gypi-amber mb-1.5">&#x26A0;&#xFE0F; Desvios</div>
                          <div className="flex flex-wrap gap-1">
                            {r.desvios.map((d, i) => (
                              <span key={i} className="px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ background: `${AMBER}20`, color: AMBER }}>{d}</span>
                            ))}
                          </div>
                        </div>
                      )}



                      {/* Fotos */}
                      {tieneFotos && (
                        <div className="py-2">
                          <div className="g-overline text-gypi-cyan mb-2">&#x1F4F7; Fotos ({r.fotos_urls.length})</div>
                          <div className="grid gap-2" style={{ gridTemplateColumns: r.fotos_urls.length === 1 ? "1fr" : "repeat(2, 1fr)" }}>
                            {r.fotos_urls.map((url, i) => (
                              <div key={i} onClick={() => setFotoViewer({ fotos: r.fotos_urls, index: i })} className="cursor-pointer rounded-[10px] overflow-hidden bg-gypi-surface border border-gypi-border relative" style={{ aspectRatio: r.fotos_urls.length === 1 ? "16/9" : "1" }}>
                                <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                                <div className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-semibold">&#x1F50D; Ampliar</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Sin fotos pero dice que adjunto */}
                      {!tieneFotos && r.fotos > 0 && (
                        <div className="p-2 px-2.5 rounded-lg text-[11px] text-gypi-dim" style={{ background: `${MUTE}08` }}>
                          &#x1F4F7; El instalador indico {r.fotos} foto{r.fotos > 1 ? "s" : ""} pero no se subieron correctamente
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

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
export default function DashboardGerencia({ goto, ctx, reload, logout, empresa, isDemo = false }) {
  const { divisiones: divisionesCtx } = useAuth();
  const DIVISIONES = getDivisionesConTodas(divisionesCtx);
  const [division, setDivision] = useState("todas");
  const [tab, setTab] = useState("resumen"); // resumen | asistencia | produccion | solicitudes
  const [resumenProd, setResumenProd] = useState([]);
  const [fichadasSemana, setFichadasSemana] = useState([]);
  const [fichadasMes, setFichadasMes] = useState([]);
  const [solsAprobadas, setSolsAprobadas] = useState([]);
  const [reportesObra, setReportesObra] = useState([]);
  const [docsExigidos, setDocsExigidos] = useState([]);
  const [docsCargados, setDocsCargados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [showBilling, setShowBilling] = useState(false);
  const [scoreDetail, setScoreDetail] = useState(null);
  const [showFullRanking, setShowFullRanking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const hoy = hoyArg();
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
      if (isDemo) {
        const { getDemoDashboardData } = await import("./lib/demoData");
        const d = getDemoDashboardData();
        setResumenProd(d.resumenProd);
        setFichadasSemana(d.fichadasSemana);
        setFichadasMes(d.fichadasMes);
        setSolsAprobadas(d.solsAprobadas);
        setReportesObra(d.reportesObra);
        setLoading(false);
        return;
      }
      const monStr = lunesDeLaSemana(0);
      const mesInicio = hoyArg().slice(0, 7) + "-01";

      const [prodData, fichadasSem, fichadasMesData, solsApData, repObra, docsExig, docsCarg] = await Promise.all([
        sb.get(`v_resumen_diario?fecha=eq.${hoy}&select=*`),
        sb.get(`fichadas?select=legajo,fecha,ingreso,egreso,horas_trabajadas,llegada_tarde,minutos_tarde,empleados(nombre,division)&fecha=gte.${monStr}&order=fecha.asc`),
        sb.get(`fichadas?select=empleado_id,legajo,fecha,horas_trabajadas,llegada_tarde,minutos_tarde&fecha=gte.${mesInicio}&order=fecha.asc`),
        sb.get(`solicitudes?select=empleado_id,legajo,tipo,estado,created_at&estado=eq.aprobado&created_at=gte.${mesInicio}&limit=500`),
        sb.get(`reportes_obra?fecha=eq.${hoy}&order=created_at.desc`),
        sb.get(`documentos_exigidos_empleado?select=empleado_id,tipo_documento_id`),
        sb.get(`documentos_empleado?estado=eq.cargado&select=empleado_id,tipo_documento_id`),
      ]);
      setResumenProd(prodData || []);
      setFichadasSemana(fichadasSem || []);
      setFichadasMes(fichadasMesData || []);
      setSolsAprobadas(solsApData || []);
      setReportesObra(repObra || []);
      setDocsExigidos(docsExig || []);
      setDocsCargados(docsCarg || []);
    } catch (e) {
      console.error("Dashboard error:", e);
    } finally {
      setLoading(false);
    }
  }, [hoy, isDemo]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);
  useEffect(() => { const t = setInterval(cargarDatos, 60000); return () => clearInterval(t); }, [cargarDatos]);

  /* ─── Datos derivados ─── */
  const empActivos = empleados.filter(e => e.activo !== false);
  const totalEmp = empActivos.length;

  // Filtrar por division
  const filterDiv = (arr, divField = "division") =>
    division === "todas" ? arr : arr.filter(r => r[divField] === division);

  // Produccion
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
  const diaKey = ahoraArg().diaKey;
  const programados = empActivos.filter(e => e.diagrama && e.diagrama[diaKey]).length;
  const ausentes = Math.max(0, programados - presentes);
  const pctAsist = programados > 0 ? Math.round((presentes / programados) * 100) : 0;

  // Tardanzas semana
  const tardesEstaSemana = fichadasSemana.filter(f => f.llegada_tarde).length;

  // Promedio horas trabajadas por dia esta semana (solo fichadas con egreso registrado)
  const fichadasConHoras = fichadasSemana.filter(f => f.horas_trabajadas && parseFloat(f.horas_trabajadas) > 0);
  const promedioHorasDia = fichadasConHoras.length > 0
    ? (fichadasConHoras.reduce((a, f) => a + parseFloat(f.horas_trabajadas), 0) / fichadasConHoras.length)
    : 0;

  // Ranking mensual de empleados operativos
  const ranking = useMemo(() => {
    const operativos = empleados.filter(e => e.rol === "operativo" && e.area === "produccion" && e.activo !== false);
    if (!operativos.length) return [];

    const [anio, mesIdx1, dia] = hoyArg().split("-").map(Number);
    const mes = mesIdx1 - 1;
    const DIAS_SEM = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

    const diasTranscurridos = (() => {
      const dias = [];
      const d = new Date(anio, mes, 1);
      const hoyDate = new Date(anio, mes, dia);
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

      const tiposExigidos = new Set(docsExigidos.filter(d => d.empleado_id === emp.id).map(d => d.tipo_documento_id));
      const tiposCargados = new Set(docsCargados.filter(d => d.empleado_id === emp.id).map(d => d.tipo_documento_id));
      const documentosExigidos = tiposExigidos.size;
      const documentosCompletos = [...tiposExigidos].filter(t => tiposCargados.has(t)).length;

      const calculo = calcularScoreEmpleado({
        diasProgramados, diasTrabajados, tardanzas,
        horasTrabajadas, horasExtra, horasPermiso, horasEsperadas,
        documentosExigidos, documentosCompletos,
      });

      return {
        id: emp.id, nombre: emp.nombre, apodo: emp.apodo, legajo: emp.legajo, division: emp.division,
        score: calculo.score,
        diasProgramados, diasTrabajados, tardanzas, horasTrabajadas: +horasTrabajadas.toFixed(1),
        horasExtra: +horasExtra.toFixed(1), diasPermiso, horasPermiso: +horasPermiso.toFixed(1),
        horasEsperadas: +horasEsperadas.toFixed(1),
        pAsistencia: calculo.pAsistencia,
        pPuntualidad: calculo.pPuntualidad,
        pDisponibilidad: calculo.pDisponibilidad,
        pEsfuerzo: calculo.pEsfuerzo,
        pDocumentacion: calculo.pDocumentacion,
        documentosExigidos, documentosCompletos,
      };
    }).sort((a, b) => b.score - a.score);
  }, [empleados, fichadasMes, solsAprobadas, docsExigidos, docsCargados]);

  // Fichadas semana — por dia para grafico
  const fichadasPorDia = useMemo(() => {
    const monDate = new Date(lunesDeLaSemana(0) + "T12:00:00");
    const dias = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monDate); d.setDate(d.getDate() + i);
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
  const permisosIngreso = pendientes.filter(s => s.motivo?.includes("\u{1F513}") || s.motivo?.toLowerCase().includes("permiso de ingreso") || s.motivo?.toLowerCase().includes("ingreso por bloqueo"));
  const alertas = useMemo(() => {
    const items = [];
    if (permisosIngreso.length > 0) items.push({ icon: "\u{1F513}", text: `${permisosIngreso.length} permiso${permisosIngreso.length > 1 ? "s" : ""} de ingreso pendiente${permisosIngreso.length > 1 ? "s" : ""}`, color: RED, urgencia: "alta", target: "solicitudes" });
    if (ausentes > 0) items.push({ icon: "⚠️", text: `${ausentes} ausente${ausentes > 1 ? "s" : ""} hoy`, color: RED, urgencia: "alta" });
    if (enEspera > 0) items.push({ icon: "⏸", text: `${enEspera} operario${enEspera > 1 ? "s" : ""} en espera`, color: AMBER, urgencia: "media", target: "ger-actividad" });
    if (pendientes.length > permisosIngreso.length) items.push({ icon: "\u{1F4CB}", text: `${pendientes.length - permisosIngreso.length} solicitud${(pendientes.length - permisosIngreso.length) > 1 ? "es" : ""} pendiente${(pendientes.length - permisosIngreso.length) > 1 ? "s" : ""}`, color: VIOLET, urgencia: "normal", target: "solicitudes" });
    const urgentes = notificaciones.filter(n => {
      if (n.urgencia !== "alta") return false;
      // Si la notificacion tiene solicitud_id, verificar que siga pendiente
      if (n.solicitud_id) {
        const sol = solicitudes.find(s => s.id === n.solicitud_id);
        if (sol && sol.estado !== "pendiente") return false;
      }
      // Si es notificacion de permiso/ingreso, verificar que haya solicitudes pendientes relacionadas
      if (n.asunto?.includes("permiso") || n.asunto?.includes("ingreso") || n.asunto?.includes("INGRESO")) {
        if (pendientes.filter(s => s.motivo?.includes("\u{1F513}") || s.motivo?.toLowerCase().includes("permiso de ingreso")).length === 0) return false;
      }
      return true;
    });
    urgentes.slice(0, 2).forEach(n => {
      items.push({ icon: "\u{1F534}", text: n.asunto, color: RED, urgencia: "alta", target: n.asunto.includes("BLOQUEADO") || n.asunto.includes("permiso") || n.asunto.includes("ingreso") ? "solicitudes" : null });
    });
    return items;
  }, [ausentes, enEspera, pendientes, notificaciones, permisosIngreso, solicitudes]);

  // Productividad por division
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
  // Instalador = cualquier empleado que hoy hizo un reporte de obra (la tarea es "instalacion")
  const legajosConObra = new Set(reportesObra.map(r => r.legajo).filter(Boolean));
  const instaladoresActivos = empActivos.filter(e => legajosConObra.has(e.legajo));
  const instaladoresPresentes = fichadasHoy.filter(f => legajosConObra.has(f.legajo));
  // Taller: el resto (produccion sin reporte de obra hoy)
  const tallerProd = resumenProd.filter(r => !legajosConObra.has(r.legajo));
  const obrasHoy = reportesObra.length;
  const obrasConFotos = reportesObra.filter(r => r.fotos_urls && r.fotos_urls.length > 0).length;
  const obrasConFaltantes = reportesObra.filter(r => r.faltantes && r.faltantes.length > 0).length;
  const obrasConDesvios = reportesObra.filter(r => r.desvios && r.desvios.length > 0).length;

  /* ─── Estado expandido de paneles ─── */
  const [panelExpanded, setPanelExpanded] = useState(null); // "taller" | "instalaciones" | null

  /* ═══ RENDER ═══ */
  return (
    <div className="g-fade-in safe-top font-body flex-1 overflow-y-auto px-4 pb-28">

      {/* ─── Header con fecha/hora ─── */}
      <header className="mb-5 pt-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            {empresa?.logo_url && <Image src={empresa.logo_url} alt="" width={44} height={44} className="rounded-[14px] object-contain shadow-sm" />}
            <div>
              <div className="text-[13px] text-gypi-dim font-medium">{fmtDate(now)} &middot; {fmtTime(now)}</div>
              <h2 className="mt-0.5 font-heading text-[28px] font-extrabold text-gypi-text tracking-tight leading-none">Panel de control</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: `${GREEN}10`, border: `1px solid ${GREEN}20` }}>
              <PulseDot color={GREEN} />
              <span className="text-[11px] text-gypi-green font-bold">En vivo</span>
            </div>
            <button
              onClick={async () => { setRefreshing(true); try { await Promise.all([reload?.(), cargarDatos()]) } finally { setNow(new Date()); setRefreshing(false) } }}
              aria-label="Actualizar datos"
              className="w-10 h-10 rounded-xl bg-gypi-surface text-gypi-dim border border-gypi-border flex items-center justify-center cursor-pointer shadow-sm transition-transform duration-300"
              style={{ transform: refreshing ? "rotate(360deg)" : "none" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={refreshing ? AMBER : "currentColor"} strokeWidth="2.5" style={{ animation: refreshing ? "spin 0.8s linear infinite" : "none" }}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
            </button>
            <button onClick={logout} aria-label="Cerrar sesion" className="w-10 h-10 rounded-xl bg-gypi-surface text-gypi-dim border border-gypi-border flex items-center justify-center cursor-pointer shadow-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* ─── Banner de trial / vencimiento ─── */}
      <TrialBanner onUpgrade={() => setShowBilling(true)} />

      {/* Modal de billing */}
      {showBilling && <BillingScreen onClose={() => setShowBilling(false)} />}

      {/* ─── Alertas activas ─── */}
      {alertas.length > 0 && (
        <section aria-label="Alertas activas" className="mb-4">
          {alertas.map((a, i) => (
            <div key={i}
              className="flex items-center gap-3 px-3.5 py-3 rounded-[14px] mb-2 cursor-pointer transition-[transform,box-shadow] duration-150 ease-out"
              style={{
                background: `${a.color}08`, border: `1.5px solid ${a.color}20`,
                boxShadow: `0 2px 8px ${a.color}10`,
              }}
              onClick={() => {
                if (a.target) goto?.(a.target);
                else if (a.text.includes("solicitud")) goto?.("solicitudes");
                else if (a.text.includes("espera")) goto?.("ger-actividad");
                else if (a.text.includes("BLOQUEADO") || a.text.includes("permiso") || a.text.includes("ingreso")) goto?.("solicitudes");
              }}
            >
              <span className="text-sm">{a.icon}</span>
              <span className="flex-1 text-xs font-semibold text-gypi-text">{a.text}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
            </div>
          ))}
        </section>
      )}

      {/* ─── Solicitudes pendientes ─── */}
      {pendientes.length > 0 && (
        <section aria-label="Solicitudes pendientes" className="g-card mb-4" style={{ borderColor: `${AMBER}30` }}>
          <div className="flex justify-between items-center mb-3">
            <div className="font-heading font-bold text-gypi-text" style={{ font: "var(--text-caption)" }}>Solicitudes pendientes</div>
            <Tag color={AMBER}>{pendientes.length} pendientes</Tag>
          </div>

          {/* Ultimas pendientes */}
          {pendientes.slice(0, 5).map(s => (
            <div key={s.id} className="flex items-center gap-2.5 py-2 border-b border-gypi-border">
              <div className="w-1.5 h-1.5 rounded-full bg-gypi-amber shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-gypi-text overflow-hidden text-ellipsis whitespace-nowrap">{s.nombre_empleado}</div>
                <div className="text-[11px] text-gypi-dim overflow-hidden text-ellipsis whitespace-nowrap">{s.motivo}</div>
              </div>
              <Tag color={AMBER}>{s.tipo}</Tag>
            </div>
          ))}

          <button onClick={() => goto?.("solicitudes")}
            className="w-full mt-3 p-3 rounded-[var(--radius-md)] font-body text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
            style={{ background: `${VIOLET}12`, border: `1px solid ${VIOLET}25`, color: VIOLET }}
          >
            &#x1F4CB; Gestionar solicitudes &rarr;
          </button>
        </section>
      )}

      {/* ─── Botones Estado Taller / Estado Instalaciones ─── */}
      <div className="grid grid-cols-2 gap-2 mb-3.5">
        <button onClick={() => setPanelExpanded(panelExpanded === "taller" ? null : "taller")}
          className="p-3.5 px-2 rounded-[14px] cursor-pointer flex flex-col items-center gap-2 font-body"
          style={{
            background: panelExpanded === "taller" ? `${AMBER}18` : "var(--color-surface)",
            border: `1px solid ${panelExpanded === "taller" ? AMBER + "50" : "var(--color-border)"}`,
          }}
        >
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-lg" style={{ background: `${AMBER}22` }}>&#x1F525;</div>
          <span className="text-[11px] font-semibold" style={{ color: panelExpanded === "taller" ? AMBER : "var(--color-text)" }}>Estado Taller</span>
        </button>
        <button onClick={() => setPanelExpanded(panelExpanded === "instalaciones" ? null : "instalaciones")}
          className="p-3.5 px-2 rounded-[14px] cursor-pointer flex flex-col items-center gap-2 font-body"
          style={{
            background: panelExpanded === "instalaciones" ? `${CYAN}18` : "var(--color-surface)",
            border: `1px solid ${panelExpanded === "instalaciones" ? CYAN + "50" : "var(--color-border)"}`,
          }}
        >
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-lg" style={{ background: `${CYAN}22` }}>&#x1F3D7;&#xFE0F;</div>
          <span className="text-[11px] font-semibold" style={{ color: panelExpanded === "instalaciones" ? CYAN : "var(--color-text)" }}>Estado Instalaciones</span>
        </button>
      </div>

      {/* ─── Panel expandido: Estado Taller ─── */}
      {panelExpanded === "taller" && (
        <section aria-label="Estado taller" className="g-card mb-4 animate-[fadeIn_0.2s_ease]" style={{ borderColor: `${AMBER}30` }}>
          <div className="flex justify-between items-center mb-3">
            <div className="font-heading font-bold text-gypi-text" style={{ font: "var(--text-caption)" }}>Produccion en vivo</div>
            <div className="flex items-center gap-1.5">
              <PulseDot color={enActividad > 0 ? GREEN : MUTE} size={6} />
              <span className="text-[11px] text-gypi-dim">{enActividad} activos</span>
            </div>
          </div>

          {/* Metricas de produccion */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="g-kpi" style={{ background: `${GREEN}12` }}>
              <div className="font-mono text-base font-bold" style={{ color: GREEN }}>{enActividad}</div>
              <div className="g-kpi-label">Trabajando</div>
            </div>
            <div className="g-kpi" style={{ background: `${AMBER}12` }}>
              <div className="font-mono text-base font-bold" style={{ color: AMBER }}>{enEspera}</div>
              <div className="g-kpi-label">En espera</div>
            </div>
            <div className="g-kpi" style={{ background: `${RED}12` }}>
              <div className="font-mono text-base font-bold" style={{ color: RED }}>{sinTarea}</div>
              <div className="g-kpi-label">Sin tarea</div>
            </div>
          </div>

          <div className="flex gap-2 mb-3">
            <div className="flex-1 rounded-[10px] px-3 py-2.5" style={{ background: `${GREEN}08` }}>
              <div className="g-overline">T. productivo</div>
              <div className="font-mono text-base font-bold mt-0.5" style={{ color: GREEN }}>{fmtMin(totalMinProd)}</div>
            </div>
            <div className="flex-1 rounded-[10px] px-3 py-2.5" style={{ background: `${RED}08` }}>
              <div className="g-overline">T. espera</div>
              <div className="font-mono text-base font-bold mt-0.5" style={{ color: RED }}>{fmtMin(totalMinEspera)}</div>
            </div>
            <div className="flex-1 rounded-[10px] px-3 py-2.5" style={{ background: `${pctColor(pctProd)}08` }}>
              <div className="g-overline">% Productivo</div>
              <div className="font-mono text-base font-bold mt-0.5" style={{ color: pctColor(pctProd) }}>{pctProd}%</div>
            </div>
          </div>

          {/* Top rendimiento */}
          {topProductivos.length > 0 && (
            <>
              <div className="g-label mb-2">Top rendimiento</div>
              {topProductivos.map((op, i) => {
                const pct = parseFloat(op.pct_productivo) || 0;
                return (
                  <div key={op.empleado_id} className="flex items-center gap-2.5 py-1.5" style={{ borderBottom: i < topProductivos.length - 1 ? "1px solid var(--color-border)" : "none" }}>
                    <div className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold font-mono" style={{ background: i === 0 ? AMBER_S : "var(--color-surf-hi)", color: i === 0 ? AMBER : "var(--color-text-muted)" }}>{i + 1}</div>
                    <div className="flex-1 text-xs font-semibold text-gypi-text overflow-hidden text-ellipsis whitespace-nowrap">{op.empleado_nombre}</div>
                    <div className="w-[60px]">
                      <div className="h-1 rounded-sm bg-gypi-surf-hi overflow-hidden">
                        <div className="h-full rounded-sm" style={{ background: pctColor(pct), width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </div>
                    <span className="font-mono text-xs font-bold w-9 text-right" style={{ color: pctColor(pct) }}>{Math.round(pct)}%</span>
                  </div>
                );
              })}
            </>
          )}

          <button onClick={() => goto?.("ger-actividad")}
            className="w-full mt-3 p-3 rounded-[var(--radius-md)] font-body text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
            style={{ background: `${AMBER}12`, border: `1px solid ${AMBER}25`, color: AMBER }}
          >
            &#x1F525; Ver detalle por operario &rarr;
          </button>
        </section>
      )}

      {/* ─── Panel expandido: Estado Instalaciones ─── */}
      {panelExpanded === "instalaciones" && (
        <section aria-label="Estado instalaciones" className="g-card mb-4 animate-[fadeIn_0.2s_ease]" style={{ borderColor: `${CYAN}30` }}>
          <div className="flex justify-between items-center mb-3">
            <div className="font-heading font-bold text-gypi-text" style={{ font: "var(--text-caption)" }}>Instalaciones hoy</div>
            <Tag color={CYAN}>{obrasHoy} reportes</Tag>
          </div>

          {/* KPIs de instalaciones */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="g-kpi" style={{ background: `${CYAN}12` }}>
              <div className="font-mono text-base font-bold" style={{ color: CYAN }}>{obrasHoy}</div>
              <div className="g-kpi-label">Obras reportadas</div>
            </div>
            <div className="g-kpi" style={{ background: `${GREEN}12` }}>
              <div className="font-mono text-base font-bold" style={{ color: GREEN }}>{obrasConFotos}</div>
              <div className="g-kpi-label">Con fotos</div>
            </div>
            <div className="g-kpi" style={{ background: `${RED}12` }}>
              <div className="font-mono text-base font-bold" style={{ color: obrasConFaltantes > 0 ? RED : GREEN }}>{obrasConFaltantes}</div>
              <div className="g-kpi-label">Con faltantes</div>
            </div>
            <div className="g-kpi" style={{ background: `${AMBER}12` }}>
              <div className="font-mono text-base font-bold" style={{ color: obrasConDesvios > 0 ? AMBER : GREEN }}>{obrasConDesvios}</div>
              <div className="g-kpi-label">Con desvios</div>
            </div>
          </div>

          {/* Instaladores presentes */}
          <div className="flex gap-2 mb-3">
            <div className="flex-1 rounded-[10px] px-3 py-2.5" style={{ background: `${GREEN}08` }}>
              <div className="g-overline">Instaladores activos</div>
              <div className="font-mono text-base font-bold mt-0.5" style={{ color: GREEN }}>{instaladoresPresentes.length}</div>
            </div>
            <div className="flex-1 rounded-[10px] px-3 py-2.5" style={{ background: `${CYAN}08` }}>
              <div className="g-overline">Total instaladores</div>
              <div className="font-mono text-base font-bold mt-0.5" style={{ color: CYAN }}>{instaladoresActivos.length}</div>
            </div>
          </div>

          {/* Ultimos reportes de obra */}
          <ReportesObraPanel reportesObra={reportesObra} />
        </section>
      )}

      {/* ─── Indicadores: Asistencia diaria/semanal ─── */}
      <section aria-label="Asistencia" className="card-hover g-card mb-4">
        <div className="flex justify-between items-center mb-3.5">
          <div className="font-heading font-bold text-gypi-text" style={{ font: "var(--text-caption)" }}>Asistencia</div>
          <Tag color={GREEN}>{presentes}/{programados} hoy</Tag>
        </div>

        {/* Asistencia diaria */}
        <div className="grid grid-cols-4 gap-2 mb-3.5">
          <div className="g-kpi" style={{ background: `${GREEN}10` }}>
            <div className="font-heading text-[22px] font-bold" style={{ color: GREEN }}>{presentes}</div>
            <div className="g-kpi-label">Presentes</div>
          </div>
          <div className="g-kpi" style={{ background: `${RED}10` }}>
            <div className="font-heading text-[22px] font-bold" style={{ color: ausentes > 0 ? RED : GREEN }}>{ausentes}</div>
            <div className="g-kpi-label">Ausentes</div>
          </div>
          <div className="g-kpi" style={{ background: `${pctColor(pctAsist)}10` }}>
            <div className="font-heading text-[22px] font-bold" style={{ color: pctColor(pctAsist) }}>{pctAsist}%</div>
            <div className="g-kpi-label">Cumplim.</div>
          </div>
          <div className="g-kpi" style={{ background: tardesEstaSemana > 0 ? `${AMBER}10` : `${GREEN}05` }}>
            <div className="font-heading text-[22px] font-bold" style={{ color: tardesEstaSemana > 0 ? AMBER : GREEN }}>{tardesEstaSemana}</div>
            <div className="g-kpi-label">Tardes sem.</div>
          </div>
        </div>

        {/* Asistencia semanal bar chart */}
        <div className="g-label mb-2">Asistencia semanal</div>
        <div className="flex justify-center">
          <MiniBarChart
            data={fichadasPorDia.map(d => d.count)}
            maxVal={programados || 20}
            color={GREEN}
            height={70}
            barWidth={28}
            labels={fichadasPorDia.map(d => d.label)}
          />
        </div>

        {/* Promedio horas / dia semana */}
        {promedioHorasDia > 0 && (
          <div className="mt-2.5 px-3 py-2 rounded-[10px] flex items-center justify-between" style={{ background: `${CYAN}10` }}>
            <span className="text-[11px] text-gypi-dim font-semibold">Prom. horas/dia semana</span>
            <span className="font-heading text-sm font-bold" style={{ color: CYAN }}>{promedioHorasDia.toFixed(1)}h</span>
          </div>
        )}
      </section>

      {/* ─── Ranking de empleados ─── */}
      {ranking.length > 0 && (() => {
        const top3 = ranking.slice(0, 3);
        const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
        return (
          <button onClick={() => setShowFullRanking(true)} className="card-hover g-card mb-4 w-full cursor-pointer text-left block" style={{ borderColor: `${AMBER}30` }}>
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-1.5">
                <span className="text-base">&#x1F3C6;</span>
                <div className="font-heading font-bold text-gypi-text" style={{ font: "var(--text-caption)" }}>Ranking de empleados</div>
              </div>
              <Tag color={AMBER}>Este mes</Tag>
            </div>
            <div className="flex flex-col gap-2">
              {top3.map((e, i) => (
                <div key={e.id} className="flex items-center gap-2.5 px-1 py-1.5 rounded-lg">
                  <span className="text-base shrink-0">{medals[i]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-gypi-text overflow-hidden text-ellipsis whitespace-nowrap">
                      {e.nombre}
                    </div>
                    <div className="text-[10px] text-gypi-dim mt-px">
                      {e.division || "Sin division"} &middot; {e.diasTrabajados}d &middot; {e.horasTrabajadas}h &middot; {e.tardanzas === 0 ? "puntual" : `${e.tardanzas} tard.`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-extrabold text-gypi-green font-heading">{e.score}</div>
                    <div className="text-[9px] text-gypi-dim font-semibold">pts</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 text-center text-[11px] text-gypi-amber font-semibold">
              Ver ranking completo ({ranking.length})
            </div>
          </button>
        );
      })()}

      {/* ─── Productividad divisional/general ─── */}
      <section aria-label="Productividad" className="card-hover g-card mb-4">
        <div className="flex justify-between items-center mb-3.5">
          <div className="font-heading font-bold text-gypi-text" style={{ font: "var(--text-caption)" }}>Productividad</div>
          <Tag color={pctColor(pctProd)}>{pctProd}% general</Tag>
        </div>

        {/* General */}
        <div className="flex gap-2 mb-3.5">
          <div className="flex-1 g-kpi" style={{ background: `${AMBER}10` }}>
            <div className="font-heading text-[22px] font-bold" style={{ color: pctColor(pctProd) }}>{pctProd}%</div>
            <div className="g-kpi-label">General</div>
          </div>
          <div className="flex-1 g-kpi" style={{ background: `${GREEN}10` }}>
            <div className="font-heading text-[22px] font-bold text-gypi-green">{enActividad}</div>
            <div className="g-kpi-label">Trabajando</div>
          </div>
          <div className="flex-1 g-kpi" style={{ background: `${RED}10` }}>
            <div className="font-heading text-[22px] font-bold text-gypi-amber">{enEspera + sinTarea}</div>
            <div className="g-kpi-label">Inactivos</div>
          </div>
        </div>

        {/* Por division (donuts) */}
        <div className="g-label mb-2.5">Por division</div>
        <div className="flex justify-around flex-wrap gap-3">
          {prodPorDiv.map(d => (
            <DonutChart key={d.id} value={d.prod} total={d.prod + d.espera} color={d.color} size={64} strokeWidth={6} label={d.label} />
          ))}
        </div>
      </section>

      {/* ─── Equipo ─── */}
      <section aria-label="Equipo" className="card-hover g-card mb-4">
        <div className="flex justify-between items-center mb-3.5">
          <div className="font-heading font-bold text-gypi-text" style={{ font: "var(--text-caption)" }}>Equipo</div>
          <Tag color={CYAN}>{totalEmp} activos</Tag>
        </div>

        <div className="flex gap-2 mb-3">
          {DIVISIONES.filter(d => d.id !== "todas").map(d => {
            const count = empActivos.filter(e => e.division === d.id).length;
            return (
              <div key={d.id} className="flex-1 text-center px-1 py-2 rounded-[10px]" style={{ background: `${d.color}10` }}>
                <div className="text-sm">{d.icon}</div>
                <div className="font-mono text-sm font-bold mt-0.5" style={{ color: d.color }}>{count}</div>
                <div className="text-[8px] text-gypi-dim font-semibold mt-px">{d.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Jornadas hoy ─── */}
      <section aria-label="Jornadas hoy" className="card-hover g-card mb-4">
        <div className="flex justify-between items-center mb-1.5">
          <div className="font-heading font-bold text-gypi-text" style={{ font: "var(--text-caption)" }}>Jornadas hoy</div>
          <span className="text-[10px] text-gypi-mute font-mono">7:00 ——— 19:00</span>
        </div>
        {fichadasHoy.length === 0 ? (
          <div className="py-5 text-center text-gypi-dim text-xs">Sin fichadas hoy</div>
        ) : (
          <div className="max-h-[200px] overflow-y-auto">
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
      </section>

      {/* ─── Footer info ─── */}
      <footer className="text-center py-2 pb-3">
        <div className="text-[10px] text-gypi-mute">
          Actualizacion automatica cada 60s &middot; Ultimo refresh: {fmtTime(now)}
        </div>
      </footer>

      {/* ─── Full Ranking Modal ─── */}
      {showFullRanking && ranking.length > 0 && (() => {
        const len = ranking.length;
        const rowColor = (i) => {
          if (i === 0) return { bg: `${GREEN}18`, border: `${GREEN}35` };
          if (i === 1) return { bg: `${GREEN}12`, border: `${GREEN}25` };
          if (i === 2) return { bg: `${GREEN}08`, border: `${GREEN}18` };
          if (i === len - 1) return { bg: `${RED}18`, border: `${RED}35` };
          if (i === len - 2) return { bg: `${RED}12`, border: `${RED}25` };
          if (i === len - 3) return { bg: `${RED}08`, border: `${RED}18` };
          return { bg: "transparent", border: "var(--color-border)" };
        };
        const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
        return (
          <div onClick={() => setShowFullRanking(false)}
            className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease]"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
            role="dialog" aria-label="Ranking completo"
          >
            <div onClick={ev => ev.stopPropagation()} className="bg-gypi-surface rounded-[20px] w-full max-w-[400px] max-h-[80vh] flex flex-col shadow-lg">
              <div className="px-5 pt-5 pb-3.5 shrink-0">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="g-overline">Este mes</div>
                    <div className="text-lg font-extrabold text-gypi-text font-heading mt-0.5">Ranking de empleados</div>
                  </div>
                  <button onClick={() => setShowFullRanking(false)} aria-label="Cerrar ranking"
                    className="w-8 h-8 rounded-[10px] border-none bg-gypi-surf-hi cursor-pointer flex items-center justify-center text-base text-gypi-dim"
                  >&#x2715;</button>
                </div>
                <div className="mt-3 flex gap-1 flex-wrap">
                  {[
                    { label: "Asistencia", w: `${PESOS_SCORE.asistencia}%`, color: GREEN },
                    { label: "Puntualidad", w: `${PESOS_SCORE.puntualidad}%`, color: CYAN },
                    { label: "Disponibilidad", w: `${PESOS_SCORE.disponibilidad}%`, color: VIOLET },
                    { label: "Esfuerzo Extra", w: `${PESOS_SCORE.esfuerzo}%`, color: AMBER },
                    { label: "Documentación", w: `${PESOS_SCORE.documentacion}%`, color: INDIGO },
                  ].map(c => (
                    <span key={c.label} className="text-[9px] font-bold px-[7px] py-[3px] rounded-md" style={{ background: `${c.color}12`, color: c.color }}>{c.label} {c.w}</span>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-3 pb-3" style={{ scrollbarWidth: "none" }}>
                {ranking.map((e, i) => {
                  const rc = rowColor(i);
                  return (
                    <button key={e.id} onClick={() => setScoreDetail(e)}
                      className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-[10px] mb-1 w-full text-left cursor-pointer transition-colors duration-150"
                      style={{ background: rc.bg, border: `1px solid ${rc.border}` }}
                    >
                      <div className="w-6 text-center shrink-0 font-bold text-gypi-dim" style={{ fontSize: i < 3 ? 16 : 12 }}>
                        {i < 3 ? medals[i] : `${i + 1}`}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold text-gypi-text overflow-hidden text-ellipsis whitespace-nowrap">
                          {e.nombre}
                        </div>
                        <div className="text-[10px] text-gypi-dim mt-px">
                          {e.division || "Sin division"} &middot; {e.diasTrabajados}d &middot; {e.horasTrabajadas}h &middot; {e.tardanzas === 0 ? "puntual" : `${e.tardanzas} tard.`}{e.diasPermiso > 0 ? ` · ${e.diasPermiso} perm.` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-heading text-[15px] font-extrabold" style={{ color: i < 3 ? GREEN : i >= len - 3 ? RED : "var(--color-text)" }}>{e.score}</div>
                        <div className="text-[9px] text-gypi-dim font-semibold">pts</div>
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
          { label: "Asistencia", pct: d.pAsistencia, weight: `${PESOS_SCORE.asistencia}%`, detail: `${d.diasTrabajados} / ${d.diasProgramados} dias`, color: GREEN },
          { label: "Puntualidad", pct: d.pPuntualidad, weight: `${PESOS_SCORE.puntualidad}%`, detail: d.tardanzas === 0 ? "Sin tardanzas" : `${d.tardanzas} tardanza${d.tardanzas > 1 ? "s" : ""}`, color: CYAN },
          { label: "Disponibilidad", pct: d.pDisponibilidad, weight: `${PESOS_SCORE.disponibilidad}%`, detail: d.diasPermiso === 0 ? "Sin permisos" : `${d.diasPermiso} permiso${d.diasPermiso > 1 ? "s" : ""}`, color: VIOLET },
          { label: "Esfuerzo Extra", pct: d.pEsfuerzo, weight: `${PESOS_SCORE.esfuerzo}%`, detail: `${d.horasExtra}h extra de ${d.horasTrabajadas}h`, color: AMBER },
          { label: "Documentación", pct: d.pDocumentacion, weight: `${PESOS_SCORE.documentacion}%`, detail: d.documentosExigidos === 0 ? "Sin documentos exigidos" : `${d.documentosCompletos} de ${d.documentosExigidos} documentos cargados`, color: INDIGO },
        ];
        return (
          <div onClick={() => setScoreDetail(null)}
            className="fixed inset-0 z-[1000] flex items-center justify-center p-5 animate-[fadeIn_0.2s_ease]"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
            role="dialog" aria-label="Detalle de score"
          >
            <div onClick={ev => ev.stopPropagation()} className="bg-gypi-surface rounded-[20px] p-6 w-full max-w-[360px] shadow-lg">
              <div className="flex justify-between items-center mb-5">
                <div>
                  <div className="g-overline">Desglose</div>
                  <div className="text-lg font-extrabold text-gypi-text font-heading mt-0.5">{d.nombre}</div>
                  <div className="text-[11px] text-gypi-dim mt-0.5">{d.division || "Sin division"} &middot; L-{d.legajo}</div>
                </div>
                <div className="w-12 h-12 rounded-[14px] flex flex-col items-center justify-center" style={{ background: `${AMBER}12` }}>
                  <div className="text-lg font-extrabold font-heading leading-none" style={{ color: AMBER }}>{d.score}</div>
                  <div className="text-[8px] text-gypi-dim font-bold">pts</div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {rows.map((r) => (
                  <div key={r.label} className="px-3 py-2.5 rounded-[10px]" style={{ background: `${r.color}08`, border: `1px solid ${r.color}15` }}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-bold text-gypi-text">{r.label} <span className="font-medium text-gypi-dim">({r.weight})</span></span>
                      <span className="text-sm font-extrabold font-heading" style={{ color: r.color }}>{r.pct}%</span>
                    </div>
                    <div className="h-1 rounded-sm overflow-hidden" style={{ background: `${r.color}15` }}>
                      <div className="h-full rounded-sm transition-[width] duration-400 ease-out" style={{ width: `${r.pct}%`, background: r.color }} />
                    </div>
                    <div className="text-[10px] text-gypi-dim mt-1">{r.detail}</div>
                  </div>
                ))}
              </div>

              <div className="mt-3.5 px-3 py-2.5 rounded-[10px] flex justify-between items-center" style={{ background: `${AMBER}08`, border: `1.5px solid ${AMBER}25` }}>
                <span className="text-xs font-bold text-gypi-text">Score total (0&ndash;100)</span>
                <span className="text-lg font-extrabold font-heading" style={{ color: AMBER }}>{d.score} pts</span>
              </div>

              <div className="text-[10px] text-gypi-mute mt-3 leading-snug text-center">
                Asist. {PESOS_SCORE.asistencia}% + Punt. {PESOS_SCORE.puntualidad}% + Disp. {PESOS_SCORE.disponibilidad}% + Esfuerzo {PESOS_SCORE.esfuerzo}% + Docs. {PESOS_SCORE.documentacion}%
              </div>

              <button onClick={() => setScoreDetail(null)}
                className="mt-4 w-full p-3 rounded-xl border-none bg-gypi-surf-hi text-gypi-text text-sm font-bold cursor-pointer font-body"
              >Cerrar</button>
            </div>
          </div>
        );
      })()}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.5); }
        }
      `}</style>
    </div>
  );
}
