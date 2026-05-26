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

  return (
    <div style={{ padding: "0 18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
        {["general", "colores", "divisiones", "etapas", "logo"].map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} 
            style={{ padding: "8px 12px", borderRadius: 20, border: "none", background: activeTab === tab ? C.amber : C.surface, color: activeTab === tab ? "#000" : C.text, fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>
            {tab}
          </button>
        ))}
      </div>

      {/* Contenido */}
      <div style={{ background: C.surface, padding: 20, borderRadius: 16, border: `1px solid ${C.border}` }}>
        {activeTab === "general" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>Nombre de la empresa</label>
            <input value={config.nombre || ""} onChange={(e) => updateConfig("nombre", e.target.value)} style={{ padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg }} />
          </div>
        )}

        {activeTab === "colores" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>Color Primario</label>
            <input type="color" value={config.color_primario || "#F97316"} onChange={(e) => updateConfig("color_primario", e.target.value)} style={{ height: 50, width: "100%", border: "none", cursor: "pointer" }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>Color Secundario</label>
            <input type="color" value={config.color_secundario || "#8B5CF6"} onChange={(e) => updateConfig("color_secundario", e.target.value)} style={{ height: 50, width: "100%", border: "none", cursor: "pointer" }} />
          </div>
        )}

        {activeTab === "logo" && (
          <div style={{ textAlign: "center", padding: 20 }}>
            {config.logo_url ? <img src={config.logo_url} style={{ width: 100, marginBottom: 10 }} /> : <div style={{ marginBottom: 10 }}>Sin logo</div>}
            <p style={{ fontSize: 12, color: C.dim }}>La subida de logo se gestiona desde el componente de carga (asegurate de tener el endpoint `/api/upload-logo` configurado).</p>
          </div>
        )}

        {activeTab !== "general" && activeTab !== "colores" && activeTab !== "logo" && (
          <div style={{ color: C.dim }}>Para gestionar {activeTab}, asegurate de tener las tablas `divisiones` y `etapas` configuradas en Supabase.</div>
        )}
      </div>
    </div>
  );
}