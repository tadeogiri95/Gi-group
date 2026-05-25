// ═══════════════════════════════════════════════════════════
// Componentes UI compartidos — Tag y Chip
// Ubicación: app/components/ui.jsx
// ═══════════════════════════════════════════════════════════

import { C, fB } from "../lib/theme";

export const Tag = ({ color = C.amber, children, style = {} }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: `${color}22`, color, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: fB, ...style }}>{children}</span>
);

export const Chip = ({ active, onClick, children, color = C.amber }) => (
  <button onClick={onClick} style={{
    padding: "7px 12px", borderRadius: 20, border: "none", cursor: "pointer",
    background: active ? `${color}22` : C.surface,
    color: active ? color : C.dim,
    fontSize: 11, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap",
    transition: "all 0.15s",
  }}>{children}</button>
);
