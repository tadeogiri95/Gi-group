'use client';

import { useState, useRef } from "react";
import { C } from "./lib/theme";
import { sb } from "./lib/supabase";
import { hoyArg } from "./lib/dates";

/* ═══ SYSTEM PROMPT PARA REPORTE DE OBRA ═══ */
const SYSTEM_OBRA_DEFAULT = `Sos un asistente de obra. Tu trabajo es interpretar el reporte oral/escrito de un instalador y devolver SOLO un JSON válido (sin markdown, sin texto extra) con esta estructura exacta:
{
  "progreso": "Resumen claro del avance efectivo del día",
  "faltantes": ["lista de materiales o cosas que faltaron"],
  "desvios": ["lista de imprevistos, esperas o desvíos"],
  "mensaje_doble_check": "Frase amigable resumiendo lo que entendiste para que el instalador confirme. Ej: Entendí que montaron X pero faltó Y. ¿Es correcto?"
}
Si algo no se menciona, dejá el array vacío o string vacío. Siempre respondé SOLO el JSON.`;

/* ═══ Helper: subir foto via API route segura ═══ */
async function subirFoto(file, reporteId) {
  const ext = file.name.split(".").pop() || "jpg";
  const fileName = `${reporteId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const toBase64 = (f) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(f);
  });
  try {
    const base64 = await toBase64(file);
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, fileBase64: base64, fileType: file.type || "image/jpeg" }),
    });
    const data = await res.json();
    if (data.ok && data.url) return data.url;
    console.warn("Storage upload failed:", data.error);
    return `data:${file.type || "image/jpeg"};base64,${base64}`;
  } catch (err) {
    console.error("Error subiendo foto:", err);
    try { const base64 = await toBase64(file); return `data:${file.type || "image/jpeg"};base64,${base64}`; }
    catch { return null; }
  }
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function InstaladorScreen({ usuario, empresa }) {
  const [fase, setFase] = useState("ingreso");
  const [texto, setTexto] = useState("");
  const [fotos, setFotos] = useState([]);
  const [reporte, setReporte] = useState(null);
  const [error, setError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState("");
  const fileRef = useRef(null);

  const [grabando, setGrabando] = useState(false);
  const recognitionRef = useRef(null);
  const soportaSpeech = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const iniciarGrabacion = () => {
    if (!soportaSpeech) { setError("Tu navegador no soporta reconocimiento de voz. Usá Chrome."); return; }
    setError(null);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = "es-AR"; recognition.continuous = true; recognition.interimResults = true;
    let finalTranscript = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t + " "; else interim = t;
      }
      setTexto((prev) => {
        const base = prev.replace(/🎙️.*$/, "").trimEnd();
        const combined = (base ? base + " " : "") + finalTranscript;
        return interim ? combined + "🎙️" + interim : combined.trimEnd();
      });
    };
    recognition.onerror = (e) => { if (e.error !== "aborted") setError("Error de micrófono: " + e.error); setGrabando(false); };
    recognition.onend = () => { setGrabando(false); setTexto((prev) => prev.replace(/🎙️.*$/, "").trimEnd()); };
    recognitionRef.current = recognition; recognition.start(); setGrabando(true);
  };

  const detenerGrabacion = () => { if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; } setGrabando(false); };

  const agregarFotos = (files) => {
    const nuevas = Array.from(files).map(file => ({ file, name: file.name, preview: URL.createObjectURL(file) }));
    setFotos(prev => [...prev, ...nuevas]);
  };
  const quitarFoto = (index) => {
    setFotos(prev => { const updated = prev.filter((_, i) => i !== index); if (prev[index]?.preview) URL.revokeObjectURL(prev[index].preview); return updated; });
  };

  const generarReporte = async () => {
    if (!texto.trim()) return;
    setFase("procesando"); setError(null);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system: empresa?.prompt_ia_obra || SYSTEM_OBRA_DEFAULT, messages: [{ role: "user", content: texto }] }) });
      const data = await res.json();
      const raw = data.content?.map(b => (b.type === "text" ? b.text : "")).join("") || "";
      const clean = raw.replace(/```json\s*|```/g, "").trim();
      setReporte(JSON.parse(clean)); setFase("check");
    } catch { setError("No se pudo procesar el reporte. Intentá de nuevo."); setFase("ingreso"); }
  };

  const confirmar = async () => {
    setFase("procesando"); setUploadProgress(""); setError(null);
    try {
      const reporteId = `${usuario?.id || "anon"}_${Date.now()}`;
      const fotosUrls = [];
      if (fotos.length > 0) {
        for (let i = 0; i < fotos.length; i++) {
          setUploadProgress(`Subiendo foto ${i + 1} de ${fotos.length}...`);
          try { const url = await subirFoto(fotos[i].file, reporteId); if (url) fotosUrls.push(url); } catch (fotoErr) { console.warn(`Error subiendo foto ${i+1}:`, fotoErr); }
        }
      }
      setUploadProgress("Guardando reporte...");
      const fechaLocal = hoyArg();
      const payload = { usuario_id: usuario?.id || null, nombre: usuario?.nombre || "Instalador", legajo: usuario?.legajo || null, empresa_id: usuario?.empresa_id || empresa?.id || null, fecha: fechaLocal, texto_original: texto, progreso: reporte?.progreso || "", faltantes: reporte?.faltantes || [], desvios: reporte?.desvios || [], fotos: fotos.length, fotos_urls: fotosUrls };
      try { await sb.post("reportes_obra", payload); } catch (dbErr) {
        console.warn("Error con tabla reportes_obra, intentando con campos mínimos:", dbErr);
        try { await sb.post("reportes_obra", { usuario_id: payload.usuario_id, nombre: payload.nombre, legajo: payload.legajo, empresa_id: payload.empresa_id, fecha: payload.fecha, texto_original: payload.texto_original, progreso: payload.progreso, faltantes: payload.faltantes, desvios: payload.desvios }); } catch (dbErr2) { throw dbErr2; }
      }
      setFase("guardado"); setUploadProgress("");
      setTimeout(() => { setTexto(""); setReporte(null); fotos.forEach(f => { if (f.preview) try{URL.revokeObjectURL(f.preview)}catch{} }); setFotos([]); setFase("ingreso"); }, 2500);
    } catch (err) { setError("Error al guardar: " + (err?.message || "Intentá de nuevo")); setFase("check"); setUploadProgress(""); }
  };

  const corregir = () => { setFase("ingreso"); setReporte(null); };

  /* ═══ RENDER ═══ */
  return (
    <section aria-label="Reporte de obra" className="px-[18px] pb-[110px] overflow-y-auto flex-1" style={{ WebkitOverflowScrolling: "touch" }}>

      {/* Error banner */}
      {error && (
        <div role="alert" className="bg-gypi-red-s rounded-2xl p-4 mb-4" style={{ border: `1px solid ${C.red}44` }}>
          <p className="m-0 text-sm text-gypi-red">⚠️ {error}</p>
        </div>
      )}

      {/* FASE 1 — INGRESO */}
      {fase === "ingreso" && (
        <>
          <div className="bg-gypi-surface rounded-2xl border border-gypi-border p-4 mb-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gypi-dim mb-2 font-body">¿Qué se hizo hoy en obra?</div>
            {grabando && (
              <div className="flex items-center gap-2 mb-2.5 py-2 px-3 rounded-[10px]" style={{ background: `${C.red}15`, border: `1px solid ${C.red}33` }}>
                <span className="w-2 h-2 rounded-full" style={{ background: C.red, animation: "pulse 1s ease-in-out infinite" }} />
                <span className="text-[13px] font-semibold font-body" style={{ color: C.red }}>Grabando… hablá y tu voz se transcribirá</span>
              </div>
            )}
            <label htmlFor="reporte-texto" className="sr-only">Reporte de obra</label>
            <textarea
              id="reporte-texto"
              className="w-full min-h-[180px] bg-gypi-surf-hi border border-gypi-border-hi rounded-xl p-3.5 text-gypi-text font-body text-[15px] resize-y outline-none box-border leading-relaxed"
              placeholder={"Contá qué se avanzó, si faltó algo,\nsi hubo algún imprevisto o espera..."}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>

          {/* Adjuntar fotos + audio */}
          <div className="flex gap-2.5 mb-4 flex-wrap items-center">
            <button
              className="py-3 px-4 rounded-xl text-sm font-body cursor-pointer inline-flex items-center gap-2"
              style={{
                background: grabando ? `${C.red}22` : C.surfHi,
                border: grabando ? `1px solid ${C.red}66` : `1px solid ${C.borderHi}`,
                color: grabando ? C.red : C.dim,
                animation: grabando ? "pulse 1.5s ease-in-out infinite" : "none",
              }}
              onClick={grabando ? detenerGrabacion : iniciarGrabacion}
            >
              {grabando ? "⏹ Detener" : "🎤 Dictar reporte"}
            </button>
            <button className="py-3 px-4 rounded-xl bg-gypi-surf-hi border border-gypi-border-hi text-gypi-dim text-sm font-body cursor-pointer inline-flex items-center gap-2" onClick={() => fileRef.current?.click()}>
              📷 Adjuntar fotos{fotos.length > 0 ? ` (${fotos.length})` : ""}
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files.length) agregarFotos(e.target.files); e.target.value = ""; }} />
          </div>

          {/* Previews de fotos */}
          {fotos.length > 0 && (
            <div className="bg-gypi-surface rounded-2xl border border-gypi-border p-3 mb-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gypi-dim mb-2.5 font-body">📷 Fotos adjuntas ({fotos.length})</div>
              <div className="grid grid-cols-3 gap-2">
                {fotos.map((f, i) => (
                  <div key={i} className="relative rounded-[10px] overflow-hidden aspect-square bg-gypi-surf-hi">
                    <img src={f.preview} alt={f.name} className="w-full h-full object-cover" />
                    <button onClick={() => quitarFoto(i)} aria-label={`Quitar foto ${i + 1}`} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 border-none text-white text-xs font-bold cursor-pointer flex items-center justify-center">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            className="w-full py-4 rounded-[14px] border-none cursor-pointer font-heading text-[17px] font-bold tracking-[0.01em]"
            style={{ background: C.amber, color: C.amberText, opacity: texto.trim() ? 1 : 0.4 }}
            disabled={!texto.trim()}
            onClick={generarReporte}
          >
            🤖 Generar Reporte
          </button>
        </>
      )}

      {/* FASE 2 — PROCESANDO */}
      {fase === "procesando" && (
        <div role="status" aria-live="polite" className="bg-gypi-surface rounded-2xl border border-gypi-border text-center py-14 px-4">
          <div className="text-[38px] mb-3.5" style={{ animation: "spin 1.2s linear infinite" }} aria-hidden="true">⚙️</div>
          <p className="m-0 text-[17px] font-heading font-bold">{uploadProgress || "Analizando tu reporte..."}</p>
          <p className="mt-2 text-gypi-dim text-[13px]">{uploadProgress ? "Aguardá un momento" : "La IA está estructurando los datos"}</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.5 } }`}</style>
        </div>
      )}

      {/* FASE 3 — DOBLE CHECK */}
      {fase === "check" && reporte && (
        <>
          <div className="bg-gypi-surface rounded-2xl border border-gypi-border p-4 mb-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gypi-dim mb-2 font-body">✅ Progreso efectivo</div>
            <p className="m-0 text-[15px] leading-relaxed text-gypi-text">{reporte.progreso || "—"}</p>
          </div>

          {reporte.faltantes?.length > 0 && (
            <div className="bg-gypi-red-s rounded-2xl p-4 mb-3" style={{ border: `1px solid ${C.red}33` }}>
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gypi-red mb-2 font-body">🚫 Faltantes</div>
              <div className="flex flex-wrap">
                {reporte.faltantes.map((f, i) => (
                  <span key={i} className="inline-block py-[5px] px-3 rounded-[10px] text-[13px] font-semibold font-body mr-1.5 mb-1.5" style={{ background: `${C.red}22`, color: C.red }}>{f}</span>
                ))}
              </div>
            </div>
          )}

          {reporte.desvios?.length > 0 && (
            <div className="bg-gypi-amber-s rounded-2xl p-4 mb-3" style={{ border: `1px solid ${C.amber}33` }}>
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gypi-amber mb-2 font-body">⚠️ Desvíos / Imprevistos</div>
              <div className="flex flex-wrap">
                {reporte.desvios.map((d, i) => (
                  <span key={i} className="inline-block py-[5px] px-3 rounded-[10px] text-[13px] font-semibold font-body mr-1.5 mb-1.5" style={{ background: `${C.amber}22`, color: C.amber }}>{d}</span>
                ))}
              </div>
            </div>
          )}

          {fotos.length > 0 && (
            <div className="bg-gypi-surface rounded-2xl border border-gypi-border p-4 mb-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gypi-dim mb-2 font-body">📷 {fotos.length} foto{fotos.length > 1 ? "s" : ""} adjunta{fotos.length > 1 ? "s" : ""}</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {fotos.map((f, i) => (
                  <img key={i} src={f.preview} alt={f.name} className="w-20 h-20 rounded-[10px] object-cover shrink-0 border border-gypi-border" />
                ))}
              </div>
            </div>
          )}

          <div className="bg-gypi-cyan-s rounded-2xl p-4 mb-3" style={{ border: `1px solid ${C.cyan}33` }}>
            <p className="m-0 text-[15px] leading-normal text-gypi-text">💬 {reporte.mensaje_doble_check || "¿Los datos están correctos?"}</p>
          </div>

          <div className="flex gap-2.5 mt-1">
            <button onClick={corregir} className="flex-1 py-3.5 rounded-xl bg-gypi-surf-hi border border-gypi-border-hi text-gypi-dim text-[15px] font-bold font-body cursor-pointer text-center">← Corregir</button>
            <button onClick={confirmar} className="flex-[2] py-3.5 rounded-[14px] border-none text-[15px] font-bold font-heading cursor-pointer" style={{ background: C.green, color: "#000" }}>✅ Confirmar y Enviar</button>
          </div>
        </>
      )}

      {/* FASE 4 — GUARDADO */}
      {fase === "guardado" && (
        <div role="status" className="bg-gypi-green-s rounded-2xl text-center py-14 px-4" style={{ border: `1px solid ${C.green}33` }}>
          <div className="text-[52px] mb-3.5" aria-hidden="true">✅</div>
          <p className="m-0 text-xl font-heading font-bold text-gypi-green">Reporte enviado</p>
          <p className="mt-2 text-gypi-dim text-[13px]">Se guardó correctamente{fotos.length > 0 ? ` con ${fotos.length} foto${fotos.length > 1 ? "s" : ""}` : ""}</p>
        </div>
      )}
    </section>
  );
}
