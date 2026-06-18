'use client';
import { useState, useRef } from 'react';
import { sb, getToken } from './lib/supabase';
import { C, fH, fB, fM, setColoresEmpresa } from './lib/theme';
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
  const headers = lines[0].toLowerCase().split(",").map(h => h.trim().replace(/^\uFEFF/, ""));
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
function apodoDe(n) { const p = n.split(" ").filter(Boolean); return p.length >= 2 ? p[1] : p[0]; }

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
  const [csvText, setCsvText] = useState("");
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

  // ─── Editar divisiones inline ───
  const addDiv = () => setDivisiones(p => [...p, { clave: `div_${p.length+1}`, label: "Nueva división", icon: "📦", color: "#F97316" }]);
  const updDiv = (i, k, v) => setDivisiones(p => p.map((d, j) => j === i ? { ...d, [k]: v } : d));
  const delDiv = (i) => setDivisiones(p => p.filter((_, j) => j !== i));

  const addEt = () => setEtapas(p => [...p, { codigo: p.length + 1, nombre: "Nueva etapa", icon: "🔧", color: "#F97316" }]);
  const updEt = (i, k, v) => setEtapas(p => p.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const delEt = (i) => setEtapas(p => p.filter((_, j) => j !== i));

  // ─── Logo ───
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

  // ─── Empleados manuales ───
  const addEmp = () => setEmpleados(p => [...p, { nombre: "", legajo: "", division: "", rol: "operativo" }]);
  const updEmp = (i, k, v) => setEmpleados(p => p.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const delEmp = (i) => setEmpleados(p => p.filter((_, j) => j !== i));

  // ─── Importar CSV ───
  const onCsvFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      setCsvText(text);
      const parsed = parseEmpleadosCSV(text);
      setEmpleados(parsed);
    };
    reader.readAsText(f);
  };

  // ─── FINALIZAR ───
  const finalizar = async () => {
    setSaving(true); setError("");
    const eid = empresa?.id || usuario?.empresa_id;
    const token = getToken();
    try {
      // 1. Crear divisiones
      for (let i = 0; i < divisiones.length; i++) {
        const d = divisiones[i];
        await fetch("/api/config-empresa", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ action: "add_division", clave: d.clave, label: d.label, icon: d.icon, color: d.color, orden: i + 1 }),
        });
      }
      // 2. Crear etapas
      for (let i = 0; i < etapas.length; i++) {
        const e = etapas[i];
        await fetch("/api/config-empresa", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ action: "add_etapa", codigo: e.codigo, nombre: e.nombre, icon: e.icon, color: e.color, orden: i + 1 }),
        });
      }
      // 3. Subir logo si hay
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
      // 4. Actualizar empresa: rubro, colores, logo, onboarding_completado
      const empresaUpdates = {
        rubro: rubro || "otro",
        color_primario: colorPrim,
        color_secundario: colorSec,
        onboarding_completado: true,
      };
      if (logoUrl) empresaUpdates.logo_url = logoUrl;
      await sb.patch(`empresa?id=eq.${eid}`, empresaUpdates);

      // 5. Crear empleados — vía /api/empleados para que el hash de password
      //    se haga en el servidor (bcrypt), nunca en texto plano en la DB.
      for (const e of empleados) {
        if (!e.nombre?.trim()) continue;
        const legajo = (e.legajo && /^\d+$/.test(e.legajo.trim())) ? parseInt(e.legajo.trim()) : legajoProv();
        try {
          const r = await fetch("/api/empleados", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({
              legajo,
              nombre: e.nombre.trim(),
              email: null,
              area: "produccion",
              division: e.division || null,
              rol: e.rol || "operativo",
            }),
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            console.error("Alta empleado falló:", d.error || r.status);
          }
        } catch (err) { console.error("Alta empleado falló:", err); }
      }

      // 6. Aplicar colores en vivo y avisar al padre
      setColoresEmpresa(colorPrim, colorSec);
      trackOnboarding('onboarding_complete', {
        rubro: rubro || 'otro',
        divisiones: divisiones.length,
        etapas: etapas.length,
        empleados: empleados.length,
        tienelogo: !!logoUrl,
      });
      onComplete && onComplete({ ...empresa, ...updEmp, logo_url: logoUrl });
    } catch (err) {
      setError(err.message || "Error finalizando onboarding");
      setSaving(false);
    }
  };

  // ─── Estilos ───
  const card = { background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 12 };
  const input = { width: "100%", padding: "10px 12px", borderRadius: 10, background: C.surfHi, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, fontFamily: fB, outline: "none", boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 };
  const btnS = { padding: "12px 20px", borderRadius: 12, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer" };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "0 18px 24px", fontFamily: fB }}>
      {/* Header con progreso */}
      <div style={{ padding: "20px 0 16px", borderBottom: `1px solid ${C.border}`, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Configuración inicial</div>
        <h1 style={{ margin: "4px 0 12px", fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.text }}>Paso {step} de 4</h1>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 2, 3, 4].map(s => <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= step ? C.amber : C.surfHi }} />)}
        </div>
      </div>

      {/* PASO 1: RUBRO + PLANTILLA */}
      {step === 1 && <>
        <h2 style={{ margin: "0 0 6px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>¿De qué rubro es tu empresa?</h2>
        <p style={{ fontSize: 12, color: C.dim, marginBottom: 14 }}>Elegí uno y te proponemos divisiones y etapas. Podés editarlas debajo.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 16 }}>
          {Object.entries(PLANTILLAS).map(([k, v]) => (
            <button key={k} onClick={() => aplicarPlantilla(k)} style={{ padding: "10px 8px", borderRadius: 10, border: `1px solid ${rubro === k ? C.amber : C.border}`, background: rubro === k ? `${C.amber}15` : C.surface, color: rubro === k ? C.amber : C.text, fontSize: 12, fontWeight: 600, fontFamily: fB, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 16 }}>{v.icon}</span><span>{v.label}</span>
            </button>
          ))}
        </div>

        {rubro && <>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={lbl}>Divisiones ({divisiones.length})</span>
              <button onClick={addDiv} style={{ ...btnS, padding: "6px 12px", fontSize: 11 }}>+ Agregar</button>
            </div>
            {divisiones.map((d, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "40px 60px 1fr 32px 32px", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <input value={d.icon} onChange={e => updDiv(i, "icon", e.target.value)} style={{ ...input, textAlign: "center", padding: "8px 4px" }} maxLength={4} />
                <input value={d.clave} onChange={e => updDiv(i, "clave", e.target.value)} style={{ ...input, padding: "8px", fontSize: 11 }} placeholder="clave" />
                <input value={d.label} onChange={e => updDiv(i, "label", e.target.value)} style={{ ...input, padding: "8px" }} placeholder="Nombre" />
                <input type="color" value={d.color} onChange={e => updDiv(i, "color", e.target.value)} style={{ width: 32, height: 36, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", background: "transparent" }} />
                <button onClick={() => delDiv(i)} style={{ width: 32, height: 36, borderRadius: 8, border: "none", background: `${C.red}18`, color: C.red, cursor: "pointer", fontSize: 14 }}>✕</button>
              </div>
            ))}
            {divisiones.length === 0 && <div style={{ padding: 14, textAlign: "center", color: C.dim, fontSize: 12 }}>Sin divisiones — agregá una o aplicá una plantilla</div>}
          </div>

          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={lbl}>Etapas de trabajo ({etapas.length})</span>
              <button onClick={addEt} style={{ ...btnS, padding: "6px 12px", fontSize: 11 }}>+ Agregar</button>
            </div>
            {etapas.map((e, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "40px 50px 1fr 32px 32px", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <input value={e.icon} onChange={ev => updEt(i, "icon", ev.target.value)} style={{ ...input, textAlign: "center", padding: "8px 4px" }} maxLength={4} />
                <input value={e.codigo} onChange={ev => updEt(i, "codigo", parseInt(ev.target.value) || 0)} type="number" style={{ ...input, padding: "8px", textAlign: "center" }} />
                <input value={e.nombre} onChange={ev => updEt(i, "nombre", ev.target.value)} style={{ ...input, padding: "8px" }} placeholder="Nombre" />
                <input type="color" value={e.color} onChange={ev => updEt(i, "color", ev.target.value)} style={{ width: 32, height: 36, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", background: "transparent" }} />
                <button onClick={() => delEt(i)} style={{ width: 32, height: 36, borderRadius: 8, border: "none", background: `${C.red}18`, color: C.red, cursor: "pointer", fontSize: 14 }}>✕</button>
              </div>
            ))}
            {etapas.length === 0 && <div style={{ padding: 14, textAlign: "center", color: C.dim, fontSize: 12 }}>Sin etapas</div>}
          </div>
        </>}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
          <Button variant="secondary" onClick={() => { saltarPlantilla(); trackOnboarding('onboarding_skip', { step: 1 }); setStep(2); }}>Saltar este paso</Button>
          <Button variant="primary" onClick={() => setStep(2)}>Siguiente →</Button>
        </div>
      </>}

      {/* PASO 2: PERSONALIZACIÓN */}
      {step === 2 && <>
        <h2 style={{ margin: "0 0 6px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>Personalización</h2>
        <p style={{ fontSize: 12, color: C.dim, marginBottom: 14 }}>Logo y colores. Podés saltarlo y editarlo después.</p>

        <div style={card}>
          <label style={lbl}>Logo</label>
          {logoPreview && <div style={{ textAlign: "center", marginBottom: 10 }}>
            <img src={logoPreview} alt="logo" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 12, background: C.bg, padding: 6 }} />
          </div>}
          <input ref={fileLogoRef} type="file" accept="image/*" hidden onChange={onLogoFile} />
          <button onClick={() => fileLogoRef.current?.click()} style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surfHi, color: C.text, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {logoPreview ? "🔄 Cambiar logo" : "📤 Subir logo"}
          </button>
        </div>

        <div style={card}>
          <label style={lbl}>Color primario</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <input type="color" value={colorPrim} onChange={e => setColorPrim(e.target.value)} style={{ width: 50, height: 40, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", background: "transparent" }} />
            <div style={{ flex: 1, height: 40, borderRadius: 10, background: colorPrim, display: "flex", alignItems: "center", justifyContent: "center", color: "#000", fontFamily: fM, fontSize: 12, fontWeight: 700 }}>{colorPrim}</div>
          </div>
          <label style={lbl}>Color secundario</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="color" value={colorSec} onChange={e => setColorSec(e.target.value)} style={{ width: 50, height: 40, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", background: "transparent" }} />
            <div style={{ flex: 1, height: 40, borderRadius: 10, background: colorSec, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: fM, fontSize: 12, fontWeight: 700 }}>{colorSec}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <Button variant="secondary" onClick={() => setStep(1)}>← Atrás</Button>
          <Button variant="primary" onClick={() => setStep(3)}>Siguiente →</Button>
        </div>
      </>}

      {/* PASO 3: EMPLEADOS */}
      {step === 3 && <>
        <h2 style={{ margin: "0 0 6px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>Cargá empleados</h2>
        <p style={{ fontSize: 12, color: C.dim, marginBottom: 14 }}>Manual, CSV, o saltá y hacelo después.</p>

        <div style={card}>
          <label style={lbl}>Importar CSV</label>
          <p style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>Columnas: <code>nombre, legajo, division, rol</code> (la primera fila debe tener los encabezados)</p>
          <input ref={fileCsvRef} type="file" accept=".csv,text/csv" hidden onChange={onCsvFile} />
          <button onClick={() => fileCsvRef.current?.click()} style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${C.cyan}40`, background: `${C.cyan}10`, color: C.cyan, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📤 Subir archivo .csv</button>
        </div>

        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={lbl}>Empleados ({empleados.length})</span>
            <button onClick={addEmp} style={{ ...btnS, padding: "6px 12px", fontSize: 11 }}>+ Agregar</button>
          </div>
          {empleados.map((e, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 70px 90px 32px", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input value={e.nombre} onChange={ev => updEmp(i, "nombre", ev.target.value)} style={{ ...input, padding: "8px" }} placeholder="Nombre completo" />
              <input value={e.legajo} onChange={ev => updEmp(i, "legajo", ev.target.value)} style={{ ...input, padding: "8px" }} placeholder="Legajo" />
              <select value={e.division} onChange={ev => updEmp(i, "division", ev.target.value)} style={{ ...input, padding: "8px", cursor: "pointer" }}>
                <option value="">División</option>
                {divisiones.map(d => <option key={d.clave} value={d.clave}>{d.label}</option>)}
              </select>
              <button onClick={() => delEmp(i)} style={{ width: 32, height: 36, borderRadius: 8, border: "none", background: `${C.red}18`, color: C.red, cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>
          ))}
          {empleados.length === 0 && <div style={{ padding: 14, textAlign: "center", color: C.dim, fontSize: 12 }}>Sin empleados todavía</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <Button variant="secondary" onClick={() => setStep(2)}>← Atrás</Button>
          <Button variant="primary" onClick={() => setStep(4)}>Siguiente →</Button>
        </div>
      </>}

      {/* PASO 4: RESUMEN */}
      {step === 4 && <>
        <h2 style={{ margin: "0 0 6px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>Listo para empezar</h2>
        <p style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Revisá la configuración y confirmá.</p>

        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><span style={{ color: C.dim, fontSize: 13 }}>Rubro</span><span style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{rubro ? PLANTILLAS[rubro]?.label : "Sin definir"}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${C.border}` }}><span style={{ color: C.dim, fontSize: 13 }}>Divisiones</span><span style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{divisiones.length}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${C.border}` }}><span style={{ color: C.dim, fontSize: 13 }}>Etapas</span><span style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{etapas.length}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${C.border}` }}><span style={{ color: C.dim, fontSize: 13 }}>Logo</span><span style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{logoPreview ? "✅ Cargado" : "—"}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${C.border}` }}><span style={{ color: C.dim, fontSize: 13 }}>Colores</span><span style={{ display: "flex", gap: 4 }}><span style={{ width: 18, height: 18, borderRadius: 4, background: colorPrim }} /><span style={{ width: 18, height: 18, borderRadius: 4, background: colorSec }} /></span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${C.border}` }}><span style={{ color: C.dim, fontSize: 13 }}>Empleados</span><span style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{empleados.length}</span></div>
        </div>

        {error && <div style={{ padding: 12, background: `${C.red}15`, color: C.red, borderRadius: 10, fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <Button variant="secondary" onClick={() => setStep(3)} disabled={saving}>← Atrás</Button>
          <Button variant="primary" onClick={finalizar} disabled={saving} loading={saving}>
            {saving ? "Guardando..." : "🚀 Empezar a usar Gypi"}
          </Button>
        </div>
      </>}
    </div>
  );
}