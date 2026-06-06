import { useState, useEffect, useCallback } from "react";
import { C, fmtTime } from "./lib/theme";
import { sb } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";
import { getDivisionesConTodas } from "./lib/constants";

/* ═══ CONSTANTES ═══ */
const CAUSAS_MAP = { M: "Falta material", H: "Falta herramienta", I: "Indicación", O: "Otro" };
const TIPOS_MAP = {
  N: { nombre: "Normal", color: C.green },
  R: { nombre: "Retrabajo", color: C.red },
  E: { nombre: "Error", color: C.amber },
  C: { nombre: "Cambio", color: C.violet },
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

/* ═══ COMPONENT ═══ */
export default function GerenciaActividadScreen({ empresaId }) {
  const DIVISIONES = getDivisionesConTodas();
  const [division, setDivision] = useState("todas");
  const [resumen, setResumen] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const hoy = new Date().toISOString().slice(0, 10);

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

  const datos = division === "todas" ? resumen : resumen.filter(r => r.division === division);
  const getEtapa = (div, codigo) => etapas.find(e => e.division === div && e.codigo === codigo) || { nombre: "?", icon: "❓", color: C.dim };

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

  /* ═══ RENDER ═══ */
  return (
    <div className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px]">
      {/* Filtros */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {DIVISIONES.map(d => (
          <Chip key={d.id} active={division === d.id} onClick={() => setDivision(d.id)} color={d.color || C.amber}>
            {d.icon ? `${d.icon} ` : ""}{d.label}
          </Chip>
        ))}
      </div>

      {loading && resumen.length === 0 ? (
        <div className="text-center p-10 text-gypi-dim text-[13px]">Cargando actividades...</div>
      ) : (
        <>
          {/* Cards resumen */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {/* Trabajando */}
            <div className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border">
              <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.08em]">Trabajando</div>
              <div className="font-heading text-[28px] font-bold text-gypi-green mt-1">{enActividad}</div>
              <div className="text-[11px] text-gypi-dim mt-0.5">{fmtMinutos(totalMinProd)} acumuladas</div>
            </div>
            {/* En espera */}
            <div className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border">
              <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.08em]">En espera</div>
              <div className="font-heading text-[28px] font-bold text-gypi-red mt-1">{enEspera}</div>
              <div className="text-[11px] text-gypi-dim mt-0.5">{fmtMinutos(totalMinEspera)} acumuladas</div>
            </div>
            {/* Sin tarea */}
            <div className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border">
              <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.08em]">Sin tarea</div>
              <div className="font-heading text-[28px] font-bold text-gypi-mute mt-1">{sinTarea}</div>
              <div className="text-[11px] text-gypi-dim mt-0.5">de {totalOperarios} total</div>
            </div>
            {/* % Productivo */}
            <div className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border">
              <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.08em]">% Productivo</div>
              <div className="font-heading text-[28px] font-bold mt-1" style={{ color: (totalMinProd + totalMinEspera) > 0 ? (totalMinProd / (totalMinProd + totalMinEspera) >= 0.7 ? C.green : C.amber) : C.mute }}>
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
              const divInfo = DIVISIONES.find(d => d.id === div) || { label: div, icon: "📦", color: C.dim };
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

                        return (
                          <div key={op.empleado_id} className="bg-gypi-surface rounded-[14px] p-3.5" style={{
                            border: `1px solid ${tieneActiva ? (isEspera ? `${C.red}30` : `${etapa?.color}30`) : C.border}`,
                          }}>
                            {/* Row 1: nombre + estado */}
                            <div className="flex items-center gap-2.5 mb-2">
                              <div className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center font-heading text-xs font-bold" style={{
                                background: tieneActiva ? (isEspera ? C.redS : `${etapa?.color}22`) : C.surfLo,
                                color: tieneActiva ? (isEspera ? C.red : etapa?.color) : C.mute,
                              }}>
                                {tieneActiva ? etapa?.icon : (op.empleado_nombre || "").split(" ").map(w => w[0]).slice(0, 2).join("")}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-bold text-gypi-text truncate">{op.empleado_nombre}</div>
                                <div className="text-[11px] text-gypi-dim mt-px">
                                  L-{op.legajo}
                                  {tieneActiva && ` · ${etapa?.nombre}`}
                                  {!tieneActiva && " · sin tarea"}
                                </div>
                              </div>
                              {tieneActiva ? (
                                <div className="text-right">
                                  {isEspera ? (
                                    <Tag color={C.red}>⏸ Espera</Tag>
                                  ) : (
                                    <Tag color={etapa?.color}>● {fmtElapsed(elapsedSec)}</Tag>
                                  )}
                                </div>
                              ) : (
                                <Tag color={C.mute}>—</Tag>
                              )}
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
                                <span className="font-mono font-bold" style={{ color: pctProd >= 80 ? C.green : pctProd >= 60 ? C.amber : C.red }}>{Math.round(pctProd)}%</span>
                              </div>
                            </div>

                            {/* Progress bar */}
                            <div className="mt-2 h-1 rounded-sm bg-gypi-surf-hi overflow-hidden">
                              <div className="h-full rounded-sm transition-[width] duration-500" style={{
                                background: pctProd >= 80 ? C.green : pctProd >= 60 ? C.amber : C.red,
                                width: `${Math.min(pctProd, 100)}%`,
                              }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })
          )}

          {/* Refresh manual */}
          <button onClick={cargarResumen} className="w-full mt-3 p-3 rounded-xl bg-gypi-surface border border-gypi-border text-gypi-dim text-xs font-semibold font-body cursor-pointer flex items-center justify-center gap-1.5">
            🔄 Actualizar datos
          </button>
          <div className="text-center mt-2 text-[10px] text-gypi-mute">
            Se actualiza automáticamente cada 60 segundos
          </div>
        </>
      )}
    </div>
  );
}
