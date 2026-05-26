"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { sb } from "./lib/supabase";
import { C, fH, fB, fM } from "./lib/theme";
import { Tag } from "./components/ui";

/* ═══════════════════════════════════════════════════════════
   AdminEmpresaScreen — Fase 5.3 / 5.4 COMPLETA
   Tabs: General, Colores, Logo, Divisiones, Etapas
   ═══════════════════════════════════════════════════════════ */

const TABS = [
  { id: "general", label: "🏢 General" },
  { id: "colores", label: "🎨 Colores" },
  { id: "logo", label: "🖼️ Logo" },
  { id: "divisiones", label: "🏭 Divisiones" },
  { id: "etapas", label: "📋 Etapas" },
];

export default function AdminEmpresaScreen({ empresa, empresaId, onUpdate }) {
  const eid = empresaId || empresa?.id;
  const [config, setConfig] = useState(empresa || {});
  const [activeTab, setActiveTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Divisiones y Etapas
  const [divisiones, setDivisiones] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Form para nuevas divisiones/etapas
  const [newDiv, setNewDiv] = useState({ clave: "", label: "", icon: "📦", color: "#F97316" });
  const [newEtapa, setNewEtapa] = useState({ codigo: "", nombre: "", icon: "🔨", color: "#F97316" });

  // Edición inline
  const [editingDiv, setEditingDiv] = useState(null);
  const [editingEtapa, setEditingEtapa] = useState(null);

  // Logo upload
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const showToast = (msg, color = C.green) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Sincronizar config local cuando cambia empresa prop ──
  useEffect(() => {
    if (empresa) setConfig(empresa);
  }, [empresa]);

  // ── Cargar divisiones y etapas ──
  const loadDivEtapas = useCallback(async () => {
    if (!eid) return;
    setLoadingConfig(true);
    try {
      const res = await fetch(`/api/config-empresa?empresa_id=${eid}`);
      const data = await res.json();
      if (data.divisiones) setDivisiones(data.divisiones);
      if (data.etapas) setEtapas(data.etapas);
    } catch (e) {
      console.error("Error cargando config:", e);
    }
    setLoadingConfig(false);
  }, [eid]);

  useEffect(() => { loadDivEtapas(); }, [loadDivEtapas]);

  // ═══ GUARDAR CAMPO DE EMPRESA ═══
  const updateField = async (key, value) => {
    if (!eid) return;
    setSaving(true);
    try {
      await sb.patch(`empresa?id=eq.${eid}`, { [key]: value });
      const updated = { ...config, [key]: value };
      setConfig(updated);
      if (onUpdate) onUpdate({ [key]: value });
      showToast(`✅ "${key}" guardado`);
    } catch (e) {
      showToast(`Error: ${e.message}`, C.red);
    }
    setSaving(false);
  };

  // ═══ DIVISIONES CRUD ═══
  const addDivision = async () => {
    if (!newDiv.clave.trim() || !newDiv.label.trim()) {
      showToast("Completá clave y nombre", C.amber);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/config-empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_division",
          empresa_id: eid,
          clave: newDiv.clave.toLowerCase().replace(/\s+/g, "_"),
          label: newDiv.label,
          icon: newDiv.icon || "📦",
          color: newDiv.color || "#F97316",
          orden: divisiones.length + 1,
        }),
      });
      const data = await res.json();
      if (data.division) {
        setDivisiones(prev => [...prev, data.division]);
        setNewDiv({ clave: "", label: "", icon: "📦", color: "#F97316" });
        showToast("✅ División creada");
      } else {
        showToast(data.error || "Error al crear", C.red);
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, C.red);
    }
    setSaving(false);
  };

  const updateDivision = async (div) => {
    setSaving(true);
    try {
      const res = await fetch("/api/config-empresa", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_division",
          id: div.id,
          label: div.label,
          icon: div.icon,
          color: div.color,
        }),
      });
      const data = await res.json();
      if (data.division) {
        setDivisiones(prev => prev.map(d => d.id === div.id ? data.division : d));
        setEditingDiv(null);
        showToast("✅ División actualizada");
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, C.red);
    }
    setSaving(false);
  };

  const deleteDivision = async (id) => {
    setSaving(true);
    try {
      await fetch(`/api/config-empresa?type=division&id=${id}`, { method: "DELETE" });
      setDivisiones(prev => prev.filter(d => d.id !== id));
      showToast("División eliminada", C.amber);
    } catch (e) {
      showToast(`Error: ${e.message}`, C.red);
    }
    setSaving(false);
  };

  // ═══ ETAPAS CRUD ═══
  const addEtapa = async () => {
    if (!newEtapa.codigo.toString().trim() || !newEtapa.nombre.trim()) {
      showToast("Completá código y nombre", C.amber);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/config-empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_etapa",
          empresa_id: eid,
          codigo: parseInt(newEtapa.codigo) || etapas.length,
          nombre: newEtapa.nombre,
          icon: newEtapa.icon || "🔨",
          color: newEtapa.color || "#F97316",
          orden: etapas.length + 1,
        }),
      });
      const data = await res.json();
      if (data.etapa) {
        setEtapas(prev => [...prev, data.etapa]);
        setNewEtapa({ codigo: "", nombre: "", icon: "🔨", color: "#F97316" });
        showToast("✅ Etapa creada");
      } else {
        showToast(data.error || "Error al crear", C.red);
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, C.red);
    }
    setSaving(false);
  };

  const updateEtapa = async (etapa) => {
    setSaving(true);
    try {
      const res = await fetch("/api/config-empresa", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_etapa",
          id: etapa.id,
          nombre: etapa.nombre,
          icon: etapa.icon,
          color: etapa.color,
          codigo: etapa.codigo,
        }),
      });
      const data = await res.json();
      if (data.etapa) {
        setEtapas(prev => prev.map(e => e.id === etapa.id ? data.etapa : e));
        setEditingEtapa(null);
        showToast("✅ Etapa actualizada");
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, C.red);
    }
    setSaving(false);
  };

  const deleteEtapa = async (id) => {
    setSaving(true);
    try {
      await fetch(`/api/config-empresa?type=etapa&id=${id}`, { method: "DELETE" });
      setEtapas(prev => prev.filter(e => e.id !== id));
      showToast("Etapa eliminada", C.amber);
    } catch (e) {
      showToast(`Error: ${e.message}`, C.red);
    }
    setSaving(false);
  };

  // ═══ LOGO UPLOAD ═══
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("empresa_id", eid);

      const res = await fetch("/api/upload-logo", { method: "POST", body: formData });
      const data = await res.json();
      if (data.logo_url) {
        setConfig(prev => ({ ...prev, logo_url: data.logo_url }));
        if (onUpdate) onUpdate({ logo_url: data.logo_url });
        showToast("✅ Logo actualizado");
      } else {
        showToast(data.error || "Error subiendo logo", C.red);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, C.red);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  // ═══ ESTILOS HELPERS ═══
  const inputStyle = {
    width: "100%", padding: "11px 14px", borderRadius: 10,
    background: C.surface, border: `1px solid ${C.border}`,
    color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box",
  };
  const labelStyle = {
    display: "block", fontSize: 11, fontWeight: 700, color: C.dim,
    textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
  };
  const cardStyle = {
    background: C.surface, borderRadius: 16, padding: 18,
    border: `1px solid ${C.border}`, marginBottom: 14,
  };

  // ═══ RENDER ═══
  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px", position: "relative" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 999,
          padding: "12px 20px", borderRadius: 12, background: C.bg,
          border: `1px solid ${toast.color}40`, boxShadow: `0 8px 32px ${toast.color}20`,
          fontSize: 13, fontWeight: 600, color: toast.color, maxWidth: "90%",
        }}>{toast.msg}</div>
      )}

      {/* Saving indicator */}
      {saving && (
        <div style={{
          position: "fixed", top: 10, right: 10, zIndex: 999,
          background: `${C.amber}22`, border: `1px solid ${C.amber}40`,
          padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, color: C.amber,
        }}>Guardando...</div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 14, marginBottom: 4 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: "8px 14px", borderRadius: 20, border: "none", cursor: "pointer",
            background: activeTab === t.id ? `${C.amber}22` : C.surface,
            color: activeTab === t.id ? C.amber : C.dim,
            fontSize: 11, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ═══ TAB: GENERAL ═══ */}
      {activeTab === "general" && (
        <div style={cardStyle}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Nombre de la empresa</label>
            <input
              value={config.nombre || ""}
              onChange={e => setConfig(prev => ({ ...prev, nombre: e.target.value }))}
              onBlur={e => e.target.value !== empresa?.nombre && updateField("nombre", e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Nombre corto (se muestra en la app)</label>
            <input
              value={config.nombre_corto || ""}
              onChange={e => setConfig(prev => ({ ...prev, nombre_corto: e.target.value }))}
              onBlur={e => e.target.value !== empresa?.nombre_corto && updateField("nombre_corto", e.target.value)}
              style={inputStyle}
              maxLength={12}
            />
            <div style={{ fontSize: 10, color: C.mute, marginTop: 4 }}>{(config.nombre_corto || "").length}/12 caracteres</div>
          </div>
          <div>
            <label style={labelStyle}>Rubro</label>
            <select
              value={config.rubro || "general"}
              onChange={e => { setConfig(prev => ({ ...prev, rubro: e.target.value })); updateField("rubro", e.target.value); }}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              {["general", "construccion", "industria", "servicios", "comercio", "tecnologia"].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* ═══ TAB: COLORES ═══ */}
      {activeTab === "colores" && (
        <div style={cardStyle}>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Color primario</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="color"
                value={config.color_primario || "#F97316"}
                onChange={e => setConfig(prev => ({ ...prev, color_primario: e.target.value }))}
                onBlur={e => updateField("color_primario", e.target.value)}
                style={{ width: 60, height: 48, border: `2px solid ${C.border}`, borderRadius: 12, cursor: "pointer", background: "transparent" }}
              />
              <div style={{ flex: 1, height: 48, borderRadius: 12, background: config.color_primario || "#F97316", display: "flex", alignItems: "center", justifyContent: "center", color: "#000", fontSize: 12, fontWeight: 700, fontFamily: fM }}>{config.color_primario || "#F97316"}</div>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Color secundario</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="color"
                value={config.color_secundario || "#8B5CF6"}
                onChange={e => setConfig(prev => ({ ...prev, color_secundario: e.target.value }))}
                onBlur={e => updateField("color_secundario", e.target.value)}
                style={{ width: 60, height: 48, border: `2px solid ${C.border}`, borderRadius: 12, cursor: "pointer", background: "transparent" }}
              />
              <div style={{ flex: 1, height: 48, borderRadius: 12, background: config.color_secundario || "#8B5CF6", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: fM }}>{config.color_secundario || "#8B5CF6"}</div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: LOGO ═══ */}
      {activeTab === "logo" && (
        <div style={cardStyle}>
          <label style={labelStyle}>Logo de la empresa</label>
          {config.logo_url ? (
            <div style={{ marginBottom: 16, textAlign: "center" }}>
              <img
                src={config.logo_url}
                alt="Logo"
                style={{ maxWidth: 180, maxHeight: 180, borderRadius: 16, border: `1px solid ${C.border}`, objectFit: "contain", background: C.bg }}
              />
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: "center", background: C.surfHi, borderRadius: 14, border: `2px dashed ${C.border}`, marginBottom: 16 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🖼️</div>
              <div style={{ fontSize: 13, color: C.dim }}>Sin logo cargado</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={handleLogoUpload} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              width: "100%", padding: 14, borderRadius: 12, border: "none",
              background: uploading ? C.surface : `${C.amber}22`,
              color: uploading ? C.dim : C.amber,
              fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: uploading ? "default" : "pointer",
            }}
          >{uploading ? "⏳ Subiendo..." : config.logo_url ? "🔄 Cambiar logo" : "📤 Subir logo"}</button>
          <div style={{ fontSize: 10, color: C.mute, marginTop: 8, textAlign: "center" }}>PNG, JPG, WebP o SVG · Máx 2MB</div>
        </div>
      )}

      {/* ═══ TAB: DIVISIONES ═══ */}
      {activeTab === "divisiones" && (
        <>
          {loadingConfig ? (
            <div style={{ textAlign: "center", padding: 40, color: C.dim }}>Cargando divisiones...</div>
          ) : (
            <>
              {/* Lista de divisiones existentes */}
              {divisiones.length === 0 ? (
                <div style={{ ...cardStyle, textAlign: "center", padding: 40 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🏭</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Sin divisiones</div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>Creá la primera debajo</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {divisiones.map(div => (
                    <div key={div.id} style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${div.color || C.amber}30` }}>
                      {editingDiv === div.id ? (
                        /* Modo edición */
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input value={div.icon} onChange={e => setDivisiones(prev => prev.map(d => d.id === div.id ? { ...d, icon: e.target.value } : d))} style={{ ...inputStyle, width: 50, textAlign: "center", fontSize: 20, padding: "6px" }} maxLength={4} />
                            <input value={div.label} onChange={e => setDivisiones(prev => prev.map(d => d.id === div.id ? { ...d, label: e.target.value } : d))} style={{ ...inputStyle, flex: 1 }} placeholder="Nombre" />
                            <input type="color" value={div.color || "#F97316"} onChange={e => setDivisiones(prev => prev.map(d => d.id === div.id ? { ...d, color: e.target.value } : d))} style={{ width: 44, height: 44, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", background: "transparent" }} />
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => setEditingDiv(null)} style={{ flex: 1, padding: 8, borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
                            <button onClick={() => updateDivision(div)} style={{ flex: 1, padding: 8, borderRadius: 8, border: "none", background: C.green, color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Guardar</button>
                          </div>
                        </div>
                      ) : (
                        /* Modo vista */
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 10, background: `${div.color || C.amber}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{div.icon || "📦"}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{div.label}</div>
                            <div style={{ fontSize: 11, color: C.dim, fontFamily: fM }}>{div.clave}</div>
                          </div>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => setEditingDiv(div.id)} style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: `${C.cyan}18`, color: C.cyan, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>✏️</button>
                            <button onClick={() => deleteDivision(div.id)} style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: `${C.red}18`, color: C.red, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Formulario nueva división */}
              <div style={{ ...cardStyle, border: `1px dashed ${C.amber}40` }}>
                <div style={{ ...labelStyle, color: C.amber, marginBottom: 12 }}>➕ Nueva división</div>
                <div style={{ display: "grid", gridTemplateColumns: "50px 1fr 44px", gap: 8, marginBottom: 10 }}>
                  <input value={newDiv.icon} onChange={e => setNewDiv(p => ({ ...p, icon: e.target.value }))} style={{ ...inputStyle, textAlign: "center", fontSize: 20, padding: "6px" }} maxLength={4} placeholder="📦" />
                  <input value={newDiv.label} onChange={e => setNewDiv(p => ({ ...p, label: e.target.value }))} style={inputStyle} placeholder="Nombre (ej: Herrería)" />
                  <input type="color" value={newDiv.color} onChange={e => setNewDiv(p => ({ ...p, color: e.target.value }))} style={{ width: 44, height: 44, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", background: "transparent" }} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <input value={newDiv.clave} onChange={e => setNewDiv(p => ({ ...p, clave: e.target.value }))} style={inputStyle} placeholder="Clave interna (ej: herreria)" />
                  <div style={{ fontSize: 10, color: C.mute, marginTop: 4 }}>Identificador único, sin espacios ni acentos</div>
                </div>
                <button onClick={addDivision} disabled={saving || !newDiv.clave.trim() || !newDiv.label.trim()} style={{
                  width: "100%", padding: 12, borderRadius: 12, border: "none",
                  background: newDiv.clave.trim() && newDiv.label.trim() ? C.green : C.surface,
                  color: newDiv.clave.trim() && newDiv.label.trim() ? "#000" : C.mute,
                  fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: newDiv.clave.trim() && newDiv.label.trim() ? "pointer" : "default",
                }}>Crear división</button>
              </div>
            </>
          )}
        </>
      )}

      {/* ═══ TAB: ETAPAS ═══ */}
      {activeTab === "etapas" && (
        <>
          {loadingConfig ? (
            <div style={{ textAlign: "center", padding: 40, color: C.dim }}>Cargando etapas...</div>
          ) : (
            <>
              {/* Lista de etapas existentes */}
              {etapas.length === 0 ? (
                <div style={{ ...cardStyle, textAlign: "center", padding: 40 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Sin etapas</div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>Creá la primera debajo</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {etapas.map(et => (
                    <div key={et.id} style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${et.color || C.amber}30` }}>
                      {editingEtapa === et.id ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input value={et.icon} onChange={e => setEtapas(prev => prev.map(x => x.id === et.id ? { ...x, icon: e.target.value } : x))} style={{ ...inputStyle, width: 50, textAlign: "center", fontSize: 20, padding: "6px" }} maxLength={4} />
                            <input value={et.nombre} onChange={e => setEtapas(prev => prev.map(x => x.id === et.id ? { ...x, nombre: e.target.value } : x))} style={{ ...inputStyle, flex: 1 }} placeholder="Nombre" />
                            <input type="color" value={et.color || "#F97316"} onChange={e => setEtapas(prev => prev.map(x => x.id === et.id ? { ...x, color: e.target.value } : x))} style={{ width: 44, height: 44, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", background: "transparent" }} />
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => setEditingEtapa(null)} style={{ flex: 1, padding: 8, borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
                            <button onClick={() => updateEtapa(et)} style={{ flex: 1, padding: 8, borderRadius: 8, border: "none", background: C.green, color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Guardar</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 10, background: `${et.color || C.amber}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{et.icon || "🔨"}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{et.nombre}</div>
                            <div style={{ fontSize: 11, color: C.dim, fontFamily: fM }}>Código: {et.codigo}</div>
                          </div>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => setEditingEtapa(et.id)} style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: `${C.cyan}18`, color: C.cyan, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>✏️</button>
                            <button onClick={() => deleteEtapa(et.id)} style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: `${C.red}18`, color: C.red, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Formulario nueva etapa */}
              <div style={{ ...cardStyle, border: `1px dashed ${C.amber}40` }}>
                <div style={{ ...labelStyle, color: C.amber, marginBottom: 12 }}>➕ Nueva etapa</div>
                <div style={{ display: "grid", gridTemplateColumns: "50px 60px 1fr 44px", gap: 8, marginBottom: 12 }}>
                  <input value={newEtapa.icon} onChange={e => setNewEtapa(p => ({ ...p, icon: e.target.value }))} style={{ ...inputStyle, textAlign: "center", fontSize: 20, padding: "6px" }} maxLength={4} placeholder="🔨" />
                  <input value={newEtapa.codigo} onChange={e => setNewEtapa(p => ({ ...p, codigo: e.target.value }))} inputMode="numeric" style={{ ...inputStyle, textAlign: "center" }} placeholder="Cód" />
                  <input value={newEtapa.nombre} onChange={e => setNewEtapa(p => ({ ...p, nombre: e.target.value }))} style={inputStyle} placeholder="Nombre (ej: Soldadura)" />
                  <input type="color" value={newEtapa.color} onChange={e => setNewEtapa(p => ({ ...p, color: e.target.value }))} style={{ width: 44, height: 44, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", background: "transparent" }} />
                </div>
                <button onClick={addEtapa} disabled={saving || !newEtapa.nombre.trim()} style={{
                  width: "100%", padding: 12, borderRadius: 12, border: "none",
                  background: newEtapa.nombre.trim() ? C.green : C.surface,
                  color: newEtapa.nombre.trim() ? "#000" : C.mute,
                  fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: newEtapa.nombre.trim() ? "pointer" : "default",
                }}>Crear etapa</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
