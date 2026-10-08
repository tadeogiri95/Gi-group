"use client";
// Interruptor del resumen semanal por email (D10, ítem 31).
import { useState } from "react";
import { apiFetch } from "../lib/supabase";

export default function ResumenSemanalSwitch({ empresa, onUpdate }) {
  // Sin la columna (migración 077 sin correr) vale como activado: es el default.
  const activo = empresa?.resumen_semanal !== false;
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cambiar = async () => {
    setGuardando(true);
    setError("");
    try {
      const res = await apiFetch("/api/empresa", { method: "PATCH", body: JSON.stringify({ resumen_semanal: !activo }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "No se pudo guardar");
      onUpdate?.({ resumen_semanal: !activo });
    } catch (e) {
      setError(e.message);
    }
    setGuardando(false);
  };

  return (
    <div className="g-card mt-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-gypi-dim">
          <b className="text-gypi-text">Resumen semanal por email:</b> cada lunes a la mañana, horas por OT, tiempo parado y ausencias de la semana anterior{empresa?.admin_email ? ` (a ${empresa.admin_email})` : ""}.
        </div>
        <button
          role="switch"
          aria-checked={activo}
          aria-label="Resumen semanal por email"
          onClick={cambiar}
          disabled={guardando}
          className={`shrink-0 min-h-[40px] px-3 rounded-lg border-none text-xs font-bold cursor-pointer ${activo ? "bg-gypi-green/15 text-gypi-green" : "bg-gypi-surface text-gypi-dim"}`}
        >
          {activo ? "Activado" : "Desactivado"}
        </button>
      </div>
      {error && <div role="alert" className="text-xs text-gypi-red mt-2">{error}</div>}
    </div>
  );
}
