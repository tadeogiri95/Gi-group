"use client";
import { useState } from "react";
import Image from "next/image";

export default function ResetPasswordScreen({ token, empresa, onVolver }) {
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const resetear = async () => {
    setError("");
    if (!nueva || !confirmar) { setError("Completá ambos campos."); return; }
    if (nueva !== confirmar) { setError("Las contraseñas no coinciden."); return; }
    if (nueva.length < 8) { setError("Mínimo 8 caracteres"); return; }
    if (!/[A-Z]/.test(nueva) || !/[a-z]/.test(nueva) || !/[0-9]/.test(nueva)) { setError("Debe tener mayúscula, minúscula y número"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/resetear-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, nueva_password: nueva }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error al resetear");
      setOk(true);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col h-full px-7 justify-center">
      <button onClick={onVolver} aria-label="Volver al login"
        className="self-start bg-transparent border-none text-gypi-dim cursor-pointer text-[13px] mb-6 p-0">
        ← Volver al login
      </button>

      {empresa?.logo_url ? (
        <Image src={empresa.logo_url} alt={empresa?.nombre_corto || "Logo"} width={56} height={56} className="rounded-[14px] object-contain mb-5" />
      ) : (
        <div className="w-14 h-14 rounded-[14px] bg-gradient-to-br from-gypi-amber to-[#7C3AED] flex items-center justify-center mb-5">
          <span className="font-heading text-lg font-extrabold text-black">{empresa?.nombre_corto?.slice(0, 2) || "Gy"}</span>
        </div>
      )}

      <h1 className="m-0 mb-1.5 font-heading text-[26px] font-bold text-gypi-text tracking-tight">Nueva contraseña</h1>
      <div className="text-sm text-gypi-dim mb-7">Mínimo 8 caracteres, una mayúscula y un número.</div>

      {ok ? (
        <div>
          <div role="status" className="py-3.5 px-4 bg-gypi-green/10 rounded-xl text-gypi-green text-sm mb-5">
            ✓ Contraseña actualizada. Ya podés iniciar sesión.
          </div>
          <button onClick={onVolver}
            className="w-full py-3.5 rounded-xl border-none bg-gypi-amber text-white text-base font-bold font-heading cursor-pointer">
            Ir al login
          </button>
        </div>
      ) : (
        <>
          {error && (
            <div role="alert" className="text-gypi-red text-[13px] mb-3 py-2.5 px-3.5 bg-gypi-red/10 rounded-[10px]">{error}</div>
          )}
          <div className="relative mb-3">
            <label htmlFor="reset-nueva" className="sr-only">Nueva contraseña</label>
            <input
              id="reset-nueva"
              value={nueva}
              onChange={e => setNueva(e.target.value)}
              placeholder="Nueva contraseña"
              type={showPwd ? "text" : "password"}
              autoComplete="new-password"
              className="g-input w-full text-base py-3.5 px-4 rounded-xl"
              onKeyDown={e => e.key === "Enter" && resetear()}
            />
            <button onClick={() => setShowPwd(!showPwd)}
              aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none text-gypi-dim cursor-pointer text-[13px]">
              {showPwd ? "Ocultar" : "Ver"}
            </button>
          </div>
          <label htmlFor="reset-confirmar" className="sr-only">Repetir contraseña</label>
          <input
            id="reset-confirmar"
            value={confirmar}
            onChange={e => setConfirmar(e.target.value)}
            placeholder="Repetí la contraseña"
            type={showPwd ? "text" : "password"}
            autoComplete="new-password"
            className="g-input w-full text-base py-3.5 px-4 rounded-xl mb-5"
            onKeyDown={e => e.key === "Enter" && resetear()}
          />
          <button
            onClick={resetear}
            disabled={loading || !nueva || !confirmar}
            className={`w-full py-3.5 rounded-xl border-none bg-gypi-amber text-white text-base font-bold font-heading cursor-pointer ${(loading || !nueva || !confirmar) ? "opacity-60" : "opacity-100"}`}>
            {loading ? "Guardando..." : "Guardar nueva contraseña"}
          </button>
        </>
      )}
    </div>
  );
}
