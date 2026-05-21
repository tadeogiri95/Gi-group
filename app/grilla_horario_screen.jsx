import { useState, useEffect, useCallback } from "react";
import { C, fH, fB, fM } from "./lib/theme";
import { sb } from "./lib/supabase";

/* ═══ CONSTANTES ═══ */
const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIAS_L = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
const DIAS_FULL = { lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo" };
const DEFAULT_IN = "08:30";
const DEFAULT_OUT = "17:30";

const DIVISIONES = [
  { id: "todas", label: "Todos" },
  { id: "herreria", label: "🔥 Herrería", color: C.amber },
  { id: "muebles", label: "🪵 Muebles", color: C.green },
  { id: "aberturas", label: "🪟 Aberturas", color: C.cyan },
  { id: "general", label: "🏭 General", color: C.violet },
];

/* ═══ PRIMITIVAS ═══ */
const Tag = ({ color = C.amber, children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: `${color}22`, color, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: fB }}>{children}</span>
);
const Chip = ({ active, onClick, children, color = C.amber }) => (
  <button onClick={onClick} style={{ padding: "7px 12px", borderRadius: 20, border: "none", cursor: "pointer", background: active ? `${color}22` : C.surface, color: active ? color : C.dim, fontSize: 11, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap", transition: "all 0.15s" }}>{children}</button>
);

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
  const parts = DIAS.map(d => row[d] ? `${DIAS_L[d]} ${row[d].in}-${row[d].out}` : `${DIAS_L[d]} Franco`);
  return parts.join(" · ");
};

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function GrillaHorarioScreen() {
  // State
  const [empleados, setEmpleados] = useState([]);
  const [grilla, setGrilla] = useState({});
  const [original, setOriginal] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Modo asignación masiva
  const [modo, setModo] = useState("individual"); // individual | masivo
  const [horarioMasivo, setHorarioMasivo] = useState(() => {
    const h = {};
    DIAS.forEach(d => { h[d] = (d === "sab" || d === "dom") ? null : { in: DEFAULT_IN, out: DEFAULT_OUT }; });
    return h;
  });
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [filtroDivision, setFiltroDivision] = useState("todas");

  // Individual mode
  const [expandedId, setExpandedId] = useState(null);

  // ── Cargar datos ──
  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const emps = await sb.get("empleados?activo=eq.true&order=nombre.asc&select=id,nombre,apodo,legajo,area,division,rol,diagrama,horas_semanales");
      // Solo operativos de producción y logística
      const filtered = (emps || []).filter(e => e.rol === "operativo" && (e.area === "produccion" || e.area === "logistica"));
      setEmpleados(filtered);
      const g = {}, o = {};
      (emps || []).forEach(e => {
        const diag = e.diagrama || {};
        const row = {};
        DIAS.forEach(d => { row[d] = diag[d] ? { in: diag[d].in || DEFAULT_IN, out: diag[d].out || DEFAULT_OUT } : null; });
        g[e.id] = row;
        o[e.id] = JSON.parse(JSON.stringify(row));
      });
      setGrilla(g);
      setOriginal(o);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const tienesCambios = (id) => JSON.stringify(grilla[id]) !== JSON.stringify(original[id]);
  const totalCambios = empleados.filter(e => tienesCambios(e.id)).length;

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3500); };

  // ── Individual: editar un día ──
  const setHorario = (empId, dia, campo, valor) => {
    setGrilla(p => { const c = { ...p }; const row = { ...c[empId] }; if (!row[dia]) row[dia] = { in: DEFAULT_IN, out: DEFAULT_OUT }; row[dia] = { ...row[dia], [campo]: valor }; c[empId] = row; return c; });
  };
  const toggleFranco = (empId, dia) => {
    setGrilla(p => { const c = { ...p }; const row = { ...c[empId] }; row[dia] = row[dia] ? null : { in: DEFAULT_IN, out: DEFAULT_OUT }; c[empId] = row; return c; });
  };
  const aplicarDefault = (empId) => {
    setGrilla(p => { const c = { ...p }; const row = {}; DIAS.forEach(d => { row[d] = (d === "sab" || d === "dom") ? null : { in: DEFAULT_IN, out: DEFAULT_OUT }; }); c[empId] = row; return c; });
  };

  // ── Masivo: toggle día ──
  const toggleDiaMasivo = (dia) => {
    setHorarioMasivo(p => ({ ...p, [dia]: p[dia] ? null : { in: DEFAULT_IN, out: DEFAULT_OUT } }));
  };
  const setHorarioMasivoField = (dia, campo, valor) => {
    setHorarioMasivo(p => {
      if (!p[dia]) return p;
      return { ...p, [dia]: { ...p[dia], [campo]: valor } };
    });
  };

  // ── Masivo: toggle selección empleado ──
  const toggleEmpleado = (id) => {
    setSeleccionados(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const seleccionarTodosFiltrados = () => {
    const ids = empsFiltrados.map(e => e.id);
    const allSelected = ids.every(id => seleccionados.has(id));
    if (allSelected) setSeleccionados(p => { const n = new Set(p); ids.forEach(id => n.delete(id)); return n; });
    else setSeleccionados(p => { const n = new Set(p); ids.forEach(id => n.add(id)); return n; });
  };

  // ── Masivo: aplicar horario a seleccionados ──
  const aplicarMasivo = () => {
    if (seleccionados.size === 0) { showToast("Seleccioná al menos un empleado", C.amber); return; }
    setGrilla(p => {
      const c = { ...p };
      seleccionados.forEach(id => { c[id] = JSON.parse(JSON.stringify(horarioMasivo)); });
      return c;
    });
    showToast(`✅ Horario aplicado a ${seleccionados.size} empleado${seleccionados.size > 1 ? "s" : ""}`, C.green);
  };

  // ── Guardar y notificar ──
  const guardarYNotificar = async () => {
    const cambios = empleados.filter(e => tienesCambios(e.id));
    if (!cambios.length) { showToast("No hay cambios para guardar", C.amber); return; }
    setSaving(true);
    let ok = 0;
    for (const emp of cambios) {
      const row = grilla[emp.id];
      const diagrama = {};
      DIAS.forEach(d => { diagrama[d] = row[d] ? { in: row[d].in, out: row[d].out } : null; });
      const horas = calcHoras(row);
      try {
        await sb.patch(`empleados?id=eq.${emp.id}`, { diagrama, horas_semanales: Math.round(horas) });
        await sb.post("notificaciones", { destinatario_rol: String(emp.legajo), tipo: "info", asunto: "📅 Horario actualizado", detalle: fmtHorario(row), urgencia: "normal" });
        try { await fetch("/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legajo: String(emp.legajo), title: "📅 Horario actualizado", body: "Tu grilla horaria fue modificada. Revisá tu nuevo horario.", data: { tag: "horario-update" } }) }); } catch (e) { }
        ok++;
      } catch (e) { console.error(e); }
    }
    setOriginal(JSON.parse(JSON.stringify(grilla)));
    setSeleccionados(new Set());
    showToast(`✅ ${ok} horario${ok > 1 ? "s" : ""} guardado${ok > 1 ? "s" : ""} y notificado${ok > 1 ? "s" : ""}`, C.green);
    setSaving(false);
  };

  // ── Filtrar por división ──
  const empsFiltrados = filtroDivision === "todas" ? empleados : empleados.filter(e => e.division === filtroDivision);

  // ── Render ──
  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px", position: "relative" }}>

      {toast && <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 999, padding: "12px 20px", borderRadius: 12, background: C.bg, border: `1px solid ${toast.color}40`, boxShadow: `0 8px 32px ${toast.color}20`, fontSize: 13, fontWeight: 600, color: toast.color, animation: "fadeIn 0.25s ease", maxWidth: "90%" }}>{toast.msg}</div>}

      {/* Modo toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 14, background: C.surface, borderRadius: 12, padding: 3, border: `1px solid ${C.border}` }}>
        <button onClick={() => setModo("masivo")} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", cursor: "pointer", background: modo === "masivo" ? C.cyan : "transparent", color: modo === "masivo" ? "#000" : C.dim, fontSize: 13, fontWeight: 700, fontFamily: fH, transition: "all 0.2s" }}>⚡ Asignación masiva</button>
        <button onClick={() => setModo("individual")} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", cursor: "pointer", background: modo === "individual" ? C.amber : "transparent", color: modo === "individual" ? "#000" : C.dim, fontSize: 13, fontWeight: 700, fontFamily: fH, transition: "all 0.2s" }}>✏️ Individual</button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: C.dim, fontSize: 13 }}>Cargando personal...</div>
      ) : modo === "masivo" ? (
        /* ═══ MODO MASIVO ═══ */
        <>
          {/* Paso 1: definir horario */}
          <div style={{ background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.cyan}30`, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.cyan, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>① Definí el horario</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {DIAS.map(d => {
                const activo = !!horarioMasivo[d];
                return (
                  <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                    <button onClick={() => toggleDiaMasivo(d)} style={{ width: 34, height: 20, borderRadius: 10, border: "none", background: activo ? C.green : C.mute, cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                      <div style={{ width: 16, height: 16, borderRadius: 8, background: "#fff", position: "absolute", top: 2, left: activo ? 16 : 2, transition: "left 0.2s" }} />
                    </button>
                    <span style={{ width: 34, fontSize: 12, fontWeight: 700, fontFamily: fH, color: activo ? C.text : C.mute }}>{DIAS_L[d]}</span>
                    {activo ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                        <input type="time" value={horarioMasivo[d].in} onChange={e => setHorarioMasivoField(d, "in", e.target.value)} style={{ background: C.surfHi, border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 6px", color: C.text, fontSize: 13, fontFamily: fM, fontWeight: 600, outline: "none", width: 82 }} />
                        <span style={{ color: C.dim, fontSize: 11 }}>→</span>
                        <input type="time" value={horarioMasivo[d].out} onChange={e => setHorarioMasivoField(d, "out", e.target.value)} style={{ background: C.surfHi, border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 6px", color: C.text, fontSize: 13, fontFamily: fM, fontWeight: 600, outline: "none", width: 82 }} />
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: C.mute, fontWeight: 600 }}>Franco</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: C.dim }}>
              {calcHoras(horarioMasivo).toFixed(1)}h/semana · {DIAS.filter(d => horarioMasivo[d]).length} días
            </div>
          </div>

          {/* Paso 2: seleccionar empleados */}
          <div style={{ background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.cyan, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>② Seleccioná empleados</div>
              <Tag color={seleccionados.size > 0 ? C.amber : C.dim}>{seleccionados.size} seleccionados</Tag>
            </div>

            {/* Filtro por división */}
            <div style={{ display: "flex", gap: 4, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
              {DIVISIONES.map(d => (
                <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || C.cyan}>{d.label}</Chip>
              ))}
            </div>

            {/* Seleccionar todos */}
            <button onClick={seleccionarTodosFiltrados} style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: `1px dashed ${C.border}`, background: "transparent", color: C.cyan, fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: "pointer", marginBottom: 8 }}>
              {empsFiltrados.every(e => seleccionados.has(e.id)) && empsFiltrados.length > 0 ? "✕ Deseleccionar todos" : `☑ Seleccionar todos (${empsFiltrados.length})`}
            </button>

            {/* Lista de empleados */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
              {empsFiltrados.map(emp => {
                const sel = seleccionados.has(emp.id);
                const changed = tienesCambios(emp.id);
                return (
                  <button key={emp.id} onClick={() => toggleEmpleado(emp.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${sel ? `${C.cyan}40` : C.border}`, background: sel ? `${C.cyan}10` : "transparent", cursor: "pointer", fontFamily: fB, textAlign: "left", transition: "all 0.15s" }}>
                    <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${sel ? C.cyan : C.mute}`, background: sel ? C.cyan : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#000", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      {sel && "✓"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emp.apodo || emp.nombre}</div>
                      <div style={{ fontSize: 10, color: C.dim }}>L-{emp.legajo}</div>
                    </div>
                    {changed && <Tag color={C.amber}>Editado</Tag>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Paso 3: aplicar */}
          <button onClick={aplicarMasivo} disabled={seleccionados.size === 0} style={{
            width: "100%", padding: 14, borderRadius: 14, border: "none",
            background: seleccionados.size > 0 ? `linear-gradient(135deg, ${C.cyan}, ${C.green})` : C.surface,
            color: seleccionados.size > 0 ? "#000" : C.mute,
            fontSize: 15, fontWeight: 700, fontFamily: fH, cursor: seleccionados.size > 0 ? "pointer" : "default",
            marginBottom: 10,
          }}>
            ⚡ Aplicar horario a {seleccionados.size || "..."} empleado{seleccionados.size !== 1 ? "s" : ""}
          </button>
        </>
      ) : (
        /* ═══ MODO INDIVIDUAL ═══ */
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
            {DIVISIONES.map(d => (
              <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || C.amber}>{d.label}</Chip>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {empsFiltrados.map(emp => {
              const isExp = expandedId === emp.id;
              const changed = tienesCambios(emp.id);
              const row = grilla[emp.id] || {};
              const horas = calcHoras(row);
              const diasActivos = DIAS.filter(d => row[d]).length;

              return (
                <div key={emp.id} style={{ background: C.surface, borderRadius: 14, border: `1px solid ${changed ? `${C.amber}40` : C.border}`, overflow: "hidden" }}>
                  {/* Header colapsable */}
                  <button onClick={() => setExpandedId(isExp ? null : emp.id)} style={{ width: "100%", padding: "12px 14px", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontFamily: fB, textAlign: "left" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emp.apodo || emp.nombre}</div>
                      <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>L-{emp.legajo} · {diasActivos}d · {horas.toFixed(1)}h/sem</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {changed && <Tag color={C.amber}>Editado</Tag>}
                      <span style={{ color: C.dim, fontSize: 12, transform: isExp ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s" }}>▶</span>
                    </div>
                  </button>

                  {/* Mini preview */}
                  {!isExp && (
                    <div style={{ padding: "0 14px 10px", display: "flex", gap: 3 }}>
                      {DIAS.map(d => (
                        <div key={d} style={{ flex: 1, textAlign: "center", padding: "3px 0", borderRadius: 5, fontSize: 8, fontWeight: 700, fontFamily: fM, background: row[d] ? `${C.green}15` : `${C.mute}10`, color: row[d] ? C.green : C.mute, textTransform: "uppercase" }}>{DIAS_L[d]}</div>
                      ))}
                    </div>
                  )}

                  {/* Expanded edit */}
                  {isExp && (
                    <div style={{ padding: "0 14px 14px" }}>
                      <button onClick={() => aplicarDefault(emp.id)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: `${C.cyan}22`, color: C.cyan, fontSize: 11, fontWeight: 700, fontFamily: fB, cursor: "pointer", marginBottom: 10 }}>🔄 Default L-V</button>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {DIAS.map(d => {
                          const activo = !!row[d];
                          return (
                            <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: activo ? `${C.green}08` : C.surfLo, border: `1px solid ${activo ? `${C.green}20` : C.border}` }}>
                              <span style={{ width: 30, fontSize: 11, fontWeight: 700, fontFamily: fH, color: activo ? C.text : C.mute }}>{DIAS_L[d]}</span>
                              <button onClick={() => toggleFranco(emp.id, d)} style={{ width: 34, height: 18, borderRadius: 9, border: "none", background: activo ? C.green : C.mute, cursor: "pointer", position: "relative", flexShrink: 0 }}>
                                <div style={{ width: 14, height: 14, borderRadius: 7, background: "#fff", position: "absolute", top: 2, left: activo ? 18 : 2, transition: "left 0.2s" }} />
                              </button>
                              {activo ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
                                  <input type="time" value={row[d].in} onChange={e => setHorario(emp.id, d, "in", e.target.value)} style={{ background: C.surfHi, border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 5px", color: C.text, fontSize: 12, fontFamily: fM, outline: "none", width: 78 }} />
                                  <span style={{ color: C.dim, fontSize: 10 }}>→</span>
                                  <input type="time" value={row[d].out} onChange={e => setHorario(emp.id, d, "out", e.target.value)} style={{ background: C.surfHi, border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 5px", color: C.text, fontSize: 12, fontFamily: fM, outline: "none", width: 78 }} />
                                </div>
                              ) : (
                                <span style={{ fontSize: 11, color: C.mute }}>Franco</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 11, color: C.dim }}>{diasActivos} días · {horas.toFixed(1)}h/semana {changed && <Tag color={C.amber}>sin guardar</Tag>}</div>
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
        <div style={{ position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)", zIndex: 50, maxWidth: 440, width: "calc(100% - 36px)" }}>
          <button onClick={guardarYNotificar} disabled={saving} style={{
            width: "100%", padding: 16, borderRadius: 16, border: "none",
            background: saving ? C.surface : `linear-gradient(135deg, ${C.amber}, ${C.violet})`,
            color: saving ? C.dim : "#000",
            fontSize: 15, fontWeight: 700, fontFamily: fH, cursor: saving ? "default" : "pointer",
            boxShadow: `0 8px 32px ${C.amber}30`,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            {saving ? "⏳ Guardando..." : `📤 Guardar y notificar ${totalCambios} empleado${totalCambios > 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: 16, fontSize: 10, color: C.mute }}>
        {empleados.length} empleados activos · {totalCambios} con cambios
      </div>
    </div>
  );
}
