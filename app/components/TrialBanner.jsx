"use client";
import { useState, useEffect, useCallback } from "react";
import { getToken } from "../lib/supabase";

export default function TrialBanner({ onUpgrade, reload }) {
  const [info, setInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [errorTrial, setErrorTrial] = useState("");

  const cargarInfo = useCallback(() => {
    const token = getToken();
    if (!token) return;
    fetch("/api/billing/info", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (!d.error) setInfo(d); })
      .catch(() => {});
  }, []);

  useEffect(() => { cargarInfo(); }, [cargarInfo]);

  const iniciarTrial = async () => {
    setIniciando(true); setErrorTrial("");
    try {
      const token = getToken();
      const res = await fetch("/api/billing/iniciar-trial", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || "No se pudo iniciar la prueba");
      cargarInfo();
      await reload?.();
    } catch (err) {
      setErrorTrial(err.message);
    } finally {
      setIniciando(false);
    }
  };

  if (!info || dismissed) return null;

  if (info.trial_disponible) {
    return (
      <div role="status" className="flex items-center gap-2.5 rounded-xl px-3.5 py-3 mb-3.5" style={{ background: "var(--color-empresa-primary-subtle, rgba(249,115,22,0.1))", border: "1px solid color-mix(in srgb, var(--color-empresa-primary) 25%, transparent)" }}>
        <span aria-hidden="true" className="text-[22px] shrink-0">🎁</span>
        <div className="flex-1 font-body">
          <div className="text-[13px] font-bold text-gypi-text">¿Querés probar el plan Pro gratis?</div>
          <div className="text-[11px] text-gypi-dim mt-px">14 días sin cargo, sin tarjeta. {errorTrial && <span className="text-gypi-red">{errorTrial}</span>}</div>
        </div>
        <button onClick={iniciarTrial} disabled={iniciando} className="shrink-0 border-none rounded-lg py-2 px-3.5 text-xs font-bold cursor-pointer font-body text-black disabled:opacity-60" style={{ background: "var(--color-empresa-primary, #F97316)" }}>
          {iniciando ? "Iniciando..." : "Iniciar prueba"}
        </button>
        <button onClick={() => setDismissed(true)} aria-label="Cerrar aviso" className="shrink-0 bg-transparent border-none text-gypi-dim cursor-pointer text-sm p-1">✕</button>
      </div>
    );
  }

  if (info.estado === "trial" && info.dias_restantes !== null) {
    const urgente = info.dias_restantes <= 3;
    const color = urgente ? "#DC2626" : "var(--color-empresa-primary, #F97316)";
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2.5 rounded-xl px-3.5 py-3 mb-3.5" style={{ background: `${color}10`, border: `1px solid ${color}40` }}>
        <span aria-hidden="true" className="text-[22px] shrink-0">{urgente ? "⚠️" : "🎁"}</span>
        <div className="flex-1 font-body">
          <div className="text-[13px] font-bold text-gypi-text">
            {info.dias_restantes === 0
              ? "Tu prueba gratuita termina HOY"
              : info.dias_restantes === 1
              ? "Te queda 1 día de prueba Pro"
              : `Te quedan ${info.dias_restantes} días de prueba Pro`}
          </div>
          <div className="text-[11px] text-gypi-dim mt-px">Al vencer pasarás al plan Free (límite: 5 empleados).</div>
        </div>
        <button onClick={onUpgrade} className="shrink-0 border-none rounded-lg py-2 px-3.5 text-xs font-bold cursor-pointer font-body text-black" style={{ background: color }}>
          Suscribirme
        </button>
        {!urgente && (
          <button onClick={() => setDismissed(true)} aria-label="Cerrar aviso" className="shrink-0 bg-transparent border-none text-gypi-dim cursor-pointer text-sm p-1">✕</button>
        )}
      </div>
    );
  }

  if (info.estado === "vencida") {
    return (
      <div role="alert" className="flex items-center gap-2.5 rounded-xl px-3.5 py-3 mb-3.5 bg-gypi-red/[0.07] border border-gypi-red/30">
        <span aria-hidden="true" className="text-[22px] shrink-0">🔒</span>
        <div className="flex-1 font-body">
          <div className="text-[13px] font-bold text-gypi-text">Tu prueba terminó</div>
          <div className="text-[11px] text-gypi-dim mt-px">Estás en plan Free. Suscribite para recuperar todas las funciones.</div>
        </div>
        <button onClick={onUpgrade} className="shrink-0 bg-gypi-red text-white border-none rounded-lg py-2 px-3.5 text-xs font-bold cursor-pointer font-body">
          Ver planes
        </button>
      </div>
    );
  }

  return null;
}
