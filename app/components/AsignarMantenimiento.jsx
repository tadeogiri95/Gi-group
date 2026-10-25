'use client';
// app/components/AsignarMantenimiento.jsx — Quién atiende el mantenimiento de
// un vehículo o una máquina (Mantenimiento, parte 34; migración 133): su
// responsable y un suplente opcional, elegidos entre los empleados marcados
// "Responsable de mantenimiento" (Equipo → editar empleado). Los dos lo ven
// en su Inicio, en "🔧 Mi mantenimiento".
import { useState } from "react";
import { opcionesResponsable } from "../lib/mantenimiento";

export default function AsignarMantenimiento({ responsableId = null, suplenteId = null, empleados = [], editable = false, onGuardar }) {
  const [editando, setEditando] = useState(false);
  const [resp, setResp] = useState(responsableId || "");
  const [sup, setSup] = useState(suplenteId || "");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const nombre = (id) => empleados.find((e) => e.id === id)?.nombre || null;
  const opciones = opcionesResponsable(empleados, [responsableId, suplenteId]);

  const guardar = async () => {
    if (resp && resp === sup) { setError("El suplente tiene que ser otra persona"); return; }
    setEnviando(true);
    setError(null);
    try {
      await onGuardar({ responsable_id: resp || null, suplente_id: resp ? sup || null : null });
      setEditando(false);
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  if (editando) {
    return (
      <div className="p-2.5 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
        {!opciones.length && (
          <div className="text-[13px] text-gypi-dim mb-2">Todavía no hay nadie marcado. En Equipo, editá al empleado y marcá "Responsable de mantenimiento".</div>
        )}
        <label className="g-label" htmlFor="mant-resp">Responsable</label>
        <select id="mant-resp" className="g-input w-full mb-2" value={resp} onChange={(e) => setResp(e.target.value)}>
          <option value="">Sin responsable</option>
          {opciones.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <label className="g-label" htmlFor="mant-sup">Suplente (opcional)</label>
        <select id="mant-sup" className="g-input w-full mb-2" value={sup} disabled={!resp} onChange={(e) => setSup(e.target.value)}>
          <option value="">Sin suplente</option>
          {opciones.filter((e) => e.id !== resp).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
        <div className="flex gap-2">
          <button onClick={() => { setEditando(false); setError(null); }} className="g-btn g-btn-secondary flex-1">Cancelar</button>
          <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2.5 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface flex items-center gap-2">
      <div className="flex-1 min-w-0 text-[14px]">
        {responsableId ? (
          <>
            <div className="font-semibold">🔧 {nombre(responsableId) || "Responsable"}</div>
            <div className="text-[12px] text-gypi-dim">{suplenteId ? `Suplente: ${nombre(suplenteId) || "—"}` : "Sin suplente"}</div>
          </>
        ) : (
          <div className="text-gypi-dim">Sin responsable de mantenimiento</div>
        )}
      </div>
      {editable && (
        <button onClick={() => { setResp(responsableId || ""); setSup(suplenteId || ""); setEditando(true); }} className="g-btn g-btn-secondary">
          {responsableId ? "Cambiar" : "Elegir"}
        </button>
      )}
    </div>
  );
}
