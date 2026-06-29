import ContactoForm from "./ContactoForm";

export const metadata = {
  title: "Contacto — Gypi",
  description: "Hablá con el equipo de Gypi: email, WhatsApp o formulario de contacto. Te respondemos a la brevedad.",
};

export default function Contacto() {
  const S = {
    wrap: { maxWidth: 720, margin: "0 auto", padding: "40px 20px", fontFamily: "'Geist', system-ui", color: "#F5F0E8", background: "#0C0A09", height: "100dvh", overflowY: "auto", WebkitOverflowScrolling: "touch", lineHeight: 1.7 },
    h1: { fontSize: 28, fontWeight: 800, marginBottom: 8, fontFamily: "'Bricolage Grotesque', system-ui" },
    p: { fontSize: 14, color: "#A39A8E", marginBottom: 24 },
    item: { display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#F5F0E8", marginBottom: 12 },
    label: { color: "#A39A8E" },
  };

  return (
    <div style={S.wrap}>
      <a href="/" style={{ fontSize: 13, color: "#F97316", textDecoration: "none", display: "inline-block", marginBottom: 24 }}>← Volver a Gypi</a>
      <h1 style={S.h1}>Contacto</h1>
      <p style={S.p}>¿Tenés dudas sobre Gypi, querés una demo o necesitás ayuda con tu cuenta? Escribinos por el canal que prefieras.</p>

      <div style={{ marginBottom: 32 }}>
        <div style={S.item}><span style={S.label}>Email:</span> <a href="mailto:contacto@gypi.app" style={{ color: "#F97316" }}>contacto@gypi.app</a></div>
        <div style={S.item}><span style={S.label}>WhatsApp:</span> <a href="https://wa.me/5493513152772" target="_blank" rel="noopener noreferrer" style={{ color: "#F97316" }}>+54 9 351 315-2772</a></div>
        <div style={S.item}><span style={S.label}>Ubicación:</span> Córdoba, Argentina</div>
      </div>

      <ContactoForm />
    </div>
  );
}
