import { useState, useEffect, useCallback } from "react";
import { C, fH, fB, fM } from "./lib/theme";
import { sb } from "./lib/supabase";

/* ═══ CONSTANTES ═══ */
const DIVISIONES = [
  { id: "todas", label: "Todos" },
  { id: "herreria", label: "🔥 Herrería", color: C.amber },
  { id: "muebles", label: "🪵 Muebles", color: C.green },
  { id: "aberturas", label: "🪟 Aberturas", color: C.cyan },
  { id: "general", label: "🏭 General", color: C.violet },
];

/* Ubicaciones preconfiguradas — se pueden agregar más */
const UBICACIONES_PRESET = [
  { id: "planta", label: "🏭 Planta GI — Córdoba", lat: -31.4135, lng: -64.1811, radio: 150 },
  { id: "bariloche", label: "🏔️ Obra Bariloche", lat: -41.1335, lng: -71.3103, radio: 300 },
  { id: "corrientes", label: "🌊 Obra Corrientes", lat: -27.4692, lng: -58.8306, radio: 300 },
  { id: "home_office", label: "🏠 Home Office", lat: null, lng: null, radio: null },
  { id: "custom", label: "📍 Ubicación personalizada", lat: null, lng: null, radio: 200 },
];

/* ═══ PRIMITIVAS ═══ */
const Tag = ({ color = C.amber, children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: `${color}22`, color, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: fB }}>{children}</span>
);
const Chip = ({ active, onClick, children, color = C.amber }) => (
  <button onClick={onClick} style={{ padding: "7px 12px", borderRadius: 20, border: "none", cursor: "pointer", background: active ? `${color}22` : C.surface, color: active ? color : C.dim, fontSize: 11, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap", transition: "all 0.15s" }}>{children}</button>
);

/* Helper: texto de ubicación */
const fmtUbicacion = (ub) => {
  if (!ub || !ub.activa) return "Sin control";
  if (ub.tipo === "home_office") return "🏠 Home Office";
  const preset = UBICACIONES_PRESET.find(p => p.id === ub.tipo);
  if (preset && preset.id !== "custom") return preset.label;
  if (ub.nombre) return `📍 ${ub.nombre}`;
  if (ub.lat && ub.lng) return `📍 ${ub.lat.toFixed(4)}, ${ub.lng.toFixed(4)}`;
  return "Sin control";
};

const distanciaMetros = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/* ═══ MODAL UBICACIÓN PERSONALIZADA ═══ */
function ModalCustom({ initial, onClose, onSave }) {
  const [nombre, setNombre] = useState(initial?.nombre || "");
  const [lat, setLat] = useState(initial?.lat?.toString() || "");
  const [lng, setLng] = useState(initial?.lng?.toString() || "");
  const [radio, setRadio] = useState(initial?.radio?.toString() || "200");
  const [detectando, setDetectando] = useState(false);
  const [error, setError] = useState("");

  const detectarUbicacion = () => {
    if (!navigator.geolocation) { setError("Tu navegador no soporta geolocalización"); return; }
    setDetectando(true); setError("");
    navigator.geolocation.getCurrentPosition(
      pos => { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)); setDetectando(false); },
      err => { setError("No se pudo obtener la ubicación: " + err.message); setDetectando(false); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const valid = nombre.trim() && lat && lng && radio;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 460, background: C.bg, borderRadius: "20px 20px 0 0", padding: "20px 18px 30px", maxHeight: "85vh", overflowY: "auto", border: `1px solid ${C.border}` }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.mute, margin: "0 auto 16px" }} />
        <h3 style={{ margin: "0 0 16px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>📍 Ubicación personalizada</h3>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Nombre del lugar</label>
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Obra San Luis, Depósito Zona Norte..." style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: C.surfLo, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Latitud</label>
            <input value={lat} onChange={e => setLat(e.target.value)} placeholder="-31.4135" type="number" step="any" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: C.surfLo, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fM, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Longitud</label>
            <input value={lng} onChange={e => setLng(e.target.value)} placeholder="-64.1811" type="number" step="any" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: C.surfLo, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fM, outline: "none", boxSizing: "border-box" }} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Radio permitido (metros)</label>
          <input value={radio} onChange={e => setRadio(e.target.value)} placeholder="200" type="number" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: C.surfLo, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fM, outline: "none", boxSizing: "border-box" }} />
          <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>Distancia máxima desde el punto para validar fichaje</div>
        </div>

        <button onClick={detectarUbicacion} disabled={detectando} style={{ width: "100%", padding: 12, borderRadius: 12, border: `1px solid ${C.cyan}40`, background: `${C.cyan}12`, color: C.cyan, fontSize: 13, fontWeight: 700, fontFamily: fH, cursor: detectando ? "default" : "pointer", marginBottom: 14 }}>
          {detectando ? "📡 Detectando..." : "📡 Usar mi ubicación actual"}
        </button>

        {error && <div style={{ padding: 10, background: C.redS, color: C.red, borderRadius: 10, fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer" }}>Cancelar</button>
          <button onClick={() => valid && onSave({ nombre, lat: parseFloat(lat), lng: parseFloat(lng), radio: parseInt(radio) })} disabled={!valid} style={{ flex: 1, padding: 12, borderRadius: 12, border: "none", background: valid ? C.green : C.surface, color: valid ? "#000" : C.mute, fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: valid ? "pointer" : "default" }}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function GeolocalizacionScreen() {
  const [empleados, setEmpleados] = useState([]);
  const [configs, setConfigs] = useState({});       // { empId: { activa, tipo, nombre, lat, lng, radio } }
  const [original, setOriginal] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [modo, setModo] = useState("individual");
  const [filtroDivision, setFiltroDivision] = useState("todas");
  const [expandedId, setExpandedId] = useState(null);
  const [modalCustom, setModalCustom] = useState(null); // { empId } o { masivo: true }

  // Masivo
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [configMasiva, setConfigMasiva] = useState({ activa: true, tipo: "planta" });

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3500); };

  /* ── Cargar ── */
  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const emps = await sb.get("empleados?activo=eq.true&order=nombre.asc&select=id,nombre,apodo,legajo,area,division,rol,ubicacion_fichaje");
      setEmpleados(emps || []);
      const g = {}, o = {};
      (emps || []).forEach(e => {
        const ub = e.ubicacion_fichaje || { activa: true, tipo: "planta", lat: -31.4135, lng: -64.1811, radio: 150 };
        g[e.id] = { ...ub };
        o[e.id] = JSON.parse(JSON.stringify(ub));
      });
      setConfigs(g);
      setOriginal(o);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const tieneCambios = (id) => JSON.stringify(configs[id]) !== JSON.stringify(original[id]);
  const totalCambios = empleados.filter(e => tieneCambios(e.id)).length;

  /* ── Individual: cambiar config ── */
  const setConfig = (empId, updates) => {
    setConfigs(p => ({ ...p, [empId]: { ...p[empId], ...updates } }));
  };

  const seleccionarPreset = (empId, presetId) => {
    if (presetId === "custom") {
      setModalCustom({ empId });
      return;
    }
    const preset = UBICACIONES_PRESET.find(p => p.id === presetId);
    if (!preset) return;
    if (presetId === "home_office") {
      setConfig(empId, { tipo: "home_office", nombre: "Home Office", lat: null, lng: null, radio: null, activa: true });
    } else {
      setConfig(empId, { tipo: presetId, nombre: preset.label.replace(/^[^\s]+\s/, ""), lat: preset.lat, lng: preset.lng, radio: preset.radio, activa: true });
    }
  };

  /* ── Masivo ── */
  const toggleEmpleado = (id) => {
    setSeleccionados(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const seleccionarTodosFiltrados = () => {
    const ids = empsFiltrados.map(e => e.id);
    const all = ids.every(id => seleccionados.has(id));
    if (all) setSeleccionados(p => { const n = new Set(p); ids.forEach(id => n.delete(id)); return n; });
    else setSeleccionados(p => { const n = new Set(p); ids.forEach(id => n.add(id)); return n; });
  };

  const aplicarMasivo = () => {
    if (seleccionados.size === 0) { showToast("Seleccioná al menos un empleado", C.amber); return; }
    const preset = UBICACIONES_PRESET.find(p => p.id === configMasiva.tipo);
    if (configMasiva.tipo === "custom") {
      setModalCustom({ masivo: true });
      return;
    }
    const cfg = configMasiva.tipo === "home_office"
      ? { activa: configMasiva.activa, tipo: "home_office", nombre: "Home Office", lat: null, lng: null, radio: null }
      : configMasiva.activa === false
        ? { activa: false, tipo: null, nombre: null, lat: null, lng: null, radio: null }
        : { activa: true, tipo: configMasiva.tipo, nombre: preset?.label?.replace(/^[^\s]+\s/, "") || "", lat: preset?.lat, lng: preset?.lng, radio: preset?.radio || 200 };

    setConfigs(p => {
      const c = { ...p };
      seleccionados.forEach(id => { c[id] = { ...cfg }; });
      return c;
    });
    showToast(`✅ Ubicación aplicada a ${seleccionados.size} empleado${seleccionados.size > 1 ? "s" : ""}`, C.green);
  };

  /* ── Guardar ── */
  const guardarYNotificar = async () => {
    const cambios = empleados.filter(e => tieneCambios(e.id));
    if (!cambios.length) { showToast("No hay cambios para guardar", C.amber); return; }
    setSaving(true);
    let ok = 0;
    for (const emp of cambios) {
      const cfg = configs[emp.id];
      try {
        await sb.patch(`empleados?id=eq.${emp.id}`, { ubicacion_fichaje: cfg });
        const detalle = !cfg.activa ? "Control de ubicación DESACTIVADO" : cfg.tipo === "home_office" ? "Modo Home Office — sin control de ubicación" : `Ubicación: ${cfg.nombre || "Planta"} (radio: ${cfg.radio}m)`;
        await sb.post("notificaciones", { destinatario_rol: String(emp.legajo), tipo: "info", asunto: "📍 Ubicación de fichaje actualizada", detalle, urgencia: "normal" });
        try { await fetch("/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legajo: String(emp.legajo), title: "📍 Ubicación actualizada", body: detalle, data: { tag: "ubicacion-update" } }) }); } catch (e) { }
        ok++;
      } catch (e) { console.error(e); }
    }
    setOriginal(JSON.parse(JSON.stringify(configs)));
    setSeleccionados(new Set());
    showToast(`✅ ${ok} ubicación${ok > 1 ? "es" : ""} guardada${ok > 1 ? "s" : ""} y notificada${ok > 1 ? "s" : ""}`, C.green);
    setSaving(false);
  };

  /* ── Filtrar ── */
  const empsFiltrados = filtroDivision === "todas" ? empleados : empleados.filter(e => e.division === filtroDivision);

  /* ═══ RENDER ═══ */
  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px", position: "relative" }}>

      {toast && <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 999, padding: "12px 20px", borderRadius: 12, background: C.bg, border: `1px solid ${toast.color}40`, boxShadow: `0 8px 32px ${toast.color}20`, fontSize: 13, fontWeight: 600, color: toast.color, animation: "fadeIn 0.25s ease", maxWidth: "90%" }}>{toast.msg}</div>}

      {/* Modo toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 14, background: C.surface, borderRadius: 12, padding: 3, border: `1px solid ${C.border}` }}>
        <button onClick={() => setModo("masivo")} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", cursor: "pointer", background: modo === "masivo" ? C.cyan : "transparent", color: modo === "masivo" ? "#000" : C.dim, fontSize: 13, fontWeight: 700, fontFamily: fH, transition: "all 0.2s" }}>⚡ Asignación masiva</button>
        <button onClick={() => setModo("individual")} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", cursor: "pointer", background: modo === "individual" ? C.amber : "transparent", color: modo === "individual" ? "#000" : C.dim, fontSize: 13, fontWeight: 700, fontFamily: fH, transition: "all 0.2s" }}>✏️ Individual</button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: C.dim, fontSize: 13 }}>Cargando personal...</div>
      ) : (
        <>
          {/* ═══ MASIVO ═══ */}
          {modo === "masivo" && (
            <>
              {/* Config masiva */}
              <div style={{ background: `linear-gradient(135deg,${C.cyan}12,${C.surface})`, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: C.cyan, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>CONFIGURACIÓN A APLICAR</div>

                {/* Toggle activa/desactivada */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Control de ubicación</span>
                  <button onClick={() => setConfigMasiva(p => ({ ...p, activa: !p.activa }))} style={{ width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", background: configMasiva.activa ? C.green : C.mute, position: "relative", transition: "all 0.2s" }}>
                    <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: configMasiva.activa ? 23 : 3, transition: "all 0.2s" }} />
                  </button>
                </div>

                {configMasiva.activa && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {UBICACIONES_PRESET.map(p => (
                      <Chip key={p.id} active={configMasiva.tipo === p.id} onClick={() => setConfigMasiva(prev => ({ ...prev, tipo: p.id }))} color={C.cyan}>
                        {p.label}
                      </Chip>
                    ))}
                  </div>
                )}

                <button onClick={aplicarMasivo} disabled={seleccionados.size === 0} style={{ width: "100%", marginTop: 14, padding: 12, borderRadius: 12, border: "none", background: seleccionados.size > 0 ? C.cyan : C.surface, color: seleccionados.size > 0 ? "#000" : C.mute, fontSize: 14, fontWeight: 700, fontFamily: fH, cursor: seleccionados.size > 0 ? "pointer" : "default" }}>
                  {seleccionados.size > 0 ? `Aplicar a ${seleccionados.size} seleccionado${seleccionados.size > 1 ? "s" : ""}` : "Seleccioná empleados abajo"}
                </button>
              </div>

              {/* Filtros división */}
              <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
                {DIVISIONES.map(d => <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || C.amber}>{d.label}</Chip>)}
              </div>

              {/* Seleccionar todos */}
              <button onClick={seleccionarTodosFiltrados} style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px dashed ${C.border}`, background: "transparent", color: C.dim, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 10, fontFamily: fB }}>
                {empsFiltrados.every(e => seleccionados.has(e.id)) ? "Deseleccionar todos" : `Seleccionar todos (${empsFiltrados.length})`}
              </button>

              {/* Lista selección */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {empsFiltrados.map(emp => {
                  const sel = seleccionados.has(emp.id);
                  const cfg = configs[emp.id];
                  const divInfo = DIVISIONES.find(d => d.id === emp.division) || DIVISIONES[0];
                  return (
                    <div key={emp.id} onClick={() => toggleEmpleado(emp.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, background: sel ? `${C.cyan}12` : C.surface, borderRadius: 12, border: `1px solid ${sel ? `${C.cyan}40` : C.border}`, cursor: "pointer", transition: "all 0.15s" }}>
                      <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${sel ? C.cyan : C.mute}`, background: sel ? C.cyan : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#000", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{sel ? "✓" : ""}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emp.apodo || emp.nombre}</div>
                        <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>L-{emp.legajo}{emp.division ? ` · ${divInfo.label}` : ""}</div>
                      </div>
                      <div style={{ fontSize: 10, color: cfg?.activa ? C.green : C.mute, fontWeight: 600 }}>
                        {cfg?.activa ? (cfg.tipo === "home_office" ? "🏠" : "📍") : "OFF"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ═══ INDIVIDUAL ═══ */}
          {modo === "individual" && (
            <>
              {/* Filtros */}
              <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
                {DIVISIONES.map(d => <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || C.amber}>{d.label}</Chip>)}
              </div>

              {/* Lista */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {empsFiltrados.map(emp => {
                  const cfg = configs[emp.id] || {};
                  const changed = tieneCambios(emp.id);
                  const expanded = expandedId === emp.id;
                  const divInfo = DIVISIONES.find(d => d.id === emp.division) || DIVISIONES[0];

                  return (
                    <div key={emp.id} style={{ background: C.surface, borderRadius: 14, border: `1px solid ${changed ? `${C.amber}40` : C.border}`, overflow: "hidden", transition: "all 0.2s" }}>
                      {/* Header */}
                      <div onClick={() => setExpandedId(expanded ? null : emp.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, cursor: "pointer" }}>
                        <div style={{ width: 38, height: 38, borderRadius: 10, background: cfg.activa ? (cfg.tipo === "home_office" ? `${C.violet}22` : `${C.green}22`) : `${C.mute}22`, color: cfg.activa ? (cfg.tipo === "home_office" ? C.violet : C.green) : C.mute, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fH, fontSize: 13, fontWeight: 700 }}>
                          {cfg.activa ? (cfg.tipo === "home_office" ? "🏠" : "📍") : "—"}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{emp.apodo || emp.nombre}</span>
                            {changed && <Tag color={C.amber}>editado</Tag>}
                          </div>
                          <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                            L-{emp.legajo} · {fmtUbicacion(cfg)}
                          </div>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="2" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><polyline points="6 9 12 15 18 9"/></svg>
                      </div>

                      {/* Panel expandido */}
                      {expanded && (
                        <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.border}` }}>
                          {/* Toggle activa */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0 10px" }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Control de ubicación</div>
                              <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{cfg.activa ? "El empleado debe fichar desde la ubicación asignada" : "Puede fichar desde cualquier lugar"}</div>
                            </div>
                            <button onClick={() => setConfig(emp.id, { activa: !cfg.activa })} style={{ width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", background: cfg.activa ? C.green : C.mute, position: "relative", transition: "all 0.2s" }}>
                              <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: cfg.activa ? 23 : 3, transition: "all 0.2s" }} />
                            </button>
                          </div>

                          {cfg.activa && (
                            <>
                              {/* Presets */}
                              <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Ubicación asignada</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                                {UBICACIONES_PRESET.map(p => {
                                  const activo = cfg.tipo === p.id || (p.id === "custom" && cfg.tipo === "custom");
                                  return (
                                    <button key={p.id} onClick={() => seleccionarPreset(emp.id, p.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${activo ? `${C.amber}60` : C.border}`, background: activo ? `${C.amber}12` : "transparent", cursor: "pointer", textAlign: "left" }}>
                                      <div style={{ width: 20, height: 20, borderRadius: 10, border: `2px solid ${activo ? C.amber : C.mute}`, background: activo ? C.amber : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                        {activo && <div style={{ width: 8, height: 8, borderRadius: 4, background: "#000" }} />}
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: activo ? C.text : C.dim }}>{p.label}</div>
                                        {p.id !== "custom" && p.id !== "home_office" && p.lat && (
                                          <div style={{ fontSize: 10, color: C.mute, fontFamily: fM, marginTop: 2 }}>Radio: {p.radio}m</div>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Info de la config actual */}
                              {cfg.tipo === "custom" && cfg.lat && (
                                <div style={{ padding: 10, background: `${C.amber}08`, borderRadius: 10, border: `1px solid ${C.amber}20`, marginBottom: 8 }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: C.amber }}>{cfg.nombre || "Personalizada"}</div>
                                  <div style={{ fontSize: 11, color: C.dim, fontFamily: fM, marginTop: 4 }}>{cfg.lat}, {cfg.lng} · Radio: {cfg.radio}m</div>
                                  <button onClick={() => setModalCustom({ empId: emp.id })} style={{ marginTop: 8, padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.amber}40`, background: "transparent", color: C.amber, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: fB }}>Editar coordenadas</button>
                                </div>
                              )}

                              {cfg.tipo === "home_office" && (
                                <div style={{ padding: 10, background: `${C.violet}08`, borderRadius: 10, border: `1px solid ${C.violet}20` }}>
                                  <div style={{ fontSize: 12, color: C.violet, fontWeight: 600 }}>🏠 Sin control de ubicación — el empleado trabaja remoto</div>
                                </div>
                              )}

                              {/* Radio customizable para presets */}
                              {cfg.tipo && cfg.tipo !== "home_office" && cfg.tipo !== "custom" && (
                                <div style={{ marginTop: 8 }}>
                                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, marginBottom: 4 }}>Radio permitido: {cfg.radio || 150}m</label>
                                  <input type="range" min={50} max={500} step={25} value={cfg.radio || 150} onChange={e => setConfig(emp.id, { radio: parseInt(e.target.value) })} style={{ width: "100%", accentColor: C.amber }} />
                                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.mute }}><span>50m</span><span>500m</span></div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ═══ BARRA GUARDAR ═══ */}
          {totalCambios > 0 && (
            <div style={{ position: "fixed", bottom: 90, left: 0, right: 0, maxWidth: 480, margin: "0 auto", padding: "0 18px", zIndex: 100 }}>
              <button onClick={guardarYNotificar} disabled={saving} style={{ width: "100%", padding: 16, borderRadius: 14, border: "none", background: saving ? C.surface : `linear-gradient(135deg,${C.green},${C.cyan})`, color: saving ? C.dim : "#000", fontSize: 15, fontWeight: 700, fontFamily: fH, cursor: saving ? "default" : "pointer", boxShadow: `0 8px 32px ${C.green}30` }}>
                {saving ? "Guardando..." : `💾 Guardar ${totalCambios} cambio${totalCambios > 1 ? "s" : ""} y notificar`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal custom */}
      {modalCustom && (
        <ModalCustom
          initial={modalCustom.empId ? configs[modalCustom.empId] : null}
          onClose={() => setModalCustom(null)}
          onSave={(data) => {
            if (modalCustom.masivo) {
              setConfigs(p => {
                const c = { ...p };
                seleccionados.forEach(id => {
                  c[id] = { activa: true, tipo: "custom", nombre: data.nombre, lat: data.lat, lng: data.lng, radio: data.radio };
                });
                return c;
              });
              showToast(`✅ Ubicación personalizada aplicada a ${seleccionados.size} empleados`, C.green);
            } else if (modalCustom.empId) {
              setConfig(modalCustom.empId, { tipo: "custom", nombre: data.nombre, lat: data.lat, lng: data.lng, radio: data.radio, activa: true });
            }
            setModalCustom(null);
          }}
        />
      )}
    </div>
  );
}

/* ═══ EXPORT: Validador de geolocalización para usar en el fichaje ═══ */
export async function validarGeoFichaje(empleado) {
  const ub = empleado.ubicacion_fichaje;

  // Sin config o desactivada → permitir
  if (!ub || !ub.activa) return { ok: true, msg: "Sin control de ubicación" };

  // Home office → permitir
  if (ub.tipo === "home_office") return { ok: true, msg: "Home Office — sin control de ubicación" };

  // Necesitamos geolocalización
  if (!navigator.geolocation) return { ok: false, msg: "Tu navegador no soporta geolocalización. Pedí a gerencia que te desactive el control." };

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const dist = distanciaMetros(pos.coords.latitude, pos.coords.longitude, ub.lat, ub.lng);
        const dentroDelRadio = dist <= (ub.radio || 200);
        resolve({
          ok: dentroDelRadio,
          distancia: Math.round(dist),
          radio: ub.radio || 200,
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          msg: dentroDelRadio
            ? `✅ Ubicación verificada (${Math.round(dist)}m de ${ub.nombre || "la ubicación asignada"})`
            : `❌ Estás a ${Math.round(dist)}m de ${ub.nombre || "la ubicación asignada"} (máximo permitido: ${ub.radio || 200}m)`,
        });
      },
      err => {
        resolve({
          ok: false,
          msg: err.code === 1
            ? "⚠️ Necesitás dar permiso de ubicación para fichar. Activalo en los ajustes del navegador."
            : `Error de GPS: ${err.message}. Intentá de nuevo.`,
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });
}
