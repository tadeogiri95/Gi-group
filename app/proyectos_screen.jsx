'use client';
import { useState, useEffect, useCallback, useRef } from "react";
import { sb } from "./lib/supabase";
import { fH, fB, fM } from "./lib/theme";

const V = {
  amber: "var(--color-empresa-primary, #F97316)",
  green: "#16A34A",
  red: "#DC2626",
  cyan: "#0891B2",
  dim: "var(--color-text-dim)",
  mute: "var(--color-text-muted)",
  text: "var(--color-text)",
  surface: "var(--color-surface)",
  surfHi: "var(--color-surf-hi)",
  border: "var(--color-border)",
  bg: "var(--color-bg)",
};
import { Tag, Chip } from "./components/ui";
import { getDivisionesConSinAsignar } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { useToast } from "./components/ui/Toast";
import { useConfirm } from "./components/ui/ConfirmDialog";

/* ═══ PARSER CSV ═══ */
function parseProyectosCSV(text) {
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
  const idx = (n) => headers.findIndex(h => h.includes(n));
  const iOt = idx("ot"), iCli = idx("cliente"), iObra = idx("obra"), iProy = idx("proyecto"), iDiv = idx("division") >= 0 ? idx("division") : idx("división");
  if (iOt < 0) return [];
  return lines.slice(1).map(line => {
    const c = parseRow(line);
    return {
      ot: c[iOt] || "",
      cliente: iCli >= 0 ? c[iCli] || "" : "",
      obra: iObra >= 0 ? c[iObra] || "" : "",
      proyecto: iProy >= 0 ? c[iProy] || "" : "",
      division: iDiv >= 0 ? c[iDiv] || "" : "",
    };
  }).filter(r => r.ot);
}

/* ═══ MODAL ═══ */
function ModalProyecto({ initial, divisiones, onClose, onSave, saving }) {
  const [f, setF] = useState(initial || { ot: "", cliente: "", obra: "", proyecto: "", division: "" });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const valid = f.ot?.trim();
  const editando = !!initial?.id;

  const input = { width: "100%", padding: "11px 14px", borderRadius: 10, background: V.surface, border: `1px solid ${V.border}`, color: V.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 11, fontWeight: 700, color: V.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 460, background: V.bg, borderRadius: "20px 20px 0 0", padding: "20px 18px 30px", maxHeight: "85vh", overflowY: "auto", border: `1px solid ${V.border}` }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: V.mute, margin: "0 auto 16px" }} />
        <h3 style={{ margin: "0 0 16px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: V.text }}>{editando ? "Editar proyecto" : "Nuevo proyecto"}</h3>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>OT / Código *</label>
          <input value={f.ot} onChange={e => set("ot", e.target.value)} style={input} placeholder="Ej: 7450" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Cliente</label>
          <input value={f.cliente} onChange={e => set("cliente", e.target.value)} style={input} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Obra</label>
          <input value={f.obra} onChange={e => set("obra", e.target.value)} style={input} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Proyecto / Descripción</label>
          <input value={f.proyecto} onChange={e => set("proyecto", e.target.value)} style={input} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>División</label>
          <select value={f.division || ""} onChange={e => set("division", e.target.value)} style={{ ...input, cursor: "pointer" }}>
            {divisiones.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>

        <button onClick={() => onSave(f)} disabled={!valid || saving} style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", background: valid && !saving ? V.green : V.surface, color: valid && !saving ? "#000" : V.mute, fontSize: 15, fontWeight: 700, fontFamily: fH, cursor: valid && !saving ? "pointer" : "default" }}>
          {saving ? "Guardando..." : editando ? "Guardar cambios" : "Crear proyecto"}
        </button>
      </div>
    </div>
  );
}

/* ═══ MODAL CSV PREVIEW ═══ */
function ModalCSVPreview({ filas, onClose, onConfirm, saving, progreso }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 460, background: V.bg, borderRadius: "20px 20px 0 0", padding: "20px 18px 30px", maxHeight: "85vh", overflowY: "auto", border: `1px solid ${V.border}` }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: V.mute, margin: "0 auto 16px" }} />
        <h3 style={{ margin: "0 0 6px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: V.text }}>Vista previa CSV</h3>
        <p style={{ fontSize: 12, color: V.dim, marginBottom: 14 }}>{filas.length} proyectos detectados. Revisá y confirmá.</p>

        <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: 14, border: `1px solid ${V.border}`, borderRadius: 10 }}>
          {filas.slice(0, 50).map((r, i) => (
            <div key={i} style={{ padding: 10, borderBottom: i < Math.min(filas.length, 50) - 1 ? `1px solid ${V.border}` : "none", fontSize: 12 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: fM, fontWeight: 700, color: V.amber, minWidth: 60 }}>{r.ot}</span>
                <span style={{ flex: 1, color: V.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.cliente || r.proyecto || "—"}</span>
                {r.division && <Tag color={V.cyan}>{r.division}</Tag>}
              </div>
              {r.obra && <div style={{ fontSize: 11, color: V.dim, marginTop: 2 }}>{r.obra}</div>}
            </div>
          ))}
          {filas.length > 50 && <div style={{ padding: 10, textAlign: "center", fontSize: 11, color: V.mute }}>+ {filas.length - 50} más</div>}
        </div>

        {saving && progreso && <div style={{ padding: 10, background: `${V.amber}15`, color: V.amber, borderRadius: 10, fontSize: 12, marginBottom: 10, textAlign: "center" }}>{progreso}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} disabled={saving} style={{ flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${V.border}`, background: "transparent", color: V.dim, fontSize: 14, fontWeight: 600, cursor: saving ? "default" : "pointer" }}>Cancelar</button>
          <button onClick={onConfirm} disabled={saving} style={{ flex: 2, padding: 12, borderRadius: 12, border: "none", background: saving ? V.surface : V.green, color: saving ? V.dim : "#000", fontSize: 14, fontWeight: 700, cursor: saving ? "default" : "pointer" }}>
            {saving ? "Importando..." : `Importar ${filas.length} proyectos`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function ProyectosScreen({ empresaId }) {
  const { divisiones: divisionesCtx } = useAuth();
  const divisiones = getDivisionesConSinAsignar(divisionesCtx);
  const [proyectos, setProyectos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filtro, setFiltro] = useState("activo");
  const [search, setSearch] = useState("");
  const [filtroDiv, setFiltroDiv] = useState("");
  const [modal, setModal] = useState(null);
  const [csvFilas, setCsvFilas] = useState(null);
  const [csvProgreso, setCsvProgreso] = useState("");
  const toast = useToast();
  const [confirmFn, ConfirmDialog] = useConfirm();
  const fileRef = useRef(null);
  const [syncCfg, setSyncCfg] = useState({ url: "", ultima_sync: null });
  const [syncLoading, setSyncLoading] = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(false);

  const showToast = (msg, color) => toast.show(msg, color);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    setLoading(true);
    try {
      const data = await sb.get(`proyectos?empresa_id=eq.${empresaId}&order=created_at.desc&limit=500`);
      setProyectos(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [empresaId]);

  const cargarSyncCfg = useCallback(async () => {
    if (!empresaId) return;
    try {
      const rows = await sb.get("config_sistema?clave=eq.proyectos_csv_url&select=valor&limit=1");
      const v = rows?.[0]?.valor;
      if (v) setSyncCfg({ url: v.url || "", ultima_sync: v.ultima_sync || null });
    } catch {}
  }, [empresaId]);

  useEffect(() => { cargar(); cargarSyncCfg(); }, [cargar, cargarSyncCfg]);

  const guardar = async (form) => {
    setSaving(true);
    try {
      if (modal?.id) {
        await sb.patch(`proyectos?id=eq.${modal.id}`, {
          ot: form.ot.trim(),
          cliente: form.cliente || null,
          obra: form.obra || null,
          proyecto: form.proyecto || null,
          division: form.division || null,
        });
        showToast("✅ Proyecto actualizado", V.green);
      } else {
        await sb.post("proyectos", {
          ot: form.ot.trim(),
          cliente: form.cliente || null,
          obra: form.obra || null,
          proyecto: form.proyecto || null,
          division: form.division || null,
          estado: "activo",
        });
        showToast("✅ Proyecto creado", V.green);
      }
      setModal(null);
      await cargar();
    } catch (e) {
      showToast(`Error: ${e.message?.includes("uq_proyectos") ? "OT ya existe" : e.message}`, V.red);
    }
    setSaving(false);
  };

  const cerrarProyecto = async (id) => {
    if (!await confirmFn("¿Cerrar este proyecto?", { title: "Cerrar proyecto", confirmLabel: "Cerrar" })) return;
    try {
      await sb.patch(`proyectos?id=eq.${id}`, { estado: "cerrado" });
      await cargar();
      showToast("Proyecto cerrado", V.amber);
    } catch (e) { showToast(`Error: ${e.message}`, V.red); }
  };

  const reabrir = async (id) => {
    try {
      await sb.patch(`proyectos?id=eq.${id}`, { estado: "activo" });
      await cargar();
      showToast("Proyecto reactivado", V.green);
    } catch (e) { showToast(`Error: ${e.message}`, V.red); }
  };

  const onCsv = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const filas = parseProyectosCSV(reader.result);
      if (filas.length === 0) { showToast("CSV sin datos válidos. Verificá columnas: ot, cliente, obra, proyecto, division", V.red); return; }
      setCsvFilas(filas);
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  const guardarSyncUrl = async () => {
    if (!syncCfg.url.trim()) return;
    setSyncLoading(true);
    try {
      const rows = await sb.get("config_sistema?clave=eq.proyectos_csv_url&select=id&limit=1");
      if (rows?.length) {
        await sb.patch("config_sistema?clave=eq.proyectos_csv_url", { valor: { url: syncCfg.url.trim() } });
      } else {
        await sb.post("config_sistema", { clave: "proyectos_csv_url", valor: { url: syncCfg.url.trim() } });
      }
      showToast("✅ URL guardada", V.green);
    } catch (e) { showToast(`Error: ${e.message}`, V.red); }
    setSyncLoading(false);
  };

  const sincronizar = async () => {
    if (!syncCfg.url.trim()) { showToast("Guardá la URL primero", V.amber); return; }
    setSyncLoading(true);
    try {
      const res = await fetch("/api/proyectos/sync-csv", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error sync");
      showToast(`✅ ${data.procesados} proyectos sincronizados`, V.green);
      await cargar(); await cargarSyncCfg();
    } catch (e) { showToast(`Error: ${e.message}`, V.red); }
    setSyncLoading(false);
  };

  const importarCSV = async () => {
    if (!csvFilas) return;
    setSaving(true);
    let ok = 0, dup = 0, err = 0;
    for (let i = 0; i < csvFilas.length; i++) {
      setCsvProgreso(`Importando ${i + 1} de ${csvFilas.length}...`);
      const r = csvFilas[i];
      try {
        await sb.post("proyectos", {
          ot: r.ot, cliente: r.cliente || null, obra: r.obra || null,
          proyecto: r.proyecto || null, division: r.division || null, estado: "activo",
        });
        ok++;
      } catch (e) {
        if (e.message?.includes("uq_proyectos") || e.message?.includes("duplicate")) dup++;
        else err++;
      }
    }
    setCsvProgreso("");
    setCsvFilas(null);
    setSaving(false);
    await cargar();
    showToast(`✅ ${ok} importados · ${dup} duplicados · ${err} con error`, ok > 0 ? V.green : V.amber);
  };

  const filtrados = proyectos.filter(p => {
    if (filtro !== "todos" && p.estado !== filtro) return false;
    if (filtroDiv && p.division !== filtroDiv) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return p.ot?.toLowerCase().includes(q) || p.cliente?.toLowerCase().includes(q) || p.obra?.toLowerCase().includes(q) || p.proyecto?.toLowerCase().includes(q);
    }
    return true;
  });

  const activos = proyectos.filter(p => p.estado === "activo").length;
  const cerrados = proyectos.filter(p => p.estado === "cerrado").length;

  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px", position: "relative" }}>


      {modal && <ModalProyecto initial={modal} divisiones={divisiones} onClose={() => setModal(null)} onSave={guardar} saving={saving} />}
      {csvFilas && <ModalCSVPreview filas={csvFilas} onClose={() => setCsvFilas(null)} onConfirm={importarCSV} saving={saving} progreso={csvProgreso} />}

      {/* Métricas */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        <div style={{ background: V.surface, borderRadius: 12, padding: 12, border: `1px solid ${V.border}`, textAlign: "center" }}>
          <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: V.green }}>{activos}</div>
          <div style={{ fontSize: 9, color: V.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Activos</div>
        </div>
        <div style={{ background: V.surface, borderRadius: 12, padding: 12, border: `1px solid ${V.border}`, textAlign: "center" }}>
          <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: V.mute }}>{cerrados}</div>
          <div style={{ fontSize: 9, color: V.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Cerrados</div>
        </div>
        <div style={{ background: V.surface, borderRadius: 12, padding: 12, border: `1px solid ${V.border}`, textAlign: "center" }}>
          <div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: V.amber }}>{proyectos.length}</div>
          <div style={{ fontSize: 9, color: V.dim, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Total</div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 4 }}>
        <Chip active={filtro === "activo"} onClick={() => setFiltro("activo")} color={V.green}>Activos</Chip>
        <Chip active={filtro === "cerrado"} onClick={() => setFiltro("cerrado")} color={V.mute}>Cerrados</Chip>
        <Chip active={filtro === "todos"} onClick={() => setFiltro("todos")}>Todos</Chip>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 4 }}>
        {divisiones.map(d => <Chip key={d.id} active={filtroDiv === d.id} onClick={() => setFiltroDiv(d.id)} color={d.color || V.amber}>{d.label}</Chip>)}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Buscar por OT, cliente, obra..." style={{ width: "100%", padding: "11px 14px", borderRadius: 12, background: V.surface, border: `1px solid ${V.border}`, color: V.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box", marginBottom: 12 }} />

      {/* Acciones */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button onClick={() => setModal({})} style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "none", background: `${V.green}22`, color: V.green, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Nuevo</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onCsv} />
        <button onClick={() => fileRef.current?.click()} style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "none", background: `${V.cyan}22`, color: V.cyan, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📤 CSV</button>
        <button onClick={cargar} style={{ width: 40, height: 40, borderRadius: 12, border: "none", background: V.surface, color: V.dim, cursor: "pointer", fontSize: 15, flexShrink: 0 }}>🔄</button>
      </div>

      {/* Panel de URL de sincronización */}
      <div style={{ marginBottom: 14 }}>
        <button
          onClick={() => setShowSyncPanel(p => !p)}
          style={{ width: "100%", padding: "8px 12px", borderRadius: 10, border: `1px solid ${V.border}`, background: "transparent", color: V.dim, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <span>🔗 Sincronización automática {syncCfg.url ? "· configurada" : ""}</span>
          <span style={{ fontSize: 10 }}>{showSyncPanel ? "▲" : "▼"}</span>
        </button>
        {showSyncPanel && (
          <div style={{ marginTop: 6, padding: 12, background: V.surface, borderRadius: 10, border: `1px solid ${V.border}` }}>
            <div style={{ fontSize: 11, color: V.dim, marginBottom: 8, lineHeight: 1.5 }}>
              URL pública de CSV (Google Sheets, servidor, etc.). Se hace upsert por OT: proyectos nuevos se crean, los existentes se actualizan.
            </div>
            {syncCfg.ultima_sync && (
              <div style={{ fontSize: 10, color: V.green, marginBottom: 8 }}>
                Última sync: {new Date(syncCfg.ultima_sync).toLocaleString("es-AR")}
              </div>
            )}
            <input
              value={syncCfg.url}
              onChange={e => setSyncCfg(p => ({ ...p, url: e.target.value }))}
              placeholder="https://docs.google.com/spreadsheets/d/…/export?format=csv"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${V.border}`, background: V.bg, color: V.text, fontSize: 12, fontFamily: fB, outline: "none", boxSizing: "border-box", marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={guardarSyncUrl}
                disabled={syncLoading || !syncCfg.url.trim()}
                style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: syncCfg.url.trim() ? `${V.amber}22` : V.surface, color: syncCfg.url.trim() ? V.amber : V.mute, fontSize: 12, fontWeight: 700, cursor: syncCfg.url.trim() ? "pointer" : "default" }}
              >
                Guardar URL
              </button>
              <button
                onClick={sincronizar}
                disabled={syncLoading || !syncCfg.url.trim()}
                style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: syncCfg.url.trim() && !syncLoading ? `${V.green}22` : V.surface, color: syncCfg.url.trim() && !syncLoading ? V.green : V.mute, fontSize: 12, fontWeight: 700, cursor: syncCfg.url.trim() ? "pointer" : "default" }}
              >
                {syncLoading ? "Sincronizando…" : "🔄 Sincronizar ahora"}
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="gypi-dots"><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /></div>
      ) : filtrados.length === 0 ? (
        <div style={{ background: V.surface, borderRadius: 16, padding: "32px 24px", textAlign: "center", border: `1px solid ${V.border}` }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: V.text, marginBottom: 4 }}>
            {search || filtroDiv ? "Sin resultados" : "Sin proyectos"}
          </div>
          <div style={{ fontSize: 12, color: V.dim }}>
            {search || filtroDiv ? "Probá con otro filtro o búsqueda." : "Creá el primero con el botón o importá un CSV."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtrados.map(p => {
            const divInfo = divisiones.find(d => d.id === p.division) || divisiones[0];
            return (
              <div key={p.id} style={{ background: V.surface, borderRadius: 14, padding: 14, border: `1px solid ${V.border}`, opacity: p.estado === "cerrado" ? 0.6 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 60, height: 40, borderRadius: 10, background: `${divInfo.color || V.amber}22`, color: divInfo.color || V.amber, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fM, fontSize: 13, fontWeight: 700, padding: "0 8px" }}>{p.ot}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: V.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.cliente || p.proyecto || "—"}</div>
                    <div style={{ fontSize: 11, color: V.dim, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.obra || p.proyecto || ""}{p.division ? ` · ${divInfo.label}` : ""}</div>
                  </div>
                  {p.estado === "cerrado" && <Tag color={V.mute}>cerrado</Tag>}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${V.border}` }}>
                  <button onClick={() => setModal(p)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: `${V.cyan}18`, color: V.cyan, fontSize: 11, fontWeight: 700, cursor: "pointer", minHeight: 44 }}>✏️ Editar</button>
                  {p.estado === "activo" ? (
                    <button onClick={() => cerrarProyecto(p.id)} style={{ padding: "10px 14px", borderRadius: 8, border: "none", background: `${V.amber}18`, color: V.amber, fontSize: 11, fontWeight: 700, cursor: "pointer", minHeight: 44 }}>Cerrar</button>
                  ) : (
                    <button onClick={() => reabrir(p.id)} style={{ padding: "10px 14px", borderRadius: 8, border: "none", background: `${V.green}18`, color: V.green, fontSize: 11, fontWeight: 700, cursor: "pointer", minHeight: 44 }}>Reactivar</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
}