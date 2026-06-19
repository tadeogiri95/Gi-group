"use client";
import { useState } from "react";
import { getToken } from "../../lib/supabase";

const STRENGTH_COLORS = ["transparent", "var(--color-red)", "var(--color-empresa-primary)", "var(--color-green)"];
const STRENGTH_LABELS = ["", "Débil", "Regular", "Fuerte"];

export default function CambiarPasswordScreen({ usuario, onDone }) {
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const cambiar = async () => {
    if (nueva !== confirmar) { setError("Las contraseñas no coinciden"); return; }
    if (nueva.length < 8) { setError("Mínimo 8 caracteres"); return; }
    if (!/[A-Z]/.test(nueva) || !/[a-z]/.test(nueva) || !/[0-9]/.test(nueva)) {
      setError("Debe tener mayúscula, minúscula y número"); return;
    }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/login-empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cambiar_password", userId: usuario.id, nuevaPassword: nueva, token: getToken() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error");
      onDone(data.usuario);
    } catch (err) { setError(err.message); setLoading(false); }
  };

  const strength = nueva.length === 0 ? 0 : nueva.length < 8 ? 1 : (!/[A-Z]/.test(nueva) || !/[a-z]/.test(nueva) || !/[0-9]/.test(nueva)) ? 2 : 3;
  const strengthColor = STRENGTH_COLORS[strength];
  const canSubmit = !loading && nueva && nueva === confirmar && strength >= 3;
  const mismatch = confirmar && confirmar !== nueva;

  return (
    <div className="flex flex-col h-full px-7 justify-center">
      <h1 className="m-0 font-heading text-2xl font-bold text-gypi-text">Cambiá tu contraseña</h1>
      <div className="text-[13px] text-gypi-dim mt-1.5 mb-7">Elegí una contraseña segura (mín. 8 chars, mayúscula, minúscula, número)</div>

      {error && (
        <div className="text-gypi-red text-[13px] mb-3 py-2.5 px-3.5 bg-gypi-red/10 rounded-[10px]">{error}</div>
      )}

      {/* Password input */}
      <div className="relative mb-3">
        <input
          value={nueva}
          onChange={e => setNueva(e.target.value)}
          placeholder="Nueva contraseña"
          type={showPwd ? "text" : "password"}
          className="g-input w-full text-base py-3.5 px-4 rounded-xl"
        />
        <button
          onClick={() => setShowPwd(!showPwd)}
          className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none text-gypi-dim cursor-pointer text-[13px]"
        >
          {showPwd ? "Ocultar" : "Ver"}
        </button>
      </div>

      {/* Strength bar */}
      {nueva.length > 0 && (
        <div className="mb-3">
          <div className="h-1 rounded-sm bg-gypi-surface-hi overflow-hidden">
            <div
              className="h-full rounded-sm transition-all duration-300"
              style={{ width: `${(strength / 3) * 100}%`, background: strengthColor }}
            />
          </div>
          <div className="text-[11px] mt-1 font-semibold" style={{ color: strengthColor }}>{STRENGTH_LABELS[strength]}</div>
        </div>
      )}

      {/* Confirm input */}
      <input
        value={confirmar}
        onChange={e => setConfirmar(e.target.value)}
        placeholder="Repetí la contraseña"
        type={showPwd ? "text" : "password"}
        className={`g-input w-full text-base py-3.5 px-4 rounded-xl mb-1 ${mismatch ? "border-gypi-red" : ""}`}
      />
      {mismatch && <div className="text-[11px] text-gypi-red mb-2">No coinciden</div>}

      {/* Submit */}
      <button
        onClick={cambiar}
        disabled={!canSubmit}
        className={`mt-4 w-full py-3.5 rounded-xl border-none bg-gypi-amber text-white text-base font-bold font-heading cursor-pointer ${
          canSubmit ? "opacity-100" : "opacity-50 cursor-default"
        }`}
      >
        {loading ? "Guardando..." : "Guardar"}
      </button>
    </div>
  );
}
