import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import { useRefrescoVisible } from "./hooks/useRefrescoVisible";
import { fmtTime, fmtDate, DIAS_KEY } from "./lib/theme";

// R11: colores por token. El color dice si algo está bien, para atender o mal;
// el de la empresa es solo para lo principal.
const MARCA = "var(--color-empresa-primary)";
const TONO = {
  bien: { txt: "text-gypi-green-ink", fondo: "bg-gypi-green/10", borde: "border-gypi-green/25", relleno: "fill-gypi-green" },
  aviso: { txt: "text-gypi-amber-ink", fondo: "bg-gypi-amber/10", borde: "border-gypi-amber/25", relleno: "fill-gypi-amber" },
  mal: { txt: "text-gypi-red-ink", fondo: "bg-gypi-red/10", borde: "border-gypi-red/25", relleno: "fill-gypi-red" },
  info: { txt: "text-gypi-cyan-ink", fondo: "bg-gypi-cyan/10", borde: "border-gypi-cyan/25", relleno: "fill-gypi-cyan" },
  neutro: { txt: "text-gypi-text", fondo: "bg-gypi-surf-hi", borde: "border-gypi-border", relleno: "fill-gypi-mute" },
};

import { sb, sbGetAll } from "./lib/supabase";
import { hoyArg, ahoraArg, lunesDeLaSemana } from "./lib/dates";
import { calcularScoreEmpleado, PESOS_SCORE } from "./lib/calc";
import TrialBanner from "./components/TrialBanner";
import ChecklistActivacion from "./components/ChecklistActivacion";
import BillingScreen from "./components/BillingScreen";
import { tieneModulo } from "./lib/modulos";
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

import { Tag, EmptyState, Stat } from "./components/ui";
import Icon from "./components/Icon";
import { nombreSolicitud } from "./lib/tiposSolicitud";

/* ─── Helpers ─── */
const fmtMin = (min) => {
  if (!min || min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const tonoPct = (pct) => pct >= 80 ? "bien" : pct >= 60 ? "aviso" : "mal";

/** Título de cada tarjeta del tablero. */
const Titulo = ({ children }) => <h3 className="m-0 font-heading text-[15px] font-bold text-gypi-text">{children}</h3>;

/** Número chico de una tarjeta, con el color de su tono. */
function Dato({ valor, etiqueta, tono = "neutro", grande = false }) {
  return (
    <div className={`g-kpi ${TONO[tono].fondo}`}>
      <div className={`font-heading font-bold ${grande ? "text-[22px]" : "text-base font-mono"} ${TONO[tono].txt}`}>{valor}</div>
      <div className="g-kpi-label">{etiqueta}</div>
    </div>
  );
}

/** Barra de porcentaje: un SVG con el ancho como atributo (sin estilos sueltos). */
function Barra({ pct, tono, alto = 4, className = "" }) {
  return (
    <svg className={`w-full block rounded-sm bg-gypi-surf-hi ${className}`} height={alto} viewBox={`0 0 100 ${alto}`} preserveAspectRatio="none" aria-hidden="true">
      <rect width={Math.max(0, Math.min(pct, 100))} height={alto} rx="1" className={TONO[tono].relleno} />
    </svg>
  );
}

/* ─── Gráfico de barras chico (todo en SVG: barras, números y días) ─── */
function MiniBarChart({ data, maxVal, height = 70, barWidth = 28, labels = [] }) {
  const max = maxVal || Math.max(...data, 1);
  const gap = 4;
  const w = data.length * (barWidth + gap) - gap;
  const alto = height + 18;
  return (
    <svg width={w} height={alto} viewBox={`0 0 ${w} ${alto}`} className="overflow-visible" role="img" aria-label={`Fichadas por día: ${labels.map((l, i) => `${l} ${data[i]}`).join(", ")}`}>
      {data.map((v, i) => {
        const bh = Math.max(2, (v / max) * (height - 4));
        const x = i * (barWidth + gap);
        const y = height - bh;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barWidth} height={bh} rx={4} className="fill-gypi-green" fillOpacity={v > 0 ? 0.8 : 0.2} />
            {v > 0 && <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className="fill-gypi-dim font-mono" fontSize="10" fontWeight="600">{Math.round(v)}</text>}
            {labels[i] && <text x={x + barWidth / 2} y={alto - 2} textAnchor="middle" className="fill-gypi-mute font-mono" fontSize="11" fontWeight="600">{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Dona ─── */
function DonutChart({ value, total, size = 64, strokeWidth = 6, label }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const tono = total > 0 ? tonoPct(pct) : "neutro";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${total > 0 ? `${pct}% del tiempo trabajando` : "sin datos"}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-gypi-border" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`${TONO[tono].relleno.replace("fill-", "stroke-")} transition-[stroke-dashoffset] duration-700 ease-out`} strokeWidth={strokeWidth}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle" className="fill-gypi-text font-mono" fontSize="15" fontWeight="700">{total > 0 ? `${pct}%` : "—"}</text>
      </svg>
      {label && <div className="g-overline">{label}</div>}
    </div>
  );
}

/* ─── Punto que late ("en vivo") ─── */
const PulseDot = ({ activo = true, chico = false }) => (
  <span className={`inline-block rounded-full animate-pulse ${chico ? "w-1.5 h-1.5" : "w-2 h-2"} ${activo ? "bg-gypi-green" : "bg-(--color-text-muted)"}`} aria-hidden="true" />
);

/* ─── Jornada de una persona: barra de 7 a 19 h ─── */
function TimelineRow({ nombre, ingreso, egreso, onClick }) {
  const parseH = (t) => { if (!t) return 0; const [h, m] = t.split(":").map(Number); return h + m / 60; };
  const jStart = 7, jEnd = 19, jLen = jEnd - jStart;
  const inH = parseH(ingreso);
  const outH = egreso ? parseH(egreso) : parseH(fmtTime(new Date()));
  const left = Math.max(0, ((inH - jStart) / jLen) * 100);
  const width = Math.max(1, Math.min(100 - left, ((outH - inH) / jLen) * 100));
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="w-full flex items-center gap-2.5 py-2 min-h-11 bg-transparent border-none text-left font-body cursor-pointer disabled:cursor-default"
      aria-label={`${nombre}: entró ${ingreso?.slice(0, 5)}${egreso ? `, salió ${egreso.slice(0, 5)}` : ", todavía adentro"}. Ver sus fichajes`}>
      <span className="w-20 truncate text-[12px] font-semibold text-gypi-text">{nombre}</span>
      <svg className="flex-1 h-3.5 rounded bg-gypi-surf-hi" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">
        <rect x={left} y="1" width={width} height="12" rx="2" className={egreso ? "fill-gypi-green" : "fill-gypi-amber"} fillOpacity="0.7" />
      </svg>
      <span className={`w-[46px] text-right font-mono text-[12px] font-bold ${egreso ? TONO.bien.txt : TONO.aviso.txt}`}>{ingreso?.slice(0, 5)}</span>
    </button>
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
          <Titulo>Reportes de obra de hoy</Titulo>
          {reportesObra.length > 0 && <Tag color="var(--color-cyan)">{reportesObra.length} reportes</Tag>}
        </div>

        {reportesObra.length === 0 ? (
          <EmptyState
            icon="mapPin"
            title="Sin reportes de obra hoy"
            description="Los reportes de trabajo en campo que suban desde el celular van a aparecer acá."
            color="var(--color-cyan)"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {reportesObra.map(r => {
              const isExpanded = expandedReport === r.id;
              const tieneFotos = r.fotos_urls && r.fotos_urls.length > 0;

              return (
                <div key={r.id} className={`rounded-xl overflow-hidden transition-all duration-200 bg-gypi-surf-hi border ${isExpanded ? TONO.info.borde : "border-(--color-border-hi)"}`}>
                  <button type="button" onClick={() => setExpandedReport(isExpanded ? null : r.id)} aria-expanded={isExpanded} className="w-full flex items-center gap-2.5 p-3 cursor-pointer bg-transparent border-none text-left font-body">
                    <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${TONO.info.fondo} ${TONO.info.txt}`} aria-hidden="true"><Icon name="building" size={18} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-bold text-gypi-text">{r.nombre}</span>
                        {tieneFotos && <Tag color="var(--color-cyan)">&#x1F4F7; {r.fotos_urls.length}</Tag>}
                        {r.faltantes?.length > 0 && <Tag color="var(--color-red)">&#x26A0; {r.faltantes.length}</Tag>}
                      </div>
                      <div className="text-[12px] text-gypi-dim mt-0.5 truncate">
                        {r.progreso?.slice(0, 60)}{r.progreso?.length > 60 ? "..." : ""}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-xs text-gypi-dim">
                        {new Date(r.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={`text-gypi-mute transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9" /></svg>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3.5 border-t border-gypi-border">
                      <div className="pt-3 pb-2">
                        <div className={`g-overline mb-1.5 ${TONO.bien.txt}`}>&#x2705; Progreso</div>
                        <div className="text-[13px] text-gypi-text leading-relaxed">{r.progreso || "—"}</div>
                      </div>

                      {r.faltantes?.length > 0 && (
                        <div className="p-2 px-2.5 rounded-[10px] mb-2 bg-gypi-red/[0.06] border border-gypi-red/10">
                          <div className={`g-overline mb-1.5 ${TONO.mal.txt}`}>&#x1F6AB; Faltantes</div>
                          <div className="flex flex-wrap gap-1">
                            {r.faltantes.map((f, i) => <span key={i} className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${TONO.mal.fondo} ${TONO.mal.txt}`}>{f}</span>)}
                          </div>
                        </div>
                      )}

                      {r.desvios?.length > 0 && (
                        <div className="p-2 px-2.5 rounded-[10px] mb-2 bg-gypi-amber/[0.06] border border-gypi-amber/10">
                          <div className={`g-overline mb-1.5 ${TONO.aviso.txt}`}>&#x26A0;&#xFE0F; Desvíos</div>
                          <div className="flex flex-wrap gap-1">
                            {r.desvios.map((d, i) => <span key={i} className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${TONO.aviso.fondo} ${TONO.aviso.txt}`}>{d}</span>)}
                          </div>
                        </div>
                      )}

                      {tieneFotos && (
                        <div className="py-2">
                          <div className={`g-overline mb-2 ${TONO.info.txt}`}>&#x1F4F7; Fotos ({r.fotos_urls.length})</div>
                          <div className={`grid gap-2 ${r.fotos_urls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                            {r.fotos_urls.map((url, i) => (
                              <button key={i} type="button" onClick={() => setFotoViewer({ fotos: r.fotos_urls, index: i })} aria-label={`Ampliar foto ${i + 1}`} className={`cursor-pointer rounded-[10px] overflow-hidden bg-gypi-surface border border-gypi-border relative p-0 ${r.fotos_urls.length === 1 ? "aspect-video" : "aspect-square"}`}>
                                <Image src={url} alt={`Foto ${i + 1}`} fill sizes="(max-width: 768px) 50vw, 300px" className="object-cover" />
                                <div className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-md bg-black/60 text-white text-xs font-semibold" aria-hidden="true">&#x1F50D; Ampliar</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {!tieneFotos && r.fotos > 0 && (
                        <div className="p-2 px-2.5 rounded-lg text-[12px] text-gypi-dim bg-gypi-surface">
                          &#x1F4F7; El instalador indicó {r.fotos} foto{r.fotos > 1 ? "s" : ""} pero no se subieron correctamente
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
  // Si alguna consulta llegó al tope de filas, los totales pueden estar incompletos
  const [datosIncompletos, setDatosIncompletos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [showBilling, setShowBilling] = useState(false);
  const [scoreDetail, setScoreDetail] = useState(null);
  const [showFullRanking, setShowFullRanking] = useState(false);
  // Ranking entre compañeros: delicado para el clima de trabajo, así que se ve
  // solo si el dueño lo pide; se recuerda en este dispositivo.
  const [verRanking, setVerRanking] = useState(() => {
    try { return localStorage.getItem("gypi_ver_ranking") === "1"; } catch { return false; }
  });
  const cambiarVerRanking = (v) => {
    setVerRanking(v);
    try { localStorage.setItem("gypi_ver_ranking", v ? "1" : "0"); } catch { /* sin almacenamiento */ }
  };
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

      // Rangos de semana/mes: todas las páginas. Antes el gateway cortaba en 500
      // filas sin avisar y el ranking, el score y las horas del mes salían
      // incompletos (auditoría F3-03). El orden con id desempata las páginas.
      const [prodData, fichadasSem, fichadasMesData, solsApData, repObra, docsExig, docsCarg] = await Promise.all([
        sb.get(`v_resumen_diario?fecha=eq.${hoy}&select=*`),
        sbGetAll(`fichadas?select=legajo,fecha,ingreso,egreso,horas_trabajadas,llegada_tarde,minutos_tarde,empleados(nombre,division)&fecha=gte.${monStr}&order=fecha.asc,id.asc`, { maxFilas: 20000 }),
        sbGetAll(`fichadas?select=empleado_id,legajo,fecha,horas_trabajadas,llegada_tarde,minutos_tarde&fecha=gte.${mesInicio}&order=fecha.asc,id.asc`, { maxFilas: 20000 }),
        sbGetAll(`solicitudes?select=empleado_id,legajo,tipo,estado,created_at&estado=eq.aprobado&created_at=gte.${mesInicio}&order=id.asc`),
        sb.get(`reportes_obra?fecha=eq.${hoy}&order=created_at.desc`),
        sbGetAll(`documentos_exigidos_empleado?select=empleado_id,tipo_documento_id&order=id.asc`),
        sbGetAll(`documentos_empleado?estado=eq.cargado&select=empleado_id,tipo_documento_id&order=id.asc`),
      ]);
      setResumenProd(prodData || []);
      setFichadasSemana(fichadasSem.data);
      setFichadasMes(fichadasMesData.data);
      setSolsAprobadas(solsApData.data);
      setReportesObra(repObra || []);
      setDocsExigidos(docsExig.data);
      setDocsCargados(docsCarg.data);
      setDatosIncompletos([fichadasSem, fichadasMesData, solsApData, docsExig, docsCarg].some((r) => r.truncado));
    } catch (e) {
      console.error("Dashboard error:", e);
    } finally {
      setLoading(false);
    }
  }, [hoy, isDemo]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);
  // Cada minuto, solo con la pestaña a la vista (F3-04)
  useRefrescoVisible(cargarDatos, { intervaloMs: 60000 });

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

  // Asistencia: presentes vs programados. El cumplimiento solo cuenta a los
  // programados que ficharon — alguien trabajando fuera de diagrama (un
  // sábado, un franco) suma como presente pero no puede llevar el
  // cumplimiento arriba del 100% (antes un sábado daba "1100%").
  const presentes = fichadasHoy.length;
  const diaKey = ahoraArg().diaKey;
  const empProgramados = empActivos.filter(e => e.diagrama && e.diagrama[diaKey]);
  const programados = empProgramados.length;
  const legajosProgramados = new Set(empProgramados.map(e => e.legajo));
  const presentesProgramados = fichadasHoy.filter(f => legajosProgramados.has(f.legajo)).length;
  const ausentes = Math.max(0, programados - presentesProgramados);
  // null = no hay nadie programado hoy (domingo/feriado) — la UI muestra "—"
  const pctAsist = programados > 0 ? Math.round((presentesProgramados / programados) * 100) : null;

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
    if (permisosIngreso.length > 0) items.push({ icon: "\u{1F513}", text: `${permisosIngreso.length} permiso${permisosIngreso.length > 1 ? "s" : ""} para entrar sin responder`, urgencia: "alta", target: "solicitudes" });
    // Ausentes, parados y pedidos están en el resumen de arriba (R9): no se repiten acá
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
      items.push({ icon: "\u{1F534}", text: n.asunto, urgencia: "alta", target: n.asunto.includes("BLOQUEADO") || n.asunto.includes("permiso") || n.asunto.includes("ingreso") ? "solicitudes" : null });
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
  // En campo = cualquier empleado que hoy hizo un reporte de obra
  const legajosConObra = new Set(reportesObra.map(r => r.legajo).filter(Boolean));
  const enCampoActivos = empActivos.filter(e => legajosConObra.has(e.legajo));
  const enCampoPresentes = fichadasHoy.filter(f => legajosConObra.has(f.legajo));
  // Taller: el resto (produccion sin reporte de obra hoy)
  const tallerProd = resumenProd.filter(r => !legajosConObra.has(r.legajo));
  const obrasHoy = reportesObra.length;
  const obrasConFotos = reportesObra.filter(r => r.fotos_urls && r.fotos_urls.length > 0).length;
  const obrasConFaltantes = reportesObra.filter(r => r.faltantes && r.faltantes.length > 0).length;
  const obrasConDesvios = reportesObra.filter(r => r.desvios && r.desvios.length > 0).length;

  /* ─── Estado expandido de paneles ─── */
  const [panelExpanded, setPanelExpanded] = useState(null); // "taller" | "instalaciones" | null
  // Módulos de la empresa (ítem 36): producción en vivo y trabajo en campo
  const conTareas = tieneModulo(empresa, "actividad");
  const conObra = tieneModulo(empresa, "obra");

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
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${TONO.bien.fondo} ${TONO.bien.borde}`}>
              <PulseDot />
              <span className={`text-[12px] font-bold ${TONO.bien.txt}`}>En vivo</span>
            </div>
            <button
              onClick={async () => { setRefreshing(true); try { await Promise.all([reload?.(), cargarDatos()]) } finally { setNow(new Date()); setRefreshing(false) } }}
              aria-label="Actualizar datos"
              className="w-11 h-11 rounded-xl bg-gypi-surface text-gypi-dim border border-gypi-border flex items-center justify-center cursor-pointer shadow-sm"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className={refreshing ? "animate-spin text-gypi-amber-ink" : ""}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* ─── Banner de trial / vencimiento ─── */}
      <TrialBanner onUpgrade={() => setShowBilling(true)} reload={reload} />
      {!isDemo && <ChecklistActivacion empresa={empresa} goto={goto} />}
      {datosIncompletos && (
        <div role="alert" className={`mx-[18px] mb-3 p-3 rounded-xl text-[13px] ${TONO.mal.fondo} ${TONO.mal.txt}`}>
          Hay más datos de los que se pueden mostrar juntos: algunos totales del mes pueden estar incompletos.
        </div>
      )}
      {/* ─── Resumen de hoy (R9): lo que el dueño necesita saber en 30 segundos ─── */}
      <section aria-label="Resumen de hoy" className="grid grid-cols-2 gap-2.5 mb-4">
        <Stat value={`${presentesProgramados}/${programados}`} label="Vinieron hoy (de los esperados)" tone={programados > 0 && presentesProgramados >= programados ? "bien" : "normal"} />
        <Stat value={ausentes} label={ausentes === 1 ? "Falta hoy" : "Faltan hoy"} tone={ausentes > 0 ? "mal" : "bien"} />
        {conTareas
          ? <Stat value={enEspera} label="Parados ahora" tone={enEspera > 0 ? "atencion" : "bien"} onClick={() => goto?.("ger-actividad")} />
          : <Stat value={tardesEstaSemana} label="Tardanzas esta semana" tone={tardesEstaSemana > 0 ? "atencion" : "bien"} />}
        <Stat value={pendientes.length} label="Pedidos sin responder" tone={pendientes.length > 0 ? "atencion" : "bien"} onClick={() => goto?.("solicitudes")} />
      </section>

      {/* Modal de billing */}
      {showBilling && <BillingScreen onClose={() => setShowBilling(false)} />}

      {/* ─── Alertas activas ─── */}
      {alertas.length > 0 && (
        <section aria-label="Alertas activas" className="mb-4">
          {alertas.map((a, i) => (
            <button key={i} type="button"
              className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-12 rounded-[14px] mb-2 cursor-pointer text-left font-body border-[1.5px] ${TONO.mal.fondo} ${TONO.mal.borde}`}
              onClick={() => {
                if (a.target) goto?.(a.target);
                else if (a.text.includes("pedido")) goto?.("solicitudes");
                else if (a.text.includes("parado")) goto?.("ger-actividad");
                else if (a.text.includes("BLOQUEADO") || a.text.includes("permiso") || a.text.includes("ingreso")) goto?.("solicitudes");
              }}
            >
              <span className="text-sm" aria-hidden="true">{a.icon}</span>
              <span className="flex-1 text-[13px] font-semibold text-gypi-text">{a.text}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gypi-mute" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          ))}
        </section>
      )}

      {/* ─── Solicitudes pendientes ─── */}
      {pendientes.length > 0 && (
        <section aria-label="Pedidos sin responder" className={`g-card mb-4 ${TONO.aviso.borde}`}>
          <div className="flex justify-between items-center mb-3">
            <Titulo>Pedidos sin responder</Titulo>
            <Tag color={MARCA}>{pendientes.length} pendiente{pendientes.length !== 1 ? "s" : ""}</Tag>
          </div>

          {pendientes.slice(0, 5).map(s => (
            <div key={s.id} className="flex items-center gap-2.5 py-2 border-b border-gypi-border">
              <div className="w-1.5 h-1.5 rounded-full bg-gypi-amber shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-gypi-text truncate">{s.nombre_empleado}</div>
                <div className="text-[12px] text-gypi-dim truncate">{s.motivo}</div>
              </div>
              <Tag color={MARCA}>{nombreSolicitud(s)}</Tag>
            </div>
          ))}

          <button onClick={() => goto?.("solicitudes")}
            className="w-full mt-3 p-3 min-h-12 rounded-(--radius-md) font-body text-[14px] font-bold cursor-pointer flex items-center justify-center gap-1.5 border-none bg-gypi-amber text-gypi-on-amber"
          >
            <Icon name="clipboard" size={14} /> Responder pedidos &rarr;
          </button>
        </section>
      )}

      {/* ─── Botones En planta / Trabajo en campo (solo con esos módulos) ─── */}
      {(conTareas || conObra) && (
        <div className={`grid ${conTareas && conObra ? "grid-cols-2" : "grid-cols-1"} gap-2 mb-3.5`}>
          {conTareas && <button onClick={() => setPanelExpanded(panelExpanded === "taller" ? null : "taller")}
            aria-expanded={panelExpanded === "taller"}
            className={`p-3.5 px-2 min-h-[88px] rounded-[14px] cursor-pointer flex flex-col items-center gap-2 font-body border ${panelExpanded === "taller" ? `${TONO.aviso.fondo} ${TONO.aviso.borde}` : "bg-gypi-surface border-gypi-border"}`}
          >
            <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center ${TONO.aviso.fondo} ${TONO.aviso.txt}`} aria-hidden="true"><Icon name="hammer" size={18} /></div>
            <span className={`text-[13px] font-semibold ${panelExpanded === "taller" ? TONO.aviso.txt : "text-gypi-text"}`}>En planta</span>
          </button>}
          {conObra && <button onClick={() => setPanelExpanded(panelExpanded === "instalaciones" ? null : "instalaciones")}
            aria-expanded={panelExpanded === "instalaciones"}
            className={`p-3.5 px-2 min-h-[88px] rounded-[14px] cursor-pointer flex flex-col items-center gap-2 font-body border ${panelExpanded === "instalaciones" ? `${TONO.info.fondo} ${TONO.info.borde}` : "bg-gypi-surface border-gypi-border"}`}
          >
            <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center ${TONO.info.fondo} ${TONO.info.txt}`} aria-hidden="true"><Icon name="building" size={18} /></div>
            <span className={`text-[13px] font-semibold ${panelExpanded === "instalaciones" ? TONO.info.txt : "text-gypi-text"}`}>Trabajo en campo</span>
          </button>}
        </div>
      )}

      {/* ─── Panel expandido: En planta ─── */}
      {conTareas && panelExpanded === "taller" && (
        <section aria-label="En planta" className={`g-card mb-4 animate-[fadeIn_0.2s_ease] ${TONO.aviso.borde}`}>
          <div className="flex justify-between items-center mb-3">
            <Titulo>Producción en vivo</Titulo>
            <div className="flex items-center gap-1.5">
              <PulseDot activo={enActividad > 0} chico />
              <span className="text-[12px] text-gypi-dim">{enActividad} trabajando</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className={`g-kpi ${TONO.bien.fondo}`}>
              <div className={`font-mono text-base font-bold ${TONO.bien.txt}`}>{enActividad}</div>
              <div className="g-kpi-label">Trabajando</div>
            </div>
            <Dato valor={enEspera} etiqueta="Parados" tono={enEspera > 0 ? "mal" : "neutro"} />
            <Dato valor={sinTarea} etiqueta="Sin tarea" />
          </div>

          <div className="flex gap-2 mb-3">
            <Dato valor={fmtMin(totalMinProd)} etiqueta="Tiempo trabajando" tono="bien" />
            <Dato valor={fmtMin(totalMinEspera)} etiqueta="Tiempo parados" tono={totalMinEspera > 0 ? "mal" : "neutro"} />
            <Dato valor={`${pctProd}%`} etiqueta="Del tiempo, trabajando" tono={tonoPct(pctProd)} />
          </div>

          {topProductivos.length > 0 && (
            <>
              <div className="g-label mb-2">Los que más trabajaron hoy</div>
              {topProductivos.map((op, i) => {
                const pct = parseFloat(op.pct_productivo) || 0;
                return (
                  <div key={op.empleado_id} className="flex items-center gap-2.5 py-1.5 border-b border-gypi-border last:border-b-0">
                    <div className={`w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold font-mono ${i === 0 ? `${TONO.aviso.fondo} ${TONO.aviso.txt}` : "bg-gypi-surf-hi text-gypi-mute"}`}>{i + 1}</div>
                    <div className="flex-1 text-[13px] font-semibold text-gypi-text truncate">{op.empleado_nombre}</div>
                    <div className="w-[60px]"><Barra pct={pct} tono={tonoPct(pct)} /></div>
                    <span className={`font-mono text-xs font-bold w-9 text-right ${TONO[tonoPct(pct)].txt}`}>{Math.round(pct)}%</span>
                  </div>
                );
              })}
            </>
          )}

          <button onClick={() => goto?.("ger-actividad")}
            className="w-full mt-3 p-3 min-h-12 rounded-(--radius-md) font-body text-[14px] font-bold cursor-pointer flex items-center justify-center gap-1.5 bg-gypi-surf-hi border border-gypi-border text-gypi-text"
          >
            <Icon name="hammer" size={14} /> Ver detalle por operario &rarr;
          </button>
        </section>
      )}

      {/* ─── Panel expandido: Trabajo en campo ─── */}
      {conObra && panelExpanded === "instalaciones" && (
        <section aria-label="Trabajo en campo" className={`g-card mb-4 animate-[fadeIn_0.2s_ease] ${TONO.info.borde}`}>
          <div className="flex justify-between items-center mb-3">
            <Titulo>Trabajo en campo hoy</Titulo>
            <Tag color="var(--color-cyan)">{obrasHoy} reporte{obrasHoy !== 1 ? "s" : ""}</Tag>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <Dato valor={obrasHoy} etiqueta="Obras reportadas" tono="info" />
            <Dato valor={obrasConFotos} etiqueta="Con fotos" tono="bien" />
            <Dato valor={obrasConFaltantes} etiqueta="Con faltantes" tono={obrasConFaltantes > 0 ? "mal" : "bien"} />
            <Dato valor={obrasConDesvios} etiqueta="Con desvíos" tono={obrasConDesvios > 0 ? "aviso" : "bien"} />
          </div>

          <div className="flex gap-2 mb-3">
            <Dato valor={enCampoPresentes.length} etiqueta="Ficharon y están en campo" tono="bien" />
            <Dato valor={enCampoActivos.length} etiqueta="Reportaron obra hoy" tono="info" />
          </div>

          <ReportesObraPanel reportesObra={reportesObra} />
        </section>
      )}

      {/* ─── Asistencia ─── */}
      <section aria-label="Asistencia" className="card-hover g-card mb-4">
        <div className="flex justify-between items-center mb-3.5">
          <Titulo>Asistencia</Titulo>
          <Tag color="var(--color-green)">{presentes} {presentes === 1 ? "fichó" : "ficharon"} hoy</Tag>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3.5">
          <Dato grande valor={pctAsist == null ? "—" : `${pctAsist}%`} etiqueta="Cumplimiento" tono={pctAsist == null ? "neutro" : tonoPct(pctAsist)} />
          <Dato grande valor={tardesEstaSemana} etiqueta="Tardanzas (semana)" tono={tardesEstaSemana > 0 ? "aviso" : "bien"} />
        </div>

        <div className="g-label mb-2">Cuántos ficharon cada día de esta semana</div>
        <div className="flex justify-center">
          <MiniBarChart
            data={fichadasPorDia.map(d => d.count)}
            maxVal={programados || 20}
            labels={fichadasPorDia.map(d => d.label)}
          />
        </div>

        {promedioHorasDia > 0 && (
          <div className={`mt-2.5 px-3 py-2 rounded-[10px] flex items-center justify-between ${TONO.info.fondo}`}>
            <span className="text-[13px] text-gypi-dim font-semibold">Promedio de horas por día</span>
            <span className={`font-heading text-sm font-bold ${TONO.info.txt}`}>{promedioHorasDia.toFixed(1)} h</span>
          </div>
        )}
      </section>

      {/* ─── Ranking de empleados: opcional y apagado por defecto (R9) ─── */}
      {ranking.length > 0 && !verRanking && (
        <button onClick={() => cambiarVerRanking(true)} className="w-full min-h-[48px] mb-4 rounded-xl bg-transparent border border-gypi-border text-[14px] text-gypi-text font-semibold cursor-pointer font-body">
          🏆 Mostrar el ranking del mes
        </button>
      )}
      {ranking.length > 0 && verRanking && (() => {
        const top3 = ranking.slice(0, 3);
        const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
        return (
          <button onClick={() => setShowFullRanking(true)} className={`card-hover g-card mb-4 w-full cursor-pointer text-left block ${TONO.aviso.borde}`}>
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-1.5">
                <span className="text-base" aria-hidden="true">&#x1F3C6;</span>
                <Titulo>Ranking de empleados</Titulo>
              </div>
              <Tag color={MARCA}>Este mes</Tag>
            </div>
            <div className="flex flex-col gap-2">
              {top3.map((e, i) => (
                <div key={e.id} className="flex items-center gap-2.5 px-1 py-1.5 rounded-lg">
                  <span className="text-base shrink-0" aria-hidden="true">{medals[i]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-gypi-text truncate">{e.nombre}</div>
                    <div className="text-xs text-gypi-dim mt-px">
                      {e.division || "Sin división"} &middot; {e.diasTrabajados} días &middot; {e.horasTrabajadas} h &middot; {e.tardanzas === 0 ? "puntual" : `${e.tardanzas} tardanza${e.tardanzas > 1 ? "s" : ""}`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-extrabold font-heading ${TONO.bien.txt}`}>{e.score}</div>
                    <div className="text-[11px] text-gypi-dim font-semibold">puntos</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 text-center text-[13px] text-gypi-amber-ink font-semibold">
              Ver ranking completo ({ranking.length})
            </div>
          </button>
        );
      })()}
      {ranking.length > 0 && verRanking && (
        <button onClick={() => cambiarVerRanking(false)} className="w-full min-h-[44px] -mt-2 mb-4 bg-transparent border-none text-[13px] text-gypi-dim underline cursor-pointer font-body">
          Ocultar el ranking
        </button>
      )}

      {/* ─── Productividad por división (solo con Tareas: sin ellas siempre daba 0%) ─── */}
      {conTareas && (
        <section aria-label="Productividad" className="card-hover g-card mb-4">
          <div className="flex justify-between items-center mb-3.5">
            <Titulo>Productividad por división</Titulo>
            <Tag color={pctProd >= 80 ? "var(--color-green)" : pctProd >= 60 ? MARCA : "var(--color-red)"}>{pctProd}% en general</Tag>
          </div>
          <p className="m-0 mb-3 text-[13px] text-gypi-dim">Del tiempo con tarea cargada, cuánto estuvieron trabajando (el resto, parados).</p>
          <div className="flex justify-around flex-wrap gap-3">
            {prodPorDiv.map(d => (
              <DonutChart key={d.id} value={d.prod} total={d.prod + d.espera} label={d.label} />
            ))}
          </div>
        </section>
      )}

      {/* ─── Equipo ─── */}
      <section aria-label="Equipo" className="card-hover g-card mb-4">
        <div className="flex justify-between items-center mb-3.5">
          <Titulo>Equipo</Titulo>
          <Tag color="var(--color-cyan)">{totalEmp} activos</Tag>
        </div>

        <div className="flex gap-2 mb-3">
          {DIVISIONES.filter(d => d.id !== "todas").map(d => {
            const count = empActivos.filter(e => e.division === d.id).length;
            return (
              <div key={d.id} className="flex-1 text-center px-1 py-2 rounded-[10px] bg-gypi-surf-hi">
                <div className="text-sm" aria-hidden="true">{d.icon}</div>
                <div className="font-mono text-sm font-bold mt-0.5 text-gypi-text">{count}</div>
                <div className="text-[12px] text-gypi-dim font-semibold mt-px">{d.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Jornadas hoy ─── */}
      <section aria-label="Jornadas hoy" className="card-hover g-card mb-4">
        <div className="flex justify-between items-center mb-1">
          <Titulo>Jornadas de hoy</Titulo>
          <span className="text-xs text-gypi-mute font-mono">7:00 ——— 19:00</span>
        </div>
        {fichadasHoy.length > 0 && (
          <p className="m-0 mb-1 text-[12px] text-gypi-dim">
            <span className={TONO.bien.txt}>■</span> ya salió · <span className={TONO.aviso.txt}>■</span> todavía adentro · tocá a alguien para ver sus fichajes
          </p>
        )}
        {fichadasHoy.length === 0 ? (
          <EmptyState
            icon="clock"
            title="Sin fichadas hoy"
            description="Los ingresos y egresos del equipo van a aparecer acá a medida que fichen."
            color="var(--color-cyan)"
          />
        ) : (
          <div className="max-h-[220px] overflow-y-auto">
            {fichadasHoy.map((f, i) => (
              <TimelineRow
                key={f.legajo || i}
                nombre={f.nombre || `L-${f.legajo}`}
                ingreso={f.ingreso}
                egreso={f.egreso}
                onClick={() => goto?.("historial-fichajes", f.legajo)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ─── Footer info ─── */}
      <footer className="text-center py-2 pb-3">
        <div className="text-xs text-gypi-mute">
          Se actualiza sola cada minuto &middot; Última vez: {fmtTime(now)}
        </div>
      </footer>

      {/* ─── Ranking completo ─── */}
      {showFullRanking && ranking.length > 0 && (() => {
        const len = ranking.length;
        // Los 3 primeros en verde y los 3 últimos en rojo
        const tonoFila = (i) => i < 3 ? "bien" : i >= len - 3 ? "mal" : null;
        const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
        return (
          <div onClick={() => setShowFullRanking(false)}
            className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease] bg-black/45 backdrop-blur-xs"
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
                    className="w-11 h-11 rounded-[10px] border-none bg-gypi-surf-hi cursor-pointer flex items-center justify-center text-base text-gypi-dim"
                  >&#x2715;</button>
                </div>
                <div className="mt-3 text-[12px] text-gypi-dim">
                  Cómo se arman los puntos: asistencia {PESOS_SCORE.asistencia}%, puntualidad {PESOS_SCORE.puntualidad}%, disponibilidad {PESOS_SCORE.disponibilidad}%, horas extra {PESOS_SCORE.esfuerzo}% y documentación {PESOS_SCORE.documentacion}%.
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:none]">
                {ranking.map((e, i) => {
                  const t = tonoFila(i);
                  return (
                    <button key={e.id} onClick={() => setScoreDetail(e)}
                      className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-[10px] mb-1 w-full text-left cursor-pointer transition-colors duration-150 border font-body ${t ? `${TONO[t].fondo} ${TONO[t].borde}` : "bg-transparent border-gypi-border"}`}
                    >
                      <div className={`w-6 text-center shrink-0 font-bold text-gypi-dim ${i < 3 ? "text-base" : "text-xs"}`}>
                        {i < 3 ? medals[i] : `${i + 1}`}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold text-gypi-text truncate">{e.nombre}</div>
                        <div className="text-xs text-gypi-dim mt-px">
                          {e.division || "Sin división"} &middot; {e.diasTrabajados} días &middot; {e.horasTrabajadas} h &middot; {e.tardanzas === 0 ? "puntual" : `${e.tardanzas} tardanza${e.tardanzas > 1 ? "s" : ""}`}{e.diasPermiso > 0 ? ` · ${e.diasPermiso} con permiso` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`font-heading text-[15px] font-extrabold ${t ? TONO[t].txt : "text-gypi-text"}`}>{e.score}</div>
                        <div className="text-[11px] text-gypi-dim font-semibold">puntos</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Detalle de los puntos ─── */}
      {scoreDetail && (() => {
        const d = scoreDetail;
        const rows = [
          { label: "Asistencia", pct: d.pAsistencia, weight: `${PESOS_SCORE.asistencia}%`, detail: `Vino ${d.diasTrabajados} de ${d.diasProgramados} días` },
          { label: "Puntualidad", pct: d.pPuntualidad, weight: `${PESOS_SCORE.puntualidad}%`, detail: d.tardanzas === 0 ? "Sin tardanzas" : `${d.tardanzas} tardanza${d.tardanzas > 1 ? "s" : ""}` },
          { label: "Disponibilidad", pct: d.pDisponibilidad, weight: `${PESOS_SCORE.disponibilidad}%`, detail: d.diasPermiso === 0 ? "Sin permisos" : `${d.diasPermiso} permiso${d.diasPermiso > 1 ? "s" : ""}` },
          { label: "Horas extra", pct: d.pEsfuerzo, weight: `${PESOS_SCORE.esfuerzo}%`, detail: `${d.horasExtra} h extra de ${d.horasTrabajadas} h` },
          { label: "Documentación", pct: d.pDocumentacion, weight: `${PESOS_SCORE.documentacion}%`, detail: d.documentosExigidos === 0 ? "Sin documentos exigidos" : `${d.documentosCompletos} de ${d.documentosExigidos} documentos cargados` },
        ];
        return (
          <div onClick={() => setScoreDetail(null)}
            className="fixed inset-0 z-[1000] flex items-center justify-center p-5 animate-[fadeIn_0.2s_ease] bg-black/45 backdrop-blur-xs"
            role="dialog" aria-label="Detalle de los puntos"
          >
            <div onClick={ev => ev.stopPropagation()} className="bg-gypi-surface rounded-[20px] p-6 w-full max-w-[360px] shadow-lg">
              <div className="flex justify-between items-center mb-5">
                <div>
                  <div className="g-overline">De dónde salen sus puntos</div>
                  <div className="text-lg font-extrabold text-gypi-text font-heading mt-0.5">{d.nombre}</div>
                  <div className="text-[12px] text-gypi-dim mt-0.5">{d.division || "Sin división"} &middot; L-{d.legajo}</div>
                </div>
                <div className={`w-14 h-12 rounded-[14px] flex flex-col items-center justify-center ${TONO.aviso.fondo}`}>
                  <div className={`text-lg font-extrabold font-heading leading-none ${TONO.aviso.txt}`}>{d.score}</div>
                  <div className="text-[11px] text-gypi-dim font-bold">puntos</div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {rows.map((r) => (
                  <div key={r.label} className={`px-3 py-2.5 rounded-[10px] border ${TONO.neutro.borde}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[13px] font-bold text-gypi-text">{r.label} <span className="font-medium text-gypi-dim">(vale {r.weight})</span></span>
                      <span className={`text-sm font-extrabold font-heading ${TONO[tonoPct(r.pct)].txt}`}>{r.pct}%</span>
                    </div>
                    <Barra pct={r.pct} tono={tonoPct(r.pct)} />
                    <div className="text-xs text-gypi-dim mt-1">{r.detail}</div>
                  </div>
                ))}
              </div>

              <div className={`mt-3.5 px-3 py-2.5 rounded-[10px] flex justify-between items-center border-[1.5px] ${TONO.aviso.fondo} ${TONO.aviso.borde}`}>
                <span className="text-[13px] font-bold text-gypi-text">Total (de 0 a 100)</span>
                <span className={`text-lg font-extrabold font-heading ${TONO.aviso.txt}`}>{d.score} puntos</span>
              </div>

              <button onClick={() => setScoreDetail(null)}
                className="mt-4 w-full p-3 min-h-12 rounded-xl border-none bg-gypi-surf-hi text-gypi-text text-sm font-bold cursor-pointer font-body"
              >Cerrar</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
