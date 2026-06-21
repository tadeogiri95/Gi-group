'use client';
import { useState, useEffect, useCallback, useRef } from "react";
import { sb, apiFetch } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";
import { getDivisionesConSinAsignar } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { useToast } from "./components/ui/Toast";
import { useConfirm } from "./components/ui/ConfirmDialog";

const GREEN = "#16A34A";
const RED = "#DC2626";
const CYAN = "#0891B2";
const AMBER = "var(--color-empresa-primary, #F97316)";

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
  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/^﻿/, ""));
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

  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[85vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" />
        <h3 className="m-0 mb-4 font-heading text-lg font-bold text-gypi-text">{editando ? "Editar proyecto" : "Nuevo proyecto"}</h3>

        <div className="mb-3">
          <label className="g-label">OT / Código *</label>
          <input value={f.ot} onChange={e => set("ot", e.target.value)} className="g-input" placeholder="Ej: 7450" />
        </div>
        <div className="mb-3">
          <label className="g-label">Cliente</label>
          <input value={f.cliente} onChange={e => set("cliente", e.target.value)} className="g-input" />
        </div>
        <div className="mb-3">
          <label className="g-label">Obra</label>
          <input value={f.obra} onChange={e => set("obra", e.target.value)} className="g-input" />
        </div>
        <div className="mb-3">
          <label className="g-label">Proyecto / Descripción</label>
          <input value={f.proyecto} onChange={e => set("proyecto", e.target.value)} className="g-input" />
        </div>
        <div className="mb-5">
          <label className="g-label">División</label>
          <select value={f.division || ""} onChange={e => set("division", e.target.value)} className="g-input cursor-pointer">
            {divisiones.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>

        <button
          onClick={() => onSave(f)}
          disabled={!valid || saving}
          className={`w-full py-3.5 rounded-xl border-none text-[15px] font-bold font-heading cursor-pointer ${valid && !saving ? "bg-gypi-green text-black" : "bg-gypi-surface text-gypi-mute cursor-default"}`}
        >
          {saving ? "Guardando..." : editando ? "Guardar cambios" : "Crear proyecto"}
        </button>
      </div>
    </div>
  );
}

/* ═══ MODAL CSV PREVIEW ═══ */
function ModalCSVPreview({ filas, onClose, onConfirm, saving, progreso }) {
  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[85vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" />
        <h3 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">Vista previa CSV</h3>
        <p className="text-xs text-gypi-dim mb-3.5">{filas.length} proyectos detectados. Revisá y confirmá.</p>

        <div className="max-h-80 overflow-y-auto mb-3.5 border border-gypi-border rounded-[10px]">
          {filas.slice(0, 50).map((r, i) => (
            <div key={i} className={`p-2.5 text-xs ${i < Math.min(filas.length, 50) - 1 ? "border-b border-gypi-border" : ""}`}>
              <div className="flex gap-2 items-center">
                <span className="font-mono font-bold text-gypi-amber min-w-[60px]">{r.ot}</span>
                <span className="flex-1 text-gypi-text overflow-hidden text-ellipsis whitespace-nowrap">{r.cliente || r.proyecto || "—"}</span>
                {r.division && <Tag color={CYAN}>{r.division}</Tag>}
              </div>
              {r.obra && <div className="text-[11px] text-gypi-dim mt-0.5">{r.obra}</div>}
            </div>
          ))}
          {filas.length > 50 && <div className="p-2.5 text-center text-[11px] text-gypi-mute">+ {filas.length - 50} más</div>}
        </div>

        {saving && progreso && <div className="p-2.5 bg-gypi-amber/10 text-gypi-amber rounded-[10px] text-xs mb-2.5 text-center">{progreso}</div>}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={saving} className="g-btn g-btn-secondary flex-1">Cancelar</button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className={`flex-2 py-3 rounded-xl border-none text-sm font-bold cursor-pointer ${saving ? "bg-gypi-surface text-gypi-dim cursor-default" : "bg-gypi-green text-black"}`}
          >
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
  const [csvRawText, setCsvRawText] = useState(null);
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
        showToast("✅ Proyecto actualizado", GREEN);
      } else {
        await sb.post("proyectos", {
          ot: form.ot.trim(),
          cliente: form.cliente || null,
          obra: form.obra || null,
          proyecto: form.proyecto || null,
          division: form.division || null,
          estado: "activo",
        });
        showToast("✅ Proyecto creado", GREEN);
      }
      setModal(null);
      await cargar();
    } catch (e) {
      showToast(`Error: ${e.message?.includes("uq_proyectos") ? "OT ya existe" : e.message}`, RED);
    }
    setSaving(false);
  };

  const cerrarProyecto = async (id) => {
    if (!await confirmFn("¿Cerrar este proyecto?", { title: "Cerrar proyecto", confirmLabel: "Cerrar" })) return;
    try {
      await sb.patch(`proyectos?id=eq.${id}`, { estado: "cerrado" });
      await cargar();
      showToast("Proyecto cerrado", AMBER);
    } catch (e) { showToast(`Error: ${e.message}`, RED); }
  };

  const reabrir = async (id) => {
    try {
      await sb.patch(`proyectos?id=eq.${id}`, { estado: "activo" });
      await cargar();
      showToast("Proyecto reactivado", GREEN);
    } catch (e) { showToast(`Error: ${e.message}`, RED); }
  };

  const onCsv = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const filas = parseProyectosCSV(reader.result);
      if (filas.length === 0) { showToast("CSV sin datos válidos. Verificá columnas: ot, cliente, obra, proyecto, division", RED); return; }
      setCsvFilas(filas);
      setCsvRawText(reader.result);
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
      showToast("✅ URL guardada", GREEN);
    } catch (e) { showToast(`Error: ${e.message}`, RED); }
    setSyncLoading(false);
  };

  const sincronizar = async () => {
    if (!syncCfg.url.trim()) { showToast("Guardá la URL primero", AMBER); return; }
    setSyncLoading(true);
    try {
      const res = await apiFetch("/api/proyectos/sync-csv", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error sync");
      showToast(`✅ ${data.procesados} proyectos sincronizados`, GREEN);
      await cargar(); await cargarSyncCfg();
    } catch (e) { showToast(`Error: ${e.message}`, RED); }
    setSyncLoading(false);
  };

  const importarCSV = async () => {
    if (!csvRawText) return;
    setSaving(true);
    setCsvProgreso(`Importando ${csvFilas.length} proyectos...`);
    try {
      const res = await apiFetch("/api/proyectos/import-csv", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: csvRawText,
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error al importar");

      const erroresTxt = data.errors?.length ? ` · ${data.errors.length} con error` : "";
      showToast(`✅ ${data.created} importados · ${data.skipped} duplicados${erroresTxt}`, data.created > 0 ? GREEN : AMBER);
      if (data.errors?.length) console.warn("Errores import CSV proyectos:", data.errors);
    } catch (e) {
      showToast(`Error: ${e.message}`, RED);
    }
    setCsvProgreso("");
    setCsvFilas(null);
    setCsvRawText(null);
    setSaving(false);
    await cargar();
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
    <div className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px] relative">

      {modal && <ModalProyecto initial={modal} divisiones={divisiones} onClose={() => setModal(null)} onSave={guardar} saving={saving} />}
      {csvFilas && <ModalCSVPreview filas={csvFilas} onClose={() => { setCsvFilas(null); setCsvRawText(null); }} onConfirm={importarCSV} saving={saving} progreso={csvProgreso} />}

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-2 mb-3.5">
        <div className="g-card text-center !p-3">
          <div className="font-heading text-[22px] font-bold text-gypi-green">{activos}</div>
          <div className="g-overline mt-0.5">Activos</div>
        </div>
        <div className="g-card text-center !p-3">
          <div className="font-heading text-[22px] font-bold text-gypi-mute">{cerrados}</div>
          <div className="g-overline mt-0.5">Cerrados</div>
        </div>
        <div className="g-card text-center !p-3">
          <div className="font-heading text-[22px] font-bold text-gypi-amber">{proyectos.length}</div>
          <div className="g-overline mt-0.5">Total</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-1.5 mb-2.5 overflow-x-auto pb-1">
        <Chip active={filtro === "activo"} onClick={() => setFiltro("activo")} color={GREEN}>Activos</Chip>
        <Chip active={filtro === "cerrado"} onClick={() => setFiltro("cerrado")} color="var(--color-text-muted)">Cerrados</Chip>
        <Chip active={filtro === "todos"} onClick={() => setFiltro("todos")}>Todos</Chip>
      </div>

      <div className="flex gap-1.5 mb-2.5 overflow-x-auto pb-1">
        {divisiones.map(d => <Chip key={d.id} active={filtroDiv === d.id} onClick={() => setFiltroDiv(d.id)} color={d.color || AMBER}>{d.label}</Chip>)}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Buscar por OT, cliente, obra..." className="g-input mb-3" />

      {/* Acciones */}
      <div className="flex gap-2 mb-2">
        <button onClick={() => setModal({})} className="flex-1 py-2.5 rounded-xl border-none bg-gypi-green/15 text-gypi-green text-[13px] font-bold cursor-pointer">+ Nuevo</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onCsv} />
        <button onClick={() => fileRef.current?.click()} className="flex-1 py-2.5 rounded-xl border-none bg-gypi-cyan/15 text-gypi-cyan text-[13px] font-bold cursor-pointer">📤 CSV</button>
        <button onClick={cargar} className="w-10 h-10 rounded-xl border-none bg-gypi-surface text-gypi-dim cursor-pointer text-[15px] shrink-0">🔄</button>
      </div>

      {/* Panel de URL de sincronización */}
      <div className="mb-3.5">
        <button
          onClick={() => setShowSyncPanel(p => !p)}
          className="w-full py-2 px-3 rounded-[10px] border border-gypi-border bg-transparent text-gypi-dim text-xs font-semibold cursor-pointer flex justify-between items-center"
        >
          <span>🔗 Sincronización automática {syncCfg.url ? "· configurada" : ""}</span>
          <span className="text-[10px]">{showSyncPanel ? "▲" : "▼"}</span>
        </button>
        {showSyncPanel && (
          <div className="mt-1.5 p-3 bg-gypi-surface rounded-[10px] border border-gypi-border">
            <div className="text-[11px] text-gypi-dim mb-2 leading-relaxed">
              URL pública de CSV (Google Sheets, servidor, etc.). Se hace upsert por OT: proyectos nuevos se crean, los existentes se actualizan.
            </div>
            {syncCfg.ultima_sync && (
              <div className="text-[10px] text-gypi-green mb-2">
                Última sync: {new Date(syncCfg.ultima_sync).toLocaleString("es-AR")}
              </div>
            )}
            <input
              value={syncCfg.url}
              onChange={e => setSyncCfg(p => ({ ...p, url: e.target.value }))}
              placeholder="https://docs.google.com/spreadsheets/d/…/export?format=csv"
              className="g-input text-xs mb-2"
            />
            <div className="flex gap-2">
              <button
                onClick={guardarSyncUrl}
                disabled={syncLoading || !syncCfg.url.trim()}
                className={`flex-1 py-2 rounded-lg border-none text-xs font-bold ${syncCfg.url.trim() ? "bg-gypi-amber/15 text-gypi-amber cursor-pointer" : "bg-gypi-surface text-gypi-mute cursor-default"}`}
              >
                Guardar URL
              </button>
              <button
                onClick={sincronizar}
                disabled={syncLoading || !syncCfg.url.trim()}
                className={`flex-1 py-2 rounded-lg border-none text-xs font-bold ${syncCfg.url.trim() && !syncLoading ? "bg-gypi-green/15 text-gypi-green cursor-pointer" : "bg-gypi-surface text-gypi-mute cursor-default"}`}
              >
                {syncLoading ? "Sincronizando…" : "🔄 Sincronizar ahora"}
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="gypi-dots"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
      ) : filtrados.length === 0 ? (
        <div className="g-card py-8 px-6 text-center">
          <div className="text-[28px] mb-2">📋</div>
          <div className="text-sm font-bold text-gypi-text mb-1">
            {search || filtroDiv ? "Sin resultados" : "Sin proyectos"}
          </div>
          <div className="text-xs text-gypi-dim">
            {search || filtroDiv ? "Probá con otro filtro o búsqueda." : "Creá el primero con el botón o importá un CSV."}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtrados.map(p => {
            const divInfo = divisiones.find(d => d.id === p.division) || divisiones[0];
            const divColor = divInfo.color || AMBER;
            return (
              <div key={p.id} className={`g-card !p-3.5 ${p.estado === "cerrado" ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-2.5">
                  <div className="min-w-[60px] h-10 rounded-[10px] flex items-center justify-center font-mono text-[13px] font-bold px-2" style={{ background: `${divColor}22`, color: divColor }}>{p.ot}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-gypi-text overflow-hidden text-ellipsis whitespace-nowrap">{p.cliente || p.proyecto || "—"}</div>
                    <div className="text-[11px] text-gypi-dim mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{p.obra || p.proyecto || ""}{p.division ? ` · ${divInfo.label}` : ""}</div>
                  </div>
                  {p.estado === "cerrado" && <Tag color="var(--color-text-muted)">cerrado</Tag>}
                </div>
                <div className="flex gap-1.5 mt-2.5 pt-2.5 border-t border-gypi-border">
                  <button onClick={() => setModal(p)} className="flex-1 py-2.5 rounded-lg border-none bg-gypi-cyan/10 text-gypi-cyan text-[11px] font-bold cursor-pointer min-h-[44px]">✏️ Editar</button>
                  {p.estado === "activo" ? (
                    <button onClick={() => cerrarProyecto(p.id)} className="py-2.5 px-3.5 rounded-lg border-none bg-gypi-amber/10 text-gypi-amber text-[11px] font-bold cursor-pointer min-h-[44px]">Cerrar</button>
                  ) : (
                    <button onClick={() => reabrir(p.id)} className="py-2.5 px-3.5 rounded-lg border-none bg-gypi-green/10 text-gypi-green text-[11px] font-bold cursor-pointer min-h-[44px]">Reactivar</button>
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
