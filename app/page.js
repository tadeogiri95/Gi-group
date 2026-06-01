'use client';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { C, fH, fB } from "./lib/theme";

export default function Landing() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [showRegistro, setShowRegistro] = useState(false);
  const [form, setForm] = useState({ nombre_empresa: "", nombre_admin: "", email: "", password: "", rubro: "general" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Si ya hay sesión guardada con empresa, redirigir directo a su slug
  useEffect(() => {
    try {
      const s = localStorage.getItem("gi-session");
      if (s) {
        const u = JSON.parse(s);
        if (u?.empresa?.slug) router.replace("/" + u.empresa.slug);
      }
    } catch {}
  }, [router]);

  const entrar = () => {
    const s = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!s) return;
    router.push("/" + s);
  };

  const registrar = async () => {
    if (!form.nombre_empresa || !form.nombre_admin || !form.email || !form.password) {
      setError("Completá todos los campos"); return;
    }
    if (form.password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/registro-empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || "Error"); setLoading(false); return; }
      // Redirigir al slug nuevo
      router.push("/" + data.empresa.slug);
    } catch (err) { setError(err.message); setLoading(false); }
  };

  if (showRegistro) {
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", padding: "40px 28px", color: C.text, fontFamily: fB, overflowY: "auto" }}>
        <button onClick={() => setShowRegistro(false)} style={{ background: "none", border: "none", color: C.amber, cursor: "pointer", fontSize: 13, padding: "8px 0", marginBottom: 8 }}>← Volver</button>
        <h1 style={{ margin: 0, fontFamily: fH, fontSize: 26, fontWeight: 700 }}>Registrar empresa</h1>
        <div style={{ fontSize: 13, color: C.dim, marginTop: 6, marginBottom: 24 }}>Creá tu cuenta para empezar a usar Gypi</div>
        {[
          { k: "nombre_empresa", l: "Nombre de tu empresa", p: "Ej: Metalúrgica García" },
          { k: "nombre_admin", l: "Tu nombre completo", p: "Ej: Juan García" },
          { k: "email", l: "Email", p: "admin@tuempresa.com", type: "email" },
          { k: "password", l: "Contraseña", p: "Mínimo 6 caracteres", type: "password" },
        ].map(f => (
          <div key={f.k} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{f.l}</label>
            <input type={f.type || "text"} value={form[f.k]} onChange={e => setForm({ ...form, [f.k]: e.target.value })} placeholder={f.p}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box" }} />
          </div>
        ))}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Rubro</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["general", "industria", "construcción", "servicios", "comercio", "tecnología"].map(r => (
              <button key={r} onClick={() => setForm({ ...form, rubro: r })}
                style={{ padding: "6px 12px", borderRadius: 20, border: `1px solid ${form.rubro === r ? C.amber : C.border}`, background: form.rubro === r ? `${C.amber}22` : "transparent", color: form.rubro === r ? C.amber : C.dim, fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>{r}</button>
            ))}
          </div>
        </div>
        <button onClick={registrar} disabled={loading}
          style={{ width: "100%", padding: 14, borderRadius: 12, background: C.amber, color: "#000", border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
          {loading ? "Creando empresa..." : "Crear empresa"}
        </button>
        {error && <div style={{ padding: 12, background: C.redS, color: C.red, borderRadius: 10, fontSize: 12, marginTop: 12 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", padding: "0 28px", color: C.text, fontFamily: fB, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: `linear-gradient(135deg,${C.amber},${C.violet})`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <span style={{ fontFamily: fH, fontSize: 26, fontWeight: 800, color: "#000" }}>Gypi</span>
      </div>
      <h1 style={{ margin: 0, fontFamily: fH, fontSize: 30, fontWeight: 700, letterSpacing: "-0.025em" }}>Bienvenido a Gypi</h1>
      <div style={{ fontSize: 14, color: C.dim, marginTop: 6, marginBottom: 32 }}>Gestión y productividad industrial</div>

      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Slug de tu empresa</label>
      <div style={{ display: "flex", alignItems: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "0 14px", marginBottom: 8 }}>
        <span style={{ color: C.mute, fontSize: 14 }}>gypi.app/</span>
        <input value={slug} onChange={e => setSlug(e.target.value)} onKeyDown={e => e.key === "Enter" && entrar()} placeholder="mi-empresa"
          style={{ flex: 1, padding: "14px 4px", border: "none", background: "transparent", color: C.text, fontSize: 15, outline: "none" }} />
      </div>
      <button onClick={entrar} disabled={!slug.trim()}
        style={{ width: "100%", padding: 14, borderRadius: 12, background: slug.trim() ? C.amber : C.surface, color: slug.trim() ? "#000" : C.mute, border: "none", fontSize: 15, fontWeight: 700, cursor: slug.trim() ? "pointer" : "default", marginTop: 8 }}>
        Ir a mi empresa
      </button>

      <div style={{ textAlign: "center", marginTop: 28, fontSize: 13, color: C.dim }}>
        ¿No tenés cuenta?{" "}
        <button onClick={() => setShowRegistro(true)} style={{ background: "none", border: "none", color: C.amber, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
          Registrá tu empresa
        </button>
      </div>
    </div>
  );
}