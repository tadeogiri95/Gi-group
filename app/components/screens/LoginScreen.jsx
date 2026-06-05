"use client";
// Extraído de [slug]/page.js líneas 56-102
// ENTREGA 2D: Componente independiente

import { useState } from "react";
import { C, fH, fB } from "../../lib/theme";
import { setToken } from "../../lib/supabase";

export default function LoginScreen({ onLogin, empresa }) {
  const [legajo, setLegajo] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const login = async () => {
    if (!legajo || !password) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/login-empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legajo: legajo.trim(), password, empresa_id: empresa?.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error de login");
      if (data.token) setToken(data.token);
      if (data.refresh_token) {
        try { const { setRefreshToken } = await import("../../lib/supabase"); setRefreshToken(data.refresh_token); } catch {}
      }
      onLogin(data.usuario, { token: data.token, refresh_token: data.refresh_token });
    } catch (err) { setError(err.message); setLoading(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 28px", justifyContent: "center" }}>
      {empresa?.logo_url ? (
        <img src={empresa.logo_url} alt={empresa?.nombre_corto || "Logo"} style={{ width: 72, height: 72, borderRadius: 20, objectFit: "contain", marginBottom: 24 }} />
      ) : (
        <div style={{ width: 72, height: 72, borderRadius: 20, background: `linear-gradient(135deg,${C.amber},${C.violet})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#000", marginBottom: 24 }}>
          <span style={{ fontFamily: fH, fontSize: empresa?.nombre_corto?.length > 4 ? 18 : 26, fontWeight: 800 }}>{empresa?.nombre_corto || "Gypi"}</span>
        </div>
      )}
      <h1 style={{ margin: 0, fontFamily: fH, fontSize: 30, fontWeight: 700, color: C.text, letterSpacing: "-0.025em" }}>Bienvenido</h1>
      <div style={{ fontSize: 14, color: C.dim, marginTop: 6, marginBottom: 32 }}>{"Iniciá sesión en " + (empresa?.nombre_corto || "Gypi")}</div>
      {error && <div style={{ color: C.red, fontSize: 13, marginBottom: 12, padding: "10px 14px", background: C.redS, borderRadius: 10 }}>{error}</div>}
      <input value={legajo} onChange={e => setLegajo(e.target.value)} placeholder="Legajo" type="text" inputMode="numeric"
        style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.borderHi}`, background: C.surface, color: C.text, fontSize: 16, fontFamily: fB, marginBottom: 12, outline: "none" }}
        onKeyDown={e => e.key === "Enter" && login()} />
      <div style={{ position: "relative" }}>
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Contraseña" type={showPwd ? "text" : "password"}
          style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.borderHi}`, background: C.surface, color: C.text, fontSize: 16, fontFamily: fB, outline: "none" }}
          onKeyDown={e => e.key === "Enter" && login()} />
        <button onClick={() => setShowPwd(!showPwd)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>{showPwd ? "Ocultar" : "Ver"}</button>
      </div>
      <button onClick={login} disabled={loading || !legajo || !password}
        style={{ marginTop: 20, width: "100%", padding: "14px", borderRadius: 12, border: "none", background: C.amber, color: "#000", fontSize: 16, fontWeight: 700, fontFamily: fH, cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
        {loading ? "Ingresando..." : "Ingresar"}
      </button>
    </div>
  );
}
