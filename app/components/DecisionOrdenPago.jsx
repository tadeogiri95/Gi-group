'use client';
// app/components/DecisionOrdenPago.jsx — Botones Aprobar / Rechazar de la
// página del CFO (/op/<token>; Finanzas F2b, 2). Sin usuario de Gypi: manda
// el token del link a /api/op/decidir. Rechazar pide el motivo.
import { useState } from "react";

export default function DecisionOrdenPago({ token, estado: estadoInicial, decision, cfo = "" }) {
  const [estado, setEstado] = useState(estadoInicial);
  const [nombre, setNombre] = useState(cfo);
  const [rechazando, setRechazando] = useState(false);
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function decidir(d) {
    setError(null);
    if (d === "rechazar" && !nota.trim()) { setError("Contá por qué la rechazás."); return; }
    setEnviando(true);
    try {
      const res = await fetch("/api/op/decidir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, decision: d, nombre, nota }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || "No se pudo guardar");
      setEstado(r.estado);
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  if (estado === "aprobada" || estado === "rechazada") {
    const ok = estado === "aprobada";
    return (
      <section role="status" className={`rounded-[18px] p-4 text-center text-[16px] font-bold ${ok ? "bg-gypi-green/15 text-gypi-green" : "bg-gypi-red/10 text-gypi-red"}`}>
        {ok ? "✅ Aprobada. Ya le avisamos al dueño para que la pague." : "❌ Rechazada. Ya le avisamos al dueño."}
        {decision?.nota && <span className="block mt-1 text-[14px] font-normal text-gypi-text">{decision.nota}</span>}
      </section>
    );
  }
  if (estado !== "para_aprobar") return null;

  return (
    <section aria-label="Tu decisión" className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        Tu nombre
        <input className="g-input w-full" value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} placeholder="Quién aprueba" />
      </label>
      {rechazando && (
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          ¿Por qué la rechazás?
          <textarea className="g-input w-full min-h-[80px]" value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} />
        </label>
      )}
      {error && <p role="alert" className="m-0 text-[14px] text-gypi-red">⚠ {error}</p>}
      {rechazando ? (
        <div className="flex gap-2">
          <button type="button" className="g-btn g-btn-secondary flex-1 min-h-[56px]" disabled={enviando} onClick={() => setRechazando(false)}>Volver</button>
          <button type="button" className="g-btn g-btn-danger flex-1 min-h-[56px] text-[17px] font-bold" disabled={enviando} onClick={() => decidir("rechazar")}>
            {enviando ? "Guardando…" : "❌ Rechazar"}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" className="g-btn g-btn-secondary flex-1 min-h-[56px] text-[17px]" disabled={enviando} onClick={() => setRechazando(true)}>Rechazar</button>
          <button type="button" className="g-btn g-btn-primary flex-1 min-h-[56px] text-[17px] font-bold" disabled={enviando} onClick={() => decidir("aprobar")}>
            {enviando ? "Guardando…" : "✅ Aprobar"}
          </button>
        </div>
      )}
    </section>
  );
}
