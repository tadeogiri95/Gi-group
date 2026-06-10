"use client";
import { useState } from "react";
import { C, fH, fB } from "../../lib/theme";
import { setToken } from "../../lib/supabase";

export default function LoginScreen({ onLogin, empresa }) {
  const [legajo, setLegajo]   = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  // ── Recuperar contraseña ──
  const [modoRecuperar, setModoRecuperar] = useState(false);
  const [emailReset, setEmailReset]       = useState("");
  const [resetLoading, setResetLoading]   = useState(false);
  const [resetMsg, setResetMsg]           = useState("");

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

  const solicitarReset = async () => {
    if (!emailReset.trim()) return;
    setResetLoading(true); setResetMsg("");
    try {
      await fetch("/api/recuperar-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailReset.trim(), empresa_id: empresa?.id }),
      });
      // Siempre mostramos el mismo mensaje — no filtramos si el email existe
      setResetMsg("Si el email está registrado, recibirás el link en minutos. Revisá tu bandeja y spam.");
    } catch {
      setResetMsg("No se pudo enviar el email. Intentá de nuevo.");
    } finally {
      setResetLoading(false);
    }
  };

  if (modoRecuperar) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 28px", justifyContent: "center" }}>
        <button onClick={() => { setModoRecuperar(false); setResetMsg(""); setEmailReset(""); }}
          style={{ alignSelf: "flex-start", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13, marginBottom: 24, padding: 0 }}>
          ← Volver al login
        </button>
        <h1 style={{ margin: "0 0 6px", fontFamily: fH, fontSize: 26, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>Recuperar contraseña</h1>
        <div style={{ fontSize: 14, color: C.dim, marginBottom: 28, lineHeight: 1.5 }}>
          Ingresá el email con el que te registraste. Te enviamos un link para crear una nueva contraseña.
        </div>

        {resetMsg ? (
          <div style={{ padding: "14px 16px", background: C.greenS || "#E8F5E9", borderRadius: 12, color: C.green || "#2E7D32", fontSize: 14, lineHeight: 1.5 }}>
            {resetMsg}
          </div>
        ) : (
          <>
            <input
              value={emailReset}
              onChange={e => setEmailReset(e.target.value)}
              placeholder="tu@email.com"
              type="email"
              autoComplete="email"
              style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.borderHi}`, background: C.surface, color: C.text, fontSize: 16, fontFamily: fB, marginBottom: 16, outline: "none" }}
              onKeyDown={e => e.key === "Enter" && solicitarReset()}
            />
            <button
              onClick={solicitarReset}
              disabled={resetLoading || !emailReset.trim()}
              style={{ width: "100%", padding: "14px", borderRadius: 12, border: "none", background: C.amber, color: "#000", fontSize: 16, fontWeight: 700, fontFamily: fH, cursor: "pointer", opacity: (resetLoading || !emailReset.trim()) ? 0.6 : 1 }}>
              {resetLoading ? "Enviando..." : "Enviar link"}
            </button>
          </>
        )}
      </div>
    );
  }

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
      <button onClick={() => setModoRecuperar(true)}
        style={{ marginTop: 16, background: "none", border: "none", color: C.dim, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
        ¿Olvidaste tu contraseña?
      </button>
    </div>
  );
}
