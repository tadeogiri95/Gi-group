import { useState, useEffect, useCallback } from "react";
import { C } from "./lib/theme";
import { sb } from "./lib/supabase";
import { hoyArg } from "./lib/dates";
import { Chip } from "./components/ui";
import { getDivisionesConTodas } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { useToast } from "./components/ui/Toast";

/* ═══ CONSTANTES ═══ */
const DIAS_SEMANA = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const DIAS_LABEL = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

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
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={`Nota para ${fechaStr}`}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] max-h-[80vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" aria-hidden="true" />
        <h3 className="m-0 mb-1 font-heading text-lg font-bold text-gypi-text">{fechaStr}</h3>
        <div className="text-xs text-gypi-dim mb-4">Planificá tareas o asignaciones para este día</div>

        {notasDelDia.length > 0 && (
          <div className="mb-4">
            {notasDelDia.map((n, i) => {
              const emp = empleados.find(e => e.id === n.empleado_id);
              return (
                <div key={i} className="p-2 rounded-lg mb-1.5 flex items-center gap-2" style={{ background: `${n.color || C.amber}12`, border: `1px solid ${n.color || C.amber}30` }}>
                  <div className="w-1 h-6 rounded-sm shrink-0" style={{ background: n.color || C.amber }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-gypi-text">{n.texto}</div>
                    {emp && <div className="text-[10px] text-gypi-dim mt-0.5">{emp.apodo || emp.nombre}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Nueva nota */}
        <div className="mb-3">
          <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Empleado (opcional)</label>
          <select value={empId} onChange={e => setEmpId(e.target.value)} className="w-full p-2.5 rounded-[10px] bg-gypi-surface border border-gypi-border text-gypi-text text-[13px] font-body outline-none">
            <option value="">General (sin asignar)</option>
            {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{e.apodo || e.nombre} (L-{e.legajo})</option>)}
          </select>
        </div>

        <div className="mb-3">
          <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Nota / Tarea</label>
          <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Ej: Instalar mueble OT 7450" className="w-full py-[11px] px-3.5 rounded-[10px] bg-gypi-surface border border-gypi-border text-gypi-text text-sm font-body outline-none box-border" />
        </div>

        <div className="mb-4">
          <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Color</label>
          <div className="flex gap-2">
            {[C.amber, C.green, C.cyan, C.violet, C.red].map(c => (
              <button key={c} onClick={() => setColor(c)} className="w-8 h-8 rounded-[10px] cursor-pointer flex items-center justify-center" style={{ background: `${c}22`, border: `2px solid ${color === c ? c : "transparent"}` }}>
                <div className="w-3.5 h-3.5 rounded-full" style={{ background: c }} />
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => { if (texto.trim()) onSave({ fecha: fecha.toISOString().slice(0, 10), empleado_id: empId || null, texto: texto.trim(), color }); }} disabled={!texto.trim() || saving} className="w-full p-3.5 rounded-xl border-none text-[15px] font-bold font-heading cursor-pointer" style={{
          background: texto.trim() && !saving ? C.amber : C.surface,
          color: texto.trim() && !saving ? "#000" : C.mute,
        }}>
          {saving ? "Guardando..." : "Agregar nota"}
        </button>
      </div>
    </div>
  );
}

/* ═══ MODAL TURNO ═══ */
function ModalTurno({ fecha, empleados, turnos, onClose, onSave, onDelete, saving }) {
  const [empId, setEmpId] = useState("");
  const [horaInicio, setHoraInicio] = useState("08:00");
  const [horaFin, setHoraFin] = useState("17:00");
  const [nota, setNota] = useState("");

  const fechaStr = fecha.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  const turnosDia = turnos.filter(t => t.fecha === fecha.toISOString().slice(0, 10));
  const empsDisponibles = empleados.filter(e => e.activo !== false && !turnosDia.some(t => t.empleado_id === e.id));

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Planificar turno">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] max-h-[80vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" aria-hidden="true" />
        <h3 className="m-0 mb-1 font-heading text-lg font-bold text-gypi-text">Planificar turno</h3>
        <div className="text-xs text-gypi-dim mb-4">{fechaStr}</div>

        {turnosDia.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Turnos asignados</div>
            {turnosDia.map((t, i) => {
              const emp = empleados.find(e => e.id === t.empleado_id);
              return (
                <div key={i} className="p-2 rounded-lg mb-1.5 flex items-center gap-2" style={{ background: `${C.cyan}10`, border: `1px solid ${C.cyan}25` }}>
                  <div className="w-1 h-6 rounded-sm shrink-0" style={{ background: C.cyan }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-gypi-text">{emp?.nombre || "?"}</div>
                    <div className="text-[10px] text-gypi-dim mt-0.5">{t.hora_inicio?.slice(0,5)} — {t.hora_fin?.slice(0,5)}{t.nota ? ` · ${t.nota}` : ""}</div>
                  </div>
                  <button onClick={() => onDelete(t.id)} aria-label="Eliminar turno" className="text-[10px] px-2 py-1 rounded-md border-none cursor-pointer" style={{ background: `${C.red}15`, color: C.red }}>✕</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mb-3">
          <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Empleado *</label>
          <select value={empId} onChange={e => setEmpId(e.target.value)} className="w-full p-2.5 rounded-[10px] bg-gypi-surface border border-gypi-border text-gypi-text text-[13px] font-body outline-none">
            <option value="">Seleccionar...</option>
            {empsDisponibles.map(e => <option key={e.id} value={e.id}>{e.nombre} (L-{e.legajo}) · {e.division || "sin div."}</option>)}
          </select>
        </div>

        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Entrada</label>
            <input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} className="w-full p-2.5 rounded-[10px] bg-gypi-surface border border-gypi-border text-gypi-text text-[13px] font-body outline-none" />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Salida</label>
            <input type="time" value={horaFin} onChange={e => setHoraFin(e.target.value)} className="w-full p-2.5 rounded-[10px] bg-gypi-surface border border-gypi-border text-gypi-text text-[13px] font-body outline-none" />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Nota (opcional)</label>
          <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: Cubrir a Juan" className="w-full py-[11px] px-3.5 rounded-[10px] bg-gypi-surface border border-gypi-border text-gypi-text text-sm font-body outline-none box-border" />
        </div>

        <button onClick={() => { if (empId) onSave({ fecha: fecha.toISOString().slice(0, 10), empleado_id: empId, hora_inicio: horaInicio, hora_fin: horaFin, nota: nota.trim() }); }} disabled={!empId || saving} className="w-full p-3.5 rounded-xl border-none text-[15px] font-bold font-heading cursor-pointer" style={{
          background: empId && !saving ? C.cyan : C.surface,
          color: empId && !saving ? "#000" : C.mute,
        }}>
          {saving ? "Guardando..." : "Asignar turno"}
        </button>
      </div>
    </div>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function CalendarioScreen({ empresaId }) {
  const { divisiones: divisionesCtx } = useAuth();
  const DIVISIONES = getDivisionesConTodas(divisionesCtx);
  const [year, setYear] = useState(() => Number(hoyArg().slice(0, 4)));
  const [month, setMonth] = useState(() => Number(hoyArg().slice(5, 7)) - 1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [turnoDate, setTurnoDate] = useState(null);
  const [empleados, setEmpleados] = useState([]);
  const [notas, setNotas] = useState([]);
  const [turnos, setTurnos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filtroDivision, setFiltroDivision] = useState("todas");
  const [vistaDetalle, setVistaDetalle] = useState(null);
  const toast = useToast();

  const dias = getDiasDelMes(year, month);
  const hoyStr = hoyArg();
  const mesStr = `${year}-${String(month + 1).padStart(2, "0")}`;
  // Último día real del mes (e.g. junio=30, no 31)
  const ultimoDiaMes = String(new Date(year, month + 1, 0).getDate()).padStart(2, "0");

  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const empQ = empresaId
        ? `empleados?activo=eq.true&empresa_id=eq.${empresaId}&select=id,nombre,apodo,legajo,division,area,rol,diagrama&order=nombre.asc`
        : "empleados?activo=eq.true&select=id,nombre,apodo,legajo,division,area,rol,diagrama&order=nombre.asc";
      const notasQ = empresaId
        ? `notas_calendario?empresa_id=eq.${empresaId}&fecha=gte.${mesStr}-01&fecha=lte.${mesStr}-${ultimoDiaMes}&order=created_at.asc`
        : `notas_calendario?fecha=gte.${mesStr}-01&fecha=lte.${mesStr}-${ultimoDiaMes}&order=created_at.asc`;
      const turnosQ = empresaId
        ? `turnos_planificados?empresa_id=eq.${empresaId}&fecha=gte.${mesStr}-01&fecha=lte.${mesStr}-${ultimoDiaMes}&order=hora_inicio.asc`
        : `turnos_planificados?fecha=gte.${mesStr}-01&fecha=lte.${mesStr}-${ultimoDiaMes}&order=hora_inicio.asc`;
      const [emps, notasDB, turnosDB] = await Promise.all([sb.get(empQ), sb.get(notasQ), sb.get(turnosQ).catch(() => [])]);
      setEmpleados(emps || []);
      setNotas(notasDB || []);
      setTurnos(turnosDB || []);
    } catch (e) {
      console.error(e);
      try {
        const empQ = empresaId
          ? `empleados?activo=eq.true&empresa_id=eq.${empresaId}&select=id,nombre,apodo,legajo,division,area,rol,diagrama&order=nombre.asc`
          : "empleados?activo=eq.true&select=id,nombre,apodo,legajo,division,area,rol,diagrama&order=nombre.asc";
        setEmpleados(await sb.get(empQ) || []);
      } catch (e2) { }
      setNotas([]);
      setTurnos([]);
    } finally { setLoading(false); }
  }, [mesStr, empresaId]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const showToast = (msg, color) => toast.show(msg, color);

  const guardarNota = async (nota) => {
    setSaving(true);
    try {
      const payload = empresaId ? { ...nota, empresa_id: empresaId } : nota;
      await sb.post("notas_calendario", payload);
      await cargarDatos();
      setSelectedDate(null);
      showToast("✅ Nota agregada", C.green);
    } catch (e) {
      showToast(`Error: ${e.message}`, C.red);
    } finally { setSaving(false); }
  };

  const guardarTurno = async (turno) => {
    setSaving(true);
    try {
      const payload = empresaId ? { ...turno, empresa_id: empresaId } : turno;
      await sb.post("turnos_planificados", payload);
      await cargarDatos();
      showToast("✅ Turno asignado", C.cyan);
    } catch (e) {
      if (e.message?.includes("duplicate") || e.message?.includes("unique")) {
        showToast("Ya tiene turno asignado ese día", C.amber);
      } else {
        showToast(`Error: ${e.message}`, C.red);
      }
    } finally { setSaving(false); }
  };

  const eliminarTurno = async (turnoId) => {
    try {
      await sb.del(`turnos_planificados?id=eq.${turnoId}`);
      await cargarDatos();
      showToast("Turno eliminado", C.mute);
    } catch (e) {
      showToast(`Error: ${e.message}`, C.red);
    }
  };

  const cambiarMes = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setMonth(m);
    setYear(y);
  };

  const empsFiltrados = filtroDivision === "todas" ? empleados : empleados.filter(e => e.division === filtroDivision);

  const getInfoDia = (dia) => {
    if (!dia) return null;
    const fecha = new Date(year, month, dia);
    const fechaStr = fecha.toISOString().slice(0, 10);
    const notasDia = notas.filter(n => n.fecha === fechaStr);
    const turnosDia = turnos.filter(t => t.fecha === fechaStr);
    let trabajando = 0, francos = 0;
    empsFiltrados.forEach(emp => {
      if (emp.rol !== "operativo") return;
      if (isFranco(emp.diagrama, fecha)) francos++;
      else trabajando++;
    });
    const disponibles = trabajando + turnosDia.filter(t => {
      const emp = empsFiltrados.find(e => e.id === t.empleado_id);
      return emp && isFranco(emp.diagrama, fecha);
    }).length;
    return { trabajando, francos, disponibles, notas: notasDia, turnos: turnosDia, fecha, fechaStr };
  };

  return (
    <section className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px] relative" aria-label="Calendario">


      {selectedDate && <ModalNota fecha={selectedDate} empleados={empleados} notas={notas} onClose={() => setSelectedDate(null)} onSave={guardarNota} saving={saving} />}
      {turnoDate && <ModalTurno fecha={turnoDate} empleados={empleados} turnos={turnos} onClose={() => setTurnoDate(null)} onSave={guardarTurno} onDelete={eliminarTurno} saving={saving} />}

      {/* Navegación mes */}
      <div className="flex justify-between items-center mb-3.5">
        <button onClick={() => cambiarMes(-1)} aria-label="Mes anterior" className="w-9 h-9 rounded-[10px] bg-gypi-surface border-none text-gypi-text text-base cursor-pointer flex items-center justify-center">◀</button>
        <div className="text-center">
          <div className="font-heading text-xl font-bold text-gypi-text">{MESES[month]}</div>
          <div className="text-xs text-gypi-dim">{year}</div>
        </div>
        <button onClick={() => cambiarMes(1)} aria-label="Mes siguiente" className="w-9 h-9 rounded-[10px] bg-gypi-surface border-none text-gypi-text text-base cursor-pointer flex items-center justify-center">▶</button>
      </div>

      {/* Filtro división */}
      <div className="flex gap-1 mb-3 overflow-x-auto pb-0.5">
        {DIVISIONES.map(d => (
          <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || C.cyan}>{d.label}</Chip>
        ))}
      </div>

      {loading ? (
        <div className="gypi-dots"><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /></div>
      ) : (
        <>
          {/* Headers días */}
          <div role="row" className="grid grid-cols-7 gap-0.5 mb-1">
            {DIAS_LABEL.map(d => (
              <div key={d} role="columnheader" className="text-center text-[10px] font-bold text-gypi-mute py-1 uppercase">{d}</div>
            ))}
          </div>

          {/* Grid del mes */}
          <div className="grid grid-cols-7 gap-[3px] mb-4">
            {dias.map((dia, idx) => {
              if (!dia) return <div key={`e-${idx}`} />;
              const info = getInfoDia(dia);
              const isHoy = info.fechaStr === hoyStr;
              const tieneNotas = info.notas.length > 0;
              const esFinDeSemana = new Date(year, month, dia).getDay() === 0 || new Date(year, month, dia).getDay() === 6;

              return (
                <button key={dia} onClick={() => setVistaDetalle(vistaDetalle === dia ? null : dia)} aria-label={`${dia} de ${MESES[month]}${isHoy ? ' (hoy)' : ''}`} aria-pressed={vistaDetalle === dia} className="py-1.5 px-0.5 rounded-[10px] cursor-pointer flex flex-col items-center gap-0.5 min-h-[52px] transition-all duration-150" style={{
                  border: isHoy ? `2px solid ${C.amber}` : `1px solid ${C.border}`,
                  background: isHoy ? `${C.amber}12` : tieneNotas ? `${C.cyan}08` : C.surface,
                }}>
                  <div className="font-heading" style={{ fontSize: 14, fontWeight: isHoy ? 800 : 600, color: isHoy ? C.amber : esFinDeSemana ? C.mute : C.text }}>{dia}</div>
                  {info.disponibles > 0 && <div className="text-[8px] font-bold" style={{ color: C.green }}>{info.disponibles}👷</div>}
                  {info.turnos.length > 0 && <div className="text-[8px] font-bold" style={{ color: C.cyan }}>{info.turnos.length}⏱</div>}
                  {tieneNotas && (
                    <div className="flex gap-0.5">
                      {info.notas.slice(0, 3).map((n, i) => <div key={i} className="w-[5px] h-[5px] rounded-full" style={{ background: n.color || C.amber }} />)}
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
              <div className="bg-gypi-surface rounded-2xl p-4 border border-gypi-border mb-3.5">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <div className="text-sm font-bold font-heading text-gypi-text">{fechaLabel}</div>
                    <div className="text-[11px] text-gypi-dim mt-0.5">{info.disponibles} disponibles · {info.francos} franco · {info.turnos.length} turno{info.turnos.length !== 1 ? "s" : ""}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setTurnoDate(fecha)} className="py-2 px-3.5 rounded-[10px] border-none text-xs font-bold font-body cursor-pointer" style={{ background: `${C.cyan}22`, color: C.cyan }}>+ Turno</button>
                    <button onClick={() => setSelectedDate(fecha)} className="py-2 px-3.5 rounded-[10px] border-none text-xs font-bold font-body cursor-pointer" style={{ background: `${C.amber}22`, color: C.amber }}>+ Nota</button>
                  </div>
                </div>

                {info.turnos.length > 0 && (
                  <div className="mb-3">
                    <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Turnos planificados</div>
                    {info.turnos.map((t, i) => {
                      const emp = empleados.find(e => e.id === t.empleado_id);
                      return (
                        <div key={i} className="p-2 rounded-lg mb-1.5 flex items-center gap-2" style={{ background: `${C.cyan}10`, borderLeft: `3px solid ${C.cyan}` }}>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-gypi-text">{emp?.nombre || "?"} <span className="font-normal text-gypi-dim">· {emp?.division || "sin div."}</span></div>
                            <div className="text-[10px] text-gypi-dim mt-0.5">{t.hora_inicio?.slice(0,5)} — {t.hora_fin?.slice(0,5)}{t.nota ? ` · ${t.nota}` : ""}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {info.notas.length > 0 && (
                  <div className="mb-3">
                    {info.notas.map((n, i) => {
                      const emp = empleados.find(e => e.id === n.empleado_id);
                      return (
                        <div key={i} className="p-2 rounded-lg mb-1.5" style={{ background: `${n.color || C.amber}10`, borderLeft: `3px solid ${n.color || C.amber}` }}>
                          <div className="text-xs font-semibold text-gypi-text">{n.texto}</div>
                          {emp && <div className="text-[10px] text-gypi-dim mt-0.5">{emp.apodo || emp.nombre} · {emp.division || "general"}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-2">Personal del día</div>
                <div className="flex flex-wrap gap-1">
                  {empsFiltrados.filter(e => e.rol === "operativo").map(emp => {
                    const franco = isFranco(emp.diagrama, fecha);
                    const horario = getHorario(emp.diagrama, fecha);
                    return (
                      <div key={emp.id} className="py-1 px-2 rounded-md flex items-center gap-1" style={{ background: franco ? `${C.mute}15` : `${C.green}12` }}>
                        <div className="w-[5px] h-[5px] rounded-full" style={{ background: franco ? C.mute : C.green }} />
                        <span className="text-[10px] font-semibold" style={{ color: franco ? C.mute : C.text }}>{emp.apodo || emp.nombre.split(" ")[0]}</span>
                        {horario && <span className="text-[9px] text-gypi-dim font-mono">{horario.in}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Resumen rápido del mes */}
          <div className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border">
            <div className="text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-2">Resumen del mes</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <div className="font-heading text-xl font-bold text-gypi-green">{empsFiltrados.filter(e => e.rol === "operativo").length}</div>
                <div className="text-[9px] text-gypi-dim">Operativos</div>
              </div>
              <div className="text-center">
                <div className="font-heading text-xl font-bold text-gypi-amber">{notas.length}</div>
                <div className="text-[9px] text-gypi-dim">Notas</div>
              </div>
              <div className="text-center">
                <div className="font-heading text-xl font-bold text-gypi-cyan">
                  {(() => {
                    let diasLab = 0;
                    for (let d = 1; d <= new Date(year, month + 1, 0).getDate(); d++) {
                      const dow = new Date(year, month, d).getDay();
                      if (dow > 0 && dow < 6) diasLab++;
                    }
                    return diasLab;
                  })()}
                </div>
                <div className="text-[9px] text-gypi-dim">Días hábiles</div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
