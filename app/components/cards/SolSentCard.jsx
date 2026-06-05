// Extraído de [slug]/page.js línea 193
import { C } from "../../lib/theme";
import { Ic } from "../Icons";
import { Tag } from "../ui";

export default function SolSentCard({ motivo, fecha }) {
  return (
    <div style={{ marginTop: 8, padding: 14, background: C.amberS, borderRadius: 14, border: `1px solid ${C.amber}30`, minWidth: 220 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, letterSpacing: "0.06em" }}>ENVIADA A GERENCIA</div>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginTop: 4 }}>{motivo}</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>📅 {fecha} · ⏳ Esperando</div>
        </div>
        <Tag color={C.amber}><Ic.clock size={10} /> PENDIENTE</Tag>
      </div>
    </div>
  );
}
