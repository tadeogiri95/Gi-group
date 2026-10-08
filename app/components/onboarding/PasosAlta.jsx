"use client";
// Pasos nuevos del asistente de alta (ítem 24): planta, horario tipo y primera OT.
import { useState } from "react";
import { DIAS, DIAS_LABEL, textoHorario } from "../../lib/onboarding";

/* ─── Planta / ubicación ─── */
export function PasoPlanta({ planta, setPlanta }) {
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [estado, setEstado] = useState("");

  const buscar = async () => {
    if (busqueda.trim().length < 4) return;
    setEstado("Buscando…");
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(busqueda.trim())}`);
      const d = await r.json().catch(() => []);
      const lista = Array.isArray(d) ? d.slice(0, 5) : [];
      setResultados(lista);
      setEstado(lista.length ? "" : (d?.error || "No encontramos esa dirección. Probá con calle, número y ciudad."));
    } catch {
      setEstado("No se pudo buscar. Probá de nuevo.");
    }
  };

  const aca = () => {
    if (!navigator.geolocation) { setEstado("Este dispositivo no tiene GPS."); return; }
    setEstado("Pidiendo tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPlanta((p) => ({ ...p, lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6), direccion: "Ubicación actual de este dispositivo" }));
        setEstado("");
      },
      () => setEstado("No pudimos leer tu ubicación. Revisá el permiso del navegador o buscá la dirección."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const elegir = (r) => {
    setPlanta((p) => ({ ...p, lat: +r.lat.toFixed(6), lng: +r.lng.toFixed(6), direccion: r.label }));
    setResultados([]);
  };

  return (
    <>
      <h2 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">¿Dónde trabaja tu equipo?</h2>
      <p className="text-xs text-gypi-dim mb-3.5">Con la ubicación de la planta, solo se puede fichar estando ahí. Si trabajan en distintos lugares, saltá este paso.</p>
      <div className="g-card mb-3">
        <label className="g-label" htmlFor="planta-nombre">Nombre del lugar</label>
        <input id="planta-nombre" value={planta.nombre} onChange={(e) => setPlanta((p) => ({ ...p, nombre: e.target.value.slice(0, 60) }))} className="g-input w-full mb-3" placeholder="Planta" />

        <label className="g-label" htmlFor="planta-dir">Dirección</label>
        <div className="flex gap-1.5 mb-2">
          <input id="planta-dir" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscar()} className="g-input flex-1" placeholder="Calle 123, Ciudad" />
          <button onClick={buscar} className="px-3 rounded-lg border border-gypi-border bg-gypi-surf-hi text-gypi-text text-xs font-semibold cursor-pointer">Buscar</button>
        </div>
        <button onClick={aca} className="w-full py-2.5 mb-2 rounded-[10px] border border-gypi-border bg-transparent text-gypi-text text-xs font-semibold cursor-pointer">📍 Estoy en la planta: usar mi ubicación</button>
        {resultados.map((r, i) => (
          <button key={i} onClick={() => elegir(r)} className="block w-full text-left p-2 mb-1 rounded-lg border border-gypi-border bg-gypi-surface text-gypi-text text-[11px] cursor-pointer">{r.label}</button>
        ))}
        {estado && <div role="status" className="text-[11px] text-gypi-dim">{estado}</div>}
        {planta.lat != null && (
          <div className="mt-2 p-2.5 rounded-lg bg-gypi-green/10 text-[11px] text-gypi-text">
            ✅ {planta.direccion}
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor="planta-radio" className="text-gypi-dim">Se puede fichar a menos de</label>
              <select id="planta-radio" value={planta.radio} onChange={(e) => setPlanta((p) => ({ ...p, radio: Number(e.target.value) }))} className="g-input !py-1 !px-2 text-[11px]">
                {[100, 150, 200, 300, 500].map((m) => <option key={m} value={m}>{m} m</option>)}
              </select>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ─── Horario tipo ─── */
export function PasoHorario({ horario, setHorario, usarHorario, setUsarHorario }) {
  const toggleDia = (d) => setHorario((h) => ({ ...h, dias: h.dias.includes(d) ? h.dias.filter((x) => x !== d) : [...h.dias, d] }));
  return (
    <>
      <h2 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">Horario de trabajo</h2>
      <p className="text-xs text-gypi-dim mb-3.5">Se lo asignamos al equipo que cargues en el paso siguiente. Después podés cambiarlo por persona en Horarios.</p>
      <div className="g-card mb-3">
        <label className="flex items-center gap-2 text-xs text-gypi-text mb-3 cursor-pointer">
          <input type="checkbox" checked={usarHorario} onChange={(e) => setUsarHorario(e.target.checked)} />
          Todos trabajan con el mismo horario
        </label>
        {usarHorario && <>
          <div className="g-label">Días</div>
          <div className="flex gap-1 mb-3 flex-wrap">
            {DIAS.map((d) => (
              <button key={d} onClick={() => toggleDia(d)} aria-pressed={horario.dias.includes(d)}
                className={`min-w-[42px] min-h-[40px] rounded-lg border text-xs font-bold cursor-pointer ${horario.dias.includes(d) ? "border-gypi-amber bg-gypi-amber/10 text-gypi-amber-ink" : "border-gypi-border bg-transparent text-gypi-dim"}`}>
                {DIAS_LABEL[d]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gypi-dim">Entrada
              <input type="time" value={horario.entrada} onChange={(e) => setHorario((h) => ({ ...h, entrada: e.target.value }))} className="g-input w-full mt-1" />
            </label>
            <label className="text-xs text-gypi-dim">Salida
              <input type="time" value={horario.salida} onChange={(e) => setHorario((h) => ({ ...h, salida: e.target.value }))} className="g-input w-full mt-1" />
            </label>
          </div>
          <div className="text-[11px] text-gypi-dim mt-2">{textoHorario(horario)}{horario.salida < horario.entrada ? " (turno noche)" : ""}</div>
        </>}
      </div>
    </>
  );
}

/* ─── Primera OT ─── */
export function PasoOT({ ot, setOt }) {
  const cambiar = (k) => (e) => setOt((o) => ({ ...o, [k]: e.target.value.slice(0, 80) }));
  return (
    <>
      <h2 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">Tu primera orden de trabajo</h2>
      <p className="text-xs text-gypi-dim mb-3.5">Los operarios cargan sus tareas contra una OT (un pedido, una obra, un cliente). Si no trabajan por OT, saltá este paso.</p>
      <div className="g-card mb-3 flex flex-col gap-2">
        <label className="text-xs text-gypi-dim">Número de OT
          <input value={ot.ot} onChange={cambiar("ot")} className="g-input w-full mt-1" placeholder="Ej: 1001" />
        </label>
        <label className="text-xs text-gypi-dim">Cliente
          <input value={ot.cliente} onChange={cambiar("cliente")} className="g-input w-full mt-1" placeholder="Ej: Constructora Sur" />
        </label>
        <label className="text-xs text-gypi-dim">Qué es
          <input value={ot.proyecto} onChange={cambiar("proyecto")} className="g-input w-full mt-1" placeholder="Ej: Portón corredizo" />
        </label>
      </div>
    </>
  );
}
