"use client";
import { useState } from "react";

export default function LoginForm() {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/superadmin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        // Hard navigation para que el Server Component lea la nueva cookie con certeza
        window.location.href = "/superadmin";
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Clave incorrecta");
        setLoading(false);
      }
    } catch {
      setError("Error de red — verificá tu conexión");
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0C0A09", fontFamily: "system-ui, sans-serif" }}>
      <form onSubmit={submit} style={{ background: "#1A1714", border: "1px solid rgba(255,240,220,0.08)", borderRadius: 16, padding: 40, width: 340 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#F5F0E8", marginBottom: 6, letterSpacing: "-0.02em" }}>Gypi Admin</div>
        <div style={{ fontSize: 13, color: "#6B6560", marginBottom: 28 }}>Panel de superadministración</div>
        {error && <div style={{ background: "rgba(220,38,38,0.12)", color: "#EF4444", fontSize: 13, padding: "10px 14px", borderRadius: 8, marginBottom: 16 }}>{error}</div>}
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Clave de superadmin"
          autoFocus
          style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(255,240,220,0.12)", background: "rgba(255,255,255,0.04)", color: "#F5F0E8", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 12 }}
        />
        <button
          type="submit"
          disabled={loading || !key}
          style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: loading || !key ? "rgba(249,115,22,0.3)" : "#F97316", color: "#fff", fontSize: 15, fontWeight: 700, cursor: loading || !key ? "default" : "pointer" }}
        >
          {loading ? "Verificando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
