'use client';
// app/components/AprobarResumenPago.jsx — Botón "Aprobar todas" de la página
// del CFO para un resumen de órdenes de pago (/op/resumen/<token>; 12/11,
// migración 186). Sin usuario de Gypi: manda el token a /api/op/resumen.
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AprobarResumenPago({ token, esperando, cfo = "" }) {
  const router = useRouter();
  const [nombre, setNombre] = useState(cfo);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const [error, setError] = useState(null);

  async function aprobar() {
    setError(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/op/resumen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, nombre }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || "No se pudo guardar");
      setHecho(r.aprobadas);
      router.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  if (hecho) {
    return (
      <section role="status" className="rounded-[18px] p-4 text-center text-[16px] font-bold bg-gypi-green/15 text-gypi-green">
        ✅ Aprobaste {hecho === 1 ? "la orden" : `las ${hecho} órdenes`}. Ya le avisamos al dueño para que las pague.
      </section>
    );
  }
  if (!esperando) return null;

  return (
    <section aria-label="Aprobar el resumen" className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        Tu nombre
        <input className="g-input w-full" value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} placeholder="Quién aprueba" />
      </label>
      {error && <p role="alert" className="m-0 text-[14px] text-gypi-red">⚠ {error}</p>}
      <button type="button" className="g-btn g-btn-primary min-h-[56px] text-[17px] font-bold" disabled={enviando} onClick={aprobar}>
        {enviando ? "Guardando…" : `✅ Aprobar ${esperando === 1 ? "la orden que espera" : `las ${esperando} órdenes que esperan`}`}
      </button>
      <p className="m-0 text-[13px] text-gypi-dim text-center">Para rechazar una orden, abrila con &quot;Ver y decidir&quot;.</p>
    </section>
  );
}
