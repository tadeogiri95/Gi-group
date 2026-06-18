"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, THEME_PRESETS, FONT_OPTIONS, setColoresEmpresa } from "./lib/theme";
import { getToken, apiFetch } from "./lib/supabase";
import { useToast } from "./components/ui/Toast";

/* ─── Icon list for selectors ─── */
const ICON_OPTIONS = [
  "📁", "📂", "🏢", "🏗️", "🏭", "🔧", "⚙️", "🛠️", "📊", "📈",
  "💼", "🎯", "🚀", "💡", "🔑", "📋", "📝", "✅", "⭐", "🔔",
];

/* ─── Tabs ─── */
const TABS = [
  { key: "general", label: "General" },
  { key: "apariencia", label: "Apariencia" },
  { key: "logo", label: "Logo" },
  { key: "divisiones", label: "Divisiones" },
  { key: "etapas", label: "Etapas" },
];

/* ─── Hex validation ─── */
const isHex = (v) => v && /^#[0-9A-Fa-f]{6}$/.test(v);

/* ─── Color picker row ─── */
function ColorRow({ label, value, onChange }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${C.border}`, cursor: "pointer", background: "transparent", padding: 0 }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 14, fontFamily: "'Geist Mono', monospace", outline: "none" }}
        />
        <div style={{ width: 40, height: 40, borderRadius: 10, background: value, border: `1px solid ${C.border}`, flexShrink: 0 }} />
      </div>
    </div>
  );
}

export default function AdminEmpresaScreen({ empresa, empresaId, onUpdate, divisiones: divisionesProp = [], etapas: etapasProp = [] }) {
  const [tab, setTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // General
  const [nombre, setNombre] = useState(empresa?.nombre || "");
  const [nombreCorto, setNombreCorto] = useState(empresa?.nombre_corto || "");
  const [rubro, setRubro] = useState(empresa?.rubro || "");

  // Apariencia
  const [themePreset, setThemePreset] = useState(empresa?.theme_preset || "default");
  const [colorPrimario, setColorPrimario] = useState(empresa?.color_primario || "#F97316");
  const [colorSecundario, setColorSecundario] = useState(empresa?.color_secundario || "#7C3AED");
  const [colorFondo, setColorFondo] = useState(empresa?.color_fondo || "#F7F7F5");
  const [colorTexto, setColorTexto] = useState(empresa?.color_texto || "#1A1A1A");
  const [typography, setTypography] = useState(empresa?.typography || "system");
  const [customMode, setCustomMode] = useState(false);

  // Logo
  const [logoUrl, setLogoUrl] = useState(empresa?.logo_url || "");
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(empresa?.logo_url || "");
  const fileInputRef = useRef(null);

  // Divisiones
  const [divisiones, setDivisiones] = useState(divisionesProp);
  const [divForm, setDivForm] = useState({ icon: "📁", label: "", color: "#4f8cff", clave: "" });
  const [editDivId, setEditDivId] = useState(null);

  // Etapas
  const [etapas, setEtapas] = useState(etapasProp);
  const [etapaForm, setEtapaForm] = useState({ icon: "📋", codigo: 1, nombre: "", color: "#4f8cff" });
  const [editEtapaId, setEditEtapaId] = useState(null);

  const showToast = useCallback((msg, type = "success") => {
    if (type === "error") toast.error(msg);
    else toast.success(msg);
  }, [toast]);

  // Sync empresa fields from prop
  useEffect(() => {
    if (!empresa) return;
    setNombre(empresa.nombre || "");
    setNombreCorto(empresa.nombre_corto || "");
    setRubro(empresa.rubro || "");
    setColorPrimario(empresa.color_primario || "#F97316");
    setColorSecundario(empresa.color_secundario || "#7C3AED");
    setColorFondo(empresa.color_fondo || "#F7F7F5");
    setColorTexto(empresa.color_texto || "#1A1A1A");
    setTypography(empresa.typography || "system");
    setThemePreset(empresa.theme_preset || "default");
    setLogoUrl(empresa.logo_url || "");
    setLogoPreview(empresa.logo_url || "");
  }, [empresa]);

  // Sync divisiones/etapas from context props
  useEffect(() => { setDivisiones(divisionesProp); }, [divisionesProp]);
  useEffect(() => { setEtapas(etapasProp); }, [etapasProp]);

  // Aplicar preset al seleccionar
  const applyPreset = (key) => {
    const p = THEME_PRESETS[key];
    if (!p) return;
    setThemePreset(key);
    setColorPrimario(p.primary);
    setColorSecundario(p.secondary);
    setColorFondo(p.bg);
    setColorTexto(p.text);
    setCustomMode(false);
    // Preview en vivo
    setColoresEmpresa({ theme_preset: key, color_primario: p.primary, color_secundario: p.secondary, color_fondo: p.bg, color_texto: p.text, typography });
  };

  // Preview en vivo al cambiar color individual
  const previewColors = (overrides = {}) => {
    setColoresEmpresa({
      color_primario: overrides.color_primario ?? colorPrimario,
      color_secundario: overrides.color_secundario ?? colorSecundario,
      color_fondo: overrides.color_fondo ?? colorFondo,
      color_texto: overrides.color_texto ?? colorTexto,
      typography: overrides.typography ?? typography,
    });
  };

  // Logo
  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  // Save
  const handleSave = async () => {
    setSaving(true);
    try {
      const token = getToken();
      if (!token) throw new Error("Sin sesión");

      const body = {};
      if (tab === "general") {
        Object.assign(body, { nombre, nombre_corto: nombreCorto, rubro });
      } else if (tab === "apariencia") {
        Object.assign(body, {
          color_primario: colorPrimario,
          color_secundario: colorSecundario,
          color_fondo: colorFondo,
          color_texto: colorTexto,
          typography,
          theme_preset: customMode ? "custom" : themePreset,
        });
      }

      // Logo upload: ruta correcta + campo "file"
      if (tab === "logo" && logoFile) {
        const formData = new FormData();
        formData.append("file", logoFile);
        const lr = await fetch("/api/upload-logo", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (!lr.ok) {
          const e = await lr.json().catch(() => ({}));
          throw new Error(e.error || "Error subiendo logo");
        }
        const ld = await lr.json();
        const newLogoUrl = ld.logo_url || ld.url;
        setLogoUrl(newLogoUrl);
        setLogoPreview(newLogoUrl);
        setLogoFile(null);
        onUpdate?.({ logo_url: newLogoUrl });
        showToast("Logo guardado");
        return;
      }

      if (Object.keys(body).length > 0) {
        const r = await fetch("/api/empresa", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error || "Error guardando");
        }
        const updated = await r.json();
        onUpdate?.(updated);
      }

      showToast("Guardado correctamente");
    } catch (err) {
      showToast(err.message || "Error al guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  // Division CRUD
  const handleAddDivision = async () => {
    if (!divForm.label.trim()) return showToast("El nombre es requerido", "error");
    if (!divForm.clave.trim()) return showToast("La clave es requerida", "error");
    const token = getToken();
    if (!token) return showToast("Sin sesión", "error");
    try {
      if (editDivId !== null) {
        const r = await fetch("/api/config-empresa", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "update_division", id: editDivId, ...divForm }),
        });
        if (!r.ok) throw new Error((await r.json()).error || "Error actualizando");
        const { division } = await r.json();
        setDivisiones((prev) => prev.map((d) => (d.id === editDivId ? division : d)));
        setEditDivId(null);
        showToast("División actualizada");
      } else {
        const r = await fetch("/api/config-empresa", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "add_division", ...divForm }),
        });
        if (!r.ok) throw new Error((await r.json()).error || "Error agregando");
        const { division } = await r.json();
        setDivisiones((prev) => [...prev, division]);
        showToast("División agregada");
      }
      setDivForm({ icon: "📁", label: "", color: "#4f8cff", clave: "" });
      onUpdate?.({});
    } catch (err) {
      showToast(err.message || "Error al guardar", "error");
    }
  };

  const handleEditDivision = (div) => {
    setDivForm({ icon: div.icon, label: div.label, color: div.color, clave: div.clave });
    setEditDivId(div.id);
  };

  const handleDeleteDivision = async (id) => {
    const token = getToken();
    if (!token) return showToast("Sin sesión", "error");
    try {
      const r = await fetch(`/api/config-empresa?type=division&id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error((await r.json()).error || "Error eliminando");
      setDivisiones((prev) => prev.filter((d) => d.id !== id));
      if (editDivId === id) { setEditDivId(null); setDivForm({ icon: "📁", label: "", color: "#4f8cff", clave: "" }); }
      showToast("División eliminada");
      onUpdate?.({});
    } catch (err) {
      showToast(err.message || "Error al eliminar", "error");
    }
  };

  // Etapa CRUD
  const handleAddEtapa = async () => {
    if (!etapaForm.nombre.trim()) return showToast("El nombre es requerido", "error");
    if (!etapaForm.codigo || etapaForm.codigo < 1) return showToast("El código debe ser un número positivo", "error");
    const token = getToken();
    if (!token) return showToast("Sin sesión", "error");
    try {
      if (editEtapaId !== null) {
        const r = await fetch("/api/config-empresa", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "update_etapa", id: editEtapaId, ...etapaForm }),
        });
        if (!r.ok) throw new Error((await r.json()).error || "Error actualizando");
        const { etapa } = await r.json();
        setEtapas((prev) => prev.map((e) => (e.id === editEtapaId ? etapa : e)));
        setEditEtapaId(null);
        showToast("Etapa actualizada");
      } else {
        const r = await fetch("/api/config-empresa", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "add_etapa", ...etapaForm }),
        });
        if (!r.ok) throw new Error((await r.json()).error || "Error agregando");
        const { etapa } = await r.json();
        setEtapas((prev) => [...prev, etapa]);
        showToast("Etapa agregada");
      }
      setEtapaForm({ icon: "📋", codigo: 1, nombre: "", color: "#4f8cff" });
      onUpdate?.({});
    } catch (err) {
      showToast(err.message || "Error al guardar", "error");
    }
  };

  const handleEditEtapa = (etapa) => {
    setEtapaForm({ icon: etapa.icon, codigo: etapa.codigo, nombre: etapa.nombre, color: etapa.color });
    setEditEtapaId(etapa.id);
  };

  const handleDeleteEtapa = async (id) => {
    const token = getToken();
    if (!token) return showToast("Sin sesión", "error");
    try {
      const r = await fetch(`/api/config-empresa?type=etapa&id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error((await r.json()).error || "Error eliminando");
      setEtapas((prev) => prev.filter((e) => e.id !== id));
      if (editEtapaId === id) { setEditEtapaId(null); setEtapaForm({ icon: "📋", codigo: 1, nombre: "", color: "#4f8cff" }); }
      showToast("Etapa eliminada");
      onUpdate?.({});
    } catch (err) {
      showToast(err.message || "Error al eliminar", "error");
    }
  };

  // ═══ Styles ═══
  const card = { background: C.surface, borderRadius: 16, padding: 18, border: `1px solid ${C.border}`, marginBottom: 14 };
  const lbl = { fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 };
  const inp = { width: "100%", padding: "11px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box" };
  const btnPrimary = { width: "100%", padding: "14px 0", borderRadius: 12, border: "none", background: C.amber, color: C.amberText, fontSize: 14, fontWeight: 700, cursor: "pointer" };

  // ═══ Tab content ═══
  const renderTab = () => {
    switch (tab) {

      // ── GENERAL ──
      case "general":
        return <>
          <div style={card}>
            <div style={lbl}>Nombre de la empresa</div>
            <input style={inp} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Mi Empresa S.A." />
          </div>
          <div style={card}>
            <div style={lbl}>Nombre corto</div>
            <input style={inp} value={nombreCorto} onChange={(e) => setNombreCorto(e.target.value)} placeholder="Ej: MIEMPRESA" />
          </div>
          <div style={card}>
            <div style={lbl}>Rubro</div>
            <input style={inp} value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Ej: Tecnología, Construcción..." />
          </div>
          <button style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }} onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</button>
        </>;

      // ── APARIENCIA ──
      case "apariencia":
        return <>
          {/* Temas preestablecidos */}
          <div style={card}>
            <div style={lbl}>Temas preestablecidos</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {Object.entries(THEME_PRESETS).map(([key, p]) => {
                const sel = !customMode && themePreset === key;
                return (
                  <button
                    key={key}
                    onClick={() => applyPreset(key)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 12,
                      border: sel ? `2px solid ${p.primary}` : `1px solid rgba(128,128,128,0.2)`,
                      background: p.bg, cursor: "pointer", transition: "all 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", gap: 4 }}>
                      <div style={{ width: 14, height: 14, borderRadius: 4, background: p.primary }} />
                      <div style={{ width: 14, height: 14, borderRadius: 4, background: p.secondary }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: p.text }}>{p.label}</span>
                    {sel && <span style={{ marginLeft: "auto", fontSize: 14, color: p.primary, fontWeight: 700 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Modo personalizado toggle */}
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Personalización individual</div>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>Ajustar cada color por separado</div>
              </div>
              <button
                onClick={() => setCustomMode(!customMode)}
                aria-pressed={customMode}
                aria-label="Personalización individual de colores"
                style={{
                  width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
                  background: customMode ? C.green : C.surfHi, transition: "background 0.2s",
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 11, background: "#fff",
                  position: "absolute", top: 3, left: customMode ? 23 : 3, transition: "left 0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }} />
              </button>
            </div>
          </div>

          {/* Colores individuales */}
          {customMode && (
            <div style={card}>
              <ColorRow label="Color primario (botones, acentos)" value={colorPrimario} onChange={(v) => { setColorPrimario(v); if (isHex(v)) previewColors({ color_primario: v }); }} />
              <ColorRow label="Color secundario (etiquetas, complementos)" value={colorSecundario} onChange={(v) => { setColorSecundario(v); if (isHex(v)) previewColors({ color_secundario: v }); }} />
              <ColorRow label="Color de fondo" value={colorFondo} onChange={(v) => { setColorFondo(v); if (isHex(v)) previewColors({ color_fondo: v }); }} />
              <ColorRow label="Color de texto" value={colorTexto} onChange={(v) => { setColorTexto(v); if (isHex(v)) previewColors({ color_texto: v }); }} />
            </div>
          )}

          {/* Preview miniatura */}
          <div style={card}>
            <div style={lbl}>Vista previa</div>
            <div style={{
              background: colorFondo, borderRadius: 12, padding: 16, border: `1px solid rgba(128,128,128,0.15)`,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: colorTexto, marginBottom: 8, fontFamily: FONT_OPTIONS[typography]?.heading || "system-ui" }}>
                {nombreCorto || "Mi Empresa"}
              </div>
              <div style={{ fontSize: 12, color: colorTexto, opacity: 0.6, marginBottom: 12, fontFamily: FONT_OPTIONS[typography]?.body || "system-ui" }}>
                Texto de ejemplo para ver la tipografía
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ padding: "8px 16px", borderRadius: 8, background: colorPrimario, color: C.amberText, fontSize: 12, fontWeight: 700 }}>
                  Primario
                </div>
                <div style={{ padding: "8px 16px", borderRadius: 8, background: colorSecundario, color: "#fff", fontSize: 12, fontWeight: 700 }}>
                  Secundario
                </div>
              </div>
            </div>
          </div>

          {/* Tipografía */}
          <div style={card}>
            <div style={lbl}>Tipografía</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(FONT_OPTIONS).map(([key, f]) => {
                const sel = typography === key;
                return (
                  <button
                    key={key}
                    onClick={() => { setTypography(key); previewColors({ typography: key }); }}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 14px", borderRadius: 10,
                      border: sel ? `2px solid ${C.amber}` : `1px solid ${C.border}`,
                      background: sel ? `${C.amber}15` : C.surface, cursor: "pointer",
                    }}
                  >
                    <span style={{ fontSize: 14, fontFamily: f.heading, color: C.text, fontWeight: sel ? 700 : 500 }}>
                      {f.label}
                    </span>
                    <span style={{ fontSize: 11, fontFamily: f.body, color: C.dim }}>
                      Aa Bb Cc 123
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }} onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Guardar apariencia"}</button>
        </>;

      // ── LOGO ──
      case "logo":
        return <>
          <div style={card}>
            <div style={lbl}>Logo de la empresa</div>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
              borderRadius: 12, background: C.surfLo, border: `1px solid ${C.border}`, overflow: "hidden", height: 160,
            }}>
              {logoPreview
                ? <img src={logoPreview} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                : <span style={{ color: C.mute, fontSize: 13 }}>Sin logo</span>}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoChange} style={{ display: "none" }} />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ ...btnPrimary, background: C.surfHi, color: C.text, border: `1px solid ${C.border}` }}
            >
              {logoPreview ? "Cambiar logo" : "Subir logo"}
            </button>
            {logoPreview && (
              <button
                onClick={() => { setLogoFile(null); setLogoPreview(""); setLogoUrl(""); }}
                style={{ width: "100%", marginTop: 8, padding: "10px 0", borderRadius: 10, border: "none", background: "transparent", color: C.red, fontSize: 13, cursor: "pointer" }}
              >
                Eliminar logo
              </button>
            )}
          </div>
          <button style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }} onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Guardar logo"}</button>
        </>;

      // ── DIVISIONES ──
      case "divisiones":
        return <>
          <div style={card}>
            <div style={lbl}>{editDivId !== null ? "Editar división" : "Nueva división"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {ICON_OPTIONS.map((ic) => (
                <button key={ic} onClick={() => setDivForm((f) => ({ ...f, icon: ic }))}
                  style={{
                    width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, cursor: "pointer", border: `1px solid ${divForm.icon === ic ? C.amber : C.border}`,
                    background: divForm.icon === ic ? `${C.amber}22` : C.surface,
                  }}>{ic}</button>
              ))}
            </div>
            <div style={lbl}>Nombre</div>
            <input style={{ ...inp, marginBottom: 10 }} value={divForm.label} onChange={(e) => setDivForm((f) => ({ ...f, label: e.target.value }))} placeholder="Ej: Producción" />
            <div style={lbl}>Clave</div>
            <input style={{ ...inp, marginBottom: 10 }} value={divForm.clave} onChange={(e) => setDivForm((f) => ({ ...f, clave: e.target.value.toUpperCase() }))} placeholder="Ej: PROD" maxLength={6} />
            <div style={lbl}>Color</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <input type="color" value={divForm.color} onChange={(e) => setDivForm((f) => ({ ...f, color: e.target.value }))} style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${C.border}`, cursor: "pointer", background: "transparent", padding: 0 }} />
              <input style={inp} value={divForm.color} onChange={(e) => setDivForm((f) => ({ ...f, color: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleAddDivision} style={{ ...btnPrimary, flex: 1 }}>{editDivId !== null ? "Actualizar" : "Agregar"}</button>
              {editDivId !== null && <button onClick={() => { setEditDivId(null); setDivForm({ icon: "📁", label: "", color: "#4f8cff", clave: "" }); }} style={{ padding: "12px 20px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: "pointer" }}>Cancelar</button>}
            </div>
          </div>
          {divisiones.length > 0 && <div style={card}>
            <div style={lbl}>Divisiones ({divisiones.length})</div>
            {divisiones.map((div) => (
              <div key={div.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: C.surfLo, marginBottom: 6 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, background: div.color + "22" }}>{div.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{div.label}</div>
                  <div style={{ fontSize: 11, color: C.dim, fontFamily: "'Geist Mono', monospace" }}>{div.clave}</div>
                </div>
                <div style={{ width: 16, height: 16, borderRadius: 8, background: div.color }} />
                <button onClick={() => handleEditDivision(div)} style={{ fontSize: 11, color: C.cyan, background: "none", border: "none", cursor: "pointer" }}>Editar</button>
                <button onClick={() => handleDeleteDivision(div.id)} style={{ fontSize: 11, color: C.red, background: "none", border: "none", cursor: "pointer" }}>Eliminar</button>
              </div>
            ))}
          </div>}
        </>;

      // ── ETAPAS ──
      case "etapas":
        return <>
          <div style={card}>
            <div style={lbl}>{editEtapaId !== null ? "Editar etapa" : "Nueva etapa"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {ICON_OPTIONS.map((ic) => (
                <button key={ic} onClick={() => setEtapaForm((f) => ({ ...f, icon: ic }))}
                  style={{
                    width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, cursor: "pointer", border: `1px solid ${etapaForm.icon === ic ? C.amber : C.border}`,
                    background: etapaForm.icon === ic ? `${C.amber}22` : C.surface,
                  }}>{ic}</button>
              ))}
            </div>
            <div style={lbl}>Código</div>
            <input type="number" min="1" max="999" style={{ ...inp, marginBottom: 10 }} value={etapaForm.codigo} onChange={(e) => setEtapaForm((f) => ({ ...f, codigo: parseInt(e.target.value) || 1 }))} placeholder="Ej: 1" />
            <div style={lbl}>Nombre</div>
            <input style={{ ...inp, marginBottom: 10 }} value={etapaForm.nombre} onChange={(e) => setEtapaForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Planificación" />
            <div style={lbl}>Color</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <input type="color" value={etapaForm.color} onChange={(e) => setEtapaForm((f) => ({ ...f, color: e.target.value }))} style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${C.border}`, cursor: "pointer", background: "transparent", padding: 0 }} />
              <input style={inp} value={etapaForm.color} onChange={(e) => setEtapaForm((f) => ({ ...f, color: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleAddEtapa} style={{ ...btnPrimary, flex: 1 }}>{editEtapaId !== null ? "Actualizar" : "Agregar"}</button>
              {editEtapaId !== null && <button onClick={() => { setEditEtapaId(null); setEtapaForm({ icon: "📋", codigo: 1, nombre: "", color: "#4f8cff" }); }} style={{ padding: "12px 20px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: "pointer" }}>Cancelar</button>}
            </div>
          </div>
          {etapas.length > 0 && <div style={card}>
            <div style={lbl}>Etapas ({etapas.length})</div>
            {etapas.map((etapa) => (
              <div key={etapa.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: C.surfLo, marginBottom: 6 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, background: etapa.color + "22" }}>{etapa.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{etapa.nombre}</div>
                  <div style={{ fontSize: 11, color: C.dim, fontFamily: "'Geist Mono', monospace" }}>{etapa.codigo}</div>
                </div>
                <div style={{ width: 16, height: 16, borderRadius: 8, background: etapa.color }} />
                <button onClick={() => handleEditEtapa(etapa)} style={{ fontSize: 11, color: C.cyan, background: "none", border: "none", cursor: "pointer" }}>Editar</button>
                <button onClick={() => handleDeleteEtapa(etapa.id)} style={{ fontSize: 11, color: C.red, background: "none", border: "none", cursor: "pointer" }}>Eliminar</button>
              </div>
            ))}
          </div>}
        </>;

      default: return null;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: C.text }}>
      {/* Tab bar */}
      <div role="tablist" aria-label="Configuración de empresa" style={{ display: "flex", overflowX: "auto", padding: "0 14px 10px", gap: 4, flexShrink: 0 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "8px 16px", borderRadius: 20, border: "none", cursor: "pointer",
              background: tab === t.key ? C.amber : "transparent",
              color: tab === t.key ? C.amberText : C.dim,
              fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div role="tabpanel" aria-label={`Contenido de ${TABS.find(t => t.key === tab)?.label || tab}`} style={{ flex: 1, overflowY: "auto", padding: "0 18px 110px" }}>
        {renderTab()}
      </div>

    </div>
  );
}
