'use client';
// app/components/PausaOt.jsx — ⏸ Poner en pausa / ▶ Reanudar una OT desde su
// detalle (Tadeo, 02/11; migración 151; app/lib/pausaOt.js). La ponen y la
// sacan gerencia, supervisores y administración; los demás solo ven si está
// en pausa. Mientras está en pausa no suma tiempo: el lead time no cuenta
// esas horas y la OT sale del plan vivo, del Gantt y de los avisos.
import { useState } from "react";
import { sb } from "../lib/supabase";
import { MOTIVOS_PAUSA, validarPausa, textoMotivoPausa, pausasDe, diasEnPausa, textoDias, AVISO_MIGRACION_151 } from "../lib/pausaOt";
import { Chip } from "./ui";

const fechaHora = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/**
 * @param {{ ot: string, pausas?: object[], puedePausar?: boolean, usuarioNombre?: string|null, onCambio?: () => void }} props
 *   pausas: las pausas de la empresa (o de la OT); onCambio: para volver a leerlas
 */
export default function PausaOt({ ot, pausas = [], puedePausar = false, usuarioNombre = null, onCambio }) {
  // Lo guardado acá se ve sin esperar a que se vuelvan a leer
  const [propias, setPropias] = useState(null);
  const lista = propias ?? pausasDe(pausas, ot);
  const abierta = lista.find((p) => !p.hasta) || null;
  const [form, setForm] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const dias = diasEnPausa(lista, ot);
  const nombre = usuarioNombre ? String(usuarioNombre).slice(0, 120) : null;

  if (!ot || (!lista.length && !puedePausar)) return null;

  const pausar = async () => {
    const fila = { ot: String(ot), motivo: motivo || null, detalle: detalle.trim() || null, creado_nombre: nombre };
    const err = validarPausa(fila);
    if (err) { setError(err); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await sb.post("pausas_ot", fila);
      const nueva = { ...fila, ...(Array.isArray(r) ? r[0] : r || {}), desde: (Array.isArray(r) ? r[0]?.desde : r?.desde) || new Date().toISOString(), hasta: null };
      setPropias([nueva, ...lista]);
      setForm(false);
      setMotivo("");
      setDetalle("");
      onCambio?.();
    } catch (e) {
      const m = String(e?.message || e);
      setError(/pausas_ot/.test(m) && /exist|PGRST205|42P01|find/i.test(m) ? AVISO_MIGRACION_151
        : /uq_pausas_ot_abierta|duplicate/i.test(m) ? "Esta OT ya está en pausa. Cerrá el detalle y volvé a abrirlo." : `No se pudo guardar: ${m}`);
    }
    setGuardando(false);
  };

  const reanudar = async () => {
    const id = abierta?.id ?? pausasDe(pausas, ot).find((p) => !p.hasta)?.id;
    if (!id) { setError("Cerrá el detalle y volvé a abrirlo para reanudar."); return; }
    setGuardando(true);
    setError(null);
    const cambio = { hasta: new Date().toISOString(), reanudada_nombre: nombre };
    try {
      await sb.patch(`pausas_ot?id=eq.${id}&hasta=is.null`, cambio);
      setPropias(lista.map((p) => (p === abierta ? { ...p, ...cambio } : p)));
      onCambio?.();
    } catch (e) {
      setError(`No se pudo guardar: ${e?.message || e}`);
    }
    setGuardando(false);
  };

  return (
    <section className={`mb-4 rounded-xl p-3 border ${abierta ? "border-gypi-amber bg-gypi-amber/10" : "border-gypi-border bg-gypi-surface"}`} aria-label="Pausa de la OT">
      {abierta ? (
        <>
          <div className="text-[15px] font-bold text-gypi-amber-ink">⏸ En pausa desde el {fechaHora(abierta.desde)}</div>
          <div className="text-[13px] mt-0.5">{textoMotivoPausa(abierta)}{abierta.creado_nombre ? ` · la puso ${abierta.creado_nombre}` : ""}</div>
          <div className="text-xs text-gypi-dim mt-1">No suma tiempo de trabajo: está fuera del plan y del Gantt, no manda avisos y el lead time no cuenta estas horas.</div>
          {puedePausar && (
            <button type="button" onClick={reanudar} disabled={guardando} className="g-btn g-btn-primary w-full mt-2">
              {guardando ? "Guardando…" : "▶ Reanudar la OT"}
            </button>
          )}
        </>
      ) : form ? (
        <>
          <div className="text-[15px] font-bold mb-1">⏸ Poner la OT {ot} en pausa</div>
          <div className="text-xs text-gypi-dim mb-2">Para cuando el proyecto queda en suspenso y se para la producción. Sale del plan y del Gantt, y no suma tiempo hasta que la reanudes. La fecha de entrega no cambia sola.</div>
          <div className="g-label">Motivo</div>
          <div className="flex flex-wrap gap-1.5 mb-2" role="radiogroup" aria-label="Motivo de la pausa">
            {MOTIVOS_PAUSA.map((m) => (
              <Chip key={m.id} role="radio" aria-checked={motivo === m.id} active={motivo === m.id} onClick={() => setMotivo(m.id)}>{m.label}</Chip>
            ))}
          </div>
          <label className="g-label" htmlFor={`pausa-detalle-${ot}`}>{motivo === "otros" ? "¿Cuál?" : "Nota (si querés)"}</label>
          <input id={`pausa-detalle-${ot}`} className="g-input w-full mb-2" maxLength={300} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
          {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setForm(false); setError(null); }} disabled={guardando} className="g-btn flex-1">Cancelar</button>
            <button type="button" onClick={pausar} disabled={guardando} className="g-btn g-btn-primary flex-1">{guardando ? "Guardando…" : "⏸ Poner en pausa"}</button>
          </div>
        </>
      ) : (
        puedePausar && (
          <button type="button" onClick={() => setForm(true)} className="g-btn w-full">⏸ Poner en pausa</button>
        )
      )}
      {!form && error && <div role="alert" className="text-[13px] text-gypi-red mt-2">{error}</div>}
      {dias > 0 && (
        <div className="text-xs text-gypi-dim mt-2">
          Estuvo {textoDias(dias)} en pausa en total. Si hace falta, corregí la fecha de entrega.
        </div>
      )}
      {lista.filter((p) => p.hasta).length > 0 && (
        <ul className="list-none m-0 p-0 mt-2 flex flex-col gap-1">
          {lista.filter((p) => p.hasta).map((p) => (
            <li key={p.id ?? p.desde} className="text-xs text-gypi-dim">
              ⏸ {fechaHora(p.desde)} → ▶ {fechaHora(p.hasta)} · {textoMotivoPausa(p)}{p.reanudada_nombre ? ` · reanudó ${p.reanudada_nombre}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
