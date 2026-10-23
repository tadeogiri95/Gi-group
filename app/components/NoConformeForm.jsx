'use client';
// app/components/NoConformeForm.jsx — Registrar una pieza con defecto
// (Órdenes de Producción, parte 6; ítem 39). Es el "sticker rojo" del mapa de
// procesos: código de defecto, pieza, cantidad y etapa de origen. La decisión
// la toma después el encargado.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { defectosDe } from "../lib/calidad";

export default function NoConformeForm({ ot, etapaDetecta = null, etapas = [], defectos = [], onClose, onCreada }) {
  const lista = defectosDe(defectos);
  const productivas = etapas.filter((e) => e.codigo > 0);
  const [defecto, setDefecto] = useState(null);
  const [origen, setOrigen] = useState("");
  const [pieza, setPieza] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const elegir = (d) => {
    setDefecto(d.cod);
    // Propone la etapa donde suele originarse ese defecto
    if (d.origen && productivas.some((e) => e.codigo === d.origen)) setOrigen(String(d.origen));
  };

  const n = Number(cantidad);
  const cantidadValida = Number.isInteger(n) && n >= 1 && n <= 9999;

  const guardar = async () => {
    if (!defecto || !cantidadValida) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/no-conformidades", {
        method: "POST",
        body: JSON.stringify({
          accion: "crear", ot: String(ot), defecto,
          pieza: pieza.trim() || null, cantidad: n,
          etapa_detecta: etapaDetecta || null,
          etapa_origen: origen ? Number(origen) : null,
          nota: nota.trim() || null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo guardar");
      onCreada?.(data.no_conformidad);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center" role="dialog" aria-label="Pieza con defecto">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[560px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[90vh] overflow-y-auto border border-gypi-border text-gypi-text">
        <div className="flex items-start gap-3 mb-3">
          <h3 className="m-0 flex-1 font-heading text-lg font-bold">Pieza con defecto · OT {ot}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="min-w-[44px] min-h-[44px] bg-transparent border-none text-2xl cursor-pointer text-gypi-text">✕</button>
        </div>

        <div className="g-label mb-1.5">¿Qué defecto tiene?</div>
        <div className="flex flex-col gap-1.5 mb-3.5" role="radiogroup" aria-label="Defecto">
          {lista.map((d) => (
            <button key={d.cod} role="radio" aria-checked={defecto === d.cod} onClick={() => elegir(d)}
              className={`flex items-center gap-2.5 min-h-[48px] px-3 rounded-xl border text-left text-[13px] cursor-pointer ${defecto === d.cod ? "bg-gypi-red/10 border-gypi-red text-gypi-text" : "bg-gypi-surface border-gypi-border text-gypi-text"}`}>
              <span className="w-10 font-mono font-bold text-gypi-red">{d.cod}</span>
              <span className="flex-1">{d.nombre}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <label className="g-label" htmlFor="nc-pieza">Pieza (opcional)</label>
            <input id="nc-pieza" className="g-input" maxLength={80} value={pieza} onChange={(e) => setPieza(e.target.value)} placeholder="Ej: M.izq-41" />
          </div>
          <div className="w-[96px]">
            <label className="g-label" htmlFor="nc-cantidad">Cantidad</label>
            <input id="nc-cantidad" className="g-input" inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
          </div>
        </div>

        {productivas.length > 0 && (
          <div className="mb-3">
            <label className="g-label" htmlFor="nc-origen">¿En qué etapa se originó?</label>
            <select id="nc-origen" className="g-input cursor-pointer" value={origen} onChange={(e) => setOrigen(e.target.value)}>
              <option value="">No sé</option>
              {productivas.map((e) => <option key={e.codigo} value={e.codigo}>{e.nombre}</option>)}
            </select>
          </div>
        )}

        <label className="g-label" htmlFor="nc-nota">Nota (opcional)</label>
        <input id="nc-nota" className="g-input mb-3.5" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} />

        {error && <div role="alert" className="text-[12px] text-gypi-red mb-2">{error}</div>}
        <button onClick={guardar} disabled={guardando || !defecto || !cantidadValida} className="g-btn g-btn-primary w-full">
          {guardando ? "Guardando…" : defecto ? "Registrar pieza no conforme" : "Elegí el defecto"}
        </button>
        <div className="text-xs text-gypi-dim mt-2">Llevá la pieza a la zona de no conformes. El encargado decide qué se hace.</div>
      </div>
    </div>
  );
}
