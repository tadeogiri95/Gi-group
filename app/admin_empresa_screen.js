"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { C } from "./lib/theme";

/* ─── Reusable Tailwind class strings ─── */
const inputCls =
  "w-full py-[11px] px-3.5 rounded-[10px] bg-gypi-surface border border-gypi-border text-gypi-text text-sm font-body outline-none box-border";
const labelCls =
  "block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5";
const cardCls =
  "bg-gypi-surface rounded-2xl p-[18px] border border-gypi-border mb-3.5";

/* ─── Tabs ─── */
const TABS = [
  { key: "general", label: "General" },
  { key: "colores", label: "Colores" },
  { key: "personalizar", label: "Personalizar" },
  { key: "logo", label: "Logo" },
  { key: "divisiones", label: "Divisiones" },
  { key: "etapas", label: "Etapas" },
];

/* ─── Theme presets ─── */
const THEME_PRESETS = [
  { key: "oscuro", label: "Oscuro", bg: "#111111", surface: "#1a1a1a", text: "#ffffff" },
  { key: "carbon", label: "Carbón", bg: "#1c1c1e", surface: "#2c2c2e", text: "#f5f5f7" },
  { key: "medianoche", label: "Medianoche", bg: "#0d1117", surface: "#161b22", text: "#c9d1d9" },
  { key: "claro", label: "Claro", bg: "#f5f5f5", surface: "#ffffff", text: "#1a1a1a" },
  { key: "crema", label: "Crema", bg: "#faf8f5", surface: "#ffffff", text: "#2c2c2c" },
];

/* ─── Icon list for selectors ─── */
const ICON_OPTIONS = [
  "📁", "📂", "🏢", "🏗️", "🏭", "🔧", "⚙️", "🛠️", "📊", "📈",
  "💼", "🎯", "🚀", "💡", "🔑", "📋", "📝", "✅", "⭐", "🔔",
];

export default function AdminEmpresaScreen({ empresa, onSave, onClose }) {
  /* ─── State ─── */
  const [tab, setTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // General
  const [nombre, setNombre] = useState(empresa?.nombre || "");
  const [nombreCorto, setNombreCorto] = useState(empresa?.nombre_corto || "");
  const [rubro, setRubro] = useState(empresa?.rubro || "");

  // Colores
  const [colorPrimario, setColorPrimario] = useState(empresa?.color_primario || "#4f8cff");
  const [colorSecundario, setColorSecundario] = useState(empresa?.color_secundario || "#38d68a");

  // Personalización
  const [themePreset, setThemePreset] = useState(empresa?.theme_preset || "oscuro");
  const [typography, setTypography] = useState(empresa?.typography || "system");
  const [timeFormat, setTimeFormat] = useState(empresa?.time_format || "24h");
  const [notifEmail, setNotifEmail] = useState(empresa?.notif_email ?? true);
  const [notifPush, setNotifPush] = useState(empresa?.notif_push ?? true);
  const [notifSound, setNotifSound] = useState(empresa?.notif_sound ?? false);

  // Logo
  const [logoUrl, setLogoUrl] = useState(empresa?.logo_url || "");
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(empresa?.logo_url || "");
  const fileInputRef = useRef(null);

  // Divisiones
  const [divisiones, setDivisiones] = useState(empresa?.divisiones || []);
  const [divForm, setDivForm] = useState({ icon: "📁", label: "", color: "#4f8cff", clave: "" });
  const [editDivId, setEditDivId] = useState(null);

  // Etapas
  const [etapas, setEtapas] = useState(empresa?.etapas || []);
  const [etapaForm, setEtapaForm] = useState({ icon: "📋", codigo: "", nombre: "", color: "#4f8cff" });
  const [editEtapaId, setEditEtapaId] = useState(null);

  /* ─── Toast helper ─── */
  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  /* ─── Sync from prop ─── */
  useEffect(() => {
    if (empresa) {
      setNombre(empresa.nombre || "");
      setNombreCorto(empresa.nombre_corto || "");
      setRubro(empresa.rubro || "");
      setColorPrimario(empresa.color_primario || "#4f8cff");
      setColorSecundario(empresa.color_secundario || "#38d68a");
      setThemePreset(empresa.theme_preset || "oscuro");
      setTypography(empresa.typography || "system");
      setTimeFormat(empresa.time_format || "24h");
      setNotifEmail(empresa.notif_email ?? true);
      setNotifPush(empresa.notif_push ?? true);
      setNotifSound(empresa.notif_sound ?? false);
      setLogoUrl(empresa.logo_url || "");
      setLogoPreview(empresa.logo_url || "");
      setDivisiones(empresa.divisiones || []);
      setEtapas(empresa.etapas || []);
    }
  }, [empresa]);

  /* ─── Logo preview ─── */
  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  /* ─── Save handler ─── */
  const handleSave = async () => {
    setSaving(true);
    try {
      const data = {
        nombre,
        nombre_corto: nombreCorto,
        rubro,
        color_primario: colorPrimario,
        color_secundario: colorSecundario,
        theme_preset: themePreset,
        typography,
        time_format: timeFormat,
        notif_email: notifEmail,
        notif_push: notifPush,
        notif_sound: notifSound,
        divisiones,
        etapas,
      };
      if (logoFile) data.logoFile = logoFile;
      await onSave?.(data);
      showToast("Guardado correctamente");
    } catch (err) {
      showToast("Error al guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  /* ─── Division CRUD ─── */
  const handleAddDivision = () => {
    if (!divForm.label.trim()) return showToast("El nombre es requerido", "error");
    if (!divForm.clave.trim()) return showToast("La clave es requerida", "error");
    if (editDivId !== null) {
      setDivisiones((prev) =>
        prev.map((d) => (d.id === editDivId ? { ...d, ...divForm } : d))
      );
      setEditDivId(null);
      showToast("División actualizada");
    } else {
      const newDiv = { ...divForm, id: Date.now() };
      setDivisiones((prev) => [...prev, newDiv]);
      showToast("División agregada");
    }
    setDivForm({ icon: "📁", label: "", color: "#4f8cff", clave: "" });
  };

  const handleEditDivision = (div) => {
    setDivForm({ icon: div.icon, label: div.label, color: div.color, clave: div.clave });
    setEditDivId(div.id);
  };

  const handleDeleteDivision = (id) => {
    setDivisiones((prev) => prev.filter((d) => d.id !== id));
    if (editDivId === id) {
      setEditDivId(null);
      setDivForm({ icon: "📁", label: "", color: "#4f8cff", clave: "" });
    }
    showToast("División eliminada");
  };

  /* ─── Etapa CRUD ─── */
  const handleAddEtapa = () => {
    if (!etapaForm.nombre.trim()) return showToast("El nombre es requerido", "error");
    if (!etapaForm.codigo.trim()) return showToast("El código es requerido", "error");
    if (editEtapaId !== null) {
      setEtapas((prev) =>
        prev.map((e) => (e.id === editEtapaId ? { ...e, ...etapaForm } : e))
      );
      setEditEtapaId(null);
      showToast("Etapa actualizada");
    } else {
      const newEtapa = { ...etapaForm, id: Date.now() };
      setEtapas((prev) => [...prev, newEtapa]);
      showToast("Etapa agregada");
    }
    setEtapaForm({ icon: "📋", codigo: "", nombre: "", color: "#4f8cff" });
  };

  const handleEditEtapa = (etapa) => {
    setEtapaForm({ icon: etapa.icon, codigo: etapa.codigo, nombre: etapa.nombre, color: etapa.color });
    setEditEtapaId(etapa.id);
  };

  const handleDeleteEtapa = (id) => {
    setEtapas((prev) => prev.filter((e) => e.id !== id));
    if (editEtapaId === id) {
      setEditEtapaId(null);
      setEtapaForm({ icon: "📋", codigo: "", nombre: "", color: "#4f8cff" });
    }
    showToast("Etapa eliminada");
  };

  /* ─── Toggle component ─── */
  const Toggle = ({ value, onChange }) => (
    <button
      onClick={() => onChange(!value)}
      className="relative border-none cursor-pointer rounded-full"
      style={{
        width: 48,
        height: 28,
        background: value ? C.green : C.surfHi,
        transition: "background 0.2s",
      }}
    >
      <div
        className="absolute rounded-full bg-white shadow-sm"
        style={{
          width: 22,
          height: 22,
          top: 3,
          left: value ? 23 : 3,
          transition: "left 0.2s",
        }}
      />
    </button>
  );

  /* ─── Render tab content ─── */
  const renderTabContent = () => {
    switch (tab) {
      /* ═══ GENERAL ═══ */
      case "general":
        return (
          <div className="flex flex-col gap-5">
            <div className={cardCls}>
              <label className={labelCls}>Nombre de la empresa</label>
              <input
                className={inputCls}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Mi Empresa S.A."
              />
            </div>

            <div className={cardCls}>
              <label className={labelCls}>Nombre corto</label>
              <input
                className={inputCls}
                value={nombreCorto}
                onChange={(e) => setNombreCorto(e.target.value)}
                placeholder="Ej: MIEMPRESA"
              />
            </div>

            <div className={cardCls}>
              <label className={labelCls}>Rubro</label>
              <input
                className={inputCls}
                value={rubro}
                onChange={(e) => setRubro(e.target.value)}
                placeholder="Ej: Tecnología, Construcción..."
              />
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3.5 rounded-xl text-white font-heading font-bold text-sm border-none cursor-pointer disabled:opacity-50"
              style={{ background: C.amber }}
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        );

      /* ═══ COLORES ═══ */
      case "colores":
        return (
          <div className="flex flex-col gap-5">
            <div className={cardCls}>
              <label className={labelCls}>Color primario</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorPrimario}
                  onChange={(e) => setColorPrimario(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-gypi-border cursor-pointer bg-transparent p-0"
                />
                <input
                  className={inputCls}
                  value={colorPrimario}
                  onChange={(e) => setColorPrimario(e.target.value)}
                  placeholder="#4f8cff"
                />
              </div>
              <div
                className="mt-3 h-10 rounded-lg"
                style={{ background: colorPrimario }}
              />
            </div>

            <div className={cardCls}>
              <label className={labelCls}>Color secundario</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorSecundario}
                  onChange={(e) => setColorSecundario(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-gypi-border cursor-pointer bg-transparent p-0"
                />
                <input
                  className={inputCls}
                  value={colorSecundario}
                  onChange={(e) => setColorSecundario(e.target.value)}
                  placeholder="#38d68a"
                />
              </div>
              <div
                className="mt-3 h-10 rounded-lg"
                style={{ background: colorSecundario }}
              />
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3.5 rounded-xl text-white font-heading font-bold text-sm border-none cursor-pointer disabled:opacity-50"
              style={{ background: C.amber }}
            >
              {saving ? "Guardando..." : "Guardar colores"}
            </button>
          </div>
        );

      /* ═══ PERSONALIZAR ═══ */
      case "personalizar":
        return (
          <div className="flex flex-col gap-5">
            {/* Theme presets */}
            <div className={cardCls}>
              <label className={labelCls}>Tema</label>
              <div className="grid grid-cols-2 gap-2.5">
                {THEME_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    onClick={() => setThemePreset(preset.key)}
                    className="flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer"
                    style={{
                      background: preset.bg,
                      borderColor: themePreset === preset.key ? C.amber : C.border,
                      borderWidth: themePreset === preset.key ? 2 : 1,
                    }}
                  >
                    <div
                      className="w-6 h-6 rounded-md"
                      style={{ background: preset.surface }}
                    />
                    <span
                      className="text-xs font-body font-semibold"
                      style={{ color: preset.text }}
                    >
                      {preset.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Typography */}
            <div className={cardCls}>
              <label className={labelCls}>Tipografía</label>
              <select
                className={inputCls}
                value={typography}
                onChange={(e) => setTypography(e.target.value)}
              >
                <option value="system">Sistema</option>
                <option value="inter">Inter</option>
                <option value="roboto">Roboto</option>
                <option value="poppins">Poppins</option>
                <option value="mono">Monoespaciada</option>
              </select>
            </div>

            {/* Time format */}
            <div className={cardCls}>
              <label className={labelCls}>Formato de hora</label>
              <div className="flex gap-2.5">
                {["24h", "12h"].map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setTimeFormat(fmt)}
                    className="flex-1 py-2.5 rounded-xl font-body text-sm font-semibold border cursor-pointer"
                    style={{
                      background: timeFormat === fmt ? C.amber : C.surface,
                      color: timeFormat === fmt ? "#fff" : C.text,
                      borderColor: timeFormat === fmt ? C.amber : C.border,
                    }}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Notification toggles */}
            <div className={cardCls}>
              <label className={labelCls}>Notificaciones</label>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-body text-gypi-text">Email</span>
                  <Toggle value={notifEmail} onChange={setNotifEmail} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-body text-gypi-text">Push</span>
                  <Toggle value={notifPush} onChange={setNotifPush} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-body text-gypi-text">Sonido</span>
                  <Toggle value={notifSound} onChange={setNotifSound} />
                </div>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3.5 rounded-xl text-white font-heading font-bold text-sm border-none cursor-pointer disabled:opacity-50"
              style={{ background: C.amber }}
            >
              {saving ? "Guardando..." : "Guardar preferencias"}
            </button>
          </div>
        );

      /* ═══ LOGO ═══ */
      case "logo":
        return (
          <div className="flex flex-col gap-5">
            <div className={cardCls}>
              <label className={labelCls}>Logo de la empresa</label>

              {/* Preview */}
              <div className="flex items-center justify-center mb-4 rounded-xl bg-gypi-surf-lo border border-gypi-border overflow-hidden"
                style={{ height: 160 }}
              >
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <span className="text-gypi-mute text-sm font-body">
                    Sin logo
                  </span>
                )}
              </div>

              {/* File input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 rounded-xl font-heading font-bold text-sm border border-gypi-border cursor-pointer bg-gypi-surf-hi text-gypi-text"
              >
                {logoPreview ? "Cambiar logo" : "Subir logo"}
              </button>

              {logoPreview && (
                <button
                  onClick={() => {
                    setLogoFile(null);
                    setLogoPreview("");
                    setLogoUrl("");
                  }}
                  className="w-full mt-2 py-2.5 rounded-xl font-body text-sm border-none cursor-pointer text-gypi-red bg-transparent"
                >
                  Eliminar logo
                </button>
              )}
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3.5 rounded-xl text-white font-heading font-bold text-sm border-none cursor-pointer disabled:opacity-50"
              style={{ background: C.amber }}
            >
              {saving ? "Guardando..." : "Guardar logo"}
            </button>
          </div>
        );

      /* ═══ DIVISIONES ═══ */
      case "divisiones":
        return (
          <div className="flex flex-col gap-5">
            {/* Add / Edit form */}
            <div className={cardCls}>
              <label className={labelCls}>
                {editDivId !== null ? "Editar división" : "Nueva división"}
              </label>

              {/* Icon selector */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {ICON_OPTIONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setDivForm((f) => ({ ...f, icon: ic }))}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-lg cursor-pointer border"
                    style={{
                      background: divForm.icon === ic ? C.amber + "22" : C.surface,
                      borderColor: divForm.icon === ic ? C.amber : C.border,
                    }}
                  >
                    {ic}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <label className={labelCls}>Nombre</label>
                  <input
                    className={inputCls}
                    value={divForm.label}
                    onChange={(e) => setDivForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="Ej: Producción"
                  />
                </div>
                <div>
                  <label className={labelCls}>Clave</label>
                  <input
                    className={inputCls}
                    value={divForm.clave}
                    onChange={(e) => setDivForm((f) => ({ ...f, clave: e.target.value.toUpperCase() }))}
                    placeholder="Ej: PROD"
                    maxLength={6}
                  />
                </div>
                <div>
                  <label className={labelCls}>Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={divForm.color}
                      onChange={(e) => setDivForm((f) => ({ ...f, color: e.target.value }))}
                      className="w-10 h-10 rounded-lg border border-gypi-border cursor-pointer bg-transparent p-0"
                    />
                    <input
                      className={inputCls}
                      value={divForm.color}
                      onChange={(e) => setDivForm((f) => ({ ...f, color: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5 mt-4">
                <button
                  onClick={handleAddDivision}
                  className="flex-1 py-3 rounded-xl text-white font-heading font-bold text-sm border-none cursor-pointer"
                  style={{ background: C.amber }}
                >
                  {editDivId !== null ? "Actualizar" : "Agregar"}
                </button>
                {editDivId !== null && (
                  <button
                    onClick={() => {
                      setEditDivId(null);
                      setDivForm({ icon: "📁", label: "", color: "#4f8cff", clave: "" });
                    }}
                    className="py-3 px-5 rounded-xl font-body text-sm border border-gypi-border cursor-pointer bg-gypi-surface text-gypi-text"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>

            {/* Division list */}
            {divisiones.length > 0 && (
              <div className={cardCls}>
                <label className={labelCls}>Divisiones ({divisiones.length})</label>
                <div className="flex flex-col gap-2">
                  {divisiones.map((div) => (
                    <div
                      key={div.id}
                      className="flex items-center gap-3 p-3 rounded-xl border border-gypi-border bg-gypi-surf-lo"
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-lg"
                        style={{ background: div.color + "22" }}
                      >
                        {div.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-heading font-bold text-gypi-text truncate">
                          {div.label}
                        </div>
                        <div className="text-xs font-mono text-gypi-dim">
                          {div.clave}
                        </div>
                      </div>
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ background: div.color }}
                      />
                      <button
                        onClick={() => handleEditDivision(div)}
                        className="text-xs font-body border-none bg-transparent cursor-pointer text-gypi-cyan"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDeleteDivision(div.id)}
                        className="text-xs font-body border-none bg-transparent cursor-pointer text-gypi-red"
                      >
                        Eliminar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      /* ═══ ETAPAS ═══ */
      case "etapas":
        return (
          <div className="flex flex-col gap-5">
            {/* Add / Edit form */}
            <div className={cardCls}>
              <label className={labelCls}>
                {editEtapaId !== null ? "Editar etapa" : "Nueva etapa"}
              </label>

              {/* Icon selector */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {ICON_OPTIONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setEtapaForm((f) => ({ ...f, icon: ic }))}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-lg cursor-pointer border"
                    style={{
                      background: etapaForm.icon === ic ? C.amber + "22" : C.surface,
                      borderColor: etapaForm.icon === ic ? C.amber : C.border,
                    }}
                  >
                    {ic}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <label className={labelCls}>Código</label>
                  <input
                    className={inputCls}
                    value={etapaForm.codigo}
                    onChange={(e) => setEtapaForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
                    placeholder="Ej: PLAN"
                    maxLength={6}
                  />
                </div>
                <div>
                  <label className={labelCls}>Nombre</label>
                  <input
                    className={inputCls}
                    value={etapaForm.nombre}
                    onChange={(e) => setEtapaForm((f) => ({ ...f, nombre: e.target.value }))}
                    placeholder="Ej: Planificación"
                  />
                </div>
                <div>
                  <label className={labelCls}>Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={etapaForm.color}
                      onChange={(e) => setEtapaForm((f) => ({ ...f, color: e.target.value }))}
                      className="w-10 h-10 rounded-lg border border-gypi-border cursor-pointer bg-transparent p-0"
                    />
                    <input
                      className={inputCls}
                      value={etapaForm.color}
                      onChange={(e) => setEtapaForm((f) => ({ ...f, color: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5 mt-4">
                <button
                  onClick={handleAddEtapa}
                  className="flex-1 py-3 rounded-xl text-white font-heading font-bold text-sm border-none cursor-pointer"
                  style={{ background: C.amber }}
                >
                  {editEtapaId !== null ? "Actualizar" : "Agregar"}
                </button>
                {editEtapaId !== null && (
                  <button
                    onClick={() => {
                      setEditEtapaId(null);
                      setEtapaForm({ icon: "📋", codigo: "", nombre: "", color: "#4f8cff" });
                    }}
                    className="py-3 px-5 rounded-xl font-body text-sm border border-gypi-border cursor-pointer bg-gypi-surface text-gypi-text"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>

            {/* Etapa list */}
            {etapas.length > 0 && (
              <div className={cardCls}>
                <label className={labelCls}>Etapas ({etapas.length})</label>
                <div className="flex flex-col gap-2">
                  {etapas.map((etapa) => (
                    <div
                      key={etapa.id}
                      className="flex items-center gap-3 p-3 rounded-xl border border-gypi-border bg-gypi-surf-lo"
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-lg"
                        style={{ background: etapa.color + "22" }}
                      >
                        {etapa.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-heading font-bold text-gypi-text truncate">
                          {etapa.nombre}
                        </div>
                        <div className="text-xs font-mono text-gypi-dim">
                          {etapa.codigo}
                        </div>
                      </div>
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ background: etapa.color }}
                      />
                      <button
                        onClick={() => handleEditEtapa(etapa)}
                        className="text-xs font-body border-none bg-transparent cursor-pointer text-gypi-cyan"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDeleteEtapa(etapa.id)}
                        className="text-xs font-body border-none bg-transparent cursor-pointer text-gypi-red"
                      >
                        Eliminar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  /* ─── Main render ─── */
  return (
    <div className="flex flex-col h-full bg-gypi-bg text-gypi-text font-body">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gypi-border bg-gypi-surface">
        <button
          onClick={onClose}
          className="text-sm font-body border-none bg-transparent cursor-pointer text-gypi-dim"
        >
          ← Volver
        </button>
        <h1 className="text-base font-heading font-bold text-gypi-text m-0">
          Administrar Empresa
        </h1>
        <div className="w-12" />
      </div>

      {/* Tab bar */}
      <div className="flex overflow-x-auto px-4 py-2.5 gap-1 border-b border-gypi-border bg-gypi-surface scrollbar-none">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 py-2 rounded-xl text-xs font-heading font-bold whitespace-nowrap border-none cursor-pointer shrink-0"
            style={{
              background: tab === t.key ? C.amber : "transparent",
              color: tab === t.key ? "#fff" : C.dim,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {renderTabContent()}
      </div>

      {/* Toast overlay */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-2xl font-body text-sm font-semibold text-white shadow-lg"
          style={{
            background: toast.type === "error" ? C.red : C.green,
            animation: "fadeInUp 0.25s ease-out",
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* Saving overlay */}
      {saving && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40">
          <div className="bg-gypi-surface rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-xl">
            <div
              className="w-8 h-8 rounded-full border-[3px] border-t-transparent animate-spin"
              style={{ borderColor: `${C.amber} transparent ${C.amber} ${C.amber}` }}
            />
            <span className="text-sm font-heading font-bold text-gypi-text">
              Guardando...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
