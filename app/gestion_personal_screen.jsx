import { useState, useEffect, useCallback, useRef } from "react";
import { C, fH, fB, fM, DIAS_KEY } from "./lib/theme";
import { sb } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";
import { passwordInicial } from "./lib/passwords";
import { getDivisionesConSinAsignar } from "./lib/constants";

const ROLES = ["operativo", "gerencial", "administrativo"];
const AREAS = ["produccion", "administracion", "logistica", "diseño"];

/* ═══ PARSER CSV GENÉRICO ═══ */
function parseEmpleadosCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const parseRow = (line) => {
    const out = []; let cur = ""; let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/^\uFEFF/, ""));
  const iNombre = headers.findIndex(h => h.includes("nombre"));
  const iLegajo = headers.findIndex(h => h.includes("legajo") || h.includes("dni"));
  const iDiv = headers.findIndex(h => h.includes("division") || h.includes("división"));
  const iRol = headers.findIndex(h => h.includes("rol"));
  const iArea = headers.findIndex(h => h.includes("area") || h.includes("área"));
  const iEmail = headers.findIndex(h => h.includes("email") || h.includes("correo"));
  if (iNombre < 0) return [];
  return lines.slice(1).map(line => {
    const c = parseRow(line);
    return {
      nombre: c[iNombre] || "",
      legajo: iLegajo >= 0 ? c[iLegajo] || "" : "",
      division: iDiv >= 0 ? c[iDiv] || "" : "",
      rol: iRol >= 0 ? c[iRol] || "operativo" : "operativo",
      area: iArea >= 0 ? c[iArea] || "produccion" : "produccion",
      email: iEmail >= 0 ? c[iEmail] || "" : "",
    };
  }).filter(r => r.nombre.length > 2);
}

/* ═══ HELPERS ═══ */
function capitalizarNombre(str) {
  return str.split(" ").filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
function generarApodo(nombre) {
  const p = nombre.split(" ").filter(Boolean);
  return p.length >= 2 ? p[1] : p[0];
}
function legajoProvisorio() {
  return Math.floor(Date.now() / 1000) % 900000 + 100000;
}

/* ═══ MODAL EMPLEADO ═══ */
function ModalEmpleado({ mode, initialData, divisiones, onClose, onSave, saving }) {
  const [form, setForm] = useState(initialData);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const valid = form.nombre?.trim();
  const titulo = mode === "alta" ? "Alta de empleado" : "Editar empleado";
  const btnLabel = mode === "editar" ? "Guardar cambios" : "Dar de alta";
  const btnColor = mode === "editar" ? C.amber : C.green;

  const input = { width: "100%", padding: "11px 14px", borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 460, background: C.bg, borderRadius: "20px 20px 0 0", padding: "20px 18px 30px", maxHeight: "85vh", overflowY: "auto", border: `1px solid ${C.border}` }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.mute, margin: "0 auto 16px" }} />
        <h3 style={{ margin: "0 0 16px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>{titulo}</h3>

        {[["Nombre completo", "nombre"], ["Legajo / DNI", "legajo"], ["Apodo", "apodo"], ["Email", "email"]].map(([label, key]) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <label style={lbl}>{label}</label>
            <input value={form[key] || ""} onChange={e => set(key, e.target.value)} placeholder={key === "legajo" ? "Opcional — se asigna uno provisorio" : ""} style={input} />
          </div>
        ))}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={lbl}>Área</label>
            <select value={form.area || "produccion"} onChange={e => set("area", e.target.value)} style={{ ...input, padding: "11px 10px", fontSize: 13, cursor: "pointer" }}>
              {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>División</label>
            <select value={form.division || ""} onChange={e => set("division", e.target.value)} style={{ ...input, padding: "11px 10px", fontSize: 13, cursor: "pointer" }}>
              {divisiones.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Rol</label>
          <div style={{ display: "flex", gap: 6 }}>
            {ROLES.map(r => (
              <button key={r} onClick={() => set("rol", r)} style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "none", cursor: "pointer", background: form.rol === r ? `${C.amber}22` : C.surface, color: form.rol === r ? C.amber : C.dim, fontSize: 11, fontWeight: 700, fontFamily: fB }}>{r}</button>
            ))}
          </div>
        </div>

        {mode === "alta" && (
          <div style={{ marginBottom: 16, padding: 12, background: `${C.cyan}10`, borderRadius: 10, border: `1px solid ${C.cyan}30` }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={!!form.pre_cargado} onChange={e => set("pre_cargado", e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: C.cyan }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Pre-cargar (pendiente de activación)</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>El empleado activa su cuenta con el link de invitación.</div>
              </div>
            </label>
          </div>
        )}

        <button onClick={() => onSave(form)} disabled={!valid || saving} style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", background: valid && !saving ? btnColor : C.surface, color: valid && !saving ? "#000" : C.mute, fontSize: 15, fontWeight: 700, fontFamily: fH, cursor: valid && !saving ? "pointer" : "default" }}>
          {saving ? "Guardando..." : btnLabel}
        </button>
      </div>
    </div>
  );
}

/* ═══ MODAL CSV PREVIEW ═══ */
function ModalCSVPreview({ filas, empleadosExistentes, divisiones, onClose, onConfirm, saving, progreso }) {
  const legajosExistentes = new Set(empleadosExistentes.map(e => String(e.legajo)));
  const nombresExistentes = new Set(empleadosExistentes.map(e => (e.nombre || "").toUpperCase().trim()));

  const filasConEstado = filas.map(r => {
    const legExiste = r.legajo && legajosExistentes.has(String(r.legajo).trim());
    const nomExiste = nombresExistentes.has(r.nombre.toUpperCase().trim());
    return { ...r, duplicado: legExiste || nomExiste };
  });
  const nuevos = filasConEstado.filter(r => !r.duplicado);
  const duplicados = filasConEstado.filter(r => r.duplicado);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 460, background: C.bg, borderRadius: "20px 20px 0 0", padding: "20px 18px 30px", maxHeight: "85vh", overflowY: "auto", border: `1px solid ${C.border}` }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.mute, margin: "0 auto 16px" }} />
        <h3 style={{ margin: "0 0 4px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>Vista previa CSV</h3>
        <p style={{ fontSize: 12, color: C.dim, marginBottom: 14 }}>
          <Tag color={C.green}>{nuevos.length} nuevos</Tag> <Tag color={C.mute}>{duplicados.length} duplicados (se omiten)</Tag>
        </p>

        <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: 14, border: `1px solid ${C.border}`, borderRadius: 10 }}>
          {filasConEstado.slice(0, 100).map((r, i) => {
            const divInfo = divisiones.find(d => d.id === r.division);
            return (
              <div key={i} style={{ padding: 10, borderBottom: i < Math.min(filasConEstado.length, 100) - 1 ? `1px solid ${C.border}` : "none", fontSize: 12, opacity: r.duplicado ? 0.5 : 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontFamily: fM, fontWeight: 700, color: r.duplicado ? C.mute : C.green, minWidth: 60, fontSize: 11 }}>{r.legajo || "auto"}</span>
                  <span style={{ flex: 1, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{capitalizarNombre(r.nombre)}</span>
                  {divInfo && r.division && <Tag color={divInfo.color || C.cyan}>{divInfo.label}</Tag>}
                  {r.duplicado && <Tag color={C.amber}>dup</Tag>}
                </div>
              </div>
            );
          })}
          {filasConEstado.length > 100 && <div style={{ padding: 10, textAlign: "center", fontSize: 11, color: C.mute }}>+ {filasConEstado.length - 100} más</div>}
        </div>

        {saving && progreso && <div style={{ padding: 10, background: `${C.amber}15`, color: C.amber, borderRadius: 10, fontSize: 12, marginBottom: 10, textAlign: "center" }}>{progreso}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} disabled={saving} style={{ flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 14, fontWeight: 600, cursor: saving ? "default" : "pointer" }}>Cancelar</button>
          <button onClick={() => onConfirm(nuevos)} disabled={saving || nuevos.length === 0} style={{ flex: 2, padding: 12, borderRadius: 12, border: "none", background: saving || nuevos.length === 0 ? C.surface : C.green, color: saving || nuevos.length === 0 ? C.dim : "#000", fontSize: 14, fontWeight: 700, cursor: saving || nuevos.length === 0 ? "default" : "pointer" }}>
            {saving ? "Importando..." : `Importar ${nuevos.length} empleados`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function GestionPersonalScreen({ ctx, reload, empresaId }) {
  const DIVISIONES = getDivisionesConSinAsignar();
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("activos");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [confirmBaja, setConfirmBaja] = useState(null);
  const [csvFilas, setCsvFilas] = useState(null);
  const [showLink, setShowLink] = useState(false);
  const [linkCopiado, setLinkCopiado] = useState(false);
  const [csvProgreso, setCsvProgreso] = useState("");
  const fileRef = useRef(null);

  const dH = DIAS_KEY[new Date().getDay()];

  const cargarEmpleados = useCallback(async () => {
    setLoading(true);
    try { setEmpleados(await sb.get("empleados?select=*&order=nombre.asc") || []); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { cargarEmpleados(); }, [cargarEmpleados]);

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3500); };

  const activos = empleados.filter(e => e.activo).length;
  const inactivos = empleados.filter(e => !e.activo).length;

  const filtrados = (() => {
    let list = filter === "activos" ? empleados.filter(e => e.activo) : empleados.filter(e => !e.activo);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => e.nombre?.toLowerCase().includes(q) || String(e.legajo).includes(q) || e.apodo?.toLowerCase().includes(q));
    }
    return list;
  })();

  // ─── Alta / edición manual ───
  const guardarModal = async (form) => {
    setSaving(true);
    try {
      const legajo = form.legajo?.toString().trim() && /^\d+$/.test(form.legajo.toString().trim())
        ? parseInt(form.legajo.toString().trim())
        : legajoProvisorio();
      if (modal.mode === "editar") {
        await sb.patch(`empleados?id=eq.${modal.data.id}`, {
          nombre: form.nombre, apodo: form.apodo, email: form.email,
          area: form.area, division: form.division || null, rol: form.rol, legajo,
        });
        showToast(`✅ ${form.apodo || form.nombre} actualizado`, C.green);
      } else {
        await sb.post("empleados", {
          legajo, nombre: form.nombre,
          apodo: form.apodo || generarApodo(form.nombre),
          email: form.email || "",
          area: form.area || "produccion",
          division: form.division || null,
          rol: form.rol || "operativo",
          activo: true,
          password: passwordInicial(),
          debe_cambiar_password: true,
          estado_activacion: form.pre_cargado ? "pendiente_activacion" : "activo",
        });
        showToast(form.pre_cargado ? `✅ ${form.nombre} pre-cargado (activa con el link)` : `✅ ${form.nombre} dado de alta`, C.green);
      }
      setModal(null);
      await cargarEmpleados();
      if (reload) reload();
    } catch (e) { showToast(`Error: ${e.message}`, C.red); }
    setSaving(false);
  };

  // ─── Importación CSV propia ───
  const onCsvFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const filas = parseEmpleadosCSV(reader.result);
      if (filas.length === 0) {
        showToast("CSV sin datos válidos. Columnas esperadas: nombre, legajo, division, rol", C.red);
        return;
      }
      setCsvFilas(filas);
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  const importarCSV = async (filasNuevas) => {
    if (!filasNuevas || filasNuevas.length === 0) return;
    setSaving(true);
    let ok = 0, err = 0;
    for (let i = 0; i < filasNuevas.length; i++) {
      setCsvProgreso(`Importando ${i + 1} de ${filasNuevas.length}...`);
      const r = filasNuevas[i];
      const nombre = capitalizarNombre(r.nombre);
      const legajo = r.legajo && /^\d+$/.test(String(r.legajo).trim())
        ? parseInt(String(r.legajo).trim())
        : legajoProvisorio();
      try {
        await sb.post("empleados", {
          legajo, nombre,
          apodo: generarApodo(nombre),
          email: r.email || "",
          area: r.area || "produccion",
          division: r.division || null,
          rol: r.rol || "operativo",
          activo: true,
          password: passwordInicial(),
          debe_cambiar_password: true,
          estado_activacion: "activo",
        });
        ok++;
      } catch (e) {
        console.error(`Alta ${nombre}:`, e);
        err++;
      }
    }
    setCsvProgreso("");
    setCsvFilas(null);
    setSaving(false);
    await cargarEmpleados();
    if (reload) reload();
    showToast(`✅ ${ok} importados${err > 0 ? ` · ${err} con error` : ""}`, ok > 0 ? C.green : C.red);
  };

  // ─── Baja / reactivar ───
  const toggleActivo = async (emp) => {
    setSaving(true);
    const nuevoEstado = !emp.activo;
    try {
      await sb.patch(`empleados?id=eq.${emp.id}`, { activo: nuevoEstado });
      try {
        await fetch("/api/send-push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legajo: String(emp.legajo),
            title: nuevoEstado ? "✅ Cuenta reactivada" : "📋 Estado actualizado",
            body: nuevoEstado ? "Tu cuenta fue reactivada." : "Tu cuenta fue desactivada.",
            data: { tag: "estado-empleado" },
          }),
        });
      } catch { }
      setConfirmBaja(null);
      await cargarEmpleados();
      if (reload) reload();
      showToast(nuevoEstado ? `✅ ${emp.apodo || emp.nombre} reactivado` : `${emp.apodo || emp.nombre} dado de baja`, nuevoEstado ? C.green : C.amber);
    } catch (e) { showToast(`Error: ${e.message}`, C.red); }
    setSaving(false);
  };

  const abrirAlta = () => setModal({ mode: "alta", data: { nombre: "", apodo: "", legajo: "", email: "", area: "produccion", division: "", rol: "operativo", pre_cargado: false } });
  const abrirEditar = (emp) => setModal({ mode: "editar", data: { ...emp, legajo: String(emp.legajo || ""), division: emp.division || "" } });

  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px", position: "relative" }}>
      {toast && <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 999, padding: "12px 20px", borderRadius: 12, background: C.bg, border: `1px solid ${toast.color}40`, boxShadow: `0 8px 32px ${toast.color}20`, fontSize: 13, fontWeight: 600, color: toast.color, maxWidth: "90%" }}>{toast.msg}</div>}

      {modal && <ModalEmpleado mode={modal.mode} initialData={modal.data} divisiones={DIVISIONES} onClose={() => setModal(null)} onSave={guardarModal} saving={saving} />}
      {csvFilas && <ModalCSVPreview filas={csvFilas} empleadosExistentes={empleados} divisiones={DIVISIONES} onClose={() => setCsvFilas(null)} onConfirm={importarCSV} saving={saving} progreso={csvProgreso} />}

      {confirmBaja && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={() => setConfirmBaja(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
          <div style={{ position: "relative", width: "90%", maxWidth: 380, background: C.bg, borderRadius: 20, padding: 24, border: `1px solid ${confirmBaja.activo ? C.red : C.green}30` }}>
            <div style={{ fontSize: 32, textAlign: "center", marginBottom: 12 }}>{confirmBaja.activo ? "⚠️" : "✅"}</div>
            <h3 style={{ margin: "0 0 8px", fontFamily: fH, fontSize: 17, fontWeight: 700, color: C.text, textAlign: "center" }}>{confirmBaja.activo ? "Dar de baja" : "Reactivar"} a {confirmBaja.apodo || confirmBaja.nombre}</h3>
            <p style={{ fontSize: 13, color: C.dim, textAlign: "center", lineHeight: 1.5, margin: "0 0 20px" }}>{confirmBaja.activo ? "Se marcará como inactivo. No se borra ningún dato." : "Volverá a aparecer como empleado activo."}</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmBaja(null)} style={{ flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 14, fontWeight: 600, fontFamily: fB, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => toggleActivo(confirmBaja)} disabled={saving} style={{ flex: 1, padding: 12, borderRadius: 12, border: "none", background: saving ? C.surface : (confirmBaja.activo ? C.red : C.green), color: saving ? C.dim : (confirmBaja.activo ? "#fff" : "#000"), fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: saving ? "default" : "pointer" }}>{saving ? "..." : confirmBaja.activo ? "Dar de baja" : "Reactivar"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Métricas */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, textAlign: "center" }}>
          <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.green }}>{activos}</div>
          <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Activos</div>
        </div>
        <div style={{ background: C.surface, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, textAlign: "center" }}>
          <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.mute }}>{inactivos}</div>
          <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Inactivos</div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 4 }}>
        <Chip active={filter === "activos"} onClick={() => setFilter("activos")} color={C.green}>Activos</Chip>
        <Chip active={filter === "inactivos"} onClick={() => setFilter("inactivos")} color={C.red}>Inactivos</Chip>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Buscar por nombre o legajo..." style={{ width: "100%", padding: "11px 14px", borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box", marginBottom: 10 }} />

      {/* Acciones */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <button onClick={abrirAlta} style={{ flex: "1 1 30%", padding: "10px 0", borderRadius: 12, border: "none", background: `${C.green}22`, color: C.green, fontSize: 13, fontWeight: 700, fontFamily: fB, cursor: "pointer" }}>➕ Alta</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onCsvFile} />
        <button onClick={() => fileRef.current?.click()} style={{ flex: "1 1 30%", padding: "10px 0", borderRadius: 12, border: "none", background: `${C.cyan}22`, color: C.cyan, fontSize: 13, fontWeight: 700, fontFamily: fB, cursor: "pointer" }}>📤 CSV</button>
        <button onClick={() => { setShowLink(true); setLinkCopiado(false); }} style={{ flex: "1 1 30%", padding: "10px 0", borderRadius: 12, border: "none", background: `${C.violet}22`, color: C.violet, fontSize: 13, fontWeight: 700, fontFamily: fB, cursor: "pointer" }}>🔗 Invitar</button>
        <button onClick={cargarEmpleados} style={{ width: 44, height: 44, borderRadius: 12, border: "none", background: C.surface, color: C.dim, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🔄</button>
      </div>

      {/* Modal Link de invitación */}
      {showLink && (() => {
        const slugMatch = typeof window !== "undefined" ? window.location.pathname.match(/^\/([^\/]+)/) : null;
        const slug = slugMatch ? slugMatch[1] : "";
        const link = typeof window !== "undefined" ? `${window.location.origin}/${slug}/unirse` : "";
        const copiar = async () => {
          try { await navigator.clipboard.writeText(link); setLinkCopiado(true); setTimeout(() => setLinkCopiado(false), 2000); }
          catch { showToast("No se pudo copiar. Copialo manualmente.", C.red); }
        };
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
            <div onClick={() => setShowLink(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
            <div style={{ position: "relative", width: "100%", maxWidth: 420, background: C.bg, borderRadius: 20, padding: 24, border: `1px solid ${C.violet}30` }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: `${C.violet}22`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: 28 }}>🔗</div>
              <h3 style={{ margin: 0, fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text, textAlign: "center" }}>Link de invitación</h3>
              <p style={{ fontSize: 12, color: C.dim, textAlign: "center", lineHeight: 1.5, margin: "8px 0 16px" }}>
                Compartí este link con tus empleados. Los que estén <b style={{ color: C.amber }}>pre-cargados</b> podrán activar su cuenta ingresando solo su legajo.
              </p>
              <div style={{ background: C.surface, borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 12, color: C.text, fontFamily: fM, wordBreak: "break-all", border: `1px solid ${C.border}` }}>{link}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setShowLink(false)} style={{ flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: "transparent", color: C.dim, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cerrar</button>
                <button onClick={copiar} style={{ flex: 2, padding: 12, borderRadius: 12, border: "none", background: linkCopiado ? C.green : C.violet, color: linkCopiado ? "#000" : "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                  {linkCopiado ? "✓ Copiado" : "📋 Copiar link"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ fontSize: 10, color: C.mute, marginBottom: 14, lineHeight: 1.5 }}>
        💡 <b>CSV:</b> primera fila con encabezados. Columnas reconocidas: <code>nombre</code>, <code>legajo</code> (opcional), <code>division</code>, <code>rol</code>, <code>area</code>, <code>email</code>.
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: C.dim, fontSize: 13 }}>Cargando personal...</div>
      ) : filtrados.length === 0 ? (
        <div style={{ background: C.surface, borderRadius: 16, padding: 40, textAlign: "center", border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>{search ? "🔍" : "👥"}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{search ? "Sin resultados" : "Sin empleados"}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtrados.map(emp => {
            const divInfo = DIVISIONES.find(d => d.id === emp.division) || DIVISIONES[0];
            const diagH = emp.diagrama?.[dH];
            const fichada = (ctx?.fichadasHoy || []).find(f => f.legajo === emp.legajo);
            return (
              <div key={emp.id} style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}`, opacity: emp.activo ? 1 : 0.6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 11, background: fichada ? C.greenS : emp.division ? `${divInfo.color || C.dim}22` : C.surfLo, color: fichada ? C.green : emp.division ? divInfo.color : C.mute, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fH, fontSize: 13, fontWeight: 700 }}>
                    {(emp.nombre || "").split(" ").map(w => w[0]).slice(0, 2).join("")}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emp.nombre}</div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                      L-{emp.legajo} · {emp.area || "—"}{emp.division ? ` · ${divInfo.label}` : ""}{diagH ? ` · ${diagH.in}-${diagH.out}` : ""}
                    </div>
                  </div>
                  {fichada && <Tag color={C.green}>● {fichada.ingreso?.slice(0, 5)}</Tag>}
                  {emp.estado_activacion === "pendiente_activacion" && <Tag color={C.amber}>pendiente</Tag>}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                  <button onClick={() => abrirEditar(emp)} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: `${C.cyan}18`, color: C.cyan, fontSize: 11, fontWeight: 700, fontFamily: fB, cursor: "pointer" }}>✏️ Editar</button>
                  <button onClick={() => setConfirmBaja(emp)} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: emp.activo ? `${C.red}18` : `${C.green}18`, color: emp.activo ? C.red : C.green, fontSize: 11, fontWeight: 700, fontFamily: fB, cursor: "pointer" }}>
                    {emp.activo ? "✕ Baja" : "↩ Reactivar"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: 16, fontSize: 10, color: C.mute }}>
        {empleados.length} empleados en sistema
      </div>
    </div>
  );
}