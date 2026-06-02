"use client";
import { C, fH, fB } from "../lib/theme";
import { PLANES } from "../lib/plans";

/**
 * Modal/banner para mostrar cuando el usuario intenta acceder
 * a una feature que su plan no incluye.
 *
 * Props:
 *  - planActual: "free" | "starter" | "pro" | "enterprise"
 *  - planRequerido: el mínimo necesario
 *  - feature: descripción de qué necesita (ej: "exportar a PDF")
 *  - mensaje?: mensaje custom opcional
 *  - onClose: cerrar el modal
 *  - onUpgrade: callback al tocar "Actualizar plan"
 */
export default function Paywall({ planActual = "free", planRequerido = "starter", feature, mensaje, onClose, onUpgrade }) {
  const target = PLANES[planRequerido] || PLANES.starter;
  const actual = PLANES[planActual] || PLANES.free;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 420, background: C.bg, borderRadius: 24, padding: 28, border: `1px solid ${C.amber}30`, boxShadow: `0 24px 60px ${C.amber}20` }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: `linear-gradient(135deg,${C.amber},${C.violet})`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 32 }}>🔒</div>

        <h2 style={{ margin: 0, fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.text, textAlign: "center" }}>
          Función bloqueada
        </h2>
        <p style={{ fontSize: 13, color: C.dim, textAlign: "center", lineHeight: 1.5, margin: "10px 0 20px" }}>
          {mensaje || (
            <>
              <b style={{ color: C.text }}>{feature || "Esta función"}</b> no está disponible en tu plan <b style={{ color: C.text }}>{actual.nombre}</b>.
              Actualizá a <b style={{ color: C.amber }}>{target.nombre}</b> para desbloquearla.
            </>
          )}
        </p>

        <div style={{ background: C.surface, borderRadius: 14, padding: 16, border: `1px solid ${C.border}`, marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.amber }}>Plan {target.nombre}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: fH }}>
              {target.precio ? `$${target.precio.toLocaleString("es-AR")}/mes` : "A convenir"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
            ✓ Hasta {target.max_empleados.toLocaleString("es-AR")} empleados<br />
            {target.geolocalizacion && <>✓ Geolocalización ({target.max_ubicaciones >= 999 ? "ilimitada" : target.max_ubicaciones + " ubicación"})<br /></>}
            {target.exportar_csv && <>✓ Exportación CSV<br /></>}
            {target.exportar_pdf && <>✓ Reportes PDF<br /></>}
            {target.calendario && <>✓ Calendario con notas<br /></>}
            {target.reglas_bot && <>✓ Bot con reglas personalizadas<br /></>}
            {target.soporte && <>✓ Soporte {target.soporte}<br /></>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 13, borderRadius: 12, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer" }}>
            Ahora no
          </button>
          <button onClick={onUpgrade} style={{ flex: 2, padding: 13, borderRadius: 12, border: "none", background: C.amber, color: "#000", fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: "pointer" }}>
            🚀 Actualizar plan
          </button>
        </div>
      </div>
    </div>
  );
}