import { useState, useEffect, useCallback, useMemo } from "react";
import { sb, apiFetch } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";
import { getDivisionesConSinAsignar } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { useToast } from "./components/ui/Toast";
import { useConfirm } from "./components/ui/ConfirmDialog";

const AMBER = "var(--color-empresa-primary, #F97316)";
const GREEN = "#16A34A";
const RED = "#DC2626";
const CYAN = "#0891B2";
const VIOLET = "#7C3AED";

const FORMATOS = [
  { id: "pdf", label: "PDF" },
  { id: "image", label: "Imagen" },
  { id: "word", label: "Word" },
];

const TABS = [
  { id: "tipos", label: "Tipos" },
  { id: "asignar", label: "Asignar" },
  { id: "cumplimiento", label: "Cumplimiento" },
];

/* ═══ MODAL TIPO DE DOCUMENTO ═══ */
function ModalTipo({ initial, onClose, onSave, saving }) {
  const [form, setForm] = useState(initial || { nombre: "", formatos_aceptados: ["pdf", "image"], admite_multiples: false, tipo_carga: "puntual" });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const toggleFormato = (f) => setForm((p) => {
    const set = new Set(p.formatos_aceptados || []);
    set.has(f) ? set.delete(f) : set.add(f);
    return { ...p, formatos_aceptados: [...set] };
  });
  const valid = form.nombre?.trim() && form.formatos_aceptados?.length > 0;
  const editando = !!initial?.id;

  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={editando ? "Editar tipo de documento" : "Nuevo tipo de documento"}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[85vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" />
        <h3 className="m-0 mb-4 font-heading text-lg font-bold text-gypi-text">{editando ? "Editar tipo de documento" : "Nuevo tipo de documento"}</h3>

        <div className="mb-3">
          <label className="g-label">Nombre *</label>
          <input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} className="g-input" placeholder="Ej: DNI - Anverso" />
        </div>

        <div className="mb-3">
          <label className="g-label block mb-1.5">Formatos aceptados *</label>
          <div className="flex gap-1.5">
            {FORMATOS.map((f) => {
              const active = (form.formatos_aceptados || []).includes(f.id);
              return (
                <button key={f.id} onClick={() => toggleFormato(f.id)} className="flex-1 py-2 rounded-[10px] border-none cursor-pointer text-xs font-bold font-body" style={{ background: active ? `${CYAN}22` : "var(--color-surface)", color: active ? CYAN : "var(--color-text-dim)" }}>
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-3">
          <label className="g-label block mb-1.5">Carga</label>
          <div className="flex gap-1.5">
            {[["puntual", "Puntual"], ["recurrente", "Recurrente"]].map(([id, label]) => (
              <button key={id} onClick={() => set("tipo_carga", id)} className="flex-1 py-2 rounded-[10px] border-none cursor-pointer text-xs font-bold font-body" style={{ background: form.tipo_carga === id ? `${AMBER}22` : "var(--color-surface)", color: form.tipo_carga === id ? AMBER : "var(--color-text-dim)" }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5 p-3 rounded-[10px]" style={{ background: `${VIOLET}10`, border: `1px solid ${VIOLET}30` }}>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={!!form.admite_multiples} onChange={(e) => set("admite_multiples", e.target.checked)} className="w-[18px] h-[18px] mt-0.5" style={{ accentColor: VIOLET }} />
            <div>
              <div className="text-[13px] font-bold text-gypi-text">Admite múltiples archivos</div>
              <div className="text-[11px] text-gypi-dim mt-0.5">Útil para tickets/facturas. Si está apagado, subir uno nuevo reemplaza al anterior.</div>
            </div>
          </label>
        </div>

        <button onClick={() => onSave(form)} disabled={!valid || saving} className="w-full py-3.5 rounded-xl border-none text-[15px] font-bold font-heading cursor-pointer" style={{ background: valid && !saving ? GREEN : "var(--color-surface)", color: valid && !saving ? "#000" : "var(--color-text-muted)" }}>
          {saving ? "Guardando..." : editando ? "Guardar cambios" : "Crear tipo"}
        </button>
      </div>
    </div>
  );
}

export default function DocumentosEmpleadoScreen({ empresaId }) {
  const { divisiones: divisionesCtx } = useAuth();
  const divisiones = getDivisionesConSinAsignar(divisionesCtx);
  const [tab, setTab] = useState("tipos");
  const [tipos, setTipos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [exigidos, setExigidos] = useState([]);
  const [cargados, setCargados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalTipo, setModalTipo] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [confirmFn, ConfirmDialog] = useConfirm();
  const showToast = (msg, color) => toast.show(msg, color);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [t, e, ex, ca] = await Promise.all([
        sb.get("tipos_documento_requerido?order=orden.asc"),
        sb.get("empleados?activo=eq.true&order=nombre.asc&select=id,nombre,apodo,legajo,division"),
        sb.get("documentos_exigidos_empleado?select=empleado_id,tipo_documento_id"),
        sb.get("documentos_empleado?select=id,empleado_id,tipo_documento_id,estado,nombre_archivo,fecha_carga&order=fecha_carga.desc"),
      ]);
      setTipos(t || []); setEmpleados(e || []); setExigidos(ex || []); setCargados(ca || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const tiposActivos = tipos.filter((t) => t.activo !== false);

  /* ── CRUD tipos ── */
  const guardarTipo = async (form) => {
    setSaving(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        formatos_aceptados: form.formatos_aceptados,
        admite_multiples: !!form.admite_multiples,
        tipo_carga: form.tipo_carga,
      };
      if (form.id) {
        await sb.patch(`tipos_documento_requerido?id=eq.${form.id}`, payload);
        showToast("✅ Tipo actualizado", GREEN);
      } else {
        await sb.post("tipos_documento_requerido", { ...payload, orden: tipos.length });
        showToast("✅ Tipo creado", GREEN);
      }
      setModalTipo(null);
      await cargar();
    } catch (err) { showToast(`Error: ${err.message}`, RED); }
    setSaving(false);
  };

  const desactivarTipo = async (tipo) => {
    if (!await confirmFn(`¿Desactivar "${tipo.nombre}"? Deja de exigirse a nuevos empleados; lo ya cargado no se borra.`, { title: "Desactivar tipo", confirmLabel: "Desactivar" })) return;
    try {
      await sb.patch(`tipos_documento_requerido?id=eq.${tipo.id}`, { activo: false });
      await cargar();
      showToast("Tipo desactivado", AMBER);
    } catch (err) { showToast(`Error: ${err.message}`, RED); }
  };

  const reactivarTipo = async (tipo) => {
    try {
      await sb.patch(`tipos_documento_requerido?id=eq.${tipo.id}`, { activo: true });
      await cargar();
      showToast("Tipo reactivado", GREEN);
    } catch (err) { showToast(`Error: ${err.message}`, RED); }
  };

  /* ── Asignación masiva/selectiva ── */
  const [tipoAsignar, setTipoAsignar] = useState("");
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [filtroDivision, setFiltroDivision] = useState("todas");
  const [asignando, setAsignando] = useState(false);

  const empsFiltrados = filtroDivision === "todas" ? empleados : empleados.filter((e) => e.division === filtroDivision);
  const toggleEmpleado = (id) => setSeleccionados((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const seleccionarTodosFiltrados = () => {
    const ids = empsFiltrados.map((e) => e.id);
    const allSel = ids.length > 0 && ids.every((id) => seleccionados.has(id));
    setSeleccionados((p) => { const n = new Set(p); ids.forEach((id) => (allSel ? n.delete(id) : n.add(id))); return n; });
  };

  const aplicarAsignacion = async () => {
    if (!tipoAsignar || seleccionados.size === 0) { showToast("Elegí un tipo y al menos un empleado", AMBER); return; }
    setAsignando(true);
    try {
      const res = await apiFetch("/api/documentos/asignar", {
        method: "POST",
        body: JSON.stringify({ tipo_documento_id: tipoAsignar, empleado_ids: [...seleccionados] }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error al asignar");
      showToast(`✅ Asignado a ${data.asignados} empleado${data.asignados !== 1 ? "s" : ""}${data.ya_asignados ? ` · ${data.ya_asignados} ya lo tenían` : ""}`, GREEN);
      setSeleccionados(new Set());
      await cargar();
    } catch (err) { showToast(`Error: ${err.message}`, RED); }
    setAsignando(false);
  };

  const desasignar = async (empleadoId, tipoDocumentoId) => {
    try {
      const res = await apiFetch("/api/documentos/asignar", { method: "DELETE", body: JSON.stringify({ empleado_id: empleadoId, tipo_documento_id: tipoDocumentoId }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error");
      await cargar();
      showToast("Desasignado", AMBER);
    } catch (err) { showToast(`Error: ${err.message}`, RED); }
  };

  /* ── Cumplimiento ── */
  const [filtroDivCumpl, setFiltroDivCumpl] = useState("todas");
  const [expandedEmp, setExpandedEmp] = useState(null);

  const cumplimiento = useMemo(() => {
    const empsF = filtroDivCumpl === "todas" ? empleados : empleados.filter((e) => e.division === filtroDivCumpl);
    return empsF.map((emp) => {
      const tipoIds = exigidos.filter((ex) => ex.empleado_id === emp.id).map((ex) => ex.tipo_documento_id);
      const detalle = tipoIds.map((tid) => {
        const tipo = tipos.find((t) => t.id === tid);
        const docs = cargados.filter((c) => c.empleado_id === emp.id && c.tipo_documento_id === tid && c.estado === "cargado");
        return { tipo, docs };
      }).filter((d) => d.tipo);
      const completos = detalle.filter((d) => d.docs.length > 0).length;
      return { emp, detalle, completos, total: detalle.length };
    });
  }, [empleados, exigidos, cargados, tipos, filtroDivCumpl]);

  const descargar = async (documentoId) => {
    try {
      const res = await apiFetch("/api/documentos/sign-url", { method: "POST", body: JSON.stringify({ documento_id: documentoId }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) { showToast(`Error: ${err.message}`, RED); }
  };

  if (loading) {
    return <div className="gypi-dots p-8"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;
  }

  return (
    <section aria-label="Documentación de empleados" className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px]">
      {/* Tabs internos */}
      <div className="flex mb-3.5 bg-gypi-surface rounded-xl p-[3px] border border-gypi-border">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="flex-1 py-2.5 rounded-[10px] border-none cursor-pointer text-[13px] font-bold font-heading transition-all" style={{ background: tab === t.id ? CYAN : "transparent", color: tab === t.id ? "#000" : "var(--color-text-dim)" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ TAB TIPOS ═══ */}
      {tab === "tipos" && (
        <>
          <button onClick={() => setModalTipo({})} className="w-full py-2.5 rounded-xl border-none bg-gypi-green/15 text-gypi-green text-[13px] font-bold cursor-pointer mb-3">+ Nuevo tipo de documento</button>
          {tiposActivos.length === 0 && tipos.length === 0 ? (
            <div className="g-card py-8 px-6 text-center">
              <div className="text-[28px] mb-2">📄</div>
              <div className="text-sm font-bold text-gypi-text mb-1">Sin tipos de documento</div>
              <div className="text-xs text-gypi-dim">Creá el primero (ej: DNI, Licencia de conducir).</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {tipos.map((t) => (
                <div key={t.id} className={`g-card !p-3.5 ${t.activo === false ? "opacity-50" : ""}`}>
                  <div className="flex items-center gap-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-gypi-text truncate">{t.nombre}</div>
                      <div className="text-[11px] text-gypi-dim mt-0.5">{(t.formatos_aceptados || []).join(", ")} · {t.tipo_carga}{t.admite_multiples ? " · múltiples" : ""}</div>
                    </div>
                    {t.activo === false && <Tag color="var(--color-text-muted)">inactivo</Tag>}
                  </div>
                  <div className="flex gap-1.5 mt-2.5 pt-2.5 border-t border-gypi-border">
                    <button onClick={() => setModalTipo(t)} className="flex-1 py-2.5 rounded-lg border-none bg-gypi-cyan/10 text-gypi-cyan text-[11px] font-bold cursor-pointer min-h-[44px]">✏️ Editar</button>
                    {t.activo === false ? (
                      <button onClick={() => reactivarTipo(t)} className="py-2.5 px-3.5 rounded-lg border-none bg-gypi-green/10 text-gypi-green text-[11px] font-bold cursor-pointer min-h-[44px]">Reactivar</button>
                    ) : (
                      <button onClick={() => desactivarTipo(t)} className="py-2.5 px-3.5 rounded-lg border-none bg-gypi-amber/10 text-gypi-amber text-[11px] font-bold cursor-pointer min-h-[44px]">Desactivar</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══ TAB ASIGNAR ═══ */}
      {tab === "asignar" && (
        <>
          <div className="bg-gypi-surface rounded-2xl p-4 mb-3.5" style={{ border: `1px solid ${CYAN}30` }}>
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] mb-3" style={{ color: CYAN }}>① Elegí el documento</div>
            <select value={tipoAsignar} onChange={(e) => setTipoAsignar(e.target.value)} className="g-input cursor-pointer">
              <option value="">Seleccionar tipo de documento...</option>
              {tiposActivos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </div>

          <div className="bg-gypi-surface rounded-2xl p-4 border border-gypi-border mb-3.5">
            <div className="flex justify-between items-center mb-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: CYAN }}>② Seleccioná empleados</div>
              <Tag color={seleccionados.size > 0 ? AMBER : "var(--color-text-dim)"}>{seleccionados.size} seleccionados</Tag>
            </div>
            <div className="flex gap-1 mb-2.5 overflow-x-auto pb-0.5">
              <Chip active={filtroDivision === "todas"} onClick={() => setFiltroDivision("todas")} color={AMBER}>Todas</Chip>
              {divisiones.filter((d) => d.id !== "todas").map((d) => <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || CYAN}>{d.label}</Chip>)}
            </div>
            <button onClick={seleccionarTodosFiltrados} className="w-full py-2 rounded-lg text-gypi-cyan text-xs font-bold font-body cursor-pointer mb-2 bg-transparent" style={{ border: "1px dashed var(--color-border)" }}>
              {empsFiltrados.length > 0 && empsFiltrados.every((e) => seleccionados.has(e.id)) ? "✕ Deseleccionar todos" : `☑ Seleccionar todos (${empsFiltrados.length})`}
            </button>
            <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto">
              {empsFiltrados.map((emp) => {
                const sel = seleccionados.has(emp.id);
                return (
                  <button key={emp.id} onClick={() => toggleEmpleado(emp.id)} className="flex items-center gap-2.5 py-2.5 px-3 rounded-[10px] cursor-pointer font-body text-left transition-all" style={{ border: `1px solid ${sel ? `${CYAN}40` : "var(--color-border)"}`, background: sel ? `${CYAN}10` : "transparent" }}>
                    <div className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-xs font-bold shrink-0" style={{ border: `2px solid ${sel ? CYAN : "var(--color-text-muted)"}`, background: sel ? CYAN : "transparent", color: "#000" }}>{sel && "✓"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-gypi-text truncate">{emp.nombre}</div>
                      <div className="text-[10px] text-gypi-dim truncate">{divisiones.find((d) => d.id === emp.division)?.label || "Sin división"}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={aplicarAsignacion} disabled={asignando || !tipoAsignar || seleccionados.size === 0} className="w-full py-3.5 rounded-[14px] border-none text-[15px] font-bold font-heading mb-2.5" style={{
            background: tipoAsignar && seleccionados.size > 0 ? `linear-gradient(135deg, ${CYAN}, ${GREEN})` : "var(--color-surface)",
            color: tipoAsignar && seleccionados.size > 0 ? "#000" : "var(--color-text-muted)", cursor: tipoAsignar && seleccionados.size > 0 ? "pointer" : "default",
          }}>{asignando ? "Asignando..." : `⚡ Exigir a ${seleccionados.size || "..."} empleado${seleccionados.size !== 1 ? "s" : ""}`}</button>
        </>
      )}

      {/* ═══ TAB CUMPLIMIENTO ═══ */}
      {tab === "cumplimiento" && (
        <>
          <div className="flex gap-1 mb-3 overflow-x-auto pb-0.5">
            <Chip active={filtroDivCumpl === "todas"} onClick={() => setFiltroDivCumpl("todas")} color={AMBER}>Todas</Chip>
            {divisiones.filter((d) => d.id !== "todas").map((d) => <Chip key={d.id} active={filtroDivCumpl === d.id} onClick={() => setFiltroDivCumpl(d.id)} color={d.color || CYAN}>{d.label}</Chip>)}
          </div>

          {cumplimiento.length === 0 ? (
            <div className="g-card py-8 px-6 text-center">
              <div className="text-sm font-bold text-gypi-text mb-1">Sin empleados</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {cumplimiento.map(({ emp, detalle, completos, total }) => {
                const isExp = expandedEmp === emp.id;
                const color = total === 0 ? "var(--color-text-muted)" : completos === total ? GREEN : completos === 0 ? RED : AMBER;
                return (
                  <div key={emp.id} className="bg-gypi-surface rounded-[14px] overflow-hidden border border-gypi-border">
                    <button onClick={() => setExpandedEmp(isExp ? null : emp.id)} aria-expanded={isExp} className="w-full py-3 px-3.5 bg-transparent border-none cursor-pointer flex items-center gap-2.5 font-body text-left">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold text-gypi-text truncate">{emp.nombre}</div>
                        <div className="text-[10px] text-gypi-dim mt-0.5">{divisiones.find((d) => d.id === emp.division)?.label || "Sin división"}</div>
                      </div>
                      {total > 0 && <Tag color={color}>{completos}/{total} documentos</Tag>}
                      <span className="text-gypi-dim text-xs transition-transform" style={{ transform: isExp ? "rotate(90deg)" : "rotate(0)" }}>▶</span>
                    </button>
                    {isExp && (
                      <div className="px-3.5 pb-3.5">
                        {detalle.length === 0 ? (
                          <div className="text-[11px] text-gypi-dim py-2">Sin documentos exigidos.</div>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {detalle.map(({ tipo, docs }) => (
                              <div key={tipo.id} className="flex items-center gap-2 py-2 px-2.5 rounded-lg" style={{ background: docs.length > 0 ? `${GREEN}08` : `${RED}08`, border: `1px solid ${docs.length > 0 ? `${GREEN}20` : `${RED}20`}` }}>
                                <span className="text-xs flex-1 font-semibold text-gypi-text">{tipo.nombre}</span>
                                {docs.length > 0 ? (
                                  <>
                                    <Tag color={GREEN}>cargado</Tag>
                                    <button onClick={() => descargar(docs[0].id)} className="py-1 px-2 rounded-md border-none bg-gypi-cyan/15 text-gypi-cyan text-[10px] font-bold cursor-pointer">⬇ Ver</button>
                                  </>
                                ) : (
                                  <>
                                    <Tag color={RED}>falta</Tag>
                                    <button onClick={() => desasignar(emp.id, tipo.id)} className="py-1 px-2 rounded-md border-none bg-gypi-surf-hi text-gypi-dim text-[10px] font-bold cursor-pointer">Quitar</button>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {modalTipo && <ModalTipo initial={modalTipo} onClose={() => setModalTipo(null)} onSave={guardarTipo} saving={saving} />}
      {ConfirmDialog}
    </section>
  );
}
