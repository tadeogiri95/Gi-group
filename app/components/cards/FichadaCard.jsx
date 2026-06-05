// Extraído de [slug]/page.js líneas 153-192
import { C, fH } from "../../lib/theme";
import { Ic } from "../Icons";

export default function FichadaCard({ tipo, hora, geoMsg, tardanza }) {
  const isIn = tipo === "ingreso";
  const color = tardanza?.estado === "bloqueado" ? C.red : tardanza?.estado === "tarde" ? "#F59E0B" : C.green;
  const label = isIn ? "FICHASTE INGRESO" : "FICHASTE EGRESO";
  const extraMsg = tardanza?.estado === "tarde" ? `⚠️ ${tardanza.minutos} min tarde (${tardanza.llegadasTarde}° del mes)` : tardanza?.estado === "bloqueado" ? `⛔ Bloqueado: ${tardanza.minutos} min tarde` : null;

  return (
    <div style={{ padding: 14, background: `${color}12`, borderRadius: 14, border: `1px solid ${color}30`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, animation: "fadeIn 0.3s ease" }}>
      <div>
        <div style={{ fontSize: 11, color, fontWeight: 700, letterSpacing: "0.06em" }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.text, fontFamily: fH, marginTop: 4 }}>{hora}</div>
        {extraMsg && <div style={{ fontSize: 12, color, fontWeight: 600, marginTop: 4 }}>{extraMsg}</div>}
        {geoMsg && <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{geoMsg}</div>}
      </div>
      {(!tardanza || tardanza.estado === "puntual") && <span style={{ color: C.green }}><Ic.check size={20} /></span>}
      {tardanza?.estado === "bloqueado" && <span style={{ color: C.red, fontSize: 24 }}>⛔</span>}
      {tardanza?.estado === "tarde" && <span style={{ color: "#F59E0B", fontSize: 24 }}>⚠️</span>}
    </div>
  );
}
