"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, setColoresEmpresa } from "./lib/theme";
import { sb } from "./lib/supabase";

/* ─── Reusable Tailwind class strings ─── */
const inputCls =
  "w-full py-[11px] px-3.5 rounded-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] text-sm font-body outline-none box-border focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all";
const labelCls =
  "block text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.06em] mb-1.5";
const cardCls =
  "bg-[var(--color-surface)] rounded-2xl p-[18px] border border-[var(--color-border)] mb-3.5";

/* ─── Tabs ─── */
const TABS = [
  { key: "general", label: "General" },
  { key: "colores", label: "Colores" },
  { key: "logo", label: "Logo" },
  { key: "divisiones", label: "Divisiones" },
  { key: "etapas", label: "Etapas" },
];

/* ─── Icon list for selectors ─── */
const ICON_OPTIONS = [
  "📁", "📂", "🏢", "🏗️", "🏭", "🔧", "⚙️", "🛠️", "📊", "📈",
  "💼", "🎯", "🚀", "💡", "🔑", "📋", "📝", "✅", "⭐", "🔔",
];

export default function AdminEmpresaScreen({ empresa, empresaId, onUpdate }) {
  /* ─── State ─── */
  const [tab, setTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // General
  const [nombre, setNombre] = useState(empresa?.nombre || "");
  const [nombreCorto, setNombreCorto] = useState(empresa?.nombre_corto || "");
  const [rubro, setRubro] = useState(empresa?.rubro || "");

  // Colores
  const [colorPrimario, setColorPrimario] = useState(empresa?.color_primario || "#F97316");
  const [colorSecundario, setColorSecundario] = useState(empresa?.color_secundario || "#A78BFA");

  // Logo
  const [logoUrl, setLogoUrl] = useState(empresa?.logo_url || "");
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(empresa?.logo_url || "");
  const fileInputRef = useRef(null);

  // Divisiones
  const [divisiones, setDivisiones] = useState(empresa?.divisiones || []);
  const [divForm, setDivForm] = useState({ icon: "📁", label: "", color: "#F97316", clave: "" });
  const [editDivId, setEditDivId] = useState(null);

  // Etapas
  const [etapas, setEtapas] = useState(empresa?.etapas || []);
  const [etapaForm, setEtapaForm] = useState({ icon: "📋", codigo: "", nombre: "", color: "#F97316" });
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
      setColorPrimario(empresa.color_primario || "#F97316");
      setColorSecundario(empresa.color_secundario || "#A78BFA");
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

  /* ─── Save handler — ahora guarda en Supabase directamente ─── */
  const handleSave = async () => {
    setSaving(true);
    try {
      const eid = empresaId || empresa?.id;
      if (!eid) throw new Error("Sin empresa_id");

      const data = {
        nombre,
        nombre_corto: nombreCorto,
        rubro,
        color_primario: colorPrimario,
        color_secundario: colorSecundario,
        divisiones,
        etapas,
      };

      // Subir logo si hay archivo nuevo
      if (logoFile) {
        const formData = new FormData();
        formData.append("file", logoFile);
        formData.append("empresa_id", eid);
        const logoRes = await fetch("/api/upload-logo", { method: "POST", body: formData });
        const logoData = await logoRes.json();
        if (logoData.url) data.logo_url = logoData.url;
      }

      // Guardar en Supabase
      await sb.patch(`empresa?id=eq.${eid}`, data);

      // Aplicar colores en vivo inmediatamente
      setColoresEmpresa(colorPrimario, colorSecundario);

      // Notificar al componente padre para que actualice su estado
      if (onUpdate) {
        onUpdate({ ...empresa, ...data });
      }

      showToast("Guardado correctamente");
    } catch (err) {
      console.error("Error guardando:", err);
      showToast("Error al guardar: " + err.message, "error");
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
    setDivForm({ icon: "📁", label: "", color: "#F97316", clave: "" });
  };

  const handleEditDivision = (div) => {
    setDivForm({ icon: div.icon, label: div.label, color: div.color, clave: div.clave });
    setEditDivId(div.id);
  };

  const handleDeleteDivision = (id) => {
    setDivisiones((prev) => prev.filter((d) => d.id !== id));
    if (editDivId === id) {
      setEditDivId(null);
      setDivForm({ icon: "📁", label: "", color: "#F97316", clave: "" });
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
    setEtapaForm({ icon: "📋", codigo: "", nombre: "", color: "#F97316" });
  };

  const handleEditEtapa = (etapa) => {
    setEtapaForm({ icon: etapa.icon, codigo: etapa.codigo, nombre: etapa.nombre, color: etapa.color });
    setEditEtapaId(etapa.id);
  };

  const handleDeleteEtapa = (id) => {
    setEtapas((prev) => prev.filter((e) => e.id !== id));
    if (editEtapaId === id) {
      setEditEtapaId(null);
      setEtapaForm({ icon: "📋", codigo: "", nombre: "", color: "#F97316" });
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
        background: value ? C.green : C.surface,
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
              className="w-full py-3.5 rounded-xl text-white font-display font-bold text-sm border-none cursor-pointer disabled:opacity-50 transition-colors"
              style={{ background: C.amber }}
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        );

      /* ═══ COLORES ═══ */
      case "colores":
        const TEMAS = [
          { nombre: "Naranja Gypi", primario: "#F97316", secundario: "#A78BFA", icon: "🟠" },
          { nombre: "Azul Corporativo", primario: "#2563EB", secundario: "#0EA5E9", icon: "🔵" },
          { nombre: "Verde Industrial", primario: "#16A34A", secundario: "#059669", icon: "🟢" },
          { nombre: "Rojo Fuerte", primario: "#DC2626", secundario: "#F97316", icon: "🔴" },
          { nombre: "Violeta Tech", primario: "#7C3AED", secundario: "#EC4899", icon: "🟣" },
          { nombre: "Turquesa", primario: "#0891B2", secundario: "#06B6D4", icon: "🩵" },
          { nombre: "Oscuro Pro", primario: "#1E293B", secundario: "#475569", icon: "⚫" },
          { nombre: "Dorado Premium", primario: "#B45309", secundario: "#D97706", icon: "🟡" },
        ];
        return (
          <div className="flex flex-col gap-5">
            {/* Temas predefinidos */}
            <div className={cardCls}>
              <label className={labelCls}>Temas predefinidos</label>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">Elegí un tema base o personalizá los colores abajo.</p>
              <div className="grid grid-cols-2 gap-2">
                {TEMAS.map((t) => {
                  const activo = colorPrimario === t.primario && colorSecundario === t.secundario;
                  return (
                    <button
                      key={t.nombre}
                      onClick={() => { setColorPrimario(t.primario); setColorSecundario(t.secundario); }}
                      className="flex items-center gap-2 p-3 rounded-xl border text-left transition-all"
                      style={{
                        borderColor: activo ? t.primario : "var(--color-border)",
                        background: activo ? `${t.primario}11` : "var(--color-bg-subtle)",
                        boxShadow: activo ? `0 0 0 2px ${t.primario}33` : "none",
                      }}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                        style={{ background: `linear-gradient(135deg, ${t.primario}, ${t.secundario})` }}>
                        {t.icon}
                      </div>
                      <span className="text-xs font-medium" style={{ color: activo ? t.primario : "var(--color-text)" }}>
                        {t.nombre}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={cardCls}>
              <label className={labelCls}>Color primario</label>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">Este color se usa en botones, navegación y acentos principales.</p>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorPrimario}
                  onChange={(e) => setColorPrimario(e.target.value)}
                  className="w-12 h-12 rounded-xl border border-[var(--color-border)] cursor-pointer bg-transparent p-1"
                />
                <input
                  className={inputCls}
                  value={colorPrimario}
                  onChange={(e) => setColorPrimario(e.target.value)}
                  placeholder="#F97316"
                />
              </div>
              <div
                className="mt-3 h-12 rounded-xl flex items-center justify-center text-white text-sm font-bold"
                style={{ background: colorPrimario }}
              >
                Vista previa
              </div>
            </div>

            <div className={cardCls}>
              <label className={labelCls}>Color secundario</label>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">Se usa en badges, acentos secundarios y gradientes.</p>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorSecundario}
                  onChange={(e) => setColorSecundario(e.target.value)}
                  className="w-12 h-12 rounded-xl border border-[var(--color-border)] cursor-pointer bg-transparent p-1"
                />
                <input
                  className={inputCls}
                  value={colorSecundario}
                  onChange={(e) => setColorSecundario(e.target.value)}
                  placeholder="#A78BFA"
                />
              </div>
              <div
                className="mt-3 h-12 rounded-xl flex items-center justify-center text-white text-sm font-bold"
                style={{ background: colorSecundario }}
              >
                Vista previa
              </div>
            </div>

            {/* Preview combinado */}
            <div className={cardCls}>
              <label className={labelCls}>Combinación</label>
              <div className="h-16 rounded-xl flex items-center justify-center text-white font-bold"
                style={{ background: `linear-gradient(135deg, ${colorPrimario}, ${colorSecundario})` }}
              >
                {nombreCorto || "Tu Marca"}
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3.5 rounded-xl text-white font-display font-bold text-sm border-none cursor-pointer disabled:opacity-50 transition-colors"
              style={{ background: colorPrimario }}
            >
              {saving ? "Guardando..." : "Guardar colores"}
            </button>
          </div>
        );

      /* ═══ LOGO ═══ */
      case "logo":
        return (
          <div className="flex flex-col gap-5">
            <div className={cardCls}>
              <label className={labelCls}>Logo de la empresa</label>

              <div className="flex items-center justify-center mb-4 rounded-xl bg-[var(--color-bg-subtle)] border border-[var(--color-border)] overflow-hidden"
                style={{ height: 160 }}
              >
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <span className="text-[var(--color-text-muted)] text-sm">
                    Sin logo
                  </span>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 rounded-xl font-display font-bold text-sm border border-[var(--color-border)] cursor-pointer bg-[var(--color-surface-raised)] text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
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
                  className="w-full mt-2 py-2.5 rounded-xl text-sm border-none cursor-pointer text-red-500 bg-transparent hover:bg-red-50 transition-colors"
                >
                  Eliminar logo
                </button>
              )}
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3.5 rounded-xl text-white font-display font-bold text-sm border-none cursor-pointer disabled:opacity-50 transition-colors"
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
            <div className={cardCls}>
              <label className={labelCls}>
                {editDivId !== null ? "Editar división" : "Nueva división"}
              </label>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {ICON_OPTIONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setDivForm((f) => ({ ...f, icon: ic }))}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg cursor-pointer border transition-colors ${
                      divForm.icon === ic
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                    }`}
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
                      className="w-10 h-10 rounded-lg border border-[var(--color-border)] cursor-pointer bg-transparent p-0.5"
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
                  className="flex-1 py-3 rounded-xl text-white font-display font-bold text-sm border-none cursor-pointer"
                  style={{ background: C.amber }}
                >
                  {editDivId !== null ? "Actualizar" : "Agregar"}
                </button>
                {editDivId !== null && (
                  <button
                    onClick={() => {
                      setEditDivId(null);
                      setDivForm({ icon: "📁", label: "", color: "#F97316", clave: "" });
                    }}
                    className="py-3 px-5 rounded-xl text-sm border border-[var(--color-border)] cursor-pointer bg-[var(--color-surface)] text-[var(--color-text)]"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>

            {divisiones.length > 0 && (
              <div className={cardCls}>
                <label className={labelCls}>Divisiones ({divisiones.length})</label>
                <div className="flex flex-col gap-2">
                  {divisiones.map((div) => (
                    <div
                      key={div.id}
                      className="flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)]"
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-lg"
                        style={{ background: div.color + "22" }}
                      >
                        {div.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-display font-bold text-[var(--color-text)] truncate">
                          {div.label}
                        </div>
                        <div className="text-xs font-mono text-[var(--color-text-muted)]">
                          {div.clave}
                        </div>
                      </div>
                      <div className="w-4 h-4 rounded-full" style={{ background: div.color }} />
                      <button
                        onClick={() => handleEditDivision(div)}
                        className="text-xs border-none bg-transparent cursor-pointer text-blue-500 hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDeleteDivision(div.id)}
                        className="text-xs border-none bg-transparent cursor-pointer text-red-500 hover:underline"
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
            <div className={cardCls}>
              <label className={labelCls}>
                {editEtapaId !== null ? "Editar etapa" : "Nueva etapa"}
              </label>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {ICON_OPTIONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setEtapaForm((f) => ({ ...f, icon: ic }))}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg cursor-pointer border transition-colors ${
                      etapaForm.icon === ic
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                    }`}
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
                      className="w-10 h-10 rounded-lg border border-[var(--color-border)] cursor-pointer bg-transparent p-0.5"
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
                  className="flex-1 py-3 rounded-xl text-white font-display font-bold text-sm border-none cursor-pointer"
                  style={{ background: C.amber }}
                >
                  {editEtapaId !== null ? "Actualizar" : "Agregar"}
                </button>
                {editEtapaId !== null && (
                  <button
                    onClick={() => {
                      setEditEtapaId(null);
                      setEtapaForm({ icon: "📋", codigo: "", nombre: "", color: "#F97316" });
                    }}
                    className="py-3 px-5 rounded-xl text-sm border border-[var(--color-border)] cursor-pointer bg-[var(--color-surface)] text-[var(--color-text)]"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>

            {etapas.length > 0 && (
              <div className={cardCls}>
                <label className={labelCls}>Etapas ({etapas.length})</label>
                <div className="flex flex-col gap-2">
                  {etapas.map((etapa) => (
                    <div
                      key={etapa.id}
                      className="flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)]"
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-lg"
                        style={{ background: etapa.color + "22" }}
                      >
                        {etapa.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-display font-bold text-[var(--color-text)] truncate">
                          {etapa.nombre}
                        </div>
                        <div className="text-xs font-mono text-[var(--color-text-muted)]">
                          {etapa.codigo}
                        </div>
                      </div>
                      <div className="w-4 h-4 rounded-full" style={{ background: etapa.color }} />
                      <button
                        onClick={() => handleEditEtapa(etapa)}
                        className="text-xs border-none bg-transparent cursor-pointer text-blue-500 hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDeleteEtapa(etapa.id)}
                        className="text-xs border-none bg-transparent cursor-pointer text-red-500 hover:underline"
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
    <div className="flex flex-col h-full text-[var(--color-text)] font-body overflow-hidden">
      {/* Tab bar */}
      <div className="flex overflow-x-auto px-4 py-3 gap-1.5 border-b border-[var(--color-border)] shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-xs font-display font-bold whitespace-nowrap border-none cursor-pointer shrink-0 transition-colors ${
              tab === t.key
                ? 'text-white'
                : 'bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'
            }`}
            style={tab === t.key ? { background: C.amber } : {}}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {renderTabContent()}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-2xl text-sm font-semibold text-white shadow-lg animate-fade-in"
          style={{ background: toast.type === "error" ? C.red : C.green }}
        >
          {toast.msg}
        </div>
      )}

      {/* Saving overlay */}
      {saving && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-[var(--color-surface-raised)] rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-xl border border-[var(--color-border)]">
            <div
              className="w-8 h-8 rounded-full border-[3px] border-t-transparent animate-spin"
              style={{ borderColor: `${C.amber} transparent ${C.amber} ${C.amber}` }}
            />
            <span className="text-sm font-display font-bold text-[var(--color-text)]">
              Guardando...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
