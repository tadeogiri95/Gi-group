import { useState, useEffect, useCallback } from "react";
import { sb } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";
import { useToast } from "./components/ui/Toast";

// Colores por token (R11): el de la empresa para lo principal y cian para "varios a la vez"
const MARCA = "var(--color-empresa-primary)";
const CIAN = "var(--color-cyan)";

const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIAS_L = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
const DEFAULT_IN = "08:30";
const DEFAULT_OUT = "17:30";

import { getDivisionesConTodos } from "./lib/constants";
import { useAuth } from "./context/AuthContext";

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

// Interruptor de "trabaja / franco": 48×28 (antes 34×20, difícil de tocar)
const Toggle = ({ on, onClick, label }) => (
  <button onClick={onClick} aria-pressed={on} aria-label={label || (on ? "Desactivar" : "Activar")} className={`relative border-none cursor-pointer shrink-0 rounded-full w-12 h-7 transition-colors duration-200 ${on ? "bg-gypi-green" : "bg-(--color-text-muted)"}`}>
    <div className={`absolute rounded-full bg-white w-[22px] h-[22px] top-[3px] transition-all duration-200 ${on ? "left-[23px]" : "left-[3px]"}`} />
  </button>
);

// Fuera del componente: definida adentro se volvía a crear en cada tecla y el campo perdía el foco
const TimeInput = ({ value, onChange, className = "" }) => (
  <input type="time" value={value} onChange={onChange} className={`bg-gypi-surf-hi border border-gypi-border rounded-lg py-1.5 px-1.5 min-h-10 text-gypi-text text-[15px] font-mono font-semibold outline-none w-[92px] ${className}`} />
);

export default function GrillaHorarioScreen({ empresaId }) {
  const { divisiones: divisionesCtx } = useAuth();
  const DIVISIONES = getDivisionesConTodos(divisionesCtx);
  const [empleados, setEmpleados] = useState([]);
  const [grilla, setGrilla] = useState({});
  const [original, setOriginal] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
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
    if (seleccionados.size === 0) { toast.show("Seleccioná al menos un empleado"); return; }
    setGrilla(p => { const c = { ...p }; seleccionados.forEach(id => { c[id] = JSON.parse(JSON.stringify(horarioMasivo)); }); return c; });
    toast.success(`Listo para ${seleccionados.size} empleado${seleccionados.size > 1 ? "s" : ""}. Tocá "Guardar" abajo para confirmar y avisarles.`);
  };

  const guardarYNotificar = async () => {
    const cambios = empleados.filter(e => tienesCambios(e.id));
    if (!cambios.length) { toast.show("No hay cambios para guardar"); return; }
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
    if (errores > 0) toast.show(`⚠️ ${ok} guardado${ok !== 1 ? "s" : ""}, ${errores} con error.`);
    else toast.success(`✅ ${ok} horario${ok > 1 ? "s" : ""} guardado${ok > 1 ? "s" : ""} y notificado${ok > 1 ? "s" : ""}`);
    setSaving(false);
  };

  const empsFiltrados = filtroDivision === "todas" ? empleados : empleados.filter(e => e.division === filtroDivision);

  /* ── Toggle switch reusable ── */
  return (
    <section aria-label="Grilla de horarios" className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px] relative">

      {/* Modo toggle */}
      <div className="flex mb-3.5 bg-gypi-surface rounded-xl p-[3px] border border-gypi-border">
        <button onClick={() => setModo("masivo")} aria-pressed={modo === "masivo"} className={`flex-1 py-2.5 min-h-11 rounded-[10px] border-none cursor-pointer text-[13px] font-bold font-heading transition-all ${modo === "masivo" ? "bg-gypi-cyan text-black" : "bg-transparent text-gypi-dim"}`}>⚡ Varios a la vez</button>
        <button onClick={() => setModo("individual")} aria-pressed={modo === "individual"} className={`flex-1 py-2.5 min-h-11 rounded-[10px] border-none cursor-pointer text-[13px] font-bold font-heading transition-all ${modo === "individual" ? "bg-gypi-amber text-gypi-on-amber" : "bg-transparent text-gypi-dim"}`}>✏️ De a uno</button>
      </div>

      {loading ? (
        <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
      ) : modo === "masivo" ? (
        <>
          {/* Paso 1: horario */}
          <div className="bg-gypi-surface rounded-2xl p-4 mb-3.5 border border-gypi-cyan/20">
            <div className="text-[12px] font-bold uppercase tracking-[0.08em] mb-3 text-gypi-cyan-ink">① Definí el horario</div>
            <div className="flex flex-col gap-1.5">
              {DIAS.map(d => {
                const activo = !!horarioMasivo[d];
                return (
                  <div key={d} className="flex items-center gap-2 py-1.5">
                    <Toggle on={activo} onClick={() => toggleDiaMasivo(d)} label={`${DIAS_L[d]}: ${activo ? "trabaja (tocá para franco)" : "franco (tocá para que trabaje)"}`} />
                    <span className={`w-[34px] text-[13px] font-bold font-heading ${activo ? "text-gypi-text" : "text-gypi-mute"}`}>{DIAS_L[d]}</span>
                    {activo ? (
                      <div className="flex items-center gap-1.5 flex-1">
                        <TimeInput value={horarioMasivo[d].in} onChange={e => setHorarioMasivoField(d, "in", e.target.value)} />
                        <span className="text-gypi-dim text-[11px]">→</span>
                        <TimeInput value={horarioMasivo[d].out} onChange={e => setHorarioMasivoField(d, "out", e.target.value)} />
                      </div>
                    ) : (
                      <span className="text-[13px] text-gypi-mute font-semibold">Franco</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2.5 text-[13px] text-gypi-dim">{calcHoras(horarioMasivo).toFixed(1)} horas por semana · {DIAS.filter(d => horarioMasivo[d]).length} días</div>
          </div>

          {/* Paso 2: seleccionar empleados */}
          <div className="bg-gypi-surface rounded-2xl p-4 border border-gypi-border mb-3.5">
            <div className="flex justify-between items-center mb-3">
              <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-gypi-cyan-ink">② Seleccioná empleados</div>
              <Tag color={seleccionados.size > 0 ? MARCA : "var(--color-text-dim)"}>{seleccionados.size} seleccionados</Tag>
            </div>
            <div className="flex gap-1 mb-2.5 overflow-x-auto pb-0.5">
              {DIVISIONES.map(d => <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || CIAN}>{d.label}</Chip>)}
            </div>
            <button onClick={seleccionarTodosFiltrados} className="w-full py-2 min-h-11 rounded-lg text-gypi-cyan-ink text-[13px] font-bold font-body cursor-pointer mb-2 bg-transparent border border-dashed border-gypi-border">
              {empsFiltrados.every(e => seleccionados.has(e.id)) && empsFiltrados.length > 0 ? "✕ Deseleccionar todos" : `☑ Seleccionar todos (${empsFiltrados.length})`}
            </button>
            <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto">
              {empsFiltrados.map(emp => {
                const sel = seleccionados.has(emp.id);
                const changed = tienesCambios(emp.id);
                return (
                  <button key={emp.id} onClick={() => toggleEmpleado(emp.id)} aria-pressed={sel} className={`flex items-center gap-2.5 py-2.5 px-3 min-h-11 rounded-[10px] cursor-pointer font-body text-left transition-all border ${sel ? "border-gypi-cyan/25 bg-gypi-cyan/[0.06]" : "border-gypi-border bg-transparent"}`}>
                    <div className={`w-[22px] h-[22px] rounded-md flex items-center justify-center text-xs font-bold shrink-0 border-2 text-black ${sel ? "border-gypi-cyan bg-gypi-cyan" : "border-(--color-text-muted) bg-transparent"}`} aria-hidden="true">{sel && "✓"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-gypi-text truncate">{emp.nombre}</div>
                      <div className="text-xs text-gypi-dim truncate">{DIVISIONES.find(d => d.id === emp.division)?.label || "Sin división"} · {emp.area || "produccion"} · {emp.rol || "operativo"}</div>
                    </div>
                    {changed && <Tag color={MARCA}>Editado</Tag>}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={aplicarMasivo} disabled={seleccionados.size === 0} className={`w-full py-3.5 min-h-12 rounded-[14px] border-none text-[15px] font-bold font-heading mb-2.5 ${seleccionados.size > 0 ? "bg-gypi-cyan text-black cursor-pointer" : "bg-gypi-surface text-gypi-mute cursor-default"}`}>⚡ Aplicar horario a {seleccionados.size || "..."} empleado{seleccionados.size !== 1 ? "s" : ""}</button>
        </>
      ) : (
        /* ═══ MODO INDIVIDUAL ═══ */
        <>
          <div className="flex gap-1 mb-2.5 overflow-x-auto pb-0.5">
            {DIVISIONES.map(d => <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || MARCA}>{d.label}</Chip>)}
          </div>
          <div className="flex flex-col gap-2">
            {empsFiltrados.map(emp => {
              const isExp = expandedId === emp.id;
              const changed = tienesCambios(emp.id);
              const row = grilla[emp.id] || {};
              const horas = calcHoras(row);
              const diasActivos = DIAS.filter(d => row[d]).length;
              return (
                <div key={emp.id} className={`bg-gypi-surface rounded-[14px] overflow-hidden border ${changed ? "border-gypi-amber/25" : "border-gypi-border"}`}>
                  <button onClick={() => setExpandedId(isExp ? null : emp.id)} aria-expanded={isExp} className="w-full py-3 px-3.5 bg-transparent border-none cursor-pointer flex items-center gap-2.5 font-body text-left">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-gypi-text truncate">{emp.nombre}</div>
                      <div className="text-xs text-gypi-dim mt-0.5">{DIVISIONES.find(d => d.id === emp.division)?.label || "Sin división"} · {emp.area || "produccion"} · {emp.rol || "operativo"} · {diasActivos} días · {horas.toFixed(1)} h/semana</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {changed && <Tag color={MARCA}>Editado</Tag>}
                      <span className={`text-gypi-dim text-xs transition-transform ${isExp ? "rotate-90" : ""}`} aria-hidden="true">▶</span>
                    </div>
                  </button>
                  {!isExp && (
                    <div className="px-3.5 pb-2.5 flex gap-[3px]" aria-label={`Trabaja: ${DIAS.filter(d => row[d]).map(d => DIAS_L[d]).join(", ") || "ningún día"}`}>
                      {DIAS.map(d => (
                        <div key={d} className={`flex-1 text-center py-[3px] rounded-[5px] text-[11px] font-bold font-mono uppercase ${row[d] ? "bg-gypi-green/10 text-gypi-green-ink" : "bg-gypi-surf-hi text-gypi-mute line-through"}`}>{DIAS_L[d]}</div>
                      ))}
                    </div>
                  )}
                  {isExp && (
                    <div className="px-3.5 pb-3.5">
                      <button onClick={() => aplicarDefault(emp.id)} className="py-1.5 px-3 min-h-11 rounded-lg border-none text-[13px] font-bold font-body cursor-pointer mb-2.5 bg-gypi-cyan/10 text-gypi-cyan-ink">🔄 Lunes a viernes, {DEFAULT_IN} a {DEFAULT_OUT}</button>
                      <div className="flex flex-col gap-[5px]">
                        {DIAS.map(d => {
                          const activo = !!row[d];
                          return (
                            <div key={d} className={`flex items-center gap-2 py-1.5 px-2 rounded-lg border ${activo ? "bg-gypi-green/5 border-gypi-green/15" : "bg-gypi-surf-lo border-gypi-border"}`}>
                              <span className={`w-[34px] text-[13px] font-bold font-heading ${activo ? "text-gypi-text" : "text-gypi-mute"}`}>{DIAS_L[d]}</span>
                              <Toggle on={activo} onClick={() => toggleFranco(emp.id, d)} label={`${DIAS_L[d]}: ${activo ? "trabaja (tocá para franco)" : "franco (tocá para que trabaje)"}`} />
                              {activo ? (
                                <div className="flex items-center gap-1 flex-1">
                                  <TimeInput value={row[d].in} onChange={e => setHorario(emp.id, d, "in", e.target.value)} />
                                  <span className="text-gypi-dim text-xs">→</span>
                                  <TimeInput value={row[d].out} onChange={e => setHorario(emp.id, d, "out", e.target.value)} />
                                </div>
                              ) : <span className="text-[13px] text-gypi-mute">Franco</span>}
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 text-[13px] text-gypi-dim">{diasActivos} días · {horas.toFixed(1)} horas por semana {changed && <Tag color={MARCA}>sin guardar</Tag>}</div>
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
          <button onClick={guardarYNotificar} disabled={saving} className={`w-full py-4 min-h-14 rounded-2xl border-none text-[15px] font-bold font-heading flex items-center justify-center gap-2 shadow-[0_8px_32px_color-mix(in_srgb,var(--color-empresa-primary)_19%,transparent)] ${saving ? "bg-gypi-surface text-gypi-dim cursor-default" : "bg-gypi-amber text-gypi-on-amber cursor-pointer"}`}>{saving ? "⏳ Guardando..." : `📤 Guardar y notificar ${totalCambios} empleado${totalCambios > 1 ? "s" : ""}`}</button>
        </div>
      )}

      <div className="text-center mt-4 text-xs text-gypi-mute">{empleados.length} empleados activos · {totalCambios} con cambios</div>
    </section>
  );
}
