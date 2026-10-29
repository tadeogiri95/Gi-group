"use client";
// app/components/SelectorSemana.jsx — Cambiar la SEMANA de una OT desde Gypi
// (Tadeo, 29/10; migración 144). Va en Planificación ② y en el Detalle OT.
// Se guarda en la OT y el script del Plan de trabajo la anota en la columna
// SEMANA; mientras no llegue, se ve "⏳ falta pasar a la planilla".
import { useState } from "react";
import { sb } from "../lib/supabase";
import { opcionesSemana, cambioSemana, pendientePlanilla } from "../lib/semanaEditable";

export default function SelectorSemana({ proyecto, modo, hoy, onCambio, compacto = false }) {
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  if (modo === "entrega") return null; // la fecha objetivo sale de ENTREGA, no de la semana
  const actual = Number(proyecto.semana_objetivo) || null;
  const opciones = opcionesSemana(hoy, modo, actual);
  const elegir = async (valor) => {
    if (!valor || Number(valor) === actual) return;
    const cambio = cambioSemana(proyecto, valor, { modo, hoy });
    setGuardando(true);
    setAviso(null);
    try {
      await sb.patch(`proyectos?id=eq.${proyecto.id}`, cambio);
      onCambio?.({ id: proyecto.id, ...cambio });
    } catch (e) {
      setAviso(/semana_app|semana_planilla/.test(String(e.message)) ? "Para cambiar la semana falta correr la migración 144 en Supabase." : `No se pudo guardar: ${e.message}`);
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className={compacto ? "" : "mb-3"}>
      <label className="flex items-center gap-2 text-xs text-gypi-dim">
        <span className="shrink-0">Semana</span>
        <select aria-label={`Semana de la OT ${proyecto.ot}`} value={actual || ""} disabled={guardando}
          onChange={(e) => elegir(e.target.value)} className="g-input text-xs py-1 min-h-9 flex-1 min-w-0">
          {!actual && <option value="">Sin semana</option>}
          {opciones.map((o) => <option key={o.semana} value={o.semana}>{o.texto}</option>)}
        </select>
      </label>
      {pendientePlanilla(proyecto) && <div className="text-xs text-gypi-amber-ink mt-0.5">⏳ Cambiada en Gypi, falta pasar a la planilla</div>}
      {aviso && <div role="alert" className="text-xs text-gypi-red mt-0.5">{aviso}</div>}
    </div>
  );
}
