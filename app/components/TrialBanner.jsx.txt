"use client";
import { useState, useEffect } from "react";
import { C, fH, fB } from "../lib/theme";
import { getToken } from "../lib/supabase";

/**
 * Banner que muestra estado de trial / vencimiento.
 * Se incluye en el dashboard del admin.
 *
 * Props:
 *  - onUpgrade: callback al tocar "Actualizar plan" (lleva a billing)
 */
export default function TrialBanner({ onUpgrade }) {
  const [info, setInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch("/api/billing/info", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (!d.error) setInfo(d); })
      .catch(() => {});
  }, []);

  if (!info || dismissed) return null;

  // ─── Trial activo ───
  if (info.estado === "trial" && info.dias_restantes !== null) {
    const urgente = info.dias_restantes <= 3;
    const color = urgente ? C.red : C.amber;
    return (
      <div style={{ background: `${color}10`, border: `1px solid ${color}40`, borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>{urgente ? "⚠️" : "🎁"}</span>
        <div style={{ flex: 1, fontFamily: fB }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
            {info.dias_restantes === 0
              ? "Tu prueba gratuita termina HOY"
              : info.dias_restantes === 1
              ? "Te queda 1 día de prueba Pro"
              : `Te quedan ${info.dias_restantes} días de prueba Pro`}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>
            Al vencer pasarás al plan Free (límite: 5 empleados).
          </div>
        </div>
        <button onClick={onUpgrade} style={{ flexShrink: 0, background: color, color: "#000", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: fB }}>
          Suscribirme
        </button>
        {!urgente && (
          <button onClick={() => setDismissed(true)} style={{ flexShrink: 0, background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14, padding: 4 }}>✕</button>
        )}
      </div>
    );
  }

  // ─── Suscripción vencida ───
  if (info.estado === "vencida") {
    return (
      <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}50`, borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>🔒</span>
        <div style={{ flex: 1, fontFamily: fB }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Tu prueba terminó</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>
            Estás en plan Free. Suscribite para recuperar todas las funciones.
          </div>
        </div>
        <button onClick={onUpgrade} style={{ flexShrink: 0, background: C.red, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: fB }}>
          Ver planes
        </button>
      </div>
    );
  }

  return null;
}