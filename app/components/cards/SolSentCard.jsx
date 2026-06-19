import { Ic } from "../Icons";
import { Tag } from "../ui";

const AMBER = "var(--color-empresa-primary, #F97316)";

export default function SolSentCard({ motivo, fecha }) {
  return (
    <div className="mt-2 p-3.5 bg-gypi-amber/10 rounded-[14px] min-w-[220px]" style={{ border: `1px solid ${AMBER}30` }}>
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[11px] text-gypi-amber font-bold tracking-wide">ENVIADA A GERENCIA</div>
          <div className="text-[13px] text-gypi-text font-semibold mt-1">{motivo}</div>
          <div className="text-[11px] text-gypi-dim mt-1">📅 {fecha} · ⏳ Esperando</div>
        </div>
        <Tag color={AMBER}><Ic.clock size={10} /> PENDIENTE</Tag>
      </div>
    </div>
  );
}
