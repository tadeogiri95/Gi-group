import { useState, useEffect, useCallback } from "react";
import { C, fH, fB, fM, DIAS_KEY } from "./lib/theme";
import { sb } from "./lib/supabase";

/* ═══ CONSTANTES ═══ */
const DIAS_SEMANA = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const DIAS_LABEL = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const DIVISIONES = [
  { id: "todas", label: "Todas" },
  { id: "herreria", label: "🔥 Herrería", color: C.amber },
  { id: "muebles", label: "🪵 Muebles", color: C.green },
  { id: "aberturas", label: "🪟 Aberturas", color: C.cyan },
  { id: "general", label: "🏭 General", color: C.violet },
];

const Tag = ({ color = C.amber, children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px", borderRadius: 4, background: `${color}22`, color, fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: fB }}>{children}</span>
);
const Chip = ({ active, onClick, children, color = C.amber }) => (
  <button onClick={onClick} style={{ padding: "6px 10px", borderRadius: 16, border: "none", cursor: "pointer", background: active ? `${color}22` : C.surface, color: active ? color : C.dim, fontSize: 11, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap", transition: "all 0.15s" }}>{children}</button>
);

/* ═══ HELPERS ═══ */
function getDiasDelMes(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDay = first.getDay();
  const days = [];
  for (let i = 0; i < startDay; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(d);
  return days;
}

function isFranco(diagrama, fecha) {
  if (!diagrama) return false;
  const dia = DIAS_SEMANA[fecha.getDay()];
  return !diagrama[dia];
}

function getHorario(diagrama, fecha) {
  if (!diagrama) return null;
  const dia = DIAS_SEMANA[fecha.getDay()];
  return diagrama[dia] || null;
}

/* ═══ MODAL NOTA ═══ */
function ModalNota({ fecha, empleados, notas, onClose, onSave, saving }) {
  const [empId, setEmpId] = useState("");
  const [texto, setTexto] = useState("");
  const [color, setColor] = useState(C.amber);

  const fechaStr = fecha.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  const notasDelDia = notas.filter(n => n.fecha === fecha.toISOString().slice(0, 10));

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 460, background: C.bg, borderRadius: "20px 20px 0 0", padding: "20px 18px 30px", maxHeight: "80vh", overflowY: "auto", border: `1px solid ${C.border}` }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.mute, margin: "0 auto 16px" }} />
        <h3 style={{ margin: "0 0 4px", fontFamily: fH, fontSize: 18, fontWeight: 700, color: C.text }}>{fechaStr}</h3>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Planificá tareas o asignaciones para este día</div>

        {/* Notas existentes */}
        {notasDelDia.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {notasDelDia.map((n, i) => {
              const emp = empleados.find(e => e.id === n.empleado_id);
              return (
                <div key={i} style={{ padding: "8px 10px", borderRadius: 8, background: `${n.color || C.amber}12`, border: `1px solid ${n.color || C.amber}30`, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 4, height: 24, borderRadius: 2, background: n.color || C.amber, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{n.texto}</div>
                    {emp && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{emp.apodo || emp.nombre}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Nueva nota */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Empleado (opcional)</label>
          <select value={empId} onChange={e => setEmpId(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, fontFamily: fB, outline: "none" }}>
            <option value="">General (sin asignar)</option>
            {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{e.apodo || e.nombre} (L-{e.legajo})</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Nota / Tarea</label>
          <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Ej: Instalar mueble OT 7450" style={{ width: "100%", padding: "11px 14px", borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box" }} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Color</label>
          <div style={{ display: "flex", gap: 8 }}>
            {[C.amber, C.green, C.cyan, C.violet, C.red].map(c => (
              <button key={c} onClick={() => setColor(c)} style={{ width: 32, height: 32, borderRadius: 10, background: `${c}22`, border: `2px solid ${color === c ? c : "transparent"}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: 14, height: 14, borderRadius: 7, background: c }} />
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => { if (texto.trim()) onSave({ fecha: fecha.toISOString().slice(0, 10), empleado_id: empId || null, texto: texto.trim(), color }); }} disabled={!texto.trim() || saving} style={{
          width: "100%", padding: 14, borderRadius: 12, border: "none",
          background: texto.trim() && !saving ? C.amber : C.surface, color: texto.trim() && !saving ? "#000" : C.mute,
          fontSize: 15, fontWeight: 700, fontFamily: fH, cursor: texto.trim() && !saving ? "pointer" : "default",
        }}>
          {saving ? "Guardando..." : "Agregar nota"}
        </button>
      </div>
    </div>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function CalendarioScreen() {
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [empleados, setEmpleados] = useState([]);
  const [notas, setNotas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filtroDivision, setFiltroDivision] = useState("todas");
  const [vistaDetalle, setVistaDetalle] = useState(null); // fecha para ver detalle
  const [toast, setToast] = useState(null);

  const dias = getDiasDelMes(year, month);
  const hoyStr = hoy.toISOString().slice(0, 10);
  const mesStr = `${year}-${String(month + 1).padStart(2, "0")}`;

  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, notasDB] = await Promise.all([
        sb.get("empleados?activo=eq.true&select=id,nombre,apodo,legajo,division,area,rol,diagrama&order=nombre.asc"),
        sb.get(`notas_calendario?fecha=gte.${mesStr}-01&fecha=lte.${mesStr}-31&order=created_at.asc`),
      ]);
      setEmpleados(emps || []);
      setNotas(notasDB || []);
    } catch (e) {
      console.error(e);
      // Si la tabla notas_calendario no existe, seguir sin notas
      try { setEmpleados(await sb.get("empleados?activo=eq.true&select=id,nombre,apodo,legajo,division,area,rol,diagrama&order=nombre.asc") || []); } catch (e2) { }
      setNotas([]);
    } finally { setLoading(false); }
  }, [mesStr]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3500); };

  const guardarNota = async (nota) => {
    setSaving(true);
    try {
      await sb.post("notas_calendario", nota);
      await cargarDatos();
      setSelectedDate(null);
      showToast("✅ Nota agregada", C.green);
    } catch (e) {
      showToast(`Error: ${e.message}`, C.red);
    } finally { setSaving(false); }
  };

  const cambiarMes = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setMonth(m);
    setYear(y);
  };

  // Empleados filtrados por división
  const empsFiltrados = filtroDivision === "todas" ? empleados : empleados.filter(e => e.division === filtroDivision);

  // Info por día: cuántos trabajan, cuántos franco, notas
  const getInfoDia = (dia) => {
    if (!dia) return null;
    const fecha = new Date(year, month, dia);
    const fechaStr = fecha.toISOString().slice(0, 10);
    const notasDia = notas.filter(n => n.fecha === fechaStr);
    let trabajando = 0, francos = 0;
    empsFiltrados.forEach(emp => {
      if (emp.rol !== "operativo") return;
      if (isFranco(emp.diagrama, fecha)) francos++;
      else trabajando++;
    });
    return { trabajando, francos, notas: notasDia, fecha, fechaStr };
  };

  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px", position: "relative" }}>
      {toast && <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 999, padding: "12px 20px", borderRadius: 12, background: C.bg, border: `1px solid ${toast.color}40`, boxShadow: `0 8px 32px ${toast.color}20`, fontSize: 13, fontWeight: 600, color: toast.color, animation: "fadeIn 0.25s ease", maxWidth: "90%" }}>{toast.msg}</div>}

      {selectedDate && <ModalNota fecha={selectedDate} empleados={empleados} notas={notas} onClose={() => setSelectedDate(null)} onSave={guardarNota} saving={saving} />}

      {/* Navegación mes */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <button onClick={() => cambiarMes(-1)} style={{ width: 36, height: 36, borderRadius: 10, background: C.surface, border: "none", color: C.text, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>◀</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: fH, fontSize: 20, fontWeight: 700, color: C.text }}>{MESES[month]}</div>
          <div style={{ fontSize: 12, color: C.dim }}>{year}</div>
        </div>
        <button onClick={() => cambiarMes(1)} style={{ width: 36, height: 36, borderRadius: 10, background: C.surface, border: "none", color: C.text, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
      </div>

      {/* Filtro división */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
        {DIVISIONES.map(d => (
          <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || C.cyan}>{d.label}</Chip>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: C.dim, fontSize: 13 }}>Cargando calendario...</div>
      ) : (
        <>
          {/* Headers días */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {DIAS_LABEL.map(d => (
              <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: C.mute, padding: "4px 0", textTransform: "uppercase" }}>{d}</div>
            ))}
          </div>

          {/* Grid del mes */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 16 }}>
            {dias.map((dia, idx) => {
              if (!dia) return <div key={`e-${idx}`} />;
              const info = getInfoDia(dia);
              const isHoy = info.fechaStr === hoyStr;
              const tieneNotas = info.notas.length > 0;
              const esFinDeSemana = new Date(year, month, dia).getDay() === 0 || new Date(year, month, dia).getDay() === 6;

              return (
                <button key={dia} onClick={() => setVistaDetalle(vistaDetalle === dia ? null : dia)} style={{
                  padding: "6px 2px", borderRadius: 10, border: isHoy ? `2px solid ${C.amber}` : `1px solid ${C.border}`,
                  background: isHoy ? `${C.amber}12` : tieneNotas ? `${C.cyan}08` : C.surface,
                  cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  minHeight: 52, transition: "all 0.15s",
                }}>
                  <div style={{ fontSize: 14, fontWeight: isHoy ? 800 : 600, color: isHoy ? C.amber : esFinDeSemana ? C.mute : C.text, fontFamily: fH }}>{dia}</div>
                  {info.trabajando > 0 && <div style={{ fontSize: 8, fontWeight: 700, color: C.green }}>{info.trabajando}👷</div>}
                  {tieneNotas && (
                    <div style={{ display: "flex", gap: 2 }}>
                      {info.notas.slice(0, 3).map((n, i) => <div key={i} style={{ width: 5, height: 5, borderRadius: 3, background: n.color || C.amber }} />)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Detalle del día seleccionado */}
          {vistaDetalle && (() => {
            const info = getInfoDia(vistaDetalle);
            const fecha = new Date(year, month, vistaDetalle);
            const fechaLabel = fecha.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

            return (
              <div style={{ background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: fH, color: C.text }}>{fechaLabel}</div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{info.trabajando} trabajando · {info.francos} franco</div>
                  </div>
                  <button onClick={() => setSelectedDate(fecha)} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: `${C.amber}22`, color: C.amber, fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: "pointer" }}>+ Nota</button>
                </div>

                {/* Notas del día */}
                {info.notas.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    {info.notas.map((n, i) => {
                      const emp = empleados.find(e => e.id === n.empleado_id);
                      return (
                        <div key={i} style={{ padding: "8px 10px", borderRadius: 8, background: `${n.color || C.amber}10`, borderLeft: `3px solid ${n.color || C.amber}`, marginBottom: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{n.texto}</div>
                          {emp && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{emp.apodo || emp.nombre} · {emp.division || "general"}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Quién trabaja ese día */}
                <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Personal del día</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {empsFiltrados.filter(e => e.rol === "operativo").map(emp => {
                    const franco = isFranco(emp.diagrama, fecha);
                    const horario = getHorario(emp.diagrama, fecha);
                    return (
                      <div key={emp.id} style={{ padding: "4px 8px", borderRadius: 6, background: franco ? `${C.mute}15` : `${C.green}12`, display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 5, height: 5, borderRadius: 3, background: franco ? C.mute : C.green }} />
                        <span style={{ fontSize: 10, fontWeight: 600, color: franco ? C.mute : C.text }}>{emp.apodo || emp.nombre.split(" ")[0]}</span>
                        {horario && <span style={{ fontSize: 9, color: C.dim, fontFamily: fM }}>{horario.in}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Resumen rápido del mes */}
          <div style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Resumen del mes</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: fH, fontSize: 20, fontWeight: 700, color: C.green }}>{empsFiltrados.filter(e => e.rol === "operativo").length}</div>
                <div style={{ fontSize: 9, color: C.dim }}>Operativos</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: fH, fontSize: 20, fontWeight: 700, color: C.amber }}>{notas.length}</div>
                <div style={{ fontSize: 9, color: C.dim }}>Notas</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: fH, fontSize: 20, fontWeight: 700, color: C.cyan }}>
                  {(() => {
                    let diasLab = 0;
                    for (let d = 1; d <= new Date(year, month + 1, 0).getDate(); d++) {
                      const dow = new Date(year, month, d).getDay();
                      if (dow > 0 && dow < 6) diasLab++;
                    }
                    return diasLab;
                  })()}
                </div>
                <div style={{ fontSize: 9, color: C.dim }}>Días hábiles</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
