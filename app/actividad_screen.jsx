import { useState, useEffect, useRef } from "react";
import { C, fH, fB, fM } from "./lib/theme";

/* ═══ CONSTANTES UI ═══ */
const TIPOS = [
  { cod: "N", nombre: "Normal", color: C.green },
  { cod: "R", nombre: "Retrabajo", color: C.red },
  { cod: "E", nombre: "Error previo", color: C.amber },
  { cod: "C", nombre: "Cambio cliente", color: C.violet },
];
const CAUSAS = [
  { cod: "M", nombre: "Falta material", icon: "📦" },
  { cod: "H", nombre: "Falta herramienta", icon: "🔧" },
  { cod: "I", nombre: "Indicación", icon: "💬" },
  { cod: "O", nombre: "Otro", icon: "❓" },
];

/* ═══ HELPERS ═══ */
import { fmtTime } from "./lib/theme";
const fmtElapsed = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

import { Tag } from "./components/ui";

/* ═══ HELPERS de etapas ═══ */
function getEtapaInfo(etapas, codigo) {
  return etapas.find(e => e.codigo === codigo) || { codigo, nombre: "?", icon: "❓", color: C.dim };
}

/* ═══ MAIN COMPONENT ═══ */
export default function ActividadScreen({
  tareaActiva,
  elapsed,
  historial,
  etapas = [],
  proyectos = [],
  proyectosLoading = false,
  loading,
  horasHoy,
  iniciarTarea: onIniciar,
  finalizarTarea: onFinalizar,
  cambiarTarea: onCambiar,
}) {
  const [state, setState] = useState("idle");
  const [proyectoSeleccionado, setProyectoSeleccionado] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [manualOT, setManualOT] = useState("");
  const [modoManual, setModoManual] = useState(false);
  const [etapaSeleccionada, setEtapaSeleccionada] = useState(null);
  const [tipoSeleccionado, setTipoSeleccionado] = useState("N");
  const [showHistorial, setShowHistorial] = useState(false);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const inputRef = useRef(null);
  const manualInputRef = useRef(null);

  // ── Sincronizar estado de UI con tarea activa de Supabase ──
  useEffect(() => {
    if (tareaActiva && !tareaActiva.hora_fin) {
      setState("active");
    } else if (!loading && !tareaActiva) {
      if (state === "active") setState("idle");
    }
  }, [tareaActiva, loading]);

  // ── Focus buscador en paso 2 ──
  useEffect(() => {
    if (state === "selecting" && step === 2 && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [state, step]);

  // ── Filtrar proyectos por búsqueda ──
  const proyectosFiltrados = proyectos.filter(p => {
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase();
    return (
      p.ot?.toLowerCase().includes(q) ||
      p.cliente?.toLowerCase().includes(q) ||
      p.proyecto?.toLowerCase().includes(q) ||
      p.obra?.toLowerCase().includes(q) ||
      p.codigo?.toLowerCase().includes(q)
    );
  });

  // ── Acciones ──
  const iniciarTarea = async () => {
    const otFinal = modoManual ? manualOT.trim() : proyectoSeleccionado?.ot;
    if (!otFinal) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await onIniciar({
        etapa: etapaSeleccionada,
        codigo_proyecto: etapaSeleccionada === 0 ? null : otFinal,
        tipo: tipoSeleccionado,
        causa: null,
      });
      setProyectoSeleccionado(null);
      setBusqueda("");
      setManualOT("");
      setModoManual(false);
      setEtapaSeleccionada(null);
      setTipoSeleccionado("N");
      setStep(1);
      setState("active");
    } catch (e) { console.error(e); setErrorMsg("Error al iniciar la tarea. Intentá de nuevo."); }
    setSaving(false);
  };

  const finalizarTarea = async (nextAction = "idle") => {
    setSaving(true);
    setErrorMsg(null);
    try { await onFinalizar(); } catch (e) { console.error(e); setErrorMsg("Error al finalizar la tarea. Intentá de nuevo."); setSaving(false); return; }
    setSaving(false);
    if (nextAction === "cambiar") {
      setState("selecting");
      setStep(1);
    } else {
      setState("idle");
    }
  };

  const confirmarPausa = async (causa) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await onIniciar({ etapa: 0, codigo_proyecto: null, tipo: "N", causa });
      setState("active");
    } catch (e) { console.error(e); setErrorMsg("Error al registrar tiempo muerto. Intentá de nuevo."); }
    setSaving(false);
  };

  // ── Info derivada ──
  const etapaActiva = tareaActiva ? getEtapaInfo(etapas, tareaActiva.etapa) : null;
  const etapaSelInfo = etapaSeleccionada != null ? getEtapaInfo(etapas, etapaSeleccionada) : null;
  const proyectoActivo = tareaActiva?.codigo_proyecto
    ? proyectos.find(p => String(p.ot) === String(tareaActiva.codigo_proyecto))
    : null;

  // ═══ RENDER: LOADING ═══
  if (loading && !tareaActiva && historial.length === 0) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: C.dim, fontFamily: fB }}>
        <div style={{ fontSize: 13 }}>Cargando actividades...</div>
      </div>
    );
  }

  // ═══ RENDER: IDLE ═══
  if (state === "idle" && !showHistorial) {
    return (
      <div style={{ fontFamily: fB, display: "flex", flexDirection: "column", flex: 1, overflowY: "auto" }}>
        <div style={{ padding: "24px 20px", flex: 1 }}>
          {errorMsg&&<div style={{padding:12,background:C.redS,color:C.red,borderRadius:10,fontSize:12,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}><span>{errorMsg}</span><button onClick={()=>setErrorMsg(null)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontWeight:700,fontSize:14}}>✕</button></div>}
          <div style={{
            background: `linear-gradient(135deg, ${C.amber}08, ${C.surface} 60%)`,
            borderRadius: 24, padding: 32, border: `1px solid ${C.border}`,
            textAlign: "center", position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, borderRadius: "50%", background: `${C.amber}10`, filter: "blur(80px)" }} />
            <div style={{ position: "relative" }}>
              <div style={{ width: 72, height: 72, borderRadius: 20, background: C.amberS, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 32 }}>🔨</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: fH, marginBottom: 8 }}>Sin tarea activa</div>
              <div style={{ fontSize: 13, color: C.dim, marginBottom: 24, lineHeight: 1.5 }}>Iniciá una tarea para registrar tu actividad en el proyecto</div>
              <button onClick={() => { setState("selecting"); setStep(1); }} style={{
                width: "100%", padding: "16px 24px", borderRadius: 16,
                background: C.amber, border: "none", color: "#000",
                fontSize: 16, fontWeight: 700, fontFamily: fB, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                <span style={{ fontSize: 20 }}>▶</span> Iniciar tarea
              </button>
            </div>
          </div>

          {historial.length > 0 && (
            <button onClick={() => setShowHistorial(true)} style={{
              width: "100%", marginTop: 16, padding: 16, borderRadius: 16,
              background: C.surface, border: `1px solid ${C.border}`, color: C.text,
              fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span>📋 Historial de hoy</span>
              <Tag color={C.dim}>{historial.length} tramos</Tag>
            </button>
          )}
        </div>
      </div>
    );
  }

  // ═══ RENDER: HISTORIAL ═══
  if (showHistorial) {
    return (
      <div style={{ fontFamily: fB, flex: 1, overflowY: "auto" }}>
        <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setShowHistorial(false)} style={{ background: "none", border: "none", color: C.text, cursor: "pointer", padding: 6, fontSize: 20 }}>←</button>
          <h2 style={{ margin: 0, fontFamily: fH, fontSize: 22, fontWeight: 700, flex: 1 }}>Historial de hoy</h2>
          <Tag color={C.green}>{historial.length} tramos</Tag>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {historial.map((r, i) => {
            const etapa = getEtapaInfo(etapas, r.etapa);
            const horaIni = r.hora_inicio ? fmtTime(new Date(r.hora_inicio)) : "—";
            const horaFin = r.hora_fin ? fmtTime(new Date(r.hora_fin)) : "—";
            const durSec = r.duracion_min ? Math.round(r.duracion_min * 60) : 0;
            const proy = r.codigo_proyecto ? proyectos.find(p => String(p.ot) === String(r.codigo_proyecto)) : null;
            return (
              <div key={r.id || i} style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `${etapa.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{etapa.icon}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{etapa.nombre}</div>
                      {r.codigo_proyecto && (
                        <div style={{ fontSize: 11, color: C.dim, fontFamily: fM }}>
                          OT {r.codigo_proyecto}{proy ? ` · ${proy.cliente}` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                  <Tag color={TIPOS.find(t => t.cod === r.tipo)?.color}>{r.tipo}</Tag>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim, marginTop: 4 }}>
                  <span style={{ fontFamily: fM }}>{horaIni} → {horaFin}</span>
                </div>
                {r.causa && <div style={{ marginTop: 6, fontSize: 11, color: C.red }}>Causa: {CAUSAS.find(c => c.cod === r.causa)?.nombre}</div>}
              </div>
            );
          })}
          {historial.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: C.dim }}>Sin registros todavía</div>
          )}
        </div>
      </div>
    );
  }

  // ═══ RENDER: SELECTING (wizard) ═══
  if (state === "selecting") {
    return (
      <div style={{ fontFamily: fB, display: "flex", flexDirection: "column", flex: 1, overflowY: "auto" }}>
        <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => { setState(tareaActiva ? "active" : "idle"); setStep(1); setBusqueda(""); setProyectoSeleccionado(null); }} style={{ background: "none", border: "none", color: C.text, cursor: "pointer", padding: 6, fontSize: 20 }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Nueva tarea</div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: fH }}>Paso {step} de 3</div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {[1, 2, 3].map(s => (
              <div key={s} style={{ width: s === step ? 24 : 8, height: 8, borderRadius: 4, background: s <= step ? C.amber : C.surfHi, transition: "all 0.3s" }} />
            ))}
          </div>
        </div>

        <div style={{ padding: 20, flex: 1 }}>
          {/* STEP 1: Etapa */}
          {step === 1 && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, fontFamily: fH }}>¿Qué vas a hacer?</div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Elegí la etapa de trabajo</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {etapas.filter(e => e.codigo > 0).map(e => (
                  <button key={e.codigo} onClick={() => { setEtapaSeleccionada(e.codigo); setStep(2); }} style={{
                    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
                    padding: "14px 12px", cursor: "pointer", textAlign: "left",
                    display: "flex", alignItems: "center", gap: 10, fontFamily: fB,
                    transition: "all 0.15s",
                  }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `${e.color}22`, color: e.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{e.icon}</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{e.nombre}</div>
                      <div style={{ fontSize: 10, color: C.dim }}>{e.nombre}</div>
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => { setState("pausing"); }} style={{
                width: "100%", marginTop: 12, padding: 14, borderRadius: 14,
                background: C.redS, border: `1px solid ${C.red}30`, color: C.red,
                fontSize: 13, fontWeight: 700, fontFamily: fB, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                ⏸ Registrar espera / tiempo muerto
              </button>
            </div>
          )}

          {/* STEP 2: Selector de proyecto (Google Sheets) + carga manual */}
          {step === 2 && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, fontFamily: fH }}>Proyecto</div>

              {/* Toggle: Buscar / Manual */}
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <button onClick={() => { setModoManual(false); setManualOT(""); }} style={{
                  flex: 1, padding: "8px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: !modoManual ? `${C.amber}22` : C.surface, color: !modoManual ? C.amber : C.dim,
                  fontSize: 12, fontWeight: 700, fontFamily: fB,
                }}>🔍 Buscar OT</button>
                <button onClick={() => { setModoManual(true); setProyectoSeleccionado(null); setBusqueda(""); setTimeout(() => manualInputRef.current?.focus(), 100); }} style={{
                  flex: 1, padding: "8px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: modoManual ? `${C.amber}22` : C.surface, color: modoManual ? C.amber : C.dim,
                  fontSize: 12, fontWeight: 700, fontFamily: fB,
                }}>✏️ Cargar manual</button>
              </div>

              {/* Modo búsqueda */}
              {!modoManual && (<>
                <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>Buscá por OT, cliente u obra</div>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="search"
                  value={busqueda}
                  onChange={e => { setBusqueda(e.target.value); setProyectoSeleccionado(null); }}
                  placeholder="🔍  Buscar proyecto..."
                  style={{
                    width: "100%", padding: "14px 16px", borderRadius: 14,
                    background: C.surface, border: `2px solid ${C.amber}40`, color: C.text,
                    fontSize: 15, fontFamily: fB, outline: "none", caretColor: C.amber,
                    boxSizing: "border-box", marginBottom: 12,
                  }}
                />

                {etapaSelInfo && (
                  <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `${etapaSelInfo.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{etapaSelInfo.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: C.dim }}>Etapa seleccionada</div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{etapaSelInfo.nombre}</div>
                    </div>
                    <button onClick={() => { setStep(1); setBusqueda(""); setProyectoSeleccionado(null); }} style={{ background: "none", border: "none", color: C.amber, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: fB }}>Cambiar</button>
                  </div>
                )}

                <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                  {proyectosLoading ? (
                    <div style={{ textAlign: "center", padding: 30, color: C.dim, fontSize: 13 }}>Cargando proyectos...</div>
                  ) : proyectosFiltrados.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 20, color: C.dim, fontSize: 13 }}>
                      {busqueda ? (
                        <div>
                          <div style={{ marginBottom: 8 }}>No se encontró "{busqueda}"</div>
                          <button onClick={() => { setModoManual(true); setManualOT(busqueda.replace(/\D/g, "")); setBusqueda(""); setTimeout(() => manualInputRef.current?.focus(), 100); }} style={{
                            padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.amber}40`,
                            background: C.surface, color: C.amber, fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: "pointer",
                          }}>✏️ Cargar OT manualmente</button>
                        </div>
                      ) : "Sin proyectos disponibles"}
                    </div>
                  ) : (
                    proyectosFiltrados.slice(0, 20).map(p => {
                      const sel = proyectoSeleccionado?.ot === p.ot;
                      return (
                        <button key={p.ot + p.codigo} onClick={() => setProyectoSeleccionado(p)} style={{
                          padding: "12px 14px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                          background: sel ? `${C.amber}18` : C.surface,
                          border: `2px solid ${sel ? C.amber : "transparent"}`,
                          display: "flex", alignItems: "center", gap: 10, fontFamily: fB,
                          transition: "all 0.15s",
                        }}>
                          <div style={{
                            minWidth: 48, height: 36, borderRadius: 8,
                            background: sel ? C.amberS : C.surfHi,
                            color: sel ? C.amber : C.text,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontFamily: fM, fontSize: 13, fontWeight: 700, flexShrink: 0,
                            padding: "0 6px",
                          }}>{p.ot}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {p.cliente}
                            </div>
                            <div style={{ fontSize: 11, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                              {p.proyecto}
                            </div>
                          </div>
                          {sel && <span style={{ color: C.amber, fontSize: 16 }}>✓</span>}
                        </button>
                      );
                    })
                  )}
                  {proyectosFiltrados.length > 20 && (
                    <div style={{ textAlign: "center", padding: 8, color: C.dim, fontSize: 11 }}>
                      +{proyectosFiltrados.length - 20} más — refiná la búsqueda
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setStep(1); setBusqueda(""); setProyectoSeleccionado(null); }} style={{ flex: 1, padding: 14, borderRadius: 14, background: C.surfHi, border: "none", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer" }}>Atrás</button>
                  <button disabled={!proyectoSeleccionado} onClick={() => setStep(3)} style={{
                    flex: 2, padding: 14, borderRadius: 14, border: "none",
                    background: proyectoSeleccionado ? C.amber : C.surfHi,
                    color: proyectoSeleccionado ? "#000" : C.mute,
                    fontSize: 14, fontWeight: 700, fontFamily: fB,
                    cursor: proyectoSeleccionado ? "pointer" : "default",
                  }}>Siguiente →</button>
                </div>
              </>)}

              {/* Modo manual */}
              {modoManual && (<>
                <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>Ingresá el número de OT manualmente</div>
                <input
                  ref={manualInputRef}
                  type="number"
                  inputMode="numeric"
                  value={manualOT}
                  onChange={e => setManualOT(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && manualOT.trim() && setStep(3)}
                  placeholder="Número de OT"
                  style={{
                    width: "100%", padding: "18px 20px", borderRadius: 14,
                    background: C.surface, border: `2px solid ${C.amber}40`, color: C.text,
                    fontSize: 32, fontFamily: fM, fontWeight: 700, textAlign: "center",
                    outline: "none", letterSpacing: 4, caretColor: C.amber,
                    boxSizing: "border-box", marginBottom: 16,
                  }}
                />

                {etapaSelInfo && (
                  <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `${etapaSelInfo.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{etapaSelInfo.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: C.dim }}>Etapa seleccionada</div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{etapaSelInfo.nombre}</div>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setStep(1); setManualOT(""); setModoManual(false); }} style={{ flex: 1, padding: 14, borderRadius: 14, background: C.surfHi, border: "none", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer" }}>Atrás</button>
                  <button disabled={!manualOT.trim()} onClick={() => setStep(3)} style={{
                    flex: 2, padding: 14, borderRadius: 14, border: "none",
                    background: manualOT.trim() ? C.amber : C.surfHi,
                    color: manualOT.trim() ? "#000" : C.mute,
                    fontSize: 14, fontWeight: 700, fontFamily: fB,
                    cursor: manualOT.trim() ? "pointer" : "default",
                  }}>Siguiente →</button>
                </div>
              </>)}
            </div>
          )}

          {/* STEP 3: Tipo + Confirmar */}
          {step === 3 && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, fontFamily: fH }}>Tipo de trabajo</div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>¿Es trabajo normal o hay algo especial?</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
                {TIPOS.map(t => (
                  <button key={t.cod} onClick={() => setTipoSeleccionado(t.cod)} style={{
                    padding: "14px 16px", borderRadius: 14, cursor: "pointer",
                    background: tipoSeleccionado === t.cod ? `${t.color}18` : C.surface,
                    border: `2px solid ${tipoSeleccionado === t.cod ? t.color : "transparent"}`,
                    display: "flex", alignItems: "center", gap: 12, fontFamily: fB,
                    transition: "all 0.15s",
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 12,
                      border: `2px solid ${tipoSeleccionado === t.cod ? t.color : C.mute}`,
                      background: tipoSeleccionado === t.cod ? t.color : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.15s",
                    }}>
                      {tipoSeleccionado === t.cod && <span style={{ color: "#000", fontSize: 12, fontWeight: 900 }}>✓</span>}
                    </div>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{t.nombre}</div>
                    </div>
                    <Tag color={t.color} style={{ marginLeft: "auto" }}>{t.cod}</Tag>
                  </button>
                ))}
              </div>

              {etapaSelInfo && (proyectoSeleccionado || modoManual) && (
                <div style={{ background: C.surfHi, borderRadius: 16, padding: 16, border: `1px solid ${C.borderHi}`, marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: C.dim, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Resumen</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: C.dim }}>Etapa</span>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{etapaSelInfo.icon} {etapaSelInfo.nombre}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: C.dim }}>Proyecto</span>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: fM }}>OT {modoManual ? manualOT : proyectoSeleccionado?.ot}</span>
                  </div>
                  {!modoManual && proyectoSeleccionado?.cliente && (
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: C.dim }}>Cliente</span>
                      <span style={{ fontSize: 12, fontWeight: 600, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proyectoSeleccionado.cliente}</span>
                    </div>
                  )}
                  {modoManual && (
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: C.dim }}>Modo</span>
                      <Tag color={C.amber}>Manual</Tag>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: C.dim }}>Tipo</span>
                    <Tag color={TIPOS.find(t => t.cod === tipoSeleccionado)?.color}>{tipoSeleccionado} — {TIPOS.find(t => t.cod === tipoSeleccionado)?.nombre}</Tag>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setStep(2)} style={{ flex: 1, padding: 14, borderRadius: 14, background: C.surfHi, border: "none", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer" }}>Atrás</button>
                <button onClick={iniciarTarea} disabled={saving} style={{
                  flex: 2, padding: 14, borderRadius: 14, border: "none",
                  background: saving ? C.surfHi : C.green, color: saving ? C.mute : "#000",
                  fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: saving ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>{saving ? "Guardando..." : "▶ Iniciar"}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══ RENDER: PAUSING ═══
  if (state === "pausing") {
    return (
      <div style={{ fontFamily: fB, flex: 1 }}>
        <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setState(tareaActiva ? "active" : "selecting")} style={{ background: "none", border: "none", color: C.text, cursor: "pointer", padding: 6, fontSize: 20 }}>←</button>
          <div>
            <div style={{ fontSize: 11, color: C.red, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Tiempo muerto</div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: fH }}>¿Cuál es la causa?</div>
          </div>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {CAUSAS.map(c => (
            <button key={c.cod} onClick={() => confirmarPausa(c.cod)} disabled={saving} style={{
              padding: 18, borderRadius: 16, background: C.surface,
              border: `1px solid ${C.red}20`, cursor: saving ? "default" : "pointer",
              display: "flex", alignItems: "center", gap: 14, fontFamily: fB,
              opacity: saving ? 0.5 : 1,
            }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: C.redS, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{c.icon}</div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{c.nombre}</div>
                <div style={{ fontSize: 11, color: C.dim, fontFamily: fM }}>Código: {c.cod}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ═══ RENDER: ACTIVE TASK ═══
  const isEspera = tareaActiva?.etapa === 0;
  const accentColor = isEspera ? C.red : (etapaActiva?.color || C.amber);
  const horaInicioFmt = tareaActiva?.hora_inicio ? fmtTime(new Date(tareaActiva.hora_inicio)) : "—";

  return (
    <div style={{ fontFamily: fB, display: "flex", flexDirection: "column", flex: 1, overflowY: "auto" }}>
      <div style={{ padding: 20, flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {errorMsg&&<div style={{padding:12,background:C.redS,color:C.red,borderRadius:10,fontSize:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}><span>{errorMsg}</span><button onClick={()=>setErrorMsg(null)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontWeight:700,fontSize:14}}>✕</button></div>}
        <div style={{
          background: `linear-gradient(135deg, ${accentColor}12, ${C.surface} 60%)`,
          borderRadius: 24, padding: 24, border: `1px solid ${accentColor}30`,
          position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", top: -80, right: -80, width: 240, height: 240, borderRadius: "50%", background: `${accentColor}12`, filter: "blur(80px)" }} />
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: `${accentColor}22`, color: accentColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{etapaActiva?.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: fH }}>{etapaActiva?.nombre}</div>
                {!isEspera && (
                  <div style={{ fontSize: 13, color: C.dim }}>
                    OT <span style={{ fontFamily: fM, fontWeight: 700, color: C.text }}>{tareaActiva?.codigo_proyecto}</span>
                    {proyectoActivo && <span> · {proyectoActivo.cliente}</span>}
                  </div>
                )}
                {isEspera && <div style={{ fontSize: 13, color: C.red }}>Causa: {CAUSAS.find(c => c.cod === tareaActiva?.causa)?.nombre}</div>}
              </div>
              <Tag color={TIPOS.find(t => t.cod === tareaActiva?.tipo)?.color}>{tareaActiva?.tipo}</Tag>
            </div>

            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontFamily: fM, fontSize: 48, fontWeight: 700, color: accentColor, letterSpacing: 4, lineHeight: 1 }}>{fmtElapsed(elapsed)}</div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Inicio: {horaInicioFmt}</div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: accentColor, animation: "pulse 2s ease-in-out infinite" }} />
              <span style={{ fontSize: 11, color: C.dim, fontWeight: 600 }}>{isEspera ? "EN ESPERA" : "REGISTRANDO"}</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => finalizarTarea("cambiar")} disabled={saving} style={{
            flex: 2, padding: 16, borderRadius: 16, background: C.amber, border: "none", color: "#000",
            fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            opacity: saving ? 0.5 : 1,
          }}>🔄 Cambiar tarea</button>
          {!isEspera && (
            <button onClick={() => setState("pausing")} disabled={saving} style={{
              flex: 1, padding: 16, borderRadius: 16,
              background: C.redS, border: `1px solid ${C.red}30`, color: C.red,
              fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: "pointer",
              opacity: saving ? 0.5 : 1,
            }}>⏸</button>
          )}
        </div>

        <button onClick={() => finalizarTarea("idle")} disabled={saving} style={{
          width: "100%", padding: 16, borderRadius: 16,
          background: "transparent", border: `1px solid ${C.border}`, color: C.dim,
          fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer",
          opacity: saving ? 0.5 : 1,
        }}>⏹ Finalizar jornada</button>

        {historial.length > 0 && (
          <button onClick={() => setShowHistorial(true)} style={{
            width: "100%", padding: 12, borderRadius: 12,
            background: C.surface, border: `1px solid ${C.border}`, color: C.text,
            fontSize: 12, fontWeight: 600, fontFamily: fB, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span>📋 Ver historial ({historial.length} tramos)</span>
            <span style={{ color: C.dim }}>→</span>
          </button>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.5); }
        }
      `}</style>
    </div>
  );
}
