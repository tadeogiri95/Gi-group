import { useState, useEffect, useCallback } from "react";
import { C, fH, fB, fM, fmtTime } from "./lib/theme";
import { sb } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";

/* ═══ CONSTANTES ═══ */
import { DIVISIONES_CON_TODAS as DIVISIONES } from "./lib/constants";

const CAUSAS_MAP = { M: "Falta material", H: "Falta herramienta", I: "Indicación", O: "Otro" };
const TIPOS_MAP = { N: { nombre: "Normal", color: C.green }, R: { nombre: "Retrabajo", color: C.red }, E: { nombre: "Error", color: C.amber }, C: { nombre: "Cambio", color: C.violet } };
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
export default function GerenciaActividadScreen() {
  const [division, setDivision] = useState("todas");
  const [resumen, setResumen] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const hoy = new Date().toISOString().slice(0, 10);

  // ── Timer para actualizar elapsed de tareas activas ──
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000); // cada 30s
    return () => clearInterval(t);
  }, []);

  // ── Cargar etapas (todas las divisiones) ──
  useEffect(() => {
    sb.get("catalogo_etapas?activo=eq.true&order=orden.asc")
      .then(setEtapas)
      .catch(e => console.error("Error cargando etapas:", e));
  }, []);

  // ── Cargar resumen del equipo ──
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

  // Auto-refresh cada 60 segundos
  useEffect(() => {
    const interval = setInterval(cargarResumen, 60000);
    return () => clearInterval(interval);
  }, [cargarResumen]);

  // ── Filtrar por división ──
  const datos = division === "todas" ? resumen : resumen.filter(r => r.division === division);

  // ── Getters ──
  const getEtapa = (div, codigo) => etapas.find(e => e.division === div && e.codigo === codigo) || { nombre: "?", icon: "❓", color: C.dim };

  // ── Métricas globales ──
  const totalOperarios = datos.length;
  const enActividad = datos.filter(r => r.etapa_actual != null && r.etapa_actual > 0).length;
  const enEspera = datos.filter(r => r.etapa_actual === 0).length;
  const sinTarea = datos.filter(r => r.etapa_actual == null).length;
  const totalMinProd = datos.reduce((acc, r) => acc + (parseFloat(r.minutos_productivos) || 0), 0);
  const totalMinEspera = datos.reduce((acc, r) => acc + (parseFloat(r.minutos_espera) || 0), 0);

  // ── Agrupar por división para la vista "todas" ──
  const porDivision = {};
  datos.forEach(r => {
    if (!porDivision[r.division]) porDivision[r.division] = [];
    porDivision[r.division].push(r);
  });

  // ── Render ──
  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px" }}>
      {/* Filtros */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
        {DIVISIONES.map(d => (
          <Chip key={d.id} active={division === d.id} onClick={() => setDivision(d.id)} color={d.color || C.amber}>
            {d.icon ? `${d.icon} ` : ""}{d.label}
          </Chip>
        ))}
      </div>

      {loading && resumen.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: C.dim, fontSize: 13 }}>Cargando actividades...</div>
      ) : (
        <>
          {/* Cards resumen */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            <div style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em" }}>Trabajando</div>
              <div style={{ fontFamily: fH, fontSize: 28, fontWeight: 700, color: C.green, marginTop: 4 }}>{enActividad}</div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{fmtMinutos(totalMinProd)} acumuladas</div>
            </div>
            <div style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em" }}>En espera</div>
              <div style={{ fontFamily: fH, fontSize: 28, fontWeight: 700, color: C.red, marginTop: 4 }}>{enEspera}</div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{fmtMinutos(totalMinEspera)} acumuladas</div>
            </div>
            <div style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em" }}>Sin tarea</div>
              <div style={{ fontFamily: fH, fontSize: 28, fontWeight: 700, color: C.mute, marginTop: 4 }}>{sinTarea}</div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>de {totalOperarios} total</div>
            </div>
            <div style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em" }}>% Productivo</div>
              <div style={{ fontFamily: fH, fontSize: 28, fontWeight: 700, color: (totalMinProd + totalMinEspera) > 0 ? (totalMinProd / (totalMinProd + totalMinEspera) >= 0.7 ? C.green : C.amber) : C.mute, marginTop: 4 }}>
                {(totalMinProd + totalMinEspera) > 0 ? Math.round(totalMinProd * 100 / (totalMinProd + totalMinEspera)) : 0}%
              </div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>prod / (prod+espera)</div>
            </div>
          </div>

          {/* Lista de operarios */}
          {datos.length === 0 ? (
            <div style={{ background: C.surface, borderRadius: 16, padding: 40, textAlign: "center", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Sin actividad hoy</div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>Todavía nadie registró tareas{division !== "todas" ? ` en ${DIVISIONES.find(d => d.id === division)?.label}` : ""}</div>
            </div>
          ) : (
            Object.entries(porDivision).sort(([a], [b]) => a.localeCompare(b)).map(([div, operarios]) => {
              const divInfo = DIVISIONES.find(d => d.id === div) || { label: div, icon: "📦", color: C.dim };
              return (
                <div key={div} style={{ marginBottom: 20 }}>
                  {/* Division header (solo si estamos viendo todas) */}
                  {division === "todas" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 16 }}>{divInfo.icon}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, fontFamily: fH, color: divInfo.color }}>{divInfo.label}</span>
                      <span style={{ fontSize: 11, color: C.dim }}>· {operarios.length} operarios</span>
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {operarios
                      .sort((a, b) => {
                        // Activos primero, espera segundo, sin tarea al final
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
                          <div key={op.empleado_id} style={{
                            background: C.surface, borderRadius: 14, padding: 14,
                            border: `1px solid ${tieneActiva ? (isEspera ? `${C.red}30` : `${etapa?.color}30`) : C.border}`,
                          }}>
                            {/* Row 1: nombre + estado */}
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                              <div style={{
                                width: 38, height: 38, borderRadius: 10,
                                background: tieneActiva ? (isEspera ? C.redS : `${etapa?.color}22`) : C.surfLo,
                                color: tieneActiva ? (isEspera ? C.red : etapa?.color) : C.mute,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontFamily: fH, fontSize: 12, fontWeight: 700,
                              }}>
                                {tieneActiva ? etapa?.icon : (op.empleado_nombre || "").split(" ").map(w => w[0]).slice(0, 2).join("")}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {op.empleado_nombre}
                                </div>
                                <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>
                                  L-{op.legajo}
                                  {tieneActiva && ` · ${etapa?.nombre}`}
                                  {!tieneActiva && " · sin tarea"}
                                </div>
                              </div>
                              {tieneActiva ? (
                                <div style={{ textAlign: "right" }}>
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
                            <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
                                <div style={{ width: 6, height: 6, borderRadius: 3, background: C.green }} />
                                <span style={{ color: C.dim }}>Prod:</span>
                                <span style={{ fontFamily: fM, fontWeight: 600, color: C.text }}>{fmtMinutos(parseFloat(op.minutos_productivos))}</span>
                              </div>
                              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
                                <div style={{ width: 6, height: 6, borderRadius: 3, background: C.red }} />
                                <span style={{ color: C.dim }}>Espera:</span>
                                <span style={{ fontFamily: fM, fontWeight: 600, color: C.text }}>{fmtMinutos(parseFloat(op.minutos_espera))}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ fontFamily: fM, fontWeight: 700, color: pctProd >= 80 ? C.green : pctProd >= 60 ? C.amber : C.red }}>{Math.round(pctProd)}%</span>
                              </div>
                            </div>

                            {/* Progress bar */}
                            <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: C.surfHi, overflow: "hidden" }}>
                              <div style={{ height: "100%", borderRadius: 2, background: pctProd >= 80 ? C.green : pctProd >= 60 ? C.amber : C.red, width: `${Math.min(pctProd, 100)}%`, transition: "width 0.5s" }} />
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
          <button onClick={cargarResumen} style={{
            width: "100%", marginTop: 12, padding: 12, borderRadius: 12,
            background: C.surface, border: `1px solid ${C.border}`, color: C.dim,
            fontSize: 12, fontWeight: 600, fontFamily: fB, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            🔄 Actualizar datos
          </button>
          <div style={{ textAlign: "center", marginTop: 8, fontSize: 10, color: C.mute }}>
            Se actualiza automáticamente cada 60 segundos
          </div>
        </>
      )}
    </div>
  );
}
