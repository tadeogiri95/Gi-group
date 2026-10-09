import { useState, useEffect, useCallback } from "react";
import { sb } from "./lib/supabase";
import { useRefrescoVisible } from "./hooks/useRefrescoVisible";
import { Tag, Chip } from "./components/ui";
import Stat from "./components/ui/Stat";
import { getDivisionesConTodas } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { hoyArg } from "./lib/dates";

// R11: el color dice el ESTADO de la persona (trabajando / parado / sin tarea),
// no la etapa; la etapa va con su ícono y su nombre.
const MARCA = "var(--color-empresa-primary)";
const ESTADO = {
  trabajando: { txt: "text-gypi-green-ink", fondo: "bg-gypi-green/10", borde: "border-gypi-green/25", barra: "fill-gypi-green" },
  parado: { txt: "text-gypi-red-ink", fondo: "bg-gypi-red/10", borde: "border-gypi-red/25", barra: "fill-gypi-red" },
  aviso: { txt: "text-gypi-amber-ink", fondo: "bg-gypi-amber/10", borde: "border-gypi-amber/25", barra: "fill-gypi-amber" },
  sinTarea: { txt: "text-gypi-mute", fondo: "bg-gypi-surf-lo", borde: "border-gypi-border", barra: "fill-gypi-mute" },
};
const tonoPct = (pct) => pct >= 80 ? "trabajando" : pct >= 60 ? "aviso" : "parado";

/* ═══ CONSTANTES ═══ */
const CAUSAS_MAP = { M: "Falta material", H: "Falta herramienta", I: "Indicación", O: "Otro" };
const TIPOS_MAP = {
  N: { nombre: "Normal", txt: "text-gypi-green-ink" },
  R: { nombre: "Retrabajo", txt: "text-gypi-red-ink" },
  E: { nombre: "Error", txt: "text-gypi-amber-ink" },
  C: { nombre: "Cambio", txt: "text-gypi-violet" },
};
// Minutos de un registro: los guardados o, si sigue abierto, hasta ahora
const minutosDe = (a) => a.duracion_min ? parseFloat(a.duracion_min) : a.hora_fin ? (new Date(a.hora_fin) - new Date(a.hora_inicio)) / 60000 : (Date.now() - new Date(a.hora_inicio).getTime()) / 60000;

/** Barra de porcentaje sin estilos sueltos: un SVG con el ancho como atributo. */
function Barra({ pct, tono }) {
  return (
    <svg className="mt-2 w-full h-1 rounded-sm bg-gypi-surf-hi block" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
      <rect width={Math.max(0, Math.min(pct, 100))} height="4" rx="1" className={ESTADO[tono].barra} />
    </svg>
  );
}

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

  // Cada minuto, solo con la pestaña a la vista (F3-04)
  useRefrescoVisible(cargarResumen, { intervaloMs: 60000 });

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
  const getEtapa = (div, codigo) => etapas.find(e => e.division === div && e.codigo === codigo) || { nombre: "?", icon: "❓", color: "var(--color-text-dim)" };

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
    if (etapaCodigo === 0) return { label: "Parado", tono: "parado" };
    if (etapaCodigo > 0) return { label: "Trabajando", tono: "trabajando" };
    return { label: "Otro", tono: "sinTarea" };
  };
  const pctTotal = (totalMinProd + totalMinEspera) > 0 ? Math.round(totalMinProd * 100 / (totalMinProd + totalMinEspera)) : null;

  /* ═══ RENDER ═══ */
  return (
    <section aria-label="Actividad del taller" className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px]">
      {/* Filtros */}
      <div role="group" aria-label="Filtros por división" className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {DIVISIONES.map(d => (
          <Chip key={d.id} active={division === d.id} onClick={() => setDivision(d.id)} color={d.color || MARCA}>
            {d.icon ? `${d.icon} ` : ""}{d.label}
          </Chip>
        ))}
      </div>

      {loading && resumen.length === 0 ? (
        <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
      ) : (
        <>
          {/* Resumen (R11: Stat, etiquetas completas) */}
          <section aria-label="Ahora en la planta" className="grid grid-cols-2 gap-2 mb-4">
            <Stat value={enActividad} label={`Trabajando · ${fmtMinutos(totalMinProd)} en el día`} tone={enActividad > 0 ? "bien" : "normal"} />
            <Stat value={enEspera} label={`Parados · ${fmtMinutos(totalMinEspera)} en el día`} tone={enEspera > 0 ? "mal" : "normal"} />
            <Stat value={sinTarea} label={`Sin tarea, de ${totalOperarios}`} />
            <Stat value={pctTotal == null ? "—" : `${pctTotal}%`} label="Del tiempo, trabajando (el resto, parados)" tone={pctTotal == null ? "normal" : pctTotal >= 70 ? "bien" : "atencion"} />
          </section>

          {/* Lista de operarios */}
          {datos.length === 0 ? (
            <div className="bg-gypi-surface rounded-2xl p-10 text-center border border-gypi-border">
              <div className="text-[32px] mb-3" aria-hidden="true">📋</div>
              <div className="text-sm font-bold text-gypi-text">Sin actividad hoy</div>
              <div className="text-[13px] text-gypi-dim mt-1.5">
                Todavía nadie registró tareas{division !== "todas" ? ` en ${DIVISIONES.find(d => d.id === division)?.label}` : ""}
              </div>
            </div>
          ) : (
            Object.entries(porDivision).sort(([a], [b]) => a.localeCompare(b)).map(([div, operarios]) => {
              const divInfo = DIVISIONES.find(d => d.id === div) || { label: div, icon: "📦" };
              return (
                <div key={div} className="mb-5">
                  {division === "todas" && (
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-base" aria-hidden="true">{divInfo.icon}</span>
                      <h3 className="m-0 text-sm font-bold font-heading text-gypi-text">{divInfo.label}</h3>
                      <span className="text-[12px] text-gypi-dim">· {operarios.length} operarios</span>
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
                        const estado = !tieneActiva ? "sinTarea" : isEspera ? "parado" : "trabajando";

                        return (
                          <div key={op.empleado_id} className={`bg-gypi-surface rounded-[14px] overflow-hidden border ${ESTADO[estado].borde}`}>
                            {/* Card que se abre (R11: botón de verdad) */}
                            <button
                              type="button"
                              className="w-full p-3.5 cursor-pointer select-none bg-transparent border-none text-left font-body"
                              aria-expanded={isExpanded}
                              aria-label={`${nombre}: ${estado === "trabajando" ? `trabajando en ${etapa?.nombre} hace ${fmtElapsed(elapsedSec)}` : estado === "parado" ? "parado" : "sin tarea"}. Ver su día`}
                              onClick={() => toggleDetalle(op.empleado_id)}
                            >
                              {/* Row 1: nombre + estado */}
                              <div className="flex items-center gap-2.5 mb-2">
                                <div className={`w-[38px] h-[38px] rounded-[10px] flex items-center justify-center font-heading text-xs font-bold shrink-0 ${ESTADO[estado].fondo} ${ESTADO[estado].txt}`} aria-hidden="true">
                                  {tieneActiva ? (isEspera ? "⏸" : etapa?.icon) : nombre.split(" ").map(w => w[0]).slice(0, 2).join("")}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[14px] font-bold text-gypi-text truncate">{nombre}</div>
                                  <div className="text-[12px] text-gypi-dim mt-px">
                                    L-{op.legajo}
                                    {tieneActiva && !isEspera && ` · ${etapa?.nombre}`}
                                    {isEspera && " · parado"}
                                    {!tieneActiva && " · sin tarea"}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {tieneActiva ? (
                                    isEspera ? <Tag color="var(--color-red)">⏸ Parado</Tag> : <Tag color="var(--color-green)">● {fmtElapsed(elapsedSec)}</Tag>
                                  ) : (
                                    <Tag color="var(--color-text-muted)">—</Tag>
                                  )}
                                  <span className={`inline-block text-xs text-gypi-mute transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true">▼</span>
                                </div>
                              </div>

                              {/* Row 2: métricas del día */}
                              <div className="flex gap-3 text-[12px] items-center">
                                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-gypi-green" aria-hidden="true" /><span className="text-gypi-dim">Trabajó</span> <span className="font-mono font-semibold text-gypi-text">{fmtMinutos(parseFloat(op.minutos_productivos))}</span></span>
                                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-gypi-red" aria-hidden="true" /><span className="text-gypi-dim">Parado</span> <span className="font-mono font-semibold text-gypi-text">{fmtMinutos(parseFloat(op.minutos_espera))}</span></span>
                                <span className={`ml-auto font-mono font-bold ${ESTADO[tonoPct(pctProd)].txt}`}>{Math.round(pctProd)}%</span>
                              </div>

                              <Barra pct={pctProd} tono={tonoPct(pctProd)} />
                            </button>

                            {/* ═══ PANEL DE DETALLE EXPANDIBLE ═══ */}
                            {isExpanded && (
                              <div className="border-t border-gypi-border bg-gypi-surf-lo px-3.5 py-3">
                                {/* Fichada del día */}
                                {fichadaDetalle && (
                                  <div className="flex flex-wrap gap-2.5 mb-3 text-[12px]">
                                    <span><span className="text-gypi-dim">Entrada </span><span className="font-mono font-semibold text-gypi-text">{fichadaDetalle.ingreso?.slice(0, 5) || "—"}</span></span>
                                    <span><span className="text-gypi-dim">Salida </span><span className="font-mono font-semibold text-gypi-text">{fichadaDetalle.egreso?.slice(0, 5) || "todavía en planta"}</span></span>
                                    {fichadaDetalle.horas_trabajadas > 0 && (
                                      <span><span className="text-gypi-dim">Horas </span><span className="font-mono font-semibold text-gypi-text">{parseFloat(fichadaDetalle.horas_trabajadas).toFixed(1)} h</span></span>
                                    )}
                                    {parseFloat(fichadaDetalle.horas_extra) > 0 && (
                                      <span className={`px-1.5 py-0.5 rounded font-bold ${ESTADO.aviso.fondo} ${ESTADO.aviso.txt}`}>+{parseFloat(fichadaDetalle.horas_extra).toFixed(1)} h extra</span>
                                    )}
                                    {fichadaDetalle.llegada_tarde && (
                                      <span className={`px-1.5 py-0.5 rounded font-bold ${ESTADO.parado.fondo} ${ESTADO.parado.txt}`}>Llegó {fichadaDetalle.minutos_tarde} min tarde</span>
                                    )}
                                  </div>
                                )}

                                <h4 className="m-0 text-[12px] font-bold text-gypi-dim uppercase tracking-[0.08em] mb-2.5">Lo que hizo hoy</h4>

                                {loadingDetalle ? (
                                  <div className="text-center py-4">
                                    <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
                                  </div>
                                ) : actividades.length === 0 ? (
                                  <div className="text-center py-3 text-[13px] text-gypi-dim">
                                    Todavía no cargó tareas hoy
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-1.5">
                                    {actividades.map((act, idx) => {
                                      const tipoAct = getTipoActividad(act.etapa);
                                      const etapaInfo = act.etapa > 0 ? getEtapa(act.division || op.division, act.etapa) : null;
                                      const tipoReg = TIPOS_MAP[act.tipo] || TIPOS_MAP.N;
                                      const durMin = minutosDe(act);
                                      const enCurso = !act.hora_fin;

                                      return (
                                        <div key={act.id || idx} className={`rounded-[10px] p-2.5 bg-gypi-surface border ${enCurso ? ESTADO[tipoAct.tono].borde : "border-gypi-border"}`}>
                                          {/* Línea 1: horario + tipo */}
                                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <span className="font-mono text-[12px] font-semibold text-gypi-text">
                                              {fmtHora(act.hora_inicio)} → {enCurso ? "ahora" : fmtHora(act.hora_fin)}
                                            </span>
                                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${ESTADO[tipoAct.tono].fondo} ${ESTADO[tipoAct.tono].txt}`}>
                                              {tipoAct.label}
                                            </span>
                                            {enCurso && (
                                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${ESTADO.aviso.fondo} ${ESTADO.aviso.txt}`}>En curso</span>
                                            )}
                                          </div>

                                          {/* Línea 2: proyecto + etapa + duración */}
                                          <div className="flex items-center gap-1.5 text-[12px]">
                                            {act.codigo_proyecto && (
                                              <span className="font-mono font-semibold text-gypi-amber-ink">OT {act.codigo_proyecto}</span>
                                            )}
                                            {etapaInfo && (
                                              <span className="text-gypi-text">{etapaInfo.icon} {etapaInfo.nombre}</span>
                                            )}
                                            {act.etapa === 0 && (
                                              <span className={ESTADO.parado.txt}>⏸ Parado</span>
                                            )}
                                            <span className="ml-auto font-mono font-semibold text-gypi-text">{fmtMinutos(durMin)}</span>
                                          </div>

                                          {/* Línea 3: tipo de registro + causa (si aplica) */}
                                          {(act.tipo !== "N" || act.causa) && (
                                            <div className="flex items-center gap-1.5 mt-1 text-xs text-gypi-dim">
                                              {act.tipo !== "N" && <span className={`font-bold ${tipoReg.txt}`}>{tipoReg.nombre}</span>}
                                              {act.causa && <span>· {CAUSAS_MAP[act.causa] || act.causa}</span>}
                                            </div>
                                          )}

                                          {act.observaciones && (
                                            <div className="mt-1 text-xs text-gypi-dim italic truncate">&ldquo;{act.observaciones}&rdquo;</div>
                                          )}
                                        </div>
                                      );
                                    })}

                                    {/* Resumen del detalle */}
                                    <div className="mt-1 pt-2 flex gap-3 text-[12px] text-gypi-dim border-t border-gypi-border">
                                      <span>{actividades.length} registro{actividades.length !== 1 ? "s" : ""}</span>
                                      <span className={`font-semibold ${ESTADO.trabajando.txt}`}>{fmtMinutos(actividades.filter(a => a.etapa > 0).reduce((t, a) => t + minutosDe(a), 0))} trabajando</span>
                                      <span className={`font-semibold ${ESTADO.parado.txt}`}>{fmtMinutos(actividades.filter(a => a.etapa === 0).reduce((t, a) => t + minutosDe(a), 0))} parado</span>
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
          <button onClick={cargarResumen} aria-label="Actualizar datos de actividad" className="w-full mt-3 p-3 min-h-11 rounded-xl bg-gypi-surface border border-gypi-border text-gypi-dim text-[13px] font-semibold font-body cursor-pointer flex items-center justify-center gap-1.5">
            🔄 Actualizar ahora
          </button>
          <div className="text-center mt-2 text-xs text-gypi-mute">Se actualiza sola cada minuto</div>
        </>
      )}
    </section>
  );
}
