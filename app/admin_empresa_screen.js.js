"use client";
import { useState, useEffect } from "react";
import { sb } from "./lib/supabase";
import { C } from "./lib/theme";

export default function AdminEmpresaScreen({ empresa, empresaId, onUpdate }) {
  const [config, setConfig] = useState(empresa || {});
  const [activeTab, setActiveTab] = useState("general");
  const [divisiones, setDivisiones] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [loading, setLoading] = useState(false);

  // Sincronizar estado cuando carga la empresa
  useEffect(() => { setConfig(empresa || {}); }, [empresa]);

  // Cargar datos al entrar en tabs de tablas
  useEffect(() => {
    if (activeTab === "divisiones") fetchItems("divisiones", setDivisiones);
    if (activeTab === "etapas") fetchItems("etapas", setEtapas);
  }, [activeTab]);

  const fetchItems = async (table, setter) => {
    const data = await sb.get(`${table}?empresa_id=eq.${empresaId}`);
    setter(data || []);
  };

  const updateConfig = async (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    await sb.patch(`empresa?id=eq.${empresaId}`, { [key]: value });
    onUpdate({ [key]: value });
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    const fileName = `${empresaId}/${Date.now()}-${file.name}`;
    const { data, error } = await sb.storage.from("logos").upload(fileName, file);
    if (error) { alert("Error al subir"); setLoading(false); return; }
    
    const { data: publicUrl } = sb.storage.from("logos").getPublicUrl(fileName);
    await updateConfig("logo_url", publicUrl.publicUrl);
    setLoading(false);
  };

  const addItem = async (table, setter, nombre) => {
    if (!nombre) return;
    await sb.post(table, { empresa_id: empresaId, nombre });
    fetchItems(table, setter);
  };

  return (
    <div style={{ padding: "0 18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
        {["general", "colores", "logo", "divisiones", "etapas"].map((t) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{ padding: "8px 12px", borderRadius: 20, border: "none", background: activeTab === t ? C.amber : C.surface, color: activeTab === t ? "#000" : C.text, fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>{t}</button>
        ))}
      </div>

      <div style={{ background: C.surface, padding: 20, borderRadius: 16, border: `1px solid ${C.border}` }}>
        {activeTab === "general" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>Nombre de la empresa</label>
            <input value={config.nombre || ""} onChange={(e) => setConfig({...config, nombre: e.target.value})} onBlur={(e) => updateConfig("nombre", e.target.value)} style={{ padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text }} />
          </div>
        )}

        {activeTab === "colores" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.dim }}>Color Primario</label>
            <input type="color" value={config.color_primario || "#F97316"} onChange={(e) => updateConfig("color_primario", e.target.value)} style={{ height: 50, width: "100%", border: "none" }} />
          </div>
        )}

        {activeTab === "logo" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {config.logo_url && <img src={config.logo_url} style={{ width: 100, height: 100, objectFit: "contain", background: "#fff", padding: 5, borderRadius: 8 }} />}
            <input type="file" onChange={handleLogoUpload} disabled={loading} />
            {loading && <p style={{ fontSize: 12 }}>Subiendo...</p>}
          </div>
        )}

        {(activeTab === "divisiones" || activeTab === "etapas") && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input id="inputItem" placeholder={`Nuevo ${activeTab}`} style={{ flex: 1, padding: 8, borderRadius: 8, border: `1px solid ${C.border}` }} />
              <button onClick={() => { const val = document.getElementById("inputItem").value; addItem(activeTab, activeTab === "divisiones" ? setDivisiones : setEtapas, val); document.getElementById("inputItem").value = ""; }} style={{ padding: "8px 16px", borderRadius: 8, background: C.amber, border: "none" }}>+</button>
            </div>
            {(activeTab === "divisiones" ? divisiones : etapas).map(item => (
              <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: 8, borderBottom: `1px solid ${C.border}` }}>
                {item.nombre}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}