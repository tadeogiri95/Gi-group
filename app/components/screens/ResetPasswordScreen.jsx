"use client";
import { useState } from "react";
import { C, fH, fB } from "../../lib/theme";

export default function ResetPasswordScreen({ token, empresa, onVolver }) {
  const [nueva, setNueva]         = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [showPwd, setShowPwd]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [ok, setOk]               = useState(false);

  const resetear = async () => {
    setError("");
    if (!nueva || !confirmar) { setError("Completá ambos campos."); return; }
    if (nueva !== confirmar) { setError("Las contraseñas no coinciden."); return; }
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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 28px", justifyContent: "center" }}>
      <button onClick={onVolver}
        style={{ alignSelf: "flex-start", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13, marginBottom: 24, padding: 0 }}>
        ← Volver al login
      </button>

      {empresa?.logo_url ? (
        <img src={empresa.logo_url} alt={empresa?.nombre_corto || "Logo"} style={{ width: 56, height: 56, borderRadius: 14, objectFit: "contain", marginBottom: 20 }} />
      ) : (
        <div style={{ width: 56, height: 56, borderRadius: 14, background: `linear-gradient(135deg,${C.amber},${C.violet})`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
          <span style={{ fontFamily: fH, fontSize: 18, fontWeight: 800, color: "#000" }}>{empresa?.nombre_corto?.slice(0, 2) || "Gy"}</span>
        </div>
      )}

      <h1 style={{ margin: "0 0 6px", fontFamily: fH, fontSize: 26, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>Nueva contraseña</h1>
      <div style={{ fontSize: 14, color: C.dim, marginBottom: 28 }}>Mínimo 8 caracteres, una mayúscula y un número.</div>

      {ok ? (
        <div>
          <div style={{ padding: "14px 16px", background: C.greenS || "#E8F5E9", borderRadius: 12, color: C.green || "#2E7D32", fontSize: 14, marginBottom: 20 }}>
            ✓ Contraseña actualizada. Ya podés iniciar sesión.
          </div>
          <button onClick={onVolver}
            style={{ width: "100%", padding: "14px", borderRadius: 12, border: "none", background: C.amber, color: "#000", fontSize: 16, fontWeight: 700, fontFamily: fH, cursor: "pointer" }}>
            Ir al login
          </button>
        </div>
      ) : (
        <>
          {error && (
            <div style={{ color: C.red, fontSize: 13, marginBottom: 12, padding: "10px 14px", background: C.redS, borderRadius: 10 }}>
              {error}
            </div>
          )}
          <div style={{ position: "relative", marginBottom: 12 }}>
            <input
              value={nueva}
              onChange={e => setNueva(e.target.value)}
              placeholder="Nueva contraseña"
              type={showPwd ? "text" : "password"}
              autoComplete="new-password"
              style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.borderHi}`, background: C.surface, color: C.text, fontSize: 16, fontFamily: fB, outline: "none" }}
              onKeyDown={e => e.key === "Enter" && resetear()}
            />
            <button onClick={() => setShowPwd(!showPwd)}
              style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>
              {showPwd ? "Ocultar" : "Ver"}
            </button>
          </div>
          <input
            value={confirmar}
            onChange={e => setConfirmar(e.target.value)}
            placeholder="Repetí la contraseña"
            type={showPwd ? "text" : "password"}
            autoComplete="new-password"
            style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.borderHi}`, background: C.surface, color: C.text, fontSize: 16, fontFamily: fB, marginBottom: 20, outline: "none" }}
            onKeyDown={e => e.key === "Enter" && resetear()}
          />
          <button
            onClick={resetear}
            disabled={loading || !nueva || !confirmar}
            style={{ width: "100%", padding: "14px", borderRadius: 12, border: "none", background: C.amber, color: "#000", fontSize: 16, fontWeight: 700, fontFamily: fH, cursor: "pointer", opacity: (loading || !nueva || !confirmar) ? 0.6 : 1 }}>
            {loading ? "Guardando..." : "Guardar nueva contraseña"}
          </button>
        </>
      )}
    </div>
  );
}
