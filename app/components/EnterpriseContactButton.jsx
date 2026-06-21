"use client";
import { useState } from "react";

const FIELD = { width: "100%", padding: "10px 12px", borderRadius: 10, marginTop: 4, marginBottom: 10, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "var(--color-surface, #1A1714)", border: "1px solid var(--color-border, rgba(255,240,220,0.1))", color: "var(--color-text, #F5F0E8)" };
const LABEL = { display: "block", fontSize: 11, fontWeight: 700, color: "var(--color-text-dim, #9B8F85)", textTransform: "uppercase", letterSpacing: "0.05em" };

/**
 * Botón "Contactanos" para el plan Enterprise que abre un formulario
 * self-service (en vez de un mailto:) y lo manda a /api/contacto-enterprise.
 * Auto-contenido: trae su propio estado de modal/envío.
 */
export default function EnterpriseContactButton({ className, style, children }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nombre: "", email: "", empresa: "", telefono: "", mensaje: "" });
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const enviar = async () => {
    if (!form.nombre.trim() || !form.email.trim() || !form.empresa.trim()) {
      setError("Completá nombre, email y empresa");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/contacto-enterprise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || "Error enviando la consulta");
      setEnviado(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const cerrar = () => {
    setOpen(false);
    setEnviado(false);
    setError("");
    setForm({ nombre: "", email: "", empresa: "", telefono: "", mensaje: "" });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} style={style}>
        {children || "Contactanos"}
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Consulta plan Enterprise" style={{ position: "fixed", inset: 0, zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={cerrar} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)" }} />
          <div style={{ position: "relative", width: "100%", maxWidth: 420, background: "var(--color-bg, #0C0A09)", borderRadius: 20, padding: 28, border: "1px solid var(--color-border, rgba(255,240,220,0.1))" }}>
            {enviado ? (
              <>
                <h3 style={{ margin: "0 0 8px", color: "var(--color-text, #F5F0E8)", fontSize: 18, fontWeight: 700 }}>¡Listo! 🎉</h3>
                <p style={{ margin: "0 0 18px", color: "var(--color-text-dim, #9B8F85)", fontSize: 13, lineHeight: 1.5 }}>
                  Recibimos tu consulta. Te vamos a contactar a la brevedad para armar una propuesta a medida.
                </p>
                <button onClick={cerrar} style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: "var(--color-empresa-primary, #F97316)", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                  Cerrar
                </button>
              </>
            ) : (
              <>
                <h3 style={{ margin: "0 0 4px", color: "var(--color-text, #F5F0E8)", fontSize: 18, fontWeight: 700 }}>Plan Enterprise</h3>
                <p style={{ margin: "0 0 18px", color: "var(--color-text-dim, #9B8F85)", fontSize: 13 }}>
                  Contanos sobre tu empresa y te armamos una propuesta a medida.
                </p>

                <label style={LABEL}>Tu nombre</label>
                <input value={form.nombre} onChange={set("nombre")} placeholder="Ej: Juan García" style={FIELD} />

                <label style={LABEL}>Email</label>
                <input type="email" value={form.email} onChange={set("email")} placeholder="juan@tuempresa.com" style={FIELD} />

                <label style={LABEL}>Empresa</label>
                <input value={form.empresa} onChange={set("empresa")} placeholder="Ej: Metalúrgica García" style={FIELD} />

                <label style={LABEL}>Teléfono (opcional)</label>
                <input value={form.telefono} onChange={set("telefono")} placeholder="Ej: +54 9 11 1234-5678" style={FIELD} />

                <label style={LABEL}>Mensaje (opcional)</label>
                <textarea value={form.mensaje} onChange={set("mensaje")} rows={3} placeholder="Contanos cuántos empleados tenés, qué necesitás..." style={{ ...FIELD, resize: "vertical" }} />

                {error && <div role="alert" style={{ color: "#EF4444", fontSize: 12, marginBottom: 10 }}>{error}</div>}

                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={cerrar} style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid var(--color-border, rgba(255,240,220,0.1))", background: "transparent", color: "var(--color-text-dim, #9B8F85)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Cancelar
                  </button>
                  <button type="button" onClick={enviar} disabled={loading} style={{ flex: 2, padding: 12, borderRadius: 10, border: "none", background: "var(--color-empresa-primary, #F97316)", color: "#000", fontSize: 13, fontWeight: 700, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1 }}>
                    {loading ? "Enviando..." : "Enviar consulta"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
