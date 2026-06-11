import { useState, useEffect, useCallback } from "react";
import { C } from "./lib/theme";
import { sb } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";

const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIAS_L = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
const DEFAULT_IN = "08:30";
const DEFAULT_OUT = "17:30";

import { getDivisionesConTodos } from "./lib/constants";

const calcHoras = (row) => {
  let t = 0;
  DIAS.forEach(d => {
    if (row[d]) {
      const [hI, mI] = row[d].in.split(":").map(Number);
      const [hO, mO] = row[d].out.split(":").map(Number);
      t += (hO * 60 + mO - hI * 60 - mI) / 60;
    }
  });
  return Math.max(0, t);
};

const fmtHorario = (row) => {
  return DIAS.map(d => row[d] ? `${DIAS_L[d]} ${row[d].in}-${row[d].out}` : `${DIAS_L[d]} Franco`).join(" · ");
};

export default function GrillaHorarioScreen({ empresaId }) {
  const DIVISIONES = getDivisionesConTodos();
  const [empleados, setEmpleados] = useState([]);
  const [grilla, setGrilla] = useState({});
  const [original, setOriginal] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [modo, setModo] = useState("individual");
  const [horarioMasivo, setHorarioMasivo] = useState(() => {
    const h = {}; DIAS.forEach(d => { h[d] = (d === "sab" || d === "dom") ? null : { in: DEFAULT_IN, out: DEFAULT_OUT }; }); return h;
  });
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [filtroDivision, setFiltroDivision] = useState("todas");
  const [expandedId, setExpandedId] = useState(null);

  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const emps = await sb.get("empleados?activo=eq.true&order=nombre.asc&select=id,nombre,apodo,legajo,area,division,rol,diagrama,horas_semanales");
      setEmpleados(emps || []);
      const g = {}, o = {};
      (emps || []).forEach(e => {
        const diag = e.diagrama || {}; const row = {};
        DIAS.forEach(d => { row[d] = diag[d] ? { in: diag[d].in || DEFAULT_IN, out: diag[d].out || DEFAULT_OUT } : null; });
        g[e.id] = row; o[e.id] = JSON.parse(JSON.stringify(row));
      });
      setGrilla(g); setOriginal(o);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const tienesCambios = (id) => JSON.stringify(grilla[id]) !== JSON.stringify(original[id]);
  const totalCambios = empleados.filter(e => tienesCambios(e.id)).length;
  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3500); };

  const setHorario = (empId, dia, campo, valor) => {
    setGrilla(p => { const c = { ...p }; const row = { ...c[empId] }; if (!row[dia]) row[dia] = { in: DEFAULT_IN, out: DEFAULT_OUT }; row[dia] = { ...row[dia], [campo]: valor }; c[empId] = row; return c; });
  };
  const toggleFranco = (empId, dia) => {
    setGrilla(p => { const c = { ...p }; const row = { ...c[empId] }; row[dia] = row[dia] ? null : { in: DEFAULT_IN, out: DEFAULT_OUT }; c[empId] = row; return c; });
  };
  const aplicarDefault = (empId) => {
    setGrilla(p => { const c = { ...p }; const row = {}; DIAS.forEach(d => { row[d] = (d === "sab" || d === "dom") ? null : { in: DEFAULT_IN, out: DEFAULT_OUT }; }); c[empId] = row; return c; });
  };
  const toggleDiaMasivo = (dia) => { setHorarioMasivo(p => ({ ...p, [dia]: p[dia] ? null : { in: DEFAULT_IN, out: DEFAULT_OUT } })); };
  const setHorarioMasivoField = (dia, campo, valor) => { setHorarioMasivo(p => { if (!p[dia]) return p; return { ...p, [dia]: { ...p[dia], [campo]: valor } }; }); };
  const toggleEmpleado = (id) => { setSeleccionados(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const seleccionarTodosFiltrados = () => {
    const ids = empsFiltrados.map(e => e.id);
    const allSelected = ids.every(id => seleccionados.has(id));
    if (allSelected) setSeleccionados(p => { const n = new Set(p); ids.forEach(id => n.delete(id)); return n; });
    else setSeleccionados(p => { const n = new Set(p); ids.forEach(id => n.add(id)); return n; });
  };
  const aplicarMasivo = () => {
    if (seleccionados.size === 0) { showToast("Seleccioná al menos un empleado", C.amber); return; }
    setGrilla(p => { const c = { ...p }; seleccionados.forEach(id => { c[id] = JSON.parse(JSON.stringify(horarioMasivo)); }); return c; });
    showToast(`✅ Horario aplicado a ${seleccionados.size} empleado${seleccionados.size > 1 ? "s" : ""}`, C.green);
  };

  const guardarYNotificar = async () => {
    const cambios = empleados.filter(e => tienesCambios(e.id));
    if (!cambios.length) { showToast("No hay cambios para guardar", C.amber); return; }
    setSaving(true); let ok = 0, errores = 0;
    for (const emp of cambios) {
      const row = grilla[emp.id]; const diagrama = {};
      DIAS.forEach(d => { diagrama[d] = row[d] ? { in: row[d].in, out: row[d].out } : null; });
      const horas = calcHoras(row);
      try {
        await sb.patch(`empleados?id=eq.${emp.id}`, { diagrama, horas_semanales: Math.round(horas) });
        try { await sb.post("notificaciones", { destinatario_rol: String(emp.legajo), tipo: "info", asunto: "📅 Horario actualizado", detalle: fmtHorario(row), urgencia: "normal", empresa_id: empresaId }); } catch (e) { }
        try { await fetch("/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legajo: String(emp.legajo), title: "📅 Horario actualizado", body: "Tu grilla horaria fue modificada. Revisá tu nuevo horario.", data: { tag: "horario-update" } }) }); } catch (e) { }
        ok++;
      } catch (e) { console.error("Error guardando horario de", emp.nombre, ":", e); errores++; }
    }
    if (ok > 0) { setOriginal(JSON.parse(JSON.stringify(grilla))); setSeleccionados(new Set()); }
    showToast(errores > 0 ? `⚠️ ${ok} guardado${ok !== 1 ? "s" : ""}, ${errores} con error.` : `✅ ${ok} horario${ok > 1 ? "s" : ""} guardado${ok > 1 ? "s" : ""} y notificado${ok > 1 ? "s" : ""}`, errores > 0 ? C.amber : C.green);
    setSaving(false);
  };

  const empsFiltrados = filtroDivision === "todas" ? empleados : empleados.filter(e => e.division === filtroDivision);

  /* ── Toggle switch reusable ── */
  const Toggle = ({ on, onClick, color = C.green, size = "sm" }) => {
    const w = size === "sm" ? 34 : 48; const h = size === "sm" ? 20 : 28; const d = size === "sm" ? 16 : 22;
    return (
      <button onClick={onClick} className="relative border-none cursor-pointer shrink-0 rounded-full" style={{ width: w, height: h, background: on ? color : C.mute, transition: "background 0.2s" }}>
        <div className="absolute rounded-full bg-white" style={{ width: d, height: d, top: (h - d) / 2, left: on ? w - d - 2 : 2, transition: "left 0.2s" }} />
      </button>
    );
  };

  /* ── Time input ── */
  const TimeInput = ({ value, onChange, className = "" }) => (
    <input type="time" value={value} onChange={onChange} className={`bg-gypi-surf-hi border border-gypi-border rounded-lg py-1 px-1.5 text-gypi-text text-[13px] font-mono font-semibold outline-none w-[82px] ${className}`} />
  );

  return (
    <div className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px] relative">
      {toast && <div className="fixed top-[60px] left-1/2 -translate-x-1/2 z-[999] py-3 px-5 rounded-xl text-[13px] font-semibold max-w-[90%]" style={{ background: C.bg, border: `1px solid ${toast.color}40`, boxShadow: `0 8px 32px ${toast.color}20`, color: toast.color }}>{toast.msg}</div>}

      {/* Modo toggle */}
      <div className="flex mb-3.5 bg-gypi-surface rounded-xl p-[3px] border border-gypi-border">
        <button onClick={() => setModo("masivo")} className="flex-1 py-2.5 rounded-[10px] border-none cursor-pointer text-[13px] font-bold font-heading transition-all" style={{ background: modo === "masivo" ? C.cyan : "transparent", color: modo === "masivo" ? "#000" : C.dim }}>⚡ Asignación masiva</button>
        <button onClick={() => setModo("individual")} className="flex-1 py-2.5 rounded-[10px] border-none cursor-pointer text-[13px] font-bold font-heading transition-all" style={{ background: modo === "individual" ? C.amber : "transparent", color: modo === "individual" ? "#000" : C.dim }}>✏️ Individual</button>
      </div>

      {loading ? (
        <div className="gypi-dots"><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /></div>
      ) : modo === "masivo" ? (
        <>
          {/* Paso 1: horario */}
          <div className="bg-gypi-surface rounded-2xl p-4 mb-3.5" style={{ border: `1px solid ${C.cyan}30` }}>
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] mb-3" style={{ color: C.cyan }}>① Definí el horario</div>
            <div className="flex flex-col gap-1.5">
              {DIAS.map(d => {
                const activo = !!horarioMasivo[d];
                return (
                  <div key={d} className="flex items-center gap-2 py-1.5">
                    <Toggle on={activo} onClick={() => toggleDiaMasivo(d)} />
                    <span className="w-[34px] text-xs font-bold font-heading" style={{ color: activo ? C.text : C.mute }}>{DIAS_L[d]}</span>
                    {activo ? (
                      <div className="flex items-center gap-1.5 flex-1">
                        <TimeInput value={horarioMasivo[d].in} onChange={e => setHorarioMasivoField(d, "in", e.target.value)} />
                        <span className="text-gypi-dim text-[11px]">→</span>
                        <TimeInput value={horarioMasivo[d].out} onChange={e => setHorarioMasivoField(d, "out", e.target.value)} />
                      </div>
                    ) : (
                      <span className="text-[11px] text-gypi-mute font-semibold">Franco</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2.5 text-xs text-gypi-dim">{calcHoras(horarioMasivo).toFixed(1)}h/semana · {DIAS.filter(d => horarioMasivo[d]).length} días</div>
          </div>

          {/* Paso 2: seleccionar empleados */}
          <div className="bg-gypi-surface rounded-2xl p-4 border border-gypi-border mb-3.5">
            <div className="flex justify-between items-center mb-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: C.cyan }}>② Seleccioná empleados</div>
              <Tag color={seleccionados.size > 0 ? C.amber : C.dim}>{seleccionados.size} seleccionados</Tag>
            </div>
            <div className="flex gap-1 mb-2.5 overflow-x-auto pb-0.5">
              {DIVISIONES.map(d => <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || C.cyan}>{d.label}</Chip>)}
            </div>
            <button onClick={seleccionarTodosFiltrados} className="w-full py-2 rounded-lg text-gypi-cyan text-xs font-bold font-body cursor-pointer mb-2 bg-transparent" style={{ border: `1px dashed ${C.border}` }}>
              {empsFiltrados.every(e => seleccionados.has(e.id)) && empsFiltrados.length > 0 ? "✕ Deseleccionar todos" : `☑ Seleccionar todos (${empsFiltrados.length})`}
            </button>
            <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto">
              {empsFiltrados.map(emp => {
                const sel = seleccionados.has(emp.id);
                const changed = tienesCambios(emp.id);
                return (
                  <button key={emp.id} onClick={() => toggleEmpleado(emp.id)} className="flex items-center gap-2.5 py-2.5 px-3 rounded-[10px] cursor-pointer font-body text-left transition-all" style={{ border: `1px solid ${sel ? `${C.cyan}40` : C.border}`, background: sel ? `${C.cyan}10` : "transparent" }}>
                    <div className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-xs font-bold shrink-0" style={{ border: `2px solid ${sel ? C.cyan : C.mute}`, background: sel ? C.cyan : "transparent", color: "#000" }}>{sel && "✓"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-gypi-text truncate">{emp.apodo || emp.nombre}</div>
                      <div className="text-[10px] text-gypi-dim">L-{emp.legajo}</div>
                    </div>
                    {changed && <Tag color={C.amber}>Editado</Tag>}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={aplicarMasivo} disabled={seleccionados.size === 0} className="w-full py-3.5 rounded-[14px] border-none text-[15px] font-bold font-heading mb-2.5" style={{
            background: seleccionados.size > 0 ? `linear-gradient(135deg, ${C.cyan}, ${C.green})` : C.surface,
            color: seleccionados.size > 0 ? "#000" : C.mute, cursor: seleccionados.size > 0 ? "pointer" : "default",
          }}>⚡ Aplicar horario a {seleccionados.size || "..."} empleado{seleccionados.size !== 1 ? "s" : ""}</button>
        </>
      ) : (
        /* ═══ MODO INDIVIDUAL ═══ */
        <>
          <div className="flex gap-1 mb-2.5 overflow-x-auto pb-0.5">
            {DIVISIONES.map(d => <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || C.amber}>{d.label}</Chip>)}
          </div>
          <div className="flex flex-col gap-2">
            {empsFiltrados.map(emp => {
              const isExp = expandedId === emp.id;
              const changed = tienesCambios(emp.id);
              const row = grilla[emp.id] || {};
              const horas = calcHoras(row);
              const diasActivos = DIAS.filter(d => row[d]).length;
              return (
                <div key={emp.id} className="bg-gypi-surface rounded-[14px] overflow-hidden" style={{ border: `1px solid ${changed ? `${C.amber}40` : C.border}` }}>
                  <button onClick={() => setExpandedId(isExp ? null : emp.id)} className="w-full py-3 px-3.5 bg-transparent border-none cursor-pointer flex items-center gap-2.5 font-body text-left">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-gypi-text truncate">{emp.apodo || emp.nombre}</div>
                      <div className="text-[10px] text-gypi-dim mt-0.5">L-{emp.legajo} · {diasActivos}d · {horas.toFixed(1)}h/sem</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {changed && <Tag color={C.amber}>Editado</Tag>}
                      <span className="text-gypi-dim text-xs transition-transform" style={{ transform: isExp ? "rotate(90deg)" : "rotate(0)" }}>▶</span>
                    </div>
                  </button>
                  {!isExp && (
                    <div className="px-3.5 pb-2.5 flex gap-[3px]">
                      {DIAS.map(d => (
                        <div key={d} className="flex-1 text-center py-[3px] rounded-[5px] text-[8px] font-bold font-mono uppercase" style={{ background: row[d] ? `${C.green}15` : `${C.mute}10`, color: row[d] ? C.green : C.mute }}>{DIAS_L[d]}</div>
                      ))}
                    </div>
                  )}
                  {isExp && (
                    <div className="px-3.5 pb-3.5">
                      <button onClick={() => aplicarDefault(emp.id)} className="py-1.5 px-3 rounded-lg border-none text-[11px] font-bold font-body cursor-pointer mb-2.5" style={{ background: `${C.cyan}22`, color: C.cyan }}>🔄 Default L-V</button>
                      <div className="flex flex-col gap-[5px]">
                        {DIAS.map(d => {
                          const activo = !!row[d];
                          return (
                            <div key={d} className="flex items-center gap-2 py-1.5 px-2 rounded-lg" style={{ background: activo ? `${C.green}08` : C.surfLo, border: `1px solid ${activo ? `${C.green}20` : C.border}` }}>
                              <span className="w-[30px] text-[11px] font-bold font-heading" style={{ color: activo ? C.text : C.mute }}>{DIAS_L[d]}</span>
                              <Toggle on={activo} onClick={() => toggleFranco(emp.id, d)} size="sm" />
                              {activo ? (
                                <div className="flex items-center gap-1 flex-1">
                                  <input type="time" value={row[d].in} onChange={e => setHorario(emp.id, d, "in", e.target.value)} className="bg-gypi-surf-hi border border-gypi-border rounded-md py-[3px] px-[5px] text-gypi-text text-xs font-mono outline-none w-[78px]" />
                                  <span className="text-gypi-dim text-[10px]">→</span>
                                  <input type="time" value={row[d].out} onChange={e => setHorario(emp.id, d, "out", e.target.value)} className="bg-gypi-surf-hi border border-gypi-border rounded-md py-[3px] px-[5px] text-gypi-text text-xs font-mono outline-none w-[78px]" />
                                </div>
                              ) : <span className="text-[11px] text-gypi-mute">Franco</span>}
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 text-[11px] text-gypi-dim">{diasActivos} días · {horas.toFixed(1)}h/semana {changed && <Tag color={C.amber}>sin guardar</Tag>}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Botón guardar flotante */}
      {totalCambios > 0 && (
        <div className="fixed bottom-[100px] left-1/2 -translate-x-1/2 z-50 max-w-[440px] w-[calc(100%-36px)]">
          <button onClick={guardarYNotificar} disabled={saving} className="w-full py-4 rounded-2xl border-none text-[15px] font-bold font-heading flex items-center justify-center gap-2" style={{
            background: saving ? C.surface : `linear-gradient(135deg, ${C.amber}, ${C.violet})`,
            color: saving ? C.dim : "#000", cursor: saving ? "default" : "pointer", boxShadow: `0 8px 32px ${C.amber}30`,
          }}>{saving ? "⏳ Guardando..." : `📤 Guardar y notificar ${totalCambios} empleado${totalCambios > 1 ? "s" : ""}`}</button>
        </div>
      )}

      <div className="text-center mt-4 text-[10px] text-gypi-mute">{empleados.length} empleados activos · {totalCambios} con cambios</div>
    </div>
  );
}
