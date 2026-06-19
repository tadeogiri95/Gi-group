import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { sb } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";
import { haversine } from "./lib/calc";

const AMBER = "var(--color-empresa-primary, #F97316)";
const GREEN = "#16A34A";
const RED = "#DC2626";
const CYAN = "#0891B2";
const VIOLET = "#7C3AED";

import { getDivisionesConTodos } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { useToast } from "./components/ui/Toast";
import { useConfirm } from "./components/ui/ConfirmDialog";

/* ═══ GOOGLE MAPS PARSER ═══ */
/**
 * Acepta cualquiera de estos formatos:
 *  1. Coordenadas crudas:  -34.6037, -58.3816
 *  2. @lat,lng,zoom:        @-34.6037,-58.3816,16z  (con o sin URL)
 *  3. maps.google.com URL:  ?q=lat,lng  /  ?center=lat,lng  /  ll=lat,lng
 *  4. Share desktop Maps:   !3d{lat}!4d{lng}
 *  5. /place/.../@lat,lng   (URL completa de resultado de búsqueda)
 */
const parseMapsInput = (input) => {
  const s = input?.trim() ?? "";
  if (!s) return null;

  // 1. Coordenadas crudas: "-34.6037, -58.3816" o "-34.6037 -58.3816"
  const rawCoord = s.match(/^(-?\d{1,3}\.?\d*)[,\s]+(-?\d{1,3}\.?\d*)$/);
  if (rawCoord) {
    const lat = parseFloat(rawCoord[1]);
    const lng = parseFloat(rawCoord[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  // 2. @lat,lng (con zoom opcional) — funciona dentro de URLs o como texto
  const atMatch = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  // 3. !3d{lat}!4d{lng} — formato de links "Compartir" de Maps en desktop
  const dataMatch = s.match(/!3d(-?\d+\.?\d*).*?!4d(-?\d+\.?\d*)/);
  if (dataMatch) {
    const lat = parseFloat(dataMatch[1]);
    const lng = parseFloat(dataMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  // 4. ?q=lat,lng / &q=lat,lng
  const qMatch = s.match(/[?&]q=(-?\d+\.?\d*)[,+](-?\d+\.?\d*)/);
  if (qMatch) {
    const lat = parseFloat(qMatch[1]);
    const lng = parseFloat(qMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  // 5. ?center=lat,lng o ll=lat,lng (formatos legacy de Maps)
  const centerMatch = s.match(/(?:[?&]center=|[?&]ll=)(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (centerMatch) {
    const lat = parseFloat(centerMatch[1]);
    const lng = parseFloat(centerMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }

  return null;
};

/* ═══ PLUS CODE DECODER ═══ */
const PLUS_CODE_CHARS = "23456789CFGHJMPQRVWX";
const decodePlusCode = (code) => {
  try {
    let cleaned = code.replace(/\s/g, "").toUpperCase();
    if (!cleaned.includes("+")) return null;
    cleaned = cleaned.replace(/0+$/, "");
    const sepIdx = cleaned.indexOf("+");
    const beforeSep = cleaned.slice(0, sepIdx);
    const afterSep = cleaned.slice(sepIdx + 1);
    const all = beforeSep + afterSep;
    if (all.length < 8) return null;
    let lat = 0, lng = 0;
    const pairs = [];
    for (let i = 0; i < all.length - 1; i += 2) {
      pairs.push([all[i], all[i + 1]]);
    }
    const resolutions = [20, 1, 0.05, 0.0025, 0.000125];
    for (let i = 0; i < Math.min(pairs.length, 5); i++) {
      const latIdx = PLUS_CODE_CHARS.indexOf(pairs[i][0]);
      const lngIdx = PLUS_CODE_CHARS.indexOf(pairs[i][1]);
      if (latIdx < 0 || lngIdx < 0) return null;
      lat += latIdx * resolutions[i];
      lng += lngIdx * resolutions[i];
    }
    lat -= 90;
    lng -= 180;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };
  } catch {
    return null;
  }
};

/* ═══ LEAFLET MAP (dynamic import — SSR-safe) ═══ */
const LeafletMap = dynamic(() => import("./components/LeafletMap"), { ssr: false, loading: () => <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f0ee", borderRadius: 12 }}>Cargando mapa...</div> });

/* ═══ GEOCODING via server-side proxy ═══ */
async function geocodeAddress(query) {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (data.error) return [];
  return data;
}

/* ═══ MODAL UBICACIÓN ═══ */
function ModalUbicacion({ ubicacion, onClose, onSave, saving }) {
  const isEdit = !!ubicacion?.id;
  const [nombre, setNombre] = useState(ubicacion?.nombre || "");
  const [lat, setLat] = useState(ubicacion?.lat != null ? String(ubicacion.lat) : "");
  const [lng, setLng] = useState(ubicacion?.lng != null ? String(ubicacion.lng) : "");
  const [radio, setRadio] = useState(ubicacion?.radio || 150);
  const [modo, setModo] = useState("direccion");
  const [error, setError] = useState(null);

  // Dirección
  const [addressQuery, setAddressQuery] = useState("");
  const [addressResults, setAddressResults] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);

  // Plus Code
  const [plusCode, setPlusCode] = useState("");

  // Link de Maps
  const [mapaUrl, setMapaUrl] = useState("");

  // GPS
  const [gpsLoading, setGpsLoading] = useState(false);

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  const latValid = !isNaN(latNum) && latNum >= -90 && latNum <= 90;
  const lngValid = !isNaN(lngNum) && lngNum >= -180 && lngNum <= 180;
  const hasCoords = latValid && lngValid;
  const canSave = nombre.trim() && hasCoords;

  const setCoords = (newLat, newLng) => {
    setLat(String(parseFloat(newLat).toFixed(6)));
    setLng(String(parseFloat(newLng).toFixed(6)));
    setError(null);
  };

  // Buscar dirección
  const handleAddressSearch = async () => {
    if (!addressQuery.trim()) return;
    setAddressLoading(true);
    setError(null);
    setAddressResults([]);
    try {
      // Primero intentar como link de Maps o coordenadas crudas
      const parsed = parseMapsInput(addressQuery);
      if (parsed) { setCoords(parsed.lat, parsed.lng); setAddressLoading(false); return; }
      // Intentar como Plus Code
      const pc = decodePlusCode(addressQuery);
      if (pc) { setCoords(pc.lat, pc.lng); setAddressLoading(false); return; }
      // Geocoding
      const results = await geocodeAddress(addressQuery);
      if (results.length === 0) { setError("No se encontraron resultados para esa dirección."); }
      else if (results.length === 1) { setCoords(results[0].lat, results[0].lng); if (!nombre.trim()) setNombre(results[0].label.split(",")[0]); }
      else setAddressResults(results);
    } catch (e) { console.error("Geocode error:", e); setError("Error buscando dirección. Verificá tu conexión."); }
    setAddressLoading(false);
  };

  const selectAddressResult = (r) => {
    setCoords(r.lat, r.lng);
    if (!nombre.trim()) setNombre(r.label.split(",")[0]);
    setAddressResults([]);
  };

  // Plus Code
  const handlePlusCodeDecode = () => {
    setError(null);
    const input = plusCode.trim();
    // Extraer solo la parte del Plus Code (quitar nombre de ciudad/area)
    const parts = input.split(/\s+/);
    let decoded = null;
    for (const part of parts) {
      if (part.includes("+")) { decoded = decodePlusCode(part); if (decoded) break; }
    }
    if (!decoded) decoded = decodePlusCode(input);
    if (decoded) { setCoords(decoded.lat, decoded.lng); }
    else { setError("Plus Code inválido. Formato esperado: 87GC+2G (sin la ciudad, solo el código)."); }
  };

  // Link de Maps
  const handleMapaChange = (val) => {
    setMapaUrl(val);
    if (val.length > 8) {
      const result = parseMapsInput(val);
      if (result) { setCoords(result.lat, result.lng); }
    }
  };

  // GPS del dispositivo
  const handleUseGPS = () => {
    if (!navigator?.geolocation) { setError("Tu navegador no soporta geolocalización."); return; }
    setGpsLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords(pos.coords.latitude, pos.coords.longitude); setGpsLoading(false); },
      (err) => {
        const msgs = { 1: "Permiso de ubicación denegado", 2: "No se pudo obtener ubicación", 3: "Tiempo agotado" };
        setError(msgs[err.code] || "Error GPS");
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  // Click en mapa
  const handleMapClick = (newLat, newLng) => { setCoords(newLat, newLng); };

  const handleSave = () => {
    if (!canSave) return;
    onSave({ ...(isEdit ? { id: ubicacion.id } : {}), nombre: nombre.trim(), lat: latNum, lng: lngNum, radio });
  };

  const MODOS = [
    { key: "direccion", icon: "🔍", label: "Dirección" },
    { key: "mapa", icon: "🗺️", label: "Mapa" },
    { key: "pluscode", icon: "🔢", label: "Plus Code" },
    { key: "link", icon: "🔗", label: "Link" },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={isEdit ? "Editar ubicación" : "Nueva ubicación"}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" style={{ backdropFilter: "blur(4px)" }} />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] max-h-[90vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" aria-hidden="true" />
        <h3 className="m-0 mb-1 font-heading text-lg font-bold text-gypi-text">
          {isEdit ? "Editar ubicación" : "Nueva ubicación"}
        </h3>
        <div className="text-xs text-gypi-dim mb-4">
          {isEdit ? "Modificá los datos de esta ubicación" : "Buscá por dirección, seleccioná en el mapa, o pegá un Plus Code"}
        </div>

        {/* Nombre */}
        <div className="mb-3">
          <label className="g-label">Nombre</label>
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Oficina Central, Planta 2"
            className="g-input" />
        </div>

        {/* Modo toggle */}
        <div className="flex mb-3 bg-gypi-surface rounded-xl p-[3px] border border-gypi-border">
          {MODOS.map(m => (
            <button key={m.key} onClick={() => setModo(m.key)}
              className="flex-1 py-2 rounded-[10px] border-none cursor-pointer text-[11px] font-bold font-heading transition-all"
              style={{ background: modo === m.key ? CYAN : "transparent", color: modo === m.key ? "#000" : "var(--color-text-dim)", minHeight: 40 }}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div role="alert" className="mb-3 p-2.5 rounded-lg text-[12px] font-semibold font-body" style={{ background: `${RED}15`, color: RED, border: `1px solid ${RED}30` }}>
            {error}
          </div>
        )}

        {/* ── Modo Dirección ── */}
        {modo === "direccion" && (
          <div className="mb-3">
            <label className="g-label">Dirección, ciudad o lugar</label>
            <div className="flex gap-2">
              <input value={addressQuery} onChange={e => setAddressQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddressSearch()}
                placeholder="Av. Corrientes 1234, CABA"
                className="g-input flex-1" />
              <button onClick={handleAddressSearch} disabled={!addressQuery.trim() || addressLoading}
                className="py-3 px-4 rounded-[10px] border-none text-[13px] font-bold font-heading cursor-pointer shrink-0"
                style={{ background: addressQuery.trim() && !addressLoading ? CYAN : "var(--color-surface)", color: addressQuery.trim() && !addressLoading ? "#000" : "var(--color-text-muted)", minHeight: 44 }}>
                {addressLoading ? "..." : "Buscar"}
              </button>
            </div>
            <div className="mt-1.5 text-[10px] text-gypi-mute">
              También acepta: link de Google Maps, coordenadas, o Plus Code
            </div>
            {/* Resultados de búsqueda */}
            {addressResults.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                <div className="text-[10px] font-bold text-gypi-dim uppercase mb-1">Seleccioná un resultado:</div>
                {addressResults.map((r, i) => (
                  <button key={i} onClick={() => selectAddressResult(r)}
                    className="text-left w-full py-2.5 px-3 rounded-lg border border-gypi-border cursor-pointer text-[12px] font-body bg-gypi-surface text-gypi-text">
                    📍 {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Modo Mapa interactivo ── */}
        {modo === "mapa" && (
          <div className="mb-3">
            <div className="text-[11px] text-gypi-dim mb-2">Tocá en el mapa para ubicar el punto de fichaje</div>
            <div className="rounded-xl overflow-hidden border border-gypi-border" style={{ height: 260 }}>
              <LeafletMap lat={hasCoords ? latNum : -34.6037} lng={hasCoords ? lngNum : -58.3816}
                zoom={hasCoords ? 16 : 12} radio={radio} onMapClick={handleMapClick} />
            </div>
          </div>
        )}

        {/* ── Modo Plus Code ── */}
        {modo === "pluscode" && (
          <div className="mb-3">
            <label className="g-label">Plus Code de Google Maps</label>
            <div className="flex gap-2">
              <input value={plusCode} onChange={e => setPlusCode(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handlePlusCodeDecode()}
                placeholder="Ej: 87GC+2G"
                className="g-input flex-1 font-mono" />
              <button onClick={handlePlusCodeDecode} disabled={!plusCode.trim()}
                className="py-3 px-4 rounded-[10px] border-none text-[13px] font-bold font-heading cursor-pointer shrink-0"
                style={{ background: plusCode.trim() ? CYAN : "var(--color-surface)", color: plusCode.trim() ? "#000" : "var(--color-text-muted)", minHeight: 44 }}>
                Decodificar
              </button>
            </div>
            <div className="mt-1.5 text-[10px] text-gypi-mute">
              Encontrá el Plus Code en Google Maps: tocá en el mapa → copiá el código corto (ej: 87GC+2G)
            </div>
          </div>
        )}

        {/* ── Modo Link ── */}
        {modo === "link" && (
          <div className="mb-3">
            <label className="g-label">Link de Google Maps o coordenadas</label>
            <div className="flex gap-2">
              <input value={mapaUrl} onChange={e => handleMapaChange(e.target.value)}
                onPaste={e => { const pasted = e.clipboardData.getData("text"); setTimeout(() => handleMapaChange(pasted), 0); }}
                placeholder="Pegá un link de Google Maps"
                className="g-input flex-1" />
              <button onClick={() => { const result = parseMapsInput(mapaUrl); if (result) setCoords(result.lat, result.lng); else setError("No se pudieron extraer coordenadas del link."); }}
                disabled={!mapaUrl.trim()}
                className="py-3 px-4 rounded-[10px] border-none text-[13px] font-bold font-heading cursor-pointer shrink-0"
                style={{ background: mapaUrl.trim() ? CYAN : "var(--color-surface)", color: mapaUrl.trim() ? "#000" : "var(--color-text-muted)", minHeight: 44 }}>
                Extraer
              </button>
            </div>
            <div className="mt-1.5 text-[10px] text-gypi-mute">
              Abrí Google Maps → click derecho → "¿Qué hay aquí?" → copiá el link
            </div>
          </div>
        )}

        {/* Botón GPS */}
        <button onClick={handleUseGPS} disabled={gpsLoading}
          className="w-full py-2.5 rounded-xl border border-gypi-border text-[13px] font-bold font-body cursor-pointer mb-3 flex items-center justify-center gap-2 bg-transparent"
          style={{ color: CYAN, minHeight: 44 }}>
          {gpsLoading ? "Obteniendo ubicación..." : "📡 Usar mi ubicación actual"}
        </button>

        {/* Coords actuales */}
        {hasCoords && (
          <>
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <label className="g-label">Latitud</label>
                <input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)}
                  className="g-input font-mono" />
              </div>
              <div className="flex-1">
                <label className="g-label">Longitud</label>
                <input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)}
                  className="g-input font-mono" />
              </div>
            </div>

            {/* Mapa preview (en modos que no son "mapa") */}
            {modo !== "mapa" && (
              <div className="mb-3 rounded-xl overflow-hidden border border-gypi-border" style={{ height: 180 }}>
                <LeafletMap lat={latNum} lng={lngNum} zoom={16} radio={radio} onMapClick={handleMapClick} />
              </div>
            )}
          </>
        )}

        {/* Radio */}
        <div className="mb-4">
          <label className="g-label">
            Radio de tolerancia: {radio}m
          </label>
          <input type="range" min={50} max={500} step={10} value={radio} onChange={e => setRadio(Number(e.target.value))}
            className="w-full" style={{ accentColor: CYAN }} />
          <div className="flex justify-between text-[10px] text-gypi-mute mt-1">
            <span>50m</span><span>500m</span>
          </div>
        </div>

        {/* Botón guardar */}
        <button onClick={handleSave} disabled={!canSave || saving}
          className="w-full py-3.5 rounded-xl border-none text-[15px] font-bold font-heading cursor-pointer"
          style={{ background: canSave && !saving ? GREEN : "var(--color-surface)", color: canSave && !saving ? "#000" : "var(--color-text-muted)", minHeight: 48 }}>
          {saving ? "Guardando..." : isEdit ? "Actualizar ubicación" : "Crear ubicación"}
        </button>
      </div>
    </div>
  );
}

/* ═══ PANEL UBICACIONES ═══ */
function PanelUbicaciones({ ubicaciones, onEdit, onDelete, onNew, deleting }) {
  if (ubicaciones.length === 0) {
    return (
      <div className="g-card p-6 text-center mb-3.5">
        <div className="text-[32px] mb-2">📍</div>
        <div className="text-[15px] font-bold font-heading text-gypi-text mb-1">Sin ubicaciones</div>
        <div className="text-[13px] text-gypi-dim mb-4">Creá puntos de fichaje para habilitar el control de geolocalización</div>
        <button
          onClick={onNew}
          className="py-3 px-6 rounded-xl border-none text-[14px] font-bold font-heading cursor-pointer"
          style={{ background: GREEN, color: "#000" }}
        >
          + Nueva ubicación
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3.5">
      <div className="flex justify-between items-center mb-2.5">
        <div className="g-overline">
          Ubicaciones ({ubicaciones.length})
        </div>
        <button
          onClick={onNew}
          className="py-1.5 px-3 rounded-lg border-none text-[12px] font-bold font-body cursor-pointer"
          style={{ background: `${GREEN}22`, color: GREEN }}
        >
          + Nueva
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {ubicaciones.map(u => (
          <div
            key={u.id}
            className="g-card flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: `${CYAN}18` }}>
              📍
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-gypi-text truncate">{u.nombre}</div>
              <div className="text-[11px] text-gypi-dim font-mono mt-0.5">
                {u.lat?.toFixed(5)}, {u.lng?.toFixed(5)} · {u.radio || 150}m
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => onEdit(u)}
                aria-label={`Editar ${u.nombre}`}
                className="w-8 h-8 rounded-lg border-none cursor-pointer flex items-center justify-center text-[14px]"
                style={{ background: `${AMBER}18`, color: AMBER }}
              >
                ✏️
              </button>
              <button
                onClick={() => onDelete(u.id)}
                disabled={deleting}
                aria-label={`Eliminar ${u.nombre}`}
                className="w-8 h-8 rounded-lg border-none cursor-pointer flex items-center justify-center text-[14px]"
                style={{ background: `${RED}18`, color: RED }}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function GeolocalizacionScreen({ empresaId }) {
  const { divisiones: divisionesCtx } = useAuth();
  const DIVISIONES = getDivisionesConTodos(divisionesCtx);
  const [empleados, setEmpleados] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [config, setConfig] = useState({});
  const [original, setOriginal] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const [confirmFn, ConfirmDialog] = useConfirm();
  const [modo, setModo] = useState("individual");
  const [filtroDivision, setFiltroDivision] = useState("todas");
  const [expandedId, setExpandedId] = useState(null);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [masivoCfg, setMasivoCfg] = useState({ activo: true, ubicacion_id: "", radio: 150 });
  const [modalUbicacion, setModalUbicacion] = useState(null);
  const [savingUbicacion, setSavingUbicacion] = useState(false);

  const showToast = (msg, color) => toast.show(msg, color);

  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, ubis] = await Promise.all([
        sb.get("empleados?activo=eq.true&order=nombre.asc&select=id,nombre,apodo,legajo,area,division,rol,geo_config"),
        sb.get(`geo_zonas?empresa_id=eq.${empresaId}&order=nombre.asc`),
      ]);
      setEmpleados(emps || []);
      setUbicaciones(ubis || []);
      const cfg = {}, orig = {};
      (emps || []).forEach(e => {
        const gc = e.geo_config || { activo: false, ubicacion_id: null, radio: 150 };
        cfg[e.id] = { ...gc };
        orig[e.id] = { ...gc };
      });
      setConfig(cfg);
      setOriginal(orig);
    } catch (e) {
      console.error("Error cargando datos geo:", e);
    } finally {
      setLoading(false);
    }
  }, [empresaId]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const tienesCambios = (id) => JSON.stringify(config[id]) !== JSON.stringify(original[id]);
  const totalCambios = empleados.filter(e => tienesCambios(e.id)).length;

  const setGeoConfig = (empId, campo, valor) => {
    setConfig(p => ({ ...p, [empId]: { ...p[empId], [campo]: valor } }));
  };
  const toggleGeoActivo = (empId) => {
    setConfig(p => ({ ...p, [empId]: { ...p[empId], activo: !p[empId]?.activo } }));
  };

  const toggleEmpleado = (id) => {
    setSeleccionados(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const empsFiltrados = filtroDivision === "todas" ? empleados : empleados.filter(e => e.division === filtroDivision);

  const seleccionarTodosFiltrados = () => {
    const ids = empsFiltrados.map(e => e.id);
    const allSelected = ids.every(id => seleccionados.has(id));
    if (allSelected) setSeleccionados(p => { const n = new Set(p); ids.forEach(id => n.delete(id)); return n; });
    else setSeleccionados(p => { const n = new Set(p); ids.forEach(id => n.add(id)); return n; });
  };

  const aplicarMasivo = () => {
    if (seleccionados.size === 0) { showToast("Seleccioná al menos un empleado", AMBER); return; }
    if (masivoCfg.activo && !masivoCfg.ubicacion_id) { showToast("Seleccioná una ubicación", AMBER); return; }
    setConfig(p => {
      const c = { ...p };
      seleccionados.forEach(id => {
        c[id] = { activo: masivoCfg.activo, ubicacion_id: masivoCfg.activo ? masivoCfg.ubicacion_id : null, radio: masivoCfg.radio };
      });
      return c;
    });
    showToast(`Configuración aplicada a ${seleccionados.size} empleado${seleccionados.size > 1 ? "s" : ""}`, GREEN);
  };

  const guardar = async () => {
    const cambios = empleados.filter(e => tienesCambios(e.id));
    if (!cambios.length) { showToast("No hay cambios para guardar", AMBER); return; }
    setSaving(true);
    let ok = 0, errores = 0;
    for (const emp of cambios) {
      const gc = config[emp.id];
      try {
        await sb.patch(`empleados?id=eq.${emp.id}`, { geo_config: gc });
        try {
          await sb.post("notificaciones", {
            destinatario_rol: String(emp.legajo),
            tipo: "info",
            asunto: gc.activo ? "📍 Control de ubicación activado" : "📍 Control de ubicación desactivado",
            detalle: gc.activo
              ? `Se activó el control de geolocalización. Radio: ${gc.radio}m.`
              : "Se desactivó el control de ubicación para tu fichaje.",
            urgencia: "normal",
            empresa_id: empresaId,
          });
        } catch {}
        ok++;
      } catch (e) {
        console.error("Error guardando geo_config de", emp.nombre, ":", e);
        errores++;
      }
    }
    if (ok > 0) {
      setOriginal(JSON.parse(JSON.stringify(config)));
      setSeleccionados(new Set());
    }
    showToast(
      errores > 0
        ? `⚠️ ${ok} guardado${ok !== 1 ? "s" : ""}, ${errores} con error.`
        : `✅ ${ok} configuración${ok > 1 ? "es" : ""} guardada${ok > 1 ? "s" : ""}`,
      errores > 0 ? AMBER : GREEN
    );
    setSaving(false);
  };

  /* ── Ubicación CRUD ── */
  const handleSaveUbicacion = async (data) => {
    setSavingUbicacion(true);
    try {
      if (data.id) {
        await sb.patch(`geo_zonas?id=eq.${data.id}`, {
          nombre: data.nombre,
          lat: data.lat,
          lng: data.lng,
          radio: data.radio,
        });
        showToast("Ubicación actualizada", GREEN);
      } else {
        await sb.post("geo_zonas", {
          empresa_id: empresaId,
          nombre: data.nombre,
          lat: data.lat,
          lng: data.lng,
          radio: data.radio,
        });
        showToast("Ubicación creada", GREEN);
      }
      setModalUbicacion(null);
      cargarDatos();
    } catch (e) {
      console.error("Error guardando ubicación:", e);
      showToast("Error al guardar ubicación", RED);
    } finally {
      setSavingUbicacion(false);
    }
  };

  const handleDeleteUbicacion = async (id) => {
    if (!await confirmFn("¿Eliminar esta ubicación? Los empleados asignados perderán esta referencia.", { title: "Eliminar ubicación", confirmLabel: "Eliminar", destructive: true })) return;
    setDeleting(true);
    try {
      await sb.del(`geo_zonas?id=eq.${id}`);
      showToast("Ubicación eliminada", GREEN);
      cargarDatos();
    } catch (e) {
      console.error("Error eliminando ubicación:", e);
      showToast("Error al eliminar", RED);
    } finally {
      setDeleting(false);
    }
  };

  const getUbicacionNombre = (ubiId) => {
    const u = ubicaciones.find(x => x.id === ubiId);
    return u ? u.nombre : "Sin asignar";
  };

  /* ── Toggle switch reusable ── */
  const Toggle = ({ on, onClick, color = GREEN, label }) => (
    <button
      onClick={onClick}
      aria-label={label || (on ? "Desactivar" : "Activar")}
      aria-pressed={on}
      className="relative border-none cursor-pointer rounded-full shrink-0"
      style={{ width: 48, height: 28, background: on ? color : "var(--color-text-muted)", transition: "all 0.2s" }}
    >
      <div
        className="absolute rounded-full bg-white"
        style={{ width: 22, height: 22, top: 3, left: on ? 23 : 3, transition: "all 0.2s" }}
      />
    </button>
  );

  return (
    <section aria-label="Geolocalización" className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px] relative">

      {/* Modo toggle */}
      <div className="flex mb-3.5 bg-gypi-surface rounded-xl p-[3px] border border-gypi-border">
        <button
          onClick={() => setModo("masivo")}
          className="flex-1 py-2.5 rounded-[10px] border-none cursor-pointer text-[13px] font-bold font-heading transition-all"
          style={{ background: modo === "masivo" ? CYAN : "transparent", color: modo === "masivo" ? "#000" : "var(--color-text-dim)" }}
        >
          ⚡ Asignación masiva
        </button>
        <button
          onClick={() => setModo("individual")}
          className="flex-1 py-2.5 rounded-[10px] border-none cursor-pointer text-[13px] font-bold font-heading transition-all"
          style={{ background: modo === "individual" ? AMBER : "transparent", color: modo === "individual" ? "#000" : "var(--color-text-dim)" }}
        >
          ✏️ Individual
        </button>
      </div>

      {/* Panel de Ubicaciones (siempre visible) */}
      <PanelUbicaciones
        ubicaciones={ubicaciones}
        onEdit={(u) => setModalUbicacion(u)}
        onDelete={handleDeleteUbicacion}
        onNew={() => setModalUbicacion({})}
        deleting={deleting}
      />

      {loading ? (
        <div className="gypi-dots"><span style={{ background: "var(--color-cyan)" }} /><span style={{ background: "var(--color-cyan)" }} /><span style={{ background: "var(--color-cyan)" }} /></div>
      ) : modo === "masivo" ? (
        <>
          {/* Paso 1: Configuración masiva */}
          <div className="bg-gypi-surface rounded-2xl p-4 mb-3.5" style={{ border: `1px solid ${CYAN}30` }}>
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] mb-3" style={{ color: CYAN }}>
              ① Definí la configuración
            </div>

            {/* Control activo */}
            <div className="flex items-center justify-between py-2.5 mb-2">
              <div>
                <div className="text-[13px] font-semibold text-gypi-text">Control de ubicación</div>
                <div className="text-[11px] text-gypi-dim mt-0.5">
                  {masivoCfg.activo ? "Fichaje con geolocalización" : "Sin control de ubicación"}
                </div>
              </div>
              <Toggle on={masivoCfg.activo} onClick={() => setMasivoCfg(p => ({ ...p, activo: !p.activo }))} color={GREEN} />
            </div>

            {masivoCfg.activo && (
              <>
                {/* Ubicación */}
                <div className="mb-3">
                  <label className="g-label">Ubicación</label>
                  <select
                    value={masivoCfg.ubicacion_id}
                    onChange={e => setMasivoCfg(p => ({ ...p, ubicacion_id: e.target.value }))}
                    className="g-input"
                  >
                    <option value="">Seleccionar ubicación...</option>
                    {ubicaciones.map(u => (
                      <option key={u.id} value={u.id}>{u.nombre} ({u.lat?.toFixed(3)}, {u.lng?.toFixed(3)})</option>
                    ))}
                  </select>
                </div>

                {/* Radio */}
                <div className="mb-1">
                  <label className="g-label">
                    Radio de tolerancia: {masivoCfg.radio}m
                  </label>
                  <input
                    type="range"
                    min={50}
                    max={500}
                    step={10}
                    value={masivoCfg.radio}
                    onChange={e => setMasivoCfg(p => ({ ...p, radio: Number(e.target.value) }))}
                    className="w-full"
                    style={{ accentColor: CYAN }}
                  />
                  <div className="flex justify-between text-[10px] text-gypi-mute mt-1">
                    <span>50m</span>
                    <span>500m</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Paso 2: Seleccionar empleados */}
          <div className="g-card mb-3.5">
            <div className="flex justify-between items-center mb-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: CYAN }}>
                ② Seleccioná empleados
              </div>
              <Tag color={seleccionados.size > 0 ? AMBER : "var(--color-text-dim)"}>{seleccionados.size} seleccionados</Tag>
            </div>
            <div className="flex gap-1 mb-2.5 overflow-x-auto pb-0.5">
              {DIVISIONES.map(d => (
                <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || CYAN}>
                  {d.label}
                </Chip>
              ))}
            </div>
            <button
              onClick={seleccionarTodosFiltrados}
              className="w-full py-2 rounded-lg text-gypi-cyan text-xs font-bold font-body cursor-pointer mb-2 bg-transparent"
              style={{ border: `1px dashed var(--color-border)` }}
            >
              {empsFiltrados.every(e => seleccionados.has(e.id)) && empsFiltrados.length > 0
                ? "✕ Deseleccionar todos"
                : `☑ Seleccionar todos (${empsFiltrados.length})`}
            </button>
            <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto">
              {empsFiltrados.map(emp => {
                const sel = seleccionados.has(emp.id);
                const changed = tienesCambios(emp.id);
                const gc = config[emp.id] || {};
                return (
                  <button
                    key={emp.id}
                    onClick={() => toggleEmpleado(emp.id)}
                    className="flex items-center gap-2.5 py-2.5 px-3 rounded-[10px] cursor-pointer font-body text-left transition-all"
                    style={{
                      border: `1px solid ${sel ? `${CYAN}40` : "var(--color-border)"}`,
                      background: sel ? `${CYAN}10` : "transparent",
                    }}
                  >
                    <div
                      className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-xs font-bold shrink-0"
                      style={{
                        border: `2px solid ${sel ? CYAN : "var(--color-text-muted)"}`,
                        background: sel ? CYAN : "transparent",
                        color: "#000",
                      }}
                    >
                      {sel && "✓"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-gypi-text truncate">{emp.apodo || emp.nombre}</div>
                      <div className="text-[10px] text-gypi-dim">
                        L-{emp.legajo} · {gc.activo ? `📍 ${getUbicacionNombre(gc.ubicacion_id)}` : "Sin control"}
                      </div>
                    </div>
                    {changed && <Tag color={AMBER}>Editado</Tag>}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={aplicarMasivo}
            disabled={seleccionados.size === 0}
            className="w-full py-3.5 rounded-[14px] border-none text-[15px] font-bold font-heading mb-2.5"
            style={{
              background: seleccionados.size > 0 ? `linear-gradient(135deg, ${CYAN}, ${GREEN})` : "var(--color-surface)",
              color: seleccionados.size > 0 ? "#000" : "var(--color-text-muted)",
              cursor: seleccionados.size > 0 ? "pointer" : "default",
            }}
          >
            ⚡ Aplicar a {seleccionados.size || "..."} empleado{seleccionados.size !== 1 ? "s" : ""}
          </button>
        </>
      ) : (
        /* ═══ MODO INDIVIDUAL ═══ */
        <>
          <div className="flex gap-1 mb-2.5 overflow-x-auto pb-0.5">
            {DIVISIONES.map(d => (
              <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || AMBER}>
                {d.label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {empsFiltrados.map(emp => {
              const isExp = expandedId === emp.id;
              const changed = tienesCambios(emp.id);
              const gc = config[emp.id] || {};
              return (
                <div
                  key={emp.id}
                  className="bg-gypi-surface rounded-[14px] overflow-hidden"
                  style={{ border: `1px solid ${changed ? `${AMBER}40` : "var(--color-border)"}` }}
                >
                  {/* Header */}
                  <button
                    onClick={() => setExpandedId(isExp ? null : emp.id)}
                    aria-expanded={isExp}
                    className="w-full py-3 px-3.5 bg-transparent border-none cursor-pointer flex items-center gap-2.5 font-body text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-gypi-text truncate">{emp.apodo || emp.nombre}</div>
                      <div className="text-[10px] text-gypi-dim mt-0.5">
                        L-{emp.legajo} · {gc.activo ? `📍 ${getUbicacionNombre(gc.ubicacion_id)} · ${gc.radio || 150}m` : "Sin control de ubicación"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {gc.activo && (
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: GREEN }}
                        />
                      )}
                      {changed && <Tag color={AMBER}>Editado</Tag>}
                      <span
                        className="text-gypi-dim text-xs transition-transform"
                        style={{ transform: isExp ? "rotate(90deg)" : "rotate(0)" }}
                      >
                        ▶
                      </span>
                    </div>
                  </button>

                  {/* Collapsed summary */}
                  {!isExp && gc.activo && (
                    <div className="px-3.5 pb-2.5">
                      <div
                        className="inline-block py-1 px-2.5 rounded-lg text-[10px] font-bold font-mono"
                        style={{ background: `${GREEN}15`, color: GREEN }}
                      >
                        📍 {getUbicacionNombre(gc.ubicacion_id)} · {gc.radio || 150}m
                      </div>
                    </div>
                  )}

                  {/* Expanded */}
                  {isExp && (
                    <div className="px-3.5 pb-3.5">
                      {/* Toggle activo */}
                      <div className="flex items-center justify-between py-2.5 mb-3 px-2 rounded-lg" style={{ background: gc.activo ? `${GREEN}08` : "var(--color-text-muted)08" }}>
                        <div>
                          <div className="text-[13px] font-semibold text-gypi-text">Control de ubicación</div>
                          <div className="text-[11px] text-gypi-dim mt-0.5">
                            {gc.activo ? "Fichaje requiere geolocalización" : "Fichaje sin restricción de ubicación"}
                          </div>
                        </div>
                        <Toggle on={gc.activo} onClick={() => toggleGeoActivo(emp.id)} color={GREEN} />
                      </div>

                      {gc.activo && (
                        <>
                          {/* Ubicación select */}
                          <div className="mb-3">
                            <label className="g-label">Ubicación</label>
                            <select
                              value={gc.ubicacion_id || ""}
                              onChange={e => setGeoConfig(emp.id, "ubicacion_id", e.target.value || null)}
                              className="g-input"
                            >
                              <option value="">Sin asignar</option>
                              {ubicaciones.map(u => (
                                <option key={u.id} value={u.id}>{u.nombre}</option>
                              ))}
                            </select>
                          </div>

                          {/* Radio */}
                          <div className="mb-2">
                            <label className="g-label">
                              Radio: {gc.radio || 150}m
                            </label>
                            <input
                              type="range"
                              min={50}
                              max={500}
                              step={10}
                              value={gc.radio || 150}
                              onChange={e => setGeoConfig(emp.id, "radio", Number(e.target.value))}
                              className="w-full"
                              style={{ accentColor: CYAN }}
                            />
                            <div className="flex justify-between text-[10px] text-gypi-mute mt-1">
                              <span>50m</span>
                              <span>500m</span>
                            </div>
                          </div>
                        </>
                      )}

                      {changed && (
                        <div className="mt-2 text-[11px] text-gypi-dim">
                          <Tag color={AMBER}>sin guardar</Tag>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Save bar flotante */}
      {totalCambios > 0 && (
        <div className="fixed bottom-[100px] left-1/2 -translate-x-1/2 z-50 max-w-[440px] w-[calc(100%-36px)]">
          <button
            onClick={guardar}
            disabled={saving}
            className="w-full py-4 rounded-2xl border-none text-[15px] font-bold font-heading flex items-center justify-center gap-2"
            style={{
              background: saving ? "var(--color-surface)" : `linear-gradient(135deg, ${AMBER}, ${VIOLET})`,
              color: saving ? "var(--color-text-dim)" : "#000",
              cursor: saving ? "default" : "pointer",
              boxShadow: `0 8px 32px ${AMBER}30`,
            }}
          >
            {saving ? "⏳ Guardando..." : `📤 Guardar ${totalCambios} cambio${totalCambios > 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      <div className="text-center mt-4 text-[10px] text-gypi-mute">
        {empleados.length} empleados activos · {ubicaciones.length} ubicación{ubicaciones.length !== 1 ? "es" : ""} · {totalCambios} con cambios
      </div>

      {/* Modal */}
      {modalUbicacion !== null && (
        <ModalUbicacion
          ubicacion={modalUbicacion}
          onClose={() => setModalUbicacion(null)}
          onSave={handleSaveUbicacion}
          saving={savingUbicacion}
        />
      )}
      {ConfirmDialog}
    </section>
  );
}

/* ═══ EXPORTED: validarGeoFichaje ═══ */
export function validarGeoFichaje({ empleado, ubicaciones }) {
  const gc = empleado?.geo_config;
  if (!gc || !gc.activo) return { ok: true, motivo: null };
  if (!gc.ubicacion_id) return { ok: true, motivo: null };

  const ubi = ubicaciones.find(u => u.id === gc.ubicacion_id);
  if (!ubi) return { ok: false, motivo: "Ubicación asignada no encontrada." };

  if (!navigator.geolocation) {
    return { ok: false, motivo: "Tu navegador no soporta geolocalización." };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const dist = haversine(pos.coords.latitude, pos.coords.longitude, ubi.lat, ubi.lng);
        const radio = gc.radio || ubi.radio || 150;
        if (dist <= radio) {
          resolve({ ok: true, distancia: Math.round(dist), ubicacion: ubi.nombre });
        } else {
          resolve({
            ok: false,
            motivo: `Estás a ${Math.round(dist)}m de "${ubi.nombre}" (máximo ${radio}m).`,
            distancia: Math.round(dist),
            ubicacion: ubi.nombre,
            radio,
          });
        }
      },
      (err) => {
        const motivos = {
          1: "Permiso de ubicación denegado. Habilitalo en la configuración del navegador.",
          2: "No se pudo obtener la ubicación. Intentá de nuevo.",
          3: "Tiempo agotado obteniendo ubicación. Intentá de nuevo.",
        };
        resolve({ ok: false, motivo: motivos[err.code] || "Error de geolocalización." });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}
