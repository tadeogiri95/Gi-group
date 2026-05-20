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
const fmtTime = (d) => d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
const fmtElapsed = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

/* ═══ TAG (replica del de page.js) ═══ */
const Tag = ({ color = C.amber, children, style = {} }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: `${color}22`, color, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: fB, ...style }}>{children}</span>
);

/* ═══ HELPERS para mapear datos de Supabase a UI ═══ */
// Las etapas vienen del catálogo con campos: codigo, nombre, icon, color
// La tarea activa viene de Supabase con campos: etapa (int), codigo_proyecto, tipo, causa, hora_inicio
function getEtapaInfo(etapas, codigo) {
  return etapas.find(e => e.codigo === codigo) || { codigo, nombre: "?", icon: "❓", color: C.dim };
}

/* ═══ MAIN COMPONENT ═══ */
export default function ActividadScreen({
  // Props del hook useActividad
  tareaActiva,
  elapsed,
  historial,
  etapas = [],
  loading,
  horasHoy,
  iniciarTarea: onIniciar,
  finalizarTarea: onFinalizar,
  cambiarTarea: onCambiar,
}) {
  // ── Estado local de UI (pasos del wizard, selecciones) ──
  const [state, setState] = useState("idle"); // idle | selecting | active | pausing
  const [codigoProyecto, setCodigoProyecto] = useState("");
  const [etapaSeleccionada, setEtapaSeleccionada] = useState(null);
  const [tipoSeleccionado, setTipoSeleccionado] = useState("N");
  const [showHistorial, setShowHistorial] = useState(false);
  const [step, setStep] = useState(1); // 1: etapa, 2: código, 3: tipo+confirmar
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  // ── Sincronizar estado de UI con tarea activa de Supabase ──
  useEffect(() => {
    if (tareaActiva && !tareaActiva.hora_fin) {
      setState("active");
    } else if (!loading && !tareaActiva) {
      // Solo volver a idle si no estamos en medio de un wizard
      if (state === "active") setState("idle");
    }
  }, [tareaActiva, loading]);

  // ── Focus input en paso de código ──
  useEffect(() => {
    if (state === "selecting" && step === 2 && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [state, step]);

  // ── Acciones que llaman al hook ──
  const iniciarTarea = async () => {
    setSaving(true);
    try {
      await onIniciar({
        etapa: etapaSeleccionada,
        codigo_proyecto: etapaSeleccionada === 0 ? null : parseInt(codigoProyecto),
        tipo: tipoSeleccionado,
        causa: null,
      });
      // Reset wizard
      setCodigoProyecto("");
      setEtapaSeleccionada(null);
      setTipoSeleccionado("N");
      setStep(1);
      setState("active");
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const finalizarTarea = async (nextAction = "idle") => {
    setSaving(true);
    try {
      await onFinalizar();
    } catch (e) { console.error(e); }
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
    try {
      await onIniciar({
        etapa: 0,
        codigo_proyecto: null,
        tipo: "N",
        causa,
      });
      setState("active");
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  // ── Helpers de etapas ──
  const etapaActiva = tareaActiva ? getEtapaInfo(etapas, tareaActiva.etapa) : null;
  const etapaSelInfo = etapaSeleccionada != null ? getEtapaInfo(etapas, etapaSeleccionada) : null;

  // ═══ RENDER: LOADING ═══
  if (loading && !tareaActiva && historial.length === 0) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: C.dim, fontFamily: fB }}>
        <div style={{ fontSize: 13 }}>Cargando actividades...</div>
      </div>
    );
  }

  // ═══ RENDER: IDLE STATE ═══
  if (state === "idle" && !showHistorial) {
    return (
      <div style={{ fontFamily: fB, display: "flex", flexDirection: "column", flex: 1, overflowY: "auto" }}>
        {/* Empty state card */}
        <div style={{ padding: "24px 20px", flex: 1 }}>
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

          {/* Historial button */}
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
            return (
              <div key={r.id || i} style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `${etapa.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{etapa.icon}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{etapa.nombre}</div>
                      {r.codigo_proyecto && <div style={{ fontSize: 11, color: C.dim, fontFamily: fM }}>Proyecto {r.codigo_proyecto}</div>}
                    </div>
                  </div>
                  <Tag color={TIPOS.find(t => t.cod === r.tipo)?.color}>{r.tipo}</Tag>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim, marginTop: 4 }}>
                  <span style={{ fontFamily: fM }}>{horaIni} → {horaFin}</span>
                  <span style={{ fontFamily: fM, fontWeight: 700, color: C.text }}>{fmtElapsed(durSec)}</span>
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

  // ═══ RENDER: SELECTING TASK (wizard 3 pasos) ═══
  if (state === "selecting") {
    return (
      <div style={{ fontFamily: fB, display: "flex", flexDirection: "column", flex: 1, overflowY: "auto" }}>
        <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => { setState(tareaActiva ? "active" : "idle"); setStep(1); }} style={{ background: "none", border: "none", color: C.text, cursor: "pointer", padding: 6, fontSize: 20 }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Nueva tarea</div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: fH }}>Paso {step} de 3</div>
          </div>
          {/* Step indicator */}
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
                      <div style={{ fontSize: 10, color: C.dim, fontFamily: fM }}>Etapa {e.codigo}</div>
                    </div>
                  </button>
                ))}
              </div>
              {/* Espera button separate */}
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

          {/* STEP 2: Código proyecto */}
          {step === 2 && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, fontFamily: fH }}>Código de proyecto</div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>El número del MRP (ej: 743)</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                <input
                  ref={inputRef}
                  type="number"
                  inputMode="numeric"
                  value={codigoProyecto}
                  onChange={e => setCodigoProyecto(e.target.value.slice(0, 4))}
                  onKeyDown={e => e.key === "Enter" && codigoProyecto.length >= 1 && setStep(3)}
                  placeholder="000"
                  style={{
                    flex: 1, padding: "18px 20px", borderRadius: 14,
                    background: C.surface, border: `2px solid ${C.amber}40`, color: C.text,
                    fontSize: 32, fontFamily: fM, fontWeight: 700, textAlign: "center",
                    outline: "none", letterSpacing: 8, caretColor: C.amber,
                  }}
                />
              </div>
              {/* Selected etapa reminder */}
              {etapaSelInfo && (
                <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `${etapaSelInfo.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{etapaSelInfo.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: C.dim }}>Etapa seleccionada</div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{etapaSelInfo.nombre}</div>
                  </div>
                  <button onClick={() => setStep(1)} style={{ background: "none", border: "none", color: C.amber, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: fB }}>Cambiar</button>
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setStep(1)} style={{ flex: 1, padding: 14, borderRadius: 14, background: C.surfHi, border: "none", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer" }}>Atrás</button>
                <button disabled={codigoProyecto.length < 1} onClick={() => setStep(3)} style={{
                  flex: 2, padding: 14, borderRadius: 14, border: "none",
                  background: codigoProyecto.length >= 1 ? C.amber : C.surfHi,
                  color: codigoProyecto.length >= 1 ? "#000" : C.mute,
                  fontSize: 14, fontWeight: 700, fontFamily: fB,
                  cursor: codigoProyecto.length >= 1 ? "pointer" : "default",
                }}>Siguiente →</button>
              </div>
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

              {/* Summary */}
              {etapaSelInfo && (
                <div style={{ background: C.surfHi, borderRadius: 16, padding: 16, border: `1px solid ${C.borderHi}`, marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: C.dim, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Resumen</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: C.dim }}>Etapa</span>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{etapaSelInfo.icon} {etapaSelInfo.nombre}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: C.dim }}>Proyecto</span>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: fM }}>{codigoProyecto}</span>
                  </div>
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

  // ═══ RENDER: PAUSING (selecting causa) ═══
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
        {/* Active task card */}
        <div style={{
          background: `linear-gradient(135deg, ${accentColor}12, ${C.surface} 60%)`,
          borderRadius: 24, padding: 24, border: `1px solid ${accentColor}30`,
          position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", top: -80, right: -80, width: 240, height: 240, borderRadius: "50%", background: `${accentColor}12`, filter: "blur(80px)" }} />

          <div style={{ position: "relative" }}>
            {/* Etapa + Proyecto */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: `${accentColor}22`, color: accentColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{etapaActiva?.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: fH }}>{etapaActiva?.nombre}</div>
                {!isEspera && <div style={{ fontSize: 13, color: C.dim }}>Proyecto <span style={{ fontFamily: fM, fontWeight: 700, color: C.text }}>{tareaActiva?.codigo_proyecto}</span></div>}
                {isEspera && <div style={{ fontSize: 13, color: C.red }}>Causa: {CAUSAS.find(c => c.cod === tareaActiva?.causa)?.nombre}</div>}
              </div>
              <Tag color={TIPOS.find(t => t.cod === tareaActiva?.tipo)?.color}>{tareaActiva?.tipo}</Tag>
            </div>

            {/* Timer */}
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontFamily: fM, fontSize: 48, fontWeight: 700, color: accentColor, letterSpacing: 4, lineHeight: 1 }}>{fmtElapsed(elapsed)}</div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Inicio: {horaInicioFmt}</div>
            </div>

            {/* Pulse indicator */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
              <div style={{
                width: 8, height: 8, borderRadius: 4, background: accentColor,
                animation: "pulse 2s ease-in-out infinite",
              }} />
              <span style={{ fontSize: 11, color: C.dim, fontWeight: 600 }}>{isEspera ? "EN ESPERA" : "REGISTRANDO"}</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => finalizarTarea("cambiar")} disabled={saving} style={{
            flex: 2, padding: 16, borderRadius: 16,
            background: C.amber, border: "none", color: "#000",
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

        {/* Today's log preview */}
        {historial.length > 0 && (
          <div>
            <button onClick={() => setShowHistorial(true)} style={{
              width: "100%", padding: 12, borderRadius: 12,
              background: C.surface, border: `1px solid ${C.border}`, color: C.text,
              fontSize: 12, fontWeight: 600, fontFamily: fB, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span>📋 Ver historial ({historial.length} tramos)</span>
              <span style={{ color: C.dim }}>→</span>
            </button>
          </div>
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
