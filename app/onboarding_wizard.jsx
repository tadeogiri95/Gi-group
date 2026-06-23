'use client';
import { useState, useRef } from 'react';
import { sb, getToken } from './lib/supabase';
import { setColoresEmpresa } from './lib/theme';

import { Button } from './components/ui';

function trackOnboarding(evento, meta = {}) {
  const token = getToken();
  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ evento, meta }),
  }).catch(() => {});
}

/* ═══ PLANTILLAS POR RUBRO ═══ */
const PLANTILLAS = {
  industria: {
    label: "Industria / Manufactura", icon: "🏭",
    divisiones: [
      { clave: "produccion", label: "Producción", icon: "🏭", color: "#F97316" },
      { clave: "herreria", label: "Herrería", icon: "🔥", color: "#EF4444" },
      { clave: "carpinteria", label: "Carpintería", icon: "🪵", color: "#22C55E" },
      { clave: "pintura", label: "Pintura", icon: "🎨", color: "#A78BFA" },
      { clave: "logistica", label: "Logística", icon: "🚚", color: "#06B6D4" },
    ],
    etapas: [
      { codigo: 1, nombre: "Corte", icon: "✂️", color: "#F97316" },
      { codigo: 2, nombre: "Armado", icon: "🔧", color: "#22C55E" },
      { codigo: 3, nombre: "Soldadura", icon: "🔥", color: "#EF4444" },
      { codigo: 4, nombre: "Pintura", icon: "🎨", color: "#A78BFA" },
      { codigo: 5, nombre: "Embalaje", icon: "📦", color: "#06B6D4" },
      { codigo: 6, nombre: "Instalación", icon: "🏗️", color: "#F59E0B" },
    ],
  },
  construccion: {
    label: "Construcción", icon: "🏗️",
    divisiones: [
      { clave: "obra", label: "Obra", icon: "🏗️", color: "#F97316" },
      { clave: "taller", label: "Taller", icon: "🔧", color: "#22C55E" },
      { clave: "oficina", label: "Oficina", icon: "💼", color: "#06B6D4" },
    ],
    etapas: [
      { codigo: 1, nombre: "Demolición", icon: "💥", color: "#EF4444" },
      { codigo: 2, nombre: "Albañilería", icon: "🧱", color: "#F97316" },
      { codigo: 3, nombre: "Inst. eléctrica", icon: "⚡", color: "#F59E0B" },
      { codigo: 4, nombre: "Plomería", icon: "🚰", color: "#06B6D4" },
      { codigo: 5, nombre: "Pintura", icon: "🎨", color: "#A78BFA" },
      { codigo: 6, nombre: "Terminaciones", icon: "✨", color: "#22C55E" },
    ],
  },
  servicios: {
    label: "Servicios", icon: "🛠️",
    divisiones: [
      { clave: "operaciones", label: "Operaciones", icon: "⚙️", color: "#F97316" },
      { clave: "soporte", label: "Soporte", icon: "🎧", color: "#06B6D4" },
      { clave: "administracion", label: "Administración", icon: "📋", color: "#A78BFA" },
    ],
    etapas: [
      { codigo: 1, nombre: "Recepción", icon: "📥", color: "#06B6D4" },
      { codigo: 2, nombre: "Ejecución", icon: "🔧", color: "#F97316" },
      { codigo: 3, nombre: "Control", icon: "✅", color: "#22C55E" },
      { codigo: 4, nombre: "Entrega", icon: "📦", color: "#A78BFA" },
    ],
  },
  comercio: {
    label: "Comercio", icon: "🛒",
    divisiones: [
      { clave: "ventas", label: "Ventas", icon: "💰", color: "#22C55E" },
      { clave: "deposito", label: "Depósito", icon: "📦", color: "#F97316" },
      { clave: "administracion", label: "Administración", icon: "📋", color: "#A78BFA" },
    ],
    etapas: [
      { codigo: 1, nombre: "Recepción", icon: "📥", color: "#06B6D4" },
      { codigo: 2, nombre: "Stock", icon: "📦", color: "#F97316" },
      { codigo: 3, nombre: "Venta", icon: "💰", color: "#22C55E" },
      { codigo: 4, nombre: "Entrega", icon: "🚚", color: "#A78BFA" },
    ],
  },
  tecnologia: {
    label: "Tecnología", icon: "💻",
    divisiones: [
      { clave: "desarrollo", label: "Desarrollo", icon: "💻", color: "#06B6D4" },
      { clave: "qa", label: "QA", icon: "🐛", color: "#F59E0B" },
      { clave: "soporte", label: "Soporte", icon: "🎧", color: "#22C55E" },
      { clave: "infra", label: "Infraestructura", icon: "🖥️", color: "#A78BFA" },
    ],
    etapas: [
      { codigo: 1, nombre: "Análisis", icon: "🔍", color: "#06B6D4" },
      { codigo: 2, nombre: "Desarrollo", icon: "💻", color: "#F97316" },
      { codigo: 3, nombre: "Testing", icon: "🧪", color: "#F59E0B" },
      { codigo: 4, nombre: "Deploy", icon: "🚀", color: "#22C55E" },
      { codigo: 5, nombre: "Mantenimiento", icon: "🔧", color: "#A78BFA" },
    ],
  },
  salud: {
    label: "Salud", icon: "🏥",
    divisiones: [
      { clave: "atencion", label: "Atención", icon: "🩺", color: "#06B6D4" },
      { clave: "enfermeria", label: "Enfermería", icon: "💉", color: "#22C55E" },
      { clave: "administracion", label: "Administración", icon: "📋", color: "#A78BFA" },
    ],
    etapas: [
      { codigo: 1, nombre: "Recepción", icon: "📋", color: "#06B6D4" },
      { codigo: 2, nombre: "Consulta", icon: "🩺", color: "#22C55E" },
      { codigo: 3, nombre: "Tratamiento", icon: "💊", color: "#F97316" },
      { codigo: 4, nombre: "Alta", icon: "✅", color: "#A78BFA" },
    ],
  },
  educacion: {
    label: "Educación", icon: "📚",
    divisiones: [
      { clave: "docencia", label: "Docencia", icon: "👨‍🏫", color: "#F97316" },
      { clave: "administracion", label: "Administración", icon: "📋", color: "#A78BFA" },
      { clave: "mantenimiento", label: "Mantenimiento", icon: "🔧", color: "#22C55E" },
    ],
    etapas: [
      { codigo: 1, nombre: "Planificación", icon: "📅", color: "#06B6D4" },
      { codigo: 2, nombre: "Clase", icon: "📚", color: "#F97316" },
      { codigo: 3, nombre: "Evaluación", icon: "📝", color: "#A78BFA" },
    ],
  },
  logistica: {
    label: "Logística", icon: "🚚",
    divisiones: [
      { clave: "deposito", label: "Depósito", icon: "📦", color: "#F97316" },
      { clave: "transporte", label: "Transporte", icon: "🚚", color: "#06B6D4" },
      { clave: "administracion", label: "Administración", icon: "📋", color: "#A78BFA" },
    ],
    etapas: [
      { codigo: 1, nombre: "Recepción", icon: "📥", color: "#06B6D4" },
      { codigo: 2, nombre: "Almacenamiento", icon: "📦", color: "#F97316" },
      { codigo: 3, nombre: "Picking", icon: "🛒", color: "#F59E0B" },
      { codigo: 4, nombre: "Despacho", icon: "🚚", color: "#22C55E" },
    ],
  },
  gastronomia: {
    label: "Gastronomía", icon: "🍴",
    divisiones: [
      { clave: "cocina", label: "Cocina", icon: "👨‍🍳", color: "#EF4444" },
      { clave: "salon", label: "Salón", icon: "🍽️", color: "#F97316" },
      { clave: "delivery", label: "Delivery", icon: "🛵", color: "#06B6D4" },
    ],
    etapas: [
      { codigo: 1, nombre: "Preparación", icon: "🥕", color: "#22C55E" },
      { codigo: 2, nombre: "Cocción", icon: "🔥", color: "#EF4444" },
      { codigo: 3, nombre: "Emplatado", icon: "🍽️", color: "#F97316" },
      { codigo: 4, nombre: "Servicio", icon: "🛎️", color: "#A78BFA" },
    ],
  },
  otro: {
    label: "Otro / General", icon: "📦",
    divisiones: [
      { clave: "general", label: "General", icon: "📦", color: "#F97316" },
    ],
    etapas: [
      { codigo: 1, nombre: "Tarea general", icon: "🔧", color: "#F97316" },
    ],
  },
};

/* ═══ HELPERS CSV ═══ */
function parseEmpleadosCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].toLowerCase().split(",").map(h => h.trim().replace(/^﻿/, ""));
  const idxNombre = headers.findIndex(h => h.includes("nombre"));
  const idxLegajo = headers.findIndex(h => h.includes("legajo") || h.includes("dni"));
  const idxDiv = headers.findIndex(h => h.includes("division") || h.includes("división"));
  const idxRol = headers.findIndex(h => h.includes("rol"));
  if (idxNombre < 0) return [];
  return lines.slice(1).map(line => {
    const cols = line.split(",").map(c => c.trim());
    return {
      nombre: cols[idxNombre] || "",
      legajo: idxLegajo >= 0 ? cols[idxLegajo] || "" : "",
      division: idxDiv >= 0 ? cols[idxDiv] || "" : "",
      rol: idxRol >= 0 ? cols[idxRol] || "operativo" : "operativo",
    };
  }).filter(r => r.nombre.length > 2);
}

function legajoProv() { return Math.floor(Date.now() / 1000) % 900000 + 100000; }

function csvField(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function OnboardingWizard({ empresa, usuario, onComplete }) {
  const [step, setStepRaw] = useState(1);
  const stepRef = useRef(1);
  const setStep = (s) => {
    trackOnboarding('onboarding_step', { from: stepRef.current, to: s });
    stepRef.current = s;
    setStepRaw(s);
  };
  const [rubro, setRubro] = useState(empresa?.rubro || "");
  const [divisiones, setDivisiones] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [colorPrim, setColorPrim] = useState(empresa?.color_primario || "#F97316");
  const [colorSec, setColorSec] = useState(empresa?.color_secundario || "#8B5CF6");
  const [logoBase64, setLogoBase64] = useState(null);
  const [logoPreview, setLogoPreview] = useState(empresa?.logo_url || null);
  const [empleados, setEmpleados] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileLogoRef = useRef(null);
  const fileCsvRef = useRef(null);

  const aplicarPlantilla = (r) => {
    setRubro(r);
    const p = PLANTILLAS[r];
    if (p) {
      setDivisiones(p.divisiones.map(d => ({ ...d })));
      setEtapas(p.etapas.map(e => ({ ...e })));
    }
  };

  const saltarPlantilla = () => { setDivisiones([]); setEtapas([]); };

  const addDiv = () => setDivisiones(p => [...p, { clave: `div_${p.length+1}`, label: "Nueva división", icon: "📦", color: "#F97316" }]);
  const updDiv = (i, k, v) => setDivisiones(p => p.map((d, j) => j === i ? { ...d, [k]: v } : d));
  const delDiv = (i) => setDivisiones(p => p.filter((_, j) => j !== i));

  const addEt = () => setEtapas(p => [...p, { codigo: p.length + 1, nombre: "Nueva etapa", icon: "🔧", color: "#F97316" }]);
  const updEt = (i, k, v) => setEtapas(p => p.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const delEt = (i) => setEtapas(p => p.filter((_, j) => j !== i));

  const onLogoFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setError("Logo: máx 2MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(",")[1];
      setLogoBase64({ base64: b64, type: f.type, ext: f.name.split(".").pop() || "png" });
      setLogoPreview(reader.result);
    };
    reader.readAsDataURL(f);
  };

  const addEmp = () => setEmpleados(p => [...p, { nombre: "", legajo: "", division: "", rol: "operativo" }]);
  const updEmp = (i, k, v) => setEmpleados(p => p.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const delEmp = (i) => setEmpleados(p => p.filter((_, j) => j !== i));

  const onCsvFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseEmpleadosCSV(reader.result);
      setEmpleados(parsed);
    };
    reader.readAsText(f);
  };

  const finalizar = async () => {
    setSaving(true); setError("");
    const eid = empresa?.id || usuario?.empresa_id;
    const token = getToken();
    try {
      await Promise.all([
        ...divisiones.map((d, i) => fetch("/api/config-empresa", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ action: "add_division", clave: d.clave, label: d.label, icon: d.icon, color: d.color, orden: i + 1 }),
        })),
        ...etapas.map((e, i) => fetch("/api/config-empresa", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ action: "add_etapa", codigo: e.codigo, nombre: e.nombre, icon: e.icon, color: e.color, orden: i + 1 }),
        })),
      ]);
      let logoUrl = empresa?.logo_url || null;
      if (logoBase64) {
        const fileName = `logos/${eid}_${Date.now()}.${logoBase64.ext}`;
        try {
          const r = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ fileName, fileBase64: logoBase64.base64, fileType: logoBase64.type }),
          });
          const d = await r.json();
          if (d.ok && d.url) logoUrl = d.url;
          else logoUrl = `data:${logoBase64.type};base64,${logoBase64.base64}`;
        } catch { logoUrl = `data:${logoBase64.type};base64,${logoBase64.base64}`; }
      }
      const empresaUpdates = {
        rubro: rubro || "otro",
        color_primario: colorPrim,
        color_secundario: colorSec,
        onboarding_completado: true,
      };
      if (logoUrl) empresaUpdates.logo_url = logoUrl;
      await sb.patch(`empresa?id=eq.${eid}`, empresaUpdates);

      const empleadosValidos = empleados.filter(e => e.nombre?.trim());
      if (empleadosValidos.length > 0) {
        let provSeq = legajoProv();
        const filas = empleadosValidos.map(e => {
          const legajo = (e.legajo && /^\d+$/.test(e.legajo.trim())) ? parseInt(e.legajo.trim(), 10) : provSeq++;
          return [legajo, e.nombre.trim(), e.division || "", e.rol || "operativo"];
        });
        const csvBody = ["legajo,nombre,division,rol", ...filas.map(f => f.map(csvField).join(","))].join("\n");
        try {
          const r = await fetch("/api/empleados/import-csv", {
            method: "POST",
            headers: { "Content-Type": "text/plain", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: csvBody,
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || d.error) console.error("Alta de empleados falló:", d.error || r.status);
          else if (d.errors?.length) console.error("Alta de empleados — filas con error:", d.errors);
        } catch (err) { console.error("Alta de empleados falló:", err); }
      }

      setColoresEmpresa(colorPrim, colorSec);
      trackOnboarding('onboarding_complete', {
        rubro: rubro || 'otro',
        divisiones: divisiones.length,
        etapas: etapas.length,
        empleados: empleados.length,
        tienelogo: !!logoUrl,
      });
      onComplete && onComplete({ ...empresa, ...empresaUpdates, logo_url: logoUrl });
    } catch (err) {
      setError(err.message || "Error finalizando onboarding");
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6 font-body">
      {/* Header con progreso */}
      <div className="pt-5 pb-4 border-b border-gypi-border mb-4">
        <div className="g-overline text-gypi-amber">Configuración inicial</div>
        <h1 className="mt-1 mb-3 font-heading text-[22px] font-bold text-gypi-text">Paso {step} de 4</h1>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`flex-1 h-1 rounded-sm ${s <= step ? 'bg-gypi-amber' : 'bg-gypi-surf-hi'}`} />
          ))}
        </div>
      </div>

      {/* PASO 1: RUBRO + PLANTILLA */}
      {step === 1 && <>
        <h2 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">¿De qué rubro es tu empresa?</h2>
        <p className="text-xs text-gypi-dim mb-3.5">Elegí uno y te proponemos divisiones y etapas. Podés editarlas debajo.</p>
        <div className="grid grid-cols-2 gap-1.5 mb-4">
          {Object.entries(PLANTILLAS).map(([k, v]) => (
            <button
              key={k}
              onClick={() => aplicarPlantilla(k)}
              className={`p-2.5 rounded-[10px] border text-xs font-semibold font-body cursor-pointer text-left flex items-center gap-1.5 ${
                rubro === k
                  ? 'border-gypi-amber bg-gypi-amber/[0.08] text-gypi-amber'
                  : 'border-gypi-border bg-gypi-surface text-gypi-text'
              }`}
            >
              <span className="text-base">{v.icon}</span><span>{v.label}</span>
            </button>
          ))}
        </div>

        {rubro && <>
          <div className="g-card mb-3">
            <div className="flex justify-between items-center mb-2.5">
              <span className="g-label">Divisiones ({divisiones.length})</span>
              <button onClick={addDiv} className="g-btn-ghost text-[11px] py-1.5 px-3 rounded-[var(--radius-md)] border border-gypi-border font-semibold">+ Agregar</button>
            </div>
            {divisiones.map((d, i) => (
              <div key={i} className="grid grid-cols-[40px_60px_1fr_32px_32px] gap-1.5 mb-1.5 items-center">
                <input value={d.icon} onChange={e => updDiv(i, "icon", e.target.value)} className="g-input text-center !py-2 !px-1" maxLength={4} />
                <input value={d.clave} onChange={e => updDiv(i, "clave", e.target.value)} className="g-input !py-2 !px-2 text-[11px]" placeholder="clave" />
                <input value={d.label} onChange={e => updDiv(i, "label", e.target.value)} className="g-input !py-2 !px-2" placeholder="Nombre" />
                <input type="color" value={d.color} onChange={e => updDiv(i, "color", e.target.value)} className="w-8 h-9 border border-gypi-border rounded-lg cursor-pointer bg-transparent" />
                <button onClick={() => delDiv(i)} className="w-8 h-9 rounded-lg border-none bg-red-500/10 text-gypi-red cursor-pointer text-sm">✕</button>
              </div>
            ))}
            {divisiones.length === 0 && <div className="py-3.5 text-center text-gypi-dim text-xs">Sin divisiones — agregá una o aplicá una plantilla</div>}
          </div>

          <div className="g-card mb-3">
            <div className="flex justify-between items-center mb-2.5">
              <span className="g-label">Etapas de trabajo ({etapas.length})</span>
              <button onClick={addEt} className="g-btn-ghost text-[11px] py-1.5 px-3 rounded-[var(--radius-md)] border border-gypi-border font-semibold">+ Agregar</button>
            </div>
            {etapas.map((e, i) => (
              <div key={i} className="grid grid-cols-[40px_50px_1fr_32px_32px] gap-1.5 mb-1.5 items-center">
                <input value={e.icon} onChange={ev => updEt(i, "icon", ev.target.value)} className="g-input text-center !py-2 !px-1" maxLength={4} />
                <input value={e.codigo} onChange={ev => updEt(i, "codigo", parseInt(ev.target.value) || 0)} type="number" className="g-input !py-2 !px-2 text-center" />
                <input value={e.nombre} onChange={ev => updEt(i, "nombre", ev.target.value)} className="g-input !py-2 !px-2" placeholder="Nombre" />
                <input type="color" value={e.color} onChange={ev => updEt(i, "color", ev.target.value)} className="w-8 h-9 border border-gypi-border rounded-lg cursor-pointer bg-transparent" />
                <button onClick={() => delEt(i)} className="w-8 h-9 rounded-lg border-none bg-red-500/10 text-gypi-red cursor-pointer text-sm">✕</button>
              </div>
            ))}
            {etapas.length === 0 && <div className="py-3.5 text-center text-gypi-dim text-xs">Sin etapas</div>}
          </div>
        </>}

        <div className="flex justify-between gap-2 mt-4">
          <Button variant="secondary" onClick={() => { saltarPlantilla(); trackOnboarding('onboarding_skip', { step: 1 }); setStep(2); }}>Saltar este paso</Button>
          <Button variant="primary" onClick={() => setStep(2)}>Siguiente →</Button>
        </div>
      </>}

      {/* PASO 2: PERSONALIZACIÓN */}
      {step === 2 && <>
        <h2 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">Personalización</h2>
        <p className="text-xs text-gypi-dim mb-3.5">Logo y colores. Podés saltarlo y editarlo después.</p>

        <div className="g-card mb-3">
          <label className="g-label">Logo</label>
          {logoPreview && (
            <div className="text-center mb-2.5">
              <img src={logoPreview} alt="logo" className="max-w-[120px] max-h-[120px] rounded-xl bg-gypi-bg p-1.5" />
            </div>
          )}
          <input ref={fileLogoRef} type="file" accept="image/*" hidden onChange={onLogoFile} />
          <button onClick={() => fileLogoRef.current?.click()} className="w-full py-2.5 rounded-[10px] border border-gypi-border bg-gypi-surf-hi text-gypi-text text-xs font-semibold cursor-pointer">
            {logoPreview ? "🔄 Cambiar logo" : "📤 Subir logo"}
          </button>
        </div>

        <div className="g-card mb-3">
          <label className="g-label">Color primario</label>
          <div className="flex items-center gap-2.5 mb-3">
            <input type="color" value={colorPrim} onChange={e => setColorPrim(e.target.value)} className="w-[50px] h-10 border border-gypi-border rounded-lg cursor-pointer bg-transparent" />
            <div className="flex-1 h-10 rounded-[10px] flex items-center justify-center font-mono text-xs font-bold text-black" style={{ background: colorPrim }}>{colorPrim}</div>
          </div>
          <label className="g-label">Color secundario</label>
          <div className="flex items-center gap-2.5">
            <input type="color" value={colorSec} onChange={e => setColorSec(e.target.value)} className="w-[50px] h-10 border border-gypi-border rounded-lg cursor-pointer bg-transparent" />
            <div className="flex-1 h-10 rounded-[10px] flex items-center justify-center font-mono text-xs font-bold text-white" style={{ background: colorSec }}>{colorSec}</div>
          </div>
        </div>

        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={() => setStep(1)}>← Atrás</Button>
          <Button variant="primary" onClick={() => setStep(3)}>Siguiente →</Button>
        </div>
      </>}

      {/* PASO 3: EMPLEADOS */}
      {step === 3 && <>
        <h2 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">Cargá empleados</h2>
        <p className="text-xs text-gypi-dim mb-3.5">Manual, CSV, o saltá y hacelo después.</p>

        <div className="g-card mb-3">
          <label className="g-label">Importar CSV</label>
          <p className="text-[11px] text-gypi-dim mb-2">Columnas: <code className="font-mono">nombre, legajo, division, rol</code> (la primera fila debe tener los encabezados)</p>
          <input ref={fileCsvRef} type="file" accept=".csv,text/csv" hidden onChange={onCsvFile} />
          <button onClick={() => fileCsvRef.current?.click()} className="w-full py-2.5 rounded-[10px] border border-gypi-cyan/40 bg-gypi-cyan/10 text-gypi-cyan text-xs font-bold cursor-pointer">📤 Subir archivo .csv</button>
        </div>

        <div className="g-card mb-3">
          <div className="flex justify-between items-center mb-2.5">
            <span className="g-label">Empleados ({empleados.length})</span>
            <button onClick={addEmp} className="g-btn-ghost text-[11px] py-1.5 px-3 rounded-[var(--radius-md)] border border-gypi-border font-semibold">+ Agregar</button>
          </div>
          {empleados.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_90px_32px] gap-1.5 mb-1.5 items-center">
              <input value={e.nombre} onChange={ev => updEmp(i, "nombre", ev.target.value)} className="g-input !py-2 !px-2" placeholder="Nombre completo" />
              <input value={e.legajo} onChange={ev => updEmp(i, "legajo", ev.target.value)} className="g-input !py-2 !px-2" placeholder="Legajo" />
              <select value={e.division} onChange={ev => updEmp(i, "division", ev.target.value)} className="g-input !py-2 !px-2 cursor-pointer">
                <option value="">División</option>
                {divisiones.map(d => <option key={d.clave} value={d.clave}>{d.label}</option>)}
              </select>
              <button onClick={() => delEmp(i)} className="w-8 h-9 rounded-lg border-none bg-red-500/10 text-gypi-red cursor-pointer text-sm">✕</button>
            </div>
          ))}
          {empleados.length === 0 && <div className="py-3.5 text-center text-gypi-dim text-xs">Sin empleados todavía</div>}
        </div>

        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={() => setStep(2)}>← Atrás</Button>
          <Button variant="primary" onClick={() => setStep(4)}>Siguiente →</Button>
        </div>
      </>}

      {/* PASO 4: RESUMEN */}
      {step === 4 && <>
        <h2 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">Listo para empezar</h2>
        <p className="text-xs text-gypi-dim mb-4">Revisá la configuración y confirmá.</p>

        <div className="g-card mb-3">
          <div className="flex justify-between py-1.5"><span className="text-gypi-dim text-[13px]">Rubro</span><span className="text-gypi-text font-semibold text-[13px]">{rubro ? PLANTILLAS[rubro]?.label : "Sin definir"}</span></div>
          <div className="flex justify-between py-1.5 border-t border-gypi-border"><span className="text-gypi-dim text-[13px]">Divisiones</span><span className="text-gypi-text font-semibold text-[13px]">{divisiones.length}</span></div>
          <div className="flex justify-between py-1.5 border-t border-gypi-border"><span className="text-gypi-dim text-[13px]">Etapas</span><span className="text-gypi-text font-semibold text-[13px]">{etapas.length}</span></div>
          <div className="flex justify-between py-1.5 border-t border-gypi-border"><span className="text-gypi-dim text-[13px]">Logo</span><span className="text-gypi-text font-semibold text-[13px]">{logoPreview ? "✅ Cargado" : "—"}</span></div>
          <div className="flex justify-between py-1.5 border-t border-gypi-border items-center">
            <span className="text-gypi-dim text-[13px]">Colores</span>
            <span className="flex gap-1">
              <span className="w-[18px] h-[18px] rounded" style={{ background: colorPrim }} />
              <span className="w-[18px] h-[18px] rounded" style={{ background: colorSec }} />
            </span>
          </div>
          <div className="flex justify-between py-1.5 border-t border-gypi-border"><span className="text-gypi-dim text-[13px]">Empleados</span><span className="text-gypi-text font-semibold text-[13px]">{empleados.length}</span></div>
        </div>

        {error && <div role="alert" className="p-3 bg-gypi-red/10 text-gypi-red rounded-[10px] text-xs mb-2.5">{error}</div>}

        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={() => setStep(3)} disabled={saving}>← Atrás</Button>
          <Button variant="primary" onClick={finalizar} disabled={saving} loading={saving}>
            {saving ? "Guardando..." : "🚀 Empezar a usar Gypi"}
          </Button>
        </div>
      </>}
    </div>
  );
}
