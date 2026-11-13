'use client';
// app/components/VistoCfo.jsx — Botón 👍 Visto de las páginas del CFO
// (/op/<token> y /op/resumen/<token>; 13/11). Las páginas son solo
// informativas: el dueño paga sin esperar al CFO. Con esto el CFO le avisa
// que ya vio lo que tiene para firmar en el banco. Sin usuario de Gypi:
// manda el token del link a /api/op/visto (una orden) o /api/op/resumen.
import { useState } from "react";

export default function VistoCfo({ token, api, visto: vistoInicial = null, cfo = "", que = "la orden" }) {
  const [visto, setVisto] = useState(vistoInicial);
  const [nombre, setNombre] = useState(cfo);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function marcar() {
    setError(null);
    setEnviando(true);
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, nombre }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || "No se pudo guardar");
      setVisto(r.visto || { por: nombre || null });
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  if (visto) {
    return (
      <section role="status" className="rounded-[18px] p-4 text-center text-[16px] font-bold bg-gypi-green/15 text-gypi-green">
        👍 Visto{visto.por ? ` por ${visto.por}` : ""}. Ya le avisamos al dueño.
      </section>
    );
  }

  return (
    <section aria-label="Avisar que lo viste" className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        Tu nombre
        <input className="g-input w-full" value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} placeholder="Quién lo vio" />
      </label>
      {error && <p role="alert" className="m-0 text-[14px] text-gypi-red">⚠ {error}</p>}
      <button type="button" className="g-btn g-btn-primary min-h-[56px] text-[17px] font-bold" disabled={enviando} onClick={marcar}>
        {enviando ? "Guardando…" : "👍 Visto"}
      </button>
      <p className="m-0 text-[13px] text-gypi-dim text-center">Es solo para avisarle al dueño que viste {que}. No hace falta para pagar.</p>
    </section>
  );
}
