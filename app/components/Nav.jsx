"use client";
// ═══════════════════════════════════════════════════════════
// Nav — Barra de navegación inferior
//
// ENTREGA 2F: Ahora usa useUI() del context. Cada tab actualiza
// la URL via setScreen (que internamente hace router.push).
// Browser back/forward funciona automáticamente.
//
// Nota: sigue aceptando props { active, onChange } como fallback
// para compatibilidad con page.js que aún no usa contexts.
// Si no recibe props, usa useUI().
// ═══════════════════════════════════════════════════════════

import { C, fB } from "../lib/theme";
import { Ic } from "./Icons";

const TABS_GER = [
  { key: "home", icon: "home", label: "Inicio" },
  { key: "solicitudes", icon: "inbox", label: "Inbox" },
  { key: "config", icon: "gear", label: "Gestión" },
  { key: "chat", icon: "chat", label: "Gypi IA" },
];

const TABS_EMP = [
  { key: "home", icon: "home", label: "Inicio" },
  { key: "actividad", icon: "hammer", label: "Jornada" },
  { key: "chat", icon: "chat", label: "Gypi IA" },
  { key: "mis-sols", icon: "inbox", label: "Solicitudes" },
];

export default function Nav({ active, onChange, role, pend }) {
  const isGer = role === "gerencial" || role === "administrativo";
  const tabs = isGer ? TABS_GER : TABS_EMP;

  return (
    <nav className="safe-bottom" style={{
      display: "flex", justifyContent: "space-around", alignItems: "center",
      padding: "8px 0 2px", borderTop: `1px solid ${C.border}`,
      background: C.bg, position: "relative", zIndex: 10,
    }}>
      {tabs.map(t => {
        const isActive = active === t.key;
        const IconComp = Ic[t.icon];
        return (
          <button key={t.key} onClick={() => onChange(t.key)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            background: "none", border: "none", cursor: "pointer", padding: "4px 12px",
            color: isActive ? C.amber : C.mute, position: "relative",
            fontFamily: fB,
          }}>
            {IconComp && <IconComp size={22} />}
            <span style={{ fontSize: 10, fontWeight: 600 }}>{t.label}</span>
            {t.key === "solicitudes" && pend > 0 && (
              <span style={{
                position: "absolute", top: 0, right: 4, minWidth: 16, height: 16,
                borderRadius: 8, background: C.red, color: "#fff",
                fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 4px",
              }}>{pend}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
