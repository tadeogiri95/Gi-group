"use client";
import { useState } from "react";

const FIELD = { width: "100%", padding: "10px 12px", borderRadius: 10, marginTop: 4, marginBottom: 14, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "#1A1714", border: "1px solid #2A2520", color: "#F5F0E8" };
const LABEL = { display: "block", fontSize: 11, fontWeight: 700, color: "#9B8F85", textTransform: "uppercase", letterSpacing: "0.05em" };

export default function ContactoForm() {
  const [form, setForm] = useState({ nombre: "", email: "", telefono: "", mensaje: "", web: "" });
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const enviar = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim() || !form.email.trim() || !form.mensaje.trim()) {
      setError("Completá nombre, email y mensaje");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/contacto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || "Error enviando el mensaje");
      setEnviado(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (enviado) {
    return (
      <div style={{ background: "#14110D", border: "1px solid #2A2520", borderRadius: 14, padding: 24 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>¡Listo! 🎉</h3>
        <p style={{ margin: 0, fontSize: 13, color: "#A39A8E" }}>Recibimos tu mensaje. Te vamos a responder a la brevedad por email.</p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} style={{ background: "#14110D", border: "1px solid #2A2520", borderRadius: 14, padding: 24 }}>
      {/* Honeypot anti-bot: oculto para usuarios reales, los bots que autocompletan todo lo llenan */}
      <div style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">
        <label htmlFor="web">No completar</label>
        <input id="web" name="web" type="text" tabIndex={-1} autoComplete="off" value={form.web} onChange={set("web")} />
      </div>

      <label style={LABEL}>Tu nombre</label>
      <input value={form.nombre} onChange={set("nombre")} placeholder="Ej: Juan García" style={FIELD} />

      <label style={LABEL}>Email</label>
      <input type="email" value={form.email} onChange={set("email")} placeholder="juan@tuempresa.com" style={FIELD} />

      <label style={LABEL}>Teléfono (opcional)</label>
      <input value={form.telefono} onChange={set("telefono")} placeholder="Ej: +54 9 351 315-2772" style={FIELD} />

      <label style={LABEL}>Mensaje</label>
      <textarea value={form.mensaje} onChange={set("mensaje")} rows={4} placeholder="Contanos en qué te podemos ayudar..." style={{ ...FIELD, resize: "vertical" }} />

      {error && <div role="alert" style={{ color: "#EF4444", fontSize: 12, marginBottom: 10 }}>{error}</div>}

      <button type="submit" disabled={loading} style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: "#F97316", color: "#000", fontSize: 14, fontWeight: 700, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1 }}>
        {loading ? "Enviando..." : "Enviar mensaje"}
      </button>
    </form>
  );
}
