"use client";
import { useState } from "react";
import { sb } from "./lib/supabase";
import { C } from "./lib/theme";

export default function AdminEmpresaScreen({ empresa, empresaId, onUpdate }) {
  const [config, setConfig] = useState(empresa || {});
  const [activeTab, setActiveTab] = useState("general");
  const [saving, setSaving] = useState(false);

  const updateConfig = async (key, value) => {
    setSaving(true);
    try {
      // 1. Guardamos en la base de datos
      const { error } = await sb.patch(`empresa?id=eq.${empresaId}`, { [key]: value });
      
      if (error) {
        console.error("Error al guardar:", error);
        alert("Error al guardar: " + error.message);
      } else {
        // 2. Actualizamos el estado local
        setConfig(prev => ({ ...prev, [key]: value }));
        onUpdate({ [key]: value });
      }
    } catch (e) {
      alert("Error de red: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: "0 18px 20px" }}>
      {/* Indicador de guardado */}
      {saving && <div style={{ position: "fixed", top: 10, right: 10, background: C.amber, padding: "5px 10px", borderRadius: 8, fontSize: 12 }}>Guardando...</div>}
      
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 16 }}>
        {["general", "colores"].map((t) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{ padding: "8px 16px", borderRadius: 20, border: "none", background: activeTab === t ? C.amber : C.surface, color: activeTab === t ? "#000" : C.text, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{t}</button>
        ))}
      </div>

      <div style={{ background: C.surface, padding: 20, borderRadius: 16 }}>
        {activeTab === "general" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>Nombre de la empresa</label>
            <input value={config.nombre || ""} onChange={(e) => setConfig({...config, nombre: e.target.value})} onBlur={(e) => updateConfig("nombre", e.target.value)} style={{ padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg }} />
          </div>
        )}
        {activeTab === "colores" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>Color Primario</label>
            <input type="color" value={config.color_primario || "#F97316"} onChange={(e) => updateConfig("color_primario", e.target.value)} style={{ width: "100%", height: 50, border: "none" }} />
          </div>
        )}
      </div>
    </div>
  );
}