import { Tag } from "../ui";

const AMBER = "var(--color-empresa-primary, #F97316)";
const GREEN = "#16A34A";
const RED = "#DC2626";
const CYAN = "#0891B2";

export default function SolCard({ s, showActions, onResolve }) {
  const ec = { pendiente: AMBER, aprobado: GREEN, rechazado: RED, registrado: CYAN };
  const esPermisoIngreso = s.motivo?.includes("🔓") || s.motivo?.toLowerCase().includes("permiso de ingreso") || s.motivo?.toLowerCase().includes("ingreso por bloqueo");

  return (
    <article
      aria-label={`Solicitud: ${s.motivo || s.tipo} - ${s.estado}`}
      className="g-card !p-3.5 relative overflow-hidden"
      style={{
        background: esPermisoIngreso && s.estado === "pendiente" ? `${RED}08` : undefined,
        borderColor: esPermisoIngreso && s.estado === "pendiente" ? RED + "40" : s.estado === "pendiente" ? AMBER + "30" : undefined,
      }}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-gypi-text">{s.motivo || s.tipo}</div>
          <div className="text-[11px] text-gypi-dim mt-1">
            Legajo {s.legajo} · {s.fecha || new Date(s.created_at).toLocaleDateString("es-AR")}
          </div>
          {s.detalle && <div className="text-xs text-gypi-dim mt-1.5 font-mono">{s.detalle}</div>}
        </div>
        <Tag color={ec[s.estado] || "var(--color-text-muted)"}>{s.estado?.toUpperCase()}</Tag>
      </div>
      {showActions && s.estado === "pendiente" && (
        <div className="flex gap-2 mt-2.5">
          <button onClick={() => onResolve?.(s.id, "aprobado")} aria-label={`Aprobar solicitud de legajo ${s.legajo}`} className="flex-1 py-2 rounded-lg border-none bg-gypi-green/10 text-gypi-green text-xs font-bold cursor-pointer">Aprobar</button>
          <button onClick={() => onResolve?.(s.id, "rechazado")} aria-label={`Rechazar solicitud de legajo ${s.legajo}`} className="flex-1 py-2 rounded-lg border-none bg-gypi-red/10 text-gypi-red text-xs font-bold cursor-pointer">Rechazar</button>
        </div>
      )}
    </article>
  );
}
