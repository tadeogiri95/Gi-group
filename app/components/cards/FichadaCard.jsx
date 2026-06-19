import { Ic } from "../Icons";

const GREEN = "#16A34A";
const RED = "#DC2626";

export default function FichadaCard({ tipo, hora, geoMsg, tardanza }) {
  const isIn = tipo === "ingreso";
  const color = tardanza?.estado === "bloqueado" ? RED : tardanza?.estado === "tarde" ? "#F59E0B" : GREEN;
  const label = isIn ? "FICHASTE INGRESO" : "FICHASTE EGRESO";
  const extraMsg = tardanza?.estado === "tarde" ? `⚠️ ${tardanza.minutos} min tarde (${tardanza.llegadasTarde}° del mes)` : tardanza?.estado === "bloqueado" ? `⛔ Bloqueado: ${tardanza.minutos} min tarde` : null;

  return (
    <div className="flex justify-between items-center gap-2.5 p-3.5 rounded-[14px] animate-[fadeIn_0.3s_ease]" style={{ background: `${color}12`, border: `1px solid ${color}30` }}>
      <div>
        <div className="text-[11px] font-bold tracking-wide" style={{ color }}>{label}</div>
        <div className="text-[22px] font-bold text-gypi-text font-heading mt-1">{hora}</div>
        {extraMsg && <div className="text-xs font-semibold mt-1" style={{ color }}>{extraMsg}</div>}
        {geoMsg && <div className="text-[10px] text-gypi-dim mt-1">{geoMsg}</div>}
      </div>
      {(!tardanza || tardanza.estado === "puntual") && <span className="text-gypi-green"><Ic.check size={20} /></span>}
      {tardanza?.estado === "bloqueado" && <span className="text-[24px]" style={{ color: RED }}>⛔</span>}
      {tardanza?.estado === "tarde" && <span className="text-[24px]" style={{ color: "#F59E0B" }}>⚠️</span>}
    </div>
  );
}
