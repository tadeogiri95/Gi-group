import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import { sb, sbGetAll, getToken } from "./lib/supabase";
import { Tag, Chip, Button } from "./components/ui";
import { useToast } from "./components/ui/Toast";
import FotoViewer from "./components/FotoViewer";
import Paywall from "./components/Paywall";
import BillingScreen from "./components/BillingScreen";
import { hoyArg, ahoraArg } from "./lib/dates";
import { duracionMinutos } from "./lib/calc";
import { exportCSV, exportImagen } from "./lib/exportarReporte";
import Stat from "./components/ui/Stat";

/* ═══════════════════════════════════════════════════════
   REPORTES & CUMPLIMIENTO HORARIO
   Vista gerencial con exportación PDF/Excel
   ═══════════════════════════════════════════════════════ */

// Colores por tono (R11): cada estado tiene letra legible, fondo y borde.
const TONO = {
  bien: { txt: "text-gypi-green-ink", fondo: "bg-gypi-green/10", borde: "border-gypi-green/25" },
  aviso: { txt: "text-gypi-amber-ink", fondo: "bg-gypi-amber/10", borde: "border-gypi-amber/25" },
  mal: { txt: "text-gypi-red-ink", fondo: "bg-gypi-red/10", borde: "border-gypi-red/25" },
  extra: { txt: "text-gypi-cyan-ink", fondo: "bg-gypi-cyan/10", borde: "border-gypi-cyan/25" },
  neutro: { txt: "text-gypi-mute", fondo: "bg-gypi-surf-hi", borde: "border-gypi-border" },
};
const MARCA = "var(--color-empresa-primary)";
// Qué quiere decir cada ícono de día (antes no había leyenda)
const LEYENDA_DIAS = [["✓", "bien", "vino"], ["⏰", "aviso", "tarde"], ["↗", "aviso", "salió antes"], ["✗", "mal", "faltó"], ["F", "neutro", "franco"], ["★", "extra", "vino en franco"]];
const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIAS_LABEL = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
const DIAS_SEMANA_JS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

import { getDivisionesConTodas } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { tieneModulo } from "./lib/modulos";
import { esSupervisor } from "./lib/menuGestion";

/* ─── Helpers ─── */
const parseHora = (str) => { if (!str) return null; const [h, m] = str.split(":").map(Number); return h * 60 + m; };
const fmtHora = (min) => { if (min == null) return "—"; const h = Math.floor(min / 60); const m = min % 60; return `${h}:${String(m).padStart(2, "0")}`; };
// "25 min" o "1 h 05 min": se entiende mejor que "0:25"
const minutosLegibles = (min) => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
const diffMin = (a, b) => (a != null && b != null) ? b - a : null;
const pctTono = (pct) => pct >= 95 ? "bien" : pct >= 80 ? "aviso" : "mal";
// Stat usa otros nombres de tono
const TONO_STAT = { bien: "bien", aviso: "atencion", mal: "mal" };

const Puntos = () => <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;
const flecha = (abierto) => <span aria-hidden="true" className={`text-gypi-dim text-xs transition-transform ${abierto ? "rotate-90" : ""}`}>›</span>;

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
  if (esFuturo) return { estado: "futuro", tono: "neutro", icon: "·", detalle: "" };
  if (!esperado) {
    if (fichada) return { estado: "extra", tono: "extra", icon: "★", detalle: `Trabajó en franco: ${fichada.ingreso?.slice(0, 5) || "?"} → ${fichada.egreso?.slice(0, 5) || "?"}` };
    return { estado: "franco", tono: "neutro", icon: "F", detalle: "Franco" };
  }
  if (!fichada || !fichada.ingreso) return { estado: "ausente", tono: "mal", icon: "✗", detalle: "Ausente" };

  const inEsperado = parseHora(esperado.in);
  const outEsperado = parseHora(esperado.out);
  const inReal = parseHora(fichada.ingreso?.slice(0, 5));
  const outReal = fichada.egreso ? parseHora(fichada.egreso.slice(0, 5)) : null;
  const tardanza = inReal != null && inEsperado != null ? Math.max(0, inReal - inEsperado) : 0;
  const salidaTemp = outReal != null && outEsperado != null ? Math.max(0, outEsperado - outReal) : 0;
  const minEsperados = diffMin(inEsperado, outEsperado) || 0;
  const minReales = outReal != null ? diffMin(inReal, outReal) : null;

  let estado = "ok", tono = "bien", icon = "✓";
  const detalles = [`${fichada.ingreso?.slice(0, 5)} → ${fichada.egreso?.slice(0, 5) || "en curso"}`];
  if (tardanza > 5) { estado = "tardanza"; tono = "aviso"; icon = "⏰"; detalles.push(`Tardanza: +${tardanza}min`); }
  if (salidaTemp > 5) { estado = tardanza > 5 ? "tardanza" : "salida_temp"; tono = "aviso"; icon = tardanza > 5 ? "⏰" : "↗"; detalles.push(`Salió ${salidaTemp}min antes`); }
  if (minReales != null && minEsperados > 0) { const pct = Math.round((minReales / minEsperados) * 100); detalles.push(`${fmtHora(minReales)} de ${fmtHora(minEsperados)} (${pct}%)`); }
  return { estado, tono, icon, detalle: detalles.join(" · "), tardanza, salidaTemp, minEsperados, minReales };
}

/* ─── Tab de Reporte de Producción ─── */
function ReporteProduccionTab({ fechaDesde, fechaHasta, labelPeriodo, empresaId }) {
  const [datos, setDatos] = useState([]);
  const [proyectos, setProyectos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [truncado, setTruncado] = useState(false);
  const [expandedOT, setExpandedOT] = useState(null);

  useEffect(() => {
    if (!fechaDesde || !fechaHasta) return;
    (async () => {
      setLoading(true);
      try {
        const [regsRes, proys] = await Promise.all([
          sbGetAll(`registro_actividades?empresa_id=eq.${empresaId}&fecha=gte.${fechaDesde}&fecha=lte.${fechaHasta}&etapa=gt.0&select=id,empleado_id,legajo,fecha,hora_inicio,hora_fin,codigo_proyecto,etapa,division,duracion_min,observaciones&order=fecha.desc`),
          sb.get(`proyectos?empresa_id=eq.${empresaId}&estado=eq.activo&select=id,ot,cliente,proyecto`),
        ]);
        setDatos(regsRes.data || []);
        setTruncado(regsRes.truncado);
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
      const min = duracionMinutos(r);
      map[key].totalMin += min;
      const empKey = r.empleado_id || r.legajo;
      if (!map[key].empleados[empKey]) map[key].empleados[empKey] = { legajo: r.legajo, min: 0, registros: 0 };
      map[key].empleados[empKey].min += min;
      map[key].empleados[empKey].registros++;
    });
    return Object.values(map)
      .map(p => ({
        ...p,
        nombre: (() => { const pr = proyectos.find(pr => pr.ot === p.ot); return pr ? (pr.cliente || pr.proyecto || "") : ""; })(),
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

  if (loading) return <Puntos />;

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
      <section aria-label="Resumen de producción" className="grid grid-cols-3 gap-2 mb-3.5">
        <Stat value={resumen.length} label="Órdenes de trabajo" />
        <Stat value={empsUnicos} label="Personas" />
        <Stat value={fmtMin(totalMin)} label="Tiempo total" />
      </section>

      {/* Aviso de datos incompletos */}
      {truncado && (
        <div role="alert" className="p-3 rounded-[10px] text-[13px] mb-3.5 font-body bg-gypi-amber/10 border border-gypi-amber/20 text-gypi-amber-ink">
          ⚠ El período tiene más registros de los que se pueden mostrar (5000). Los totales están incompletos — acotá el rango de fechas.
        </div>
      )}

      {/* Botón exportar */}
      <button onClick={exportarCSV} className="w-full min-h-11 py-2.5 px-4 rounded-xl border border-gypi-border bg-gypi-surface text-[13px] font-bold text-gypi-text cursor-pointer mb-3.5 font-body">
        📥 Descargar producción (Excel)
      </button>

      {/* Lista por proyecto */}
      <div className="flex flex-col gap-2">
        {resumen.map(p => {
          const isExpanded = expandedOT === p.ot;
          return (
            <div key={p.ot} className="bg-gypi-surface rounded-xl overflow-hidden border border-gypi-border">
              <button onClick={() => setExpandedOT(isExpanded ? null : p.ot)} aria-expanded={isExpanded} className="w-full flex items-center gap-3 p-3 text-left cursor-pointer bg-transparent border-none font-body">
                <div className="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 bg-gypi-amber/10" aria-hidden="true">
                  <span className="text-base">📋</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-gypi-text truncate">OT {p.ot}{p.nombre ? ` — ${p.nombre}` : ""}</div>
                  <div className="text-xs text-gypi-dim mt-0.5">{Object.keys(p.empleados).length} empleado{Object.keys(p.empleados).length !== 1 ? "s" : ""} · {p.registros} registro{p.registros !== 1 ? "s" : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-heading text-sm font-bold text-gypi-amber-ink">{fmtMin(p.totalMin)}</div>
                  <div className="text-[11px] text-gypi-dim" aria-hidden="true">{isExpanded ? "▲" : "▼"}</div>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-0 border-t border-gypi-border">
                  <div className="text-xs font-bold text-gypi-dim uppercase tracking-[0.06em] mt-2.5 mb-1.5">Detalle por empleado</div>
                  {p.empleadosList.map((e, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-gypi-border last:border-b-0">
                      <div className="text-xs text-gypi-text font-semibold">L-{e.legajo}</div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gypi-dim">{e.registros} reg.</span>
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
        <button onClick={() => cambiarFecha(-1)} aria-label="Día anterior" className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl">←</button>
        <span className="font-heading text-sm font-bold text-gypi-text">
          {new Date(fechaFiltro + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}
        </span>
        <button onClick={() => cambiarFecha(1)} aria-label="Día siguiente" className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl">→</button>
      </div>

      {loading ? (
        <Puntos />
      ) : reportesObra.length === 0 ? (
        <div className="bg-gypi-surface rounded-2xl p-8 text-center border border-gypi-border">
          <div className="text-[32px] mb-2">🏗️</div>
          <div className="text-sm font-bold text-gypi-text">Sin reportes en esta fecha</div>
          <div className="text-xs text-gypi-dim mt-1.5">Los reportes de trabajo en campo aparecerán acá.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="self-start mb-1"><Tag color="var(--color-cyan)">{reportesObra.length} reportes</Tag></div>
          {reportesObra.map(r => {
            const isExpanded = expandedReport === r.id;
            const tieneFotos = r.fotos_urls && r.fotos_urls.length > 0;
            return (
              <div key={r.id} className={`bg-gypi-surface rounded-xl overflow-hidden transition-all border ${isExpanded ? "border-gypi-cyan/25" : "border-gypi-border"}`}>
                <button onClick={() => setExpandedReport(isExpanded ? null : r.id)} aria-expanded={isExpanded} className="w-full flex items-center gap-2.5 p-3 cursor-pointer bg-transparent border-none text-left font-body">
                  <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-base shrink-0 bg-gypi-cyan/10" aria-hidden="true">🏗️</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-bold text-gypi-text">{r.nombre}</span>
                      {tieneFotos && <Tag color="var(--color-cyan)">📷 {r.fotos_urls.length}</Tag>}
                      {r.faltantes?.length > 0 && <Tag color="var(--color-red)">⚠ {r.faltantes.length}</Tag>}
                    </div>
                    <div className="text-[11px] text-gypi-dim mt-0.5 truncate">{r.progreso?.slice(0, 60)}{r.progreso?.length > 60 ? "..." : ""}</div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-xs text-gypi-dim">{new Date(r.created_at).toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit' })}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={`text-gypi-mute transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3.5 border-t border-gypi-border">
                    <div className="py-3 pb-2">
                      <div className="text-xs font-bold text-gypi-green-ink uppercase tracking-[0.06em] mb-1.5">✅ Progreso</div>
                      <div className="text-[13px] text-gypi-text leading-relaxed">{r.progreso || "—"}</div>
                    </div>
                    {r.faltantes?.length > 0 && (
                      <div className="py-2 px-2.5 rounded-[10px] mb-2 bg-gypi-red/[0.06] border border-gypi-red/10">
                        <div className="text-xs font-bold uppercase tracking-[0.06em] mb-1.5 text-gypi-red-ink">🚫 Faltantes</div>
                        <div className="flex flex-wrap gap-1">
                          {r.faltantes.map((f, i) => <span key={i} className="py-1 px-2.5 rounded-lg text-xs font-semibold bg-gypi-red/10 text-gypi-red-ink">{f}</span>)}
                        </div>
                      </div>
                    )}
                    {r.desvios?.length > 0 && (
                      <div className="py-2 px-2.5 rounded-[10px] mb-2 bg-gypi-amber/[0.06] border border-gypi-amber/10">
                        <div className="text-xs font-bold uppercase tracking-[0.06em] mb-1.5 text-gypi-amber-ink">⚠️ Desvíos</div>
                        <div className="flex flex-wrap gap-1">
                          {r.desvios.map((d, i) => <span key={i} className="py-1 px-2.5 rounded-lg text-xs font-semibold bg-gypi-amber/10 text-gypi-amber-ink">{d}</span>)}
                        </div>
                      </div>
                    )}
                    {tieneFotos && (
                      <div className="py-2">
                        <div className="text-xs font-bold uppercase tracking-[0.06em] mb-2 text-gypi-cyan-ink">📷 Fotos ({r.fotos_urls.length})</div>
                        <div className={`gap-2 grid ${r.fotos_urls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                          {r.fotos_urls.map((url, i) => (
                            <button key={i} onClick={() => setFotoViewer({ fotos: r.fotos_urls, index: i })} aria-label={`Ampliar foto ${i + 1}`} className={`cursor-pointer rounded-[10px] overflow-hidden bg-gypi-surface border border-gypi-border relative p-0 ${r.fotos_urls.length === 1 ? "aspect-video" : "aspect-square"}`}>
                              <Image src={url} alt={`Foto ${i + 1}`} fill sizes="(max-width: 768px) 50vw, 300px" className="object-cover" />
                              <div className="absolute bottom-1.5 right-1.5 py-[3px] px-2 rounded-md bg-black/60 text-white text-xs font-semibold" aria-hidden="true">🔍 Ampliar</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {!tieneFotos && r.fotos > 0 && (
                      <div className="py-2 px-2.5 rounded-lg text-[12px] text-gypi-dim bg-gypi-surf-hi">
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

/* ─── Tab de Liquidación de sueldos ─── */
function ReporteLiquidacionTab({ fechaDesde, fechaHasta, labelPeriodo, empresaId, empresa }) {
  const [datos, setDatos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paywallInfo, setPaywallInfo] = useState(null);
  const [showBilling, setShowBilling] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!fechaDesde || !fechaHasta) return;
    (async () => {
      setLoading(true);
      setPaywallInfo(null);
      try {
        const token = getToken();
        const res = await fetch(`/api/reportes/liquidacion?desde=${fechaDesde}&hasta=${fechaHasta}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 402) { setPaywallInfo({ upgrade_a: json.upgrade_a, mensaje: json.error }); setDatos([]); return; }
        if (!res.ok) { console.error(json.error || `Error ${res.status}`); setDatos([]); return; }
        setDatos(json.empleados || []);
      } catch (e) { console.error(e); setDatos([]); }
      finally { setLoading(false); }
    })();
  }, [fechaDesde, fechaHasta, empresaId]);

  const exportarCSV = () => {
    const headers = ["Legajo", "Nombre", "Horas trabajadas", "Tardanzas", "Minutos tarde", "Horas extra", "Días ausencia"];
    const rows = datos.map(d => [d.legajo, d.nombre, d.horas_trabajadas, d.tardanzas, d.minutos_tarde, d.horas_extra, d.dias_ausencia]);
    exportCSV([headers, ...rows], `Liquidacion_${fechaDesde}_a_${fechaHasta}.csv`);
    toast.success("Listo: la planilla de liquidación quedó en tus descargas.");
  };

  if (loading) return <Puntos />;

  if (paywallInfo) {
    return (
      <>
        <div className="bg-gypi-surface rounded-2xl p-8 text-center border border-gypi-border">
          <div className="text-[32px] mb-2">🔒</div>
          <div className="text-sm font-bold text-gypi-text">Liquidación no disponible en tu plan</div>
          <div className="text-xs text-gypi-dim mt-1.5">{paywallInfo.mensaje}</div>
        </div>
        <Paywall
          planActual={empresa?.plan_activo || "free"}
          planRequerido={paywallInfo.upgrade_a || "asistencia_15"}
          mensaje={paywallInfo.mensaje}
          onClose={() => setPaywallInfo(null)}
          onUpgrade={() => { setPaywallInfo(null); setShowBilling(true); }}
        />
        {showBilling && <BillingScreen onClose={() => setShowBilling(false)} />}
      </>
    );
  }

  if (datos.length === 0) return (
    <div className="bg-gypi-surface rounded-2xl p-8 text-center border border-gypi-border">
      <div className="text-[32px] mb-2">🧾</div>
      <div className="text-sm font-bold text-gypi-text">Sin empleados activos</div>
      <div className="text-xs text-gypi-dim mt-1.5">No hay datos para liquidar en este período.</div>
    </div>
  );

  const totales = datos.reduce((a, d) => ({
    minutos: a.minutos + Math.round((Number(d.horas_trabajadas) || 0) * 60),
    minutosExtra: a.minutosExtra + Math.round((Number(d.horas_extra) || 0) * 60),
    tardanzas: a.tardanzas + (d.tardanzas || 0),
    ausencias: a.ausencias + (d.dias_ausencia || 0),
  }), { minutos: 0, minutosExtra: 0, tardanzas: 0, ausencias: 0 });

  return (
    <>
      <div className="rounded-2xl p-[18px] border border-gypi-border mb-4 bg-gypi-surface">
        <div className="g-overline">Liquidación de sueldos</div>
        <div className="text-[13px] text-gypi-text mt-1.5 leading-normal">Novedades del periodo <strong className="text-gypi-amber-ink">{labelPeriodo}</strong> para pasarle al contador: horas, tardanzas, horas extra y ausencias por empleado.</div>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3.5">
        <div className="bg-gypi-surface rounded-xl p-2.5 text-center border border-gypi-border">
          <div className="font-heading text-base font-bold text-gypi-text">{fmtHora(totales.minutos)}</div>
          <div className="text-[11px] text-gypi-dim font-bold">Horas</div>
        </div>
        <div className="bg-gypi-surface rounded-xl p-2.5 text-center border border-gypi-border">
          <div className="font-heading text-base font-bold text-gypi-amber-ink">{fmtHora(totales.minutosExtra)}</div>
          <div className="text-[11px] text-gypi-dim font-bold">Hs. extra</div>
        </div>
        <div className="bg-gypi-surface rounded-xl p-2.5 text-center border border-gypi-border">
          <div className="font-heading text-base font-bold text-gypi-red-ink">{totales.tardanzas}</div>
          <div className="text-[11px] text-gypi-dim font-bold">Tardanzas</div>
        </div>
        <div className="bg-gypi-surface rounded-xl p-2.5 text-center border border-gypi-border">
          <div className="font-heading text-base font-bold text-gypi-cyan-ink">{totales.ausencias}</div>
          <div className="text-[11px] text-gypi-dim font-bold">Ausencias</div>
        </div>
      </div>

      <Button className="w-full mb-3.5" onClick={exportarCSV}>📥 Descargar para el contador (Excel)</Button>

      <div className="flex flex-col gap-2">
        {datos.map(d => (
          <div key={d.legajo} className="bg-gypi-surface rounded-xl p-3 border border-gypi-border flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[10px] flex items-center justify-center font-heading text-[11px] font-bold shrink-0 bg-gypi-surf-hi text-gypi-dim">L-{d.legajo}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-gypi-text truncate">{d.nombre}</div>
              <div className="text-xs text-gypi-dim mt-0.5">
                {fmtHora(Math.round((Number(d.horas_trabajadas) || 0) * 60))} trabajadas
                {d.tardanzas > 0 && <span className="text-gypi-amber-ink"> · {d.tardanzas} tardanza{d.tardanzas > 1 ? "s" : ""} ({d.minutos_tarde} min)</span>}
                {d.horas_extra > 0 && <span className="text-gypi-green-ink"> · {fmtHora(Math.round(Number(d.horas_extra) * 60))} extra</span>}
                {d.dias_ausencia > 0 && <span className="text-gypi-red-ink"> · {d.dias_ausencia} ausencia{d.dias_ausencia > 1 ? "s" : ""}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function ReportesScreen() {
  const { divisiones: divisionesCtx, usuario, empresa } = useAuth();
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
      const [emps, fichsRes] = await Promise.all([
        sb.get(`empleados?empresa_id=eq.${empresaId}&activo=eq.true&select=id,nombre,apodo,legajo,division,area,rol,diagrama&order=nombre.asc`),
        // Paginado: un mes con muchos empleados supera el cap de 1000 filas
        // por request de /api/data y el reporte quedaba truncado en silencio.
        sbGetAll(`fichadas?empresa_id=eq.${empresaId}&fecha=gte.${fechaDesde}&fecha=lte.${fechaHasta}&select=legajo,fecha,ingreso,egreso,horas_trabajadas&order=fecha.asc`),
      ]);
      setEmpleados((emps || []).filter(e => e.rol === "operativo"));
      setFichadas(fichsRes.data || []);
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
    toast.success("Listo: la planilla quedó en tus descargas."); setTimeout(() => setExporting(null), 1000);
  };
  const handleExportPDF = () => {
    setExporting("pdf");
    const headers = ["Empleado", "Legajo", "Div", "Laborales", "Presentes", "Ausencias", "Tard.", "% Asist.", "% Horas"];
    const rows = cumplimiento.map(c => [c.emp.apodo || c.emp.nombre, c.emp.legajo, c.emp.division || "—", c.laborales, c.presentes, c.ausencias, c.tardanzas, c.pctCumplimiento + "%", c.pctHoras + "%"]);
    exportImagen(`Reporte Cumplimiento — ${labelPeriodo}`, headers, rows, `División: ${division === "todas" ? "Todas" : division} · ${new Date().toLocaleDateString("es-AR")}`);
    toast.success("Listo: la imagen quedó en tus descargas."); setTimeout(() => setExporting(null), 1000);
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
    toast.success("Listo: el detalle quedó en tus descargas."); setTimeout(() => setExporting(null), 1000);
  };

  const navAnterior = () => {
    if (periodo === "semana") setWeekOffset(w => w - 1);
    else { let m = mesMes - 1, y = mesYear; if (m < 0) { m = 11; y--; } setMesMes(m); setMesYear(y); }
  };
  const navSiguiente = () => {
    if (periodo === "semana") setWeekOffset(w => w + 1);
    else { let m = mesMes + 1, y = mesYear; if (m > 11) { m = 0; y++; } setMesMes(m); setMesYear(y); }
  };

  return (
    <div className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px]">


      {/* Tabs */}
      <div className="flex gap-1.5 mb-3.5 overflow-x-auto pb-0.5">
        <Chip active={tab === "cumplimiento"} onClick={() => setTab("cumplimiento")} color={MARCA}>📊 Asistencia</Chip>
        {/* Solo lo que la empresa tiene y el rol puede usar (R5, U-16) */}
        {tieneModulo(empresa, "actividad") && <Chip active={tab === "produccion"} onClick={() => setTab("produccion")} color={MARCA}>⚙️ Producción</Chip>}
        {tieneModulo(empresa, "obra") && <Chip active={tab === "obra"} onClick={() => setTab("obra")} color={MARCA}>🏗️ Obra</Chip>}
        <Chip active={tab === "reportes"} onClick={() => setTab("reportes")} color={MARCA}>📥 Descargar</Chip>
        {!esSupervisor(usuario) && <Chip active={tab === "liquidacion"} onClick={() => setTab("liquidacion")} color={MARCA}>💰 Liquidación</Chip>}
      </div>

      {/* Periodo */}
      <div className="flex gap-1.5 mb-2.5">
        <Chip active={periodo === "semana"} onClick={() => setPeriodo("semana")} color={MARCA}>Por semana</Chip>
        <Chip active={periodo === "mes"} onClick={() => setPeriodo("mes")} color={MARCA}>Por mes</Chip>
      </div>

      {/* Nav periodo */}
      <div className="flex items-center justify-between py-2.5 px-3.5 bg-gypi-surface rounded-[14px] border border-gypi-border mb-3.5">
        <button onClick={navAnterior} aria-label={periodo === "semana" ? "Semana anterior" : "Mes anterior"} className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl">←</button>
        <div className="text-center">
          <div className="text-sm font-bold text-gypi-text font-heading">{labelPeriodo}</div>
        </div>
        <button onClick={navSiguiente} aria-label={periodo === "semana" ? "Semana siguiente" : "Mes siguiente"} className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl">→</button>
      </div>

      {/* Filtro división */}
      <div className="flex gap-[5px] mb-3.5 overflow-x-auto pb-1">
        {DIVISIONES.map(d => <Chip key={d.id} active={division === d.id} onClick={() => setDivision(d.id)} color={d.color || MARCA}>{d.label}</Chip>)}
      </div>

      {loading ? (
        <Puntos />
      ) : tab === "produccion" ? (
        <ReporteProduccionTab fechaDesde={fechaDesde} fechaHasta={fechaHasta} labelPeriodo={labelPeriodo} empresaId={empresaId} />
      ) : tab === "obra" ? (
        <ReportesObraTab empresaId={empresaId} />
      ) : tab === "liquidacion" ? (
        <ReporteLiquidacionTab fechaDesde={fechaDesde} fechaHasta={fechaHasta} labelPeriodo={labelPeriodo} empresaId={empresaId} empresa={empresa} />
      ) : tab === "cumplimiento" ? (
        <>
          {/* Números del período (R11: Stat, con la etiqueta completa) */}
          <section aria-label="Resumen del período" className="grid grid-cols-2 gap-2 mb-4">
            <Stat value={`${metricas.pctPromedio}%`} label="Asistencia" tone={TONO_STAT[pctTono(metricas.pctPromedio)]} />
            <Stat value={`${metricas.pctHorasPromedio}%`} label="Horas cumplidas" tone={TONO_STAT[pctTono(metricas.pctHorasPromedio)]} />
            <Stat value={metricas.totalAusencias} label="Faltas" tone={metricas.totalAusencias > 0 ? "mal" : "bien"} />
            <Stat value={metricas.totalTardanzas} label={metricas.totalMinTardanzas > 0 ? `Tardanzas (${minutosLegibles(metricas.totalMinTardanzas)} en total)` : "Tardanzas"} tone={metricas.totalTardanzas > 0 ? "atencion" : "bien"} />
          </section>

          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="m-0 text-[14px] font-bold text-gypi-text font-heading">Por empleado</h3>
            <span className="text-[12px] text-gypi-dim">{metricas.perfectos} con asistencia perfecta</span>
          </div>
          {/* Qué significa cada ícono de los días */}
          <ul aria-label="Qué significa cada ícono" className="flex flex-wrap gap-x-3 gap-y-1 m-0 mb-2.5 p-0 list-none text-[12px] text-gypi-dim">
            {LEYENDA_DIAS.map(([icono, tono, texto]) => (
              <li key={icono} className="flex items-center gap-1"><span className={`w-[18px] h-[18px] rounded text-[11px] font-bold flex items-center justify-center ${TONO[tono].fondo} ${TONO[tono].txt}`} aria-hidden="true">{icono}</span>{texto}</li>
            ))}
          </ul>

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
                  <div key={c.emp.id} className={`bg-gypi-surface rounded-[14px] overflow-hidden border ${c.ausencias > 0 ? TONO.mal.borde : c.tardanzas > 0 ? TONO.aviso.borde : "border-gypi-border"}`}>
                    <button onClick={() => setExpandedEmp(isExpanded ? null : c.emp.id)} aria-expanded={isExpanded} className="w-full p-3.5 cursor-pointer flex items-center gap-2.5 bg-transparent border-none text-left font-body">
                      <div className={`w-11 h-9 rounded-[10px] flex items-center justify-center font-heading text-[13px] font-bold shrink-0 ${TONO[pctTono(c.pctCumplimiento)].fondo} ${TONO[pctTono(c.pctCumplimiento)].txt}`} title="Asistencia">{c.pctCumplimiento}%</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold text-gypi-text truncate">{c.emp.apodo || c.emp.nombre}</div>
                        <div className="text-[11px] text-gypi-dim mt-[1px]">
                          L-{c.emp.legajo}
                          {c.ausencias > 0 && <span className={TONO.mal.txt}> · {c.ausencias} falta{c.ausencias > 1 ? "s" : ""}</span>}
                          {c.tardanzas > 0 && <span className={TONO.aviso.txt}> · {c.tardanzas} tardanza{c.tardanzas > 1 ? "s" : ""}</span>}
                          {c.extras > 0 && <span className={TONO.extra.txt}> · {c.extras} en franco</span>}
                        </div>
                      </div>
                      {periodo === "semana" && (
                        <div className="flex gap-[3px]" aria-hidden="true">
                          {c.diasData.map((d, i) => (
                            <div key={i} className={`w-[18px] h-[18px] rounded text-[11px] font-bold flex items-center justify-center ${TONO[d.tono].fondo} ${TONO[d.tono].txt}`}>{d.icon}</div>
                          ))}
                        </div>
                      )}
                      {flecha(isExpanded)}
                    </button>
                    {isExpanded && (
                      <div className="px-3.5 pb-3.5 border-t border-gypi-border">
                        <div className="flex gap-2 mt-3 mb-3">
                          <div className={`flex-1 py-2 text-center rounded-lg ${TONO.bien.fondo}`}>
                            <div className={`font-mono text-sm font-bold ${TONO.bien.txt}`}>{c.presentes}/{c.laborales}</div>
                            <div className="text-[12px] text-gypi-dim">Días que vino</div>
                          </div>
                          <div className={`flex-1 py-2 text-center rounded-lg ${TONO[pctTono(c.pctHoras)].fondo}`}>
                            <div className={`font-mono text-sm font-bold ${TONO[pctTono(c.pctHoras)].txt}`}>{c.pctHoras}%</div>
                            <div className="text-[12px] text-gypi-dim">Horas</div>
                          </div>
                          {c.totalTardanzaMin > 0 && (
                            <div className={`flex-1 py-2 text-center rounded-lg ${TONO.aviso.fondo}`}>
                              <div className={`font-mono text-sm font-bold ${TONO.aviso.txt}`}>{c.totalTardanzaMin} min</div>
                              <div className="text-[12px] text-gypi-dim">Tarde en total</div>
                            </div>
                          )}
                        </div>
                        {c.diasData.filter(d => d.estado !== "futuro").map((d, i) => (
                          <div key={i} className="flex items-center gap-2 py-[7px] border-b border-gypi-border last:border-b-0">
                            <div className={`w-[22px] h-[22px] rounded-md text-xs font-bold flex items-center justify-center ${TONO[d.tono].fondo} ${TONO[d.tono].txt}`} aria-hidden="true">{d.icon}</div>
                            <div className="w-12 text-[12px] font-semibold text-gypi-text">{d.fecha.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit" })}</div>
                            <div className="flex-1 text-[12px] text-gypi-dim truncate">{d.detalle || d.estado}</div>
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
          <div className="rounded-2xl p-[18px] border border-gypi-border mb-4 bg-gypi-surface">
            <div className="g-overline">Descargar</div>
            <div className="text-[13px] text-gypi-text mt-1.5 leading-normal">Del periodo <strong className="text-gypi-amber-ink">{labelPeriodo}</strong>, división <strong className="text-gypi-amber-ink">{division === "todas" ? "Todas" : division}</strong>. Las planillas se abren con Excel.</div>
          </div>

          {/* Resumen cumplimiento */}
          <div className="bg-gypi-surface rounded-2xl p-4 border border-gypi-border mb-3">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg bg-gypi-green/10" aria-hidden="true">📊</div>
              <div className="flex-1">
                <div className="text-[14px] font-bold text-gypi-text">Resumen de asistencia</div>
                <div className="text-[12px] text-gypi-dim mt-0.5">Una fila por empleado: días, faltas, tardanzas y horas</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleExportCSV} loading={exporting === "csv"}>📄 Excel</Button>
              <Button className="flex-1" variant="secondary" onClick={handleExportPDF} loading={exporting === "pdf"}>🖼 Imagen</Button>
            </div>
          </div>

          {/* Detalle fichadas */}
          <div className="bg-gypi-surface rounded-2xl p-4 border border-gypi-border mb-3">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg bg-gypi-cyan/10" aria-hidden="true">🕐</div>
              <div className="flex-1">
                <div className="text-[14px] font-bold text-gypi-text">Detalle de fichadas</div>
                <div className="text-[12px] text-gypi-dim mt-0.5">Cada día de cada empleado: a qué hora tenía que entrar y a qué hora fichó</div>
              </div>
            </div>
            <Button className="w-full" variant="secondary" onClick={handleExportDetalleCSV} loading={exporting === "detalle"}>📄 Planilla con el detalle (Excel)</Button>
          </div>

        </>
      )}
    </div>
  );
}
