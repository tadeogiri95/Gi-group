"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { THEME_PRESETS, FONT_OPTIONS, setColoresEmpresa } from "./lib/theme";
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
    <div className="mb-3.5">
      <div className="g-label mb-1.5">{label}</div>
      <div className="flex items-center gap-2.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-[10px] border border-gypi-border cursor-pointer bg-transparent p-0"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="g-input flex-1 font-mono"
        />
        <div className="w-10 h-10 rounded-[10px] border border-gypi-border shrink-0" style={{ background: value }} />
      </div>
    </div>
  );
}

export default function AdminEmpresaScreen({ empresa, empresaId, onUpdate, divisiones: divisionesProp = [], etapas: etapasProp = [] }) {
  const [tab, setTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const [nombre, setNombre] = useState(empresa?.nombre || "");
  const [nombreCorto, setNombreCorto] = useState(empresa?.nombre_corto || "");
  const [rubro, setRubro] = useState(empresa?.rubro || "");

  const [themePreset, setThemePreset] = useState(empresa?.theme_preset || "default");
  const [colorPrimario, setColorPrimario] = useState(empresa?.color_primario || "#F97316");
  const [colorSecundario, setColorSecundario] = useState(empresa?.color_secundario || "#7C3AED");
  const [colorFondo, setColorFondo] = useState(empresa?.color_fondo || "#F7F7F5");
  const [colorTexto, setColorTexto] = useState(empresa?.color_texto || "#1A1A1A");
  const [typography, setTypography] = useState(empresa?.typography || "system");
  const [customMode, setCustomMode] = useState(false);

  const [logoUrl, setLogoUrl] = useState(empresa?.logo_url || "");
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(empresa?.logo_url || "");
  const fileInputRef = useRef(null);

  const [divisiones, setDivisiones] = useState(divisionesProp);
  const [divForm, setDivForm] = useState({ icon: "📁", label: "", color: "#4f8cff", clave: "" });
  const [editDivId, setEditDivId] = useState(null);

  const [etapas, setEtapas] = useState(etapasProp);
  const [etapaForm, setEtapaForm] = useState({ icon: "📋", codigo: 1, nombre: "", color: "#4f8cff" });
  const [editEtapaId, setEditEtapaId] = useState(null);

  const showToast = useCallback((msg, type = "success") => {
    if (type === "error") toast.error(msg);
    else toast.success(msg);
  }, [toast]);

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

  useEffect(() => { setDivisiones(divisionesProp); }, [divisionesProp]);
  useEffect(() => { setEtapas(etapasProp); }, [etapasProp]);

  const applyPreset = (key) => {
    const p = THEME_PRESETS[key];
    if (!p) return;
    setThemePreset(key);
    setColorPrimario(p.primary);
    setColorSecundario(p.secondary);
    setColorFondo(p.bg);
    setColorTexto(p.text);
    setCustomMode(false);
    setColoresEmpresa({ theme_preset: key, color_primario: p.primary, color_secundario: p.secondary, color_fondo: p.bg, color_texto: p.text, typography });
  };

  const previewColors = (overrides = {}) => {
    setColoresEmpresa({
      color_primario: overrides.color_primario ?? colorPrimario,
      color_secundario: overrides.color_secundario ?? colorSecundario,
      color_fondo: overrides.color_fondo ?? colorFondo,
      color_texto: overrides.color_texto ?? colorTexto,
      typography: overrides.typography ?? typography,
    });
  };

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

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
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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

  const renderTab = () => {
    switch (tab) {

      case "general":
        return <>
          <div className="g-card mb-3.5">
            <div className="g-label mb-1.5">Nombre de la empresa</div>
            <input className="g-input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Mi Empresa S.A." />
          </div>
          <div className="g-card mb-3.5">
            <div className="g-label mb-1.5">Nombre corto</div>
            <input className="g-input" value={nombreCorto} onChange={(e) => setNombreCorto(e.target.value)} placeholder="Ej: MIEMPRESA" />
          </div>
          <div className="g-card mb-3.5">
            <div className="g-label mb-1.5">Rubro</div>
            <input className="g-input" value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Ej: Tecnología, Construcción..." />
          </div>
          <button className={`g-btn g-btn-primary w-full ${saving ? 'opacity-50' : ''}`} onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</button>
        </>;

      case "apariencia":
        return <>
          <div className="g-card mb-3.5">
            <div className="g-label mb-1.5">Temas preestablecidos</div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(THEME_PRESETS).map(([key, p]) => {
                const sel = !customMode && themePreset === key;
                return (
                  <button
                    key={key}
                    onClick={() => applyPreset(key)}
                    className="flex items-center gap-2.5 p-3 rounded-xl cursor-pointer transition-all"
                    style={{
                      border: sel ? `2px solid ${p.primary}` : `1px solid rgba(128,128,128,0.2)`,
                      background: p.bg,
                    }}
                  >
                    <div className="flex gap-1">
                      <div className="w-3.5 h-3.5 rounded" style={{ background: p.primary }} />
                      <div className="w-3.5 h-3.5 rounded" style={{ background: p.secondary }} />
                    </div>
                    <span className="text-xs font-semibold" style={{ color: p.text }}>{p.label}</span>
                    {sel && <span className="ml-auto text-sm font-bold" style={{ color: p.primary }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="g-card mb-3.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-gypi-text">Personalización individual</div>
                <div className="text-xs text-gypi-dim mt-0.5">Ajustar cada color por separado</div>
              </div>
              <button
                onClick={() => setCustomMode(!customMode)}
                aria-pressed={customMode}
                aria-label="Personalización individual de colores"
                className="w-12 h-7 rounded-full border-none cursor-pointer relative transition-colors"
                style={{ background: customMode ? '#16A34A' : 'var(--color-surf-hi)' }}
              >
                <div className="w-[22px] h-[22px] rounded-full bg-white absolute top-[3px] shadow-sm transition-[left]" style={{ left: customMode ? 23 : 3 }} />
              </button>
            </div>
          </div>

          {customMode && (
            <div className="g-card mb-3.5">
              <ColorRow label="Color primario (botones, acentos)" value={colorPrimario} onChange={(v) => { setColorPrimario(v); if (isHex(v)) previewColors({ color_primario: v }); }} />
              <ColorRow label="Color secundario (etiquetas, complementos)" value={colorSecundario} onChange={(v) => { setColorSecundario(v); if (isHex(v)) previewColors({ color_secundario: v }); }} />
              <ColorRow label="Color de fondo" value={colorFondo} onChange={(v) => { setColorFondo(v); if (isHex(v)) previewColors({ color_fondo: v }); }} />
              <ColorRow label="Color de texto" value={colorTexto} onChange={(v) => { setColorTexto(v); if (isHex(v)) previewColors({ color_texto: v }); }} />
            </div>
          )}

          <div className="g-card mb-3.5">
            <div className="g-label mb-1.5">Vista previa</div>
            <div className="rounded-xl p-4 border border-black/[0.15]" style={{ background: colorFondo }}>
              <div className="text-base font-bold mb-2" style={{ color: colorTexto, fontFamily: FONT_OPTIONS[typography]?.heading || "system-ui" }}>
                {nombreCorto || "Mi Empresa"}
              </div>
              <div className="text-xs opacity-60 mb-3" style={{ color: colorTexto, fontFamily: FONT_OPTIONS[typography]?.body || "system-ui" }}>
                Texto de ejemplo para ver la tipografía
              </div>
              <div className="flex gap-2">
                <div className="py-2 px-4 rounded-lg text-xs font-bold text-black" style={{ background: colorPrimario }}>Primario</div>
                <div className="py-2 px-4 rounded-lg text-xs font-bold text-white" style={{ background: colorSecundario }}>Secundario</div>
              </div>
            </div>
          </div>

          <div className="g-card mb-3.5">
            <div className="g-label mb-1.5">Tipografía</div>
            <div className="flex flex-col gap-1.5">
              {Object.entries(FONT_OPTIONS).map(([key, f]) => {
                const sel = typography === key;
                return (
                  <button
                    key={key}
                    onClick={() => { setTypography(key); previewColors({ typography: key }); }}
                    className={`flex items-center justify-between py-3 px-3.5 rounded-[10px] cursor-pointer ${
                      sel ? 'border-2 border-gypi-amber bg-gypi-amber/[0.08]' : 'border border-gypi-border bg-gypi-surface'
                    }`}
                  >
                    <span className={`text-sm text-gypi-text ${sel ? 'font-bold' : 'font-medium'}`} style={{ fontFamily: f.heading }}>{f.label}</span>
                    <span className="text-[11px] text-gypi-dim" style={{ fontFamily: f.body }}>Aa Bb Cc 123</span>
                  </button>
                );
              })}
            </div>
          </div>

          <button className={`g-btn g-btn-primary w-full ${saving ? 'opacity-50' : ''}`} onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Guardar apariencia"}</button>
        </>;

      case "logo":
        return <>
          <div className="g-card mb-3.5">
            <div className="g-label mb-1.5">Logo de la empresa</div>
            <div className="flex items-center justify-center mb-3.5 rounded-xl bg-gypi-surf-lo border border-gypi-border overflow-hidden h-40">
              {logoPreview
                ? <img src={logoPreview} alt="Logo" className="max-w-full max-h-full object-contain" />
                : <span className="text-gypi-mute text-[13px]">Sin logo</span>}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="g-btn g-btn-secondary w-full"
            >
              {logoPreview ? "Cambiar logo" : "Subir logo"}
            </button>
            {logoPreview && (
              <button
                onClick={() => { setLogoFile(null); setLogoPreview(""); setLogoUrl(""); }}
                className="w-full mt-2 py-2.5 rounded-[10px] border-none bg-transparent text-gypi-red text-[13px] cursor-pointer"
              >
                Eliminar logo
              </button>
            )}
          </div>
          <button className={`g-btn g-btn-primary w-full ${saving ? 'opacity-50' : ''}`} onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Guardar logo"}</button>
        </>;

      case "divisiones":
        return <>
          <div className="g-card mb-3.5">
            <div className="g-label mb-1.5">{editDivId !== null ? "Editar división" : "Nueva división"}</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {ICON_OPTIONS.map((ic) => (
                <button key={ic} onClick={() => setDivForm((f) => ({ ...f, icon: ic }))}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg cursor-pointer ${
                    divForm.icon === ic ? 'border border-gypi-amber bg-gypi-amber/[0.13]' : 'border border-gypi-border bg-gypi-surface'
                  }`}>{ic}</button>
              ))}
            </div>
            <div className="g-label mb-1.5">Nombre</div>
            <input className="g-input mb-2.5" value={divForm.label} onChange={(e) => setDivForm((f) => ({ ...f, label: e.target.value }))} placeholder="Ej: Producción" />
            <div className="g-label mb-1.5">Clave</div>
            <input className="g-input mb-2.5" value={divForm.clave} onChange={(e) => setDivForm((f) => ({ ...f, clave: e.target.value.toUpperCase() }))} placeholder="Ej: PROD" maxLength={6} />
            <div className="g-label mb-1.5">Color</div>
            <div className="flex gap-2.5 mb-3.5">
              <input type="color" value={divForm.color} onChange={(e) => setDivForm((f) => ({ ...f, color: e.target.value }))} className="w-10 h-10 rounded-[10px] border border-gypi-border cursor-pointer bg-transparent p-0" />
              <input className="g-input" value={divForm.color} onChange={(e) => setDivForm((f) => ({ ...f, color: e.target.value }))} />
            </div>
            <div className="flex gap-2.5">
              <button onClick={handleAddDivision} className="g-btn g-btn-primary flex-1">{editDivId !== null ? "Actualizar" : "Agregar"}</button>
              {editDivId !== null && <button onClick={() => { setEditDivId(null); setDivForm({ icon: "📁", label: "", color: "#4f8cff", clave: "" }); }} className="g-btn g-btn-secondary">Cancelar</button>}
            </div>
          </div>
          {divisiones.length > 0 && <div className="g-card mb-3.5">
            <div className="g-label mb-1.5">Divisiones ({divisiones.length})</div>
            {divisiones.map((div) => (
              <div key={div.id} className="flex items-center gap-2.5 p-3 rounded-xl border border-gypi-border bg-gypi-surf-lo mb-1.5">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: div.color + "22" }}>{div.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-gypi-text truncate">{div.label}</div>
                  <div className="text-[11px] text-gypi-dim font-mono">{div.clave}</div>
                </div>
                <div className="w-4 h-4 rounded-full" style={{ background: div.color }} />
                <button onClick={() => handleEditDivision(div)} className="text-[11px] text-gypi-cyan bg-transparent border-none cursor-pointer">Editar</button>
                <button onClick={() => handleDeleteDivision(div.id)} className="text-[11px] text-gypi-red bg-transparent border-none cursor-pointer">Eliminar</button>
              </div>
            ))}
          </div>}
        </>;

      case "etapas":
        return <>
          <div className="g-card mb-3.5">
            <div className="g-label mb-1.5">{editEtapaId !== null ? "Editar etapa" : "Nueva etapa"}</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {ICON_OPTIONS.map((ic) => (
                <button key={ic} onClick={() => setEtapaForm((f) => ({ ...f, icon: ic }))}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg cursor-pointer ${
                    etapaForm.icon === ic ? 'border border-gypi-amber bg-gypi-amber/[0.13]' : 'border border-gypi-border bg-gypi-surface'
                  }`}>{ic}</button>
              ))}
            </div>
            <div className="g-label mb-1.5">Código</div>
            <input type="number" min="1" max="999" className="g-input mb-2.5" value={etapaForm.codigo} onChange={(e) => setEtapaForm((f) => ({ ...f, codigo: parseInt(e.target.value) || 1 }))} placeholder="Ej: 1" />
            <div className="g-label mb-1.5">Nombre</div>
            <input className="g-input mb-2.5" value={etapaForm.nombre} onChange={(e) => setEtapaForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Planificación" />
            <div className="g-label mb-1.5">Color</div>
            <div className="flex gap-2.5 mb-3.5">
              <input type="color" value={etapaForm.color} onChange={(e) => setEtapaForm((f) => ({ ...f, color: e.target.value }))} className="w-10 h-10 rounded-[10px] border border-gypi-border cursor-pointer bg-transparent p-0" />
              <input className="g-input" value={etapaForm.color} onChange={(e) => setEtapaForm((f) => ({ ...f, color: e.target.value }))} />
            </div>
            <div className="flex gap-2.5">
              <button onClick={handleAddEtapa} className="g-btn g-btn-primary flex-1">{editEtapaId !== null ? "Actualizar" : "Agregar"}</button>
              {editEtapaId !== null && <button onClick={() => { setEditEtapaId(null); setEtapaForm({ icon: "📋", codigo: 1, nombre: "", color: "#4f8cff" }); }} className="g-btn g-btn-secondary">Cancelar</button>}
            </div>
          </div>
          {etapas.length > 0 && <div className="g-card mb-3.5">
            <div className="g-label mb-1.5">Etapas ({etapas.length})</div>
            {etapas.map((etapa) => (
              <div key={etapa.id} className="flex items-center gap-2.5 p-3 rounded-xl border border-gypi-border bg-gypi-surf-lo mb-1.5">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: etapa.color + "22" }}>{etapa.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-gypi-text truncate">{etapa.nombre}</div>
                  <div className="text-[11px] text-gypi-dim font-mono">{etapa.codigo}</div>
                </div>
                <div className="w-4 h-4 rounded-full" style={{ background: etapa.color }} />
                <button onClick={() => handleEditEtapa(etapa)} className="text-[11px] text-gypi-cyan bg-transparent border-none cursor-pointer">Editar</button>
                <button onClick={() => handleDeleteEtapa(etapa.id)} className="text-[11px] text-gypi-red bg-transparent border-none cursor-pointer">Eliminar</button>
              </div>
            ))}
          </div>}
        </>;

      default: return null;
    }
  };

  return (
    <div className="flex flex-col h-full text-gypi-text">
      {/* Tab bar */}
      <div role="tablist" aria-label="Configuración de empresa" className="flex overflow-x-auto px-3.5 pb-2.5 gap-1 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`py-2 px-4 rounded-full border-none cursor-pointer text-xs font-bold whitespace-nowrap shrink-0 ${
              tab === t.key ? 'bg-gypi-amber text-black' : 'bg-transparent text-gypi-dim'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div role="tabpanel" aria-label={`Contenido de ${TABS.find(t => t.key === tab)?.label || tab}`} className="flex-1 overflow-y-auto px-[18px] pb-[110px]">
        {renderTab()}
      </div>
    </div>
  );
}
