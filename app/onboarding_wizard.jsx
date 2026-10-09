'use client';
import { useState, useRef, useEffect } from 'react';
import { sb, getToken } from './lib/supabase';
import { setColoresEmpresa } from './lib/theme';

import { Button } from './components/ui';
import { PasoPlanta, PasoHorario, PasoOT } from './components/onboarding/PasosAlta';
import { horarioTipoDefault, diagramaDesde, textoHorario } from './lib/onboarding';
import { imprimirTarjetas } from './lib/tarjetasQR';

const TOTAL_PASOS = 6;

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

/* ═══ BORRADOR (U-15) ═══
   Lo que lleva cargado se guarda en este navegador a cada cambio: si cierra la
   pestaña o se le apaga el celular, al volver sigue desde el mismo paso. El
   logo no se guarda (pesa demasiado); se vuelve a subir si hace falta. */
const claveBorrador = (eid) => `gypi_alta_${eid || "sin-empresa"}`;

function leerBorrador(eid) {
  try {
    const b = JSON.parse(localStorage.getItem(claveBorrador(eid)) || "null");
    return b && typeof b === "object" && b.v === 1 ? b : null;
  } catch { return null; }
}

function guardarBorrador(eid, datos) {
  try { localStorage.setItem(claveBorrador(eid), JSON.stringify({ v: 1, ...datos })); } catch { /* sin almacenamiento: sigue sin borrador */ }
}

function borrarBorrador(eid) {
  try { localStorage.removeItem(claveBorrador(eid)); } catch { /* nada */ }
}

// Colores de la marca por defecto (los mismos que trae la app).
const PRIM_DEF = "#F97316";
const SEC_DEF = "#8B5CF6";

const NOMBRES_PASOS = ["Tu empresa", "Ubicación", "Horario", "Equipo", "Primer trabajo", "Confirmar"];

function Fila({ label, children }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-t border-gypi-border first:border-t-0 items-center">
      <span className="text-gypi-dim text-[13px]">{label}</span>
      <span className="text-gypi-text font-semibold text-[13px] text-right">{children}</span>
    </div>
  );
}

/* La plantilla del rubro, para leer: sin claves, códigos ni colores. */
function VistaPlantilla({ divisiones, etapas }) {
  return (
    <div className="g-card mb-3">
      <div className="g-label">Sectores ({divisiones.length})</div>
      <ul className="flex flex-wrap gap-1.5 mb-3 list-none p-0 m-0">
        {divisiones.map(d => <li key={d.clave} className="px-2.5 py-1 rounded-full bg-gypi-surf-hi text-gypi-text text-[13px]">{d.icon} {d.label}</li>)}
      </ul>
      <div className="g-label">Etapas de trabajo ({etapas.length})</div>
      <ol className="flex flex-wrap gap-1.5 mb-2 list-none p-0 m-0">
        {etapas.map((e, i) => <li key={e.codigo} className="px-2.5 py-1 rounded-full bg-gypi-surf-hi text-gypi-text text-[13px]">{i + 1}. {e.nombre}</li>)}
      </ol>
      <p className="text-xs text-gypi-dim m-0">Las cambiás cuando quieras desde Más → Empresa. No hace falta acertar ahora.</p>
    </div>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function OnboardingWizard({ empresa, usuario, onComplete }) {
  const eid = empresa?.id || usuario?.empresa_id;
  const [borrador] = useState(() => leerBorrador(eid));
  const b = borrador || {};
  const [retomado, setRetomado] = useState(!!borrador);

  const pasoInicial = Number.isInteger(b.step) && b.step >= 1 && b.step <= TOTAL_PASOS ? b.step : 1;
  const [step, setStepRaw] = useState(pasoInicial);
  const stepRef = useRef(pasoInicial);
  const setStep = (s) => {
    trackOnboarding('onboarding_step', { from: stepRef.current, to: s });
    stepRef.current = s;
    setStepRaw(s);
  };
  const [nombreEmpresa, setNombreEmpresa] = useState(b.nombreEmpresa ?? (empresa?.nombre || ""));
  const [rubro, setRubro] = useState(b.rubro ?? (empresa?.rubro || ""));
  const [divisiones, setDivisiones] = useState(b.divisiones || []);
  const [etapas, setEtapas] = useState(b.etapas || []);
  const [colorPrim, setColorPrim] = useState(b.colorPrim || empresa?.color_primario || PRIM_DEF);
  const [colorSec, setColorSec] = useState(b.colorSec || empresa?.color_secundario || SEC_DEF);
  const [logoBase64, setLogoBase64] = useState(null);
  const [logoPreview, setLogoPreview] = useState(empresa?.logo_url || null);
  const [personalizar, setPersonalizar] = useState(false);
  const [empleados, setEmpleados] = useState(b.empleados || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [planta, setPlanta] = useState(b.planta || { nombre: "Planta", lat: null, lng: null, radio: 150, direccion: "" });
  const [horario, setHorario] = useState(b.horario || horarioTipoDefault);
  const [usarHorario, setUsarHorario] = useState(b.usarHorario ?? true);
  const [ot, setOt] = useState(b.ot || { ot: "", cliente: "", proyecto: "" });
  const [avisos, setAvisos] = useState([]);
  const [codigos, setCodigos] = useState(null); // códigos de activación del equipo recién cargado
  const [empresaFinal, setEmpresaFinal] = useState(null);
  const [envioEmail, setEnvioEmail] = useState({ estado: "", texto: "" });
  const fileLogoRef = useRef(null);
  const fileCsvRef = useRef(null);

  // Guarda el borrador a cada cambio, hasta terminar (el cierre con los QR no).
  useEffect(() => {
    if (step > TOTAL_PASOS) return;
    guardarBorrador(eid, { step, nombreEmpresa, rubro, divisiones, etapas, colorPrim, colorSec, empleados, planta, horario, usarHorario, ot });
  }, [eid, step, nombreEmpresa, rubro, divisiones, etapas, colorPrim, colorSec, empleados, planta, horario, usarHorario, ot]);

  const empezarDeNuevo = () => {
    borrarBorrador(eid);
    setNombreEmpresa(empresa?.nombre || ""); setRubro(""); setDivisiones([]); setEtapas([]);
    setColorPrim(empresa?.color_primario || PRIM_DEF); setColorSec(empresa?.color_secundario || SEC_DEF);
    setEmpleados([]); setPlanta({ nombre: "Planta", lat: null, lng: null, radio: 150, direccion: "" });
    setHorario(horarioTipoDefault); setUsarHorario(true); setOt({ ot: "", cliente: "", proyecto: "" });
    setRetomado(false); setStep(1);
  };

  const aplicarPlantilla = (r) => {
    setRubro(r);
    const p = PLANTILLAS[r];
    if (p) {
      setDivisiones(p.divisiones.map(d => ({ ...d })));
      setEtapas(p.etapas.map(e => ({ ...e })));
    }
  };

  const onLogoFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setError("El logo pesa más de 2 MB. Probá con una imagen más chica."); return; }
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

  const mandarPorEmail = async () => {
    setEnvioEmail({ estado: "enviando", texto: "" });
    const token = getToken();
    try {
      const r = await fetch("/api/empleados/tarjetas-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ tarjetas: (codigos || []).map(c => ({ legajo: c.legajo, codigo: c.codigo })) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "No pudimos mandar el email. Probá en un rato.");
      setEnvioEmail({ estado: "ok", texto: `Listo: te las mandamos a ${d.email}. Revisá también la carpeta de spam.` });
    } catch (err) {
      setEnvioEmail({ estado: "error", texto: err.message });
    }
  };

  const finalizar = async () => {
    setSaving(true); setError("");
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
      const pendientes = [];
      if (planta.lat != null && planta.lng != null) {
        try {
          await sb.post("geo_zonas", { nombre: planta.nombre.trim() || "Planta", lat: planta.lat, lng: planta.lng, radio: planta.radio });
        } catch { pendientes.push("la ubicación de la planta"); }
      }
      if (ot.ot.trim()) {
        try {
          await sb.post("proyectos", { ot: ot.ot.trim(), cliente: ot.cliente.trim() || null, proyecto: ot.proyecto.trim() || null, estado: "activo" });
        } catch { pendientes.push("la primera OT"); }
      }
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
        nombre: nombreEmpresa.trim(),
        rubro: rubro || "otro",
        color_primario: colorPrim,
        color_secundario: colorSec,
        onboarding_completado: true,
      };
      if (logoUrl) empresaUpdates.logo_url = logoUrl;
      await sb.patch(`empresa?id=eq.${eid}`, empresaUpdates);

      const empleadosValidos = empleados.filter(e => e.nombre?.trim());
      let activaciones = [];
      if (empleadosValidos.length > 0) {
        let provSeq = legajoProv();
        const filas = empleadosValidos.map(e => {
          const legajo = (e.legajo && /^\d+$/.test(e.legajo.trim())) ? parseInt(e.legajo.trim(), 10) : provSeq++;
          return [legajo, e.nombre.trim(), e.division || "", e.rol || "operativo"];
        });
        const csvBody = ["legajo,nombre,division,rol", ...filas.map(f => f.map(csvField).join(","))].join("\n");
        const diagrama = usarHorario ? diagramaDesde(horario) : null;
        try {
          const r = await fetch("/api/empleados/import-csv", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ csv: csvBody, ...(diagrama ? { diagrama } : {}) }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || d.error) { console.error("Alta de empleados falló:", d.error || r.status); pendientes.push("el equipo"); }
          else {
            if (d.errors?.length) { console.error("Alta de empleados — filas con error:", d.errors); pendientes.push(`${d.errors.length} empleado(s) con datos inválidos`); }
            activaciones = d.activaciones || [];
          }
        } catch (err) { console.error("Alta de empleados falló:", err); pendientes.push("el equipo"); }
      }

      setColoresEmpresa(colorPrim, colorSec);
      borrarBorrador(eid);
      trackOnboarding('onboarding_complete', {
        rubro: rubro || 'otro',
        divisiones: divisiones.length,
        etapas: etapas.length,
        empleados: empleados.length,
        tienelogo: !!logoUrl,
        ubicacion: planta.lat != null,
        horario: usarHorario,
        ot: !!ot.ot.trim(),
      });
      const final = { ...empresa, ...empresaUpdates, logo_url: logoUrl };
      // Con equipo nuevo o algo que no se pudo guardar, se muestra un cierre
      // antes de entrar (para imprimir los QR de activación).
      if (activaciones.length > 0 || pendientes.length > 0) {
        setAvisos(pendientes);
        setCodigos(activaciones);
        setEmpresaFinal(final);
        setSaving(false);
        setStep(TOTAL_PASOS + 1);
        return;
      }
      onComplete && onComplete(final);
    } catch (err) {
      setError(err.message || "No pudimos guardar todo. Revisá la conexión y tocá de nuevo: lo que cargaste sigue acá.");
      setSaving(false);
    }
  };


  const titulo = step > TOTAL_PASOS ? "¡Listo!" : `Paso ${step} de ${TOTAL_PASOS} · ${NOMBRES_PASOS[step - 1]}`;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6 font-body">
      {/* Header con progreso */}
      <div className="pt-5 pb-4 border-b border-gypi-border mb-4">
        <div className="g-overline text-gypi-amber-ink">Configuración inicial</div>
        <h1 className="mt-1 mb-3 font-heading text-[22px] font-bold text-gypi-text">{titulo}</h1>
        <div className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: TOTAL_PASOS }, (_, i) => i + 1).map(s => (
            <div key={s} className={`flex-1 h-1 rounded-sm ${s <= step ? 'bg-gypi-amber' : 'bg-gypi-surf-hi'}`} />
          ))}
        </div>
        {step <= TOTAL_PASOS && <p className="text-xs text-gypi-dim mt-2 mb-0">Se guarda solo: si cerrás, seguís desde acá.</p>}
      </div>

      {retomado && step <= TOTAL_PASOS && (
        <div role="status" className="flex items-center justify-between gap-2 p-3 mb-4 rounded-[10px] bg-gypi-cyan/10 text-gypi-text text-[13px]">
          <span>Seguís donde lo dejaste.</span>
          <Button size="sm" variant="ghost" onClick={empezarDeNuevo}>Empezar de nuevo</Button>
        </div>
      )}

      {/* PASO 1: NOMBRE + RUBRO (la plantilla se muestra para leer) */}
      {step === 1 && <>
        <label htmlFor="alta-nombre" className="block m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">¿Cómo se llama tu empresa?</label>
        <p className="text-xs text-gypi-dim mb-2">Te pusimos un nombre provisorio — cambialo por el real.</p>
        <input
          id="alta-nombre"
          value={nombreEmpresa}
          onChange={e => setNombreEmpresa(e.target.value)}
          className="g-input w-full mb-4"
          placeholder="Nombre de la empresa"
          maxLength={120}
        />

        <h2 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">¿A qué se dedica?</h2>
        <p className="text-xs text-gypi-dim mb-3.5">Con eso armamos los sectores y las etapas de trabajo. Si no está el tuyo, elegí «Otro / General».</p>
        <div className="grid grid-cols-2 gap-1.5 mb-4">
          {Object.entries(PLANTILLAS).map(([k, v]) => (
            <button
              key={k}
              onClick={() => aplicarPlantilla(k)}
              aria-pressed={rubro === k}
              className={`min-h-11 p-2.5 rounded-[10px] border text-[13px] font-semibold font-body cursor-pointer text-left flex items-center gap-1.5 ${
                rubro === k
                  ? 'border-gypi-amber bg-gypi-amber/[0.08] text-gypi-amber-ink'
                  : 'border-gypi-border bg-gypi-surface text-gypi-text'
              }`}
            >
              <span className="text-base">{v.icon}</span><span>{v.label}</span>
            </button>
          ))}
        </div>

        {rubro && PLANTILLAS[rubro] && <VistaPlantilla divisiones={divisiones} etapas={etapas} />}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="primary" onClick={() => setStep(2)} disabled={!nombreEmpresa.trim()}>Siguiente →</Button>
        </div>
      </>}

      {/* PASO 2: PLANTA */}
      {step === 2 && <>
        <PasoPlanta planta={planta} setPlanta={setPlanta} />
        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={() => setStep(1)}>← Atrás</Button>
          <Button variant="primary" onClick={() => setStep(3)}>{planta.lat != null ? "Siguiente →" : "Saltar →"}</Button>
        </div>
      </>}

      {/* PASO 3: HORARIO TIPO */}
      {step === 3 && <>
        <PasoHorario horario={horario} setHorario={setHorario} usarHorario={usarHorario} setUsarHorario={setUsarHorario} />
        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={() => setStep(2)}>← Atrás</Button>
          <Button variant="primary" onClick={() => setStep(4)} disabled={usarHorario && !diagramaDesde(horario)}>Siguiente →</Button>
        </div>
      </>}

      {/* PASO 4: EQUIPO */}
      {step === 4 && <>
        <h2 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">¿Quiénes trabajan con vos?</h2>
        <p className="text-xs text-gypi-dim mb-3.5">Cargá a tu equipo ahora o saltalo y hacelo después desde Personal.</p>

        <div className="g-card mb-3">
          <div className="flex justify-between items-center mb-2.5">
            <span className="g-label">Personas ({empleados.length})</span>
            <Button size="sm" variant="outline" onClick={addEmp}>+ Agregar</Button>
          </div>
          {empleados.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_90px_44px] gap-1.5 mb-1.5 items-center">
              <input value={e.nombre} onChange={ev => updEmp(i, "nombre", ev.target.value)} className="g-input !py-2 !px-2" placeholder="Nombre completo" aria-label={`Nombre de la persona ${i + 1}`} />
              <input value={e.legajo} onChange={ev => updEmp(i, "legajo", ev.target.value)} className="g-input !py-2 !px-2" placeholder="Legajo" inputMode="numeric" aria-label={`Legajo de la persona ${i + 1} (opcional)`} />
              <select value={e.division} onChange={ev => updEmp(i, "division", ev.target.value)} className="g-input !py-2 !px-2 cursor-pointer" aria-label={`Sector de la persona ${i + 1}`}>
                <option value="">Sector</option>
                {divisiones.map(d => <option key={d.clave} value={d.clave}>{d.label}</option>)}
              </select>
              <button onClick={() => delEmp(i)} aria-label={`Quitar a ${e.nombre || `la persona ${i + 1}`}`} className="w-11 h-11 rounded-lg border-none bg-gypi-red/10 text-gypi-red cursor-pointer text-sm">✕</button>
            </div>
          ))}
          {empleados.length === 0 && <div className="py-3.5 text-center text-gypi-dim text-xs">Todavía no cargaste a nadie</div>}
          {empleados.length > 0 && <p className="text-[11px] text-gypi-dim mt-2 mb-0">Si no ponés legajo, te asignamos uno.</p>}
        </div>

        <div className="g-card mb-3">
          <div className="g-label">¿Tenés la lista en Excel?</div>
          <p className="text-[11px] text-gypi-dim mb-2">Guardala como CSV con las columnas nombre, legajo, división y rol (en la primera fila).</p>
          <input ref={fileCsvRef} type="file" accept=".csv,text/csv" hidden onChange={onCsvFile} />
          <Button size="sm" variant="secondary" className="w-full" onClick={() => fileCsvRef.current?.click()}>📤 Subir la lista</Button>
        </div>

        {empleados.length > 0 && <p className="text-[11px] text-gypi-dim mb-3">Al terminar te damos un QR por persona para que entren a la app y creen su contraseña.</p>}

        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={() => setStep(3)}>← Atrás</Button>
          <Button variant="primary" onClick={() => setStep(5)}>{empleados.some(e => e.nombre?.trim()) ? "Siguiente →" : "Saltar →"}</Button>
        </div>
      </>}

      {/* PASO 5: PRIMERA OT */}
      {step === 5 && <>
        <PasoOT ot={ot} setOt={setOt} />
        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={() => setStep(4)}>← Atrás</Button>
          <Button variant="primary" onClick={() => setStep(6)}>{ot.ot.trim() ? "Siguiente →" : "Saltar →"}</Button>
        </div>
      </>}

      {/* PASO 6: RESUMEN (+ logo y colores, opcional) */}
      {step === 6 && <>
        <h2 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">Listo para empezar</h2>
        <p className="text-xs text-gypi-dim mb-4">Revisá y confirmá. Todo se puede cambiar después.</p>

        <div className="g-card mb-3">
          <Fila label="Nombre">{nombreEmpresa.trim()}</Fila>
          <Fila label="Rubro">{rubro ? PLANTILLAS[rubro]?.label : "Sin definir"}</Fila>
          <Fila label="Sectores">{divisiones.length}</Fila>
          <Fila label="Etapas de trabajo">{etapas.length}</Fila>
          <Fila label="Ubicación">{planta.lat != null ? planta.nombre || "Planta" : "—"}</Fila>
          <Fila label="Horario">{usarHorario ? textoHorario(horario) : "—"}</Fila>
          <Fila label="Personas">{empleados.filter(e => e.nombre?.trim()).length}</Fila>
          <Fila label="Primer trabajo">{ot.ot.trim() || "—"}</Fila>
        </div>

        <div className="g-card mb-3">
          <button
            onClick={() => setPersonalizar(v => !v)}
            aria-expanded={personalizar}
            className="w-full min-h-11 flex items-center justify-between bg-transparent border-none p-0 cursor-pointer text-left font-body"
          >
            <span>
              <span className="block text-sm font-semibold text-gypi-text">🎨 Logo y colores</span>
              <span className="block text-xs text-gypi-dim">Opcional · {logoPreview ? "logo cargado" : "sin logo"}</span>
            </span>
            <span className={`inline-block text-gypi-dim transition-transform ${personalizar ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
          </button>
          {personalizar && <div className="mt-3">
            {logoPreview && (
              <div className="text-center mb-2.5">
                <img src={logoPreview} alt="Logo de la empresa" className="max-w-[120px] max-h-[120px] rounded-xl bg-gypi-bg p-1.5" />
              </div>
            )}
            <input ref={fileLogoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onLogoFile} />
            <Button size="sm" variant="secondary" className="w-full mb-3" onClick={() => fileLogoRef.current?.click()}>
              {logoPreview ? "🔄 Cambiar logo" : "📤 Subir logo"}
            </Button>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-[13px] text-gypi-text">
                <input type="color" value={colorPrim} onChange={e => setColorPrim(e.target.value)} className="w-11 h-11 border border-gypi-border rounded-lg cursor-pointer bg-transparent" />
                Color principal
              </label>
              <label className="flex items-center gap-2 text-[13px] text-gypi-text">
                <input type="color" value={colorSec} onChange={e => setColorSec(e.target.value)} className="w-11 h-11 border border-gypi-border rounded-lg cursor-pointer bg-transparent" />
                Color secundario
              </label>
            </div>
          </div>}
        </div>

        {error && <div role="alert" className="p-3 bg-gypi-red/10 text-gypi-red-ink rounded-[10px] text-xs mb-2.5">{error}</div>}

        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={() => setStep(5)} disabled={saving}>← Atrás</Button>
          <Button variant="primary" onClick={finalizar} disabled={saving} loading={saving}>
            {saving ? "Guardando..." : "🚀 Empezar a usar Gypi"}
          </Button>
        </div>
      </>}

      {/* CIERRE: QR de activación del equipo */}
      {step === TOTAL_PASOS + 1 && <>
        {codigos?.length > 0 && <>
          <h2 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">Tu equipo ya está cargado</h2>
          <p className="text-xs text-gypi-dim mb-3.5">Cada persona necesita su tarjeta: escanea el QR con el celular y crea su contraseña. Mandátelas por email para no perderlas, o imprimilas ahora.</p>
          <div className="g-card mb-3 max-h-[240px] overflow-y-auto">
            {codigos.map(c => (
              <div key={c.legajo} className="flex justify-between py-1.5 border-b border-gypi-border last:border-0 text-[13px]">
                <span className="text-gypi-text">{c.nombre}</span>
                <span className="font-mono text-gypi-dim">{c.codigo}</span>
              </div>
            ))}
          </div>
          <Button
            variant="primary"
            className="w-full mb-2"
            onClick={mandarPorEmail}
            loading={envioEmail.estado === "enviando"}
            disabled={envioEmail.estado === "enviando" || envioEmail.estado === "ok"}
          >📧 Mandármelas por email</Button>
          {envioEmail.texto && (
            <div role={envioEmail.estado === "error" ? "alert" : "status"} className={`p-3 rounded-[10px] text-xs mb-2 ${envioEmail.estado === "error" ? "bg-gypi-red/10 text-gypi-red-ink" : "bg-gypi-green/10 text-gypi-green-ink"}`}>
              {envioEmail.texto}
            </div>
          )}
          <Button variant="secondary" className="w-full mb-3" onClick={() => imprimirTarjetas({
            titulo: "Códigos de acceso",
            empresa: nombreEmpresa.trim(),
            tarjetas: codigos.filter(c => c.link).map(c => ({
              nombre: c.nombre,
              detalle: `Legajo ${c.legajo} · Código ${c.codigo}`,
              link: c.link,
              pie: "Escaneá con la cámara del celular y creá tu contraseña. Sirve una vez.",
            })),
          }).catch(() => setError("No se pudo abrir la impresión. Permití las ventanas emergentes."))}>🖨️ Imprimir tarjetas con QR</Button>
          <p className="text-[11px] text-gypi-dim mb-3">Si perdés algún código, generás uno nuevo desde Personal.</p>
        </>}
        {avisos.length > 0 && (
          <div role="alert" className="p-3 bg-gypi-amber/10 text-gypi-text rounded-[10px] text-xs mb-3">
            No pudimos guardar {avisos.join(", ")}. Lo podés cargar desde Gestión; te lo recordamos en la lista de primeros pasos.
          </div>
        )}
        {error && <div role="alert" className="p-3 bg-gypi-red/10 text-gypi-red-ink rounded-[10px] text-xs mb-2.5">{error}</div>}
        <Button variant={codigos?.length > 0 ? "outline" : "primary"} className="w-full" onClick={() => onComplete && onComplete(empresaFinal)}>Entrar a Gypi →</Button>
      </>}
    </div>
  );
}
