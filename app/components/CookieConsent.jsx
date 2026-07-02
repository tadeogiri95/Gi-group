"use client";
import { useState, useEffect } from "react";

const STORAGE_KEY = "gypi_cookie_consent";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  // Mostrar solo si no hay decisión previa ("1" aceptó, "0" rechazó, null = sin decisión).
  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {}
  }, []);

  if (!visible) return null;

  function accept() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    setVisible(false);
  }

  function reject() {
    // Guardar "0" para no volver a molestar al usuario en futuras visitas.
    try { localStorage.setItem(STORAGE_KEY, "0"); } catch {}
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Consentimiento de cookies"
      style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
        background: "#1E1A16", borderTop: "1px solid #2A2520",
        padding: "14px 16px 12px", display: "flex", flexDirection: "column",
        alignItems: "center", gap: 10,
        fontFamily: "'Geist', system-ui", fontSize: 13, color: "#A39A8E",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
        <span>
          Este sitio usa cookies de Google para personalizar anuncios según tus visitas previas.{" "}
          <a href="/privacy#publicidad" style={{ color: "#F97316", textDecoration: "underline" }}>Más información</a>
        </span>
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <button
            onClick={reject}
            style={{
              background: "transparent", color: "#A39A8E",
              border: "1px solid #44403c", borderRadius: 8,
              padding: "8px 20px", fontSize: 13, fontWeight: 700,
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            Rechazar
          </button>
          <button
            onClick={accept}
            style={{
              background: "#F97316", color: "#000", border: "none",
              borderRadius: 8, padding: "8px 20px", fontSize: 13,
              fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            Aceptar
          </button>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "#6B645D", textAlign: "center" }}>
        Podés cambiar tu elección en cualquier momento desde la{" "}
        <a href="/privacy" style={{ color: "#6B645D", textDecoration: "underline" }}>Configuración de la app</a>.
      </p>
    </div>
  );
}
