'use client';
// app/components/CantidadTarea.jsx — Cantidad hecha en una tarea (Órdenes de
// Producción, parte 4; ítem 39). Solo aparece si la etapa tiene unidad
// (placas, metros, piezas…). Es opcional: se puede anotar durante la tarea o
// después, desde el historial del día. Quien lo usa le pone key={tareaId}.
import { useState } from "react";
import { sb } from "../lib/supabase";

export default function CantidadTarea({ tareaId, unidad, valor, onGuardada }) {
  const inicial = valor != null ? String(Number(valor)) : "";
  const [texto, setTexto] = useState(inicial);
  const [guardado, setGuardado] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  if (!unidad || !tareaId) return null;

  const guardar = async () => {
    const limpio = texto.trim().replace(",", ".");
    const n = limpio === "" ? null : Number(limpio);
    if (n !== null && (!Number.isFinite(n) || n < 0)) { setError("Poné un número"); return; }
    setGuardando(true);
    setError(null);
    try {
      await sb.patch(`registro_actividades?id=eq.${tareaId}`, { cantidad: n });
      const nuevo = n === null ? "" : String(n);
      setTexto(nuevo);
      setGuardado(nuevo);
      onGuardada?.(n);
    } catch (e) {
      setError(e?.message || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  const cambiado = texto.trim() !== guardado;
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <label className="text-[12px] text-gypi-dim shrink-0" htmlFor={`cantidad-${tareaId}`}>Cantidad hecha</label>
        <input id={`cantidad-${tareaId}`} inputMode="decimal" className="g-input flex-1 min-w-0 min-h-[44px]"
          value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="0" aria-label={`Cantidad hecha (${unidad})`} />
        <span className="text-[12px] text-gypi-dim shrink-0">{unidad}</span>
        {cambiado && (
          <button onClick={guardar} disabled={guardando} className="g-btn g-btn-primary min-h-[44px] shrink-0">
            {guardando ? "…" : "Guardar"}
          </button>
        )}
      </div>
      {error && <div role="alert" className="text-[11px] text-gypi-red mt-1">{error}</div>}
    </div>
  );
}
