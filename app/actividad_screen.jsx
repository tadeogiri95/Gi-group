import { useState, useEffect, useRef } from "react";
import { C } from "./lib/theme";
import InstaladorScreen from "./instalador_screen";

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
  usuario,
  empresa,
  fichadaHoy,
}) {
  const [state, setState] = useState("idle");
  const [showReporte, setShowReporte] = useState(false);
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
        codigo_proyecto: etapaSeleccionada === 0 ? null : (otFinal ? Number(otFinal) || otFinal : null),
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
      <div className="gypi-dots">
        <span style={{ background: "var(--color-empresa-primary, #F97316)" }} />
        <span style={{ background: "var(--color-empresa-primary, #F97316)" }} />
        <span style={{ background: "var(--color-empresa-primary, #F97316)" }} />
      </div>
    );
  }

  // ═══ RENDER: REPORTE DE INSTALACIÓN ═══
  if (showReporte) {
    return (
      <div className="font-body flex flex-col flex-1 overflow-hidden">
        <div className="py-3 px-5 flex items-center gap-3 shrink-0">
          <button onClick={() => setShowReporte(false)} className="bg-transparent border-none text-gypi-text cursor-pointer p-1.5 text-xl">←</button>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: C.cyan }}>Reporte</div>
            <div className="text-base font-bold font-heading">Instalación</div>
          </div>
        </div>
        <InstaladorScreen usuario={usuario} empresa={empresa} />
      </div>
    );
  }

  /* ── Error banner (reusable) ── */
  const ErrorBanner = () => errorMsg ? (
    <div className="p-3 rounded-[10px] text-xs flex items-center justify-between mb-3.5" style={{ background: C.redS, color: C.red }}>
      <span>{errorMsg}</span>
      <button onClick={() => setErrorMsg(null)} className="bg-transparent border-none cursor-pointer text-sm font-bold" style={{ color: C.red }}>✕</button>
    </div>
  ) : null;

  // ═══ RENDER: IDLE ═══
  if (state === "idle" && !showHistorial) {
    return (
      <div className="font-body flex flex-col flex-1 overflow-y-auto">
        <div className="py-6 px-5 flex-1">
          <ErrorBanner />
          <div className="rounded-3xl p-8 text-center relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${C.amber}08, ${C.surface} 60%)`, border: `1px solid ${C.border}` }}>
            <div className="absolute -top-[60px] -right-[60px] w-[200px] h-[200px] rounded-full blur-[80px]" style={{ background: `${C.amber}10` }} />
            <div className="relative">
              <div className="w-[72px] h-[72px] rounded-[20px] flex items-center justify-center mx-auto mb-4 text-[32px]" style={{ background: C.amberS }}>🔨</div>
              <div className="text-lg font-bold font-heading mb-2">Sin tarea activa</div>
              <div className="text-[13px] text-gypi-dim mb-6 leading-normal">Iniciá una tarea para registrar tu actividad en el proyecto</div>
              <button
                onClick={() => { if (!fichadaHoy?.ingreso) { setErrorMsg("Debés fichar tu ingreso para comenzar a trabajar"); return; } setState("selecting"); setStep(1); }}
                className="w-full py-4 px-6 rounded-2xl border-none text-base font-bold font-body cursor-pointer flex items-center justify-center gap-2"
                style={{ background: C.amber, color: C.amberText }}
              >
                <span className="text-xl">▶</span> Iniciar tarea
              </button>
            </div>
          </div>

          {/* Botón Reporte de Instalación */}
          <button onClick={() => setShowReporte(true)} className="w-full mt-3 py-4 px-6 rounded-2xl border-none text-base font-bold font-body cursor-pointer flex items-center justify-center gap-2" style={{ background: C.cyan, color: "#000" }}>
            <span className="text-xl">📋</span> Reporte de Instalación
          </button>

          {historial.length > 0 && (
            <button onClick={() => setShowHistorial(true)} className="w-full mt-4 p-4 rounded-2xl bg-gypi-surface border border-gypi-border text-gypi-text text-sm font-semibold font-body cursor-pointer flex items-center justify-between">
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
      <div className="font-body flex-1 overflow-y-auto">
        <div className="pt-5 px-5 flex items-center gap-3">
          <button onClick={() => setShowHistorial(false)} className="bg-transparent border-none text-gypi-text cursor-pointer p-1.5 text-xl">←</button>
          <h2 className="m-0 font-heading text-[22px] font-bold flex-1">Historial de hoy</h2>
          <Tag color={C.green}>{historial.length} tramos</Tag>
        </div>
        <div className="p-5 flex flex-col gap-2.5">
          {historial.map((r, i) => {
            const etapa = getEtapaInfo(etapas, r.etapa);
            const horaIni = r.hora_inicio ? fmtTime(new Date(r.hora_inicio)) : "—";
            const horaFin = r.hora_fin ? fmtTime(new Date(r.hora_fin)) : "—";
            const proy = r.codigo_proyecto ? proyectos.find(p => String(p.ot) === String(r.codigo_proyecto)) : null;
            return (
              <div key={r.id || i} className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border">
                <div className="flex justify-between items-start mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: `${etapa.color}22` }}>{etapa.icon}</div>
                    <div>
                      <div className="text-[13px] font-bold">{etapa.nombre}</div>
                      {r.codigo_proyecto && (
                        <div className="text-[11px] text-gypi-dim font-mono">
                          OT {r.codigo_proyecto}{proy ? ` · ${proy.cliente}` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                  <Tag color={TIPOS.find(t => t.cod === r.tipo)?.color}>{r.tipo}</Tag>
                </div>
                <div className="flex justify-between text-[11px] text-gypi-dim mt-1">
                  <span className="font-mono">{horaIni} → {horaFin}</span>
                </div>
                {r.causa && <div className="mt-1.5 text-[11px]" style={{ color: C.red }}>Causa: {CAUSAS.find(c => c.cod === r.causa)?.nombre}</div>}
              </div>
            );
          })}
          {historial.length === 0 && (
            <div className="bg-gypi-surface rounded-2xl p-8 text-center border border-gypi-border">
              <div className="text-[28px] mb-2">🔨</div>
              <div className="text-sm font-bold text-gypi-text">Sin registros todavía</div>
              <div className="text-xs text-gypi-dim mt-1.5">Tus tareas del día aparecerán acá una vez que las inicies.</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══ RENDER: SELECTING (wizard) ═══
  if (state === "selecting") {
    return (
      <div className="font-body flex flex-col flex-1 overflow-y-auto">
        <div className="pt-5 px-5 flex items-center gap-3">
          <button onClick={() => { setState(tareaActiva ? "active" : "idle"); setStep(1); setBusqueda(""); setProyectoSeleccionado(null); }} className="bg-transparent border-none text-gypi-text cursor-pointer p-1.5 text-xl">←</button>
          <div className="flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: C.amber }}>Nueva tarea</div>
            <div className="text-base font-bold font-heading">Paso {step} de 3</div>
          </div>
          <div className="flex gap-1">
            {[1, 2, 3].map(s => (
              <div key={s} className="h-2 rounded transition-all" style={{ width: s === step ? 24 : 8, background: s <= step ? C.amber : C.surfHi }} />
            ))}
          </div>
        </div>

        <div className="p-5 flex-1">
          {/* STEP 1: Etapa */}
          {step === 1 && (
            <div>
              <div className="text-[15px] font-bold mb-1 font-heading">¿Qué vas a hacer?</div>
              <div className="text-xs text-gypi-dim mb-4">Elegí la etapa de trabajo</div>
              <div className="grid grid-cols-2 gap-2">
                {etapas.filter(e => e.codigo > 0).map(e => (
                  <button key={e.codigo} onClick={() => { setEtapaSeleccionada(e.codigo); setStep(2); }} className="bg-gypi-surface border border-gypi-border rounded-[14px] py-3.5 px-3 cursor-pointer text-left flex items-center gap-2.5 font-body transition-all">
                    <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-lg shrink-0" style={{ background: `${e.color}22`, color: e.color }}>{e.icon}</div>
                    <div>
                      <div className="text-xs font-bold text-gypi-text">{e.nombre}</div>
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => setState("pausing")} className="w-full mt-3 p-3.5 rounded-[14px] text-[13px] font-bold font-body cursor-pointer flex items-center justify-center gap-2" style={{ background: C.redS, border: `1px solid ${C.red}30`, color: C.red }}>
                ⏸ Registrar espera / tiempo muerto
              </button>
            </div>
          )}

          {/* STEP 2: Selector de proyecto */}
          {step === 2 && (
            <div>
              <div className="text-[15px] font-bold mb-1 font-heading">Proyecto</div>

              {/* Toggle: Buscar / Manual */}
              <div className="flex gap-1.5 mb-3">
                <button onClick={() => { setModoManual(false); setManualOT(""); }} className="flex-1 py-2 px-3 rounded-[10px] border-none cursor-pointer text-xs font-bold font-body" style={{ background: !modoManual ? `${C.amber}22` : C.surface, color: !modoManual ? C.amber : C.dim }}>🔍 Buscar OT</button>
                <button onClick={() => { setModoManual(true); setProyectoSeleccionado(null); setBusqueda(""); setTimeout(() => manualInputRef.current?.focus(), 100); }} className="flex-1 py-2 px-3 rounded-[10px] border-none cursor-pointer text-xs font-bold font-body" style={{ background: modoManual ? `${C.amber}22` : C.surface, color: modoManual ? C.amber : C.dim }}>✏️ Cargar manual</button>
              </div>

              {/* Modo búsqueda */}
              {!modoManual && (<>
                <div className="text-xs text-gypi-dim mb-2">Buscá por OT, cliente u obra</div>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="search"
                  value={busqueda}
                  onChange={e => { setBusqueda(e.target.value); setProyectoSeleccionado(null); }}
                  placeholder="🔍  Buscar proyecto..."
                  className="w-full py-3.5 px-4 rounded-[14px] bg-gypi-surface text-gypi-text text-[15px] font-body outline-none box-border mb-3"
                  style={{ border: `2px solid ${C.amber}40`, caretColor: C.amber }}
                />

                {etapaSelInfo && (
                  <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border flex items-center gap-2.5 mb-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: `${etapaSelInfo.color}22` }}>{etapaSelInfo.icon}</div>
                    <div className="flex-1">
                      <div className="text-[11px] text-gypi-dim">Etapa seleccionada</div>
                      <div className="text-[13px] font-bold">{etapaSelInfo.nombre}</div>
                    </div>
                    <button onClick={() => { setStep(1); setBusqueda(""); setProyectoSeleccionado(null); }} className="bg-transparent border-none cursor-pointer text-xs font-semibold font-body" style={{ color: C.amber }}>Cambiar</button>
                  </div>
                )}

                <div className="max-h-[300px] overflow-y-auto flex flex-col gap-1.5 mb-4">
                  {proyectosLoading ? (
                    <div className="gypi-dots" style={{ padding: "20px 0" }}><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /></div>
                  ) : proyectosFiltrados.length === 0 ? (
                    <div className="text-center py-5 text-gypi-dim text-[13px]">
                      {busqueda ? (
                        <div>
                          <div className="mb-2">No se encontró "{busqueda}"</div>
                          <button onClick={() => { setModoManual(true); setManualOT(busqueda.replace(/\D/g, "")); setBusqueda(""); setTimeout(() => manualInputRef.current?.focus(), 100); }} className="py-2.5 px-4 rounded-[10px] bg-gypi-surface text-xs font-bold font-body cursor-pointer" style={{ border: `1px solid ${C.amber}40`, color: C.amber }}>✏️ Cargar OT manualmente</button>
                        </div>
                      ) : "Sin proyectos disponibles"}
                    </div>
                  ) : (
                    proyectosFiltrados.slice(0, 20).map(p => {
                      const sel = proyectoSeleccionado?.ot === p.ot;
                      return (
                        <button key={p.ot + p.codigo} onClick={() => setProyectoSeleccionado(p)} className="py-3 px-3.5 rounded-xl cursor-pointer text-left flex items-center gap-2.5 font-body transition-all" style={{ background: sel ? `${C.amber}18` : C.surface, border: `2px solid ${sel ? C.amber : "transparent"}` }}>
                          <div className="min-w-[48px] h-9 rounded-lg flex items-center justify-center font-mono text-[13px] font-bold shrink-0 px-1.5" style={{ background: sel ? C.amberS : C.surfHi, color: sel ? C.amber : C.text }}>{p.ot}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-gypi-text truncate">{p.cliente}</div>
                            <div className="text-[11px] text-gypi-dim truncate mt-[1px]">{p.proyecto}</div>
                          </div>
                          {sel && <span className="text-base" style={{ color: C.amber }}>✓</span>}
                        </button>
                      );
                    })
                  )}
                  {proyectosFiltrados.length > 20 && (
                    <div className="text-center py-2 text-gypi-dim text-[11px]">
                      +{proyectosFiltrados.length - 20} más — refiná la búsqueda
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button onClick={() => { setStep(1); setBusqueda(""); setProyectoSeleccionado(null); }} className="flex-1 p-3.5 rounded-[14px] border-none text-sm font-semibold font-body cursor-pointer" style={{ background: C.surfHi, color: C.dim }}>Atrás</button>
                  <button disabled={!proyectoSeleccionado} onClick={() => setStep(3)} className="flex-[2] p-3.5 rounded-[14px] border-none text-sm font-bold font-body" style={{ background: proyectoSeleccionado ? C.amber : C.surfHi, color: proyectoSeleccionado ? C.amberText : C.mute, cursor: proyectoSeleccionado ? "pointer" : "default" }}>Siguiente →</button>
                </div>
              </>)}

              {/* Modo manual */}
              {modoManual && (<>
                <div className="text-xs text-gypi-dim mb-2">Ingresá el número de OT manualmente</div>
                <input
                  ref={manualInputRef}
                  type="number"
                  inputMode="numeric"
                  value={manualOT}
                  onChange={e => setManualOT(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && manualOT.trim() && setStep(3)}
                  placeholder="Número de OT"
                  className="w-full py-[18px] px-5 rounded-[14px] bg-gypi-surface text-gypi-text text-[32px] font-mono font-bold text-center outline-none box-border mb-4"
                  style={{ border: `2px solid ${C.amber}40`, letterSpacing: 4, caretColor: C.amber }}
                />

                {etapaSelInfo && (
                  <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border flex items-center gap-2.5 mb-4">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: `${etapaSelInfo.color}22` }}>{etapaSelInfo.icon}</div>
                    <div className="flex-1">
                      <div className="text-[11px] text-gypi-dim">Etapa seleccionada</div>
                      <div className="text-[13px] font-bold">{etapaSelInfo.nombre}</div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={() => { setStep(1); setManualOT(""); setModoManual(false); }} className="flex-1 p-3.5 rounded-[14px] border-none text-sm font-semibold font-body cursor-pointer" style={{ background: C.surfHi, color: C.dim }}>Atrás</button>
                  <button disabled={!manualOT.trim()} onClick={() => setStep(3)} className="flex-[2] p-3.5 rounded-[14px] border-none text-sm font-bold font-body" style={{ background: manualOT.trim() ? C.amber : C.surfHi, color: manualOT.trim() ? C.amberText : C.mute, cursor: manualOT.trim() ? "pointer" : "default" }}>Siguiente →</button>
                </div>
              </>)}
            </div>
          )}

          {/* STEP 3: Tipo + Confirmar */}
          {step === 3 && (
            <div>
              <div className="text-[15px] font-bold mb-1 font-heading">Tipo de trabajo</div>
              <div className="text-xs text-gypi-dim mb-4">¿Es trabajo normal o hay algo especial?</div>
              <div className="flex flex-col gap-2 mb-6">
                {TIPOS.map(t => (
                  <button key={t.cod} onClick={() => setTipoSeleccionado(t.cod)} className="py-3.5 px-4 rounded-[14px] cursor-pointer flex items-center gap-3 font-body transition-all" style={{ background: tipoSeleccionado === t.cod ? `${t.color}18` : C.surface, border: `2px solid ${tipoSeleccionado === t.cod ? t.color : "transparent"}` }}>
                    <div className="w-6 h-6 rounded-full flex items-center justify-center transition-all" style={{ border: `2px solid ${tipoSeleccionado === t.cod ? t.color : C.mute}`, background: tipoSeleccionado === t.cod ? t.color : "transparent" }}>
                      {tipoSeleccionado === t.cod && <span className="text-xs font-black" style={{ color: "#000" }}>✓</span>}
                    </div>
                    <div className="text-left">
                      <div className="text-[13px] font-bold text-gypi-text">{t.nombre}</div>
                    </div>
                    <Tag color={t.color} style={{ marginLeft: "auto" }}>{t.cod}</Tag>
                  </button>
                ))}
              </div>

              {etapaSelInfo && (proyectoSeleccionado || modoManual) && (
                <div className="rounded-2xl p-4 mb-4" style={{ background: C.surfHi, border: `1px solid ${C.borderHi}` }}>
                  <div className="text-[10px] text-gypi-dim font-bold uppercase tracking-[0.1em] mb-2.5">Resumen</div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs text-gypi-dim">Etapa</span>
                    <span className="text-xs font-bold">{etapaSelInfo.icon} {etapaSelInfo.nombre}</span>
                  </div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs text-gypi-dim">Proyecto</span>
                    <span className="text-xs font-bold font-mono">OT {modoManual ? manualOT : proyectoSeleccionado?.ot}</span>
                  </div>
                  {!modoManual && proyectoSeleccionado?.cliente && (
                    <div className="flex justify-between mb-1.5">
                      <span className="text-xs text-gypi-dim">Cliente</span>
                      <span className="text-xs font-semibold max-w-[180px] truncate">{proyectoSeleccionado.cliente}</span>
                    </div>
                  )}
                  {modoManual && (
                    <div className="flex justify-between mb-1.5">
                      <span className="text-xs text-gypi-dim">Modo</span>
                      <Tag color={C.amber}>Manual</Tag>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-xs text-gypi-dim">Tipo</span>
                    <Tag color={TIPOS.find(t => t.cod === tipoSeleccionado)?.color}>{tipoSeleccionado} — {TIPOS.find(t => t.cod === tipoSeleccionado)?.nombre}</Tag>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setStep(2)} className="flex-1 p-3.5 rounded-[14px] border-none text-sm font-semibold font-body cursor-pointer" style={{ background: C.surfHi, color: C.dim }}>Atrás</button>
                <button onClick={iniciarTarea} disabled={saving} className="flex-[2] p-3.5 rounded-[14px] border-none text-sm font-bold font-body flex items-center justify-center gap-1.5" style={{ background: saving ? C.surfHi : C.green, color: saving ? C.mute : "#000", cursor: saving ? "default" : "pointer" }}>{saving ? "Guardando..." : "▶ Iniciar"}</button>
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
      <div className="font-body flex-1">
        <div className="pt-5 px-5 flex items-center gap-3">
          <button onClick={() => setState(tareaActiva ? "active" : "selecting")} className="bg-transparent border-none text-gypi-text cursor-pointer p-1.5 text-xl">←</button>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: C.red }}>Tiempo muerto</div>
            <div className="text-base font-bold font-heading">¿Cuál es la causa?</div>
          </div>
        </div>
        <div className="p-5 flex flex-col gap-2.5">
          {CAUSAS.map(c => (
            <button key={c.cod} onClick={() => confirmarPausa(c.cod)} disabled={saving} className="p-[18px] rounded-2xl bg-gypi-surface cursor-pointer flex items-center gap-3.5 font-body" style={{ border: `1px solid ${C.red}20`, opacity: saving ? 0.5 : 1 }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[22px]" style={{ background: C.redS }}>{c.icon}</div>
              <div className="text-left">
                <div className="text-sm font-bold text-gypi-text">{c.nombre}</div>
                <div className="text-[11px] text-gypi-dim font-mono">Código: {c.cod}</div>
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
    <div className="font-body flex flex-col flex-1 overflow-y-auto">
      <div className="p-5 flex-1 flex flex-col gap-4">
        <ErrorBanner />
        <div className="rounded-3xl p-6 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${accentColor}12, ${C.surface} 60%)`, border: `1px solid ${accentColor}30` }}>
          <div className="absolute -top-[80px] -right-[80px] w-[240px] h-[240px] rounded-full blur-[80px]" style={{ background: `${accentColor}12` }} />
          <div className="relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-[14px] flex items-center justify-center text-2xl" style={{ background: `${accentColor}22`, color: accentColor }}>{etapaActiva?.icon}</div>
              <div className="flex-1">
                <div className="text-lg font-bold font-heading">{etapaActiva?.nombre}</div>
                {!isEspera && (
                  <div className="text-[13px] text-gypi-dim">
                    OT <span className="font-mono font-bold text-gypi-text">{tareaActiva?.codigo_proyecto}</span>
                    {proyectoActivo && <span> · {proyectoActivo.cliente}</span>}
                  </div>
                )}
                {isEspera && <div className="text-[13px]" style={{ color: C.red }}>Causa: {CAUSAS.find(c => c.cod === tareaActiva?.causa)?.nombre}</div>}
              </div>
              <Tag color={TIPOS.find(t => t.cod === tareaActiva?.tipo)?.color}>{tareaActiva?.tipo}</Tag>
            </div>

            <div className="text-center mb-5">
              <div className="font-mono text-5xl font-bold leading-none" style={{ color: accentColor, letterSpacing: 4 }}>{fmtElapsed(elapsed)}</div>
              <div className="text-[11px] text-gypi-dim mt-1.5">Inicio: {horaInicioFmt}</div>
            </div>

            <div className="flex items-center justify-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: accentColor }} />
              <span className="text-[11px] text-gypi-dim font-semibold">{isEspera ? "EN ESPERA" : "REGISTRANDO"}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2.5">
          <button onClick={() => finalizarTarea("cambiar")} disabled={saving} className="flex-[2] p-4 rounded-2xl border-none text-sm font-bold font-body cursor-pointer flex items-center justify-center gap-1.5" style={{ background: C.amber, color: C.amberText, opacity: saving ? 0.5 : 1 }}>🔄 Cambiar tarea</button>
          {!isEspera && (
            <button onClick={() => setState("pausing")} disabled={saving} className="flex-1 p-4 rounded-2xl text-sm font-bold font-body cursor-pointer" style={{ background: C.redS, border: `1px solid ${C.red}30`, color: C.red, opacity: saving ? 0.5 : 1 }}>⏸</button>
          )}
        </div>

        <button onClick={() => finalizarTarea("idle")} disabled={saving} className="w-full p-4 rounded-2xl bg-transparent border border-gypi-border text-gypi-dim text-sm font-semibold font-body cursor-pointer" style={{ opacity: saving ? 0.5 : 1 }}>⏹ Finalizar jornada</button>

        {historial.length > 0 && (
          <button onClick={() => setShowHistorial(true)} className="w-full p-3 rounded-xl bg-gypi-surface border border-gypi-border text-gypi-text text-xs font-semibold font-body cursor-pointer flex items-center justify-between">
            <span>📋 Ver historial ({historial.length} tramos)</span>
            <span className="text-gypi-dim">→</span>
          </button>
        )}
      </div>
    </div>
  );
}
