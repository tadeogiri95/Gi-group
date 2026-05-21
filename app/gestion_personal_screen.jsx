import { useState, useEffect, useCallback } from "react";
import { C, fH, fB, fM, DIAS_KEY } from "./lib/theme";
import { sb } from "./lib/supabase";

/* ═══ CONSTANTES ═══ */
const SHEETS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSGzSYSab3R6MnRfHxsQXfiScWHCT5hPuvp8Fg8TsdDsmBqMZW5L51S-RMT8DT40F6fJ5eonSdg_n2H/pub?gid=1919000183&single=true&output=csv";

const DIVISIONES = [
  { id: "", label: "Sin asignar" },
  { id: "herreria", label: "Herrería", icon: "🔥", color: C.amber },
  { id: "muebles", label: "Muebles", icon: "🪵", color: C.green },
  { id: "aberturas", label: "Aberturas", icon: "🪟", color: C.cyan },
  { id: "general", label: "General", icon: "🏭", color: C.violet },
];

const ROLES = ["operativo", "gerencial", "administrativo"];
const AREAS = ["produccion", "administracion", "logistica"];
const TIPO_MO_MAP = { DIRECTA: "produccion", INDIRECTA: "administracion" };

/* ═══ PRIMITIVAS ═══ */
const Tag = ({ color = C.amber, children, style = {} }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: `${color}22`, color, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: fB, ...style }}>{children}</span>
);
const Chip = ({ active, onClick, children, color = C.amber }) => (
  <button onClick={onClick} style={{
    padding: "8px 14px", borderRadius: 20, border: "none", cursor: "pointer",
    background: active ? `${color}22` : C.surface, color: active ? color : C.dim,
    fontSize: 12, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap", transition: "all 0.15s",
  }}>{children}</button>
);

/* ═══ PARSER CSV ═══ */
function parsePersonalCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const parseRow = (line) => {
    const fields = []; let current = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { fields.push(current.trim()); current = ""; }
      else current += ch;
    }
    fields.push(current.trim());
    return fields;
  };
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]; if (!line.trim()) continue;
    const f = parseRow(line);
    const id = (f[0] || "").replace(/^\uFEFF/, "").trim();
    if (!id || !/^\d/.test(id)) continue;
    const nombre = (f[1] || "").trim();
    if (!nombre) continue;
    results.push({
      colaborador_id: parseInt(id), nombre,
      tipo_mo: (f[2] || "").trim().toUpperCase(),
      activo_csv: (f[5] || "").trim().toUpperCase() === "SI",
    });
  }
  return results;
}

function capitalizarNombre(str) {
  return str.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
function generarApodo(nombre) {
  const p = nombre.split(" "); return p.length >= 2 ? p[1] : p[0];
}
function generarEmail(nombre) {
  const p = nombre.toLowerCase().split(" ");
  return p.length >= 2 ? `${p[1]}.${p[0]}@gi-group.com` : `${p[0]}@gi-group.com`;
}

/* ═══ MODAL EDITAR EMPLEADO ═══ */
function ModalEditar({ emp, onClose, onSave, saving }) {
  const [form, setForm] = useState({
    nombre: emp.nombre || "", apodo: emp.apodo || "", email: emp.email || "",
    area: emp.area || "produccion", division: emp.division || "", rol: emp.rol || "empleado",
    legajo: String(emp.legajo || ""),
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const valid = form.nombre.trim() && form.email.trim();

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 460, background: C.bg, borderRadius: "20px 20px 0 0", padding: "20px 18px 30px", maxHeight: "85vh", overflowY: "auto", border: `1px solid ${C.border}` }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.mute, margin: "0 auto 16px" }} />
        <h3 style={{ margin: "0 0 16px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>
          Editar · L-{emp.legajo}
        </h3>

        {[["Nombre completo", "nombre"], ["Apodo", "apodo"], ["Email", "email"]].map(([label, key]) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</label>
            <input value={form[key]} onChange={e => set(key, e.target.value)} style={{
              width: "100%", padding: "11px 14px", borderRadius: 10, background: C.surface,
              border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box",
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
                background: form.rol === r ? `${C.amber}22` : C.surface, color: form.rol === r ? C.amber : C.dim,
                fontSize: 12, fontWeight: 700, fontFamily: fB,
              }}>{r}</button>
            ))}
          </div>
        </div>

        <button onClick={() => onSave(form)} disabled={!valid || saving} style={{
          width: "100%", padding: 14, borderRadius: 12, border: "none",
          background: valid && !saving ? C.amber : C.surface, color: valid && !saving ? "#000" : C.mute,
          fontSize: 15, fontWeight: 700, fontFamily: fH, cursor: valid && !saving ? "pointer" : "default",
        }}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

/* ═══ MODAL ALTA MANUAL ═══ */
function ModalAlta({ onClose, onSave, saving }) {
  const [form, setForm] = useState({ nombre: "", legajo: "", email: "", apodo: "", area: "produccion", division: "", rol: "operativo" });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const valid = form.nombre.trim() && form.legajo.trim() && form.email.trim();

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 460, background: C.bg, borderRadius: "20px 20px 0 0", padding: "20px 18px 30px", maxHeight: "85vh", overflowY: "auto", border: `1px solid ${C.border}` }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.mute, margin: "0 auto 16px" }} />
        <h3 style={{ margin: "0 0 16px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>Alta de empleado</h3>

        {[["Nombre completo", "nombre", "Ej: García Juan Manuel"], ["Legajo", "legajo", "Ej: 210"], ["Email", "email", "Ej: juan.garcia@gi-group.com"], ["Apodo", "apodo", "Ej: Juan"]].map(([label, key, ph]) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</label>
            <input value={form[key]} onChange={e => set(key, e.target.value)} placeholder={ph} style={{
              width: "100%", padding: "11px 14px", borderRadius: 10, background: C.surface,
              border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box",
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
                background: form.rol === r ? `${C.amber}22` : C.surface, color: form.rol === r ? C.amber : C.dim,
                fontSize: 12, fontWeight: 700, fontFamily: fB,
              }}>{r}</button>
            ))}
          </div>
        </div>

        <button onClick={() => onSave(form)} disabled={!valid || saving} style={{
          width: "100%", padding: 14, borderRadius: 12, border: "none",
          background: valid && !saving ? C.green : C.surface, color: valid && !saving ? "#000" : C.mute,
          fontSize: 15, fontWeight: 700, fontFamily: fH, cursor: valid && !saving ? "pointer" : "default",
        }}>
          {saving ? "Guardando..." : "Dar de alta"}
        </button>
      </div>
    </div>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function GestionPersonalScreen({ ctx, reload }) {
  const [empleados, setEmpleados] = useState([]);
  const [csvData, setCsvData] = useState([]);
  const [csvLoading, setCsvLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("activos");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [modalAlta, setModalAlta] = useState(false);
  const [modalEditar, setModalEditar] = useState(null);
  const [confirmBaja, setConfirmBaja] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const dH = DIAS_KEY[new Date().getDay()];

  // ── Cargar empleados ──
  const cargarEmpleados = useCallback(async () => {
    setLoading(true);
    try {
      const data = await sb.get("empleados?select=*&order=legajo.asc");
      setEmpleados(data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);
  useEffect(() => { cargarEmpleados(); }, [cargarEmpleados]);

  // ── Cargar CSV ──
  const cargarCSV = useCallback(async () => {
    setCsvLoading(true);
    try {
      const res = await fetch(SHEETS_CSV_URL);
      const text = await res.text();
      setCsvData(parsePersonalCSV(text));
    } catch (err) { console.error(err); } finally { setCsvLoading(false); }
  }, []);
  useEffect(() => { cargarCSV(); }, [cargarCSV]);

  const legajosExistentes = new Set(empleados.map(e => e.legajo));
  const nuevosCSV = csvData.filter(r => r.activo_csv && !legajosExistentes.has(r.colaborador_id));
  const activos = empleados.filter(e => e.activo).length;
  const inactivos = empleados.filter(e => !e.activo).length;

  const filtrados = (() => {
    let list;
    if (filter === "activos") list = empleados.filter(e => e.activo);
    else if (filter === "inactivos") list = empleados.filter(e => !e.activo);
    else return [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => e.nombre?.toLowerCase().includes(q) || String(e.legajo).includes(q) || e.apodo?.toLowerCase().includes(q));
    }
    return list;
  })();

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3500); };

  // ── Sync all from CSV ──
  const sincronizarCSV = async () => {
    if (!nuevosCSV.length) return;
    setSyncing(true);
    let ok = 0;
    for (const row of nuevosCSV) {
      const nombre = capitalizarNombre(row.nombre);
      try {
        await sb.post("empleados", { legajo: row.colaborador_id, nombre, apodo: generarApodo(nombre), email: generarEmail(row.nombre), area: TIPO_MO_MAP[row.tipo_mo] || "produccion", rol: "operativo", activo: true });
        ok++;
      } catch (e) { console.error(e); }
    }
    await cargarEmpleados(); if (reload) reload();
    showToast(`✅ ${ok} empleado${ok > 1 ? "s" : ""} dado${ok > 1 ? "s" : ""} de alta`, C.green);
    setSyncing(false);
  };

  // ── Alta individual CSV ──
  const altaDesdeCSV = async (row) => {
    setSaving(true);
    const nombre = capitalizarNombre(row.nombre);
    try {
      await sb.post("empleados", { legajo: row.colaborador_id, nombre, apodo: generarApodo(nombre), email: generarEmail(row.nombre), area: TIPO_MO_MAP[row.tipo_mo] || "produccion", rol: "operativo", activo: true });
      await cargarEmpleados(); if (reload) reload();
      showToast(`✅ ${nombre} dado de alta`, C.green);
    } catch (e) { showToast(`Error: ${e.message}`, C.red); } finally { setSaving(false); }
  };

  // ── Alta manual ──
  const altaManual = async (form) => {
    setSaving(true);
    try {
      await sb.post("empleados", { legajo: parseInt(form.legajo), nombre: form.nombre, apodo: form.apodo || generarApodo(form.nombre), email: form.email, area: form.area, division: form.division || null, rol: form.rol, activo: true });
      setModalAlta(false); await cargarEmpleados(); if (reload) reload();
      showToast(`✅ ${form.nombre} dado de alta`, C.green);
    } catch (e) { showToast(`Error: ${e.message}`, C.red); } finally { setSaving(false); }
  };

  // ── Editar empleado ──
  const guardarEdicion = async (form) => {
    if (!modalEditar) return;
    setSaving(true);
    try {
      await sb.patch(`empleados?id=eq.${modalEditar.id}`, {
        nombre: form.nombre, apodo: form.apodo, email: form.email,
        area: form.area, division: form.division || null, rol: form.rol,
      });
      setModalEditar(null); await cargarEmpleados(); if (reload) reload();
      showToast(`✅ ${form.apodo || form.nombre} actualizado`, C.green);
    } catch (e) { showToast(`Error: ${e.message}`, C.red); } finally { setSaving(false); }
  };

  // ── Baja / Reactivar ──
  const toggleActivo = async (emp) => {
    setSaving(true);
    const nuevoEstado = !emp.activo;
    try {
      await sb.patch(`empleados?id=eq.${emp.id}`, { activo: nuevoEstado });
      try {
        await fetch("/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ legajo: String(emp.legajo), title: nuevoEstado ? "✅ Cuenta reactivada" : "📋 Actualización de estado", body: nuevoEstado ? "Tu cuenta fue reactivada en GI Group." : "Tu cuenta fue desactivada. Contactá a gerencia.", data: { tag: "estado-empleado" } }),
        });
      } catch (e) { console.warn("Push falló:", e); }
      setConfirmBaja(null); await cargarEmpleados(); if (reload) reload();
      showToast(nuevoEstado ? `✅ ${emp.apodo} reactivado` : `${emp.apodo} dado de baja`, nuevoEstado ? C.green : C.amber);
    } catch (e) { showToast(`Error: ${e.message}`, C.red); } finally { setSaving(false); }
  };

  // ── Render ──
  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px", position: "relative" }}>

      {toast && <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 999, padding: "12px 20px", borderRadius: 12, background: C.bg, border: `1px solid ${toast.color}40`, boxShadow: `0 8px 32px ${toast.color}20`, fontSize: 13, fontWeight: 600, color: toast.color, animation: "fadeIn 0.25s ease", maxWidth: "90%" }}>{toast.msg}</div>}

      {modalAlta && <ModalAlta onClose={() => setModalAlta(false)} onSave={altaManual} saving={saving} />}
      {modalEditar && <ModalEditar emp={modalEditar} onClose={() => setModalEditar(null)} onSave={guardarEdicion} saving={saving} />}

      {/* Confirm baja/reactivar */}
      {confirmBaja && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={() => setConfirmBaja(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
          <div style={{ position: "relative", width: "90%", maxWidth: 380, background: C.bg, borderRadius: 20, padding: 24, border: `1px solid ${confirmBaja.activo ? C.red : C.green}30` }}>
            <div style={{ fontSize: 32, textAlign: "center", marginBottom: 12 }}>{confirmBaja.activo ? "⚠️" : "✅"}</div>
            <h3 style={{ margin: "0 0 8px", fontFamily: fH, fontSize: 17, fontWeight: 700, color: C.text, textAlign: "center" }}>
              {confirmBaja.activo ? "Dar de baja" : "Reactivar"} a {confirmBaja.apodo || confirmBaja.nombre}
            </h3>
            <p style={{ fontSize: 13, color: C.dim, textAlign: "center", lineHeight: 1.5, margin: "0 0 20px" }}>
              {confirmBaja.activo ? "Se marcará como inactivo. No se borra ningún dato." : "Volverá a aparecer como empleado activo."}
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmBaja(null)} style={{ flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => toggleActivo(confirmBaja)} disabled={saving} style={{ flex: 1, padding: 12, borderRadius: 12, border: "none", background: saving ? C.surface : (confirmBaja.activo ? C.red : C.green), color: saving ? C.dim : (confirmBaja.activo ? "#fff" : "#000"), fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: saving ? "default" : "pointer" }}>
                {saving ? "..." : confirmBaja.activo ? "Dar de baja" : "Reactivar"}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Filtros */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 4 }}>
        <Chip active={filter === "activos"} onClick={() => setFilter("activos")} color={C.green}>Activos</Chip>
        <Chip active={filter === "inactivos"} onClick={() => setFilter("inactivos")} color={C.red}>Inactivos</Chip>
        <Chip active={filter === "nuevos-csv"} onClick={() => setFilter("nuevos-csv")} color={C.amber}>📥 Nuevos ({nuevosCSV.length})</Chip>
      </div>

      {/* Búsqueda + acciones */}
      {filter !== "nuevos-csv" && (
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Buscar por nombre o legajo..." style={{
          width: "100%", padding: "11px 14px", borderRadius: 12, background: C.surface,
          border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB,
          outline: "none", boxSizing: "border-box", marginBottom: 10,
        }} />
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setModalAlta(true)} style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "none", background: `${C.green}22`, color: C.green, fontSize: 13, fontWeight: 700, fontFamily: fB, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          ➕ Alta manual
        </button>
        {filter === "nuevos-csv" && nuevosCSV.length > 0 && (
          <button onClick={sincronizarCSV} disabled={syncing} style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "none", background: syncing ? C.surface : `${C.amber}22`, color: syncing ? C.dim : C.amber, fontSize: 13, fontWeight: 700, fontFamily: fB, cursor: syncing ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            {syncing ? "⏳ Sincronizando..." : `📥 Alta todos (${nuevosCSV.length})`}
          </button>
        )}
        <button onClick={cargarCSV} disabled={csvLoading} style={{ width: 44, height: 44, borderRadius: 12, border: "none", background: C.surface, color: C.dim, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🔄</button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: C.dim, fontSize: 13 }}>Cargando personal...</div>
      ) : filter === "nuevos-csv" ? (
        nuevosCSV.length === 0 ? (
          <div style={{ background: C.surface, borderRadius: 16, padding: 40, textAlign: "center", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Todo sincronizado</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>No hay empleados nuevos en la planilla</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {nuevosCSV.map(row => (
              <div key={row.colaborador_id} style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.amber}30`, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: C.amberS, color: C.amber, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fH, fontSize: 12, fontWeight: 700 }}>
                  {capitalizarNombre(row.nombre).split(" ").map(w => w[0]).slice(0, 2).join("")}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{capitalizarNombre(row.nombre)}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>ID {row.colaborador_id} · {row.tipo_mo}</div>
                </div>
                <button onClick={() => altaDesdeCSV(row)} disabled={saving} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: saving ? C.surface : C.green, color: saving ? C.dim : "#000", fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: saving ? "default" : "pointer" }}>+ Alta</button>
              </div>
            ))}
          </div>
        )
      ) : (
        filtrados.length === 0 ? (
          <div style={{ background: C.surface, borderRadius: 16, padding: 40, textAlign: "center", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>{search ? "🔍" : "👥"}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{search ? "Sin resultados" : "Sin empleados"}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtrados.map(emp => {
              const divInfo = DIVISIONES.find(d => d.id === emp.division) || DIVISIONES[0];
              const diagH = emp.diagrama?.[dH];
              const fichada = (ctx.fichadasHoy || []).find(f => f.legajo === emp.legajo);
              return (
                <div key={emp.id} style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}`, opacity: emp.activo ? 1 : 0.6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 11,
                      background: fichada ? C.greenS : emp.division ? `${divInfo.color || C.dim}22` : C.surfLo,
                      color: fichada ? C.green : emp.division ? divInfo.color : C.mute,
                      display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fH, fontSize: 13, fontWeight: 700,
                    }}>
                      {(emp.nombre || "").split(" ").map(w => w[0]).slice(0, 2).join("")}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emp.nombre}</div>
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                        L-{emp.legajo} · {emp.area || "—"}{emp.division ? ` · ${divInfo.label}` : ""}{diagH ? ` · ${diagH.in}-${diagH.out}` : ""}
                      </div>
                    </div>
                    {fichada && <Tag color={C.green}>● {fichada.ingreso?.slice(0, 5)}</Tag>}
                    {!fichada && emp.rol === "gerencia" && <Tag color={C.violet}>GER</Tag>}
                  </div>

                  {/* Actions row */}
                  <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                    <button onClick={() => setModalEditar(emp)} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: `${C.cyan}18`, color: C.cyan, fontSize: 11, fontWeight: 700, fontFamily: fB, cursor: "pointer" }}>✏️ Editar</button>
                    <button onClick={() => setConfirmBaja(emp)} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: emp.activo ? `${C.red}18` : `${C.green}18`, color: emp.activo ? C.red : C.green, fontSize: 11, fontWeight: 700, fontFamily: fB, cursor: "pointer" }}>
                      {emp.activo ? "✕ Baja" : "↩ Reactivar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      <div style={{ textAlign: "center", marginTop: 16, fontSize: 10, color: C.mute }}>
        {csvData.length} registros en planilla · {empleados.length} en sistema
      </div>
    </div>
  );
}
