// Extraído de [slug]/page.js líneas 409-417
import { C, fM } from "../../lib/theme";
import { Tag } from "../ui";

export default function SolCard({ s, showActions, onResolve }) {
  const ec = { pendiente: C.amber, aprobado: C.green, rechazado: C.red, registrado: C.cyan };
  const esPermisoIngreso = s.motivo?.includes("🔓") || s.motivo?.toLowerCase().includes("permiso de ingreso") || s.motivo?.toLowerCase().includes("ingreso por bloqueo");

  return (
    <article aria-label={`Solicitud: ${s.motivo || s.tipo} - ${s.estado}`} style={{
      background: esPermisoIngreso && s.estado === "pendiente" ? `${C.red}08` : C.surface,
      borderRadius: 14, padding: 14,
      border: `1px solid ${esPermisoIngreso && s.estado === "pendiente" ? C.red + "40" : s.estado === "pendiente" ? C.amber + "30" : C.border}`,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.motivo || s.tipo}</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
            Legajo {s.legajo} · {s.fecha || new Date(s.created_at).toLocaleDateString("es-AR")}
          </div>
          {s.detalle && <div style={{ fontSize: 12, color: C.dim, marginTop: 6, fontFamily: fM }}>{s.detalle}</div>}
        </div>
        <Tag color={ec[s.estado] || C.dim}>{s.estado?.toUpperCase()}</Tag>
      </div>
      {showActions && s.estado === "pendiente" && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={() => onResolve?.(s.id, "aprobado")} aria-label={`Aprobar solicitud de legajo ${s.legajo}`} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: C.greenS, color: C.green, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Aprobar</button>
          <button onClick={() => onResolve?.(s.id, "rechazado")} aria-label={`Rechazar solicitud de legajo ${s.legajo}`} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: C.redS, color: C.red, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Rechazar</button>
        </div>
      )}
    </article>
  );
}
