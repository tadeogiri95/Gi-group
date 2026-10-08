"use client";
import { useState } from "react";
import { sb } from "../../lib/supabase";
import { Ic } from "../Icons";
import { useConfirm } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";

// Reglas del asistente (chat). Las reglas de asistencia y los tipos de pedido
// están aparte (AsistenciaReglasScreen): no dependen de tener el Asistente (U-03).
export default function ReglasScreen({ ctx, reload }) {
  const [nr, setNr] = useState("");
  const [confirmar, ConfirmDialog] = useConfirm();
  const toast = useToast();
  const add = async () => {
    if (!nr.trim()) return;
    try { await sb.post("reglas_bot", { regla: nr.trim() }); setNr(""); reload(); }
    catch { toast.error("No se pudo guardar la regla. Probá de nuevo."); }
  };
  const del = async (id) => {
    if (!await confirmar("El asistente deja de seguir esta regla.", { title: "¿Borrar la regla?", confirmLabel: "Borrar", destructive: true })) return;
    try { await sb.del(`reglas_bot?id=eq.${id}`); reload(); }
    catch { toast.error("No se pudo borrar la regla. Probá de nuevo."); }
  };
  const hasText = nr.trim().length > 0;

  return (
    <div className="px-[18px] pb-[110px] overflow-y-auto flex-1">
      {/* Header card */}
      <div className="rounded-card p-4 border border-gypi-border mb-3.5 bg-gradient-to-br from-gypi-violet/[0.07] to-gypi-surface">
        <div className="g-overline text-gypi-violet">Reglas del asistente</div>
        <div className="text-[13px] text-gypi-text mt-1.5 leading-relaxed">Los cambios se aplican al asistente en el momento.</div>
      </div>

      {/* Rules list */}
      <div className="flex flex-col gap-2 mb-[18px]">
        {(ctx.reglasRaw || []).length === 0 ? (
          <div className="bg-gypi-surface rounded-card py-7 px-5 text-center border border-gypi-border">
            <div className="text-[28px] mb-2">🤖</div>
            <div className="text-[13px] font-bold text-gypi-text mb-1">Sin reglas configuradas</div>
            <div className="text-xs text-gypi-dim leading-relaxed">Agregá instrucciones para que el asistente responda como quiere tu empresa.</div>
          </div>
        ) : (ctx.reglasRaw || []).map((r, i) => (
          <div key={r.id} className="bg-gypi-surface rounded-xl p-3.5 border border-gypi-border flex gap-2.5">
            <div className="w-6 h-6 rounded-[7px] bg-gypi-amber/10 text-gypi-amber-ink flex items-center justify-center font-mono text-[11px] font-bold shrink-0">{i + 1}</div>
            <div className="flex-1 text-[13px] text-gypi-text leading-snug">{r.regla}</div>
            <button onClick={() => del(r.id)} aria-label={`Borrar la regla ${i + 1}`} className="min-w-[44px] min-h-[44px] bg-transparent border-none text-gypi-red cursor-pointer flex items-center justify-center shrink-0"><Ic.trash /></button>
          </div>
        ))}
      </div>

      {/* Add rule */}
      <h3 className="m-0 text-sm font-bold text-gypi-text font-heading mb-3">Agregar regla</h3>
      <div className="flex gap-2">
        <input
          value={nr}
          onChange={e => setNr(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          placeholder='Ej: "Si piden permiso un viernes..."'
          className="g-input flex-1"
        />
        <button
          onClick={add}
          disabled={!hasText}
          className={`w-11 h-11 rounded-xl border-none flex items-center justify-center ${
            hasText ? "bg-gypi-amber text-gypi-on-amber cursor-pointer" : "bg-gypi-surface text-gypi-mute cursor-default"
          }`}
        >
          <Ic.plus />
        </button>
      </div>
      {ConfirmDialog}
    </div>
  );
}
