"use client";
// Extraído de [slug]/page.js líneas 105-150
import { useState } from "react";
import { C, fH, fB } from "../../lib/theme";
import { getToken } from "../../lib/supabase";

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

  // Password strength indicator
  const strength = nueva.length === 0 ? 0 : nueva.length < 8 ? 1 : (!/[A-Z]/.test(nueva) || !/[a-z]/.test(nueva) || !/[0-9]/.test(nueva)) ? 2 : 3;
  const strengthColor = ["transparent", C.red, C.amber, C.green][strength];
  const strengthLabel = ["", "Débil", "Regular", "Fuerte"][strength];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 28px", justifyContent: "center" }}>
      <h1 style={{ margin: 0, fontFamily: fH, fontSize: 24, fontWeight: 700, color: C.text }}>Cambiá tu contraseña</h1>
      <div style={{ fontSize: 13, color: C.dim, marginTop: 6, marginBottom: 28 }}>Elegí una contraseña segura (mín. 8 chars, mayúscula, minúscula, número)</div>
      {error && <div style={{ color: C.red, fontSize: 13, marginBottom: 12, padding: "10px 14px", background: C.redS, borderRadius: 10 }}>{error}</div>}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input value={nueva} onChange={e => setNueva(e.target.value)} placeholder="Nueva contraseña" type={showPwd ? "text" : "password"}
          style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.borderHi}`, background: C.surface, color: C.text, fontSize: 16, fontFamily: fB, outline: "none" }} />
        <button onClick={() => setShowPwd(!showPwd)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>{showPwd ? "Ocultar" : "Ver"}</button>
      </div>
      {/* Strength bar */}
      {nueva.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 4, borderRadius: 2, background: C.surfHi, overflow: "hidden" }}>
            <div style={{ width: `${(strength / 3) * 100}%`, height: "100%", background: strengthColor, borderRadius: 2, transition: "all 0.3s" }} />
          </div>
          <div style={{ fontSize: 11, color: strengthColor, marginTop: 4, fontWeight: 600 }}>{strengthLabel}</div>
        </div>
      )}
      <input value={confirmar} onChange={e => setConfirmar(e.target.value)} placeholder="Repetí la contraseña" type={showPwd ? "text" : "password"}
        style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1px solid ${confirmar && confirmar !== nueva ? C.red : C.borderHi}`, background: C.surface, color: C.text, fontSize: 16, fontFamily: fB, outline: "none", marginBottom: 4 }} />
      {confirmar && confirmar !== nueva && <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>No coinciden</div>}
      <button onClick={cambiar} disabled={loading || !nueva || nueva !== confirmar || strength < 3}
        style={{ marginTop: 16, width: "100%", padding: "14px", borderRadius: 12, border: "none", background: C.amber, color: C.amberText, fontSize: 16, fontWeight: 700, fontFamily: fH, cursor: "pointer", opacity: loading || strength < 3 ? 0.5 : 1 }}>
        {loading ? "Guardando..." : "Guardar"}
      </button>
    </div>
  );
}
