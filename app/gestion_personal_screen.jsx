import { useState, useEffect, useCallback } from "react";
import { C, fH, fB, fM } from "./lib/theme";
import { sb } from "./lib/supabase";

/* ═══ CONSTANTES ═══ */
const SHEETS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSGzSYSab3R6MnRfHxsQXfiScWHCT5hPuvp8Fg8TsdDsmBqMZW5L51S-RMT8DT40F6fJ5eonSdg_n2H/pub?gid=1919000183&single=true&output=csv";

const DIVISIONES = [
  { id: "", label: "Sin asignar" },
  { id: "herreria", label: "Herrería", icon: "🔥", color: C.amber },
  { id: "muebles", label: "Muebles", icon: "🪵", color: C.green },
  { id: "aberturas", label: "Aberturas", icon: "🪟", color: C.cyan },
];

const ROLES = ["empleado", "gerencia", "admin"];
const AREAS = ["produccion", "administracion", "logistica", "mantenimiento"];

const TIPO_MO_MAP = {
  DIRECTA: "produccion",
  INDIRECTA: "administracion",
};

/* ═══ PRIMITIVAS ═══ */
const Tag = ({ color = C.amber, children, style = {} }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: `${color}22`, color, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: fB, ...style }}>{children}</span>
);

const Chip = ({ active, onClick, children, color = C.amber }) => (
  <button onClick={onClick} style={{
    padding: "8px 14px", borderRadius: 20, border: "none", cursor: "pointer",
    background: active ? `${color}22` : C.surface,
    color: active ? color : C.dim,
    fontSize: 12, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap",
    transition: "all 0.15s",
  }}>{children}</button>
);

/* ═══ PARSER CSV ═══ */
function parsePersonalCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const parseRow = (line) => {
    const fields = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ""; }
      else { current += ch; }
    }
    fields.push(current.trim());
    return fields;
  };

  // Columnas: A=colaborador_id, B=nombre, C=tipo_mo, D=931, E=USIMRA, F=ACTIVO
  const COL_ID = 0;
  const COL_NOMBRE = 1;
  const COL_TIPO = 2;
  const COL_ACTIVO = 5;

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const fields = parseRow(line);
    const id = (fields[COL_ID] || "").replace(/^\uFEFF/, "").trim();
    if (!id || !/^\d/.test(id)) continue;

    const nombre = (fields[COL_NOMBRE] || "").trim();
    if (!nombre) continue;

    results.push({
      colaborador_id: parseInt(id),
      nombre,
      tipo_mo: (fields[COL_TIPO] || "").trim().toUpperCase(),
      activo_csv: (fields[COL_ACTIVO] || "").trim().toUpperCase() === "SI",
    });
  }
  return results;
}

/* Capitalizar nombre: "GUZMAN FACUNDO ARIEL" → "Guzman Facundo Ariel" */
function capitalizarNombre(str) {
  return str.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/* Generar apodo: "Guzman Facundo Ariel" → "Facundo" */
function generarApodo(nombre) {
  const partes = nombre.split(" ");
  return partes.length >= 2 ? partes[1] : partes[0];
}

/* Generar email: "Guzman Facundo Ariel" → "facundo.guzman@gi-group.com" */
function generarEmail(nombre) {
  const partes = nombre.toLowerCase().split(" ");
  if (partes.length >= 2) return `${partes[1]}.${partes[0]}@gi-group.com`;
  return `${partes[0]}@gi-group.com`;
}

/* ═══ MODAL ALTA MANUAL ═══ */
function ModalAlta({ onClose, onSave, saving }) {
  const [form, setForm] = useState({ nombre: "", legajo: "", email: "", apodo: "", area: "produccion", division: "", rol: "empleado" });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const valid = form.nombre.trim() && form.legajo.trim() && form.email.trim();

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 460, background: C.bg, borderRadius: "20px 20px 0 0", padding: "20px 18px 30px", maxHeight: "85vh", overflowY: "auto", border: `1px solid ${C.border}` }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.mute, margin: "0 auto 16px" }} />
        <h3 style={{ margin: "0 0 16px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>Alta manual de empleado</h3>

        {[
          ["Nombre completo", "nombre", "Ej: García Juan Manuel"],
          ["Legajo", "legajo", "Ej: 210"],
          ["Email", "email", "Ej: juan.garcia@gi-group.com"],
          ["Apodo", "apodo", "Ej: Juan"],
        ].map(([label, key, ph]) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</label>
            <input value={form[key]} onChange={e => set(key, e.target.value)} placeholder={ph} style={{
              width: "100%", padding: "11px 14px", borderRadius: 10, background: C.surface,
              border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB,
              outline: "none", boxSizing: "border-box",
            }} />
          </div>
        ))}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Área</label>
            <select value={form.area} onChange={e => set("area", e.target.value)} style={{ width: "100%", padding: "11px 10px", borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, fontFamily: fB, outline: "none" }}>
              {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>División</label>
            <select value={form.division} onChange={e => set("division", e.target.value)} style={{ width: "100%", padding: "11px 10px", borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, fontFamily: fB, outline: "none" }}>
              {DIVISIONES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Rol</label>
          <div style={{ display: "flex", gap: 6 }}>
            {ROLES.map(r => (
              <button key={r} onClick={() => set("rol", r)} style={{
                flex: 1, padding: "9px 0", borderRadius: 10, border: "none", cursor: "pointer",
                background: form.rol === r ? `${C.amber}22` : C.surface,
                color: form.rol === r ? C.amber : C.dim,
                fontSize: 12, fontWeight: 700, fontFamily: fB,
              }}>{r}</button>
            ))}
          </div>
        </div>

        <button onClick={() => onSave(form)} disabled={!valid || saving} style={{
          width: "100%", padding: 14, borderRadius: 12, border: "none",
          background: valid && !saving ? C.green : C.surface,
          color: valid && !saving ? "#000" : C.mute,
          fontSize: 15, fontWeight: 700, fontFamily: fH, cursor: valid && !saving ? "pointer" : "default",
        }}>
          {saving ? "Guardando..." : "Dar de alta"}
        </button>
      </div>
    </div>
  );
}

/* ═══ MODAL CONFIRMAR BAJA ═══ */
function ModalBaja({ empleado, onClose, onConfirm, saving }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "90%", maxWidth: 380, background: C.bg, borderRadius: 20, padding: 24, border: `1px solid ${C.red}30` }}>
        <div style={{ fontSize: 32, textAlign: "center", marginBottom: 12 }}>⚠️</div>
        <h3 style={{ margin: "0 0 8px", fontFamily: fH, fontSize: 17, fontWeight: 700, color: C.text, textAlign: "center" }}>
          Dar de baja a {empleado.apodo || empleado.nombre}
        </h3>
        <p style={{ fontSize: 13, color: C.dim, textAlign: "center", lineHeight: 1.5, margin: "0 0 20px" }}>
          Se marcará como inactivo. No se borra ningún dato y se puede reactivar después.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`,
            background: "transparent", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer",
          }}>Cancelar</button>
          <button onClick={onConfirm} disabled={saving} style={{
            flex: 1, padding: 12, borderRadius: 12, border: "none",
            background: saving ? C.surface : C.red, color: saving ? C.dim : "#fff",
            fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: saving ? "default" : "pointer",
          }}>{saving ? "..." : "Dar de baja"}</button>
        </div>
      </div>
    </div>
  );
}

/* ═══ MODAL REACTIVAR ═══ */
function ModalReactivar({ empleado, onClose, onConfirm, saving }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "90%", maxWidth: 380, background: C.bg, borderRadius: 20, padding: 24, border: `1px solid ${C.green}30` }}>
        <div style={{ fontSize: 32, textAlign: "center", marginBottom: 12 }}>✅</div>
        <h3 style={{ margin: "0 0 8px", fontFamily: fH, fontSize: 17, fontWeight: 700, color: C.text, textAlign: "center" }}>
          Reactivar a {empleado.apodo || empleado.nombre}
        </h3>
        <p style={{ fontSize: 13, color: C.dim, textAlign: "center", lineHeight: 1.5, margin: "0 0 20px" }}>
          Volverá a aparecer como empleado activo en el sistema.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`,
            background: "transparent", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer",
          }}>Cancelar</button>
          <button onClick={onConfirm} disabled={saving} style={{
            flex: 1, padding: 12, borderRadius: 12, border: "none",
            background: saving ? C.surface : C.green, color: saving ? C.dim : "#000",
            fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: saving ? "default" : "pointer",
          }}>{saving ? "..." : "Reactivar"}</button>
        </div>
      </div>
    </div>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function GestionPersonalScreen({ reload }) {
  const [empleados, setEmpleados] = useState([]);
  const [csvData, setCsvData] = useState([]);
  const [csvLoading, setCsvLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("activos"); // activos | inactivos | nuevos-csv
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [modalAlta, setModalAlta] = useState(false);
  const [modalBaja, setModalBaja] = useState(null);
  const [modalReactivar, setModalReactivar] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // ── Cargar empleados de Supabase ──
  const cargarEmpleados = useCallback(async () => {
    setLoading(true);
    try {
      const data = await sb.get("empleados?select=*&order=legajo.asc");
      setEmpleados(data || []);
    } catch (err) {
      console.error("Error cargando empleados:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarEmpleados(); }, [cargarEmpleados]);

  // ── Cargar CSV de Google Sheets ──
  const cargarCSV = useCallback(async () => {
    setCsvLoading(true);
    try {
      const res = await fetch(SHEETS_CSV_URL);
      const text = await res.text();
      const rows = parsePersonalCSV(text);
      setCsvData(rows);
    } catch (err) {
      console.error("Error cargando CSV:", err);
    } finally {
      setCsvLoading(false);
    }
  }, []);

  useEffect(() => { cargarCSV(); }, [cargarCSV]);

  // ── Detectar empleados nuevos del CSV (no están en Supabase) ──
  const legajosExistentes = new Set(empleados.map(e => e.legajo));
  const nuevosCSV = csvData.filter(r => r.activo_csv && !legajosExistentes.has(r.colaborador_id));

  // ── Filtrar ──
  const filtrados = (() => {
    let list;
    if (filter === "activos") list = empleados.filter(e => e.activo);
    else if (filter === "inactivos") list = empleados.filter(e => !e.activo);
    else return []; // nuevos-csv se maneja aparte
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => e.nombre?.toLowerCase().includes(q) || String(e.legajo).includes(q) || e.apodo?.toLowerCase().includes(q));
    }
    return list;
  })();

  // ── Toast ──
  const showToast = (msg, color) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Sincronizar todos los nuevos del CSV ──
  const sincronizarCSV = async () => {
    if (nuevosCSV.length === 0) return;
    setSyncing(true);
    let ok = 0, err = 0;
    for (const row of nuevosCSV) {
      const nombre = capitalizarNombre(row.nombre);
      try {
        await sb.post("empleados", {
          legajo: row.colaborador_id,
          nombre,
          apodo: generarApodo(nombre),
          email: generarEmail(row.nombre),
          area: TIPO_MO_MAP[row.tipo_mo] || "produccion",
          rol: "empleado",
          activo: true,
        });
        ok++;
      } catch (e) {
        console.error(`Error al dar de alta ${nombre}:`, e);
        err++;
      }
    }
    await cargarEmpleados();
    if (reload) reload();
    showToast(`✅ ${ok} empleado${ok > 1 ? "s" : ""} dado${ok > 1 ? "s" : ""} de alta${err ? ` (${err} errores)` : ""}`, err ? C.amber : C.green);
    setSyncing(false);
  };

  // ── Alta individual desde CSV ──
  const altaDesdeCSV = async (row) => {
    setSaving(true);
    const nombre = capitalizarNombre(row.nombre);
    try {
      await sb.post("empleados", {
        legajo: row.colaborador_id,
        nombre,
        apodo: generarApodo(nombre),
        email: generarEmail(row.nombre),
        area: TIPO_MO_MAP[row.tipo_mo] || "produccion",
        rol: "empleado",
        activo: true,
      });
      await cargarEmpleados();
      if (reload) reload();
      showToast(`✅ ${nombre} dado de alta`, C.green);
    } catch (e) {
      console.error(e);
      showToast(`Error al dar de alta: ${e.message}`, C.red);
    } finally {
      setSaving(false);
    }
  };

  // ── Alta manual ──
  const altaManual = async (form) => {
    setSaving(true);
    try {
      await sb.post("empleados", {
        legajo: parseInt(form.legajo),
        nombre: form.nombre,
        apodo: form.apodo || generarApodo(form.nombre),
        email: form.email,
        area: form.area,
        division: form.division || null,
        rol: form.rol,
        activo: true,
      });
      setModalAlta(false);
      await cargarEmpleados();
      if (reload) reload();
      showToast(`✅ ${form.nombre} dado de alta`, C.green);
    } catch (e) {
      console.error(e);
      showToast(`Error: ${e.message}`, C.red);
    } finally {
      setSaving(false);
    }
  };

  // ── Dar de baja ──
  const darDeBaja = async (emp) => {
    setSaving(true);
    try {
      await sb.patch(`empleados?id=eq.${emp.id}`, { activo: false });

      // Notificar
      try {
        await fetch("/api/send-push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legajo: String(emp.legajo),
            title: "📋 Actualización de estado",
            body: "Tu cuenta fue desactivada. Contactá a gerencia para más info.",
            data: { tag: "baja-empleado" },
          }),
        });
      } catch (e) { console.warn("Push baja falló:", e); }

      setModalBaja(null);
      await cargarEmpleados();
      if (reload) reload();
      showToast(`${emp.apodo || emp.nombre} dado de baja`, C.amber);
    } catch (e) {
      console.error(e);
      showToast(`Error: ${e.message}`, C.red);
    } finally {
      setSaving(false);
    }
  };

  // ── Reactivar ──
  const reactivar = async (emp) => {
    setSaving(true);
    try {
      await sb.patch(`empleados?id=eq.${emp.id}`, { activo: true });

      try {
        await fetch("/api/send-push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legajo: String(emp.legajo),
            title: "✅ Cuenta reactivada",
            body: "Tu cuenta fue reactivada en GI Group.",
            data: { tag: "alta-empleado" },
          }),
        });
      } catch (e) { console.warn("Push reactivar falló:", e); }

      setModalReactivar(null);
      await cargarEmpleados();
      if (reload) reload();
      showToast(`✅ ${emp.apodo || emp.nombre} reactivado`, C.green);
    } catch (e) {
      console.error(e);
      showToast(`Error: ${e.message}`, C.red);
    } finally {
      setSaving(false);
    }
  };

  // ── Métricas ──
  const activos = empleados.filter(e => e.activo).length;
  const inactivos = empleados.filter(e => !e.activo).length;

  // ── Render ──
  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px", position: "relative" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
          zIndex: 999, padding: "12px 20px", borderRadius: 12,
          background: C.bg, border: `1px solid ${toast.color}40`,
          boxShadow: `0 8px 32px ${toast.color}20`,
          fontSize: 13, fontWeight: 600, color: toast.color,
          animation: "fadeIn 0.25s ease", maxWidth: "90%",
        }}>
          {toast.msg}
        </div>
      )}

      {/* Modales */}
      {modalAlta && <ModalAlta onClose={() => setModalAlta(false)} onSave={altaManual} saving={saving} />}
      {modalBaja && <ModalBaja empleado={modalBaja} onClose={() => setModalBaja(null)} onConfirm={() => darDeBaja(modalBaja)} saving={saving} />}
      {modalReactivar && <ModalReactivar empleado={modalReactivar} onClose={() => setModalReactivar(null)} onConfirm={() => reactivar(modalReactivar)} saving={saving} />}

      {/* Header info */}
      <div style={{
        background: `linear-gradient(135deg, ${C.green}12, ${C.surface})`,
        borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <div style={{ fontSize: 11, color: C.green, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          GESTIÓN DE PERSONAL
        </div>
        <div style={{ fontSize: 13, color: C.text, marginTop: 6, lineHeight: 1.5 }}>
          Sincronizá la plantilla desde Google Sheets o dá de alta/baja manualmente.
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          <Tag color={C.green}>{activos} activos</Tag>
          {inactivos > 0 && <Tag color={C.red}>{inactivos} inactivos</Tag>}
          {nuevosCSV.length > 0 && <Tag color={C.amber}>{nuevosCSV.length} nuevos en planilla</Tag>}
          {csvLoading && <Tag color={C.dim}>Cargando CSV...</Tag>}
        </div>
      </div>

      {/* Métricas */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, textAlign: "center" }}>
          <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.green }}>{activos}</div>
          <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Activos</div>
        </div>
        <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, textAlign: "center" }}>
          <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.mute }}>{inactivos}</div>
          <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Inactivos</div>
        </div>
        <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${nuevosCSV.length > 0 ? `${C.amber}30` : C.border}`, textAlign: "center" }}>
          <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: nuevosCSV.length > 0 ? C.amber : C.mute }}>{nuevosCSV.length}</div>
          <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Nuevos CSV</div>
        </div>
      </div>

      {/* Filtros + búsqueda */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 4 }}>
        <Chip active={filter === "activos"} onClick={() => setFilter("activos")} color={C.green}>✅ Activos</Chip>
        <Chip active={filter === "inactivos"} onClick={() => setFilter("inactivos")} color={C.red}>🚫 Inactivos</Chip>
        <Chip active={filter === "nuevos-csv"} onClick={() => setFilter("nuevos-csv")} color={C.amber}>
          📥 Nuevos ({nuevosCSV.length})
        </Chip>
      </div>

      {filter !== "nuevos-csv" && (
        <div style={{ marginBottom: 12 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Buscar por nombre o legajo..."
            style={{
              width: "100%", padding: "11px 14px", borderRadius: 12, background: C.surface,
              border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB,
              outline: "none", boxSizing: "border-box",
            }}
          />
        </div>
      )}

      {/* Acciones masivas */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setModalAlta(true)} style={{
          flex: 1, padding: "10px 0", borderRadius: 12, border: "none",
          background: `${C.green}22`, color: C.green,
          fontSize: 13, fontWeight: 700, fontFamily: fB, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
          ➕ Alta manual
        </button>
        {filter === "nuevos-csv" && nuevosCSV.length > 0 && (
          <button onClick={sincronizarCSV} disabled={syncing} style={{
            flex: 1, padding: "10px 0", borderRadius: 12, border: "none",
            background: syncing ? C.surface : `${C.amber}22`, color: syncing ? C.dim : C.amber,
            fontSize: 13, fontWeight: 700, fontFamily: fB, cursor: syncing ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            {syncing ? "⏳ Sincronizando..." : `📥 Alta todos (${nuevosCSV.length})`}
          </button>
        )}
        <button onClick={cargarCSV} disabled={csvLoading} style={{
          width: 44, height: 44, borderRadius: 12, border: "none",
          background: C.surface, color: C.dim, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16,
        }}>
          🔄
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: C.dim, fontSize: 13 }}>Cargando personal...</div>
      ) : filter === "nuevos-csv" ? (
        /* ── Vista de nuevos del CSV ── */
        nuevosCSV.length === 0 ? (
          <div style={{ background: C.surface, borderRadius: 16, padding: 40, textAlign: "center", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Todo sincronizado</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>No hay empleados nuevos en la planilla</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {nuevosCSV.map(row => (
              <div key={row.colaborador_id} style={{
                background: C.surface, borderRadius: 14, padding: 14,
                border: `1px solid ${C.amber}30`,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10, background: C.amberS,
                  color: C.amber, display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: fH, fontSize: 12, fontWeight: 700,
                }}>
                  {capitalizarNombre(row.nombre).split(" ").map(w => w[0]).slice(0, 2).join("")}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {capitalizarNombre(row.nombre)}
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>
                    ID {row.colaborador_id} · {row.tipo_mo}
                  </div>
                </div>
                <button onClick={() => altaDesdeCSV(row)} disabled={saving} style={{
                  padding: "8px 14px", borderRadius: 10, border: "none",
                  background: saving ? C.surface : C.green, color: saving ? C.dim : "#000",
                  fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: saving ? "default" : "pointer",
                }}>
                  + Alta
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        /* ── Vista de empleados existentes ── */
        <>
          {filtrados.length === 0 ? (
            <div style={{ background: C.surface, borderRadius: 16, padding: 40, textAlign: "center", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{filter === "inactivos" ? "🚫" : "👥"}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                {search ? "Sin resultados" : filter === "inactivos" ? "No hay empleados inactivos" : "Sin empleados"}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filtrados.map(emp => {
                const divInfo = DIVISIONES.find(d => d.id === emp.division) || DIVISIONES[0];
                const isActivo = emp.activo;
                return (
                  <div key={emp.id} style={{
                    background: C.surface, borderRadius: 14, padding: 14,
                    border: `1px solid ${C.border}`, opacity: isActivo ? 1 : 0.6,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: 10,
                        background: isActivo ? (emp.division ? `${divInfo.color || C.dim}22` : C.surfLo) : C.redS,
                        color: isActivo ? (emp.division ? divInfo.color : C.mute) : C.red,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: fH, fontSize: 12, fontWeight: 700,
                      }}>
                        {emp.division && divInfo.icon ? divInfo.icon : (emp.nombre || "").split(" ").map(w => w[0]).slice(0, 2).join("")}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {emp.nombre}
                        </div>
                        <div style={{ fontSize: 11, color: C.dim, marginTop: 1, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <span>L-{emp.legajo}</span>
                          <span>·</span>
                          <span>{emp.area || "sin área"}</span>
                          {emp.division && <><span>·</span><span style={{ color: divInfo.color }}>{divInfo.label}</span></>}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Tag color={emp.rol === "gerencia" ? C.violet : emp.rol === "admin" ? C.cyan : C.dim}>
                          {emp.rol}
                        </Tag>
                        {isActivo ? (
                          <button onClick={() => setModalBaja(emp)} style={{
                            width: 32, height: 32, borderRadius: 8, border: "none",
                            background: C.redS, color: C.red, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 14,
                          }} title="Dar de baja">✕</button>
                        ) : (
                          <button onClick={() => setModalReactivar(emp)} style={{
                            width: 32, height: 32, borderRadius: 8, border: "none",
                            background: C.greenS, color: C.green, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 14,
                          }} title="Reactivar">↩</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Footer info */}
      <div style={{ textAlign: "center", marginTop: 16, fontSize: 10, color: C.mute, lineHeight: 1.6 }}>
        CSV actualizado desde Google Sheets · {csvData.length} registros cargados
      </div>
    </div>
  );
}
