import { useState, useEffect, useCallback } from "react";
import { C } from "./lib/theme";
import { sb } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";
import { haversine } from "./lib/calc";
import { getDivisionesConTodos } from "./lib/constants";

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

/* ═══ MODAL UBICACIÓN ═══ */
function ModalUbicacion({ ubicacion, onClose, onSave, saving }) {
  const isEdit = !!ubicacion?.id;
  const [nombre, setNombre] = useState(ubicacion?.nombre || "");
  const [lat, setLat] = useState(ubicacion?.lat != null ? String(ubicacion.lat) : "");
  const [lng, setLng] = useState(ubicacion?.lng != null ? String(ubicacion.lng) : "");
  const [radio, setRadio] = useState(ubicacion?.radio || 150);
  const [plusCode, setPlusCode] = useState("");
  const [modo, setModo] = useState("coords");
  const [mapaUrl, setMapaUrl] = useState("");
  const [error, setError] = useState(null);

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  const latValid = !isNaN(latNum) && latNum >= -90 && latNum <= 90;
  const lngValid = !isNaN(lngNum) && lngNum >= -180 && lngNum <= 180;
  const canSave = nombre.trim() && latValid && lngValid;

  const handlePlusCodeDecode = () => {
    setError(null);
    const result = decodePlusCode(plusCode);
    if (result) {
      setLat(String(result.lat));
      setLng(String(result.lng));
      setError(null);
    } else {
      setError("Plus Code inválido. Formato esperado: 87GC+2G o similar.");
    }
  };

  const handleMapaConfirm = () => {
    setError(null);
    try {
      const url = new URL(mapaUrl);
      const match = mapaUrl.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (match) {
        setLat(match[1]);
        setLng(match[2]);
        return;
      }
      const qMatch = mapaUrl.match(/q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (qMatch) {
        setLat(qMatch[1]);
        setLng(qMatch[2]);
        return;
      }
      setError("No se pudieron extraer coordenadas de la URL. Usá una URL de Google Maps con @lat,lng.");
    } catch {
      setError("URL inválida. Pegá un link de Google Maps.");
    }
  };

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      ...(isEdit ? { id: ubicacion.id } : {}),
      nombre: nombre.trim(),
      lat: latNum,
      lng: lngNum,
      radio,
    });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] max-h-[85vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" />
        <h3 className="m-0 mb-1 font-heading text-lg font-bold text-gypi-text">
          {isEdit ? "Editar ubicación" : "Nueva ubicación"}
        </h3>
        <div className="text-xs text-gypi-dim mb-4">
          {isEdit ? "Modificá los datos de esta ubicación" : "Agregá un punto de fichaje con coordenadas"}
        </div>

        {/* Nombre */}
        <div className="mb-3">
          <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Nombre</label>
          <input
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Ej: Oficina Central, Planta 2"
            className="w-full py-3 px-3.5 rounded-[10px] bg-gypi-surf-lo border border-gypi-border text-gypi-text text-sm font-body outline-none box-border"
          />
        </div>

        {/* Modo toggle */}
        <div className="flex mb-3 bg-gypi-surface rounded-xl p-[3px] border border-gypi-border">
          <button
            onClick={() => setModo("coords")}
            className="flex-1 py-2 rounded-[10px] border-none cursor-pointer text-[12px] font-bold font-heading transition-all"
            style={{ background: modo === "coords" ? C.cyan : "transparent", color: modo === "coords" ? "#000" : C.dim }}
          >
            📍 Coordenadas
          </button>
          <button
            onClick={() => setModo("pluscode")}
            className="flex-1 py-2 rounded-[10px] border-none cursor-pointer text-[12px] font-bold font-heading transition-all"
            style={{ background: modo === "pluscode" ? C.cyan : "transparent", color: modo === "pluscode" ? "#000" : C.dim }}
          >
            🔢 Plus Code
          </button>
          <button
            onClick={() => setModo("mapa")}
            className="flex-1 py-2 rounded-[10px] border-none cursor-pointer text-[12px] font-bold font-heading transition-all"
            style={{ background: modo === "mapa" ? C.cyan : "transparent", color: modo === "mapa" ? "#000" : C.dim }}
          >
            🗺️ Mapa
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-3 p-2.5 rounded-lg text-[12px] font-semibold font-body" style={{ background: `${C.red}15`, color: C.red, border: `1px solid ${C.red}30` }}>
            ⚠️ {error}
          </div>
        )}

        {/* Modo Coords */}
        {modo === "coords" && (
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Latitud</label>
              <input
                type="number"
                step="any"
                value={lat}
                onChange={e => setLat(e.target.value)}
                placeholder="-34.6037"
                className="w-full py-3 px-3.5 rounded-[10px] bg-gypi-surf-lo border border-gypi-border text-gypi-text text-sm font-mono outline-none box-border"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Longitud</label>
              <input
                type="number"
                step="any"
                value={lng}
                onChange={e => setLng(e.target.value)}
                placeholder="-58.3816"
                className="w-full py-3 px-3.5 rounded-[10px] bg-gypi-surf-lo border border-gypi-border text-gypi-text text-sm font-mono outline-none box-border"
              />
            </div>
          </div>
        )}

        {/* Modo Plus Code */}
        {modo === "pluscode" && (
          <div className="mb-3">
            <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Plus Code</label>
            <div className="flex gap-2">
              <input
                value={plusCode}
                onChange={e => setPlusCode(e.target.value)}
                placeholder="Ej: 87GC+2G Buenos Aires"
                className="flex-1 py-3 px-3.5 rounded-[10px] bg-gypi-surf-lo border border-gypi-border text-gypi-text text-sm font-mono outline-none box-border"
              />
              <button
                onClick={handlePlusCodeDecode}
                disabled={!plusCode.trim()}
                className="py-3 px-4 rounded-[10px] border-none text-[13px] font-bold font-heading cursor-pointer shrink-0"
                style={{
                  background: plusCode.trim() ? C.cyan : C.surface,
                  color: plusCode.trim() ? "#000" : C.mute,
                }}
              >
                Decodificar
              </button>
            </div>
            {latValid && lngValid && (
              <div className="mt-2 text-[11px] text-gypi-dim font-mono">
                Resultado: {latNum.toFixed(6)}, {lngNum.toFixed(6)}
              </div>
            )}
          </div>
        )}

        {/* Modo Mapa */}
        {modo === "mapa" && (
          <div className="mb-3">
            <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">URL de Google Maps</label>
            <div className="flex gap-2">
              <input
                value={mapaUrl}
                onChange={e => setMapaUrl(e.target.value)}
                placeholder="Pegá el link de Google Maps"
                className="flex-1 py-3 px-3.5 rounded-[10px] bg-gypi-surf-lo border border-gypi-border text-gypi-text text-sm font-body outline-none box-border"
              />
              <button
                onClick={handleMapaConfirm}
                disabled={!mapaUrl.trim()}
                className="py-3 px-4 rounded-[10px] border-none text-[13px] font-bold font-heading cursor-pointer shrink-0"
                style={{
                  background: mapaUrl.trim() ? C.cyan : C.surface,
                  color: mapaUrl.trim() ? "#000" : C.mute,
                }}
              >
                Extraer
              </button>
            </div>
            {latValid && lngValid && (
              <div className="mt-2 text-[11px] text-gypi-dim font-mono">
                Coordenadas: {latNum.toFixed(6)}, {lngNum.toFixed(6)}
              </div>
            )}
          </div>
        )}

        {/* Coords preview (si se obtuvieron por pluscode/mapa) */}
        {(modo === "pluscode" || modo === "mapa") && latValid && lngValid && (
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Latitud</label>
              <input
                type="number"
                step="any"
                value={lat}
                onChange={e => setLat(e.target.value)}
                className="w-full py-3 px-3.5 rounded-[10px] bg-gypi-surf-lo border border-gypi-border text-gypi-text text-sm font-mono outline-none box-border"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Longitud</label>
              <input
                type="number"
                step="any"
                value={lng}
                onChange={e => setLng(e.target.value)}
                className="w-full py-3 px-3.5 rounded-[10px] bg-gypi-surf-lo border border-gypi-border text-gypi-text text-sm font-mono outline-none box-border"
              />
            </div>
          </div>
        )}

        {/* Google Maps iframe preview */}
        {latValid && lngValid && (
          <div className="mb-3 rounded-xl overflow-hidden border border-gypi-border">
            <iframe
              title="preview-mapa"
              width="100%"
              height="180"
              frameBorder="0"
              style={{ border: 0, display: "block" }}
              src={`https://maps.google.com/maps?q=${latNum},${lngNum}&z=16&output=embed`}
              allowFullScreen
            />
          </div>
        )}

        {/* Radio */}
        <div className="mb-4">
          <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">
            Radio de tolerancia: {radio}m
          </label>
          <input
            type="range"
            min={50}
            max={500}
            step={10}
            value={radio}
            onChange={e => setRadio(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: C.cyan }}
          />
          <div className="flex justify-between text-[10px] text-gypi-mute mt-1">
            <span>50m</span>
            <span>500m</span>
          </div>
        </div>

        {/* Botón guardar */}
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          className="w-full py-3.5 rounded-xl border-none text-[15px] font-bold font-heading cursor-pointer"
          style={{
            background: canSave && !saving ? C.green : C.surface,
            color: canSave && !saving ? "#000" : C.mute,
          }}
        >
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
      <div className="bg-gypi-surface rounded-2xl border border-gypi-border p-6 text-center mb-3.5">
        <div className="text-[32px] mb-2">📍</div>
        <div className="text-[15px] font-bold font-heading text-gypi-text mb-1">Sin ubicaciones</div>
        <div className="text-[13px] text-gypi-dim mb-4">Creá puntos de fichaje para habilitar el control de geolocalización</div>
        <button
          onClick={onNew}
          className="py-3 px-6 rounded-xl border-none text-[14px] font-bold font-heading cursor-pointer"
          style={{ background: C.green, color: "#000" }}
        >
          + Nueva ubicación
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3.5">
      <div className="flex justify-between items-center mb-2.5">
        <div className="text-[11px] font-bold text-gypi-dim uppercase tracking-[0.08em]">
          Ubicaciones ({ubicaciones.length})
        </div>
        <button
          onClick={onNew}
          className="py-1.5 px-3 rounded-lg border-none text-[12px] font-bold font-body cursor-pointer"
          style={{ background: `${C.green}22`, color: C.green }}
        >
          + Nueva
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {ubicaciones.map(u => (
          <div
            key={u.id}
            className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: `${C.cyan}18` }}>
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
                className="w-8 h-8 rounded-lg border-none cursor-pointer flex items-center justify-center text-[14px]"
                style={{ background: `${C.amber}18`, color: C.amber }}
              >
                ✏️
              </button>
              <button
                onClick={() => onDelete(u.id)}
                disabled={deleting}
                className="w-8 h-8 rounded-lg border-none cursor-pointer flex items-center justify-center text-[14px]"
                style={{ background: `${C.red}18`, color: C.red }}
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
  const DIVISIONES = getDivisionesConTodos();
  const [empleados, setEmpleados] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [config, setConfig] = useState({});
  const [original, setOriginal] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState(null);
  const [modo, setModo] = useState("individual");
  const [filtroDivision, setFiltroDivision] = useState("todas");
  const [expandedId, setExpandedId] = useState(null);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [masivoCfg, setMasivoCfg] = useState({ activo: true, ubicacion_id: "", radio: 150 });
  const [modalUbicacion, setModalUbicacion] = useState(null);
  const [savingUbicacion, setSavingUbicacion] = useState(false);

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3500); };

  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, ubis] = await Promise.all([
        sb.get("empleados?activo=eq.true&order=nombre.asc&select=id,nombre,apodo,legajo,area,division,rol,geo_config"),
        sb.get(`ubicaciones?empresa_id=eq.${empresaId}&order=nombre.asc`),
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
    if (seleccionados.size === 0) { showToast("Seleccioná al menos un empleado", C.amber); return; }
    if (masivoCfg.activo && !masivoCfg.ubicacion_id) { showToast("Seleccioná una ubicación", C.amber); return; }
    setConfig(p => {
      const c = { ...p };
      seleccionados.forEach(id => {
        c[id] = { activo: masivoCfg.activo, ubicacion_id: masivoCfg.activo ? masivoCfg.ubicacion_id : null, radio: masivoCfg.radio };
      });
      return c;
    });
    showToast(`Configuración aplicada a ${seleccionados.size} empleado${seleccionados.size > 1 ? "s" : ""}`, C.green);
  };

  const guardar = async () => {
    const cambios = empleados.filter(e => tienesCambios(e.id));
    if (!cambios.length) { showToast("No hay cambios para guardar", C.amber); return; }
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
      errores > 0 ? C.amber : C.green
    );
    setSaving(false);
  };

  /* ── Ubicación CRUD ── */
  const handleSaveUbicacion = async (data) => {
    setSavingUbicacion(true);
    try {
      if (data.id) {
        await sb.patch(`ubicaciones?id=eq.${data.id}`, {
          nombre: data.nombre,
          lat: data.lat,
          lng: data.lng,
          radio: data.radio,
        });
        showToast("Ubicación actualizada", C.green);
      } else {
        await sb.post("ubicaciones", {
          empresa_id: empresaId,
          nombre: data.nombre,
          lat: data.lat,
          lng: data.lng,
          radio: data.radio,
        });
        showToast("Ubicación creada", C.green);
      }
      setModalUbicacion(null);
      cargarDatos();
    } catch (e) {
      console.error("Error guardando ubicación:", e);
      showToast("Error al guardar ubicación", C.red);
    } finally {
      setSavingUbicacion(false);
    }
  };

  const handleDeleteUbicacion = async (id) => {
    if (!confirm("¿Eliminar esta ubicación? Los empleados asignados perderán esta referencia.")) return;
    setDeleting(true);
    try {
      await sb.delete(`ubicaciones?id=eq.${id}`);
      showToast("Ubicación eliminada", C.green);
      cargarDatos();
    } catch (e) {
      console.error("Error eliminando ubicación:", e);
      showToast("Error al eliminar", C.red);
    } finally {
      setDeleting(false);
    }
  };

  const getUbicacionNombre = (ubiId) => {
    const u = ubicaciones.find(x => x.id === ubiId);
    return u ? u.nombre : "Sin asignar";
  };

  /* ── Toggle switch reusable ── */
  const Toggle = ({ on, onClick, color = C.green }) => (
    <button
      onClick={onClick}
      className="relative border-none cursor-pointer rounded-full shrink-0"
      style={{ width: 48, height: 28, background: on ? color : C.mute, transition: "all 0.2s" }}
    >
      <div
        className="absolute rounded-full bg-white"
        style={{ width: 22, height: 22, top: 3, left: on ? 23 : 3, transition: "all 0.2s" }}
      />
    </button>
  );

  return (
    <div className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px] relative">
      {/* Toast */}
      {toast && (
        <div
          className="fixed top-[60px] left-1/2 -translate-x-1/2 z-[999] py-3 px-5 rounded-xl text-[13px] font-semibold max-w-[90%]"
          style={{ background: C.bg, border: `1px solid ${toast.color}40`, boxShadow: `0 8px 32px ${toast.color}20`, color: toast.color }}
        >
          {toast.msg}
        </div>
      )}

      {/* Modo toggle */}
      <div className="flex mb-3.5 bg-gypi-surface rounded-xl p-[3px] border border-gypi-border">
        <button
          onClick={() => setModo("masivo")}
          className="flex-1 py-2.5 rounded-[10px] border-none cursor-pointer text-[13px] font-bold font-heading transition-all"
          style={{ background: modo === "masivo" ? C.cyan : "transparent", color: modo === "masivo" ? "#000" : C.dim }}
        >
          ⚡ Asignación masiva
        </button>
        <button
          onClick={() => setModo("individual")}
          className="flex-1 py-2.5 rounded-[10px] border-none cursor-pointer text-[13px] font-bold font-heading transition-all"
          style={{ background: modo === "individual" ? C.amber : "transparent", color: modo === "individual" ? "#000" : C.dim }}
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
        <div className="text-center p-10 text-gypi-dim text-[13px]">Cargando personal...</div>
      ) : modo === "masivo" ? (
        <>
          {/* Paso 1: Configuración masiva */}
          <div className="bg-gypi-surface rounded-2xl p-4 mb-3.5" style={{ border: `1px solid ${C.cyan}30` }}>
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] mb-3" style={{ color: C.cyan }}>
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
              <Toggle on={masivoCfg.activo} onClick={() => setMasivoCfg(p => ({ ...p, activo: !p.activo }))} color={C.green} />
            </div>

            {masivoCfg.activo && (
              <>
                {/* Ubicación */}
                <div className="mb-3">
                  <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Ubicación</label>
                  <select
                    value={masivoCfg.ubicacion_id}
                    onChange={e => setMasivoCfg(p => ({ ...p, ubicacion_id: e.target.value }))}
                    className="w-full py-3 px-3.5 rounded-[10px] bg-gypi-surf-lo border border-gypi-border text-gypi-text text-sm font-body outline-none"
                  >
                    <option value="">Seleccionar ubicación...</option>
                    {ubicaciones.map(u => (
                      <option key={u.id} value={u.id}>{u.nombre} ({u.lat?.toFixed(3)}, {u.lng?.toFixed(3)})</option>
                    ))}
                  </select>
                </div>

                {/* Radio */}
                <div className="mb-1">
                  <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">
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
                    style={{ accentColor: C.cyan }}
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
          <div className="bg-gypi-surface rounded-2xl p-4 border border-gypi-border mb-3.5">
            <div className="flex justify-between items-center mb-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: C.cyan }}>
                ② Seleccioná empleados
              </div>
              <Tag color={seleccionados.size > 0 ? C.amber : C.dim}>{seleccionados.size} seleccionados</Tag>
            </div>
            <div className="flex gap-1 mb-2.5 overflow-x-auto pb-0.5">
              {DIVISIONES.map(d => (
                <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || C.cyan}>
                  {d.label}
                </Chip>
              ))}
            </div>
            <button
              onClick={seleccionarTodosFiltrados}
              className="w-full py-2 rounded-lg text-gypi-cyan text-xs font-bold font-body cursor-pointer mb-2 bg-transparent"
              style={{ border: `1px dashed ${C.border}` }}
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
                      border: `1px solid ${sel ? `${C.cyan}40` : C.border}`,
                      background: sel ? `${C.cyan}10` : "transparent",
                    }}
                  >
                    <div
                      className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-xs font-bold shrink-0"
                      style={{
                        border: `2px solid ${sel ? C.cyan : C.mute}`,
                        background: sel ? C.cyan : "transparent",
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
                    {changed && <Tag color={C.amber}>Editado</Tag>}
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
              background: seleccionados.size > 0 ? `linear-gradient(135deg, ${C.cyan}, ${C.green})` : C.surface,
              color: seleccionados.size > 0 ? "#000" : C.mute,
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
              <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || C.amber}>
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
                  style={{ border: `1px solid ${changed ? `${C.amber}40` : C.border}` }}
                >
                  {/* Header */}
                  <button
                    onClick={() => setExpandedId(isExp ? null : emp.id)}
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
                          style={{ background: C.green }}
                        />
                      )}
                      {changed && <Tag color={C.amber}>Editado</Tag>}
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
                        style={{ background: `${C.green}15`, color: C.green }}
                      >
                        📍 {getUbicacionNombre(gc.ubicacion_id)} · {gc.radio || 150}m
                      </div>
                    </div>
                  )}

                  {/* Expanded */}
                  {isExp && (
                    <div className="px-3.5 pb-3.5">
                      {/* Toggle activo */}
                      <div className="flex items-center justify-between py-2.5 mb-3 px-2 rounded-lg" style={{ background: gc.activo ? `${C.green}08` : `${C.mute}08` }}>
                        <div>
                          <div className="text-[13px] font-semibold text-gypi-text">Control de ubicación</div>
                          <div className="text-[11px] text-gypi-dim mt-0.5">
                            {gc.activo ? "Fichaje requiere geolocalización" : "Fichaje sin restricción de ubicación"}
                          </div>
                        </div>
                        <Toggle on={gc.activo} onClick={() => toggleGeoActivo(emp.id)} color={C.green} />
                      </div>

                      {gc.activo && (
                        <>
                          {/* Ubicación select */}
                          <div className="mb-3">
                            <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Ubicación</label>
                            <select
                              value={gc.ubicacion_id || ""}
                              onChange={e => setGeoConfig(emp.id, "ubicacion_id", e.target.value || null)}
                              className="w-full py-3 px-3.5 rounded-[10px] bg-gypi-surf-lo border border-gypi-border text-gypi-text text-sm font-body outline-none"
                            >
                              <option value="">Sin asignar</option>
                              {ubicaciones.map(u => (
                                <option key={u.id} value={u.id}>{u.nombre}</option>
                              ))}
                            </select>
                          </div>

                          {/* Radio */}
                          <div className="mb-2">
                            <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">
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
                              style={{ accentColor: C.cyan }}
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
                          <Tag color={C.amber}>sin guardar</Tag>
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
              background: saving ? C.surface : `linear-gradient(135deg, ${C.amber}, ${C.violet})`,
              color: saving ? C.dim : "#000",
              cursor: saving ? "default" : "pointer",
              boxShadow: `0 8px 32px ${C.amber}30`,
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
    </div>
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
