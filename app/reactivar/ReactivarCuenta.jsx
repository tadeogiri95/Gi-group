"use client";
// Pantalla del link "Recuperar mi cuenta" del email de baja (ítem 28).
import { useState } from "react";

const S = {
  wrap: { maxWidth: 480, margin: "0 auto", padding: "56px 20px", fontFamily: "'Geist', system-ui", color: "#F5F0E8", background: "#0C0A09", height: "100dvh", overflowY: "auto", lineHeight: 1.6 },
  h1: { fontSize: 26, fontWeight: 800, marginBottom: 8, fontFamily: "'Bricolage Grotesque', system-ui" },
  p: { fontSize: 14, color: "#A39A8E", marginBottom: 20 },
  btn: { minHeight: 48, padding: "0 24px", borderRadius: 10, border: "none", background: "#F97316", color: "#000", fontWeight: 700, fontSize: 15, cursor: "pointer" },
};

export default function ReactivarCuenta({ token }) {
  const [estado, setEstado] = useState(token ? "listo" : "sin-token");
  const [mensaje, setMensaje] = useState("");
  const [slug, setSlug] = useState("");

  const reactivar = async () => {
    setEstado("enviando");
    try {
      const r = await fetch("/api/cuenta/reactivar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMensaje(d.error || "No se pudo recuperar la cuenta."); setEstado("error"); return; }
      setSlug(d.slug || "");
      setEstado("ok");
    } catch {
      setMensaje("Sin conexión. Probá de nuevo.");
      setEstado("error");
    }
  };

  return (
    <main style={S.wrap}>
      <h1 style={S.h1}>Recuperar tu cuenta</h1>
      {estado === "sin-token" && <p style={S.p}>Abrí el link desde el email que te mandamos al dar de baja la cuenta.</p>}
      {(estado === "listo" || estado === "enviando") && <>
        <p style={S.p}>La cuenta vuelve a quedar como estaba: tu equipo puede volver a entrar y no se borra nada. La suscripción quedó cancelada: si querés seguir después de la prueba, elegí un plan desde la app.</p>
        <button style={S.btn} onClick={reactivar} disabled={estado === "enviando"}>{estado === "enviando" ? "Recuperando…" : "Recuperar mi cuenta"}</button>
      </>}
      {estado === "ok" && <>
        <p role="status" style={S.p}>¡Listo! La cuenta está activa de nuevo.</p>
        {slug && <a href={`/${slug}`} style={{ ...S.btn, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Entrar a Gypi</a>}
      </>}
      {estado === "error" && <>
        <p role="alert" style={{ ...S.p, color: "#F87171" }}>{mensaje}</p>
        <p style={S.p}>¿Necesitás ayuda? Escribinos a <a href="mailto:contacto@gypi.app" style={{ color: "#F97316" }}>contacto@gypi.app</a>.</p>
      </>}
    </main>
  );
}
