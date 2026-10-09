import { useState, useEffect, useCallback } from "react";
import { sb } from "./lib/supabase";
import { hoyArg } from "./lib/dates";
import { Chip } from "./components/ui";

import { Button } from "./components/ui";
import { getDivisionesConTodas } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { useToast } from "./components/ui/Toast";

/* ═══ CONSTANTES ═══ */
const DIAS_SEMANA = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const DIAS_LABEL = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// Colores de las notas (R11). Se guarda el nombre ("verde"); las notas viejas
// tienen el color escrito en hexadecimal (16A34A) y se reconocen por esos seis dígitos.
const COLORES_NOTA = {
  marca: { nombre: "Color de la empresa", punto: "bg-gypi-amber", fondo: "bg-gypi-amber/10", borde: "border-gypi-amber" },
  verde: { nombre: "Verde", punto: "bg-gypi-green", fondo: "bg-gypi-green/10", borde: "border-gypi-green" },
  cian: { nombre: "Celeste", punto: "bg-gypi-cyan", fondo: "bg-gypi-cyan/10", borde: "border-gypi-cyan" },
  violeta: { nombre: "Violeta", punto: "bg-gypi-violet", fondo: "bg-gypi-violet/10", borde: "border-gypi-violet" },
  rojo: { nombre: "Rojo", punto: "bg-gypi-red", fondo: "bg-gypi-red/10", borde: "border-gypi-red" },
};
const COLOR_VIEJO = { "16a34a": "verde", "0891b2": "cian", "7c3aed": "violeta", "dc2626": "rojo" };
/** Clases del color de una nota, sea el nombre nuevo o el color viejo escrito. */
export function colorNota(valor) {
  if (COLORES_NOTA[valor]) return COLORES_NOTA[valor];
  const hex = String(valor || "").replace("#", "").toLowerCase();
  return COLORES_NOTA[COLOR_VIEJO[hex]] || COLORES_NOTA.marca;
}
const MARCA = "var(--color-empresa-primary)";

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
  const [color, setColor] = useState("marca");

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
                <div key={i} className={`p-2 rounded-lg mb-1.5 flex items-center gap-2 ${colorNota(n.color).fondo}`}>
                  <div className={`w-1 h-6 rounded-sm shrink-0 ${colorNota(n.color).punto}`} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-gypi-text">{n.texto}</div>
                    {emp && <div className="text-xs text-gypi-dim mt-0.5">{emp.apodo || emp.nombre}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Nueva nota */}
        <div className="mb-3">
          <label htmlFor="nota-empleado" className="g-label">Empleado (opcional)</label>
          <select id="nota-empleado" value={empId} onChange={e => setEmpId(e.target.value)} className="g-input cursor-pointer">
            <option value="">General (sin asignar)</option>
            {empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.id}>{e.apodo || e.nombre} (L-{e.legajo})</option>)}
          </select>
        </div>

        <div className="mb-3">
          <label htmlFor="nota-texto" className="g-label">Nota o tarea</label>
          <input id="nota-texto" value={texto} onChange={e => setTexto(e.target.value)} placeholder="Ej: Instalar mueble OT 7450" className="g-input" />
        </div>

        <div className="mb-4">
          <div className="g-label" id="nota-color">Color</div>
          <div className="flex gap-2" role="radiogroup" aria-labelledby="nota-color">
            {Object.entries(COLORES_NOTA).map(([clave, c]) => (
              <button key={clave} onClick={() => setColor(clave)} role="radio" aria-checked={color === clave} aria-label={c.nombre} className={`w-11 h-11 rounded-[10px] cursor-pointer flex items-center justify-center border-2 ${c.fondo} ${color === clave ? c.borde : "border-transparent"}`}>
                <div className={`w-4 h-4 rounded-full ${c.punto}`} />
              </button>
            ))}
          </div>
        </div>

        <Button size="lg" className="w-full" onClick={() => { if (texto.trim()) onSave({ fecha: fecha.toISOString().slice(0, 10), empleado_id: empId || null, texto: texto.trim(), color }); }} disabled={!texto.trim()} loading={saving}>
          {saving ? "Guardando..." : "Agregar nota"}
        </Button>
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
            <div className="text-xs font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Turnos asignados</div>
            {turnosDia.map((t, i) => {
              const emp = empleados.find(e => e.id === t.empleado_id);
              return (
                <div key={i} className="p-2 rounded-lg mb-1.5 flex items-center gap-2 bg-gypi-cyan/[0.06] border border-gypi-cyan/20">
                  <div className="w-1 h-6 rounded-sm shrink-0 bg-gypi-cyan" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-gypi-text">{emp?.nombre || "?"}</div>
                    <div className="text-xs text-gypi-dim mt-0.5">{t.hora_inicio?.slice(0,5)} — {t.hora_fin?.slice(0,5)}{t.nota ? ` · ${t.nota}` : ""}</div>
                  </div>
                  <button onClick={() => onDelete(t.id)} aria-label={`Sacar el turno de ${emp?.nombre || "este empleado"}`} className="w-11 h-11 text-sm rounded-md border-none cursor-pointer bg-gypi-red/10 text-gypi-red-ink">✕</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mb-3">
          <label htmlFor="turno-empleado" className="g-label">Empleado</label>
          <select id="turno-empleado" value={empId} onChange={e => setEmpId(e.target.value)} className="g-input cursor-pointer">
            <option value="">Seleccionar...</option>
            {empsDisponibles.map(e => <option key={e.id} value={e.id}>{e.nombre} (L-{e.legajo}) · {e.division || "sin div."}</option>)}
          </select>
        </div>

        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <label htmlFor="turno-entrada" className="g-label">Entrada</label>
            <input id="turno-entrada" type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} className="g-input" />
          </div>
          <div className="flex-1">
            <label htmlFor="turno-salida" className="g-label">Salida</label>
            <input id="turno-salida" type="time" value={horaFin} onChange={e => setHoraFin(e.target.value)} className="g-input" />
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="turno-nota" className="g-label">Nota (opcional)</label>
          <input id="turno-nota" value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: Cubrir a Juan" className="g-input" />
        </div>

        <Button size="lg" className="w-full" onClick={() => { if (empId) onSave({ fecha: fecha.toISOString().slice(0, 10), empleado_id: empId, hora_inicio: horaInicio, hora_fin: horaFin, nota: nota.trim() }); }} disabled={!empId} loading={saving}>
          {saving ? "Guardando..." : "Asignar turno"}
        </Button>
        {!empId && !saving && <div className="mt-2 text-center text-[12px] text-gypi-dim">Elegí a quién le asignás el turno.</div>}
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


  const guardarNota = async (nota) => {
    setSaving(true);
    try {
      const payload = empresaId ? { ...nota, empresa_id: empresaId } : nota;
      await sb.post("notas_calendario", payload);
      await cargarDatos();
      setSelectedDate(null);
      toast.success("✅ Nota agregada");
    } catch (e) {
      toast.error(`Error: ${e.message}`);
    } finally { setSaving(false); }
  };

  const guardarTurno = async (turno) => {
    setSaving(true);
    try {
      const payload = empresaId ? { ...turno, empresa_id: empresaId } : turno;
      await sb.post("turnos_planificados", payload);
      await cargarDatos();
      toast.success("✅ Turno asignado");
    } catch (e) {
      if (e.message?.includes("duplicate") || e.message?.includes("unique")) {
        toast.show("Ya tiene turno asignado ese día");
      } else {
        toast.error(`Error: ${e.message}`);
      }
    } finally { setSaving(false); }
  };

  const eliminarTurno = async (turnoId) => {
    try {
      await sb.del(`turnos_planificados?id=eq.${turnoId}`);
      await cargarDatos();
      toast.show("Turno eliminado");
    } catch (e) {
      toast.error(`Error: ${e.message}`);
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
        <button onClick={() => cambiarMes(-1)} aria-label="Mes anterior" className="w-12 h-12 rounded-[10px] bg-gypi-surface border-none text-gypi-text text-base cursor-pointer flex items-center justify-center">◀</button>
        <div className="text-center">
          <div className="font-heading text-xl font-bold text-gypi-text">{MESES[month]}</div>
          <div className="text-xs text-gypi-dim">{year}</div>
        </div>
        <button onClick={() => cambiarMes(1)} aria-label="Mes siguiente" className="w-12 h-12 rounded-[10px] bg-gypi-surface border-none text-gypi-text text-base cursor-pointer flex items-center justify-center">▶</button>
      </div>

      {/* Filtro división */}
      <div className="flex gap-1 mb-3 overflow-x-auto pb-0.5">
        {DIVISIONES.map(d => (
          <Chip key={d.id} active={filtroDivision === d.id} onClick={() => setFiltroDivision(d.id)} color={d.color || MARCA}>{d.label}</Chip>
        ))}
      </div>

      {loading ? (
        <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
      ) : (
        <>
          <p className="m-0 mb-2 text-[13px] text-gypi-dim">Tocá un día para ver quién trabaja y agregar un turno o una nota. <span className="whitespace-nowrap">👷 trabajan</span> · <span className="whitespace-nowrap">⏱ turnos extra</span> · <span className="whitespace-nowrap">● notas</span></p>
          {/* Headers días */}
          <div role="row" className="grid grid-cols-7 gap-0.5 mb-1">
            {DIAS_LABEL.map(d => (
              <div key={d} role="columnheader" className="text-center text-xs font-bold text-gypi-mute py-1 uppercase">{d}</div>
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
                <button key={dia} onClick={() => setVistaDetalle(vistaDetalle === dia ? null : dia)} aria-label={`${dia} de ${MESES[month]}${isHoy ? " (hoy)" : ""}: ${info.disponibles} trabajan${info.turnos.length ? `, ${info.turnos.length} turno${info.turnos.length > 1 ? "s" : ""}` : ""}${tieneNotas ? `, ${info.notas.length} nota${info.notas.length > 1 ? "s" : ""}` : ""}`} aria-pressed={vistaDetalle === dia} className={`py-1.5 px-0.5 rounded-[10px] cursor-pointer flex flex-col items-center gap-0.5 min-h-[52px] transition-all duration-150 ${isHoy ? "border-2 border-gypi-amber bg-gypi-amber/[0.07]" : vistaDetalle === dia ? "border-2 border-gypi-text bg-gypi-surface" : `border ${tieneNotas ? "border-gypi-border bg-gypi-cyan/[0.05]" : "border-gypi-border bg-gypi-surface"}`}`}>
                  <div className={`font-heading text-[14px] ${isHoy ? "font-extrabold text-gypi-amber-ink" : esFinDeSemana ? "font-semibold text-gypi-mute" : "font-semibold text-gypi-text"}`}>{dia}</div>
                  {info.disponibles > 0 && <div className="text-[11px] font-bold text-gypi-green-ink">{info.disponibles}👷</div>}
                  {info.turnos.length > 0 && <div className="text-[11px] font-bold text-gypi-cyan-ink">{info.turnos.length}⏱</div>}
                  {tieneNotas && (
                    <div className="flex gap-0.5" aria-hidden="true">
                      {info.notas.slice(0, 3).map((n, i) => <div key={i} className={`w-[5px] h-[5px] rounded-full ${colorNota(n.color).punto}`} />)}
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
                <div className="flex flex-col gap-2.5 mb-3">
                  <div>
                    <div className="text-sm font-bold font-heading text-gypi-text">{fechaLabel}</div>
                    <div className="text-[12px] text-gypi-dim mt-0.5">{info.disponibles} trabajan · {info.francos} de franco · {info.turnos.length} turno{info.turnos.length !== 1 ? "s" : ""} extra</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" className="flex-1" onClick={() => setTurnoDate(fecha)}>+ Turno</Button>
                    <Button size="sm" variant="secondary" className="flex-1" onClick={() => setSelectedDate(fecha)}>+ Nota</Button>
                  </div>
                </div>

                {info.turnos.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Turnos planificados</div>
                    {info.turnos.map((t, i) => {
                      const emp = empleados.find(e => e.id === t.empleado_id);
                      return (
                        <div key={i} className="p-2 rounded-lg mb-1.5 flex items-center gap-2 bg-gypi-cyan/[0.06] border-l-[3px] border-gypi-cyan">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-gypi-text">{emp?.nombre || "?"} <span className="font-normal text-gypi-dim">· {emp?.division || "sin div."}</span></div>
                            <div className="text-xs text-gypi-dim mt-0.5">{t.hora_inicio?.slice(0,5)} — {t.hora_fin?.slice(0,5)}{t.nota ? ` · ${t.nota}` : ""}</div>
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
                        <div key={i} className={`p-2 rounded-lg mb-1.5 border-l-[3px] ${colorNota(n.color).fondo} ${colorNota(n.color).borde}`}>
                          <div className="text-xs font-semibold text-gypi-text">{n.texto}</div>
                          {emp && <div className="text-xs text-gypi-dim mt-0.5">{emp.apodo || emp.nombre} · {emp.division || "general"}</div>}
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
                      <div key={emp.id} className={`py-1 px-2 rounded-md flex items-center gap-1 ${franco ? "bg-gypi-surf-hi" : "bg-gypi-green/10"}`}>
                        <div className={`w-[5px] h-[5px] rounded-full ${franco ? "bg-(--color-text-muted)" : "bg-gypi-green"}`} aria-hidden="true" />
                        <span className={`text-xs font-semibold ${franco ? "text-gypi-mute line-through" : "text-gypi-text"}`}>{emp.apodo || emp.nombre.split(" ")[0]}</span>
                        {horario && <span className="text-[11px] text-gypi-dim font-mono">{horario.in}</span>}
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
                <div className="font-heading text-xl font-bold text-gypi-green-ink">{empsFiltrados.filter(e => e.rol === "operativo").length}</div>
                <div className="text-[11px] text-gypi-dim">Operativos</div>
              </div>
              <div className="text-center">
                <div className="font-heading text-xl font-bold text-gypi-amber-ink">{notas.length}</div>
                <div className="text-[11px] text-gypi-dim">Notas</div>
              </div>
              <div className="text-center">
                <div className="font-heading text-xl font-bold text-gypi-cyan-ink">
                  {(() => {
                    let diasLab = 0;
                    for (let d = 1; d <= new Date(year, month + 1, 0).getDate(); d++) {
                      const dow = new Date(year, month, d).getDay();
                      if (dow > 0 && dow < 6) diasLab++;
                    }
                    return diasLab;
                  })()}
                </div>
                <div className="text-[11px] text-gypi-dim">Días hábiles</div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
