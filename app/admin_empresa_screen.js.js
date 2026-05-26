"use client";
import { useState } from "react";
import { sb } from "./lib/supabase";
import { C } from "./lib/theme";

export default function AdminEmpresaScreen({ empresa, empresaId, onUpdate }) {
  const [config, setConfig] = useState(empresa);
  const [activeTab, setActiveTab] = useState("general");

  const updateConfig = async (key, value) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    await sb.patch(`empresa?id=eq.${empresaId}`, { [key]: value });
    onUpdate({ [key]: value });
  };

  const tabs = [
    { id: "general", label: "⚙️ General" },
    { id: "colores", label: "🎨 Colores" },
    { id: "divisiones", label: "🏭 Divisiones" },
    { id: "etapas", label: "🔨 Etapas" },
    { id: "logo", label: "📷 Logo" },
    { id: "ia", label: "🤖 IA" },
    { id: "plan", label: "💳 Plan" },
  ];

  return (
    <div style={{ padding: "0 18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: "8px 12px",
              borderRadius: 20,
              border: "none",
              background: activeTab === t.id ? C.amber : C.surface,
              color: activeTab === t.id ? "#000" : C.text,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap"
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ background: C.surface, padding: 20, borderRadius: 16, border: `1px solid ${C.border}` }}>
        {activeTab === "general" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>Nombre de la empresa</label>
            <input 
              value={config.nombre || ""} 
              onChange={(e) => updateConfig("nombre", e.target.value)}
              style={{ padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg }}
            />
          </div>
        )}
        <div style={{ fontSize: 14, color: C.dim }}>Tab activo: {activeTab}</div>
      </div>
    </div>
  );
}