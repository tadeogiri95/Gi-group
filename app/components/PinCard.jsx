"use client";
// PinCard — El operario crea o cambia su PIN de 4 números (F4-06, D7).
// Con el PIN entra rápido (legajo + PIN) cuando la sesión se cerró o en otro
// celular; la contraseña sigue sirviendo siempre.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { problemaPin } from "../lib/pin";

const soloNumeros = (v) => v.replace(/\D/g, "").slice(0, 4);

export default function PinCard({ tienePin, onCambio, demo = false }) {
  const [abierto, setAbierto] = useState(false);
  const [pin, setPin] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState("");

  const cerrar = () => { setAbierto(false); setPin(""); setRepetir(""); setError(""); };

  const guardar = async () => {
    const problema = problemaPin(pin);
    if (problema) return setError(problema);
    if (pin !== repetir) return setError("Los dos PIN no coinciden");
    setGuardando(true);
    setError("");
    try {
      if (!demo) {
        const res = await apiFetch("/api/pin", { method: "POST", body: JSON.stringify({ pin }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "No se pudo guardar el PIN");
      }
      cerrar();
      setListo(tienePin ? "PIN cambiado." : "¡Listo! La próxima vez entrá con tu legajo y tu PIN.");
      onCambio?.(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (!abierto) {
    return (
      <div className="g-card !p-3.5 mb-[22px] flex items-center justify-between gap-3">
        <div className="text-[13px] text-gypi-text">
          {listo || (tienePin ? "Entrás con tu PIN de 4 números." : "Creá un PIN de 4 números para entrar más rápido.")}
        </div>
        <button
          onClick={() => { setListo(""); setAbierto(true); }}
          className="min-h-[44px] px-4 rounded-lg border border-gypi-border bg-gypi-surface text-gypi-text text-xs font-bold cursor-pointer shrink-0"
        >
          {tienePin ? "Cambiar PIN" : "Crear PIN"}
        </button>
      </div>
    );
  }

  return (
    <div className="g-card !p-3.5 mb-[22px] flex flex-col gap-2.5" role="group" aria-label={tienePin ? "Cambiar PIN" : "Crear PIN"}>
      <div className="text-[13px] font-bold text-gypi-text">{tienePin ? "Nuevo PIN" : "Tu PIN"}</div>
      <div className="text-xs text-gypi-dim">4 números, sin repetir el mismo (1111) ni escaleras (1234).</div>
      <label className="text-xs text-gypi-dim">
        PIN
        <input
          value={pin}
          onChange={(e) => setPin(soloNumeros(e.target.value))}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          className="mt-1 w-full p-3 rounded-lg bg-gypi-surface border border-gypi-border text-gypi-text text-lg tracking-[0.4em]"
        />
      </label>
      <label className="text-xs text-gypi-dim">
        Repetí el PIN
        <input
          value={repetir}
          onChange={(e) => setRepetir(soloNumeros(e.target.value))}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          className="mt-1 w-full p-3 rounded-lg bg-gypi-surface border border-gypi-border text-gypi-text text-lg tracking-[0.4em]"
        />
      </label>
      {error && <div role="alert" className="text-xs text-gypi-red font-semibold">{error}</div>}
      <div className="flex gap-2">
        <button onClick={cerrar} className="flex-1 min-h-[44px] rounded-lg border border-gypi-border bg-transparent text-gypi-dim text-xs font-bold cursor-pointer">Cancelar</button>
        <button
          onClick={guardar}
          disabled={guardando || pin.length !== 4 || repetir.length !== 4}
          className="flex-1 min-h-[44px] rounded-lg border-none bg-gypi-amber text-white text-xs font-bold cursor-pointer disabled:opacity-50"
        >
          {guardando ? "Guardando..." : "Guardar PIN"}
        </button>
      </div>
    </div>
  );
}
