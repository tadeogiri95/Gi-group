'use client';

import { useState, useRef } from "react";
import { C, fH, fB, fM } from "./lib/theme";
import { sb } from "./lib/supabase";

/* ═══ SYSTEM PROMPT PARA REPORTE DE OBRA ═══ */
const SYSTEM_OBRA = `Sos un asistente de obra de GI Amoblamientos. Tu trabajo es interpretar el reporte oral/escrito de un instalador y devolver SOLO un JSON válido (sin markdown, sin texto extra) con esta estructura exacta:
{
  "progreso": "Resumen claro del avance efectivo del día",
  "faltantes": ["lista de materiales o cosas que faltaron"],
  "desvios": ["lista de imprevistos, esperas o desvíos"],
  "mensaje_doble_check": "Frase amigable resumiendo lo que entendiste para que el instalador confirme. Ej: Entendí que montaron X pero faltó Y. ¿Es correcto?"
}
Si algo no se menciona, dejá el array vacío o string vacío. Siempre respondé SOLO el JSON.`;

/* ═══ ESTILOS ═══ */
const S = {
  wrap: {
    padding: "0 18px 110px",
    overflowY: "auto",
    flex: 1,
    WebkitOverflowScrolling: "touch",
  },
  card: {
    background: C.surface,
    borderRadius: 16,
    border: `1px solid ${C.border}`,
    padding: 16,
    marginBottom: 12,
  },
  textarea: {
    width: "100%",
    minHeight: 180,
    background: C.surfHi,
    border: `1px solid ${C.borderHi}`,
    borderRadius: 12,
    padding: 14,
    color: C.text,
    fontFamily: fB,
    fontSize: 15,
    resize: "vertical",
    outline: "none",
    boxSizing: "border-box",
    lineHeight: 1.5,
  },
  btnPrimary: (bg = C.amber) => ({
    width: "100%",
    padding: "16px 0",
    borderRadius: 14,
    border: "none",
    cursor: "pointer",
    background: bg,
    color: "#000",
    fontFamily: fH,
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: "0.01em",
  }),
  btnSecondary: {
    padding: "12px 16px",
    borderRadius: 12,
    border: `1px solid ${C.borderHi}`,
    background: C.surfHi,
    color: C.dim,
    fontFamily: fB,
    fontSize: 14,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.dim,
    marginBottom: 8,
    fontFamily: fB,
  },
  tag: (color) => ({
    display: "inline-block",
    padding: "5px 12px",
    borderRadius: 10,
    background: `${color}22`,
    color,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: fB,
    marginRight: 6,
    marginBottom: 6,
  }),
};

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function InstaladorScreen({ usuario }) {
  const [fase, setFase] = useState("ingreso"); // ingreso | procesando | check | guardado
  const [texto, setTexto] = useState("");
  const [fotos, setFotos] = useState([]);
  const [reporte, setReporte] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  /* ── Audio: grabación con Web Speech API ── */
  const [grabando, setGrabando] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState(false);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const soportaSpeech = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const iniciarGrabacion = () => {
    if (!soportaSpeech) {
      setError("Tu navegador no soporta reconocimiento de voz. Usá Chrome.");
      return;
    }
    setError(null);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = "es-AR";
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalTranscript = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += t + " ";
        } else {
          interim = t;
        }
      }
      setTexto((prev) => {
        const base = prev.replace(/🎙️.*$/, "").trimEnd();
        const combined = (base ? base + " " : "") + finalTranscript;
        return interim ? combined + "🎙️" + interim : combined.trimEnd();
      });
    };

    recognition.onerror = (e) => {
      if (e.error !== "aborted") setError("Error de micrófono: " + e.error);
      setGrabando(false);
    };

    recognition.onend = () => {
      setGrabando(false);
      setTexto((prev) => prev.replace(/🎙️.*$/, "").trimEnd());
    };

    recognitionRef.current = recognition;
    recognition.start();
    setGrabando(true);
  };

  const detenerGrabacion = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setGrabando(false);
  };

  /* ── Llamada a la IA ── */
  const generarReporte = async () => {
    if (!texto.trim()) return;
    setFase("procesando");
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: SYSTEM_OBRA,
          messages: [{ role: "user", content: texto }],
        }),
      });
      const data = await res.json();
      const raw = data.content?.map(b => (b.type === "text" ? b.text : "")).join("") || "";
      const clean = raw.replace(/```json\s*|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setReporte(parsed);
      setFase("check");
    } catch {
      setError("No se pudo procesar el reporte. Intentá de nuevo.");
      setFase("ingreso");
    }
  };

  /* ── Guardar en Supabase ── */
  const confirmar = async () => {
    setFase("procesando");
    try {
      await sb.post("reportes_obra", {
        usuario_id: usuario?.id || null,
        nombre: usuario?.nombre || "Instalador",
        fecha: new Date().toISOString().slice(0, 10),
        texto_original: texto,
        progreso: reporte.progreso,
        faltantes: reporte.faltantes,
        desvios: reporte.desvios,
        fotos: fotos.length,
        created_at: new Date().toISOString(),
      });
      setFase("guardado");
      setTimeout(() => {
        setTexto("");
        setReporte(null);
        setFotos([]);
        setFase("ingreso");
      }, 2500);
    } catch {
      setError("Error al guardar. Intentá de nuevo.");
      setFase("check");
    }
  };

  /* ── Corregir ── */
  const corregir = () => {
    setFase("ingreso");
    setReporte(null);
  };

  /* ═══ RENDER ═══ */
  return (
    <div style={S.wrap}>

      {/* Error banner */}
      {error && (
        <div style={{ ...S.card, background: C.redS, border: `1px solid ${C.red}44`, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 14, color: C.red }}>⚠️ {error}</p>
        </div>
      )}

      {/* ══════════════════════════════════════
          FASE 1 — INGRESO
         ══════════════════════════════════════ */}
      {fase === "ingreso" && (
        <>
          <div style={S.card}>
            <div style={S.label}>¿Qué se hizo hoy en obra?</div>
            {grabando && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 12px", borderRadius: 10, background: `${C.red}15`, border: `1px solid ${C.red}33` }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: C.red, animation: "pulse 1s ease-in-out infinite" }} />
                <span style={{ fontSize: 13, color: C.red, fontWeight: 600, fontFamily: fB }}>Grabando… hablá y tu voz se transcribirá</span>
              </div>
            )}
            <textarea
              style={S.textarea}
              placeholder={"Contá qué se avanzó, si faltó algo,\nsi hubo algún imprevisto o espera..."}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>

          {/* Adjuntar fotos (UI only) */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            {/* Botón de audio */}
            <button
              style={{
                ...S.btnSecondary,
                background: grabando ? `${C.red}22` : S.btnSecondary.background,
                border: grabando ? `1px solid ${C.red}66` : S.btnSecondary.border,
                color: grabando ? C.red : S.btnSecondary.color,
                animation: grabando ? "pulse 1.5s ease-in-out infinite" : "none",
              }}
              onClick={grabando ? detenerGrabacion : iniciarGrabacion}
            >
              {grabando ? "⏹ Detener" : "🎤 Dictar reporte"}
            </button>
            <button style={S.btnSecondary} onClick={() => fileRef.current?.click()}>
              📷 Adjuntar fotos{fotos.length > 0 ? ` (${fotos.length})` : ""}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files.length)
                  setFotos((prev) => [...prev, ...Array.from(e.target.files).map((f) => f.name)]);
              }}
            />
            {fotos.map((f, i) => (
              <span key={i} style={{ ...S.tag(C.cyan), display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                {f.length > 18 ? f.slice(0, 15) + "…" : f}
                <span
                  style={{ cursor: "pointer", opacity: 0.6, fontWeight: 700 }}
                  onClick={() => setFotos((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </span>
              </span>
            ))}
          </div>

          <button
            style={{ ...S.btnPrimary(), opacity: texto.trim() ? 1 : 0.4 }}
            disabled={!texto.trim()}
            onClick={generarReporte}
          >
            🤖 Generar Reporte
          </button>
        </>
      )}

      {/* ══════════════════════════════════════
          FASE 2 — PROCESANDO
         ══════════════════════════════════════ */}
      {fase === "procesando" && (
        <div style={{ ...S.card, textAlign: "center", padding: "56px 16px" }}>
          <div style={{ fontSize: 38, marginBottom: 14, animation: "spin 1.2s linear infinite" }}>⚙️</div>
          <p style={{ margin: 0, fontSize: 17, fontFamily: fH, fontWeight: 700 }}>Analizando tu reporte...</p>
          <p style={{ margin: "8px 0 0", color: C.dim, fontSize: 13 }}>La IA está estructurando los datos</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.5 } }`}</style>
        </div>
      )}

      {/* ══════════════════════════════════════
          FASE 3 — DOBLE CHECK
         ══════════════════════════════════════ */}
      {fase === "check" && reporte && (
        <>
          {/* Progreso */}
          <div style={S.card}>
            <div style={S.label}>✅ Progreso efectivo</div>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: C.text }}>{reporte.progreso || "—"}</p>
          </div>

          {/* Faltantes */}
          {reporte.faltantes?.length > 0 && (
            <div style={{ ...S.card, background: C.redS, border: `1px solid ${C.red}33` }}>
              <div style={{ ...S.label, color: C.red }}>🚫 Faltantes</div>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {reporte.faltantes.map((f, i) => (
                  <span key={i} style={S.tag(C.red)}>{f}</span>
                ))}
              </div>
            </div>
          )}

          {/* Desvíos */}
          {reporte.desvios?.length > 0 && (
            <div style={{ ...S.card, background: C.amberS, border: `1px solid ${C.amber}33` }}>
              <div style={{ ...S.label, color: C.amber }}>⚠️ Desvíos / Imprevistos</div>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {reporte.desvios.map((d, i) => (
                  <span key={i} style={S.tag(C.amber)}>{d}</span>
                ))}
              </div>
            </div>
          )}

          {/* Mensaje doble check */}
          <div style={{ ...S.card, background: C.cyanS, border: `1px solid ${C.cyan}33` }}>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: C.text }}>
              💬 {reporte.mensaje_doble_check || "¿Los datos están correctos?"}
            </p>
          </div>

          {/* Botones */}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button
              style={{ ...S.btnSecondary, flex: 1, justifyContent: "center", padding: "14px 0", fontSize: 15, fontWeight: 700 }}
              onClick={corregir}
            >
              ← Corregir
            </button>
            <button style={{ ...S.btnPrimary(C.green), flex: 2 }} onClick={confirmar}>
              ✅ Confirmar y Enviar
            </button>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════
          FASE 4 — GUARDADO
         ══════════════════════════════════════ */}
      {fase === "guardado" && (
        <div style={{ ...S.card, textAlign: "center", padding: "56px 16px", background: C.greenS, border: `1px solid ${C.green}33` }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>✅</div>
          <p style={{ margin: 0, fontSize: 20, fontFamily: fH, fontWeight: 700, color: C.green }}>Reporte enviado</p>
          <p style={{ margin: "8px 0 0", color: C.dim, fontSize: 13 }}>Se guardó correctamente</p>
        </div>
      )}
    </div>
  );
}
