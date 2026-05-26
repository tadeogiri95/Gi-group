import { useState, useEffect, useCallback } from "react";
import { C, fH, fB, fM } from "./lib/theme";
import { sb } from "./lib/supabase";
import { Tag } from "./components/ui";
import { DIVISIONES_CON_TODOS as DIVISIONES } from "./lib/constants";

/* Ubicación especial fija (no se borra) */
const HOME_OFFICE = { id: "home_office", label: "🏠 Home Office", lat: null, lng: null, radio: null };
/* Helper: texto de ubicación */
const fmtUbicacion = (ub, ubicaciones) => {
  if (!ub || !ub.activa) return "Sin control";
  if (ub.tipo === "home_office") return "🏠 Home Office";
  const found = ubicaciones.find(u => u.id === ub.tipo);
  if (found) return `📍 ${found.label}`;
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

/* ═══ HELPER: Decodificar Plus Code a coordenadas ═══ */
function decodePlusCode(code) {
  // Plus codes use base20 alphabet: 23456789CFGHJMPQRVWX
  const ALPHABET = '23456789CFGHJMPQRVWX';
  const clean = code.replace(/\s/g, '').toUpperCase().replace(/\+/g, '');
  // Only handle full plus codes (10+ chars without the +)
  if (clean.length < 8) return null;
  
  try {
    let lat = 0, lng = 0;
    const pairs = [];
    for (let i = 0; i < Math.min(clean.length, 10); i += 2) {
      pairs.push([
        ALPHABET.indexOf(clean[i]),
        ALPHABET.indexOf(clean[i + 1])
      ]);
    }
    if (pairs.some(p => p[0] < 0 || p[1] < 0)) return null;
    
    lat = pairs[0][0] * 20 + (pairs[1]?.[0] || 0) + (pairs[2]?.[0] || 0) / 20 + (pairs[3]?.[0] || 0) / 400 + (pairs[4]?.[0] || 0) / 8000 - 90;
    lng = pairs[0][1] * 20 + (pairs[1]?.[1] || 0) + (pairs[2]?.[1] || 0) / 20 + (pairs[3]?.[1] || 0) / 400 + (pairs[4]?.[1] || 0) / 8000 - 180;
    
    return { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };
  } catch {
    return null;
  }
}

/* ═══ MODAL UBICACIÓN (crear/editar) — con Plus Code y mapa ═══ */
function ModalUbicacion({ initial, onClose, onSave, titulo }) {
  const [nombre, setNombre] = useState(initial?.nombre || initial?.label || "");
  const [lat, setLat] = useState(initial?.lat?.toString() || "");
  const [lng, setLng] = useState(initial?.lng?.toString() || "");
  const [radio, setRadio] = useState(initial?.radio?.toString() || "200");
  const [plusCode, setPlusCode] = useState(initial?.plusCode || "");
  const [detectando, setDetectando] = useState(false);
  const [error, setError] = useState("");
  const [modoInput, setModoInput] = useState("coords"); // coords | pluscode | mapa

  const detectarUbicacion = () => {
    if (!navigator.geolocation) { setError("Tu navegador no soporta geolocalización"); return; }
    setDetectando(true); setError("");
    navigator.geolocation.getCurrentPosition(
      pos => { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)); setDetectando(false); },
      err => { setError("No se pudo obtener la ubicación: " + err.message); setDetectando(false); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const aplicarPlusCode = () => {
    if (!plusCode.trim()) { setError("Ingresá un Plus Code"); return; }
    const coords = decodePlusCode(plusCode.trim());
    if (coords) {
      setLat(coords.lat.toString());
      setLng(coords.lng.toString());
      setError("");
    } else {
      // Fallback: intentar buscar via Google Maps embed
      setError("Plus Code no reconocido. Probá copiando las coordenadas directamente desde Google Maps, o usá 'Señalar en mapa'.");
    }
  };

  const valid = nombre.trim() && lat && lng && radio;

  // URL del mapa estático para preview
  const mapPreviewUrl = lat && lng
    ? `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`
    : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 460, background: C.bg, borderRadius: "20px 20px 0 0", padding: "20px 18px 30px", maxHeight: "85vh", overflowY: "auto", border: `1px solid ${C.border}` }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.mute, margin: "0 auto 16px" }} />
        <h3 style={{ margin: "0 0 16px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>{titulo || "📍 Nueva ubicación"}</h3>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Nombre del lugar</label>
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Planta GI, Obra San Luis, Depósito Norte..." style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: C.surfLo, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box" }} />
        </div>

        {/* Selector de modo de input */}
        <div style={{ display: "flex", gap: 0, marginBottom: 14, background: C.surface, borderRadius: 10, padding: 3, border: `1px solid ${C.border}` }}>
          <button onClick={() => setModoInput("coords")} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", background: modoInput === "coords" ? C.cyan : "transparent", color: modoInput === "coords" ? "#000" : C.dim, fontSize: 11, fontWeight: 700, fontFamily: fB }}>📐 Coordenadas</button>
          <button onClick={() => setModoInput("pluscode")} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", background: modoInput === "pluscode" ? C.green : "transparent", color: modoInput === "pluscode" ? "#000" : C.dim, fontSize: 11, fontWeight: 700, fontFamily: fB }}>📌 Plus Code</button>
          <button onClick={() => setModoInput("mapa")} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", background: modoInput === "mapa" ? C.violet : "transparent", color: modoInput === "mapa" ? "#000" : C.dim, fontSize: 11, fontWeight: 700, fontFamily: fB }}>🗺️ Mapa</button>
        </div>

        {modoInput === "coords" && (
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
        )}

        {modoInput === "pluscode" && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Plus Code de Google Maps</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={plusCode} onChange={e => setPlusCode(e.target.value)} placeholder="Ej: 47QR+2X Córdoba" style={{ flex: 1, padding: "12px 14px", borderRadius: 10, background: C.surfLo, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fM, outline: "none", boxSizing: "border-box" }} />
              <button onClick={aplicarPlusCode} style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: C.green, color: "#000", fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: "pointer", whiteSpace: "nowrap" }}>Aplicar</button>
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>
              Abrí Google Maps → clic derecho en el punto → copiá el Plus Code o las coordenadas. El Plus Code es el código corto tipo "47QR+2X".
            </div>
            {lat && lng && <div style={{ fontSize: 12, color: C.green, marginTop: 6, fontWeight: 600 }}>✅ Coordenadas: {lat}, {lng}</div>}
          </div>
        )}

        {modoInput === "mapa" && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ background: C.surfLo, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}`, marginBottom: 8 }}>
              <iframe
                src={`https://maps.google.com/maps?q=${lat || "-31.4135"},${lng || "-64.1811"}&z=15&output=embed`}
                style={{ width: "100%", height: 220, border: "none" }}
                allowFullScreen
                loading="lazy"
              />
            </div>
            <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5, marginBottom: 8 }}>
              Para mayor precisión: abrí <a href={`https://www.google.com/maps/@${lat || "-31.4135"},${lng || "-64.1811"},17z`} target="_blank" rel="noopener" style={{ color: C.cyan }}>Google Maps</a>, hacé clic derecho en el punto exacto y copiá las coordenadas. Después pegálas arriba en el modo "Coordenadas".
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 4 }}>Latitud</label>
                <input value={lat} onChange={e => setLat(e.target.value)} placeholder="-31.4135" type="number" step="any" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, background: C.surfLo, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, fontFamily: fM, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 4 }}>Longitud</label>
                <input value={lng} onChange={e => setLng(e.target.value)} placeholder="-64.1811" type="number" step="any" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, background: C.surfLo, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, fontFamily: fM, outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Radio permitido (metros)</label>
          <input value={radio} onChange={e => setRadio(e.target.value)} placeholder="200" type="number" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: C.surfLo, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fM, outline: "none", boxSizing: "border-box" }} />
          <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>Distancia máxima desde el punto para validar fichaje</div>
        </div>

        <button onClick={detectarUbicacion} disabled={detectando} style={{ width: "100%", padding: 12, borderRadius: 12, border: `1px solid ${C.cyan}40`, background: `${C.cyan}12`, color: C.cyan, fontSize: 13, fontWeight: 700, fontFamily: fH, cursor: detectando ? "default" : "pointer", marginBottom: 8 }}>
          {detectando ? "📡 Detectando..." : "📡 Usar mi ubicación actual"}
        </button>

        {/* Preview del mapa si hay coordenadas */}
        {lat && lng && modoInput !== "mapa" && (
          <div style={{ marginBottom: 12, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
            <iframe
              src={`https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`}
              style={{ width: "100%", height: 150, border: "none" }}
              allowFullScreen
              loading="lazy"
            />
          </div>
        )}

        {error && <div style={{ padding: 10, background: C.redS, color: C.red, borderRadius: 10, fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer" }}>Cancelar</button>
          <button onClick={() => valid && onSave({ nombre: nombre.trim(), lat: parseFloat(lat), lng: parseFloat(lng), radio: parseInt(radio), plusCode: plusCode.trim() || undefined })} disabled={!valid} style={{ flex: 1, padding: 12, borderRadius: 12, border: "none", background: valid ? C.green : C.surface, color: valid ? "#000" : C.mute, fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: valid ? "pointer" : "default" }}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

/* ═══ PANEL DE GESTIÓN DE UBICACIONES ═══ */
function PanelUbicaciones({ ubicaciones, setUbicaciones, onToast }) {
  const [modalUb, setModalUb] = useState(null); // null | "nueva" | { editing: ubicacion }
  const [confirmDelete, setConfirmDelete] = useState(null);

  const agregarUbicacion = (data) => {
    const id = "ub_" + Date.now();
    const nueva = { id, label: data.nombre, lat: data.lat, lng: data.lng, radio: data.radio };
    const updated = [...ubicaciones, nueva];
    setUbicaciones(updated);
    guardarUbicacionesEnDB(updated);
    onToast(`✅ Ubicación "${data.nombre}" creada`, C.green);
    setModalUb(null);
  };

  const editarUbicacion = (data) => {
    const updated = ubicaciones.map(u =>
      u.id === modalUb.editing.id ? { ...u, label: data.nombre, lat: data.lat, lng: data.lng, radio: data.radio } : u
    );
    setUbicaciones(updated);
    guardarUbicacionesEnDB(updated);
    onToast(`✅ Ubicación "${data.nombre}" actualizada`, C.green);
    setModalUb(null);
  };

  const eliminarUbicacion = (ub) => {
    const updated = ubicaciones.filter(u => u.id !== ub.id);
    setUbicaciones(updated);
    guardarUbicacionesEnDB(updated);
    onToast(`🗑️ Ubicación "${ub.label}" eliminada`, C.amber);
    setConfirmDelete(null);
  };

  const guardarUbicacionesEnDB = async (list) => {
    try {
      // Guardar en tabla config_sistema como JSON
      const payload = { clave: "ubicaciones_fichaje", valor: JSON.stringify(list) };
      // Intentar update, si no existe, insert
      try {
        await sb.patch("config_sistema?clave=eq.ubicaciones_fichaje", payload);
      } catch {
        await sb.post("config_sistema", payload);
      }
    } catch (e) { console.error("Error guardando ubicaciones:", e); }
  };

  return (
    <div style={{ background: `linear-gradient(135deg, ${C.violet}08, ${C.surface})`, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: fH }}>📍 Ubicaciones de fichaje</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Gestioná los puntos donde se puede fichar</div>
        </div>
        <button onClick={() => setModalUb("nueva")} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: C.green, color: "#000", fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
          + Nueva
        </button>
      </div>

      {/* Lista de ubicaciones */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Home Office (fijo) */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: `${C.violet}08`, borderRadius: 10, border: `1px solid ${C.violet}15` }}>
          <span style={{ fontSize: 18 }}>🏠</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Home Office</div>
            <div style={{ fontSize: 10, color: C.violet, marginTop: 1 }}>Sin control de ubicación · Opción fija</div>
          </div>
        </div>

        {ubicaciones.map(ub => (
          <div key={ub.id} style={{ background: C.surfHi, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
              <span style={{ fontSize: 18 }}>📍</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ub.label}</div>
                <div style={{ fontSize: 10, color: C.dim, fontFamily: fM, marginTop: 1 }}>
                  {ub.lat?.toFixed(4)}, {ub.lng?.toFixed(4)} · Radio: {ub.radio}m
                </div>
              </div>
              <a href={`https://www.google.com/maps?q=${ub.lat},${ub.lng}`} target="_blank" rel="noopener" style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${C.cyan}30`, background: `${C.cyan}08`, color: C.cyan, fontSize: 10, fontWeight: 600, textDecoration: "none", fontFamily: fB }}>🗺️ Ver</a>
              <button onClick={() => setModalUb({ editing: ub })} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: fB }}>✏️</button>
            {confirmDelete === ub.id ? (
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => eliminarUbicacion(ub)} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: C.red, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: fB }}>Sí</button>
                <button onClick={() => setConfirmDelete(null)} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: fB }}>No</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(ub.id)} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.red}30`, background: `${C.red}08`, color: C.red, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: fB }}>🗑️</button>
            )}
            </div>
          </div>
        ))}

        {ubicaciones.length === 0 && (
          <div style={{ padding: 16, textAlign: "center", color: C.dim, fontSize: 12, background: C.surfHi, borderRadius: 10 }}>
            No hay ubicaciones configuradas. Creá al menos una (ej: Planta GI).
          </div>
        )}
      </div>

      {/* Modal crear/editar ubicación */}
      {modalUb === "nueva" && (
        <ModalUbicacion
          titulo="📍 Nueva ubicación de fichaje"
          onClose={() => setModalUb(null)}
          onSave={agregarUbicacion}
        />
      )}
      {modalUb?.editing && (
        <ModalUbicacion
          titulo={`✏️ Editar: ${modalUb.editing.label}`}
          initial={{ nombre: modalUb.editing.label, lat: modalUb.editing.lat, lng: modalUb.editing.lng, radio: modalUb.editing.radio }}
          onClose={() => setModalUb(null)}
          onSave={editarUbicacion}
        />
      )}
    </div>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function GeolocalizacionScreen() {
  const [empleados, setEmpleados] = useState([]);
  const [configs, setConfigs] = useState({});       // { empId: { activa, tipo, nombre, lat, lng, radio } }
  const [original, setOriginal] = useState({});
  const [ubicaciones, setUbicaciones] = useState([]); // Ubicaciones dinámicas desde DB
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [modo, setModo] = useState("individual");
  const [filtroDivision, setFiltroDivision] = useState("todas");
  const [expandedId, setExpandedId] = useState(null);
  const [modalCustom, setModalCustom] = useState(null);

  // Masivo
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [configMasiva, setConfigMasiva] = useState({ activa: true, tipo: null });

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3500); };

  /* ── Cargar ubicaciones desde DB ── */
  const cargarUbicaciones = useCallback(async () => {
    try {
      const data = await sb.get("config_sistema?clave=eq.ubicaciones_fichaje&select=valor");
      if (data && data.length > 0 && data[0].valor) {
        const parsed = JSON.parse(data[0].valor);
        setUbicaciones(parsed);
        return parsed;
      }
    } catch (e) {
      console.error("Error cargando ubicaciones:", e);
    }
    // Default: crear Planta GI si no hay nada
    const defaults = [
      { id: "planta", label: "Planta principal", lat: -31.4135, lng: -64.1811, radio: 150 },
    ];
    setUbicaciones(defaults);
    // Guardar defaults en DB
    try {
      await sb.post("config_sistema", { clave: "ubicaciones_fichaje", valor: JSON.stringify(defaults) });
    } catch { /* puede ya existir */ }
    return defaults;
  }, []);

  /* ── Cargar empleados ── */
  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const ubList = await cargarUbicaciones();
      const emps = await sb.get("empleados?activo=eq.true&order=nombre.asc&select=id,nombre,apodo,legajo,area,division,rol,ubicacion_fichaje");
      setEmpleados(emps || []);
      const g = {}, o = {};
      (emps || []).forEach(e => {
        const ub = e.ubicacion_fichaje || { activa: true, tipo: ubList[0]?.id || "planta", lat: ubList[0]?.lat || -31.4135, lng: ubList[0]?.lng || -64.1811, radio: ubList[0]?.radio || 150 };
        g[e.id] = { ...ub };
        o[e.id] = JSON.parse(JSON.stringify(ub));
      });
      setConfigs(g);
      setOriginal(o);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [cargarUbicaciones]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const tieneCambios = (id) => JSON.stringify(configs[id]) !== JSON.stringify(original[id]);
  const totalCambios = empleados.filter(e => tieneCambios(e.id)).length;

  /* ── Individual: cambiar config ── */
  const setConfig = (empId, updates) => {
    setConfigs(p => ({ ...p, [empId]: { ...p[empId], ...updates } }));
  };

  const seleccionarUbicacion = (empId, ubicacionId) => {
    if (ubicacionId === "home_office") {
      setConfig(empId, { tipo: "home_office", nombre: "Home Office", lat: null, lng: null, radio: null, activa: true });
      return;
    }
    const ub = ubicaciones.find(u => u.id === ubicacionId);
    if (!ub) return;
    setConfig(empId, { tipo: ubicacionId, nombre: ub.label, lat: ub.lat, lng: ub.lng, radio: ub.radio, activa: true });
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
    if (!configMasiva.tipo) { showToast("Seleccioná una ubicación primero", C.amber); return; }

    let cfg;
    if (configMasiva.activa === false) {
      cfg = { activa: false, tipo: null, nombre: null, lat: null, lng: null, radio: null };
    } else if (configMasiva.tipo === "home_office") {
      cfg = { activa: true, tipo: "home_office", nombre: "Home Office", lat: null, lng: null, radio: null };
    } else {
      const ub = ubicaciones.find(u => u.id === configMasiva.tipo);
      if (!ub) { showToast("Ubicación no encontrada", C.red); return; }
      cfg = { activa: true, tipo: ub.id, nombre: ub.label, lat: ub.lat, lng: ub.lng, radio: ub.radio };
    }

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

  // Opciones para seleccionar (ubicaciones dinámicas + home office)
  const opcionesUbicacion = [
    ...ubicaciones.map(u => ({ ...u, icon: "📍" })),
    { ...HOME_OFFICE, icon: "🏠" },
  ];

  /* ═══ RENDER ═══ */
  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px", position: "relative" }}>

      {toast && <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 999, padding: "12px 20px", borderRadius: 12, background: C.bg, border: `1px solid ${toast.color}40`, boxShadow: `0 8px 32px ${toast.color}20`, fontSize: 13, fontWeight: 600, color: toast.color, animation: "fadeIn 0.25s ease", maxWidth: "90%" }}>{toast.msg}</div>}

      {/* ═══ PANEL DE GESTIÓN DE UBICACIONES ═══ */}
      <PanelUbicaciones ubicaciones={ubicaciones} setUbicaciones={setUbicaciones} onToast={showToast} />

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
                    {opcionesUbicacion.map(p => (
                      <Chip key={p.id} active={configMasiva.tipo === p.id} onClick={() => setConfigMasiva(prev => ({ ...prev, tipo: p.id }))} color={C.cyan}>
                        {p.icon} {p.label}
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
                            L-{emp.legajo} · {fmtUbicacion(cfg, ubicaciones)}
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
                              {/* Ubicaciones disponibles */}
                              <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Ubicación asignada</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                                {opcionesUbicacion.map(p => {
                                  const activo = cfg.tipo === p.id;
                                  return (
                                    <button key={p.id} onClick={() => seleccionarUbicacion(emp.id, p.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${activo ? `${C.amber}60` : C.border}`, background: activo ? `${C.amber}12` : "transparent", cursor: "pointer", textAlign: "left" }}>
                                      <div style={{ width: 20, height: 20, borderRadius: 10, border: `2px solid ${activo ? C.amber : C.mute}`, background: activo ? C.amber : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                        {activo && <div style={{ width: 8, height: 8, borderRadius: 4, background: "#000" }} />}
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: activo ? C.text : C.dim }}>{p.icon} {p.label}</div>
                                        {p.id !== "home_office" && p.lat && (
                                          <div style={{ fontSize: 10, color: C.mute, fontFamily: fM, marginTop: 2 }}>Radio: {p.radio}m</div>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>

                              {cfg.tipo === "home_office" && (
                                <div style={{ padding: 10, background: `${C.violet}08`, borderRadius: 10, border: `1px solid ${C.violet}20` }}>
                                  <div style={{ fontSize: 12, color: C.violet, fontWeight: 600 }}>🏠 Sin control de ubicación — el empleado trabaja remoto</div>
                                </div>
                              )}

                              {/* Radio customizable para ubicaciones seleccionadas */}
                              {cfg.tipo && cfg.tipo !== "home_office" && (
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

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
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
