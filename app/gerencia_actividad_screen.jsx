import { useState, useEffect, useCallback } from "react";
import { sb } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";
import { getDivisionesConTodas } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { hoyArg } from "./lib/dates";

const V = {
  amber: "var(--color-empresa-primary, #F97316)",
  green: "#16A34A",
  red: "#DC2626",
  redS: "rgba(220,38,38,0.10)",
  greenS: "rgba(22,163,74,0.10)",
  cyan: "#0891B2",
  violet: "#7C3AED",
  dim: "var(--color-text-dim)",
  mute: "var(--color-text-muted)",
  text: "var(--color-text)",
  surface: "var(--color-surface)",
  surfLo: "var(--color-surf-lo)",
  surfHi: "var(--color-surf-hi)",
  border: "var(--color-border)",
  bg: "var(--color-bg)",
};

/* ═══ CONSTANTES ═══ */
const CAUSAS_MAP = { M: "Falta material", H: "Falta herramienta", I: "Indicación", O: "Otro" };
const TIPOS_MAP = {
  N: { nombre: "Normal", color: V.green },
  R: { nombre: "Retrabajo", color: V.red },
  E: { nombre: "Error", color: V.amber },
  C: { nombre: "Cambio", color: V.violet },
};

const fmtElapsed = (seconds) => {
  if (!seconds || seconds < 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
};

const fmtMinutos = (min) => {
  if (!min) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const fmtHora = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
};

/* ═══ COMPONENT ═══ */
export default function GerenciaActividadScreen({ empresaId }) {
  const { divisiones: divisionesCtx } = useAuth();
  const DIVISIONES = getDivisionesConTodas(divisionesCtx);
  const [division, setDivision] = useState("todas");
  const [resumen, setResumen] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [expandido, setExpandido] = useState(null);
  const [actividades, setActividades] = useState([]);
  const [fichadaDetalle, setFichadaDetalle] = useState(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);

  const hoy = hoyArg();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    sb.get(`etapas?empresa_id=eq.${empresaId}&activa=eq.true&order=orden.asc`)
      .then(setEtapas)
      .catch(e => console.error("Error cargando etapas:", e));
  }, []);

  const cargarResumen = useCallback(async () => {
    setLoading(true);
    try {
      const data = await sb.get(`v_resumen_diario?fecha=eq.${hoy}&select=*`);
      setResumen(data || []);
    } catch (err) {
      console.error("Error cargando resumen gerencia:", err);
    } finally {
      setLoading(false);
    }
  }, [hoy]);

  useEffect(() => { cargarResumen(); }, [cargarResumen]);

  useEffect(() => {
    const interval = setInterval(cargarResumen, 60000);
    return () => clearInterval(interval);
  }, [cargarResumen]);

  const toggleDetalle = async (empleadoId) => {
    if (expandido === empleadoId) {
      setExpandido(null);
      setActividades([]);
      setFichadaDetalle(null);
      return;
    }
    setExpandido(empleadoId);
    setLoadingDetalle(true);
    try {
      const [data, fichadas] = await Promise.all([
        sb.get(`registro_actividades?empleado_id=eq.${empleadoId}&fecha=eq.${hoy}&order=hora_inicio.asc&select=id,hora_inicio,hora_fin,codigo_proyecto,etapa,tipo,causa,division,observaciones,duracion_min`),
        sb.get(`fichadas?empleado_id=eq.${empleadoId}&fecha=eq.${hoy}&select=ingreso,egreso,horas_trabajadas,horas_extra,llegada_tarde,minutos_tarde&limit=1`),
      ]);
      setActividades(data || []);
      setFichadaDetalle(fichadas?.[0] || null);
    } catch (e) {
      console.error("Error cargando detalle:", e);
      setActividades([]);
      setFichadaDetalle(null);
    } finally {
      setLoadingDetalle(false);
    }
  };

  const datos = division === "todas" ? resumen : resumen.filter(r => r.division === division);
  const getEtapa = (div, codigo) => etapas.find(e => e.division === div && e.codigo === codigo) || { nombre: "?", icon: "❓", color: V.dim };

  const totalOperarios = datos.length;
  const enActividad = datos.filter(r => r.etapa_actual != null && r.etapa_actual > 0).length;
  const enEspera = datos.filter(r => r.etapa_actual === 0).length;
  const sinTarea = datos.filter(r => r.etapa_actual == null).length;
  const totalMinProd = datos.reduce((acc, r) => acc + (parseFloat(r.minutos_productivos) || 0), 0);
  const totalMinEspera = datos.reduce((acc, r) => acc + (parseFloat(r.minutos_espera) || 0), 0);

  const porDivision = {};
  datos.forEach(r => {
    if (!porDivision[r.division]) porDivision[r.division] = [];
    porDivision[r.division].push(r);
  });

  const getTipoActividad = (etapaCodigo) => {
    if (etapaCodigo === 0) return { label: "Espera", color: V.red, bg: V.redS };
    if (etapaCodigo > 0) return { label: "Productivo", color: V.green, bg: V.greenS };
    return { label: "Improductivo", color: V.mute, bg: V.surfLo };
  };

  /* ═══ RENDER ═══ */
  return (
    <section aria-label="Actividad del taller" className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px]">
      {/* Filtros */}
      <div role="group" aria-label="Filtros por división" className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {DIVISIONES.map(d => (
          <Chip key={d.id} active={division === d.id} onClick={() => setDivision(d.id)} color={d.color || V.amber}>
            {d.icon ? `${d.icon} ` : ""}{d.label}
          </Chip>
        ))}
      </div>

      {loading && resumen.length === 0 ? (
        <div className="gypi-dots"><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /></div>
      ) : (
        <>
          {/* Cards resumen */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border">
              <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.08em]">Trabajando</div>
              <div className="font-heading text-[28px] font-bold text-gypi-green mt-1">{enActividad}</div>
              <div className="text-[11px] text-gypi-dim mt-0.5">{fmtMinutos(totalMinProd)} acumuladas</div>
            </div>
            <div className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border">
              <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.08em]">En espera</div>
              <div className="font-heading text-[28px] font-bold text-gypi-red mt-1">{enEspera}</div>
              <div className="text-[11px] text-gypi-dim mt-0.5">{fmtMinutos(totalMinEspera)} acumuladas</div>
            </div>
            <div className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border">
              <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.08em]">Sin tarea</div>
              <div className="font-heading text-[28px] font-bold text-gypi-mute mt-1">{sinTarea}</div>
              <div className="text-[11px] text-gypi-dim mt-0.5">de {totalOperarios} total</div>
            </div>
            <div className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border">
              <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.08em]">% Productivo</div>
              <div className="font-heading text-[28px] font-bold mt-1" style={{ color: (totalMinProd + totalMinEspera) > 0 ? (totalMinProd / (totalMinProd + totalMinEspera) >= 0.7 ? V.green : V.amber) : V.mute }}>
                {(totalMinProd + totalMinEspera) > 0 ? Math.round(totalMinProd * 100 / (totalMinProd + totalMinEspera)) : 0}%
              </div>
              <div className="text-[11px] text-gypi-dim mt-0.5">prod / (prod+espera)</div>
            </div>
          </div>

          {/* Lista de operarios */}
          {datos.length === 0 ? (
            <div className="bg-gypi-surface rounded-2xl p-10 text-center border border-gypi-border">
              <div className="text-[32px] mb-3">📋</div>
              <div className="text-sm font-bold text-gypi-text">Sin actividad hoy</div>
              <div className="text-xs text-gypi-dim mt-1.5">
                Todavía nadie registró tareas{division !== "todas" ? ` en ${DIVISIONES.find(d => d.id === division)?.label}` : ""}
              </div>
            </div>
          ) : (
            Object.entries(porDivision).sort(([a], [b]) => a.localeCompare(b)).map(([div, operarios]) => {
              const divInfo = DIVISIONES.find(d => d.id === div) || { label: div, icon: "📦", color: V.dim };
              return (
                <div key={div} className="mb-5">
                  {division === "todas" && (
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-base">{divInfo.icon}</span>
                      <span className="text-sm font-bold font-heading" style={{ color: divInfo.color }}>{divInfo.label}</span>
                      <span className="text-[11px] text-gypi-dim">· {operarios.length} operarios</span>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    {operarios
                      .sort((a, b) => {
                        const prio = (r) => r.etapa_actual != null ? (r.etapa_actual > 0 ? 0 : 1) : 2;
                        return prio(a) - prio(b);
                      })
                      .map(op => {
                        const tieneActiva = op.etapa_actual != null;
                        const isEspera = op.etapa_actual === 0;
                        const etapa = tieneActiva ? getEtapa(op.division, op.etapa_actual) : null;
                        const elapsedSec = op.inicio_tarea_actual ? Math.floor((now - new Date(op.inicio_tarea_actual).getTime()) / 1000) : 0;
                        const pctProd = parseFloat(op.pct_productivo) || 0;
                        const isExpanded = expandido === op.empleado_id;
                        const nombre = op.empleado_nombre || op.nombre || "";

                        return (
                          <div key={op.empleado_id} className="bg-gypi-surface rounded-[14px] overflow-hidden" style={{
                            border: `1px solid ${tieneActiva ? (isEspera ? `${V.red}30` : `${etapa?.color}30`) : V.border}`,
                          }}>
                            {/* Card clickeable */}
                            <div
                              className="p-3.5 cursor-pointer"
                              role="button"
                              tabIndex={0}
                              aria-expanded={isExpanded}
                              aria-label={`Detalle de ${nombre}`}
                              onClick={() => toggleDetalle(op.empleado_id)}
                              onKeyDown={e => (e.key === "Enter" || e.key === " ") && toggleDetalle(op.empleado_id)}
                              style={{ userSelect: "none" }}
                            >
                              {/* Row 1: nombre + estado */}
                              <div className="flex items-center gap-2.5 mb-2">
                                <div className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center font-heading text-xs font-bold" style={{
                                  background: tieneActiva ? (isEspera ? V.redS : `${etapa?.color}22`) : V.surfLo,
                                  color: tieneActiva ? (isEspera ? V.red : etapa?.color) : V.mute,
                                }}>
                                  {tieneActiva ? etapa?.icon : nombre.split(" ").map(w => w[0]).slice(0, 2).join("")}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[13px] font-bold text-gypi-text truncate">{nombre}</div>
                                  <div className="text-[11px] text-gypi-dim mt-px">
                                    L-{op.legajo}
                                    {tieneActiva && ` · ${etapa?.nombre}`}
                                    {!tieneActiva && " · sin tarea"}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {tieneActiva ? (
                                    <div className="text-right">
                                      {isEspera ? (
                                        <Tag color={V.red}>⏸ Espera</Tag>
                                      ) : (
                                        <Tag color={etapa?.color}>● {fmtElapsed(elapsedSec)}</Tag>
                                      )}
                                    </div>
                                  ) : (
                                    <Tag color={V.mute}>—</Tag>
                                  )}
                                  <span className="text-[10px] text-gypi-mute" style={{ transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
                                </div>
                              </div>

                              {/* Row 2: métricas del día */}
                              <div className="flex gap-2 text-[11px]">
                                <div className="flex-1 flex items-center gap-1">
                                  <div className="w-1.5 h-1.5 rounded-full bg-gypi-green" />
                                  <span className="text-gypi-dim">Prod:</span>
                                  <span className="font-mono font-semibold text-gypi-text">{fmtMinutos(parseFloat(op.minutos_productivos))}</span>
                                </div>
                                <div className="flex-1 flex items-center gap-1">
                                  <div className="w-1.5 h-1.5 rounded-full bg-gypi-red" />
                                  <span className="text-gypi-dim">Espera:</span>
                                  <span className="font-mono font-semibold text-gypi-text">{fmtMinutos(parseFloat(op.minutos_espera))}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="font-mono font-bold" style={{ color: pctProd >= 80 ? V.green : pctProd >= 60 ? V.amber : V.red }}>{Math.round(pctProd)}%</span>
                                </div>
                              </div>

                              {/* Progress bar */}
                              <div className="mt-2 h-1 rounded-sm bg-gypi-surf-hi overflow-hidden">
                                <div className="h-full rounded-sm transition-[width] duration-500" style={{
                                  background: pctProd >= 80 ? V.green : pctProd >= 60 ? V.amber : V.red,
                                  width: `${Math.min(pctProd, 100)}%`,
                                }} />
                              </div>
                            </div>

                            {/* ═══ PANEL DE DETALLE EXPANDIBLE ═══ */}
                            {isExpanded && (
                              <div style={{ borderTop: `1px solid ${V.border}`, background: V.surfLo, padding: "12px 14px" }}>
                                {/* Fichada del día */}
                                {fichadaDetalle && (
                                  <div className="flex flex-wrap gap-2.5 mb-3 text-[11px]">
                                    <div className="flex items-center gap-1">
                                      <span className="text-gypi-dim">Ingreso:</span>
                                      <span className="font-mono font-semibold text-gypi-text">{fichadaDetalle.ingreso?.slice(0, 5) || "—"}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-gypi-dim">Egreso:</span>
                                      <span className="font-mono font-semibold text-gypi-text">{fichadaDetalle.egreso?.slice(0, 5) || "en planta"}</span>
                                    </div>
                                    {fichadaDetalle.horas_trabajadas > 0 && (
                                      <div className="flex items-center gap-1">
                                        <span className="text-gypi-dim">Hs trab:</span>
                                        <span className="font-mono font-semibold text-gypi-text">{parseFloat(fichadaDetalle.horas_trabajadas).toFixed(1)}h</span>
                                      </div>
                                    )}
                                    {parseFloat(fichadaDetalle.horas_extra) > 0 && (
                                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: `${V.amber}20` }}>
                                        <span className="font-bold" style={{ color: V.amber }}>+{parseFloat(fichadaDetalle.horas_extra).toFixed(1)}h extra</span>
                                      </div>
                                    )}
                                    {fichadaDetalle.llegada_tarde && (
                                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: V.redS }}>
                                        <span className="font-bold" style={{ color: V.red }}>Tarde {fichadaDetalle.minutos_tarde}min</span>
                                      </div>
                                    )}
                                  </div>
                                )}

                                <div className="text-[11px] font-bold text-gypi-dim uppercase tracking-[0.08em] mb-2.5">
                                  Actividades de la jornada
                                </div>

                                {loadingDetalle ? (
                                  <div className="text-center py-4">
                                    <div className="gypi-dots"><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /></div>
                                  </div>
                                ) : actividades.length === 0 ? (
                                  <div className="text-center py-3 text-[12px] text-gypi-dim">
                                    Sin registros de actividad detallados
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-1.5">
                                    {actividades.map((act, idx) => {
                                      const tipoAct = getTipoActividad(act.etapa);
                                      const etapaInfo = act.etapa > 0 ? getEtapa(act.division || op.division, act.etapa) : null;
                                      const tipoReg = TIPOS_MAP[act.tipo] || TIPOS_MAP.N;
                                      const durMin = act.duracion_min
                                        ? parseFloat(act.duracion_min)
                                        : act.hora_fin
                                          ? (new Date(act.hora_fin) - new Date(act.hora_inicio)) / 60000
                                          : (Date.now() - new Date(act.hora_inicio).getTime()) / 60000;
                                      const enCurso = !act.hora_fin;

                                      return (
                                        <div key={act.id || idx} className="rounded-[10px] p-2.5" style={{
                                          background: V.surface,
                                          border: `1px solid ${enCurso ? `${tipoAct.color}40` : V.border}`,
                                        }}>
                                          {/* Línea 1: horario + tipo */}
                                          <div className="flex items-center gap-2 mb-1">
                                            <span className="font-mono text-[11px] font-semibold text-gypi-text">
                                              {fmtHora(act.hora_inicio)} → {enCurso ? "en curso" : fmtHora(act.hora_fin)}
                                            </span>
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: tipoAct.bg, color: tipoAct.color }}>
                                              {tipoAct.label}
                                            </span>
                                            {enCurso && (
                                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${V.amber}20`, color: V.amber }}>
                                                EN CURSO
                                              </span>
                                            )}
                                          </div>

                                          {/* Línea 2: proyecto + etapa + duración */}
                                          <div className="flex items-center gap-1.5 text-[11px]">
                                            {act.codigo_proyecto && (
                                              <span className="font-mono font-semibold" style={{ color: V.amber }}>
                                                OT {act.codigo_proyecto}
                                              </span>
                                            )}
                                            {etapaInfo && (
                                              <span style={{ color: etapaInfo.color }}>
                                                {etapaInfo.icon} {etapaInfo.nombre}
                                              </span>
                                            )}
                                            {act.etapa === 0 && (
                                              <span style={{ color: V.red }}>⏸ En espera</span>
                                            )}
                                            <span className="ml-auto font-mono font-semibold text-gypi-text">
                                              {fmtMinutos(durMin)}
                                            </span>
                                          </div>

                                          {/* Línea 3: tipo de registro + causa (si aplica) */}
                                          {(act.tipo !== "N" || act.causa) && (
                                            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gypi-dim">
                                              {act.tipo !== "N" && (
                                                <span className="font-bold" style={{ color: tipoReg.color }}>
                                                  {tipoReg.nombre}
                                                </span>
                                              )}
                                              {act.causa && (
                                                <span>· {CAUSAS_MAP[act.causa] || act.causa}</span>
                                              )}
                                            </div>
                                          )}

                                          {/* Observaciones */}
                                          {act.observaciones && (
                                            <div className="mt-1 text-[10px] text-gypi-dim italic truncate">
                                              "{act.observaciones}"
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}

                                    {/* Resumen del detalle */}
                                    <div className="mt-1 pt-2 flex gap-3 text-[10px] text-gypi-dim" style={{ borderTop: `1px solid ${V.border}` }}>
                                      <span>{actividades.length} actividad{actividades.length !== 1 ? "es" : ""}</span>
                                      <span>·</span>
                                      <span className="font-semibold" style={{ color: V.green }}>
                                        {fmtMinutos(actividades.filter(a => a.etapa > 0).reduce((s, a) => {
                                          const d = a.duracion_min ? parseFloat(a.duracion_min) : a.hora_fin ? (new Date(a.hora_fin) - new Date(a.hora_inicio)) / 60000 : (Date.now() - new Date(a.hora_inicio).getTime()) / 60000;
                                          return s + d;
                                        }, 0))} prod
                                      </span>
                                      <span className="font-semibold" style={{ color: V.red }}>
                                        {fmtMinutos(actividades.filter(a => a.etapa === 0).reduce((s, a) => {
                                          const d = a.duracion_min ? parseFloat(a.duracion_min) : a.hora_fin ? (new Date(a.hora_fin) - new Date(a.hora_inicio)) / 60000 : (Date.now() - new Date(a.hora_inicio).getTime()) / 60000;
                                          return s + d;
                                        }, 0))} espera
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })
          )}

          {/* Refresh manual */}
          <button onClick={cargarResumen} aria-label="Actualizar datos de actividad" className="w-full mt-3 p-3 rounded-xl bg-gypi-surface border border-gypi-border text-gypi-dim text-xs font-semibold font-body cursor-pointer flex items-center justify-center gap-1.5">
            🔄 Actualizar datos
          </button>
          <div className="text-center mt-2 text-[10px] text-gypi-mute">
            Se actualiza automáticamente cada 60 segundos
          </div>
        </>
      )}
    </section>
  );
}
